/**
 * Web Index provider — searches the shared decentralized web index
 * (Search Index Protocol kind 39697 document observations).
 *
 * Reads recent observations from all search relays, groups by document id
 * (`d` tag), counts independent indexers per document, and matches the
 * query client-side (relays can't full-text search arbitrary tags; NIP-50
 * acceleration can be added per-relay later — spec §13).
 *
 * Any indexer is trusted structurally: events are self-signed observations
 * of public web metadata, validated by parseIndexEvent (URL allowlist,
 * schema version, field caps). Ranking signal: independent observation
 * count + recency.
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelayUrls } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import { WEB_INDEX_KIND, parseIndexEvent, type IndexObservation } from '@/lib/webIndex';
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

/** How many recent observations to pull before client-side matching. */
const FETCH_LIMIT = 300;

/** AND-match across title, description, url, topics. */
function matchesQuery(obs: IndexObservation, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = [obs.title, obs.description, obs.url, ...obs.topics]
    .join(' ')
    .toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** A document group: all observations of the same d-tag. */
interface DocumentGroup {
  /** Most recent observation, used for display. */
  latest: IndexObservation;
  /** Distinct indexer pubkeys that observed this document. */
  indexers: Set<string>;
}

function groupByDocument(observations: IndexObservation[]): Map<string, DocumentGroup> {
  const groups = new Map<string, DocumentGroup>();
  for (const obs of observations) {
    const existing = groups.get(obs.d);
    if (!existing) {
      groups.set(obs.d, { latest: obs, indexers: new Set([obs.indexer]) });
      continue;
    }
    existing.indexers.add(obs.indexer);
    if (obs.observedAt > existing.latest.observedAt) existing.latest = obs;
  }
  return groups;
}

export const webIndexProvider: SearchProvider = {
  id: 'web-index',
  name: 'Web Index',
  source: 'web',
  privacy: 'nostr',
  privacyNote: 'Reads the decentralized web index from Nostr relays. Relay operators see the query, but no account is linked.',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const filter: NostrFilter = {
      kinds: [WEB_INDEX_KIND],
      limit: FETCH_LIMIT,
    };

    const settled = await Promise.allSettled(
      getSearchRelayUrls().map(async (url) => {
        const relay = getSearchRelay(url);
        return relay.query([filter], {
          signal: AbortSignal.any([signal ?? AbortSignal.timeout(10000), AbortSignal.timeout(6000)]),
        });
      }),
    );

    // Merge by event id (same event may arrive from multiple relays).
    const events = new Map<string, NostrEvent>();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const ev of r.value) {
        if (!events.has(ev.id)) events.set(ev.id, ev);
      }
    }

    // Parse + validate, then group by document id.
    const observations = [...events.values()]
      .map(parseIndexEvent)
      .filter((o): o is IndexObservation => o !== null);

    const groups = groupByDocument(observations);
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);

    const results: SearchResult[] = [];
    for (const group of groups.values()) {
      const { latest } = group;
      if (!matchesQuery(latest, terms)) continue;

      const indexerCount = group.indexers.size;

      results.push({
        id: `widx:${latest.d}`,
        title: latest.title,
        url: latest.url,
        snippet: latest.description,
        source: 'web',
        provider: 'web-index',
        timestamp: latest.observedAt,
        domain: extractDomain(latest.url),
        thumbnail: latest.image,
        engine: 'Web Index',
        tags: latest.topics.slice(0, 5),
        // Cached-index sits at 90, community at 96. Protocol observations rank
        // just below community curation, boosted slightly by independent
        // indexer agreement (capped so it can't overtake curated content).
        score: 93 + Math.min(indexerCount - 1, 3),
        nostrEvent: latest.event,
      });
    }

    return {
      results: results
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.timestamp ?? 0) - (a.timestamp ?? 0))
        .slice(0, 20),
    };
  },
};

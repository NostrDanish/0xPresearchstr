/**
 * Web Index provider — searches the shared decentralized web index
 * (Search Index Protocol kind 39697 document observations, spec:
 * https://github.com/NostrDanish/SIP-01 — local copy docs/SIP-01.md).
 *
 * Reading (spec §15):
 * - Baseline: plain NIP-01 filters work on every relay. We fetch recent
 *   observations and match the query client-side (AND across title,
 *   description, URL, topics).
 * - Acceleration: the filter also carries a NIP-50 `search` keyword.
 *   SIP-01-aware relays answer with relevance-ranked matches and understand
 *   web operators (site:, lang:, after:, type:, …); relays that don't
 *   support NIP-50 simply ignore the keyword and return recent events.
 *
 * Observations are grouped by document id (`d` tag); distinct indexer count
 * is the core ranking signal ("N independent indexers saw this page").
 * Matched groups are integrity-checked per spec §18 step 2 (d ↔ normalized
 * u, x ↔ content) via verifyObservation() before display.
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelayUrls, getIndexRelayUrls } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import { WEB_INDEX_KIND, parseIndexEvent, verifyObservation, type IndexObservation } from '@/lib/webIndex';
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

/** How many recent observations to pull per relay. */
const FETCH_LIMIT = 300;

/**
 * Split the query into plain text terms and relay-side operators.
 * Tokens containing ':' (site:, lang:, after:, …) are NIP-50 extension
 * operators — SIP-01-aware relays apply them server-side, so the
 * client-side matcher ignores them instead of requiring literal matches.
 */
function splitQuery(query: string): { terms: string[] } {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !t.includes(':'));
  return { terms };
}

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

/** Display label for a §9.2 `type` extension value. */
function typeLabel(type: string | undefined): string | undefined {
  if (!type || type === 'page') return undefined; // the default — no badge noise
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export const webIndexProvider: SearchProvider = {
  id: 'web-index',
  name: 'Web Index',
  source: 'web',
  privacy: 'nostr',
  privacyNote: 'Reads the decentralized web index from Nostr relays. Relay operators see the query, but no account is linked.',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    // NIP-50 acceleration (spec §15): safe on every relay — relays that
    // don't support search ignore the keyword; SIP-01-aware relays answer
    // with ranked matches and apply any operators the user typed.
    const filter: NostrFilter & { search?: string } = {
      kinds: [WEB_INDEX_KIND],
      search: query.trim(),
      limit: FETCH_LIMIT,
    };

    // Read the union of the search pool and the index pool — observations are
    // published to the index pool, and SIP-01-aware search relays live in both.
    const readUrls = [...new Set([...getSearchRelayUrls(), ...getIndexRelayUrls()])];

    const settled = await Promise.allSettled(
      readUrls.map(async (url) => {
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
    const { terms } = splitQuery(query);

    // Match groups client-side, then integrity-check the displayed
    // observation (d ↔ u, x ↔ content — spec §18 step 2).
    const candidates = [...groups.values()].filter((group) => matchesQuery(group.latest, terms));
    const verified = await Promise.all(
      candidates.map(async (group) => ((await verifyObservation(group.latest)) ? group : null)),
    );

    const results: SearchResult[] = [];
    for (const group of verified) {
      if (!group) continue;
      const { latest } = group;
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
        kind: typeLabel(latest.extensions.type),
        tags: latest.topics.slice(0, 5),
        // Community curation sits at 96. Protocol observations rank just
        // below it, boosted slightly by independent indexer agreement
        // (capped so it can't overtake curated content).
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

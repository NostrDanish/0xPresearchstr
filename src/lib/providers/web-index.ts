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
 *   support NIP-50 ignore the keyword (SHOULD per NIP-50) and return recent
 *   events. Operator semantics are per-relay (spec §15) — we never RELY on
 *   them: every result is re-matched client-side regardless, so a generic
 *   NIP-50 relay (or one reading `domain:` as the NIP-05 author extension)
 *   degrades gracefully.
 *
 * Observations are grouped by document id (`d` tag); distinct indexer count
 * is the core ranking signal ("N independent indexers saw this page").
 * Matched groups are integrity-checked per spec §18 step 2 (d ↔ normalized
 * u, x ↔ content) via verifyObservation() before display.
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelayUrls, getIndexRelayUrls } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import { refreshDiscoveredRelays } from '@/lib/relayDiscovery';
import { WEB_INDEX_KIND, parseIndexEvent, verifyObservation, type IndexObservation } from '@/lib/webIndex';
import { matchWithRelevance, tokenizeRaw, type TermMatch } from '@/lib/queryMatch';
import { passesLanguageFilter } from '@/lib/languageFilter';
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

/** How many recent observations to pull per relay. */
const FETCH_LIMIT = 300;

/** AND-match + relevance across title, description, url, topics (smart tokenization). */
function matchQuery(obs: IndexObservation, query: ReturnType<typeof tokenizeRaw>): TermMatch {
  // tokenizeRaw strips NIP-50 operator tokens (site:, lang:, …) — those are
  // relay-side directives — then matches with stop-word tolerance, plural
  // folding, the multi-word gutting guard, and phrase-aware relevance.
  return matchWithRelevance(
    [obs.title, obs.description, obs.url, ...obs.topics],
    query,
  );
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
  /**
   * Distinct relays the observations arrived from — the Sybil-resistance
   * signal. 1000 indexer keys published to ONE relay is one relay's word;
   * independent observations arriving over DIFFERENT relays is what
   * "N independent indexers saw this page" actually means.
   */
  relays: Set<string>;
  /**
   * Content-hash agreement: indexers whose observation's x matches the
   * displayed (latest) one. An indexer observing DIFFERENT content doesn't
   * corroborate this page — it observed something else.
   */
  agreeingIndexers: Set<string>;
}

function groupByDocument(
  observations: IndexObservation[],
  eventRelays: Map<string, Set<string>>,
): Map<string, DocumentGroup> {
  const byDoc = new Map<string, IndexObservation[]>();
  for (const obs of observations) {
    byDoc.set(obs.d, [...(byDoc.get(obs.d) ?? []), obs]);
  }

  const groups = new Map<string, DocumentGroup>();
  for (const [d, obsList] of byDoc) {
    const latest = obsList.reduce((a, b) => (b.observedAt > a.observedAt ? b : a));
    const indexers = new Set(obsList.map((o) => o.indexer));
    const relays = new Set<string>();
    for (const o of obsList) {
      for (const r of eventRelays.get(o.event.id) ?? []) relays.add(r);
    }
    const latestX = latest.contentHash;
    const agreeingIndexers = new Set(
      obsList
        .filter((o) => !latestX || !o.contentHash || o.contentHash === latestX)
        .map((o) => o.indexer),
    );
    groups.set(d, { latest, indexers, relays, agreeingIndexers });
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

  async search({ query, signal, languages }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };
    const langFilter = languages ?? [];

    // Kick off (or refresh) relay auto-discovery in the background — the
    // SIP-01 uncaged_index block in a relay's NIP-11 doc earns it a spot in
    // the index pool on later searches.
    void refreshDiscoveredRelays();

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

    // Merge by event id (same event may arrive from multiple relays), and
    // record WHICH relays served each event — relay diversity per document
    // is the Sybil-resistance signal used at ranking time.
    const events = new Map<string, NostrEvent>();
    const eventRelays = new Map<string, Set<string>>();
    settled.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const relayUrl = readUrls[i];
      for (const ev of r.value) {
        if (!events.has(ev.id)) events.set(ev.id, ev);
        const set = eventRelays.get(ev.id) ?? new Set<string>();
        set.add(relayUrl);
        eventRelays.set(ev.id, set);
      }
    });

    // Parse + validate, then group by document id. When a result language
    // filter is set, drop observations with a KNOWN non-matching language
    // (the `l` tag) — unknown-language pages pass (most indexers don't tag
    // language yet; hard-dropping them would gut the index).
    const observations = [...events.values()]
      .map(parseIndexEvent)
      .filter((o): o is IndexObservation => o !== null)
      .filter((o) => passesLanguageFilter(o.language, langFilter));

    const groups = groupByDocument(observations, eventRelays);

    // Match groups client-side (with relevance), then integrity-check the
    // displayed observation (d ↔ u, x ↔ content — spec §18 step 2).
    const terms = tokenizeRaw(query);
    const candidates = [...groups.values()]
      .map((group) => ({ group, m: matchQuery(group.latest, terms) }))
      .filter(({ m }) => m.match);
    const verified = await Promise.all(
      candidates.map(async (c) => ((await verifyObservation(c.group.latest)) ? c : null)),
    );

    const results: SearchResult[] = [];
    for (const c of verified) {
      if (!c) continue;
      const { latest } = c.group;

      // Sybil-aware agreement bonus: an extra indexer only counts when it
      // (a) agrees on the content hash and (b) the group's observations
      // arrived over MORE THAN ONE relay. A farm of fresh keys publishing
      // to a single relay earns nothing; independent indexers whose
      // observations replicate across the relay set earn the lift.
      const relayDiverse = c.group.relays.size > 1;
      const agreementBonus = relayDiverse
        ? Math.min(Math.max(c.group.agreeingIndexers.size - 1, 0), 2)
        : 0;

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
        language: latest.language,
        // Rank WITH fresh organic results (SearXNG sits at 80), not above
        // them — a page being in the index is not by itself a quality signal.
        // Relevance to the actual query words scales the base; independent
        // indexer agreement lifts a result above the organic band (capped).
        // Inside the ±5 tie band the merge sorts by recency, so single-observer
        // hits interleave with fresh web results instead of dominating them.
        score: 78 + c.m.relevance * 4 + agreementBonus,
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

/**
 * Cached Index provider — reads from the federated Nostr search index.
 *
 * Before hitting any external API, this provider checks if the query
 * has been searched before and has cached results published by ANY
 * trusted indexer (0xPresearchstr bot, 0xSearchstr bot, …).
 *
 * The index is shared across every compatible client: same kind,
 * same d-tags, same t-tags — only the signer differs per app. So a
 * search on 0xSearchstr warms the cache for 0xPresearchstr users and
 * vice versa.
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelay } from '@/lib/searchRelays';
import {
  INDEXER_PUBKEYS,
  INDEX_KIND,
  normalizeQuery,
  parseCacheEvent,
} from '@/lib/searchIndex';
import type { SearchProvider, SearchOptions, ProviderSearchResponse } from './types';

/** Relays to read the cache from. */
const CACHE_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay.primal.net/',
  'wss://relay.damus.io/',
];

export const cachedIndexProvider: SearchProvider = {
  id: 'cached-index',
  name: 'Index',
  source: 'web', // cached results are primarily web results
  privacy: 'nostr',
  privacyNote: 'Reads previous results from Nostr relays. Relay operators see the query, but no account is linked.',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const normalized = normalizeQuery(query);
    const dTag = `0xsearchstr:cache:${normalized}`;

    const filter: NostrFilter = {
      kinds: [INDEX_KIND],
      authors: [...INDEXER_PUBKEYS], // CRITICAL: only trust known indexer events
      '#d': [dTag],
      limit: INDEXER_PUBKEYS.length, // one event per indexer
    };

    // Race relays for the fastest cache hit.
    const results = await Promise.allSettled(
      CACHE_RELAYS.map(async (url) => {
        const relay = getSearchRelay(url);
        return relay.query([filter], {
          signal: AbortSignal.any([
            signal ?? AbortSignal.timeout(5000),
            AbortSignal.timeout(3000), // Cache reads should be fast
          ]),
        });
      }),
    );

    // Find the first valid cache event (most recent across all indexers).
    const candidates: NostrEvent[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled' || r.value.length === 0) continue;
      candidates.push(...r.value);
    }
    candidates.sort((a, b) => b.created_at - a.created_at);

    for (const event of candidates) {
      const cached = parseCacheEvent(event);
      if (cached && cached.results.length > 0) {
        return { results: cached.results };
      }
    }

    return { results: [] };
  },
};

/**
 * Cached Index provider — reads from 0xSearchstr's own Nostr index.
 *
 * Before hitting any external API, this provider checks if the query
 * has been searched before and has cached results published by the
 * 0xSearchstr bot account.
 *
 * This makes 0xSearchstr a self-improving search engine:
 * every search grows the index, and subsequent searches are instant.
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelay } from '@/lib/searchRelays';
import {
  INDEX_PUBKEY,
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
      authors: [INDEX_PUBKEY], // CRITICAL: only trust the bot's own events
      '#d': [dTag],
      limit: 1,
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

    // Find the first valid cache event.
    for (const r of results) {
      if (r.status !== 'fulfilled' || r.value.length === 0) continue;

      // Take the most recent event.
      const events = r.value.sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at);

      for (const event of events) {
        const cached = parseCacheEvent(event);
        if (cached && cached.results.length > 0) {
          return { results: cached.results };
        }
      }
    }

    return { results: [] };
  },
};

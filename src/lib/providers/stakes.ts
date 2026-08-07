/**
 * Keyword Stakes provider — Presearch-style staked keyword results.
 *
 * When a search query exactly matches a staked keyword, the stake shows
 * up as a top placement ("Community Stake"). Reads kind 30078 events with
 * d-tag "0xsearchstr:stake:<normalized-query>" from the search relays
 * plus the index relays (stakes publish via the user's own relay list,
 * which defaults to the app relays).
 *
 * Exact-match only by design: like Presearch keyword staking, a stake
 * buys placement for a specific keyword, not a fuzzy topic. This keeps
 * relay queries cheap (single #d filter, no client-side full-text scan)
 * and makes placement predictable.
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelayUrls } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import { STAKE_KIND, stakeDTag, parseStakeEvent } from '@/lib/keywordStakes';
import type { SearchProvider, SearchOptions, ProviderSearchResponse } from './types';

/** Index relays — where stake events land via default publish lists. */
const INDEX_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay.primal.net/',
  'wss://relay.damus.io/',
];

/** Max stakes shown for a single keyword. */
const MAX_STAKES = 3;

export const stakesProvider: SearchProvider = {
  id: 'keyword-stakes',
  name: 'Stakes',
  source: 'web',
  privacy: 'nostr',
  privacyNote: 'Reads community keyword stakes from Nostr relays. Relay operators see the query, but no account is linked.',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    const normalized = query.trim();
    if (!normalized) return { results: [] };

    const filter: NostrFilter = {
      kinds: [STAKE_KIND],
      '#d': [stakeDTag(normalized)],
      limit: 25,
    };

    // Query search relays + index relays (union covers both read paths).
    const relayUrls = [...new Set([...getSearchRelayUrls(), ...INDEX_RELAYS])];

    const settled = await Promise.allSettled(
      relayUrls.map(async (url) => {
        const relay = getSearchRelay(url);
        return relay.query([filter], {
          signal: AbortSignal.any([signal ?? AbortSignal.timeout(8000), AbortSignal.timeout(5000)]),
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

    const parsed = [...events.values()]
      .map(parseStakeEvent)
      .filter((r): r is NonNullable<typeof r> => r !== null)
      // Competing stakes on one keyword: newest stake wins placement.
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, MAX_STAKES);

    return { results: parsed };
  },
};

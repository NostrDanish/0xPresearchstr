/**
 * Community Index provider — user-curated search results from Nostr.
 *
 * Reads three event families from the relay pools:
 *   1. Presearchstr/0xSearchstr submissions (t-tag "0xsearchstr-submit")
 *   2. Nostra Search index entries (d-tag "nostra:index", incl. encrypted)
 *   3. NIP-B0 web bookmarks (kind 39701) — user-curated links from any
 *      bookmarking client
 *
 * Relays can't full-text search arbitrary tags, so recent submissions are
 * fetched and filtered client-side against the query terms (AND match
 * across title, description, tags, and URL).
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelayUrls, getIndexRelayUrls } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import {
  COMMUNITY_KIND,
  COMMUNITY_T_TAG,
  NOSTRA_D_TAG,
  BOOKMARK_KIND,
  parseSubmissionEvent,
  parseNostraEvent,
  parseBookmarkEvent,
} from '@/lib/communityIndex';
import { matchesTerms, tokenizeRaw } from '@/lib/queryMatch';
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

/** How many recent events to pull per family before client-side filtering. */
const FETCH_LIMIT = 150;

/** Does this result match the query? Smart AND-match across searchable fields,
 *  with the multi-word gutting guard ("how to build" must match more than "build"). */
function matchesQuery(result: SearchResult, query: string): boolean {
  return matchesTerms(
    [result.title, result.snippet, result.url, ...(result.tags ?? [])],
    tokenizeRaw(query),
  );
}

export const communityProvider: SearchProvider = {
  id: 'community',
  name: 'Community',
  source: 'web',
  additionalSources: ['tor'], // curated onion links belong in the Tor tab too
  privacy: 'nostr',
  privacyNote: 'User-curated index entries read from Nostr relays. Relay operators see the query, but no account is linked.',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const filters: NostrFilter[] = [
      { kinds: [COMMUNITY_KIND], '#t': [COMMUNITY_T_TAG], limit: FETCH_LIMIT },
      { kinds: [COMMUNITY_KIND], '#d': [NOSTRA_D_TAG], limit: FETCH_LIMIT },
      { kinds: [BOOKMARK_KIND], limit: FETCH_LIMIT }, // NIP-B0 web bookmarks
    ];

    const settled = await Promise.allSettled(
      [...new Set([...getSearchRelayUrls(), ...getIndexRelayUrls()])].map(async (url) => {
        const relay = getSearchRelay(url);
        return relay.query(filters, {
          signal: AbortSignal.any([signal ?? AbortSignal.timeout(10000), AbortSignal.timeout(6000)]),
        });
      }),
    );

    // Merge events by id (same event may arrive from multiple relays).
    const events = new Map<string, NostrEvent>();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const ev of r.value) {
        if (!events.has(ev.id)) events.set(ev.id, ev);
      }
    }

    // Parse: bookmarks + 0xsearchstr-protocol submissions are sync;
    // Nostra payloads may need decryption.
    const parsed = await Promise.all(
      [...events.values()].map(async (ev) => {
        if (ev.kind === BOOKMARK_KIND) return parseBookmarkEvent(ev);
        const isNostra = ev.tags.some(([n, v]) => n === 'd' && v === NOSTRA_D_TAG);
        return isNostra ? parseNostraEvent(ev) : parseSubmissionEvent(ev);
      }),
    );

    // Dedupe by URL (keep newest), filter by query, sort by recency.
    const byUrl = new Map<string, SearchResult>();
    for (const result of parsed) {
      if (!result || !matchesQuery(result, query)) continue;
      const key = result.url.toLowerCase();
      const existing = byUrl.get(key);
      if (!existing || (result.timestamp ?? 0) > (existing.timestamp ?? 0)) {
        byUrl.set(key, result);
      }
    }

    return {
      results: [...byUrl.values()].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, 20),
    };
  },
};

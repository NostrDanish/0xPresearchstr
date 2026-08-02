/**
 * Community Index provider — user-curated search results from Nostr.
 *
 * Reads two event families from search relays:
 *   1. 0xSearchstr submissions (t-tag "0xsearchstr-submit")
 *   2. Nostra Search index entries (d-tag "nostra:index", incl. encrypted)
 *
 * Relays can't full-text search arbitrary tags, so recent submissions are
 * fetched and filtered client-side against the query terms (AND match
 * across title, description, tags, and URL).
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelayUrls } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import {
  COMMUNITY_KIND,
  COMMUNITY_T_TAG,
  NOSTRA_D_TAG,
  parseSubmissionEvent,
  parseNostraEvent,
} from '@/lib/communityIndex';
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

/** How many recent events to pull per family before client-side filtering. */
const FETCH_LIMIT = 150;

/** Does this result match the query? AND-match across searchable fields. */
function matchesQuery(result: SearchResult, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = [
    result.title,
    result.snippet,
    result.url,
    ...(result.tags ?? []),
  ].join(' ').toLowerCase();
  return terms.every((t) => haystack.includes(t));
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
    ];

    const settled = await Promise.allSettled(
      getSearchRelayUrls().map(async (url) => {
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

    // Parse: 0xSearchstr submissions are sync; Nostra payloads may need decryption.
    const parsed = await Promise.all(
      [...events.values()].map(async (ev) => {
        const isNostra = ev.tags.some(([n, v]) => n === 'd' && v === NOSTRA_D_TAG);
        return isNostra ? parseNostraEvent(ev) : parseSubmissionEvent(ev);
      }),
    );

    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);

    // Dedupe by URL (keep newest), filter by query, sort by recency.
    const byUrl = new Map<string, SearchResult>();
    for (const result of parsed) {
      if (!result || !matchesQuery(result, terms)) continue;
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

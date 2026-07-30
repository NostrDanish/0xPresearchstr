/**
 * Trending cached queries — browsable view of the 0xSearchstr community index.
 *
 * Reads the most recent kind 30078 cache events published by the 0xSearchstr
 * bot account across the cache relays, and turns them into a list of queries
 * people have searched before. This is what makes the cache a moat:
 * every search becomes discoverable content.
 */
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelay } from '@/lib/searchRelays';
import { INDEX_KIND, INDEX_PUBKEY } from '@/lib/searchIndex';

/** Relays the cache is published to (must mirror useSearchIndexer). */
const CACHE_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay.primal.net/',
  'wss://relay.damus.io/',
];

export interface CachedQueryEntry {
  /** Original query text (from the `query` tag). */
  query: string;
  /** Number of results stored in the cache event. */
  resultCount: number;
  /** When the cache entry was written (unix seconds). */
  cachedAt: number;
}

function parseEntry(event: NostrEvent): CachedQueryEntry | null {
  const dTag = event.tags.find(([n]) => n === 'd')?.[1];
  if (!dTag?.startsWith('0xsearchstr:cache:')) return null;

  const query = event.tags.find(([n]) => n === 'query')?.[1];
  if (!query?.trim()) return null;

  const resultCountTag = event.tags.find(([n]) => n === 'result_count')?.[1];
  const cachedAtTag = event.tags.find(([n]) => n === 'cached_at')?.[1];

  return {
    query: query.trim(),
    resultCount: resultCountTag ? parseInt(resultCountTag, 10) || 0 : 0,
    cachedAt: cachedAtTag ? parseInt(cachedAtTag, 10) || event.created_at : event.created_at,
  };
}

export function useCachedQueries(limit = 80) {
  return useQuery({
    queryKey: ['cached-queries', limit],
    queryFn: async ({ signal }) => {
      const filter: NostrFilter = {
        kinds: [INDEX_KIND],
        authors: [INDEX_PUBKEY], // only trust the bot's own cache events
        limit,
      };

      const settled = await Promise.allSettled(
        CACHE_RELAYS.map((url) => {
          const relay = getSearchRelay(url);
          return relay.query([filter], {
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          });
        }),
      );

      // Merge by d-tag, keeping the most recent version of each query.
      const byDTag = new Map<string, CachedQueryEntry>();
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const event of r.value) {
          const entry = parseEntry(event);
          if (!entry) continue;
          const key = event.tags.find(([n]) => n === 'd')?.[1] ?? entry.query.toLowerCase();
          const existing = byDTag.get(key);
          if (!existing || entry.cachedAt > existing.cachedAt) {
            byDTag.set(key, entry);
          }
        }
      }

      return [...byDTag.values()]
        .sort((a, b) => b.cachedAt - a.cachedAt);
    },
    staleTime: 60_000,
    retry: 1,
  });
}

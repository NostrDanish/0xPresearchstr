/**
 * Recently indexed documents — browsable view of the shared web index.
 *
 * Reads the newest kind 39697 observations (Search Index Protocol) from any
 * indexer across the search relays, groups them by document id, and counts
 * independent indexers per document. This is what "every search grows the
 * index" looks like as content — real pages the network has observed.
 */
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelayUrls } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import { WEB_INDEX_KIND, parseIndexEvent, type IndexObservation } from '@/lib/webIndex';

export interface IndexedDocEntry {
  /** Canonical URL. */
  url: string;
  title: string;
  description: string;
  domain: string;
  topics: string[];
  /** Distinct indexers that observed this document. */
  indexerCount: number;
  /** Most recent observation time (unix seconds). */
  observedAt: number;
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

export function useRecentIndexedDocs(limit = 100) {
  return useQuery({
    queryKey: ['recent-indexed-docs', limit],
    queryFn: async ({ signal }) => {
      const filter: NostrFilter = { kinds: [WEB_INDEX_KIND], limit };

      const settled = await Promise.allSettled(
        getSearchRelayUrls().map((url) => {
          const relay = getSearchRelay(url);
          return relay.query([filter], {
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          });
        }),
      );

      const events = new Map<string, NostrEvent>();
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const ev of r.value) {
          if (!events.has(ev.id)) events.set(ev.id, ev);
        }
      }

      // Group by document id, tracking distinct indexers + latest observation.
      const docs = new Map<string, { latest: IndexObservation; indexers: Set<string> }>();

      for (const ev of events.values()) {
        const obs = parseIndexEvent(ev);
        if (!obs) continue;
        const existing = docs.get(obs.d);
        if (!existing) {
          docs.set(obs.d, { latest: obs, indexers: new Set([obs.indexer]) });
          continue;
        }
        existing.indexers.add(obs.indexer);
        if (obs.observedAt > existing.latest.observedAt) existing.latest = obs;
      }

      const entries: IndexedDocEntry[] = [];
      for (const { latest, indexers } of docs.values()) {
        entries.push({
          url: latest.url,
          title: latest.title,
          description: latest.description,
          domain: extractDomain(latest.url),
          topics: latest.topics,
          indexerCount: indexers.size,
          observedAt: latest.observedAt,
        });
      }

      return entries.sort((a, b) => b.observedAt - a.observedAt);
    },
    staleTime: 60_000,
    retry: 1,
  });
}

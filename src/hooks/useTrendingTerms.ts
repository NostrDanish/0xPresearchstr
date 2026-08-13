/**
 * Trending terms — the privacy-preserving replacement for reading plaintext
 * queries out of the legacy query cache.
 *
 * Reads hashed term signals + reveals (see src/lib/termSignals.ts) from the
 * index relays and returns only terms that:
 *   1. have been signaled by at least TRENDING_THRESHOLD distinct devices, AND
 *   2. have a self-verifying plaintext reveal (hash of plaintext === d-tag).
 *
 * Rare or confidential queries never clear the threshold, so they never
 * appear here — or anywhere — in plaintext.
 */
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelay } from '@/lib/searchRelays';
import { getIndexRelayUrls } from '@/lib/appRelays';
import {
  INDEX_KIND,
} from '@/lib/searchIndex';
import {
  TERM_SIGNAL_T_TAG,
  TERM_REVEAL_T_TAG,
  TRENDING_THRESHOLD,
  parseTermSignal,
  parseTermReveal,
  verifyTermReveal,
} from '@/lib/termSignals';

export interface TrendingTerm {
  /** Plaintext query (only ever present for threshold-crossed terms). */
  query: string;
  /** Distinct devices that signaled this term. */
  searchers: number;
  /** Most recent signal time (unix seconds). */
  lastSearchedAt: number;
}

export function useTrendingTerms(limit = 400) {
  return useQuery({
    queryKey: ['trending-terms', limit],
    queryFn: async ({ signal }) => {
      const filter: NostrFilter = {
        kinds: [INDEX_KIND],
        '#t': [TERM_SIGNAL_T_TAG, TERM_REVEAL_T_TAG],
        limit,
      };

      const settled = await Promise.allSettled(
        getIndexRelayUrls().map(async (url) => {
          try {
            const relay = getSearchRelay(url);
            return await relay.query([filter], {
              signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
            });
          } catch {
            return [] as NostrEvent[]; // dead relay = empty contribution
          }
        }),
      );

      // Merge by event id, then split into signals vs reveals.
      const events = new Map<string, NostrEvent>();
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const ev of r.value) {
          if (!events.has(ev.id)) events.set(ev.id, ev);
        }
      }

      // Group signals by term hash: distinct devices + latest signal time.
      const byHash = new Map<string, { devices: Set<string>; lastSearchedAt: number }>();
      // Reveal candidates by term hash (plaintext verified below).
      const reveals = new Map<string, { term: string; revealedAt: number }>();

      for (const ev of events.values()) {
        const signal = parseTermSignal(ev);
        if (signal) {
          const entry = byHash.get(signal.hash) ?? { devices: new Set<string>(), lastSearchedAt: 0 };
          entry.devices.add(signal.searcher);
          entry.lastSearchedAt = Math.max(entry.lastSearchedAt, signal.signaledAt);
          byHash.set(signal.hash, entry);
          continue;
        }
        const reveal = parseTermReveal(ev);
        if (reveal) {
          const existing = reveals.get(reveal.hash);
          if (!existing || reveal.revealedAt > existing.revealedAt) {
            reveals.set(reveal.hash, { term: reveal.term, revealedAt: reveal.revealedAt });
          }
        }
      }

      // Threshold gate + self-verifying reveal join.
      const terms: TrendingTerm[] = [];
      for (const [hash, stats] of byHash) {
        if (stats.devices.size < TRENDING_THRESHOLD) continue;
        const reveal = reveals.get(hash);
        if (!reveal) continue;
        if (!(await verifyTermReveal(hash, reveal.term))) continue;
        terms.push({
          query: reveal.term,
          searchers: stats.devices.size,
          lastSearchedAt: stats.lastSearchedAt,
        });
      }

      // Trending = recent first; agreement count breaks ties.
      return terms.sort(
        (a, b) => b.lastSearchedAt - a.lastSearchedAt || b.searchers - a.searchers,
      );
    },
    staleTime: 60_000,
    retry: 1,
  });
}

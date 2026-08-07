/**
 * Recent keyword stakes — browsable view of community-staked keywords.
 *
 * Reads the most recent kind 30078 stake events (t-tag "0xsearchstr-stake")
 * across the search + index relays. Stakes are public UGC (no author filter);
 * each entry is validated before display.
 */
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelay } from '@/lib/searchRelays';
import { getSearchRelayUrls } from '@/lib/appRelays';
import { STAKE_KIND, STAKE_T_TAG } from '@/lib/keywordStakes';
import { isValidSubmissionUrl } from '@/lib/contentType';

/** Index relays — stakes publish via default relay lists. */
const INDEX_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay.primal.net/',
  'wss://relay.damus.io/',
];

export interface StakeEntry {
  /** The staked keyword (original casing). */
  keyword: string;
  /** Target URL. */
  url: string;
  /** Display title. */
  title: string;
  /** Staker pubkey (hex). */
  staker: string;
  /** When the stake was placed (unix seconds). */
  stakedAt: number;
}

function parseEntry(event: NostrEvent): StakeEntry | null {
  if (event.kind !== STAKE_KIND) return null;
  if (!event.tags.some(([n, v]) => n === 't' && v === STAKE_T_TAG)) return null;

  const get = (name: string) => event.tags.find(([n]) => n === name)?.[1];
  const dTag = get('d');
  if (!dTag?.startsWith('0xsearchstr:stake:')) return null;

  const url = get('url');
  const title = get('title');
  if (!url || !isValidSubmissionUrl(url) || !title?.trim()) return null;

  return {
    keyword: get('keyword')?.trim() || dTag.slice('0xsearchstr:stake:'.length),
    url: url.trim(),
    title: title.trim(),
    staker: event.pubkey,
    stakedAt: event.created_at,
  };
}

export function useRecentStakes(limit = 50) {
  return useQuery({
    queryKey: ['recent-stakes', limit],
    queryFn: async ({ signal }) => {
      const filter: NostrFilter = {
        kinds: [STAKE_KIND],
        '#t': [STAKE_T_TAG],
        limit,
      };

      const relayUrls = [...new Set([...getSearchRelayUrls(), ...INDEX_RELAYS])];

      const settled = await Promise.allSettled(
        relayUrls.map((url) => {
          const relay = getSearchRelay(url);
          return relay.query([filter], {
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          });
        }),
      );

      // Merge by event id, then keep the newest stake per keyword+staker.
      const byId = new Map<string, NostrEvent>();
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const ev of r.value) {
          if (!byId.has(ev.id)) byId.set(ev.id, ev);
        }
      }

      const entries = [...byId.values()]
        .map(parseEntry)
        .filter((e): e is StakeEntry => e !== null)
        .sort((a, b) => b.stakedAt - a.stakedAt);

      // Dedupe: one entry per keyword+staker (addressable semantics).
      const seen = new Set<string>();
      return entries.filter((e) => {
        const key = `${e.staker}:${e.keyword.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    staleTime: 60_000,
    retry: 1,
  });
}

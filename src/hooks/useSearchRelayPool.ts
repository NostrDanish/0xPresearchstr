/**
 * Search relay pool hook — React state over the NIP-50 search relay pool
 * (0xSearchstr defaults + user customs), with Nostra-style latency testing:
 * ping each relay with a tiny query and time the round-trip.
 */
import { useCallback, useState } from 'react';

import {
  SEARCH_RELAYS,
  getCustomSearchRelays,
  addCustomSearchRelay,
  removeCustomSearchRelay,
} from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';

export type SearchRelayOrigin = 'default' | 'custom';
export type SearchRelayStatus = 'untested' | 'testing' | 'ok' | 'error';

export interface SearchRelayEntry {
  url: string;
  origin: SearchRelayOrigin;
  status: SearchRelayStatus;
  latencyMs?: number;
}

function buildPool(): SearchRelayEntry[] {
  const defaults = SEARCH_RELAYS.map((url): SearchRelayEntry => ({
    url,
    origin: 'default',
    status: 'untested',
  }));
  const customs = getCustomSearchRelays()
    .filter((u) => !(SEARCH_RELAYS as readonly string[]).includes(u))
    .map((url): SearchRelayEntry => ({
      url,
      origin: 'custom',
      status: 'untested',
    }));
  return [...defaults, ...customs];
}

export function useSearchRelayPool() {
  const [pool, setPool] = useState<SearchRelayEntry[]>(buildPool);
  const [testing, setTesting] = useState(false);

  const addRelay = useCallback((input: string): string | null => {
    const added = addCustomSearchRelay(input);
    if (added) setPool(buildPool());
    return added;
  }, []);

  const removeRelay = useCallback((url: string) => {
    removeCustomSearchRelay(url);
    setPool(buildPool());
  }, []);

  /** Ping every relay with a limit-1 query and record latency/status. */
  const testRelays = useCallback(async () => {
    setTesting(true);
    setPool((prev) => prev.map((r) => ({ ...r, status: 'testing' as const })));

    await Promise.allSettled(
      pool.map(async (entry) => {
        const start = performance.now();
        try {
          const relay = getSearchRelay(entry.url);
          await relay.query([{ kinds: [1], limit: 1 }], {
            signal: AbortSignal.timeout(5000),
          });
          const latencyMs = Math.round(performance.now() - start);
          setPool((prev) =>
            prev.map((r) =>
              r.url === entry.url ? { ...r, status: 'ok' as const, latencyMs } : r,
            ),
          );
        } catch {
          setPool((prev) =>
            prev.map((r) =>
              r.url === entry.url ? { ...r, status: 'error' as const, latencyMs: undefined } : r,
            ),
          );
        }
      }),
    );

    setTesting(false);
  }, [pool]);

  return { pool, testing, testRelays, addRelay, removeRelay };
}

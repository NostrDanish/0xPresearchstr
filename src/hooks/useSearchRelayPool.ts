/**
 * Relay pool hooks — React state over the app's relay pools
 * (Presearchstr defaults + user customs − hidden defaults), with
 * Nostra-style latency testing: ping each relay with a tiny query and
 * time the round-trip.
 *
 * Four pools exist:
 *   - search pool (NIP-50 reads)         → useSearchRelayPool()
 *   - index pool (SIP-01 reads + writes) → useIndexRelayPool()
 *   - git pool (NIP-34 reads, read-only) → useGitRelayPool()
 *   - wiki pool (NIP-54 reads, read-only) → useWikiRelayPool()
 *
 * Every default relay can be hidden by the user (restorable), and customs
 * can be added/removed — defaults are suggestions, not mandates.
 */
import { useCallback, useState } from 'react';

import {
  SEARCH_RELAYS,
  INDEX_RELAYS,
  GIT_RELAYS,
  WIKI_RELAYS,
  getCustomSearchRelays,
  addCustomSearchRelay,
  removeCustomSearchRelay,
  getHiddenSearchRelays,
  hideDefaultSearchRelay,
  restoreDefaultSearchRelay,
  restoreAllDefaultSearchRelays,
  getCustomIndexRelays,
  addCustomIndexRelay,
  removeCustomIndexRelay,
  getHiddenIndexRelays,
  hideDefaultIndexRelay,
  restoreDefaultIndexRelay,
  restoreAllDefaultIndexRelays,
  gitRelays,
  wikiRelays,
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

interface PoolStore {
  defaults: readonly string[];
  getCustoms: () => string[];
  addCustom: (input: string) => string | null;
  removeCustom: (url: string) => void;
  getHidden: () => string[];
  hideDefault: (url: string) => void;
  restoreAllDefaults: () => void;
  /**
   * Kinds used for the latency probe. Specialized relays (git/wiki) may not
   * store kind 1 at all — probing with their native kind avoids false errors.
   */
  probeKinds: number[];
}

function useRelayPool(store: PoolStore) {
  const buildPool = useCallback((): SearchRelayEntry[] => {
    const hidden = new Set(store.getHidden());
    const defaults = store.defaults
      .filter((url) => !hidden.has(url))
      .map((url): SearchRelayEntry => ({ url, origin: 'default', status: 'untested' }));
    const customs = store.getCustoms()
      .filter((u) => !store.defaults.includes(u) && !hidden.has(u))
      .filter((u, i, arr) => arr.indexOf(u) === i)
      .map((url): SearchRelayEntry => ({ url, origin: 'custom', status: 'untested' }));
    return [...defaults, ...customs];
  }, [store]);

  const [pool, setPool] = useState<SearchRelayEntry[]>(buildPool);
  const [testing, setTesting] = useState(false);

  const addRelay = useCallback((input: string): string | null => {
    const added = store.addCustom(input);
    if (added) setPool(buildPool());
    return added;
  }, [store, buildPool]);

  /** Remove a relay — customs are deleted, defaults are hidden (restorable). */
  const removeRelay = useCallback((url: string) => {
    if (store.defaults.includes(url)) {
      store.hideDefault(url);
    } else {
      store.removeCustom(url);
    }
    setPool(buildPool());
  }, [store, buildPool]);

  /** Bring back all hidden defaults. */
  const restoreDefaults = useCallback(() => {
    store.restoreAllDefaults();
    setPool(buildPool());
  }, [store, buildPool]);

  /** Ping every relay with a limit-1 query and record latency/status. */
  const testRelays = useCallback(async () => {
    setTesting(true);
    setPool((prev) => prev.map((r) => ({ ...r, status: 'testing' as const })));

    await Promise.allSettled(
      pool.map(async (entry) => {
        const start = performance.now();
        try {
          const relay = getSearchRelay(entry.url);
          await relay.query([{ kinds: store.probeKinds, limit: 1 }], {
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

  const hiddenCount = store.getHidden().length;

  return { pool, testing, testRelays, addRelay, removeRelay, restoreDefaults, hiddenCount };
}

const SEARCH_POOL_STORE: PoolStore = {
  defaults: SEARCH_RELAYS,
  getCustoms: getCustomSearchRelays,
  addCustom: addCustomSearchRelay,
  removeCustom: removeCustomSearchRelay,
  getHidden: getHiddenSearchRelays,
  hideDefault: hideDefaultSearchRelay,
  restoreAllDefaults: restoreAllDefaultSearchRelays,
  probeKinds: [1],
};

const INDEX_POOL_STORE: PoolStore = {
  defaults: INDEX_RELAYS,
  getCustoms: getCustomIndexRelays,
  addCustom: addCustomIndexRelay,
  removeCustom: removeCustomIndexRelay,
  getHidden: getHiddenIndexRelays,
  hideDefault: hideDefaultIndexRelay,
  restoreAllDefaults: restoreAllDefaultIndexRelays,
  probeKinds: [39697, 30078],
};

const GIT_POOL_STORE: PoolStore = {
  defaults: GIT_RELAYS,
  getCustoms: gitRelays.getCustoms,
  addCustom: gitRelays.addCustom,
  removeCustom: gitRelays.removeCustom,
  getHidden: gitRelays.getHidden,
  hideDefault: gitRelays.hideDefault,
  restoreAllDefaults: gitRelays.restoreAllDefaults,
  probeKinds: [30617],
};

const WIKI_POOL_STORE: PoolStore = {
  defaults: WIKI_RELAYS,
  getCustoms: wikiRelays.getCustoms,
  addCustom: wikiRelays.addCustom,
  removeCustom: wikiRelays.removeCustom,
  getHidden: wikiRelays.getHidden,
  hideDefault: wikiRelays.hideDefault,
  restoreAllDefaults: wikiRelays.restoreAllDefaults,
  probeKinds: [30818],
};

/** Search relay pool (NIP-50 full-text reads). */
export function useSearchRelayPool() {
  return useRelayPool(SEARCH_POOL_STORE);
}

/** Index relay pool (SIP-01 crawler/indexer reads + writes). */
export function useIndexRelayPool() {
  return useRelayPool(INDEX_POOL_STORE);
}

/** Git relay pool (NIP-34 ngit/GRASP reads — read-only). */
export function useGitRelayPool() {
  return useRelayPool(GIT_POOL_STORE);
}

/** Wiki relay pool (NIP-54 article reads — read-only). */
export function useWikiRelayPool() {
  return useRelayPool(WIKI_POOL_STORE);
}

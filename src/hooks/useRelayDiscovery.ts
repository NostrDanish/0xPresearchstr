/**
 * Hook for relay auto-discovery state (relayDiscovery.ts): the on/off
 * toggle (on by default), a manual refresh, and the last-verified
 * timestamp/counts for the Settings UI.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  getDiscoveryCache,
  isRelayDiscoveryEnabled,
  setRelayDiscoveryEnabled,
  refreshDiscoveredRelays,
  type VerifiedRelay,
} from '@/lib/relayDiscovery';

export function useRelayDiscovery() {
  const [enabled, setEnabled] = useState(() => isRelayDiscoveryEnabled());
  const [refreshing, setRefreshing] = useState(false);
  const [cache, setCache] = useState<DiscoveryCacheShape | null>(() => getDiscoveryCache());

  // Kick off a background refresh on mount (no-op when the cache is fresh,
  // when disabled, or in Privacy Mode's probe-skip path).
  useEffect(() => {
    if (!enabled) return;
    void refreshDiscoveredRelays().then(() => setCache(getDiscoveryCache()));
  }, [enabled]);

  const setDiscovery = useCallback((on: boolean): Promise<void> => {
    setRelayDiscoveryEnabled(on);
    setEnabled(on);
    if (!on) return Promise.resolve();
    setRefreshing(true);
    return refreshDiscoveredRelays(true)
      .then(() => setCache(getDiscoveryCache()))
      .finally(() => setRefreshing(false));
  }, []);

  const refresh = useCallback(async (): Promise<VerifiedRelay[]> => {
    setRefreshing(true);
    try {
      const relays = await refreshDiscoveredRelays(true);
      setCache(getDiscoveryCache());
      return relays;
    } finally {
      setRefreshing(false);
    }
  }, []);

  return {
    enabled,
    setDiscovery,
    refresh,
    refreshing,
    discoveredAt: cache?.fetchedAt,
    searchCount: (cache?.relays ?? []).filter((r) => r.nip50).length,
    indexCount: (cache?.relays ?? []).filter((r) => r.sip01).length,
  };
}

type DiscoveryCacheShape = ReturnType<typeof getDiscoveryCache>;

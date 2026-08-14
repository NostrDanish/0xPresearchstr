/**
 * Hook for managing the dynamic SearXNG instance pool.
 *
 * Exposes the ranked pool (custom → discovered → default), the discovery
 * opt-in toggle (off by default), discovery refresh state, and add/remove
 * actions for custom instances.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getInstancePool,
  getDiscoveredCache,
  isDiscoveryEnabled,
  setDiscoveryEnabled,
  refreshDiscoveredInstances,
  addCustomInstance,
  removeCustomInstance,
  toggleInstanceDisabled,
  type PoolInstance,
} from '@/lib/searxngInstances';

export function useSearxngInstances() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [discoveryOn, setDiscoveryOn] = useState(() => isDiscoveryEnabled());

  const { data: pool = [] } = useQuery<PoolInstance[]>({
    queryKey: ['searxng-instance-pool'],
    queryFn: () => getInstancePool(),
    staleTime: 10_000,
    refetchInterval: 30_000, // pick up health changes from searches
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['searxng-instance-pool'] });
  }, [queryClient]);

  // Trigger discovery on mount when enabled (no-op otherwise).
  useEffect(() => {
    if (discoveryOn) void refreshDiscoveredInstances().then(invalidate);
  }, [discoveryOn, invalidate]);

  /** Opt in/out of live discovery from searx.space. Enabling refreshes immediately. */
  const setDiscovery = useCallback((enabled: boolean) => {
    setDiscoveryEnabled(enabled);
    setDiscoveryOn(enabled);
    if (enabled) void refreshDiscoveredInstances(true);
    invalidate();
  }, [invalidate]);

  const refresh = useCallback(async () => {
    if (!discoveryOn) return; // nothing to refresh — discovery is opt-in
    setRefreshing(true);
    try {
      await refreshDiscoveredInstances(true);
    } finally {
      setRefreshing(false);
      invalidate();
    }
  }, [discoveryOn, invalidate]);

  const addInstance = useCallback((url: string): string | null => {
    const added = addCustomInstance(url);
    if (added) invalidate();
    return added;
  }, [invalidate]);

  const removeInstance = useCallback((url: string) => {
    removeCustomInstance(url);
    invalidate();
  }, [invalidate]);

  /** One-click enable/disable for any instance (custom, discovered, or seed). */
  const toggleInstance = useCallback((url: string): boolean => {
    const disabled = toggleInstanceDisabled(url);
    invalidate();
    return disabled;
  }, [invalidate]);

  const discoveredAt = getDiscoveredCache()?.fetchedAt;

  return {
    pool,
    refreshing,
    refresh,
    addInstance,
    removeInstance,
    toggleInstance,
    discoveredAt,
    discoveryOn,
    setDiscovery,
  };
}

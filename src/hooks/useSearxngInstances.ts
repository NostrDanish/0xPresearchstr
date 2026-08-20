/**
 * Hook for managing the dynamic SearXNG instance pool.
 *
 * Exposes the ranked pool (custom → discovered → seed bootstrap), the
 * discovery toggle (on by default), discovery refresh state, and add/remove
 * actions for custom instances. The pool is ordered language-aware when a
 * result language filter is set.
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
  toggleInstanceState,
  instanceState,
  type InstanceState,
  type PoolInstance,
} from '@/lib/searxngInstances';
import { useAppContext } from '@/hooks/useAppContext';

export function useSearxngInstances() {
  const queryClient = useQueryClient();
  const { config } = useAppContext();
  const [refreshing, setRefreshing] = useState(false);
  const [discoveryOn, setDiscoveryOn] = useState(() => isDiscoveryEnabled());
  const languageFilter = config.languageFilter;

  const { data: pool = [] } = useQuery<PoolInstance[]>({
    queryKey: ['searxng-instance-pool', languageFilter],
    queryFn: () => getInstancePool(languageFilter),
    staleTime: 10_000,
    refetchInterval: 30_000, // pick up health changes from searches
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['searxng-instance-pool'] });
  }, [queryClient]);

  // Trigger discovery on mount when enabled (the default). Errors keep the
  // old cache; the seed bootstrap covers the active set until then.
  useEffect(() => {
    if (discoveryOn) void refreshDiscoveredInstances().then(invalidate);
  }, [discoveryOn, invalidate]);

  /** Toggle live discovery from searx.space. Enabling refreshes immediately. */
  const setDiscovery = useCallback((enabled: boolean) => {
    setDiscoveryEnabled(enabled);
    setDiscoveryOn(enabled);
    if (enabled) void refreshDiscoveredInstances(true);
    invalidate();
  }, [invalidate]);

  const refresh = useCallback(async () => {
    if (!discoveryOn) return; // nothing to refresh — discovery is off
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

  /**
   * One-click power toggle for any instance. Direction depends on the
   * instance's computed state: active → disabled, standby → force-enabled,
   * disabled → natural. Returns the new state (for toast feedback).
   */
  const toggleInstance = useCallback((inst: PoolInstance): InstanceState => {
    const next = toggleInstanceState(inst);
    invalidate();
    return next;
  }, [invalidate]);

  const stateOf = useCallback((inst: PoolInstance): InstanceState => instanceState(inst), []);

  const discoveredAt = getDiscoveredCache()?.fetchedAt;

  return {
    pool,
    refreshing,
    refresh,
    addInstance,
    removeInstance,
    toggleInstance,
    stateOf,
    discoveredAt,
    discoveryOn,
    setDiscovery,
  };
}

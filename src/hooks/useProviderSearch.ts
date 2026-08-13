/**
 * Unified search hook — runs all providers in parallel, streams results, and auto-indexes.
 *
 * Each provider resolves independently so results appear incrementally:
 *   ✔ Nostr (124ms)
 *   ✔ Wikipedia (230ms)
 *   ⏳ SearXNG...
 *   ⏳ Hacker News...
 *
 * Returns per-provider status so the UI can show live progress indicators.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { SearchResult, SearchSource, ProviderSearchResponse } from '@/lib/providers/types';
import { getProvidersForPrivacy, getProvidersForSource } from '@/lib/providers/registry';
import { classifyQuery, providerAllowlistFor } from '@/lib/queryClassify';
import { isHiddenResult } from '@/lib/moderation';
import { useSearchIndexer } from '@/hooks/useSearchIndexer';
import { useModerationSet } from '@/hooks/useModeration';
import { useAppContext } from '@/hooks/useAppContext';

export type ProviderStatus = 'idle' | 'searching' | 'done' | 'error';

export interface ProviderState {
  id: string;
  name: string;
  source: SearchSource;
  status: ProviderStatus;
  resultCount: number;
  latencyMs?: number;
}

export interface UseProviderSearchOptions {
  query: string;
  source: SearchSource | 'all';
  enabled?: boolean;
}

export interface UseProviderSearchResult {
  /** All results from all providers, merged and sorted. */
  results: SearchResult[];
  /** Per-provider status for progress indicators. */
  providers: ProviderState[];
  /** Overall loading state (at least one provider still searching). */
  isLoading: boolean;
  /** At least one provider is fetching (initial or refetch). */
  isFetching: boolean;
  /** All providers finished but no results found. */
  isEmpty: boolean;
  /** Search suggestions from web providers. */
  suggestions: string[];
  /** Count of results per source category. */
  counts: Record<SearchSource | 'all', number>;
  /** Whether Privacy Mode is active (Nostr-tier providers only). */
  privacyMode: boolean;
  /** Providers blocked by Privacy Mode for the current source. */
  suppressedProviders: { id: string; name: string }[];
}

/**
 * The minimum Nostr results before we skip web providers (Nostr-first strategy).
 * When searching "all", if Nostr returns this many results, web/wiki/news are
 * still queried but Nostr results are shown immediately.
 */
const _NOSTR_ENOUGH = 8;

export function useProviderSearch({
  query,
  source,
  enabled = true,
}: UseProviderSearchOptions): UseProviderSearchResult {
  const queryClient = useQueryClient();
  const { config } = useAppContext();
  const privacyMode = config.privacyMode;
  const activeProviders = useMemo(() => {
    let providers = getProvidersForPrivacy(source, privacyMode);
    // User-disabled engines never run (Settings → Search Engines).
    if (config.disabledProviders.length > 0) {
      providers = providers.filter((p) => !config.disabledProviders.includes(p.id));
    }
    // Skip providers that can't possibly answer this query class
    // (a bare npub to SearXNG is pure waste + a privacy leak).
    const allowlist = providerAllowlistFor(classifyQuery(query));
    if (allowlist) providers = providers.filter((p) => allowlist.has(p.id));
    return providers;
  }, [source, privacyMode, query, config.disabledProviders]);
  /** Providers that exist for this source but are blocked by Privacy Mode. */
  const suppressedProviders = useMemo(() => {
    if (!privacyMode) return [];
    const active = new Set(activeProviders.map((p) => p.id));
    return getProvidersForSource(source).filter((p) => !active.has(p.id));
  }, [source, privacyMode, activeProviders]);
  const { indexResults } = useSearchIndexer();
  // Owner-signed moderation list — hidden URLs/event ids are filtered for everyone.
  const moderationSet = useModerationSet();

  // Provider states tracked outside React Query for per-provider granularity.
  const [providerStates, setProviderStates] = useState<Map<string, ProviderState>>(new Map());
  const statesRef = useRef(providerStates);
  statesRef.current = providerStates;

  // ─── Result streaming ──────────────────────────────────────────────
  // Results render as each provider resolves instead of waiting for the
  // slowest one (SearXNG via proxy can take seconds; the Nostr index
  // answers in ~100ms). The final complete set still lands in the query
  // cache as `data`.
  const [streamed, setStreamed] = useState<SearchResult[]>([]);
  const streamKey = `${query}||${source}||${privacyMode}`;
  const streamKeyRef = useRef(streamKey);
  if (streamKeyRef.current !== streamKey) {
    // Query changed — reset the stream before any new appends land.
    streamKeyRef.current = streamKey;
    setStreamed([]);
  }

  /** Append a provider's results to the visible stream (dedupe + rank). */
  const appendStreamed = useCallback((key: string, fresh: SearchResult[]) => {
    if (fresh.length === 0) return;
    setStreamed((prev) => {
      if (streamKeyRef.current !== key) return prev; // stale provider from an old query
      const merged = deduplicateResults([...prev, ...fresh]);
      merged.sort((a, b) => {
        const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
        if (Math.abs(scoreDiff) > 5) return scoreDiff;
        return (b.timestamp ?? 0) - (a.timestamp ?? 0);
      });
      return merged;
    });
  }, []);

  const updateProviderState = useCallback((id: string, update: Partial<ProviderState>) => {
    setProviderStates((prev) => {
      const next = new Map(prev);
      const existing = next.get(id);
      if (existing) {
        next.set(id, { ...existing, ...update });
      }
      return next;
    });
  }, []);

  // Main query — runs all providers in parallel.
  const { data, isFetching } = useQuery<{
    results: SearchResult[];
    suggestions: string[];
  }>({
    queryKey: ['provider-search', query, source, privacyMode],
    queryFn: async ({ signal }) => {
      if (!query.trim()) return { results: [], suggestions: [] };

      // Initialize provider states.
      const initialStates = new Map<string, ProviderState>();
      for (const p of activeProviders) {
        initialStates.set(p.id, {
          id: p.id,
          name: p.name,
          source: p.source,
          status: 'searching',
          resultCount: 0,
        });
      }
      setProviderStates(initialStates);

      // Run all providers in parallel.
      const results: SearchResult[] = [];
      const allSuggestions: string[] = [];

      const settled = await Promise.allSettled(
        activeProviders.map(async (provider) => {
          const start = performance.now();
          try {
            const response: ProviderSearchResponse = await provider.search({
              query: query.trim(),
              signal,
            });

            const latencyMs = Math.round(performance.now() - start);

            updateProviderState(provider.id, {
              status: 'done',
              resultCount: response.results.length,
              latencyMs,
            });

            // Stream: show this provider's results immediately — the UI
            // re-renders per provider completion, not at the very end.
            appendStreamed(streamKey, response.results);
            return response;
          } catch {
            const latencyMs = Math.round(performance.now() - start);
            updateProviderState(provider.id, {
              status: 'error',
              resultCount: 0,
              latencyMs,
            });
            return { results: [], suggestions: [] } as ProviderSearchResponse;
          }
        }),
      );

      for (const s of settled) {
        if (s.status === 'fulfilled') {
          results.push(...s.value.results);
          if (s.value.suggestions) allSuggestions.push(...s.value.suggestions);
        }
      }

      // Deduplicate by URL (prefer the result with the higher score).
      const deduped = deduplicateResults(results);

      // Sort by score descending, then by recency.
      deduped.sort((a, b) => {
        const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
        if (Math.abs(scoreDiff) > 5) return scoreDiff;
        return (b.timestamp ?? 0) - (a.timestamp ?? 0);
      });

      return {
        results: deduped,
        suggestions: [...new Set(allSuggestions)].slice(0, 8),
      };
    },
    enabled: enabled && query.trim().length > 0,
    staleTime: 30_000,
    retry: 0,
    // No placeholderData — a new query streams fresh results instead of
    // showing the previous query's stale set.
  });

  // The visible result set: the completed (cached) data once available,
  // the live stream while providers are still resolving.
  const baseResults = data?.results ?? streamed;

  // Apply owner-signed moderation filtering to whatever is visible.
  // (Additive: until the moderation list loads, nothing is filtered.)
  const allResults = useMemo(() => {
    if (!moderationSet) return baseResults;
    return baseResults.filter((r) => !isHiddenResult(r, moderationSet));
  }, [baseResults, moderationSet]);
  const suggestions = data?.suggestions ?? [];

  // Reset provider states when query clears.
  const providers = useMemo(() => {
    if (!query.trim()) return [];
    return activeProviders.map((p) => providerStates.get(p.id) ?? {
      id: p.id,
      name: p.name,
      source: p.source,
      status: 'idle' as const,
      resultCount: 0,
    });
  }, [activeProviders, providerStates, query]);

  const isLoading = providers.some((p) => p.status === 'searching');
  const isEmpty = query.trim().length > 0 && !isLoading && allResults.length === 0;

  // Auto-index: contribute surfaced pages (SIP-01 kind 39697) + a hashed
  // term signal (kind 30078, no plaintext) to the shared Nostr index.
  const indexedQueryRef = useRef('');
  useEffect(() => {
    if (
      allResults.length > 0 &&
      query.trim() &&
      !isLoading &&
      indexedQueryRef.current !== query
    ) {
      indexedQueryRef.current = query;
      void indexResults(query, allResults);
    }
  }, [allResults, query, isLoading, indexResults]);

  // Counts per source.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: allResults.length };
    for (const r of allResults) {
      c[r.source] = (c[r.source] ?? 0) + 1;
    }
    return c as Record<SearchSource | 'all', number>;
  }, [allResults]);

  // Invalidate stale queries when source changes.
  const prevSourceRef = useRef(source);
  if (prevSourceRef.current !== source) {
    prevSourceRef.current = source;
    if (query.trim()) {
      queryClient.invalidateQueries({ queryKey: ['provider-search', query, source] });
    }
  }

  return {
    results: allResults,
    providers,
    isLoading,
    isFetching,
    isEmpty,
    suggestions,
    counts,
    privacyMode,
    suppressedProviders,
  };
}

/** Deduplicate results by normalized URL. Prefer higher-scored versions. */
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>();

  for (const r of results) {
    const key = normalizeUrl(r.url) || r.id;
    const existing = map.get(key);
    if (!existing || (r.score ?? 0) > (existing.score ?? 0)) {
      map.set(key, r);
    }
  }

  return [...map.values()];
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

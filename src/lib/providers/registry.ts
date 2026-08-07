/**
 * Provider registry — central catalog of all search providers.
 *
 * Add a new provider:
 *   1. Create `src/lib/providers/my-provider.ts` implementing `SearchProvider`
 *   2. Import it here and add to the `ALL_PROVIDERS` array
 *   3. Done — the orchestrator picks it up automatically
 */
import type { SearchProvider, SearchSource } from './types';
import { cachedIndexProvider } from './cached-index';
import { nostrProvider } from './nostr';
import { communityProvider } from './community';
import { stakesProvider } from './stakes';
import { searxngProvider } from './searxng';
import { duckduckgoProvider } from './duckduckgo';
import { torProvider } from './tor';
import { wikipediaProvider } from './wikipedia';
import { hackerNewsProvider } from './hacker-news';
import { stackOverflowProvider } from './stackoverflow';

/**
 * All registered search providers, in priority order.
 *
 * The cached-index provider runs first — if the query was searched before,
 * results come from Nostr instantly. All other providers still run in parallel,
 * and their results get merged + deduped with the cache.
 */
export const ALL_PROVIDERS: SearchProvider[] = [
  cachedIndexProvider,
  nostrProvider,
  communityProvider,
  stakesProvider,
  searxngProvider,
  duckduckgoProvider,
  wikipediaProvider,
  hackerNewsProvider,
  stackOverflowProvider,
  torProvider,
];

/** Get providers that contribute to a given source tab. */
export function getProvidersForSource(source: SearchSource | 'all'): SearchProvider[] {
  if (source === 'all') return ALL_PROVIDERS;
  return ALL_PROVIDERS.filter((p) => p.source === source || p.additionalSources?.includes(source));
}

/**
 * Get providers filtered by Privacy Mode.
 * When `privacyOnly` is true, only Nostr-tier providers are returned —
 * no clearnet APIs, no CORS proxies, no third-party servers.
 */
export function getProvidersForPrivacy(
  source: SearchSource | 'all',
  privacyOnly: boolean,
): SearchProvider[] {
  const providers = getProvidersForSource(source);
  if (!privacyOnly) return providers;
  return providers.filter((p) => p.privacy === 'nostr');
}

/** Get a provider by ID. */
export function getProvider(id: string): SearchProvider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === id);
}

/** All unique source categories from registered providers. */
export function getAvailableSources(): SearchSource[] {
  const sources = new Set<SearchSource>();
  for (const p of ALL_PROVIDERS) sources.add(p.source);
  return [...sources];
}

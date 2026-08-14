/**
 * Provider registry — central catalog of all search providers.
 *
 * Add a new provider:
 *   1. Create `src/lib/providers/my-provider.ts` implementing `SearchProvider`
 *   2. Import it here and add to the `ALL_PROVIDERS` array
 *   3. Done — the orchestrator picks it up automatically
 */
import type { SearchProvider, SearchSource } from './types';
import { webIndexProvider } from './web-index';
import { cachedIndexProvider } from './cached-index';
import { nostrProvider } from './nostr';
import { communityProvider } from './community';
import { stakesProvider } from './stakes';
import { searxngProvider } from './searxng';
import { duckduckgoProvider } from './duckduckgo';
import { braveProvider } from './brave';
import { torProvider } from './tor';
import { wikipediaProvider } from './wikipedia';
import { hackerNewsProvider } from './hacker-news';
import { stackOverflowProvider } from './stackoverflow';
import { gitProvider } from './git';

/**
 * All registered search providers, in display/priority order.
 *
 * Web engines lead (SearXNG, DuckDuckGo, Brave), then the community index
 * (web-index + cached-index), then the rest. Everything runs in parallel —
 * order drives the provider-status chips and result streaming, not speed.
 */
export const ALL_PROVIDERS: SearchProvider[] = [
  searxngProvider,
  duckduckgoProvider,
  braveProvider,
  webIndexProvider,
  cachedIndexProvider,
  stakesProvider,
  communityProvider,
  nostrProvider,
  gitProvider,
  wikipediaProvider,
  hackerNewsProvider,
  stackOverflowProvider,
  torProvider,
];

/** Get providers that contribute to a given source tab. */
export function getProvidersForSource(source: SearchSource | 'all' | 'index' | 'i2p'): SearchProvider[] {
  if (source === 'all') return ALL_PROVIDERS;
  if (source === 'i2p') return []; // directory links only, no providers
  // The Index tab = the community index only (SIP-01 observations + legacy cache).
  if (source === 'index') {
    return ALL_PROVIDERS.filter((p) => p.id === 'web-index' || p.id === 'cached-index');
  }
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

/**
 * Search providers — barrel export.
 */
export type {
  SearchResult,
  SearchSource,
  SearchProvider,
  SearchOptions,
  ProviderSearchResponse,
} from './types';

export { cachedIndexProvider } from './cached-index';
export { nostrProvider } from './nostr';
export { stakesProvider } from './stakes';
export { searxngProvider } from './searxng';
export { duckduckgoProvider } from './duckduckgo';
export { torProvider } from './tor';
export { wikipediaProvider } from './wikipedia';
export { hackerNewsProvider } from './hacker-news';
export { stackOverflowProvider } from './stackoverflow';
export { ALL_PROVIDERS, getProvidersForSource, getProvider, getAvailableSources } from './registry';

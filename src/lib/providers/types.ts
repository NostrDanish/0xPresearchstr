/**
 * Universal search provider interface.
 *
 * Every provider — Nostr, SearXNG, Wikipedia, Hacker News, Tor, etc. —
 * implements the same `SearchProvider` interface and returns the same
 * `SearchResult[]`. The orchestrator merges, deduplicates, and ranks
 * results from all enabled providers.
 */

/** The source network / category a result came from. */
export type SearchSource =
  | 'nostr'
  | 'web'
  | 'wiki'
  | 'news'
  | 'code'
  | 'tor'
  | 'i2p';

/**
 * Privacy tier of a provider — who can see the user's query.
 *
 * - `nostr`:   Query goes over WebSocket to Nostr search relays. The relay
 *              operator sees the query text and your IP, but no account is
 *              linked (reads are unauthenticated). No third-party HTTP API,
 *              no CORS proxy.
 * - `direct`:  Query goes over HTTPS directly from the browser to a public
 *              API (Wikipedia, Hacker News, Stack Exchange). The API operator
 *              sees the query + IP. No proxy in between.
 * - `proxied`: Query is routed through a CORS proxy to reach the destination
 *              (SearXNG instances, DuckDuckGo HTML, Ahmia). The proxy sees the
 *              full request URL — including the query in plaintext — in
 *              addition to the destination service.
 */
export type PrivacyTier = 'nostr' | 'direct' | 'proxied';

/** A universal search result from any provider. */
export interface SearchResult {
  /** Unique key for deduplication. Usually a URL or event ID. */
  id: string;
  /** Display title. */
  title: string;
  /** URL to link to (can be a /:nip19 internal route for Nostr). */
  url: string;
  /** Short text snippet / description. */
  snippet: string;
  /** Source category for tab filtering and UI badges. */
  source: SearchSource;
  /** Provider ID that produced this result (e.g. 'nostr', 'searxng', 'wikipedia'). */
  provider: string;
  /** Unix timestamp of the result content (if known). */
  timestamp?: number;
  /** Author display name. */
  author?: string;
  /** Author avatar URL (sanitized). */
  authorAvatar?: string;
  /** Domain or relay hostname shown as breadcrumb. */
  domain?: string;
  /** Optional thumbnail / image URL. */
  thumbnail?: string;
  /** Sub-type label (e.g. "Profile", "Article", "Note", ".onion"). */
  kind?: string;
  /** Search engine / source name for attribution (e.g. "DuckDuckGo", "Wikipedia"). */
  engine?: string;
  /** Extra tags for rendering (hashtags, badges, etc.). */
  tags?: string[];
  /** Original Nostr event data if applicable. */
  nostrEvent?: import('@nostrify/nostrify').NostrEvent;
  /** Score used for ranking (higher = better). */
  score?: number;
}

/** Options passed to every provider search call. */
export interface SearchOptions {
  /** The user's search query. */
  query: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Maximum number of results to return. */
  limit?: number;
}

/** The result of a provider search call. */
export interface ProviderSearchResponse {
  /** The results returned by the provider. */
  results: SearchResult[];
  /** Optional search suggestions for related queries. */
  suggestions?: string[];
}

/** A search provider that can be registered with the orchestrator. */
export interface SearchProvider {
  /** Unique provider ID (e.g. 'nostr', 'searxng', 'wikipedia'). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Source category this provider contributes to. */
  source: SearchSource;
  /** Privacy tier — who can observe the query. Used by Privacy Mode. */
  privacy: PrivacyTier;
  /** Short, honest description of who sees the query (for the privacy popover). */
  privacyNote: string;
  /** Execute the search. */
  search(options: SearchOptions): Promise<ProviderSearchResponse>;
}

/**
 * Presearchstr Auto-Indexing Engine
 * (federated fork of the 0xSearchstr indexer — same protocol, shared index)
 *
 * Publishes search results to Nostr as the Presearchstr bot account.
 * Each unique search query becomes an addressable event (kind 30078)
 * with the d-tag set to a normalized query hash.
 *
 * The index grows with every search across every user. Next time
 * someone searches the same (or similar) query, results are read
 * from Nostr first — no external API call needed.
 *
 * ─── Federation ───────────────────────────────────────────────────
 * The protocol namespace (`0xsearchstr:cache:*` d-tags, `0xsearchstr`
 * t-tag, kind 30078) is SHARED with 0xSearchstr and every compatible
 * fork. Each app signs cache events with its own indexer key:
 *
 *   - 0xSearchstr bot:              12ad55ad…77d199
 *   - Presearchstr autosigner:    be7cad9a…c4289  (Cloudflare Worker service)
 *   - Presearchstr bot (legacy):  e34726cc…f84bca (embedded-key fallback)
 *
 * Readers trust ALL known indexer pubkeys (INDEXER_PUBKEYS), so a
 * cache write from any compatible client is a cache hit for every
 * other client. 0xSearchstr makes Presearch better; Presearchstr
 * makes 0xSearchstr better. Running your own fork? Add your own
 * indexer pubkey to the list and you join the same index.
 *
 * Event structure:
 *   kind: 30078 (application-specific data)
 *   d: "0xsearchstr:cache:<normalized-query>"
 *   content: JSON array of cached SearchResult objects
 *   tags:
 *     ["d", "0xsearchstr:cache:<normalized-query>"]
 *     ["t", "0xsearchstr"]
 *     ["t", "search-cache"]
 *     ["query", "<original query>"]
 *     ["cached_at", "<unix timestamp>"]
 *     ["result_count", "<number>"]
 *     ["alt", "Community search index cache for: <query>"]
 *
 * Security: Only events signed by keys in INDEXER_PUBKEYS are trusted.
 * Readers filter by authors: INDEXER_PUBKEYS to prevent cache poisoning.
 */

import type { SearchResult } from '@/lib/providers/types';

/** 0xSearchstr bot pubkey (hex) — the original indexer. */
export const SEARCHSTR_INDEX_PUBKEY = '12ad55ad1fdb918f5314c9e9a5cd135be9b746e6eee15fd871df131a5677d199';

/**
 * Presearchstr autosigner pubkey (hex) — this app's active indexer.
 * The private key lives only as a Cloudflare Worker secret; the signing
 * service runs in worker.ts (POST /api/index). See README "Autosigner Service".
 */
export const PRESEARCHSTR_INDEX_PUBKEY = 'be7cad9a8e47ab0adfc877a008aea17692c08c49c1a5a6d87ee79ca4370c4289';

/**
 * Presearchstr's first bot key (embedded nsec). Still trusted so
 * previously-published cache events remain valid, and used as the
 * last-resort fallback if the autosigner service is unreachable.
 */
export const PRESEARCHSTR_LEGACY_INDEX_PUBKEY = 'e34726ccb624f4bb6aebabdfd9a41f5e160ca97ba2ea13fad8f8ff29a7f84bca';

/**
 * Trusted indexer pubkeys. Cache events are only read from these authors.
 * All apps publish with the exact same schema, so their events are
 * interchangeable — this is what makes the index federated.
 */
export const INDEXER_PUBKEYS: string[] = [
  PRESEARCHSTR_INDEX_PUBKEY,
  SEARCHSTR_INDEX_PUBKEY,
  PRESEARCHSTR_LEGACY_INDEX_PUBKEY,
];

/** The kind used for cache events. */
export const INDEX_KIND = 30078;

/** Max age of cache entries before they're considered stale (24 hours). */
export const CACHE_MAX_AGE_SECONDS = 86400;

/** Min results to bother caching. */
const MIN_RESULTS_TO_CACHE = 3;

/** Max results to store in a single cache event (keep events reasonable). */
const MAX_CACHED_RESULTS = 30;

/** Normalize a query for use as a d-tag key. */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')      // collapse whitespace
    .replace(/[^\w\s-]/g, ''); // strip punctuation
}

/** Build the d-tag for a cache event. */
export function cacheDTag(query: string): string {
  return `0xsearchstr:cache:${normalizeQuery(query)}`;
}

/** Strip Nostr-specific fields from SearchResult before caching.
 * We don't cache nostrEvent (too large) or scores (recomputed on read). */
interface CachedResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  provider: string;
  timestamp?: number;
  author?: string;
  authorAvatar?: string;
  domain?: string;
  thumbnail?: string;
  kind?: string;
  engine?: string;
  tags?: string[];
}

/** Convert a SearchResult to a cacheable form. */
export function toCachedResult(r: SearchResult): CachedResult {
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    source: r.source,
    provider: r.provider,
    timestamp: r.timestamp,
    author: r.author,
    authorAvatar: r.authorAvatar,
    domain: r.domain,
    thumbnail: r.thumbnail,
    kind: r.kind,
    engine: r.engine,
    tags: r.tags,
  };
}

/** Convert cached data back to SearchResult with cache scores. */
export function fromCachedResult(r: CachedResult): SearchResult {
  return {
    ...r,
    source: r.source as SearchResult['source'],
    score: 90, // Cached results score between Nostr (100) and web (80)
  };
}

/**
 * Build the unsigned event for caching search results.
 * Returns null if results aren't worth caching.
 */
export function buildCacheEvent(
  query: string,
  results: SearchResult[],
): { kind: number; content: string; tags: string[][] } | null {
  // Don't cache if too few results or only Nostr-native results (those are already
  // on Nostr: Nostr source hits, community submissions, and keyword stakes are all
  // relay-native — caching them would duplicate them and strip their event context).
  const nonNostrResults = results.filter(
    (r) => r.source !== 'nostr' && r.provider !== 'keyword-stake' && r.provider !== 'community',
  );
  if (nonNostrResults.length < MIN_RESULTS_TO_CACHE) return null;

  const toCache = nonNostrResults
    .slice(0, MAX_CACHED_RESULTS)
    .map(toCachedResult);

  const now = Math.floor(Date.now() / 1000);
  const normalized = normalizeQuery(query);

  return {
    kind: INDEX_KIND,
    content: JSON.stringify(toCache),
    tags: [
      ['d', `0xsearchstr:cache:${normalized}`],
      ['t', '0xsearchstr'],
      ['t', 'search-cache'],
      ['query', query.trim()],
      ['cached_at', String(now)],
      ['result_count', String(toCache.length)],
      ['alt', `Community search index cache for: ${query.trim()}`],
    ],
  };
}

/**
 * Parse cached results from a kind 30078 event.
 * Returns null if the cache is stale or malformed.
 */
export function parseCacheEvent(event: { content: string; tags: string[][]; created_at: number }): {
  query: string;
  results: SearchResult[];
  cachedAt: number;
} | null {
  // Check staleness.
  const now = Math.floor(Date.now() / 1000);
  const cachedAtTag = event.tags.find(([n]) => n === 'cached_at')?.[1];
  const cachedAt = cachedAtTag ? parseInt(cachedAtTag, 10) : event.created_at;

  if (now - cachedAt > CACHE_MAX_AGE_SECONDS) return null;

  const queryTag = event.tags.find(([n]) => n === 'query')?.[1];
  if (!queryTag) return null;

  try {
    const cached = JSON.parse(event.content) as CachedResult[];
    if (!Array.isArray(cached)) return null;

    return {
      query: queryTag,
      results: cached.map(fromCachedResult),
      cachedAt,
    };
  } catch {
    return null;
  }
}

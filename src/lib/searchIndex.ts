/**
 * Presearchstr Legacy Query Cache (kind 30078) — READ-ONLY
 * (federated fork of the 0xSearchstr indexer — same protocol, shared index)
 *
 * Historical write path: each unique search query became an addressable
 * event (kind 30078) with the d-tag set to a normalized query hash, signed
 * by a trusted app indexer key. This app no longer publishes cache events
 * (the old signing service is retired) — SIP-01 document observations
 * (kind 39697, per-device identities) are the write path now. This module
 * remains so readers can still serve historical cache hits until they age
 * out (24h staleness window on read).
 *
 * ─── Federation ───────────────────────────────────────────────────
 * The protocol namespace (`0xsearchstr:cache:*` d-tags, `0xsearchstr`
 * t-tag, kind 30078) is SHARED with 0xSearchstr and every compatible
 * fork. Each app signs (or signed) cache events with its own indexer key:
 *
 *   - 0xSearchstr bot:                12ad55ad…77d199
 *   - Presearchstr legacy signer:     be7cad9a…c4289  (retired)
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
 * Presearchstr legacy cache signer pubkey (hex) — RETIRED.
 * This app no longer publishes kind 30078 cache events; the key stays in
 * the trust list so historical cache entries it signed remain readable
 * until they age out.
 */
export const PRESEARCHSTR_INDEX_PUBKEY = 'be7cad9a8e47ab0adfc877a008aea17692c08c49c1a5a6d87ee79ca4370c4289';

/**
 * Trusted indexer pubkeys. Cache events are only read from these authors.
 * All apps publish with the exact same schema, so their events are
 * interchangeable — this is what makes the index federated.
 *
 * SIP-01 (kind 39697) needs no key list at all — observations from any
 * per-device indexer are trusted, ranked by independent agreement.
 */
export const INDEXER_PUBKEYS: string[] = [
  PRESEARCHSTR_INDEX_PUBKEY,
  SEARCHSTR_INDEX_PUBKEY,
];

/** The kind used for cache events. */
export const INDEX_KIND = 30078;

/** Max age of cache entries before they're considered stale (24 hours). */
export const CACHE_MAX_AGE_SECONDS = 86400;

/** Normalize a query for use as a d-tag key. */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')      // collapse whitespace
    .replace(/[^\w\s-]/g, ''); // strip punctuation
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

/** Convert cached data back to SearchResult with cache scores. */
export function fromCachedResult(r: CachedResult): SearchResult {
  return {
    ...r,
    source: r.source as SearchResult['source'],
    // Just under the freshest organic results (SearXNG 80): the legacy cache
    // is a stale snapshot of someone else's search, so it should interleave
    // with organic results via the recency tie-band, not sit above them.
    score: 79,
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

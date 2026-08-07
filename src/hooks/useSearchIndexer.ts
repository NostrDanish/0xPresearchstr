/**
 * Auto-indexing hook — publishes search results to Nostr after each search.
 *
 * When a search completes with enough results, this hook publishes
 * a cache event (kind 30078) to Nostr under the 0xPresearchstr bot
 * account. The cache grows with every search across every user.
 *
 * The schema is identical to 0xSearchstr's (same kind, d-tag namespace,
 * t-tags) — only the signer is this app's own key. Readers on either
 * app trust both signers, so the index is one shared pool.
 *
 * Publishing is fire-and-forget with deduplication:
 * - Same query won't be published more than once per session
 * - Only non-Nostr results are cached (Nostr results are already on relays)
 * - Events are addressable (d-tag), so newer caches replace older ones
 */
import { useCallback, useRef } from 'react';
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { NRelay1 } from '@nostrify/nostrify';

import type { SearchResult } from '@/lib/providers/types';
import { buildCacheEvent, normalizeQuery } from '@/lib/searchIndex';

/**
 * 0xPresearchstr bot nsec (hex secret key).
 * This is the bot account — it's intentionally public.
 * The bot publishes cache events that anyone can read.
 * The nsec is embedded so the indexer works without user login.
 *
 * Bot profile: npub1a… (pubkey e34726cc…f84bca) — kind 0 published
 * at launch. Forks: replace this with your own key and add your
 * pubkey to INDEXER_PUBKEYS in src/lib/searchIndex.ts.
 */
const BOT_NSEC_HEX = 'e11a72e0ec3ba8a11e40c6d838fa36af541126ce85e709b60fe6f8b2eb34b4f4';

/** Relays to publish cache events to. */
const PUBLISH_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay.primal.net/',
  'wss://relay.damus.io/',
];

/** Relay connection cache. */
const relayCache = new Map<string, NRelay1>();
function getRelay(url: string): NRelay1 {
  let relay = relayCache.get(url);
  if (!relay) {
    relay = new NRelay1(url);
    relayCache.set(url, relay);
  }
  return relay;
}

/**
 * Hook: auto-indexes search results to Nostr.
 * Returns a function to call after search completes.
 */
export function useSearchIndexer() {
  // Track which queries we've already indexed this session.
  const indexedRef = useRef(new Set<string>());

  const indexResults = useCallback(async (query: string, results: SearchResult[]) => {
    if (!query.trim()) return;

    const normalized = normalizeQuery(query);

    // Skip if already indexed this session.
    if (indexedRef.current.has(normalized)) return;

    // Build the cache event.
    const eventData = buildCacheEvent(query, results);
    if (!eventData) return; // Not enough results to cache.

    // Mark as indexed immediately (optimistic).
    indexedRef.current.add(normalized);

    // Sign and publish in the background (fire-and-forget).
    try {
      const secretKey = hexToBytes(BOT_NSEC_HEX);
      const pubkey = bytesToHex(getPublicKey(secretKey));

      const unsignedEvent = {
        kind: eventData.kind,
        created_at: Math.floor(Date.now() / 1000),
        tags: eventData.tags,
        content: eventData.content,
        pubkey,
      };

      const signedEvent = finalizeEvent(unsignedEvent, secretKey);

      // Publish to all relays in parallel, don't await.
      void Promise.allSettled(
        PUBLISH_RELAYS.map(async (url) => {
          const relay = getRelay(url);
          await relay.event(signedEvent);
        }),
      );
    } catch {
      // Indexing failure is non-fatal — just means this query won't be cached.
      indexedRef.current.delete(normalized);
    }
  }, []);

  return { indexResults };
}

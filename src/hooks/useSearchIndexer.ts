/**
 * Auto-indexing hook — publishes search results to the federated Nostr
 * index after each search.
 *
 * Primary path: the autosigner service (worker.ts) — a Cloudflare Worker
 * holding the indexer key as a secret. It validates, rate-limits, signs
 * server-side, and publishes to the index relays. This is what makes the
 * built-in autosigner safe for multi-user public deployment: no key
 * material in the browser beyond the public legacy fallback.
 *
 * Fallback path: the legacy embedded bot key (also in INDEXER_PUBKEYS),
 * used when the service is unreachable (static hosting, preview, worker
 * down) so the shared index keeps growing either way.
 *
 * The schema is identical to 0xSearchstr's (same kind, d-tag namespace,
 * t-tags) — only the signer differs per app. Readers on either app trust
 * all indexer keys, so the index is one shared pool.
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
import { indexViaService } from '@/lib/indexerService';

/**
 * Legacy 0xPresearchstr bot nsec (hex secret key) — fallback signer.
 * Intentionally public: the bot only publishes cache events anyone can read.
 * Kept so indexing still works when the autosigner service is offline.
 */
const LEGACY_BOT_NSEC_HEX = 'e11a72e0ec3ba8a11e40c6d838fa36af541126ce85e709b60fe6f8b2eb34b4f4';

/** Relays the fallback path publishes cache events to. */
const PUBLISH_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay.primal.net/',
  'wss://relay.damus.io/',
];

/** Relay connection cache (fallback path). */
const relayCache = new Map<string, NRelay1>();
function getRelay(url: string): NRelay1 {
  let relay = relayCache.get(url);
  if (!relay) {
    relay = new NRelay1(url);
    relayCache.set(url, relay);
  }
  return relay;
}

/** Fallback: sign locally with the legacy embedded bot key + publish. */
async function signAndPublishLocally(eventData: { kind: number; content: string; tags: string[][] }) {
  const secretKey = hexToBytes(LEGACY_BOT_NSEC_HEX);
  const signedEvent = finalizeEvent(
    {
      kind: eventData.kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: eventData.tags,
      content: eventData.content,
      pubkey: bytesToHex(getPublicKey(secretKey)),
    },
    secretKey,
  );

  await Promise.allSettled(
    PUBLISH_RELAYS.map(async (url) => {
      const relay = getRelay(url);
      await relay.event(signedEvent);
    }),
  );
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

    // Build the cache payload (returns null when not worth caching).
    // Reused by the local fallback; the service rebuilds its own event
    // server-side from the minimal result fields.
    const eventData = buildCacheEvent(query, results);
    if (!eventData) return;

    // Mark as indexed immediately (optimistic).
    indexedRef.current.add(normalized);

    // Fire-and-forget in the background.
    void (async () => {
      // Primary: autosigner service.
      const serviceOk = await indexViaService(
        query,
        results
          .filter((r) => r.source !== 'nostr' && r.provider !== 'keyword-stake' && r.provider !== 'community')
          .slice(0, 30)
          .map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            source: r.source,
            provider: r.provider,
          })),
      );

      if (serviceOk) return;

      // Fallback: legacy embedded key.
      try {
        await signAndPublishLocally(eventData);
      } catch {
        // Indexing failure is non-fatal — just means this query won't be cached.
        indexedRef.current.delete(normalized);
      }
    })();
  }, []);

  return { indexResults };
}

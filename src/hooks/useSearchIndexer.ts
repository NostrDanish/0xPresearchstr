/**
 * Auto-indexing hook ("the autosigner") — publishes search results to Nostr
 * after each search.
 *
 * Signing happens via a NIP-46 remote signer (bunker — see
 * src/lib/autosigner.ts): the indexer's private key never ships with the app,
 * only its bunker:// connection URI. The remote signer can enforce policies
 * and rotate/revoke access without a redeploy.
 *
 * If the bunker is unreachable, we fall back to the legacy embedded bot key
 * (also in INDEXER_PUBKEYS) so the shared index keeps growing either way.
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
import { getBunkerSigner } from '@/lib/autosigner';

/**
 * Legacy 0xPresearchstr bot nsec (hex secret key) — fallback signer.
 * Intentionally public: the bot only publishes cache events anyone can read.
 * Kept so indexing still works when the bunker is offline.
 */
const LEGACY_BOT_NSEC_HEX = 'e11a72e0ec3ba8a11e40c6d838fa36af541126ce85e709b60fe6f8b2eb34b4f4';

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

/** Sign via the remote bunker, with a hard timeout (relays can hang). */
async function signWithBunker(template: { kind: number; content: string; tags: string[][] }) {
  const signer = await getBunkerSigner();
  return signer.signEvent({
    kind: template.kind,
    content: template.content,
    tags: template.tags,
    created_at: Math.floor(Date.now() / 1000),
  });
}

/** Fallback: sign locally with the legacy embedded bot key. */
function signWithLegacyKey(template: { kind: number; content: string; tags: string[][] }) {
  const secretKey = hexToBytes(LEGACY_BOT_NSEC_HEX);
  return finalizeEvent(
    {
      kind: template.kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: template.tags,
      content: template.content,
      pubkey: bytesToHex(getPublicKey(secretKey)),
    },
    secretKey,
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

    // Build the cache event.
    const eventData = buildCacheEvent(query, results);
    if (!eventData) return; // Not enough results to cache.

    // Mark as indexed immediately (optimistic).
    indexedRef.current.add(normalized);

    // Sign and publish in the background (fire-and-forget).
    void (async () => {
      try {
        // Primary path: NIP-46 remote signer (15s hard cap — bunker round-trips
        // cross multiple relays and can hang).
        const signedEvent = await Promise.race([
          signWithBunker(eventData),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Bunker signing timed out')), 15_000),
          ),
        ]);
        await publishAll(signedEvent);
      } catch (err) {
        console.warn('[indexer] Bunker signing failed, falling back to embedded key:', err);
        try {
          await publishAll(signWithLegacyKey(eventData));
        } catch {
          // Indexing failure is non-fatal — just means this query won't be cached.
          indexedRef.current.delete(normalized);
        }
      }
    })();
  }, []);

  return { indexResults };
}

/** Publish a signed event to all index relays in parallel. */
async function publishAll(signedEvent: Parameters<NRelay1['event']>[0]): Promise<void> {
  await Promise.allSettled(
    PUBLISH_RELAYS.map(async (url) => {
      const relay = getRelay(url);
      await relay.event(signedEvent);
    }),
  );
}

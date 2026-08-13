/**
 * Auto-indexing hook — contributes useful web results discovered during
 * searches to the shared Nostr web index (Search Index Protocol, SIP-01).
 *
 * What it publishes: one kind 39697 addressable event per unique URL,
 * containing only the page's public metadata (title, description, tags).
 *
 * What it NEVER publishes:
 *   - the search query (no query text, no correlation between user and URL);
 *   - the user's personal Nostr identity (events are signed by this device's
 *     dedicated indexing identity — see src/lib/indexerIdentity.ts);
 *   - Nostr-native results (they already live on relays).
 *
 * Every browser is an independent indexer — there is no central signing key.
 * Indexer keys are pseudonymous and replaceable; network observers may still
 * correlate IP/timing (key separation, not network anonymity — spec §16).
 *
 * Echo-loop prevention (canonical engine behavior): results that already came
 * OUT of the index (web-index / cached-index providers) are never re-indexed —
 * an observation claims this device surfaced the page from the open web, not
 * from the index itself.
 *
 * Legacy: the query→results cache (kind 30078) is READ-ONLY for this app —
 * we no longer publish it (the old signing service is retired), but the
 * cached-index provider still reads historical entries from trusted indexer
 * keys so older clients keep their warm cache. SIP-01 observations are signed
 * by the per-device identity and need no service at all.
 *
 * Trending: each successful text search also publishes a HASHED term signal
 * (kind 30078, `0xsearchstr:term:<sha256>` — never plaintext). A term's
 * plaintext is revealed only once TRENDING_THRESHOLD distinct devices have
 * signaled it, so rare or confidential queries never appear in public.
 */
import { useCallback, useRef } from 'react';
import { finalizeEvent } from 'nostr-tools/pure';
import { NRelay1, type NostrEvent } from '@nostrify/nostrify';

/* Local hex helpers — avoid bundler ambiguity around @noble/hashes subpath
 * resolution (the identity module does the same). */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

import type { SearchResult } from '@/lib/providers/types';
import { INDEX_KIND, normalizeQuery } from '@/lib/searchIndex';
import { getIndexerIdentity } from '@/lib/indexerIdentity';
import { buildIndexEvent, normalizeIndexUrl, observationFromResult } from '@/lib/webIndex';
import { classifyQuery } from '@/lib/queryClassify';
import {
  TERM_SIGNAL_D_PREFIX,
  TERM_REVEAL_D_PREFIX,
  TRENDING_THRESHOLD,
  buildTermSignalEvent,
  buildTermRevealEvent,
  hashTerm,
  parseTermReveal,
  parseTermSignal,
  verifyTermReveal,
} from '@/lib/termSignals';
import { getIndexRelayUrls } from '@/lib/appRelays';
import { useAppContext } from '@/hooks/useAppContext';

/** Max document observations published per search. */
const MAX_OBSERVATIONS_PER_SEARCH = 10;

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

/** Publish a signed event to the user's effective index relay pool (best-effort). */
async function publishEvent(signedEvent: NostrEvent) {
  await Promise.allSettled(
    getIndexRelayUrls().map(async (url) => {
      const relay = getRelay(url);
      // Bounded wait for the relay's OK — dead relays must not hang the pipeline.
      await relay.event(signedEvent, { signal: AbortSignal.timeout(5000) });
    }),
  );
}

/**
 * Hook: auto-indexes search results to Nostr.
 * Returns a function to call after search completes.
 */
export function useSearchIndexer() {
  const { config } = useAppContext();
  const autoIndex = config.autoIndex;
  // Track which URLs (documents) / terms (hashed signals) we've indexed this session.
  const indexedDocsRef = useRef(new Set<string>());
  const signaledTermsRef = useRef(new Set<string>());

  const indexResults = useCallback(async (query: string, results: SearchResult[]) => {
    if (!query.trim() || !autoIndex) return;

    /* Web document observations (SIP-01, device identity) */
    void (async () => {
      // Unique, indexable web URLs from this search — deduped by normalized URL.
      const seen = new Set<string>();
      const observations = [];
      for (const result of results) {
        // Nostr-native results live on relays already; indexing them would
        // duplicate and strip their event context. Index-sourced results
        // (web-index / cached-index) would be an echo loop — skip them too.
        if (
          result.source === 'nostr'
          || result.provider === 'keyword-stake'
          || result.provider === 'community'
          || result.provider === 'web-index'
          || result.provider === 'cached-index'
        ) {
          continue;
        }
        const normalized = normalizeIndexUrl(result.url);
        if (!normalized || seen.has(normalized) || indexedDocsRef.current.has(normalized)) continue;
        seen.add(normalized);

        const input = observationFromResult(result);
        if (!input) continue;
        observations.push(input);
        if (observations.length >= MAX_OBSERVATIONS_PER_SEARCH) break;
      }
      if (observations.length === 0) return;

      // Optimistically mark before async work so repeat searches don't republish.
      for (const input of observations) {
        const normalized = normalizeIndexUrl(input.url);
        if (normalized) indexedDocsRef.current.add(normalized);
      }

      const identity = getIndexerIdentity();
      const secretKey = hexToBytes(identity.secretHex);
      const pubkeyHex = identity.pubkeyHex;

      for (const input of observations) {
        try {
          const template = await buildIndexEvent(input);
          if (!template) continue;
          const signedEvent = finalizeEvent(
            {
              kind: template.kind,
              created_at: Math.floor(Date.now() / 1000),
              tags: template.tags,
              content: template.content,
              pubkey: pubkeyHex,
            },
            secretKey,
          );
          await publishEvent(signedEvent);
        } catch {
          // Indexing failure is non-fatal — unmark so a later search can retry.
          const normalized = normalizeIndexUrl(input.url);
          if (normalized) indexedDocsRef.current.delete(normalized);
        }
      }
    })();

    /* ---------------------------------------------------------- *
     * Trending term signal — hashed, k-anonymity (see termSignals.ts).
     * Publishes ONLY a one-way hash of the query. Plaintext is revealed
     * solely when TRENDING_THRESHOLD distinct devices have signaled the
     * same hash — rare/confidential queries never appear in plaintext.
     * ---------------------------------------------------------- */
    void (async () => {
      // Only plain-text queries are signaled — NIP-19 ids, NIP-05 addresses,
      // URLs, and math never leave the device even as a hash.
      if (classifyQuery(query) !== 'text') return;
      const normalized = normalizeQuery(query);
      if (!normalized || normalized.length > 200) return;
      if (signaledTermsRef.current.has(normalized)) return;
      signaledTermsRef.current.add(normalized);

      try {
        const hash = await hashTerm(normalized);
        const identity = getIndexerIdentity();
        const secretKey = hexToBytes(identity.secretHex);
        const now = Math.floor(Date.now() / 1000);

        // 1. Signal: one addressable event per device per term — hash only.
        const signal = buildTermSignalEvent(hash);
        await publishEvent(finalizeEvent(
          { ...signal, created_at: now, pubkey: identity.pubkeyHex },
          secretKey,
        ));

        // 2. Count distinct devices that signaled this same hash.
        const relays = getIndexRelayUrls();
        const counted = await Promise.allSettled(
          relays.map((url) =>
            getRelay(url).query(
              [{ kinds: [INDEX_KIND], '#d': [`${TERM_SIGNAL_D_PREFIX}${hash}`], limit: 100 }],
              { signal: AbortSignal.timeout(5000) },
            ),
          ),
        );
        const devices = new Set<string>([identity.pubkeyHex]);
        for (const r of counted) {
          if (r.status !== 'fulfilled') continue;
          for (const ev of r.value) {
            if (parseTermSignal(ev)) devices.add(ev.pubkey);
          }
        }
        if (devices.size < TRENDING_THRESHOLD) return; // stays hashed — by design

        // 3. Threshold crossed. This device knows the plaintext (its user just
        //    typed it), so it may reveal — unless a valid reveal already exists.
        const existing = await Promise.allSettled(
          relays.map((url) =>
            getRelay(url).query(
              [{ kinds: [INDEX_KIND], '#d': [`${TERM_REVEAL_D_PREFIX}${hash}`], limit: 5 }],
              { signal: AbortSignal.timeout(5000) },
            ),
          ),
        );
        for (const r of existing) {
          if (r.status !== 'fulfilled') continue;
          for (const ev of r.value) {
            const reveal = parseTermReveal(ev);
            if (reveal && (await verifyTermReveal(reveal.hash, reveal.term))) return; // already public
          }
        }

        const revealEvent = buildTermRevealEvent(hash, query);
        await publishEvent(finalizeEvent(
          { ...revealEvent, created_at: now, pubkey: identity.pubkeyHex },
          secretKey,
        ));
      } catch {
        // Signaling is best-effort — never let it break search.
      }
    })();
  }, [autoIndex]);

  return { indexResults };
}

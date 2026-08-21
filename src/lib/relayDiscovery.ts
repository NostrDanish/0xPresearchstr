/**
 * Search/index relay auto-discovery — find NIP-50 and SIP-01 capable relays
 * instead of relying on the hardcoded defaults alone.
 *
 * Two-phase, fully client-side:
 *
 *   1. CANDIDATES — NIP-66 relay announcements (kind 30166, addressable,
 *      `d` = relay URL, `N` tags = supported NIPs) are queried from the
 *      search pool with a `#N: ['50']` filter: relays that advertise NIP-50
 *      search. A small seed list of known search relays is always included
 *      so discovery works even on relays that store no 30166s.
 *
 *   2. VERIFICATION — every candidate's NIP-11 document is fetched (via the
 *      CORS proxy; relays serve it over HTTPS at the same host). A relay
 *      joins the DISCOVERED SEARCH tier only when `supported_nips` really
 *      contains 50, and the DISCOVERED INDEX tier when it advertises the
 *      SIP-01 `uncaged_index` block (spec §15). Announcements lie; documents
 *      don't (as much).
 *
 * Results are cached for 24h. Everything is additive: the hardcoded pools
 * keep working with zero discovered relays, and users can hide any
 * discovered relay like any default (Settings → Relays).
 *
 * Privacy: the NIP-66 query is ordinary Nostr-tier traffic. The NIP-11
 * probes go through the CORS proxy, so the whole verification phase is
 * SKIPPED while Privacy Mode is on ("no CORS proxy traffic" wins over
 * discovery); the NIP-66 phase still runs and candidates wait in limbo.
 */

import { queryRelayPool } from '@/lib/searchRelays';
import { proxiedFetch } from '@/lib/corsProxy';
import { SEARCH_RELAYS, normalizeRelayUrl } from '@/lib/appRelays';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** localStorage keys. */
const LS_DISCOVERED = '0xsearchstr:relay-discovery:verified';
const LS_DISCOVERY_ON = '0xsearchstr:relay-discovery:enabled';

/** How long a verified list stays fresh (24h). */
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

/** Cap on NIP-66 candidates probed per refresh (each probe = one proxy fetch). */
const MAX_CANDIDATES = 32;

/** Probe concurrency — polite to the proxy and the relays. */
const PROBE_BATCH = 8;

/** Max discovered relays that join an active pool. */
const MAX_DISCOVERED_SEARCH = 4;
const MAX_DISCOVERED_INDEX = 4;

/**
 * Known search-capable relays that are ALWAYS probed, even when no relay
 * in the bootstrap set stores NIP-66 announcements. (Defaults are excluded
 * at merge time — this list is for relays NOT already shipped.)
 */
const SEED_CANDIDATES = [
  'wss://nostr.wine/', // paid relay with a NIP-50 search API
];

/**
 * Bootstrap relays for the NIP-66 query (kind 30166). Big general-purpose
 * relays with good addressable-event coverage; the search defaults are
 * queried too (deduped).
 */
const NIP66_BOOTSTRAP = [
  'wss://relay.nostr.band/',
  'wss://relay.primal.net/',
  'wss://relay.damus.io/',
];

/* ------------------------------------------------------------------ */
/* Types + storage                                                     */
/* ------------------------------------------------------------------ */

export interface VerifiedRelay {
  url: string;
  /** NIP-11 `supported_nips` includes 50 → joins the search pool. */
  nip50: boolean;
  /** NIP-11 `uncaged_index.sip01 === true` → joins the SIP-01 index pool. */
  sip01: boolean;
  /** NIP-11 fetch round-trip (ms) — a weak liveness/latency signal. */
  latencyMs: number;
}

interface DiscoveryCache {
  relays: VerifiedRelay[];
  fetchedAt: number;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full/unavailable — discovery just won't persist.
  }
}

export function getDiscoveryCache(): DiscoveryCache | null {
  return readJson<DiscoveryCache>(LS_DISCOVERED);
}

/**
 * Whether relay auto-discovery is enabled. ON by default — it only ever
 * adds NIP-11-verified relays, and any of them can be hidden in Settings.
 */
export function isRelayDiscoveryEnabled(): boolean {
  return readJson<boolean>(LS_DISCOVERY_ON) !== false;
}

export function setRelayDiscoveryEnabled(enabled: boolean): void {
  writeJson(LS_DISCOVERY_ON, enabled);
}

/* ------------------------------------------------------------------ */
/* Phase 1 — NIP-66 candidates                                         */
/* ------------------------------------------------------------------ */

/**
 * Query the bootstrap relays for kind 30166 announcements advertising
 * NIP-50 (`#N: ['50']` — relays index all single-letter tags, NIP-01).
 * Returns normalized clearnet relay URLs from the `d` tags.
 */
async function fetchNip66Candidates(signal?: AbortSignal): Promise<string[]> {
  const bootstrap = [...new Set([...NIP66_BOOTSTRAP, ...SEARCH_RELAYS])];
  const perRelay = await queryRelayPool(
    bootstrap,
    [{ kinds: [30166], '#N': ['50'], limit: 200 }],
    { signal, timeoutMs: 6000 },
  );

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const events of perRelay) {
    for (const ev of events) {
      const d = ev.tags.find(([n]) => n === 'd')?.[1];
      if (!d) continue;
      // Skip non-clearnet transports (n tag: tor/i2p/loki) — a browser on
      // the clearnet can't dial them anyway.
      const network = ev.tags.find(([n]) => n === 'n')?.[1];
      if (network && network !== 'clearnet') continue;
      const url = normalizeRelayUrl(d);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      candidates.push(url);
    }
  }
  return candidates;
}

/* ------------------------------------------------------------------ */
/* Phase 2 — NIP-11 verification                                       */
/* ------------------------------------------------------------------ */

/** NIP-11 relay information document (the fields we read). */
interface RelayInfoDoc {
  supported_nips?: unknown;
  /** SIP-01 §15: index relays advertise their scope here. */
  uncaged_index?: { sip01?: unknown } | unknown;
}

/**
 * Probe one candidate's NIP-11 document. Returns the verified record, or
 * null when unreachable/not a relay. A relay counts as NIP-50-capable only
 * when its document says so.
 */
async function probeRelay(url: string, signal?: AbortSignal): Promise<VerifiedRelay | null> {
  const httpUrl = url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
  const start = performance.now();
  try {
    const res = await proxiedFetch(httpUrl, {
      signal,
      headers: { Accept: 'application/nostr+json' },
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as RelayInfoDoc;
    const nips = Array.isArray(doc.supported_nips) ? doc.supported_nips : [];
    const nip50 = nips.includes(50);
    const sip01 =
      typeof doc.uncaged_index === 'object' &&
      doc.uncaged_index !== null &&
      (doc.uncaged_index as { sip01?: unknown }).sip01 === true;
    if (!nip50 && !sip01) return null; // nothing we need — don't waste a slot
    return {
      url,
      nip50,
      sip01,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Refresh                                                             */
/* ------------------------------------------------------------------ */

let discoveryPromise: Promise<VerifiedRelay[]> | null = null;

/** Privacy Mode check — read the stored app config directly (tolerant). */
function isPrivacyModeOn(): boolean {
  try {
    const raw = localStorage.getItem('nostr:app-config');
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null &&
      (parsed as { privacyMode?: unknown }).privacyMode === true;
  } catch {
    return false;
  }
}

async function runDiscovery(signal?: AbortSignal): Promise<VerifiedRelay[]> {
  // Phase 1: candidates (Nostr-tier — fine in Privacy Mode).
  const nip66 = await fetchNip66Candidates(signal).catch(() => [] as string[]);
  const candidates = [...new Set([...SEED_CANDIDATES, ...nip66])].slice(0, MAX_CANDIDATES);

  // Phase 2: NIP-11 probes go through the CORS proxy — skipped entirely in
  // Privacy Mode. Candidates stay unverified until a non-private refresh.
  if (isPrivacyModeOn()) return getDiscoveryCache()?.relays ?? [];

  const verified: VerifiedRelay[] = [];
  for (let i = 0; i < candidates.length; i += PROBE_BATCH) {
    if (signal?.aborted) break;
    const batch = candidates.slice(i, i + PROBE_BATCH);
    const settled = await Promise.all(batch.map((url) => probeRelay(url, signal)));
    for (const v of settled) if (v) verified.push(v);
  }

  // Fastest first — the active-tier caps take from the top.
  verified.sort((a, b) => a.latencyMs - b.latencyMs);
  return verified;
}

/**
 * Refresh the verified relay list if stale. Fire-and-forget safe; errors
 * keep the old cache. No-op while discovery is disabled.
 */
export async function refreshDiscoveredRelays(force = false, signal?: AbortSignal): Promise<VerifiedRelay[]> {
  if (!isRelayDiscoveryEnabled()) return getDiscoveryCache()?.relays ?? [];

  const cache = getDiscoveryCache();
  if (!force && cache && Date.now() - cache.fetchedAt < DISCOVERY_TTL_MS) return cache.relays;

  if (!discoveryPromise) {
    discoveryPromise = runDiscovery(signal)
      .then((verified) => {
        // Only overwrite the cache with a non-empty sweep — an offline
        // moment must not wipe a healthy verified list.
        if (verified.length > 0) {
          writeJson(LS_DISCOVERED, { relays: verified, fetchedAt: Date.now() } satisfies DiscoveryCache);
        }
        return verified.length > 0 ? verified : (cache?.relays ?? []);
      })
      .catch(() => cache?.relays ?? [])
      .finally(() => {
        discoveryPromise = null;
      });
  }

  return discoveryPromise;
}

/* ------------------------------------------------------------------ */
/* Pool feeds                                                          */
/* ------------------------------------------------------------------ */

/**
 * Verified NIP-50 relays for the search pool (fastest first, capped).
 * Empty when discovery is off or nothing is verified yet.
 */
export function getDiscoveredSearchRelays(): string[] {
  if (!isRelayDiscoveryEnabled()) return [];
  return (getDiscoveryCache()?.relays ?? [])
    .filter((r) => r.nip50)
    .slice(0, MAX_DISCOVERED_SEARCH)
    .map((r) => r.url);
}

/**
 * Verified SIP-01 relays (`uncaged_index` block) for the index pool
 * (fastest first, capped).
 */
export function getDiscoveredIndexRelays(): string[] {
  if (!isRelayDiscoveryEnabled()) return [];
  return (getDiscoveryCache()?.relays ?? [])
    .filter((r) => r.sip01)
    .slice(0, MAX_DISCOVERED_INDEX)
    .map((r) => r.url);
}

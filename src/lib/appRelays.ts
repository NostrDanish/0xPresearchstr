import type { RelayMetadata } from '@/contexts/AppContext';

/**
 * App default relays. Used as the initial `relayMetadata` for new users and as
 * a fallback when the user has no NIP-65 relay list configured (e.g. during
 * nostrconnect handshakes before any user relays have been loaded).
 */
export const APP_RELAYS: RelayMetadata = {
  relays: [
    { url: 'wss://relay.ditto.pub/', read: true, write: true },
    { url: 'wss://relay.nostr.band/', read: true, write: false },
    { url: 'wss://relay.primal.net/', read: false, write: true },
    { url: 'wss://relay.damus.io/', read: false, write: true },
  ],
  updatedAt: 0,
};

/**
 * Relays that support NIP-50 search queries.
 * These are queried in parallel for every Nostr search.
 *
 * relay.nostr.band — the most comprehensive NIP-50 search relay
 * relay.ditto.pub — Ditto relay with search support
 * search.nos.today — NOS search relay
 * relay.noswhere.com — Noswhere relay with NIP-50
 */
export const SEARCH_RELAYS = [
  'wss://relay.nostr.band/',
  'wss://relay.ditto.pub/',
  'wss://search.nos.today/',
  'wss://relay.noswhere.com/',
];

/* ------------------------------------------------------------------ */
/* Custom search relays (user-managed, localStorage)                   */
/* ------------------------------------------------------------------ */

const LS_CUSTOM_SEARCH_RELAYS = '0xsearchstr:search-relays:custom';

function readCustomSearchRelays(): string[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_SEARCH_RELAYS);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

function writeCustomSearchRelays(urls: string[]): void {
  try {
    localStorage.setItem(LS_CUSTOM_SEARCH_RELAYS, JSON.stringify(urls));
  } catch {
    // Storage unavailable — non-fatal.
  }
}

/** Normalize a relay URL: wss only, with trailing slash (matches SEARCH_RELAYS style). */
export function normalizeRelayUrl(input: string): string | null {
  let url = input.trim();
  if (!url) return null;
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = `wss://${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return null;
    // Canonical form: origin + pathname, trailing slash on bare hosts.
    const path = parsed.pathname === '/' ? '/' : parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return null;
  }
}

/** Get the user's custom search relays. */
export function getCustomSearchRelays(): string[] {
  return readCustomSearchRelays();
}

/** Add a custom search relay. Returns the normalized URL, or null if invalid. */
export function addCustomSearchRelay(input: string): string | null {
  const normalized = normalizeRelayUrl(input);
  if (!normalized) return null;
  const current = readCustomSearchRelays();
  if (!current.includes(normalized) && !(SEARCH_RELAYS as readonly string[]).includes(normalized)) {
    writeCustomSearchRelays([...current, normalized]);
  }
  return normalized;
}

/** Remove a custom search relay (defaults can't be removed). */
export function removeCustomSearchRelay(url: string): void {
  writeCustomSearchRelays(readCustomSearchRelays().filter((u) => u !== url));
}

/**
 * The effective search relay pool: 0xSearchstr's default NIP-50 relays
 * first, then the user's custom relays (deduped).
 */
export function getSearchRelayUrls(): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const url of [...SEARCH_RELAYS, ...readCustomSearchRelays()]) {
    if (!seen.has(url)) {
      seen.add(url);
      pool.push(url);
    }
  }
  return pool;
}

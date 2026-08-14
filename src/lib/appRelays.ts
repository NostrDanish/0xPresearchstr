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
 * Index relays (SIP-01 crawler/indexer pool).
 *
 * This is where the community index lives: SIP-01 web-index observations
 * (kind 39697), the legacy query cache (kind 30078), community submissions,
 * and keyword stakes are published to AND read from these relays. Every
 * browser running the app is a crawler node — this is its default peer list.
 *
 * Users can extend the pool with custom relays and hide any default in
 * Settings → Index Relays.
 *
 * Note: the .onion entry only connects for users on Tor (or a local Tor
 * proxy); elsewhere it fails fast and silently. It exists so the index is
 * reachable without clearnet exit points.
 */
export const INDEX_RELAYS = [
  'wss://relay-na1.metanomalist.com/',
  'wss://relay.ditto.pub/',
  'wss://jskitty.cat/nostr',
  'ws://acuy3mjnv26tkyaaucndlxmg2ocntz4rtebhavk57vgruozm42iaznqd.onion/',
  'wss://search.nos.today/',
  'wss://relay.primal.net/',
  'wss://nostr.hifish.org/',
];

/**
 * GRASP / ngit relay pool (NIP-34 git collaboration) — READ-ONLY.
 *
 * Read by the git provider for the Code tab: repository announcements
 * (kind 30617), issues (1621), PRs (1618), and patches (1617). Nothing is
 * published here — the app has no git write path. The index.ngit.dev /
 * index.hzrd149.com / indexer.coracle.social indexers answer NIP-50-style
 * search; the GRASP servers return recent events that we filter client-side.
 */
export const GIT_RELAYS = [
  'wss://ngit.danconwaydev.com/',
  'wss://gitnostr.com/',
  'wss://relay.ngit.dev/',
  'wss://indexer.coracle.social/',
  'wss://index.hzrd149.com/',
  'wss://index.ngit.dev/',
  'wss://git.iris.to/',
];

/**
 * Relays that support NIP-50 search queries (read-only full-text pool).
 * These are queried in parallel for every Nostr search.
 * Users can add customs and hide defaults in Settings → Search Relays.
 *
 * relay.nostr.band — the most comprehensive NIP-50 search relay
 * relay.ditto.pub — Ditto relay with search support
 * relay-na1.metanomalist.com — Ditto/OpenSearch index relay (NIP-50 + NIP-77)
 * search.nos.today — NOS search relay
 * relay.noswhere.com — Noswhere relay with NIP-50
 */
export const SEARCH_RELAYS = [
  'wss://relay.nostr.band/',
  'wss://relay.ditto.pub/',
  'wss://relay-na1.metanomalist.com/',
  'wss://search.nos.today/',
  'wss://relay.noswhere.com/',
];

/* ------------------------------------------------------------------ */
/* Pool customization (user-managed, localStorage)                     */
/* ------------------------------------------------------------------ */

const LS_CUSTOM_SEARCH_RELAYS = '0xsearchstr:search-relays:custom';
const LS_HIDDEN_SEARCH_RELAYS = '0xsearchstr:search-relays:hidden';
const LS_CUSTOM_INDEX_RELAYS = '0xsearchstr:index-relays:custom';
const LS_HIDDEN_INDEX_RELAYS = '0xsearchstr:index-relays:hidden';

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, urls: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(urls));
  } catch {
    // Storage unavailable — non-fatal.
  }
}

/** Normalize a relay URL: ws/wss only, with trailing slash on bare hosts. */
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

/** Effective pool: defaults minus hidden, then customs (deduped). */
function effectivePool(defaults: readonly string[], customKey: string, hiddenKey: string): string[] {
  const hidden = new Set(readList(hiddenKey));
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const url of [...defaults, ...readList(customKey)]) {
    if (hidden.has(url) || seen.has(url)) continue;
    seen.add(url);
    pool.push(url);
  }
  return pool;
}

/* Search relay pool (NIP-50 reads) */

export function getCustomSearchRelays(): string[] {
  return readList(LS_CUSTOM_SEARCH_RELAYS);
}

export function getHiddenSearchRelays(): string[] {
  return readList(LS_HIDDEN_SEARCH_RELAYS);
}

/** Add a custom search relay. Returns the normalized URL, or null if invalid. */
export function addCustomSearchRelay(input: string): string | null {
  const normalized = normalizeRelayUrl(input);
  if (!normalized) return null;
  const current = readList(LS_CUSTOM_SEARCH_RELAYS);
  if (!current.includes(normalized)) {
    writeList(LS_CUSTOM_SEARCH_RELAYS, [...current, normalized]);
  }
  // Re-adding a hidden default un-hides it.
  if ((SEARCH_RELAYS as readonly string[]).includes(normalized)) {
    restoreDefaultSearchRelay(normalized);
  }
  return normalized;
}

/** Remove a custom search relay. */
export function removeCustomSearchRelay(url: string): void {
  writeList(LS_CUSTOM_SEARCH_RELAYS, readList(LS_CUSTOM_SEARCH_RELAYS).filter((u) => u !== url));
}

/** Hide a default search relay (user override — restorable). */
export function hideDefaultSearchRelay(url: string): void {
  const hidden = readList(LS_HIDDEN_SEARCH_RELAYS);
  if (!hidden.includes(url)) writeList(LS_HIDDEN_SEARCH_RELAYS, [...hidden, url]);
}

/** Restore a previously hidden default search relay. */
export function restoreDefaultSearchRelay(url: string): void {
  writeList(LS_HIDDEN_SEARCH_RELAYS, readList(LS_HIDDEN_SEARCH_RELAYS).filter((u) => u !== url));
}

/** Restore all hidden default search relays. */
export function restoreAllDefaultSearchRelays(): void {
  writeList(LS_HIDDEN_SEARCH_RELAYS, []);
}

/**
 * The effective search relay pool: default NIP-50 relays (minus hidden),
 * then the user's custom relays (deduped).
 */
export function getSearchRelayUrls(): string[] {
  return effectivePool(SEARCH_RELAYS, LS_CUSTOM_SEARCH_RELAYS, LS_HIDDEN_SEARCH_RELAYS);
}

/* Index relay pool (SIP-01 reads + writes) */

export function getCustomIndexRelays(): string[] {
  return readList(LS_CUSTOM_INDEX_RELAYS);
}

export function getHiddenIndexRelays(): string[] {
  return readList(LS_HIDDEN_INDEX_RELAYS);
}

/** Add a custom index relay. Returns the normalized URL, or null if invalid. */
export function addCustomIndexRelay(input: string): string | null {
  const normalized = normalizeRelayUrl(input);
  if (!normalized) return null;
  const current = readList(LS_CUSTOM_INDEX_RELAYS);
  if (!current.includes(normalized)) {
    writeList(LS_CUSTOM_INDEX_RELAYS, [...current, normalized]);
  }
  if ((INDEX_RELAYS as readonly string[]).includes(normalized)) {
    restoreDefaultIndexRelay(normalized);
  }
  return normalized;
}

/** Remove a custom index relay. */
export function removeCustomIndexRelay(url: string): void {
  writeList(LS_CUSTOM_INDEX_RELAYS, readList(LS_CUSTOM_INDEX_RELAYS).filter((u) => u !== url));
}

/** Hide a default index relay (user override — restorable). */
export function hideDefaultIndexRelay(url: string): void {
  const hidden = readList(LS_HIDDEN_INDEX_RELAYS);
  if (!hidden.includes(url)) writeList(LS_HIDDEN_INDEX_RELAYS, [...hidden, url]);
}

/** Restore a previously hidden default index relay. */
export function restoreDefaultIndexRelay(url: string): void {
  writeList(LS_HIDDEN_INDEX_RELAYS, readList(LS_HIDDEN_INDEX_RELAYS).filter((u) => u !== url));
}

/** Restore all hidden default index relays. */
export function restoreAllDefaultIndexRelays(): void {
  writeList(LS_HIDDEN_INDEX_RELAYS, []);
}

/**
 * The effective index relay pool: default SIP-01 index relays (minus hidden),
 * then the user's custom index relays (deduped). Indexing writes AND reads
 * (SIP-01 observations, legacy cache, community submissions, keyword stakes)
 * all use this pool so writes land where reads happen.
 */
export function getIndexRelayUrls(): string[] {
  return effectivePool(INDEX_RELAYS, LS_CUSTOM_INDEX_RELAYS, LS_HIDDEN_INDEX_RELAYS);
}

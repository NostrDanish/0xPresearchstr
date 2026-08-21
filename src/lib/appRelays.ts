import type { RelayMetadata } from '@/contexts/AppContext';
import { getDiscoveredSearchRelays, getDiscoveredIndexRelays } from '@/lib/relayDiscovery';

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
 */
export const INDEX_RELAYS = [
  'wss://relay-na1.metanomalist.com/',
  'wss://relay.ditto.pub/',
  // The UNCAGED SIP relay cluster — serverless SIP-01 index relays
  // (Cloudflare Workers + D1; NIP-50 + NIP-45 + NIP-77, kind 39697 native).
  'wss://test-sip-relay.sip-01test.workers.dev/',
  'wss://sip-relay-2.sip-booster-relay.workers.dev/',
  'wss://sip-relay-3.uncaged-sip.workers.dev/',
  'wss://sip-relay-4.sip-relay-4.workers.dev/',
  'wss://jskitty.cat/nostr',
  'wss://search.nos.today/',
  'wss://relay.primal.net/',
];

/**
 * GRASP / ngit relay pool (NIP-34 git collaboration) — READ-ONLY.
 *
 * Read by the git provider for the Code tab: repository announcements
 * (kind 30617), issues (1621), PRs (1618), and patches (1617). Nothing is
 * published here — the app has no git write path. The index.ngit.dev /
 * index.hzrd149.com / indexer.coracle.social indexers answer NIP-50-style
 * search; the GRASP servers return recent events that we filter client-side.
 *
 * Users can extend the pool with custom relays and hide any default in
 * Settings → Git Relays.
 */
export const GIT_RELAYS = [
  'wss://ngit.danconwaydev.com/',
  'wss://gitnostr.com/',
  'wss://relay.ngit.dev/',
  'wss://indexer.coracle.social/',
  'wss://index.ngit.dev/',
  'wss://git.shakespeare.diy/',
];

/**
 * Wiki relay pool (NIP-54 articles) — READ-ONLY.
 *
 * Where Nostr-native wiki content (kind 30818) actually lives. Defaults are
 * the relay set wikistr (fiatjaf's wiki client) reads:
 * relay.wikifreedia.xyz backs Wikifreedia, the largest NIP-54 corpus;
 * nostr.wine / nostr21.com / relay.nostr.band are wikistr's other sources.
 *
 * Users can extend the pool and hide defaults in Settings → Wiki Relays.
 */
export const WIKI_RELAYS = [
  'wss://relay.wikifreedia.xyz/',
  'wss://nostr.wine/',
  'wss://nostr21.com/',
];

/**
 * Relays that support NIP-50 search queries (read-only full-text pool).
 * These are queried in parallel for every Nostr search.
 * Users can add customs and hide defaults in Settings → Search Relays.
 * Auto-discovery (relayDiscovery.ts) appends NIP-11-verified NIP-50 relays.
 *
 * relay.ditto.pub — Ditto relay with search support
 * relay-na1.metanomalist.com — Ditto/OpenSearch index relay (NIP-50 + NIP-77)
 * the UNCAGED SIP cluster — serverless SIP-01 index relays (NIP-50 over the
 *   kind 39697 document index, incl. web operators)
 * relay.nostr.band — nostr.band's relay, the original NIP-50 home
 * search.nos.today — NOS search relay
 * relay.noswhere.com — Noswhere relay with NIP-50 (incl. extensions)
 * relay.pocketnostr.com — Pocket Nostr relay with NIP-50
 */
export const SEARCH_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay-na1.metanomalist.com/',
  // The UNCAGED SIP relay cluster answers NIP-50 over the SIP-01 document
  // index directly (web operators: site:, lang:, after:, …).
  'wss://test-sip-relay.sip-01test.workers.dev/',
  'wss://sip-relay-2.sip-booster-relay.workers.dev/',
  'wss://sip-relay-3.uncaged-sip.workers.dev/',
  'wss://sip-relay-4.sip-relay-4.workers.dev/',
  'wss://relay.nostr.band/',
  'wss://search.nos.today/',
  'wss://relay.noswhere.com/',
  'wss://relay.pocketnostr.com/',
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

/**
 * Upgrade ws:// → wss:// when the page itself is HTTPS.
 *
 * Browsers throw a SYNCHRONOUS SecurityError when constructing a ws://
 * WebSocket from an https page — one insecure relay URL in a NIP-65 list
 * can kill a whole connection fan-out (or a NIP-46 handshake) outright.
 * Upgrading preserves intent: nearly every relay host serves TLS on the
 * same address, and one that doesn't simply fails to connect (graceful,
 * async) instead of throwing.
 */
export function toSecureRelayUrl(url: string): string {
  if (typeof location !== 'undefined' && location.protocol === 'https:') {
    return url.replace(/^ws:\/\//i, 'wss://');
  }
  return url;
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

/** Effective pool: defaults minus hidden, then discovered, then customs (deduped). */
function effectivePool(
  defaults: readonly string[],
  customKey: string,
  hiddenKey: string,
  discovered: readonly string[] = [],
): string[] {
  const hidden = new Set(readList(hiddenKey));
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const url of [...defaults, ...discovered, ...readList(customKey)]) {
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
 * then NIP-11-verified discovered relays (relayDiscovery.ts — relays that
 * provably advertise NIP-50), then the user's custom relays (deduped).
 */
export function getSearchRelayUrls(): string[] {
  return effectivePool(
    SEARCH_RELAYS,
    LS_CUSTOM_SEARCH_RELAYS,
    LS_HIDDEN_SEARCH_RELAYS,
    getDiscoveredSearchRelays(),
  );
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
 * then NIP-11-verified SIP-01 relays discovered via relayDiscovery.ts
 * (relays advertising the `uncaged_index` block), then the user's custom
 * relays (deduped). Indexing writes AND reads (SIP-01 observations, legacy
 * cache, community submissions, keyword stakes) all use this pool so writes
 * land where reads happen.
 */
export function getIndexRelayUrls(): string[] {
  return effectivePool(
    INDEX_RELAYS,
    LS_CUSTOM_INDEX_RELAYS,
    LS_HIDDEN_INDEX_RELAYS,
    getDiscoveredIndexRelays(),
  );
}

/* ------------------------------------------------------------------ */
/* Read-only satellite pools (git + wiki) — generic factory            */
/* ------------------------------------------------------------------ */

/** One editable read-only pool: defaults (hideable) + user customs. */
function makePool(defaults: readonly string[], customKey: string, hiddenKey: string) {
  return {
    getCustoms: (): string[] => readList(customKey),
    getHidden: (): string[] => readList(hiddenKey),
    addCustom: (input: string): string | null => {
      const normalized = normalizeRelayUrl(input);
      if (!normalized) return null;
      const current = readList(customKey);
      if (!current.includes(normalized)) writeList(customKey, [...current, normalized]);
      // Re-adding a hidden default un-hides it.
      if (defaults.includes(normalized)) {
        writeList(hiddenKey, readList(hiddenKey).filter((u) => u !== normalized));
      }
      return normalized;
    },
    removeCustom: (url: string): void => {
      writeList(customKey, readList(customKey).filter((u) => u !== url));
    },
    hideDefault: (url: string): void => {
      const hidden = readList(hiddenKey);
      if (!hidden.includes(url)) writeList(hiddenKey, [...hidden, url]);
    },
    restoreDefault: (url: string): void => {
      writeList(hiddenKey, readList(hiddenKey).filter((u) => u !== url));
    },
    restoreAllDefaults: (): void => writeList(hiddenKey, []),
    /** Effective pool: defaults minus hidden, then customs (deduped). */
    getUrls: (): string[] => effectivePool(defaults, customKey, hiddenKey),
  };
}

const gitPool = makePool(
  GIT_RELAYS,
  '0xsearchstr:git-relays:custom',
  '0xsearchstr:git-relays:hidden',
);

const wikiPool = makePool(
  WIKI_RELAYS,
  '0xsearchstr:wiki-relays:custom',
  '0xsearchstr:wiki-relays:hidden',
);

/** Git relay pool (NIP-34 reads for the Code tab). Read-only. */
export const gitRelays = gitPool;
/** Wiki relay pool (NIP-54 article reads). Read-only. */
export const wikiRelays = wikiPool;

/** Effective git relay URLs (defaults − hidden + customs). */
export function getGitRelayUrls(): string[] {
  return gitPool.getUrls();
}

/** Effective wiki relay URLs (defaults − hidden + customs). */
export function getWikiRelayUrls(): string[] {
  return wikiPool.getUrls();
}

/**
 * APP_PROFILE — the single source of truth for this engine's identity.
 *
 * The rule that keeps the SIP-01 fork family healthy:
 *
 *   PROTOCOL data (shared, federated, cross-engine by design)
 *     — SIP-01 observations (kind 39697), the fork-family query cache,
 *       keyword stakes, community submissions, term signals
 *   APPLICATION data (this engine only)
 *     — moderation labels, abuse inbox, role lists, settings, AI config
 *
 * Application data lives in the `presearchstr` namespace. The legacy
 * `0xsearchstr.*` control namespaces (fork heritage) remain READ-ONLY
 * compatibility inputs — documented, never written (see NIP.md).
 *
 * Forking this app? Edit THIS file (and the owner pubkey in
 * moderation.ts) — nothing else carries the identity.
 */

export const APP_PROFILE = {
  appId: 'presearchstr',
  appName: 'Presearchstr',
  namespace: 'presearchstr',
  tagline: 'The community-driven search engine. Nostr first, web when needed.',

  sip: {
    protocol: 'SIP-01',
    kind: 39697,
    spec: 'https://github.com/NostrDanish/SIP-01',
  },

  /** SIP-01 `source` tag — this engine's indexer software id. */
  indexerSource: 'presearchstr-web/1',

  /**
   * Application-specific control namespaces — THIS engine's Nostr control
   * plane. Never shared with another engine; the owner/role-list trust
   * anchor is per-app (moderation.ts).
   */
  control: {
    /** NIP-32 label namespace for team moderation actions (kind 1985). */
    moderationNs: 'presearchstr.moderation',
    /** NIP-32 label namespace for abuse reports (kind 1984). */
    abuseNs: 'presearchstr.abuse',
    /** Owner-signed role lists (kind 30078 d-tags). */
    adminRolesDTag: 'presearchstr:admin-roles',
    modRolesDTag: 'presearchstr:mod-roles',
    rolesTTag: 'presearchstr-roles',
  },

  /**
   * Legacy fork-heritage control namespaces — READ-ONLY compatibility.
   * Presearchstr once wrote moderation labels and received abuse reports
   * under these; existing events stay readable, new writes use the
   * `presearchstr.*` namespaces above.
   */
  legacyControl: {
    moderationNs: '0xsearchstr.moderation',
    abuseNs: '0xsearchstr.abuse',
  },

  /**
   * Shared fork-family FEDERATION namespaces — PROTOCOL data, shared with
   * 0xSearchstr and every compatible client BY DESIGN (that federation is
   * the product: one index, many frontends). Not application state.
   */
  federation: {
    cacheDPrefix: '0xsearchstr:cache:',
    stakeDPrefix: '0xsearchstr:stake:',
    submitDPrefix: '0xsearchstr:submit:',
    termDPrefix: '0xsearchstr:term:',
    termRevealDPrefix: '0xsearchstr:term-reveal:',
  },

  features: {
    aiAnswers: true,
    keywordStakes: true,
    voting: true,
    reports: true,
    autoIndex: true,
    relayDiscovery: true,
    references: false, // no referral/affiliate surface in this engine
  },
} as const;

export type AppProfile = typeof APP_PROFILE;

/* ------------------------------------------------------------------ */
/* localStorage namespace migration (fork heritage → this app)          */
/* ------------------------------------------------------------------ */

/**
 * localStorage keys moved from the fork-heritage `0xsearchstr:*` namespace
 * to this app's `presearchstr:*` namespace. Migration is lossless: the old
 * value is copied once, then removed. (localStorage is per-origin, so these
 * were never actually shared with 0xSearchstr — the rename is pure hygiene.)
 */
const LS_MIGRATIONS: [oldKey: string, newKey: string][] = [
  ['0xsearchstr:search-relays:custom', 'presearchstr:search-relays:custom'],
  ['0xsearchstr:search-relays:hidden', 'presearchstr:search-relays:hidden'],
  ['0xsearchstr:index-relays:custom', 'presearchstr:index-relays:custom'],
  ['0xsearchstr:index-relays:hidden', 'presearchstr:index-relays:hidden'],
  ['0xsearchstr:git-relays:custom', 'presearchstr:git-relays:custom'],
  ['0xsearchstr:git-relays:hidden', 'presearchstr:git-relays:hidden'],
  ['0xsearchstr:wiki-relays:custom', 'presearchstr:wiki-relays:custom'],
  ['0xsearchstr:wiki-relays:hidden', 'presearchstr:wiki-relays:hidden'],
  ['0xsearchstr:searxng:discovered', 'presearchstr:searxng:discovered'],
  ['0xsearchstr:searxng:custom', 'presearchstr:searxng:custom'],
  ['0xsearchstr:searxng:health', 'presearchstr:searxng:health'],
  ['0xsearchstr:searxng:disabled', 'presearchstr:searxng:disabled'],
  ['0xsearchstr:searxng:extras', 'presearchstr:searxng:extras'],
  ['0xsearchstr:searxng:discovery', 'presearchstr:searxng:discovery'],
  ['0xsearchstr:relay-discovery:verified', 'presearchstr:relay-discovery:verified'],
  ['0xsearchstr:relay-discovery:enabled', 'presearchstr:relay-discovery:enabled'],
];

function migrateLsKey(oldKey: string, newKey: string): void {
  try {
    const old = localStorage.getItem(oldKey);
    if (old !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, old);
    }
    if (old !== null) localStorage.removeItem(oldKey);
  } catch {
    // Storage unavailable — nothing to migrate.
  }
}

// Run at module load — appProfile is a leaf module imported by every
// settings/pool module, so the migration lands before any key is read.
for (const [oldKey, newKey] of LS_MIGRATIONS) migrateLsKey(oldKey, newKey);

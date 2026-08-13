/**
 * Moderation — owner-signed result filtering (NIP-32 labels + NIP-09 deletes).
 *
 * The owner key publishes kind 1985 label events marking results as hidden:
 *
 *   ["L", "0xsearchstr.moderation"]            ← namespace
 *   ["l", "hidden", "0xsearchstr.moderation"]  ← label
 *   ["u", "<normalized-url>"]                  ← target (web result)
 *   ["e", "<event-id>"]                        ← target (Nostr result)
 *
 * Readers (every user of the app) filter their own result lists against
 * labels signed by the OWNER pubkey ONLY — the author filter is the trust
 * boundary; anyone can write a label, only the owner's count.
 *
 * Un-hiding = NIP-09 deletion (kind 5 with an e-tag of the label event).
 *
 * Abuse reports filed from the Policy page are NIP-56 kind 1984 events
 * labeled under the `0xsearchstr.abuse` namespace — the dashboard reads
 * them and turns them into moderation labels in one click.
 *
 * ⚠️ KEY NOTE: the owner pubkey below currently equals the app's public
 * fallback bot key (its nsec is embedded client-side for the legacy cache).
 * For production-grade moderation, rotate OWNER_PUBKEY to a key whose nsec
 * only the owner holds — it's a one-line change.
 */
import type { NostrEvent } from '@nostrify/nostrify';

import { normalizeIndexUrl } from '@/lib/webIndex';
import { APP_RELAYS, getIndexRelayUrls, getSearchRelayUrls } from '@/lib/appRelays';

/** Relays moderation data (labels, role lists, reports) is read from. */
export function getModerationRelayUrls(): string[] {
  return [
    ...new Set([
      ...getIndexRelayUrls(),
      ...getSearchRelayUrls(),
      // The owner's write relays (role lists + labels land here via NIP-65).
      ...APP_RELAYS.relays.map((r) => r.url),
    ]),
  ];
}

/** The owner's pubkey (hex) — npub1udrjdn9kyn6tk6ht400anfqltctqe2tm5t4p87kclrljnflcf09qvl3tay */
export const OWNER_PUBKEY = 'e34726ccb624f4bb6aebabdfd9a41f5e160ca97ba2ea13fad8f8ff29a7f84bca';

/** NIP-32 label kind. */
export const MODERATION_KIND = 1985;

/** Label namespace for moderation actions. */
export const MODERATION_NS = '0xsearchstr.moderation';

/** NIP-56 report kind (Policy page abuse reports). */
export const REPORT_KIND = 1984;

/** Label namespace for abuse reports. */
export const REPORT_NS = '0xsearchstr.abuse';

/* ------------------------------------------------------------------ */
/* Roles (owner-managed team lists)                                    */
/* ------------------------------------------------------------------ */

/**
 * Role lists: addressable kind 30078 events signed by the OWNER.
 * Content is a JSON array of hex pubkeys. Readers trust the owner's
 * signature only — the d-tag alone is not a trust boundary.
 *
 * Pattern adapted from 0xNostr-Relay-Finder's dashboard.
 */
export const ROLES_KIND = 30078;
export const ADMIN_ROLES_D_TAG = 'presearchstr:admin-roles';
export const MOD_ROLES_D_TAG = 'presearchstr:mod-roles';
export const ROLES_T_TAG = 'presearchstr-roles';

export type AppRole = 'owner' | 'admin' | 'moderator' | 'user';

/** Parse a role list event. Owner signature enforced by the caller's filter. */
export function parseRoleList(event: NostrEvent): string[] {
  if (event.kind !== ROLES_KIND) return [];
  if (event.pubkey !== OWNER_PUBKEY) return []; // trust boundary
  try {
    const parsed = JSON.parse(event.content) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string' && /^[0-9a-f]{64}$/i.test(p));
  } catch {
    return [];
  }
}

/** Build a role list event (owner publishes). */
export function buildRoleListEvent(dTag: string, pubkeys: string[]): {
  kind: number;
  content: string;
  tags: string[][];
} {
  const label = dTag === ADMIN_ROLES_D_TAG ? 'admin' : 'moderator';
  return {
    kind: ROLES_KIND,
    content: JSON.stringify(pubkeys),
    tags: [
      ['d', dTag],
      ['t', ROLES_T_TAG],
      ['alt', `Presearchstr ${label} list`],
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Types + parsing                                                     */
/* ------------------------------------------------------------------ */

export interface HiddenTarget {
  /** Label event id (needed for un-hide via NIP-09). */
  labelEventId: string;
  /** 'u' (web URL, normalized) or 'e' (Nostr event id). */
  targetType: 'u' | 'e';
  /** The target value (normalized URL or event id hex). */
  value: string;
  /** When the label was published. */
  createdAt: number;
}

/** Parse a kind 1985 "hidden" label. Returns null if invalid or untrusted. */
export function parseHiddenLabel(event: NostrEvent, trusted: Set<string> = new Set([OWNER_PUBKEY])): HiddenTarget | null {
  if (event.kind !== MODERATION_KIND) return null;
  if (!trusted.has(event.pubkey)) return null; // trust boundary

  const isHidden = event.tags.some(([n, v, ns]) => n === 'l' && v === 'hidden' && ns === MODERATION_NS);
  if (!isHidden) return null;

  const uTag = event.tags.find(([n]) => n === 'u')?.[1];
  const eTag = event.tags.find(([n]) => n === 'e')?.[1];
  if (uTag) return { labelEventId: event.id, targetType: 'u', value: uTag, createdAt: event.created_at };
  if (eTag && /^[0-9a-f]{64}$/i.test(eTag)) {
    return { labelEventId: event.id, targetType: 'e', value: eTag.toLowerCase(), createdAt: event.created_at };
  }
  return null;
}

/** Build a kind 1985 "hidden" label for a target (URL or event id). */
export function buildHideLabel(target: { url?: string; eventId?: string }): {
  kind: number;
  content: string;
  tags: string[][];
} | null {
  const targetTag = target.url
    ? ['u', normalizeIndexUrl(target.url) ?? target.url.trim()]
    : target.eventId && /^[0-9a-f]{64}$/i.test(target.eventId)
      ? ['e', target.eventId.toLowerCase()]
      : null;
  if (!targetTag) return null;

  return {
    kind: MODERATION_KIND,
    content: '',
    tags: [
      ['L', MODERATION_NS],
      ['l', 'hidden', MODERATION_NS],
      targetTag,
      ['alt', `Presearchstr moderation: hidden ${targetTag[0] === 'u' ? targetTag[1] : 'event'}`],
    ],
  };
}

/** Build a NIP-09 deletion request for a label event (un-hide). */
export function buildUnhideDelete(labelEventId: string): { kind: number; content: string; tags: string[][] } {
  return {
    kind: 5,
    content: 'Un-hide result',
    tags: [['e', labelEventId]],
  };
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/** A set of hidden targets for fast result filtering. */
export interface ModerationSet {
  urls: Set<string>;
  eventIds: Set<string>;
}

export function toModerationSet(targets: HiddenTarget[]): ModerationSet {
  return {
    urls: new Set(targets.filter((t) => t.targetType === 'u').map((t) => t.value)),
    eventIds: new Set(targets.filter((t) => t.targetType === 'e').map((t) => t.value)),
  };
}

/** Is this result hidden by the moderation set? */
export function isHiddenResult(
  result: { url: string; nostrEvent?: { id: string } },
  set: ModerationSet,
): boolean {
  if (result.nostrEvent && set.eventIds.has(result.nostrEvent.id)) return true;
  const normalized = normalizeIndexUrl(result.url);
  if (normalized && set.urls.has(normalized)) return true;
  return false;
}

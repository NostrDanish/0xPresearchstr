/**
 * Voting — 👍/👎 on results, NIP-25 reactions (kind 7).
 *
 * NIP-25 already covers both target kinds we need:
 *   - Nostr events:  ["e", "<event-id>"]
 *   - Websites/URLs: ["r", "<url>"]   (content "+" = like, "-" = dislike)
 *
 * We normalize URL targets with the SIP-01 normalizer so the same page
 * tallies together regardless of tracking params.
 *
 * Identity: votes default to ANONYMOUS — signed by this device's built-in
 * SIP-01 indexing identity (pseudonymous, per-device, never the user's npub).
 * Users can toggle "Vote with my npub" in Settings → Auto Indexer to make their
 * votes attributable (same as keyword staking).
 *
 * Tally rule: latest vote per pubkey per target wins; score = ups − downs.
 */
import type { NostrEvent } from '@nostrify/nostrify';

import { normalizeIndexUrl } from '@/lib/webIndex';

/** NIP-25 reaction kind. */
export const VOTE_KIND = 7;

export type VoteDirection = 1 | -1;

/** A votable target: a Nostr event or a (normalized) web URL. */
export interface VoteTarget {
  /** Stable key for lookups: "e:<id>" or "u:<normalized-url>". */
  key: string;
  /** The tag to put in the vote event. */
  tag: string[];
}

/** Build the target for a search result. Returns null for un-votable results. */
export function voteTargetFor(result: { url: string; nostrEvent?: { id: string } }): VoteTarget | null {
  // Nostr-native results vote on the event itself.
  if (result.nostrEvent?.id) {
    return { key: `e:${result.nostrEvent.id}`, tag: ['e', result.nostrEvent.id] };
  }
  // Web results vote on the normalized URL.
  const normalized = normalizeIndexUrl(result.url);
  if (normalized) {
    return { key: `u:${normalized}`, tag: ['r', normalized] };
  }
  return null;
}

/** Build a NIP-25 vote event template. */
export function buildVoteEvent(target: VoteTarget, direction: VoteDirection): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: VOTE_KIND,
    content: direction === 1 ? '+' : '-',
    tags: [
      target.tag,
      ['alt', `Presearchstr ${direction === 1 ? 'upvote' : 'downvote'}`],
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Tallying                                                            */
/* ------------------------------------------------------------------ */

export interface VoteTally {
  up: number;
  down: number;
  score: number;
}

/** Does this event vote on the given target key? */
function eventTargetKey(event: NostrEvent): string | null {
  const eTag = event.tags.find(([n]) => n === 'e')?.[1];
  if (eTag) return `e:${eTag}`;
  const rTag = event.tags.find(([n]) => n === 'r')?.[1];
  if (rTag) return `u:${rTag}`;
  return null;
}

/**
 * Tally vote events per target. Latest vote per pubkey wins
 * (republishing flips your vote; no double-counting).
 */
export function tallyVotes(events: NostrEvent[]): Map<string, VoteTally> {
  // Latest vote per (target, pubkey).
  const latest = new Map<string, { direction: VoteDirection; createdAt: number }>();

  for (const ev of events) {
    if (ev.kind !== VOTE_KIND) continue;
    const direction: VoteDirection | null =
      ev.content === '+' || ev.content === '👍' ? 1
        : ev.content === '-' || ev.content === '👎' ? -1
          : null;
    if (direction === null) continue;

    const targetKey = eventTargetKey(ev);
    if (!targetKey) continue;

    const k = `${targetKey}:${ev.pubkey}`;
    const existing = latest.get(k);
    if (!existing || ev.created_at > existing.createdAt) {
      latest.set(k, { direction, createdAt: ev.created_at });
    }
  }

  const tallies = new Map<string, VoteTally>();
  for (const [k, vote] of latest) {
    const targetKey = k.slice(0, k.lastIndexOf(':'));
    const tally = tallies.get(targetKey) ?? { up: 0, down: 0, score: 0 };
    if (vote.direction === 1) tally.up++;
    else tally.down++;
    tally.score = tally.up - tally.down;
    tallies.set(targetKey, tally);
  }

  return tallies;
}

/* ------------------------------------------------------------------ */
/* My votes (localStorage — drives the active button state)            */
/* ------------------------------------------------------------------ */

const LS_MY_VOTES = 'presearchstr:votes';

export function getMyVote(targetKey: string): VoteDirection | null {
  try {
    const raw = localStorage.getItem(LS_MY_VOTES);
    const parsed = raw ? JSON.parse(raw) : {};
    const v = parsed[targetKey];
    return v === 1 || v === -1 ? v : null;
  } catch {
    return null;
  }
}

export function setMyVote(targetKey: string, direction: VoteDirection | null): void {
  try {
    const raw = localStorage.getItem(LS_MY_VOTES);
    const parsed = raw ? JSON.parse(raw) : {};
    if (direction === null) delete parsed[targetKey];
    else parsed[targetKey] = direction;
    localStorage.setItem(LS_MY_VOTES, JSON.stringify(parsed));
  } catch {
    // Storage unavailable — vote still published, state just won't persist.
  }
}

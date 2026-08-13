/**
 * Trending term signals — privacy-preserving "what the community searches".
 *
 * Why this exists: the legacy query cache (kind 30078, `0xsearchstr:cache:*`)
 * carried the PLAINTEXT query in a tag. Every search became a permanent public
 * record of what someone typed — fine for "monero wallet", unacceptable for
 * anything confidential. Users reasonably hated it.
 *
 * The k-anonymity design (hashed terms, threshold reveal):
 *
 *   1. SIGNAL — after a successful search, this device publishes ONE
 *      addressable event whose d-tag is a one-way hash:
 *
 *        d = "0xsearchstr:term:" + sha256(normalized_query)
 *
 *      No plaintext anywhere — not in tags, not in content. A reader sees only
 *      "some pseudonymous device hashed this term". Signed by the per-device
 *      indexing identity, never the user's npub. One signal per device per
 *      term (addressable replace), so counting distinct pubkeys ≈ counting
 *      distinct searchers.
 *
 *   2. THRESHOLD — a term stays hashed until at least TRENDING_THRESHOLD
 *      distinct devices have signaled the same hash. Below that, nothing
 *      plaintext exists anywhere on any relay.
 *
 *   3. REVEAL — the device whose search crosses the threshold knows the
 *      plaintext (its user just typed it), so it publishes a reveal event:
 *
 *        d = "0xsearchstr:term-reveal:" + <same hash>
 *        term = <plaintext query>
 *
 *      Reveals are SELF-VERIFYING: readers re-hash the claimed plaintext and
 *      compare it to the d-tag before displaying. A fake reveal (wrong
 *      plaintext for a hash) fails verification and is dropped.
 *
 * What an observer learns: hashes of searched terms (dictionary-attackable
 * for very common words — which are also the terms that trend anyway) and
 * plaintext ONLY for terms at least 3 independent devices searched. A unique
 * or rare confidential query never appears in plaintext. Never signal
 * sensitive query classes at all: NIP-19 ids, NIP-05 addresses, URLs, and
 * math are excluded by the caller via classifyQuery().
 */
import type { NostrEvent } from '@nostrify/nostrify';

import { INDEX_KIND, normalizeQuery } from '@/lib/searchIndex';

/** d-tag prefix for hashed term signals. */
export const TERM_SIGNAL_D_PREFIX = '0xsearchstr:term:';

/** d-tag prefix for plaintext reveals of threshold-crossed terms. */
export const TERM_REVEAL_D_PREFIX = '0xsearchstr:term-reveal:';

/** t-tags (relay-indexable) for the two event families. */
export const TERM_SIGNAL_T_TAG = '0xsearchstr-term';
export const TERM_REVEAL_T_TAG = '0xsearchstr-term-reveal';

/** Distinct devices that must signal a term before it may be revealed. */
export const TRENDING_THRESHOLD = 3;

/** SHA-256 hex (lowercase) of a UTF-8 string. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** One-way term identity: sha256 of the normalized query (same normalization as the legacy cache). */
export async function hashTerm(query: string): Promise<string> {
  return sha256Hex(normalizeQuery(query));
}

/** Build this device's hashed signal event for a term (unsigned template). */
export function buildTermSignalEvent(hash: string): { kind: number; content: string; tags: string[][] } {
  return {
    kind: INDEX_KIND,
    content: '',
    tags: [
      ['d', `${TERM_SIGNAL_D_PREFIX}${hash}`],
      ['t', TERM_SIGNAL_T_TAG],
      ['alt', 'Hashed search-term signal (k-anonymity trending — no plaintext)'],
    ],
  };
}

/** Build a reveal event mapping a threshold-crossed hash to its plaintext (unsigned template). */
export function buildTermRevealEvent(hash: string, term: string): { kind: number; content: string; tags: string[][] } {
  return {
    kind: INDEX_KIND,
    content: '',
    tags: [
      ['d', `${TERM_REVEAL_D_PREFIX}${hash}`],
      ['t', TERM_REVEAL_T_TAG],
      ['term', term.trim()],
      ['alt', `Public trending term (searched by ${TRENDING_THRESHOLD}+ independent devices): ${term.trim()}`],
    ],
  };
}

/** Parse a term signal. Any author may signal — the pubkey IS the (pseudonymous) voter. */
export function parseTermSignal(event: NostrEvent): { hash: string; searcher: string; signaledAt: number } | null {
  if (event.kind !== INDEX_KIND) return null;
  const d = event.tags.find(([n]) => n === 'd')?.[1];
  if (!d?.startsWith(TERM_SIGNAL_D_PREFIX)) return null;
  const hash = d.slice(TERM_SIGNAL_D_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  return { hash, searcher: event.pubkey, signaledAt: event.created_at };
}

/** Parse a term reveal (plaintext NOT yet verified — call verifyTermReveal). */
export function parseTermReveal(event: NostrEvent): { hash: string; term: string; revealedAt: number } | null {
  if (event.kind !== INDEX_KIND) return null;
  const d = event.tags.find(([n]) => n === 'd')?.[1];
  if (!d?.startsWith(TERM_REVEAL_D_PREFIX)) return null;
  const hash = d.slice(TERM_REVEAL_D_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const term = event.tags.find(([n]) => n === 'term')?.[1]?.trim();
  if (!term || term.length > 200) return null;
  return { hash, term, revealedAt: event.created_at };
}

/**
 * Verify a reveal against its hash: the claimed plaintext must hash back to
 * the d-tag hash. This is what stops someone from "revealing" a sensitive
 * term by attaching wrong plaintext to a trending hash.
 */
export async function verifyTermReveal(hash: string, term: string): Promise<boolean> {
  return (await hashTerm(term)) === hash;
}

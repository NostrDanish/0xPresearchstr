/**
 * Keyword Stakes — Presearch-style keyword staking, rebuilt Nostr-native.
 *
 * Presearch lets advertisers stake PRE tokens on keywords; the top staker's
 * link shows when someone searches that keyword. Here the stake is your
 * Nostr identity: anyone can stake a keyword by signing an addressable
 * event that binds the keyword to a URL. One stake per keyword per pubkey
 * (re-staking the same keyword replaces your previous stake).
 *
 * Lives in the shared "0xsearchstr" protocol namespace so 0xSearchstr and
 * every compatible fork read the same stakes:
 *
 *   kind: 30078 (NIP-78 application data)
 *   d: "0xsearchstr:stake:<normalized-keyword>"
 *   t: "0xsearchstr-stake"
 *   title: "<display title>"
 *   url: "<target url>"
 *   content: pitch / description (shown as the search snippet)
 *
 * Ranking between competing stakes on the same keyword is recency-based
 * for now; the schema leaves room for zap-weighted ranking (kind 9735
 * receipts against the stake event) without a breaking change.
 *
 * Trust model: stakes are public UGC (like kind 1 notes) — readers do NOT
 * filter by author. Clients MUST validate structure and URL scheme.
 */
import type { NostrEvent } from '@nostrify/nostrify';

import type { SearchResult } from '@/lib/providers/types';
import { isValidSubmissionUrl } from '@/lib/contentType';
import { normalizeQuery } from '@/lib/searchIndex';

/** Kind used for keyword stakes (NIP-78 application data). */
export const STAKE_KIND = 30078;

/** t-tag marking keyword stakes (shared with 0xSearchstr + forks). */
export const STAKE_T_TAG = '0xsearchstr-stake';

/** Max pitch length (keeps events small, snippets readable). */
const MAX_PITCH_LENGTH = 280;

/** Build the d-tag for a keyword stake. */
export function stakeDTag(keyword: string): string {
  return `0xsearchstr:stake:${normalizeQuery(keyword)}`;
}

export interface StakeInput {
  keyword: string;
  url: string;
  title: string;
  pitch: string;
}

/** Build tags + content for a keyword stake event (kind 30078). */
export function buildStakeEvent(
  input: StakeInput,
): { kind: number; content: string; tags: string[][] } | null {
  const keyword = input.keyword.trim();
  const normalized = normalizeQuery(keyword);
  if (!normalized) return null;
  if (!input.title.trim() || !isValidSubmissionUrl(input.url)) return null;

  return {
    kind: STAKE_KIND,
    content: input.pitch.trim().slice(0, MAX_PITCH_LENGTH),
    tags: [
      ['d', stakeDTag(keyword)],
      ['t', STAKE_T_TAG],
      ['keyword', keyword],
      ['title', input.title.trim()],
      ['url', input.url.trim()],
      ['alt', `Keyword stake on "${keyword}": ${input.title.trim()}`],
    ],
  };
}

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch {
    if (url.startsWith('magnet:?')) return 'magnet link';
    if (url.startsWith('ipfs://') || url.startsWith('ipns://')) return 'ipfs';
    return '';
  }
}

/**
 * Parse a keyword stake event into a SearchResult.
 * Returns null for malformed events or disallowed URL schemes.
 */
export function parseStakeEvent(event: NostrEvent): SearchResult | null {
  if (event.kind !== STAKE_KIND) return null;
  if (!event.tags.some(([n, v]) => n === 't' && v === STAKE_T_TAG)) return null;

  const dTag = getTag(event, 'd');
  if (!dTag?.startsWith('0xsearchstr:stake:')) return null;

  const title = getTag(event, 'title');
  const url = getTag(event, 'url');
  if (!title?.trim() || !url || !isValidSubmissionUrl(url)) return null;

  const keyword = getTag(event, 'keyword') ?? dTag.slice('0xsearchstr:stake:'.length);

  return {
    id: event.id,
    title: title.trim(),
    url: url.trim(),
    snippet: event.content.trim(),
    source: 'web',
    provider: 'keyword-stake',
    timestamp: event.created_at,
    domain: extractDomain(url),
    kind: 'Staked',
    engine: keyword,
    // Above community (96) and cache (90), below organic Nostr (100).
    score: 97,
    nostrEvent: event,
  };
}

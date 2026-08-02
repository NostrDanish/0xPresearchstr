/**
 * Nostr search provider — NIP-50 queries to search-capable relays.
 *
 * Searches profiles (kind 0), notes (kind 1), long-form articles (kind 30023),
 * and file metadata (kind 1063) across multiple relays, deduplicates, and
 * normalizes into SearchResult[].
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

import { getSearchRelayUrls } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

/**
 * Nostr kinds to search.
 * - 0: Profiles
 * - 1: Notes
 * - 1063: File metadata (NIP-94)
 * - 30023: Long-form articles (NIP-23)
 * - 30818: Wiki articles / Wikifreedia (NIP-54)
 */
const SEARCH_KINDS = [0, 1, 1063, 30023, 30818];

/**
 * Spam heuristic for kind 1 notes: hashtag-stuffed or link-stuffed
 * notes are almost always spam and drown out real signal.
 */
function isSpammyNote(event: NostrEvent): boolean {
  if (event.kind !== 1) return false;
  const content = event.content;

  // Excessive hashtags (in content or tags).
  const hashtagCount = (content.match(/#[^\s#]+/g) ?? []).length;
  const tagCount = event.tags.filter(([n]) => n === 't').length;
  if (hashtagCount > 8 || tagCount > 10) return true;

  // Link stuffing.
  const urlCount = (content.match(/https?:\/\//g) ?? []).length;
  if (urlCount > 3) return true;

  return false;
}

/**
 * Extract the most relevant window of a note around the query terms,
 * like Google's snippets — instead of always showing the head of the note.
 */
function extractRelevantSnippet(content: string, query: string, max = 300): string {
  if (content.length <= max) return content;

  const lower = content.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);

  // Earliest occurrence of any query term.
  let matchIdx = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (matchIdx === -1 || idx < matchIdx)) matchIdx = idx;
  }

  // No term found — fall back to the head of the note.
  if (matchIdx === -1) return truncate(content, max);

  // Window: pull back a third of the budget before the match for context.
  let start = Math.max(0, matchIdx - Math.floor(max / 3));
  if (start > 0) {
    // Snap to a word boundary.
    const space = content.indexOf(' ', start);
    if (space !== -1 && space < matchIdx) start = space + 1;
  }

  const excerpt = content.slice(start, start + max);
  const truncated = start + max < content.length;
  return `${start > 0 ? '…' : ''}${excerpt}${truncated ? '…' : ''}`;
}

/** Convert a Nostr event into a universal SearchResult. */
function eventToSearchResult(event: NostrEvent, query: string): SearchResult {
  const nip19Id = eventToNip19(event);
  const internalUrl = `/${nip19Id}`;

  // Base result
  const result: SearchResult = {
    id: event.id,
    title: '',
    url: internalUrl,
    snippet: '',
    source: 'nostr',
    provider: 'nostr',
    timestamp: event.created_at,
    tags: event.tags.filter(([n]) => n === 't').map(([, v]) => v).slice(0, 5),
    nostrEvent: event,
    score: 100, // base score for Nostr-first priority
  };

  if (event.kind === 0) {
    // Profile
    try {
      const meta = JSON.parse(event.content) as Record<string, string>;
      result.title = meta.name || meta.display_name || npubShort(event.pubkey);
      result.snippet = meta.about || '';
      result.kind = 'Profile';
      result.author = result.title;
      result.authorAvatar = meta.picture ? sanitizeUrl(meta.picture) : undefined;
      result.domain = meta.nip05 || undefined;
    } catch {
      result.title = npubShort(event.pubkey);
      result.kind = 'Profile';
    }
    result.score = 110; // Profiles rank highest — usually what people want
  } else if (event.kind === 30818) {
    // Wikifreedia / Wiki article (NIP-54)
    const dTag = getDTag(event) || '';
    result.title = getTag(event, 'title') || dTag.replace(/-/g, ' ') || 'Wiki Article';
    result.snippet = getTag(event, 'summary') || truncate(event.content, 250);
    result.kind = 'Wiki';
    result.domain = 'wikifreedia.xyz';
    result.score = 105; // Wiki articles from Nostr get extra priority
  } else if (event.kind === 30023) {
    // Article
    result.title = getTag(event, 'title') || 'Untitled Article';
    result.snippet = getTag(event, 'summary') || extractRelevantSnippet(event.content, query, 250);
    result.kind = 'Article';
    result.thumbnail = getTag(event, 'image') ? sanitizeUrl(getTag(event, 'image')!) : undefined;
    result.score = 102;
  } else if (event.kind === 1063) {
    // File
    result.title = getTag(event, 'alt') || getTag(event, 'x') || 'File';
    result.snippet = event.content || getTag(event, 'summary') || '';
    result.kind = 'File';
    const fileUrl = getTag(event, 'url');
    if (fileUrl) result.domain = extractDomain(fileUrl);
    result.score = 98;
  } else {
    // Note (kind 1) or other
    result.title = truncate(event.content, 120);
    result.snippet = extractRelevantSnippet(event.content, query);
    result.kind = event.kind === 1 ? undefined : `Kind ${event.kind}`;
  }

  return result;
}

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}

function getDTag(event: NostrEvent): string | undefined {
  return event.tags.find(([n]) => n === 'd')?.[1];
}

function eventToNip19(event: NostrEvent): string {
  if (event.kind === 0) {
    return nip19.npubEncode(event.pubkey);
  }
  if (event.kind >= 30000 && event.kind < 40000) {
    const d = getDTag(event);
    if (d !== undefined) {
      return nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: d });
    }
  }
  return nip19.neventEncode({ id: event.id, author: event.pubkey });
}

function npubShort(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return npub.slice(0, 12) + '...' + npub.slice(-4);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const t = text.slice(0, max);
  const last = t.lastIndexOf(' ');
  return (last > max * 0.7 ? t.slice(0, last) : t) + '...';
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** Nostr search provider. */
export const nostrProvider: SearchProvider = {
  id: 'nostr',
  name: 'Nostr',
  source: 'nostr',
  privacy: 'nostr',
  privacyNote: 'NIP-50 search over WebSocket. Relay operators see the query + your IP, but no account is linked.',

  async search({ query, signal, limit = 40 }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const filter: NostrFilter & { search?: string } = {
      search: query.trim(),
      kinds: SEARCH_KINDS,
      limit,
    };

    // Query all search relays in parallel and merge/dedupe.
    const settled = await Promise.allSettled(
      getSearchRelayUrls().map(async (url) => {
        const relay = getSearchRelay(url);
        return relay.query([filter], {
          signal: AbortSignal.any([signal ?? AbortSignal.timeout(15000), AbortSignal.timeout(8000)]),
        });
      }),
    );

    const eventMap = new Map<string, NostrEvent>();
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        for (const ev of r.value) {
          if (!eventMap.has(ev.id)) eventMap.set(ev.id, ev);
        }
      }
    }

    // Sort by recency (NIP-50 relay relevance doesn't survive cross-relay merge),
    // drop spammy notes, then normalize.
    const events = [...eventMap.values()]
      .filter((ev) => !isSpammyNote(ev))
      .sort((a, b) => b.created_at - a.created_at);
    const results = events.map((ev) => eventToSearchResult(ev, query));

    return { results };
  },
};

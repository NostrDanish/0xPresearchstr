/**
 * Git provider — NIP-34 "git stuff" from the GRASP/ngit relay network.
 *
 * Searches decentralized code collaboration: repository announcements
 * (kind 30617), issues (kind 1621), pull requests (kind 1618), and patches
 * (kind 1617) across ngit/GRASP servers and the git indexers
 * (indexer.coracle.social, index.hzrd149.com, index.ngit.dev).
 *
 * The pool is READ-ONLY (see GIT_RELAYS in appRelays.ts): indexers answer
 * the NIP-50 `search` keyword; plain GRASP servers ignore it and return
 * recent events, which we filter client-side with the shared phrase-aware
 * matcher. Either way the same relevance pass decides what shows.
 *
 * Link targets: repositories link to their `web` browsing URL (https only)
 * with a clone URL as fallback; issues/PRs/patches open the internal
 * nevent/naddr viewer so the full thread is one click away.
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

import { GIT_RELAYS } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { matchWithRelevance, tokenizeRaw } from '@/lib/queryMatch';
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

/** NIP-34 kinds we surface: repos, patches, PRs, issues. */
const GIT_KINDS = [30617, 1617, 1618, 1621];

/** How many events to pull per relay (search-ranked or recent). */
const FETCH_LIMIT = 60;

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}

function getTags(event: NostrEvent, name: string): string[] {
  return event.tags.filter(([n]) => n === name).map(([, v]) => v);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const t = text.slice(0, max);
  const last = t.lastIndexOf(' ');
  return (last > max * 0.6 ? t.slice(0, last) : t) + '…';
}

/** Extract the subject line from a git format-patch body ("Subject: [PATCH] …"). */
function patchSubject(content: string): string | undefined {
  const match = content.match(/^Subject:\s*(?:\[PATCH[^\]]*\]\s*)?(.+)$/m);
  return match?.[1]?.trim();
}

/** First https URL among a tag's values (sanitizeUrl-approved), else undefined. */
function firstWebUrl(values: string[]): string | undefined {
  for (const v of values) {
    const safe = sanitizeUrl(v);
    if (safe) return safe;
  }
  return undefined;
}

/** Internal viewer route for an event (naddr for the addressable repo, nevent otherwise). */
function internalRoute(event: NostrEvent): string {
  if (event.kind === 30617) {
    const d = getTag(event, 'd');
    if (d !== undefined) {
      return `/${nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: d })}`;
    }
  }
  return `/${nip19.neventEncode({ id: event.id, author: event.pubkey })}`;
}

/** Convert a NIP-34 event into a SearchResult. Returns null when unusable. */
function eventToResult(event: NostrEvent): SearchResult | null {
  const base = {
    id: event.id,
    source: 'code' as const,
    provider: 'git',
    engine: 'ngit/GRASP',
    timestamp: event.created_at,
    nostrEvent: event,
    tags: getTags(event, 't').slice(0, 5),
  };

  if (event.kind === 30617) {
    // Repository announcement.
    const name = getTag(event, 'name') ?? getTag(event, 'd');
    if (!name) return null;
    const url = firstWebUrl(getTags(event, 'web'))
      ?? firstWebUrl(getTags(event, 'clone'))
      ?? internalRoute(event);
    return {
      ...base,
      title: name,
      url,
      snippet: getTag(event, 'description') ?? '',
      kind: 'Repo',
      domain: url.startsWith('http') ? safeDomain(url) : 'nostr git',
    };
  }

  if (event.kind === 1621) {
    // Issue.
    const subject = getTag(event, 'subject') ?? truncate(event.content.trim(), 90);
    if (!subject) return null;
    return {
      ...base,
      title: subject,
      url: internalRoute(event),
      snippet: truncate(event.content.trim(), 250),
      kind: 'Issue',
      domain: 'nostr git',
    };
  }

  if (event.kind === 1618) {
    // Pull request.
    const subject = getTag(event, 'subject') ?? truncate(event.content.trim(), 90);
    if (!subject) return null;
    return {
      ...base,
      title: subject,
      url: internalRoute(event),
      snippet: truncate(event.content.trim(), 250),
      kind: 'PR',
      domain: 'nostr git',
    };
  }

  // kind 1617 — patch (content is git format-patch; title from Subject:).
  const subject = patchSubject(event.content);
  if (!subject) return null;
  return {
    ...base,
    title: subject,
    url: internalRoute(event),
    snippet: '',
    kind: 'Patch',
    domain: 'nostr git',
  };
}

function safeDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Searchable text fields for the client-side relevance match. */
function haystackFor(event: NostrEvent, result: SearchResult): (string | undefined)[] {
  // The repo d-tag ("my-cool-project") is a strong query target for repos;
  // for issues/PRs the `a` tag's repo id adds context ("which project?").
  const repoId = event.kind === 30617
    ? getTag(event, 'd')
    : getTag(event, 'a')?.split(':')[2];
  return [result.title, result.snippet, repoId, ...(result.tags ?? [])];
}

export const gitProvider: SearchProvider = {
  id: 'git',
  name: 'Git Repos',
  source: 'code',
  privacy: 'nostr',
  privacyNote: 'Read-only NIP-34 search over ngit/GRASP relays. Relay operators see the query, but no account is linked.',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const filter: NostrFilter & { search?: string } = {
      kinds: GIT_KINDS,
      search: query.trim(),
      limit: FETCH_LIMIT,
    };

    const settled = await Promise.allSettled(
      GIT_RELAYS.map((url) =>
        getSearchRelay(url).query([filter], {
          signal: AbortSignal.any([signal ?? AbortSignal.timeout(8000), AbortSignal.timeout(5000)]),
        }),
      ),
    );

    // Merge by event id (indexers overlap with origin servers).
    const events = new Map<string, NostrEvent>();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const ev of r.value) {
        if (!GIT_KINDS.includes(ev.kind)) continue; // relays can over-return
        if (!events.has(ev.id)) events.set(ev.id, ev);
      }
    }

    const terms = tokenizeRaw(query);
    const results: SearchResult[] = [];
    for (const ev of events.values()) {
      const result = eventToResult(ev);
      if (!result) continue;
      const m = matchWithRelevance(haystackFor(ev, result), terms);
      if (!m.match) continue;
      // Code band: above Stack Overflow (72), below organic web (78+).
      // Relevance to the actual query words drives the spread; repos get a
      // nudge over loose threads since they're the usual search target.
      const kindBoost = ev.kind === 30617 ? 1 : 0;
      result.score = 73 + m.relevance * 3 + kindBoost;
      results.push(result);
    }

    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.timestamp ?? 0) - (a.timestamp ?? 0));
    return { results: results.slice(0, 20) };
  },
};

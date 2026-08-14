/**
 * Nostr Wiki provider — NIP-54 wiki articles from the wiki relay pool.
 *
 * Reads kind 30818 (addressable wiki articles) from the relays wikistr
 * reads (relay.wikifreedia.xyz + friends — see WIKI_RELAYS / Settings →
 * Wiki Relays). Read-only. Relays that support NIP-50 answer the `search`
 * keyword; the rest return recent articles and the shared phrase-aware
 * matcher filters client-side.
 *
 * Multiple articles can share a d-tag (any author can cover a topic) — we
 * group by d and show the most recent few versions, so one topic doesn't
 * flood the results.
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

import { getWikiRelayUrls } from '@/lib/appRelays';
import { queryRelayPool } from '@/lib/searchRelays';
import { matchWithRelevance, tokenizeRaw } from '@/lib/queryMatch';
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

/** NIP-54 wiki article kind. */
const WIKI_KIND = 30818;

/** How many articles to pull per relay before client-side matching. */
const FETCH_LIMIT = 100;

/** Max article versions shown per topic (d-tag). */
const MAX_VERSIONS_PER_TOPIC = 2;

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const t = text.slice(0, max);
  const last = t.lastIndexOf(' ');
  return (last > max * 0.6 ? t.slice(0, last) : t) + '…';
}

function articleToResult(event: NostrEvent): SearchResult | null {
  const d = getTag(event, 'd');
  if (!d) return null;

  const title = getTag(event, 'title')?.trim() || d.replace(/[-_]+/g, ' ');
  const snippet = getTag(event, 'summary')?.trim() || truncate(event.content.trim(), 250);

  return {
    id: event.id,
    title,
    url: `/${nip19.naddrEncode({ kind: WIKI_KIND, pubkey: event.pubkey, identifier: d })}`,
    snippet,
    source: 'wiki',
    provider: 'nostr-wiki',
    engine: 'Nostr Wiki',
    kind: 'Wiki',
    domain: 'wikifreedia.xyz',
    timestamp: event.created_at,
    tags: event.tags.filter(([n]) => n === 't').map(([, v]) => v).slice(0, 5),
    nostrEvent: event,
  };
}

export const nostrWikiProvider: SearchProvider = {
  id: 'nostr-wiki',
  name: 'Nostr Wiki',
  source: 'wiki',
  privacy: 'nostr',
  privacyNote: 'Read-only NIP-54 article search over the wiki relay pool (wikistr relays). Relay operators see the query, but no account is linked.',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const filter: NostrFilter & { search?: string } = {
      kinds: [WIKI_KIND],
      search: query.trim(),
      limit: FETCH_LIMIT,
    };

    const settled = await queryRelayPool(getWikiRelayUrls(), [filter], {
      signal,
      timeoutMs: 5000,
    });

    // Merge by event id, keep only well-formed articles.
    const events = new Map<string, NostrEvent>();
    for (const value of settled) {
      for (const ev of value) {
        if (ev.kind !== WIKI_KIND) continue;
        if (!events.has(ev.id)) events.set(ev.id, ev);
      }
    }

    const terms = tokenizeRaw(query);

    // Group versions by topic (d-tag), then match the newest version —
    // relevance decides which topics show, recency picks the displayed one.
    const byTopic = new Map<string, NostrEvent[]>();
    for (const ev of events.values()) {
      const d = getTag(ev, 'd')!;
      const group = byTopic.get(d) ?? [];
      group.push(ev);
      byTopic.set(d, group);
    }

    const results: SearchResult[] = [];
    for (const versions of byTopic.values()) {
      versions.sort((a, b) => b.created_at - a.created_at);
      const scored = versions
        .map((ev) => {
          const result = articleToResult(ev);
          if (!result) return null;
          const m = matchWithRelevance([result.title, result.snippet, getTag(ev, 'd'), ...(result.tags ?? [])], terms);
          return m.match ? { result, relevance: m.relevance } : null;
        })
        .filter((x): x is { result: SearchResult; relevance: number } => x !== null)
        .sort((a, b) => b.relevance - a.relevance);

      for (const { result, relevance } of scored.slice(0, MAX_VERSIONS_PER_TOPIC)) {
        // Wiki band: alongside Wikipedia engine results (75), relevance-driven.
        result.score = 74 + relevance * 3;
        results.push(result);
      }
    }

    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.timestamp ?? 0) - (a.timestamp ?? 0));
    return { results: results.slice(0, 15) };
  },
};

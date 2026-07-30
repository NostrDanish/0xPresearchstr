/**
 * Hacker News search provider — Algolia HN Search API.
 *
 * Queries the public Algolia-powered HN search API. No API key needed.
 * Returns stories (posts) sorted by relevance.
 */
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

interface HNHit {
  objectID: string;
  title: string;
  url: string | null;
  author: string;
  created_at: string;
  created_at_i: number;
  points: number | null;
  num_comments: number | null;
  story_text?: string | null;
}

interface HNResponse {
  hits: HNHit[];
}

function toSearchResult(hit: HNHit, index: number): SearchResult {
  const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const displayUrl = hit.url || hnUrl;
  let domain: string | undefined;
  if (hit.url) {
    try { domain = new URL(hit.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  }

  return {
    id: `hn-${hit.objectID}`,
    title: hit.title || 'Untitled',
    url: displayUrl,
    snippet: hit.story_text
      ? stripHtml(hit.story_text).slice(0, 300)
      : [
        hit.points !== null ? `${hit.points} points` : null,
        hit.num_comments !== null ? `${hit.num_comments} comments` : null,
        `by ${hit.author}`,
      ].filter(Boolean).join(' · '),
    source: 'news',
    provider: 'hackernews',
    author: hit.author,
    domain: domain || 'news.ycombinator.com',
    engine: 'Hacker News',
    timestamp: hit.created_at_i || undefined,
    kind: 'Story',
    tags: hit.points !== null ? [`${hit.points}pts`] : undefined,
    score: 70 - index * 0.5,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

export const hackerNewsProvider: SearchProvider = {
  id: 'hackernews',
  name: 'Hacker News',
  source: 'news',
  privacy: 'direct',
  privacyNote: 'Direct HTTPS to Algolia\u2019s HN Search API. Algolia sees the query + your IP.',

  async search({ query, signal, limit = 15 }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const params = new URLSearchParams({
      query: query.trim(),
      tags: 'story',
      hitsPerPage: String(limit),
    });

    const url = `https://hn.algolia.com/api/v1/search?${params.toString()}`;

    try {
      const res = await fetch(url, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) return { results: [] };

      const data = await res.json() as HNResponse;
      return { results: (data.hits ?? []).map(toSearchResult) };
    } catch {
      return { results: [] };
    }
  },
};

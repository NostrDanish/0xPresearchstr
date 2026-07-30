/**
 * Wikipedia search provider — MediaWiki API.
 *
 * Queries the English Wikipedia search API. No CORS proxy needed
 * since Wikipedia sets proper CORS headers for API requests.
 */
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

interface WikiSearchResult {
  ns: number;
  title: string;
  pageid: number;
  size: number;
  wordcount: number;
  snippet: string;
  timestamp: string;
}

interface WikiResponse {
  query?: {
    search: WikiSearchResult[];
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'");
}

function toSearchResult(r: WikiSearchResult, index: number): SearchResult {
  return {
    id: `wiki-${r.pageid}`,
    title: r.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: stripHtml(r.snippet),
    source: 'wiki',
    provider: 'wikipedia',
    domain: 'en.wikipedia.org',
    engine: 'Wikipedia',
    timestamp: Math.floor(new Date(r.timestamp).getTime() / 1000) || undefined,
    kind: 'Encyclopedia',
    score: 75 - index * 0.5,
  };
}

export const wikipediaProvider: SearchProvider = {
  id: 'wikipedia',
  name: 'Wikipedia',
  source: 'wiki',
  privacy: 'direct',
  privacyNote: 'Direct HTTPS to the Wikimedia API. Wikimedia sees the query + your IP (standard web server logs).',

  async search({ query, signal, limit = 10 }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query.trim(),
      srlimit: String(limit),
      format: 'json',
      origin: '*',
    });

    const url = `https://en.wikipedia.org/w/api.php?${params.toString()}`;

    try {
      const res = await fetch(url, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) return { results: [] };

      const data = await res.json() as WikiResponse;
      const items = data.query?.search ?? [];

      return { results: items.map(toSearchResult) };
    } catch {
      return { results: [] };
    }
  },
};

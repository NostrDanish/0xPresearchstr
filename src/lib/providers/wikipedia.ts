/**
 * Wikipedia search provider — MediaWiki API.
 *
 * Queries Wikipedia's search API. No CORS proxy needed since Wikipedia sets
 * proper CORS headers for API requests.
 *
 * Language-aware: Wikipedia is per-language subdomains (en.wikipedia.org,
 * da.wikipedia.org, …), so a result language filter maps directly to
 * querying the preferred languages' wikis (first two) and merging.
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

function toSearchResult(r: WikiSearchResult, index: number, lang: string, langRank: number): SearchResult {
  return {
    id: `wiki-${lang}-${r.pageid}`,
    title: r.title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: stripHtml(r.snippet),
    source: 'wiki',
    provider: 'wikipedia',
    domain: `${lang}.wikipedia.org`,
    engine: 'Wikipedia',
    timestamp: Math.floor(new Date(r.timestamp).getTime() / 1000) || undefined,
    kind: 'Encyclopedia',
    language: lang,
    // Preferred language first, then position within its wiki.
    score: 75 - langRank - index * 0.5,
  };
}

async function queryWiki(
  lang: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<WikiSearchResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json() as WikiResponse;
  return data.query?.search ?? [];
}

export const wikipediaProvider: SearchProvider = {
  id: 'wikipedia',
  name: 'Wikipedia',
  source: 'wiki',
  privacy: 'direct',
  privacyNote: 'Direct HTTPS to the Wikimedia API. Wikimedia sees the query + your IP (standard web server logs).',

  async search({ query, signal, limit = 10, languages }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    // Default English; with a result language filter, query the preferred
    // languages' wikis (first two) and merge in preference order.
    const langs = languages && languages.length > 0 ? languages.slice(0, 2) : ['en'];

    const settled = await Promise.allSettled(
      langs.map((lang) => queryWiki(lang, query.trim(), limit, signal)),
    );

    const results: SearchResult[] = [];
    settled.forEach((s, langRank) => {
      if (s.status !== 'fulfilled') return;
      s.value.forEach((r, i) => results.push(toSearchResult(r, i, langs[langRank], langRank)));
    });

    return { results: results.slice(0, limit) };
  },
};

/**
 * DuckDuckGo HTML search provider — scrapes DDG lite for web results.
 *
 * DuckDuckGo Lite (lite.duckduckgo.com) is a stripped-down HTML interface
 * that's easy to parse. We scrape it through the CORS proxy since DDG
 * doesn't provide a public JSON API for browser clients.
 *
 * This serves as a reliable fallback when SearXNG instances are unavailable.
 */
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

const CORS_PROXY = 'https://proxy.shakespeare.diy/?url=';

interface DDGRawResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Parse DuckDuckGo HTML results page.
 *
 * DDG's HTML search uses a consistent structure with result links
 * and snippet text that we can extract via regex.
 */
function parseDDGResults(html: string): DDGRawResult[] {
  const results: DDGRawResult[] = [];

  // DDG standard results page: each result is in a div with class "result"
  // containing a link with class "result__a" and snippet in "result__snippet"
  const resultPattern = /<div[^>]*class="[^"]*result\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result\b|<\/div>\s*<\/div>)/gi;

  // Also try the links table pattern used by DDG lite
  const linkPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  // Try the standard result page format first
  const links: { url: string; title: string }[] = [];
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    let url = match[1];
    // DDG wraps URLs in a redirect — extract the real URL
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      try { url = decodeURIComponent(uddgMatch[1]); } catch { /* keep original */ }
    }
    links.push({ url, title: stripTags(match[2]).trim() });
  }

  const snippets: string[] = [];
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(stripTags(match[1]).trim());
  }

  // Pair up links with snippets
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (!link.url || link.url.startsWith('javascript:') || link.url.includes('duckduckgo.com')) continue;
    results.push({
      title: link.title || link.url,
      url: link.url,
      snippet: snippets[i] || '',
    });
  }

  // If the standard parser didn't find results, try the lite/plain text format
  if (results.length === 0) {
    // DDG lite uses a simpler table structure
    const litePattern = /<a[^>]*rel="nofollow"[^>]*href="([^"]*)"[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = litePattern.exec(html)) !== null) {
      let url = match[1];
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try { url = decodeURIComponent(uddgMatch[1]); } catch { /* keep original */ }
      }
      if (!url || url.startsWith('javascript:') || url.includes('duckduckgo.com')) continue;
      results.push({
        title: stripTags(match[2]).trim() || url,
        url,
        snippet: '',
      });
    }
  }

  // Final fallback: just grab all external links that look like search results
  if (results.length === 0) {
    const allLinks = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set<string>();
    while ((match = allLinks.exec(html)) !== null) {
      const url = match[1];
      if (url.includes('duckduckgo.com') || url.includes('proxy.shakespeare') || seen.has(url)) continue;
      seen.add(url);
      const title = stripTags(match[2]).trim();
      if (title.length > 5 && title.length < 200) {
        results.push({ title, url, snippet: '' });
      }
    }
  }

  return results;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function toSearchResult(r: DDGRawResult, index: number): SearchResult {
  return {
    id: `ddg-${r.url}`,
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    source: 'web',
    provider: 'duckduckgo',
    domain: extractDomain(r.url),
    engine: 'DuckDuckGo',
    score: 78 - index * 0.5,
  };
}

export const duckduckgoProvider: SearchProvider = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  source: 'web',
  privacy: 'proxied',
  privacyNote: 'Routed through a CORS proxy to DuckDuckGo\u2019s HTML endpoint. The proxy sees the query in plaintext.',

  async search({ query, signal, limit = 20 }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    // Try the standard DDG HTML page
    const targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`;
    const proxied = `${CORS_PROXY}${encodeURIComponent(targetUrl)}`;

    try {
      const res = await fetch(proxied, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
        headers: { Accept: 'text/html' },
      });

      if (!res.ok) return { results: [] };

      const html = await res.text();
      const raw = parseDDGResults(html);
      return { results: raw.slice(0, limit).map(toSearchResult) };
    } catch {
      return { results: [] };
    }
  },
};

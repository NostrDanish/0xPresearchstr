/**
 * Tor hidden service search provider — Ahmia.fi scraper.
 *
 * Ahmia is the established, policy-compliant .onion search engine.
 * It provides clearnet access and enforces content policy (CSAM filtering, etc.).
 */
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

const CORS_PROXY = 'https://proxy.shakespeare.diy/?url=';

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

interface AhmiaRawResult {
  title: string;
  url: string;
  onion: string;
  description: string;
}

function parseAhmiaResults(html: string): AhmiaRawResult[] {
  const results: AhmiaRawResult[] = [];
  const resultPattern = /<li[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = resultPattern.exec(html)) !== null) {
    const block = match[1];
    const linkMatch = block.match(/<h4>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const rawUrl = linkMatch[1];
    const title = stripTags(linkMatch[2]).trim();

    const descMatch = block.match(/<(?:p|span)[^>]*class="[^"]*(?:description|desc)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|span)>/i);
    const description = descMatch ? stripTags(descMatch[1]).trim() : '';

    const onionMatch = block.match(/([a-z2-7]{16,56}\.onion)/i);
    const onion = onionMatch ? onionMatch[1] : '';

    let url = rawUrl;
    const redirectMatch = rawUrl.match(/redirect_url=([^&]+)/);
    if (redirectMatch) {
      try { url = decodeURIComponent(redirectMatch[1]); } catch { url = rawUrl; }
    }

    if (!url.includes('.onion') && !onion) continue;

    results.push({
      title: title || onion || 'Untitled',
      url: url.startsWith('http') ? url : `http://${onion}`,
      onion,
      description,
    });
  }

  return results;
}

function toSearchResult(r: AhmiaRawResult, index: number): SearchResult {
  return {
    id: `tor-${r.url}`,
    title: r.title,
    url: r.url,
    snippet: r.description,
    source: 'tor',
    provider: 'tor',
    domain: r.onion || undefined,
    kind: '.onion',
    engine: 'Ahmia',
    score: 50 - index * 0.5,
  };
}

export const torProvider: SearchProvider = {
  id: 'tor',
  name: 'Tor (Ahmia)',
  source: 'tor',
  privacy: 'proxied',
  privacyNote: 'Routed through a CORS proxy to Ahmia.fi. The proxy and Ahmia can see the query.',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const targetUrl = `https://ahmia.fi/search/?q=${encodeURIComponent(query.trim())}`;
    const proxied = `${CORS_PROXY}${encodeURIComponent(targetUrl)}`;

    try {
      const res = await fetch(proxied, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
          : AbortSignal.timeout(12000),
        headers: { Accept: 'text/html' },
      });

      if (!res.ok) return { results: [] };

      const html = await res.text();
      const raw = parseAhmiaResults(html);
      return { results: raw.map(toSearchResult) };
    } catch {
      return { results: [] };
    }
  },
};

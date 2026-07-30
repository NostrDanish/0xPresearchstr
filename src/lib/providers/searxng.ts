/**
 * SearXNG meta-search provider — queries public SearXNG instances with failover.
 *
 * Aggregates web results from DuckDuckGo, Brave, Wikipedia, and dozens
 * of other engines. Races multiple instances in parallel for speed,
 * with sequential failover if needed.
 *
 * Instance pool is DYNAMIC (searxist-style):
 *   - User-added custom instances always go first
 *   - Public instances are auto-discovered from searx.space (privacy-filtered)
 *   - Per-instance health tracking demotes failing instances
 *   - Hardcoded seeds remain as a bootstrap fallback
 */
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';
import {
  getInstanceUrls,
  refreshDiscoveredInstances,
  recordInstanceSuccess,
  recordInstanceFailure,
} from '@/lib/searxngInstances';

const CORS_PROXY = 'https://proxy.shakespeare.diy/?url=';

/** How many instances to race in the first parallel batch. */
const PARALLEL_BATCH = 4;

/** Cap the sequential fallback so a dead pool doesn't hang the search. */
const MAX_FALLBACK = 5;

interface RawSearXNGResult {
  title: string;
  url: string;
  content: string;
  engine: string;
  category: string;
  thumbnail?: string;
  publishedDate?: string;
}

interface RawSearXNGResponse {
  results: RawSearXNGResult[];
  suggestions: string[];
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function toSearchResult(r: RawSearXNGResult, index: number): SearchResult {
  return {
    id: `searxng-${r.url}`,
    title: r.title || extractDomain(r.url),
    url: r.url,
    snippet: stripHtml(r.content || ''),
    source: 'web',
    provider: 'searxng',
    domain: extractDomain(r.url),
    engine: r.engine || undefined,
    thumbnail: r.thumbnail || undefined,
    timestamp: r.publishedDate ? Math.floor(new Date(r.publishedDate).getTime() / 1000) || undefined : undefined,
    score: 80 - index * 0.5,
  };
}

async function queryInstance(
  instanceUrl: string,
  query: string,
  signal?: AbortSignal,
): Promise<RawSearXNGResponse | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    categories: 'general',
    language: 'en',
    pageno: '1',
  });

  const target = `${instanceUrl}/search?${params.toString()}`;
  const proxied = `${CORS_PROXY}${encodeURIComponent(target)}`;
  const start = performance.now();

  try {
    const res = await fetch(proxied, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      recordInstanceFailure(instanceUrl);
      return null;
    }
    const data = await res.json() as RawSearXNGResponse;
    if (!data.results || !Array.isArray(data.results)) {
      recordInstanceFailure(instanceUrl);
      return null;
    }
    recordInstanceSuccess(instanceUrl, Math.round(performance.now() - start), data.results.length);
    return data;
  } catch {
    recordInstanceFailure(instanceUrl);
    return null;
  }
}

export const searxngProvider: SearchProvider = {
  id: 'searxng',
  name: 'SearXNG',
  source: 'web',
  privacy: 'proxied',
  privacyNote: 'Routed through a CORS proxy to public SearXNG instances. The proxy and the instance operator can see the query.',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const q = query.trim();

    // Kick off (or refresh) instance discovery in the background.
    // First search uses seeds; subsequent searches use the live pool.
    void refreshDiscoveredInstances();

    const instances = getInstanceUrls();

    // Phase 1: Race the first batch of instances in parallel.
    // First one to return good results wins.
    const parallelBatch = instances.slice(0, PARALLEL_BATCH);
    const raceResult = await raceForResults(parallelBatch, q, signal);
    if (raceResult) return raceResult;

    // Phase 2: Sequential fallback through remaining instances.
    const fallbackBatch = instances.slice(PARALLEL_BATCH, PARALLEL_BATCH + MAX_FALLBACK);
    for (const instance of fallbackBatch) {
      const data = await queryInstance(instance, q, signal);
      if (data && data.results.length > 0) {
        return {
          results: data.results.map(toSearchResult),
          suggestions: data.suggestions ?? [],
        };
      }
    }

    return { results: [], suggestions: [] };
  },
};

/**
 * Race multiple SearXNG instances in parallel.
 * Returns the first response with results, or null if all fail.
 */
async function raceForResults(
  instances: string[],
  query: string,
  signal?: AbortSignal,
): Promise<ProviderSearchResponse | null> {
  if (instances.length === 0) return null;

  return new Promise((resolve) => {
    let resolved = false;
    let remaining = instances.length;

    for (const instance of instances) {
      queryInstance(instance, query, signal).then((data) => {
        if (resolved) return;
        remaining--;

        if (data && data.results.length > 0) {
          resolved = true;
          resolve({
            results: data.results.map(toSearchResult),
            suggestions: data.suggestions ?? [],
          });
          return;
        }

        // If this was the last one and none succeeded, resolve null.
        if (remaining === 0 && !resolved) {
          resolved = true;
          resolve(null);
        }
      }).catch(() => {
        remaining--;
        if (remaining === 0 && !resolved) {
          resolved = true;
          resolve(null);
        }
      });
    }
  });
}

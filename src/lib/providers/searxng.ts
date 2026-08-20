/**
 * SearXNG meta-search provider — queries public SearXNG instances with failover.
 *
 * Aggregates web results from DuckDuckGo, Brave, Wikipedia, and dozens
 * of other engines. Races multiple instances in parallel for speed,
 * with sequential failover if needed.
 *
 * Instance pool is DYNAMIC (searxist-style):
 *   - User-added custom instances always go first
 *   - Public instances are auto-discovered from searx.space (privacy-filtered,
 *     ON by default) — the top 4 are auto-activated, language-aware when a
 *     result language filter is set
 *   - Per-instance health tracking demotes failing instances
 *   - Hardcoded seeds run only as the cold-start bootstrap, before the first
 *     discovery fetch lands (or when discovery is turned off)
 */
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';
import {
  getInstanceUrls,
  refreshDiscoveredInstances,
  recordInstanceSuccess,
  recordInstanceFailure,
} from '@/lib/searxngInstances';
import { proxiedFetch } from '@/lib/corsProxy';
import { getWebEngineBases } from './enginePriority';
import { searxngLanguageParam } from '@/lib/languageFilter';

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
    // The fallback band: always below the lead engine (Brave with a key,
    // else DuckDuckGo) — SearXNG fills in when the lead is gated or slow.
    score: getWebEngineBases().searxng - index * 0.5,
  };
}

async function queryInstance(
  instanceUrl: string,
  query: string,
  signal?: AbortSignal,
  languages?: string[],
): Promise<RawSearXNGResponse | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    categories: 'general',
    // Pin the strong clearnet engine mix: instances default to whatever the
    // operator enabled (often Google-blocked or thin setups), which is why
    // raw SearXNG results underperformed a direct DDG query. Instances that
    // lack an engine just skip it.
    engines: 'duckduckgo,brave,startpage,mojeek,wikipedia',
    pageno: '1',
  });
  // Result language filter (Settings → General). SearXNG honors `language`
  // server-side (single code or comma-separated list); instances whose
  // engine mix can't serve the filter just return fewer/looser hits, and
  // the failover race moves on.
  const langParam = searxngLanguageParam(languages ?? []);
  if (langParam) params.set('language', langParam);

  const target = `${instanceUrl}/search?${params.toString()}`;
  const start = performance.now();

  try {
    const res = await proxiedFetch(target, {
      signal,
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
    // When a language-filtered search succeeds, this instance has PROVEN it
    // can serve those languages — record the competence so the pool ranks
    // it ahead of unproven instances on later filtered searches.
    recordInstanceSuccess(instanceUrl, Math.round(performance.now() - start), data.results.length, languages);
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

  async search({ query, signal, languages }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const q = query.trim();

    // Kick off (or refresh) instance discovery in the background — on by
    // default. The very first search uses the bootstrap seeds; subsequent
    // searches race the auto-picked discovered set.
    void refreshDiscoveredInstances();

    // Language-aware when the filter is on: instances that have proven they
    // serve the filtered languages rank first.
    const instances = getInstanceUrls(languages);

    // Phase 1: Race the first batch of instances in parallel.
    // First one to return good results wins.
    const parallelBatch = instances.slice(0, PARALLEL_BATCH);
    const raceResult = await raceForResults(parallelBatch, q, signal, languages);
    if (raceResult) return raceResult;

    // Phase 2: Sequential fallback through remaining instances.
    const fallbackBatch = instances.slice(PARALLEL_BATCH, PARALLEL_BATCH + MAX_FALLBACK);
    for (const instance of fallbackBatch) {
      const data = await queryInstance(instance, q, signal, languages);
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
  languages?: string[],
): Promise<ProviderSearchResponse | null> {
  if (instances.length === 0) return null;

  return new Promise((resolve) => {
    let resolved = false;
    let remaining = instances.length;

    for (const instance of instances) {
      queryInstance(instance, query, signal, languages).then((data) => {
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

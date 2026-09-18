/**
 * Parallel Search provider — the Parallel Search API (BYOK).
 *
 * Parallel (parallel.ai) returns ranked URLs with LONG extended excerpts —
 * denser, more relevant snippets than a classic engine's two-liner, which is
 * exactly what both the result cards and the SIP-01 auto-indexer thrive on
 * (richer descriptions → better observations → a better shared index).
 * Free starting credits when you create a key; the key is stored in this
 * browser only (localStorage) and sent nowhere except Parallel's API
 * (via the CORS proxy — disclosed below and in Settings → Privacy).
 *
 * No key configured → the provider is a zero-cost no-op.
 *
 * Operator translation (queryParser): site:/domain: → include_domains,
 * NOT site: → exclude_domains, after: → after_date. type:/tag:/lang:/
 * before: stay local (merge-layer enforcement) — Parallel has no params
 * for them.
 */
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';
import { proxiedFetch } from '@/lib/corsProxy';
import { textOnly, toEngineQuery } from '@/lib/queryParser';
import { getEngineSearchStatus } from '@/lib/engineSearch';

const LS_PARALLEL_KEY = 'presearchstr:parallel-api-key';
const API_URL = 'https://api.parallel.ai/v1/search';

/** Read the user's Parallel API key (empty when unset). */
export function getParallelApiKey(): string {
  try {
    return (localStorage.getItem(LS_PARALLEL_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

/** Store/clear the user's Parallel API key (Settings). */
export function setParallelApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(LS_PARALLEL_KEY, trimmed);
    else localStorage.removeItem(LS_PARALLEL_KEY);
  } catch {
    // Storage unavailable — the provider just stays dormant.
  }
}

interface ParallelResult {
  url?: string;
  title?: string | null;
  publish_date?: string | null;
  excerpts?: string[];
}

interface ParallelSearchResponse {
  results?: ParallelResult[];
}

interface ParallelSourcePolicy {
  include_domains?: string[];
  exclude_domains?: string[];
  after_date?: string;
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/**
 * Parallel excerpts are markdown-formatted; SIP-01 descriptions and result
 * cards are plain text. Flatten the common markdown constructs.
 */
function flattenMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
    .replace(/^#{1,6}\s+/gm, '')               // headings
    .replace(/[*_~`]+/g, '')                   // emphasis / code ticks
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a site:/domain: filter value to a bare host for source policies. */
function hostOf(value: string): string {
  return value.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split('/')[0]
    .replace(/^\*\./, '');
}

function toSearchResult(r: ParallelResult, index: number): SearchResult | null {
  if (!r.url || !/^https?:\/\//i.test(r.url)) return null;
  const title = (r.title ?? '').trim() || extractDomain(r.url);
  // The excerpts are the gold — dense, relevant text. Join up to two,
  // flattened to plain text, capped: result cards show ~3 lines and SIP-01
  // descriptions cap at 1000.
  const snippet = flattenMarkdown(
    (r.excerpts ?? [])
      .map((e) => e.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' … '),
  ).slice(0, 600);
  const ts = r.publish_date ? Math.floor(Date.parse(r.publish_date) / 1000) : NaN;

  return {
    id: `parallel-${r.url}`,
    title,
    url: r.url,
    snippet,
    source: 'web',
    provider: 'parallel',
    domain: extractDomain(r.url),
    engine: 'Parallel',
    timestamp: Number.isFinite(ts) ? ts : undefined,
    // Between the lead engine (80) and the SearXNG fallback band (78),
    // always — with or without other keys.
    score: 79.5 - index * 0.5,
  };
}

export const parallelProvider: SearchProvider = {
  id: 'parallel',
  name: 'Parallel',
  source: 'web',
  privacy: 'proxied',
  privacyNote: 'Parallel Search API with your own key. The query + your key go to Parallel (via the CORS proxy, which sees both). No key configured = provider inactive.',

  async search({ query, signal, limit = 10, parsed }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    // Credential tiers: the user's own BYOK key always wins; otherwise the
    // deployment's engine-provided key via the same-origin proxy
    // (server-side secret — the 0xSigner-shaped path).
    const ownKey = getParallelApiKey();
    const viaEngine = !ownKey && (await getEngineSearchStatus()).parallel;
    if (!ownKey && !viaEngine) return { results: [] };

    // objective = the full natural-language query; search_queries = concise
    // keyword form (the API's required field). The text residue keeps
    // operator noise out of the keyword slot.
    const text = parsed ? (textOnly(parsed) || query.trim()) : query.trim();
    const engineQuery = parsed ? (toEngineQuery(parsed) || text) : text;
    if (!text) return { results: [] };

    // Translate the operators Parallel understands natively. The merge
    // layer enforces everything else locally regardless.
    const sourcePolicy: ParallelSourcePolicy = {};
    if (parsed) {
      const include = parsed.filters
        .filter((f) => (f.field === 'site' || f.field === 'domain') && !f.negated)
        .map((f) => hostOf(f.value))
        .filter(Boolean);
      const exclude = parsed.filters
        .filter((f) => (f.field === 'site' || f.field === 'domain') && f.negated)
        .map((f) => hostOf(f.value))
        .filter(Boolean);
      const after = parsed.filters.find((f) => f.field === 'after' && !f.negated);
      if (include.length > 0) sourcePolicy.include_domains = [...new Set(include)];
      if (exclude.length > 0) sourcePolicy.exclude_domains = [...new Set(exclude)];
      if (after && /^\d{4}-\d{2}-\d{2}$/.test(after.value.trim())) {
        sourcePolicy.after_date = after.value.trim();
      }
    }

    const body: Record<string, unknown> = {
      objective: query.trim(),
      search_queries: [engineQuery],
      // fast = high quality inside a ~1s budget — the right point for
      // interactive search (advanced/turbo trade latency both ways).
      mode: 'fast',
      max_chars_total: 8000,
      advanced_settings: {
        max_results: Math.min(Math.max(limit, 1), 20),
        ...(Object.keys(sourcePolicy).length > 0 ? { source_policy: sourcePolicy } : {}),
      },
    };

    try {
      // Engine tier: same-origin proxy, no key in the browser. BYOK tier:
      // the user's own key to Parallel via the CORS proxy.
      const res = viaEngine
        ? await fetch('/api/search/parallel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
            signal: signal ?? AbortSignal.timeout(15000),
          })
        : await proxiedFetch(API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'x-api-key': ownKey,
            },
            body: JSON.stringify(body),
            signal: signal ?? AbortSignal.timeout(15000),
          });
      if (!res.ok) return { results: [] };

      const data = (await res.json()) as ParallelSearchResponse;
      const results = (data.results ?? [])
        .map(toSearchResult)
        .filter((r): r is SearchResult => r !== null);

      return { results };
    } catch {
      return { results: [] };
    }
  },
};

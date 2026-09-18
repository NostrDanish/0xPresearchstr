/**
 * Brave Search provider — the official Brave Search API (BYOK).
 *
 * Brave has a free tier (2,000 queries/month) but requires an API key.
 * Since embedding a shared key client-side would pool+exhaust the quota,
 * users paste THEIR OWN free key in Settings → SearXNG & Brave
 * (localStorage only, never sent anywhere except Brave's API).
 *
 * No key configured → the provider is a zero-cost no-op.
 *
 * CORS: api.search.brave.com doesn't send CORS headers, so the request
 * routes through the CORS proxy (which forwards the subscription token
 * header). privacy tier = 'proxied' — honest about the proxy seeing
 * query + key.
 */
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';
import { proxiedFetch } from '@/lib/corsProxy';
import { getWebEngineBases } from './enginePriority';
import { braveLanguageParam } from '@/lib/languageFilter';
import { toEngineQuery } from '@/lib/queryParser';
import { getEngineSearchStatus } from '@/lib/engineSearch';
const LS_BRAVE_KEY = 'presearchstr:brave-api-key';
const API_URL = 'https://api.search.brave.com/res/v1/web/search';

/** Read the user's Brave API key (empty when unset). */
export function getBraveApiKey(): string {
  try {
    return (localStorage.getItem(LS_BRAVE_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

/** Store/clear the user's Brave API key (Settings). */
export function setBraveApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(LS_BRAVE_KEY, trimmed);
    else localStorage.removeItem(LS_BRAVE_KEY);
  } catch {
    // Storage unavailable — the provider just stays dormant.
  }
}

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export const braveProvider: SearchProvider = {
  id: 'brave',
  name: 'Brave',
  source: 'web',
  privacy: 'proxied',
  privacyNote: 'Brave Search API with your own free key. The query + your key go to Brave (via the CORS proxy, which sees both). No key configured = provider inactive.',

  async search({ query, signal, limit = 20, languages, parsed }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    // Credential tiers: the user's own BYOK key always wins; otherwise the
    // deployment's engine-provided key via the same-origin proxy (server-side
    // secret — the 0xSigner-shaped path, nothing in the browser).
    const ownKey = getBraveApiKey();
    const viaEngine = !ownKey && (await getEngineSearchStatus()).brave;
    if (!ownKey && !viaEngine) return { results: [] };

    // Brave natively understands -exclusions, quotes, site:, intitle:,
    // before:/after: — the translation layer maps our syntax onto it.
    const engineQuery = parsed ? toEngineQuery(parsed) : query.trim();
    if (!engineQuery) return { results: [] };

    const params = new URLSearchParams({
      q: engineQuery,
      count: String(Math.min(limit, 20)),
      text_decorations: '0',
    });
    // Result language filter: Brave honors one search_lang server-side.
    // An explicit lang: operator in the query overrides the Settings filter.
    const queryLangs = parsed?.filters.filter((f) => f.field === 'lang' && !f.negated).map((f) => f.value.toLowerCase());
    const lang = braveLanguageParam(queryLangs && queryLangs.length > 0 ? queryLangs : (languages ?? []));
    if (lang) params.set('search_lang', lang);

    try {
      // Engine tier: same-origin proxy, no key in the browser. BYOK tier:
      // the user's own key to Brave via the CORS proxy.
      const res = viaEngine
        ? await fetch(`/api/search/brave?${params}`, {
            signal,
            headers: { Accept: 'application/json' },
          })
        : await proxiedFetch(`${API_URL}?${params}`, {
            signal,
            headers: {
              Accept: 'application/json',
              'X-Subscription-Token': ownKey,
            },
          });

      if (!res.ok) return { results: [] };

      const data = (await res.json()) as BraveSearchResponse;
      const raw = data.web?.results ?? [];

      const results: SearchResult[] = raw
        .filter((r): r is BraveWebResult & { title: string; url: string } => !!r.title && !!r.url)
        .slice(0, limit)
        .map((r, i) => ({
          id: `brave-${r.url}`,
          title: r.title,
          url: r.url,
          snippet: r.description ?? '',
          source: 'web',
          provider: 'brave',
          domain: extractDomain(r.url),
          engine: 'Brave',
          // Leads the organic web band when the user has set their API key
          // (the moment a key exists, Brave becomes the default engine);
          // otherwise dormant — see enginePriority.ts.
          score: getWebEngineBases().brave - i * 0.5,
        }));

      return { results };
    } catch {
      return { results: [] };
    }
  },
};

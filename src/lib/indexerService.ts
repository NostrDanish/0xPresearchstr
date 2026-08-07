/**
 * Indexer service client — talks to the autosigner Cloudflare Worker.
 *
 * The worker (see worker.ts) holds the indexer key as a Cloudflare secret
 * and signs kind 30078 cache events server-side. Every visitor's searches
 * auto-index through it — no key material in the browser, and the service
 * rate-limits + dedupes instead of trusting the client.
 *
 * Same-origin on the deployed site (/api/index). Forks can point
 * INDEXER_SERVICE_URL at any compatible endpoint.
 *
 * When the service is unreachable (static hosting, preview, worker down),
 * callers should fall back to the legacy embedded-key path.
 */

/** Signing endpoint. Same-origin by default — the worker serves the app. */
export const INDEXER_SERVICE_URL = '/api/index';

/** Minimal result shape the worker accepts (it strips everything else). */
interface ServiceResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  provider: string;
}

export interface ServiceIndexResponse {
  ok: boolean;
  id?: string;
  skipped?: string;
  published?: string[];
  failed?: string[];
  reason?: string;
}

/**
 * Ask the autosigner service to sign + publish a cache event for a query.
 * Returns true on success (including "recently_indexed" skips), false on
 * any failure — the caller decides whether to fall back to local signing.
 */
export async function indexViaService(
  query: string,
  results: ServiceResult[],
  timeoutMs = 10_000,
): Promise<boolean> {
  try {
    const res = await fetch(INDEXER_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, results }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as ServiceIndexResponse;
    return data.ok === true;
  } catch {
    return false;
  }
}

export interface IndexerServiceStatus {
  ok: boolean;
  /** Indexer pubkey reported by the service (hex), when configured. */
  pubkey?: string;
  /** Round-trip latency in ms. */
  latencyMs?: number;
  error?: string;
}

/**
 * Health check for the autosigner service — used by Settings → Autosigner
 * to prove the live deployment's signing pipeline works.
 */
export async function checkIndexerService(timeoutMs = 8_000): Promise<IndexerServiceStatus> {
  const start = performance.now();
  try {
    const res = await fetch(INDEXER_SERVICE_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { ok?: boolean; pubkey?: string };
    return { ok: data.ok === true, pubkey: data.pubkey, latencyMs };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : 'Unreachable',
    };
  }
}

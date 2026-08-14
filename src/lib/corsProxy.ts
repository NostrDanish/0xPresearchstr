/**
 * CORS proxy with failover — the single point through which all
 * browser-blocked HTTP calls route (SearXNG instances, DDG HTML, Brave,
 * Ahmia, AI providers, searx.space discovery).
 *
 * Why a list: the primary proxy is a single point of failure — when it
 * 522s, every proxied provider silently returns empty. Now each request
 * walks the pool in order and the first working proxy answers.
 *
 * Semantics:
 *   - Proxy-level failure (network error, 5xx, 429) → try the next proxy.
 *   - Target-level 4xx (400/401/403/404) is a REAL answer from the
 *     destination API — returned to the caller immediately (the AI
 *     provider's argument-retry logic depends on reading those).
 */

/** Proxy URL templates, tried in order. Each takes encodeURIComponent(url). */
const CORS_PROXIES = [
  'https://proxy.shakespeare.diy/?url=',
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
];

/** Per-attempt timeout (each proxy gets its own window). */
const ATTEMPT_TIMEOUT_MS = 12_000;

export async function proxiedFetch(
  url: string,
  init?: RequestInit,
  /** Per-attempt timeout override (AI completions run long). */
  attemptTimeoutMs = ATTEMPT_TIMEOUT_MS,
): Promise<Response> {
  // Same-origin relative URLs (the engine-AI proxy lives at /api/ai/*)
  // need no CORS proxy at all — and must never be routed through one,
  // since that would send engine-tier traffic to a third party.
  if (url.startsWith('/')) return fetch(url, init);

  let lastError: unknown = new Error('All CORS proxies failed');

  for (const proxy of CORS_PROXIES) {
    try {
      const signal = AbortSignal.any([
        ...(init?.signal ? [init.signal] : []),
        AbortSignal.timeout(attemptTimeoutMs),
      ]);
      const res = await fetch(`${proxy}${encodeURIComponent(url)}`, { ...init, signal });

      // Target answered (even with an error status) → hand it to the caller.
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) return res;

      // 5xx / 429 → proxy or target gateway trouble; try the next proxy.
      lastError = new Error(`HTTP ${res.status} via ${new URL(proxy).hostname}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All CORS proxies failed');
}

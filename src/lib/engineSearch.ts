/**
 * Engine-provided search keys — the 0xSigner-shaped tier.
 *
 * When the operator deployed worker.ts with BRAVE_API_KEY / PARALLEL_API_KEY
 * secrets, the browser can search those engines via the SAME-ORIGIN proxy
 * (/api/search/*) with NO key in the browser at all — the worker injects
 * the operator's key server-side. A user's own BYOK key always wins.
 *
 * This mirrors the engine-AI tier (/api/ai/*) and is the delegation surface
 * a future 0xSigner takes over: Search engine → signer/proxy → provider.
 *
 * Static deployments have no /api/search/* routes — the status fetch fails
 * and both providers report unconfigured, so everything degrades to BYOK.
 */

export interface EngineSearchStatus {
  brave: boolean;
  parallel: boolean;
}

const NONE: EngineSearchStatus = { brave: false, parallel: false };

let cached: EngineSearchStatus | null = null;
let cachedAt = 0;
let inflight: Promise<EngineSearchStatus> | null = null;

/** Fetch (cached 5 min) which engine search providers the deployment offers. */
export function getEngineSearchStatus(): Promise<EngineSearchStatus> {
  if (cached && Date.now() - cachedAt < 5 * 60_000) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = fetch('/api/search/status', { headers: { Accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) return NONE;
      const data = (await res.json()) as Partial<EngineSearchStatus>;
      return { brave: data.brave === true, parallel: data.parallel === true };
    })
    .catch(() => NONE)
    .then((status) => {
      cached = status;
      cachedAt = Date.now();
      return status;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/**
 * Presearchstr AI proxy — Cloudflare Worker.
 *
 * ONE job: let the engine operator offer AI answers to all users without
 * the API key ever touching a browser, the repo, or a public response.
 *
 * Routes (same origin as the static app):
 *   GET  /api/ai/status            → public config status (masked, no secrets)
 *   POST /api/ai/chat/completions  → OpenAI-compatible proxy, key injected here
 *   GET  /api/ai/models            → provider model list (admin UI helper)
 *   POST /api/ai/admin             → NIP-98-signed config writes (owner key only, KV)
 *   GET  /api/search/status        → which engine search providers are configured
 *   GET  /api/search/brave         → Brave Search proxy, key injected here
 *   POST /api/search/parallel      → Parallel Search proxy, key injected here
 *
 * Operator configuration (nothing secret in the repo):
 *   wrangler secret put AI_API_KEY            ← the actual key (env-only mode)
 *   wrangler secret put BRAVE_API_KEY         ← engine-provided Brave Search
 *   wrangler secret put PARALLEL_API_KEY      ← engine-provided Parallel Search
 *   AI_PROVIDER_ENDPOINT / AI_MODEL / AI_PROVIDER_NAME / AI_ENGINE_ENABLED (vars)
 *   OWNER_PUBKEY (var, hex)                   ← enables the Admin → AI tab
 *   AI_CONFIG_KV (KV binding, optional)       ← enables admin-UI-managed config
 *
 * The /api/search/* routes are the 0xSigner delegation surface: provider
 * credentials live server-side (or later inside 0xSigner), the browser only
 * ever talks same-origin and never holds an engine key.
 *
 * KV config wins over env vars. Neither present → status reports
 * "not configured" and chat returns 503 — fresh clones stay fully
 * functional with AI simply unavailable until a user adds their own key.
 *
 * No logging of request bodies, keys, or provider error payloads anywhere.
 */
import {
  readEngineConfig,
  writeEngineConfig,
  buildPublicStatus,
  validateChatPayload,
  buildUpstreamBody,
  sanitizeProviderError,
  verifyAdminAuth,
  parseAdminAction,
  applyAdminAction,
  type EngineAIEnv,
} from './src/lib/ai/engineProxy';

interface Env extends EngineAIEnv {
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  /** Engine-provided Brave Search key (wrangler secret) — server-side only. */
  BRAVE_API_KEY?: string;
  /** Engine-provided Parallel Search key (wrangler secret) — server-side only. */
  PARALLEL_API_KEY?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Never cache a response derived from server-side config.
      'Cache-Control': 'no-store',
    },
  });
}

/** Best-effort per-IP rate limit (in-memory per isolate — good enough for abuse blunting). */
const hits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_PER_MINUTE = 20;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  if (hits.size > 10_000) hits.clear(); // bound memory under flood
  return entry.count > RATE_LIMIT_PER_MINUTE;
}

/** Forward a validated chat request to the configured provider. */
async function proxyChat(request: Request, env: Env): Promise<Response> {
  const config = await readEngineConfig(env);
  if (!config || !config.enabled) {
    return json({ error: { message: 'Engine AI is not configured on this deployment', type: 'unavailable' } }, 503);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'anonymous';
  if (rateLimited(ip)) {
    return json({ error: { message: 'Rate limit exceeded — slow down', type: 'rate_limited' } }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: 'Body must be JSON', type: 'invalid_request' } }, 400);
  }

  const payload = validateChatPayload(body);
  if (typeof payload === 'string') {
    return json({ error: { message: payload, type: 'invalid_request' } }, 400);
  }

  const upstream = await fetch(`${config.endpoint.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`, // server-side only, never logged
    },
    body: JSON.stringify(buildUpstreamBody(payload, config)),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);

  if (!upstream) {
    return json({ error: { message: 'AI provider unreachable', type: 'upstream_unavailable' } }, 502);
  }

  if (!upstream.ok) {
    // Drain without reading into memory/logging — upstream bodies can echo
    // request details; clients get a sanitized message only.
    await upstream.body?.cancel().catch(() => undefined);
    return json(
      { error: { message: sanitizeProviderError(upstream.status), type: 'provider_error' } },
      upstream.status === 429 ? 429 : 502,
    );
  }

  const data = await upstream.json();
  return json(data);
}

/** Proxied model list for the admin "Load models" helper. */
async function proxyModels(env: Env): Promise<Response> {
  const config = await readEngineConfig(env);
  if (!config) {
    return json({ error: { message: 'Engine AI is not configured', type: 'unavailable' } }, 503);
  }

  const upstream = await fetch(`${config.endpoint.replace(/\/$/, '')}/models`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!upstream || !upstream.ok) {
    await upstream?.body?.cancel().catch(() => undefined);
    return json({ error: { message: 'Could not load models from the provider', type: 'provider_error' } }, 502);
  }

  return json(await upstream.json());
}

/* ------------------------------------------------------------------ */
/* Engine-provided search keys (Brave / Parallel) — server-side only    */
/* ------------------------------------------------------------------ */

/** Public status: which engine search providers are configured. Booleans only. */
function searchStatus(env: Env): Response {
  return json({
    brave: typeof env.BRAVE_API_KEY === 'string' && env.BRAVE_API_KEY.length > 0,
    parallel: typeof env.PARALLEL_API_KEY === 'string' && env.PARALLEL_API_KEY.length > 0,
  });
}

/** GET /api/search/brave?q=…&count=…&search_lang=… — Brave proxy, key injected here. */
async function proxyBrave(request: Request, env: Env): Promise<Response> {
  if (!env.BRAVE_API_KEY) {
    return json({ error: { message: 'Engine Brave is not configured on this deployment', type: 'unavailable' } }, 503);
  }
  const ip = `${request.headers.get('CF-Connecting-IP') ?? 'anonymous'}:search`;
  if (rateLimited(ip)) {
    return json({ error: { message: 'Rate limit exceeded — slow down', type: 'rate_limited' } }, 429);
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 400);
  if (!q) return json({ error: { message: 'Missing q', type: 'invalid_request' } }, 400);
  const count = Math.min(Math.max(parseInt(url.searchParams.get('count') ?? '10', 10) || 10, 1), 20);

  const upstream = new URL('https://api.search.brave.com/res/v1/web/search');
  upstream.searchParams.set('q', q);
  upstream.searchParams.set('count', String(count));
  upstream.searchParams.set('text_decorations', '0');
  const lang = url.searchParams.get('search_lang');
  if (lang && /^[a-z]{2}$/i.test(lang)) upstream.searchParams.set('search_lang', lang.toLowerCase());
  const country = url.searchParams.get('country');
  if (country && /^[a-z]{2}$/i.test(country)) upstream.searchParams.set('country', country.toUpperCase());

  const res = await fetch(upstream, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': env.BRAVE_API_KEY },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res) return json({ error: { message: 'Brave unreachable', type: 'upstream_unavailable' } }, 502);
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return json({ error: { message: sanitizeProviderError(res.status), type: 'provider_error' } }, res.status === 429 ? 429 : 502);
  }
  return json(await res.json());
}

/** POST /api/search/parallel — Parallel Search proxy, key injected here. */
async function proxyParallel(request: Request, env: Env): Promise<Response> {
  if (!env.PARALLEL_API_KEY) {
    return json({ error: { message: 'Engine Parallel is not configured on this deployment', type: 'unavailable' } }, 503);
  }
  const ip = `${request.headers.get('CF-Connecting-IP') ?? 'anonymous'}:search`;
  if (rateLimited(ip)) {
    return json({ error: { message: 'Rate limit exceeded — slow down', type: 'rate_limited' } }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: { message: 'Body must be JSON', type: 'invalid_request' } }, 400);
  }

  // Validate + bound the payload (never forward arbitrary bodies upstream).
  const objective = typeof body.objective === 'string' ? body.objective.trim().slice(0, 1000) : '';
  const queries = Array.isArray(body.search_queries)
    ? body.search_queries.filter((q): q is string => typeof q === 'string').map((q) => q.slice(0, 200)).slice(0, 5)
    : [];
  if (queries.length === 0) {
    return json({ error: { message: 'search_queries must be a non-empty string array', type: 'invalid_request' } }, 400);
  }
  const mode = typeof body.mode === 'string' && ['turbo', 'fast', 'basic', 'advanced'].includes(body.mode) ? body.mode : 'fast';

  const res = await fetch('https://api.parallel.ai/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': env.PARALLEL_API_KEY, // server-side only, never logged
    },
    body: JSON.stringify({
      ...(objective ? { objective } : {}),
      search_queries: queries,
      mode,
      ...(typeof body.max_chars_total === 'number' ? { max_chars_total: Math.min(Math.max(Math.floor(body.max_chars_total), 500), 20000) } : {}),
      ...(typeof body.advanced_settings === 'object' && body.advanced_settings !== null ? { advanced_settings: body.advanced_settings } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);

  if (!res) return json({ error: { message: 'Parallel unreachable', type: 'upstream_unavailable' } }, 502);
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return json({ error: { message: sanitizeProviderError(res.status), type: 'provider_error' } }, res.status === 429 ? 429 : 502);
  }
  return json(await res.json());
}

/** Owner-authenticated config write (NIP-98-style signed event, KV-backed). */
async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const auth = await verifyAdminAuth(request.headers.get('Authorization'), request.url, env);
  if (!auth.ok) return json({ error: { message: auth.error, type: 'unauthorized' } }, auth.error === 'Admin is not configured on this deployment' ? 501 : 403);

  if (!env.AI_CONFIG_KV) {
    return json({
      error: {
        message: 'Runtime config storage (KV) is not bound — configure engine AI via environment variables instead',
        type: 'storage_unavailable',
      },
    }, 501);
  }

  let eventContent: string;
  try {
    const header = request.headers.get('Authorization')!;
    const event = JSON.parse(atob(header.slice(6))) as { content?: string };
    eventContent = typeof event.content === 'string' ? event.content : '';
  } catch {
    return json({ error: { message: 'Malformed authorization event', type: 'invalid_request' } }, 400);
  }

  const action = parseAdminAction(eventContent);
  if (typeof action === 'string') {
    return json({ error: { message: action, type: 'invalid_request' } }, 400);
  }

  const current = await readEngineConfig(env);
  const next = applyAdminAction(current, action);
  if (typeof next === 'string') {
    return json({ error: { message: next, type: 'invalid_request' } }, 400);
  }

  await writeEngineConfig(env.AI_CONFIG_KV, next);
  return json({ ok: true, status: buildPublicStatus(next) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/ai/status' && request.method === 'GET') {
        return json(buildPublicStatus(await readEngineConfig(env)));
      }
      if (url.pathname === '/api/ai/models' && request.method === 'GET') {
        return proxyModels(env);
      }
      if (url.pathname === '/api/ai/chat/completions' && request.method === 'POST') {
        return proxyChat(request, env);
      }
      if (url.pathname === '/api/ai/admin' && request.method === 'POST') {
        return handleAdmin(request, env);
      }
      if (url.pathname === '/api/search/status' && request.method === 'GET') {
        return searchStatus(env);
      }
      if (url.pathname === '/api/search/brave' && request.method === 'GET') {
        return proxyBrave(request, env);
      }
      if (url.pathname === '/api/search/parallel' && request.method === 'POST') {
        return proxyParallel(request, env);
      }

      // Everything else → static assets.
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    } catch {
      // Deliberately opaque: internal errors must not leak config details.
      return json({ error: { message: 'Internal error', type: 'internal' } }, 500);
    }
  },
};

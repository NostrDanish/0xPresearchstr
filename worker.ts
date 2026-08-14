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
 *
 * Operator configuration (nothing secret in the repo):
 *   wrangler secret put AI_API_KEY            ← the actual key (env-only mode)
 *   AI_PROVIDER_ENDPOINT / AI_MODEL / AI_PROVIDER_NAME / AI_ENGINE_ENABLED (vars)
 *   OWNER_PUBKEY (var, hex)                   ← enables the Admin → AI tab
 *   AI_CONFIG_KV (KV binding, optional)       ← enables admin-UI-managed config
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

      // Everything else → static assets.
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    } catch {
      // Deliberately opaque: internal errors must not leak config details.
      return json({ error: { message: 'Internal error', type: 'internal' } }, 500);
    }
  },
};

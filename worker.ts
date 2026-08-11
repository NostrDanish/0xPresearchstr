/**
 * 0xPresearchstr Autosigner — Cloudflare Worker
 *
 * Multi-user signing service for the federated search index. Every visitor's
 * search auto-indexes into the shared Nostr cache: the client POSTs the query
 * and its (untrusted) results here, and this Worker:
 *
 *   1. validates + strips the payload down to whitelisted fields,
 *   2. rate-limits by IP (KV) and dedupes per query (KV),
 *   3. signs a kind 30078 cache event with the indexer key
 *      (INDEXER_NSEC_HEX — a Cloudflare secret, never shipped to clients),
 *   4. publishes to the index relays over WebSocket,
 *   5. returns which relays confirmed.
 *
 * Server-side signing is multi-user safe by design: no key material in any
 * browser, and abuse control (rate limits, dedup, validation) lives here
 * instead of trusting clients.
 *
 * Schema mirrors src/lib/searchIndex.ts exactly (same kind, d-tag namespace,
 * t-tags) so events interop with 0xSearchstr and every compatible fork.
 * Keep the two in sync — the schema is the federation contract.
 *
 * Routes:
 *   POST /api/index   — sign + publish a cache event
 *   GET  /api/index   — service health/info (ops/monitoring)
 *   everything else   — static assets (the app itself)
 *
 * Setup: see README.md ("Autosigner Service").
 */

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/** Relays the signed cache events are published to (mirror of the client). */
const PUBLISH_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay.primal.net/',
  'wss://relay.damus.io/',
];

/** Browser origins allowed to call the signing endpoint.
 *  Update this array if the deployed domains change. */
const ALLOWED_ORIGINS = [
  'https://presearchstr.shakespeare.wtf',
  'https://0xpresearchstr.shakespeare.wtf',
  'https://0xsearchstr.shakespeare.wtf',
  'http://localhost:8080',
  'http://localhost:5173',
];

/** Max signing requests per IP per minute. */
const RATE_LIMIT_PER_MINUTE = 20;

/** Re-signing the same query within this window is skipped (cache is 24h). */
const QUERY_DEDUP_SECONDS = 1800; // 30 min

const MAX_RESULTS = 30;
const MIN_RESULTS = 3;
const MAX_QUERY_LEN = 200;
const MAX_TITLE_LEN = 200;
const MAX_SNIPPET_LEN = 500;
const MAX_URL_LEN = 2048;

/** Nostr event shape (subset — what we sign + publish). */
interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/* ------------------------------------------------------------------ */
/* Env bindings (minimal local types — no workers-types dependency)     */
/* ------------------------------------------------------------------ */

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface AssetsLike {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  /** KV namespace for rate limiting + query dedup. */
  RATE_LIMIT_KV?: KVNamespaceLike;
  /** Indexer secret key, 64-char hex. Set via `wrangler secret put`. */
  INDEXER_NSEC_HEX?: string;
  /** Static assets binding (the frontend in ./dist). */
  ASSETS?: AssetsLike;
}

/* ------------------------------------------------------------------ */
/* Schema (mirror of src/lib/searchIndex.ts)                            */
/* ------------------------------------------------------------------ */

const INDEX_KIND = 30078;

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '');
}

/** Sanitized result shape — anything outside these fields is stripped. */
interface CleanResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  provider: string;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanResult(input: unknown): CleanResult | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;

  const title = cleanString(r.title, MAX_TITLE_LEN);
  const url = cleanString(r.url, MAX_URL_LEN);
  const snippet = cleanString(r.snippet, MAX_SNIPPET_LEN);
  const source = cleanString(r.source, 20) || 'web';
  const provider = cleanString(r.provider, 40) || 'unknown';

  if (!title || !url) return null;
  // Cache entries are web results — http/https only, no exotic schemes.
  if (!/^https?:\/\//i.test(url)) return null;
  // Nostr-native content never belongs in the cache (it lives on relays).
  if (source === 'nostr' || provider === 'keyword-stake' || provider === 'community') return null;

  return { id: url, title, url, snippet, source, provider };
}

function buildCacheEvent(query: string, results: CleanResult[]): {
  kind: number;
  content: string;
  tags: string[][];
} {
  const now = Math.floor(Date.now() / 1000);
  const normalized = normalizeQuery(query);

  return {
    kind: INDEX_KIND,
    content: JSON.stringify(results),
    tags: [
      ['d', `0xsearchstr:cache:${normalized}`],
      ['t', '0xsearchstr'],
      ['t', 'search-cache'],
      ['query', query],
      ['cached_at', String(now)],
      ['result_count', String(results.length)],
      ['alt', `Community search index cache for: ${query}`],
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Rate limiting + dedup (KV)                                          */
/* ------------------------------------------------------------------ */

async function isRateLimited(kv: KVNamespaceLike | undefined, ip: string): Promise<boolean> {
  if (!kv) return false; // KV unbound (dev) — fail open, validation still applies.
  try {
    const key = `rl:${ip}`;
    const current = parseInt((await kv.get(key)) ?? '0', 10) || 0;
    if (current >= RATE_LIMIT_PER_MINUTE) return true;
    await kv.put(key, String(current + 1), { expirationTtl: 60 });
    return false;
  } catch {
    return false; // KV hiccup — fail open.
  }
}

async function isDuplicateQuery(kv: KVNamespaceLike | undefined, normalized: string): Promise<boolean> {
  if (!kv || !normalized) return false;
  try {
    const key = `q:${normalized}`;
    if (await kv.get(key)) return true;
    await kv.put(key, '1', { expirationTtl: QUERY_DEDUP_SECONDS });
    return false;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Relay publishing (WebSocket)                                        */
/* ------------------------------------------------------------------ */

function publishToRelay(url: string, event: NostrEvent, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* closing a dead socket throws nowhere else */ }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);

    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      return resolve(false);
    }

    ws.onopen = () => {
      try { ws?.send(JSON.stringify(['EVENT', event])); } catch { done(false); }
    };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(typeof msg.data === 'string' ? msg.data : '');
        if (Array.isArray(data) && data[0] === 'OK' && data[1] === event.id) {
          done(data[2] === true);
        }
      } catch { /* malformed frame — keep waiting until timeout */ }
    };
    ws.onerror = () => done(false);
  });
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : null;
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // CORS preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/api/index') {
      // Browser calls from other origins are rejected outright.
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return json({ ok: false, reason: 'origin_not_allowed' }, 403, origin);
      }

      if (request.method === 'GET') return handleHealth(env, origin);
      if (request.method === 'POST') return handleIndex(request, env, origin);
      return json({ ok: false, reason: 'method_not_allowed' }, 405, origin);
    }

    // Everything else: the app (static assets).
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('0xPresearchstr autosigner. Static assets not bound.', { status: 404 });
  },
};

/** GET /api/index — health check (service info + configured pubkey). */
function handleHealth(env: Env, origin: string | null): Response {
  const keyHex = env.INDEXER_NSEC_HEX ?? '';
  const configured = /^[0-9a-f]{64}$/i.test(keyHex);
  // Derive the public key only — the secret never appears in any response.
  const pubkey = configured ? bytesToHex(getPublicKey(hexToBytes(keyHex))) : null;
  return json({
    ok: configured,
    service: '0xpresearchstr-autosigner',
    pubkey,
    relays: PUBLISH_RELAYS,
    kind: INDEX_KIND,
  }, configured ? 200 : 503, origin);
}

/** POST /api/index — validate, sign, publish. */
async function handleIndex(request: Request, env: Env, origin: string | null): Promise<Response> {
  // Secret must be configured.
  const keyHex = env.INDEXER_NSEC_HEX ?? '';
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    return json({ ok: false, reason: 'signer_not_configured' }, 503, origin);
  }

  // Rate limit by IP.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (await isRateLimited(env.RATE_LIMIT_KV, ip)) {
    return json({ ok: false, reason: 'rate_limited' }, 429, origin);
  }

  // Parse + validate payload.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: 'invalid_json' }, 400, origin);
  }
  if (!body || typeof body !== 'object') {
    return json({ ok: false, reason: 'invalid_body' }, 400, origin);
  }

  const { query: rawQuery, results: rawResults } = body as { query?: unknown; results?: unknown };
  const query = cleanString(rawQuery, MAX_QUERY_LEN);
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return json({ ok: false, reason: 'invalid_query' }, 400, origin);
  }

  const results = (Array.isArray(rawResults) ? rawResults : [])
    .slice(0, MAX_RESULTS)
    .map(cleanResult)
    .filter((r): r is CleanResult => r !== null)
    .slice(0, MAX_RESULTS);

  if (results.length < MIN_RESULTS) {
    return json({ ok: false, reason: 'too_few_results' }, 422, origin);
  }

  // Per-query dedup — the cache is addressable, re-signing within the
  // window just wastes relay bandwidth.
  if (await isDuplicateQuery(env.RATE_LIMIT_KV, normalized)) {
    return json({ ok: true, skipped: 'recently_indexed' }, 200, origin);
  }

  // Sign with the indexer key (Cloudflare secret).
  const secretKey = hexToBytes(keyHex);
  const template = buildCacheEvent(query, results);
  const signedEvent = finalizeEvent(
    {
      kind: template.kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: template.tags,
      content: template.content,
      pubkey: bytesToHex(getPublicKey(secretKey)),
    },
    secretKey,
  );

  // Publish to all index relays in parallel.
  const outcomes = await Promise.all(
    PUBLISH_RELAYS.map(async (relay) => ({
      relay,
      ok: await publishToRelay(relay, signedEvent),
    })),
  );

  const published = outcomes.filter((o) => o.ok).map((o) => o.relay);
  const failed = outcomes.filter((o) => !o.ok).map((o) => o.relay);

  return json({
    ok: published.length > 0,
    id: signedEvent.id,
    published,
    failed,
  }, published.length > 0 ? 200 : 502, origin);
}

/**
 * Engine-provided AI — shared proxy logic.
 *
 * This module holds every piece of the engine-AI proxy that is testable
 * without a server runtime. `worker.ts` (the Cloudflare Worker) is a thin
 * HTTP shell over these functions.
 *
 * Security invariants (enforced here, tested in engineProxy.test.ts):
 *   - The engine API key NEVER appears in any public response — the status
 *     endpoint emits only provider/endpoint/model + the last 4 characters
 *     (masked tail, like card receipts).
 *   - Provider errors are mapped to sanitized messages — upstream error
 *     bodies can echo request details and must not leak to browsers.
 *   - Chat payloads are whitelisted (messages only, bounded) — clients
 *     cannot smuggle provider-specific parameters or override the
 *     operator-configured model.
 *   - Admin writes require a NIP-98-style signed Nostr event from the
 *     owner key (env OWNER_PUBKEY) — no accounts, no passwords, and the
 *     signed event itself carries no secrets beyond the payload.
 */
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure';

/** Engine AI configuration as stored (KV) or provided via env vars. */
export interface EngineAIConfig {
  /** Master switch for engine-provided AI. */
  enabled: boolean;
  /** OpenAI-compatible API base URL (e.g. https://api.ppq.ai/v1). */
  endpoint: string;
  /** Model id served to engine-tier users (e.g. qwen/qwen-2.5-7b-instruct). */
  model: string;
  /** The secret API key. NEVER leaves the server. */
  apiKey: string;
  /** Operator label for the provider (display only, e.g. "PPQ.ai"). */
  providerName: string;
}

/** Minimal KV surface the worker needs (Cloudflare KV compatible). */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

/** Environment shape worker.ts passes in. */
export interface EngineAIEnv {
  /** Public key (hex) allowed to administer engine AI. Not a secret. */
  OWNER_PUBKEY?: string;
  /** Env-var fallback config (secrets set via `wrangler secret put`). */
  AI_API_KEY?: string;
  AI_PROVIDER_ENDPOINT?: string;
  AI_MODEL?: string;
  AI_PROVIDER_NAME?: string;
  AI_ENGINE_ENABLED?: string;
  /** KV binding for admin-UI-managed config. */
  AI_CONFIG_KV?: KVLike;
}

const KV_CONFIG_KEY = 'engine-ai-config';

/** Default model when the operator hasn't picked one (not a secret). */
export const DEFAULT_ENGINE_MODEL = 'qwen/qwen-2.5-7b-instruct';
/** Default endpoint when unset (PPQ — pay-per-prompt, Lightning-native). */
export const DEFAULT_ENGINE_ENDPOINT = 'https://api.ppq.ai/v1';

/* ------------------------------------------------------------------ */
/* Config read / write                                                */
/* ------------------------------------------------------------------ */

function configFromEnv(env: EngineAIEnv): EngineAIConfig | null {
  const apiKey = env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    enabled: env.AI_ENGINE_ENABLED !== 'false',
    endpoint: env.AI_PROVIDER_ENDPOINT?.trim() || DEFAULT_ENGINE_ENDPOINT,
    model: env.AI_MODEL?.trim() || DEFAULT_ENGINE_MODEL,
    apiKey,
    providerName: env.AI_PROVIDER_NAME?.trim() || 'Engine AI',
  };
}

function isValidStoredConfig(value: unknown): value is EngineAIConfig {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.enabled === 'boolean'
    && typeof c.endpoint === 'string'
    && typeof c.model === 'string'
    && typeof c.apiKey === 'string'
    && c.apiKey.length > 0
    && typeof c.providerName === 'string'
  );
}

/**
 * Read the effective engine config: KV (admin-UI-managed) first, then the
 * env-var fallback. Returns null when the operator configured nothing —
 * a fresh clone takes this path and engine AI simply reports unavailable.
 */
export async function readEngineConfig(env: EngineAIEnv): Promise<EngineAIConfig | null> {
  if (env.AI_CONFIG_KV) {
    try {
      const raw = await env.AI_CONFIG_KV.get(KV_CONFIG_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isValidStoredConfig(parsed)) return parsed;
      }
    } catch {
      // Corrupt/unreadable KV config — fall through to env.
    }
  }
  return configFromEnv(env);
}

/* ------------------------------------------------------------------ */
/* Public status (safe by construction)                               */
/* ------------------------------------------------------------------ */

/** What /api/ai/status returns. Contains NO secret material — only the
 *  last 4 key characters as a masked fingerprint for the admin UI. */
export interface EngineAIStatus {
  configured: boolean;
  enabled: boolean;
  providerName?: string;
  endpoint?: string;
  model?: string;
  /** Last 4 chars of the key, masked display only (never more). */
  keyTail?: string;
}

export function buildPublicStatus(config: EngineAIConfig | null): EngineAIStatus {
  if (!config) return { configured: false, enabled: false };
  return {
    configured: true,
    enabled: config.enabled,
    providerName: config.providerName,
    endpoint: config.endpoint,
    model: config.model,
    keyTail: config.apiKey.slice(-4),
  };
}

/* ------------------------------------------------------------------ */
/* Chat payload validation (whitelist)                                */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ValidatedChat {
  messages: ChatMessage[];
  maxTokens: number;
}

const MAX_MESSAGES = 20;
const MAX_CONTENT_CHARS = 24_000;
const MAX_TOTAL_CHARS = 64_000;
const MAX_TOKENS_CAP = 2000;

/** Validate an inbound chat request. Returns an error string or the payload. */
export function validateChatPayload(body: unknown): ValidatedChat | string {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object';
  const raw = body as Record<string, unknown>;

  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    return 'messages must be a non-empty array';
  }
  if (raw.messages.length > MAX_MESSAGES) return `too many messages (max ${MAX_MESSAGES})`;

  const messages: ChatMessage[] = [];
  let total = 0;
  for (const m of raw.messages) {
    if (!m || typeof m !== 'object') return 'each message must be an object';
    const { role, content } = m as Record<string, unknown>;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') return 'invalid message role';
    if (typeof content !== 'string' || content.length === 0) return 'message content must be a non-empty string';
    if (content.length > MAX_CONTENT_CHARS) return 'message content too long';
    total += content.length;
    messages.push({ role, content });
  }
  if (total > MAX_TOTAL_CHARS) return 'request too large';

  let maxTokens = 1200;
  if (raw.max_tokens !== undefined) {
    const n = Number(raw.max_tokens);
    if (!Number.isFinite(n) || n <= 0) return 'max_tokens must be a positive number';
    maxTokens = Math.min(Math.floor(n), MAX_TOKENS_CAP);
  }

  return { messages, maxTokens };
}

/** Build the upstream provider request. The operator's model is forced —
 *  clients never choose the engine-tier model or see the key. */
export function buildUpstreamBody(
  payload: ValidatedChat,
  config: EngineAIConfig,
): Record<string, unknown> {
  return {
    model: config.model || DEFAULT_ENGINE_MODEL,
    messages: payload.messages,
    max_completion_tokens: payload.maxTokens,
  };
}

/** Map an upstream failure to a client-safe error. Never includes the
 *  upstream body (it can echo request details) — status class only. */
export function sanitizeProviderError(status: number): string {
  if (status === 401 || status === 403) return 'Engine AI key was rejected by the provider';
  if (status === 402) return 'Engine AI credit balance is exhausted';
  if (status === 429) return 'Engine AI is rate-limited right now — try again shortly';
  if (status >= 500) return 'AI provider is temporarily unavailable';
  return `AI provider rejected the request (HTTP ${status})`;
}

/* ------------------------------------------------------------------ */
/* Admin auth (NIP-98-flavored signed Nostr event)                    */
/* ------------------------------------------------------------------ */

/** How fresh the signed admin event must be (5 minutes). */
const ADMIN_EVENT_MAX_AGE_SECONDS = 300;

export interface AdminAuthResult {
  ok: boolean;
  error?: string;
}

/**
 * Verify an admin request: a NIP-98-style signed event in the Authorization
 * header ("Nostr <base64-json>"). Checks:
 *   - valid Schnorr signature (verifyEvent)
 *   - signer === env.OWNER_PUBKEY (the only admin of engine AI)
 *   - kind 27235, `u` tag matches the request URL, `method` matches POST
 *   - created_at within 5 minutes (replay window)
 */
export async function verifyAdminAuth(
  authHeader: string | null,
  requestUrl: string,
  env: EngineAIEnv,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AdminAuthResult> {
  if (!env.OWNER_PUBKEY) return { ok: false, error: 'Admin is not configured on this deployment' };
  if (!authHeader?.startsWith('Nostr ')) return { ok: false, error: 'Missing Nostr authorization' };

  let event: NostrEvent;
  try {
    const json = atob(authHeader.slice(6));
    event = JSON.parse(json) as NostrEvent;
  } catch {
    return { ok: false, error: 'Malformed authorization event' };
  }
  if (!event || typeof event.kind !== 'number' || !Array.isArray(event.tags)
    || typeof event.pubkey !== 'string' || typeof event.sig !== 'string' || typeof event.id !== 'string') {
    return { ok: false, error: 'Malformed authorization event' };
  }

  if (event.kind !== 27235) return { ok: false, error: 'Wrong event kind' };
  if (event.pubkey !== env.OWNER_PUBKEY) return { ok: false, error: 'Not the owner key' };
  if (Math.abs(nowSeconds - event.created_at) > ADMIN_EVENT_MAX_AGE_SECONDS) {
    return { ok: false, error: 'Stale authorization event — try again' };
  }

  const uTag = event.tags.find(([n]) => n === 'u')?.[1];
  if (uTag !== requestUrl) return { ok: false, error: 'URL tag mismatch' };
  const methodTag = event.tags.find(([n]) => n === 'method')?.[1];
  if (methodTag !== 'POST') return { ok: false, error: 'Method tag mismatch' };

  try {
    if (!verifyEvent(event)) return { ok: false, error: 'Invalid signature' };
  } catch {
    return { ok: false, error: 'Invalid signature' };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Admin actions (validated config writes)                            */
/* ------------------------------------------------------------------ */

export interface AdminAction {
  action: 'set' | 'clear' | 'set-enabled';
  endpoint?: string;
  model?: string;
  apiKey?: string;
  providerName?: string;
  enabled?: boolean;
}

export function parseAdminAction(content: string): AdminAction | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return 'Action payload must be JSON';
  }
  if (!parsed || typeof parsed !== 'object') return 'Action payload must be an object';
  const a = parsed as Record<string, unknown>;

  if (a.action !== 'set' && a.action !== 'clear' && a.action !== 'set-enabled') {
    return 'Unknown action';
  }

  if (a.action === 'set') {
    if (typeof a.apiKey !== 'string' || a.apiKey.trim().length < 8) return 'apiKey looks too short';
    if (a.endpoint !== undefined) {
      if (typeof a.endpoint !== 'string') return 'endpoint must be a string';
      try {
        const u = new URL(a.endpoint);
        if (u.protocol !== 'https:') return 'endpoint must be https://';
      } catch {
        return 'endpoint must be a valid URL';
      }
    }
    if (a.model !== undefined && (typeof a.model !== 'string' || a.model.trim().length === 0 || a.model.length > 120)) {
      return 'model must be a short string';
    }
    if (a.providerName !== undefined && (typeof a.providerName !== 'string' || a.providerName.length > 60)) {
      return 'providerName must be a short string';
    }
  }

  if (a.action === 'set-enabled' && typeof a.enabled !== 'boolean') {
    return 'enabled must be a boolean';
  }

  return a as AdminAction;
}

/** Apply a validated action to the current config. Returns the new config
 *  to store, or null when the config should be deleted (clear). */
export function applyAdminAction(current: EngineAIConfig | null, action: AdminAction): EngineAIConfig | null | string {
  switch (action.action) {
    case 'clear':
      return null;
    case 'set-enabled': {
      if (!current) return 'No engine AI configured yet — save a key first';
      return { ...current, enabled: action.enabled === true };
    }
    case 'set': {
      return {
        enabled: current?.enabled ?? true,
        endpoint: action.endpoint?.trim() || current?.endpoint || DEFAULT_ENGINE_ENDPOINT,
        model: action.model?.trim() || current?.model || DEFAULT_ENGINE_MODEL,
        apiKey: action.apiKey!.trim(),
        providerName: action.providerName?.trim() || current?.providerName || 'Engine AI',
      };
    }
  }
}

/** Persist/delete the config in KV. No-op-safe when KV is unbound —
 *  the caller reports that env-var config is in effect instead. */
export async function writeEngineConfig(kv: KVLike | undefined, config: EngineAIConfig | null): Promise<boolean> {
  if (!kv) return false;
  if (config === null) {
    await kv.delete(KV_CONFIG_KEY);
  } else {
    await kv.put(KV_CONFIG_KEY, JSON.stringify(config));
  }
  return true;
}

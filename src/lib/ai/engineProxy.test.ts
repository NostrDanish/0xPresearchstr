/**
 * Engine-AI proxy logic tests — the security-critical invariants of
 * worker.ts, verified without a server runtime.
 */
import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

import {
  buildPublicStatus,
  validateChatPayload,
  buildUpstreamBody,
  sanitizeProviderError,
  verifyAdminAuth,
  parseAdminAction,
  applyAdminAction,
  readEngineConfig,
  writeEngineConfig,
  DEFAULT_ENGINE_MODEL,
  type EngineAIConfig,
  type KVLike,
} from './engineProxy';

const CONFIG: EngineAIConfig = {
  enabled: true,
  endpoint: 'https://api.ppq.ai/v1',
  model: 'qwen/qwen-2.5-7b-instruct',
  apiKey: 'sk-test-secret-key-1234567890abcdef',
  providerName: 'PPQ.ai',
};

/* ─── Status secrecy (spec #5) ─── */

describe('buildPublicStatus', () => {
  it('never includes the API key — only the masked 4-char tail', () => {
    const status = buildPublicStatus(CONFIG);
    const json = JSON.stringify(status);
    expect(json).not.toContain(CONFIG.apiKey);
    expect(json).not.toContain('apiKey');
    expect(status.keyTail).toBe('cdef'); // last 4 only
    expect(status.configured).toBe(true);
    expect(status.enabled).toBe(true);
    expect(status.model).toBe(CONFIG.model);
  });

  it('reports unconfigured when no config exists (fresh clone)', () => {
    expect(buildPublicStatus(null)).toEqual({ configured: false, enabled: false });
  });
});

/* ─── Chat payload validation ─── */

describe('validateChatPayload', () => {
  it('accepts a normal chat request', () => {
    const out = validateChatPayload({ messages: [{ role: 'user', content: 'hi' }] });
    expect(out).toEqual({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 1200 });
  });

  it('rejects non-object bodies, empty/missing messages, bad roles, oversized content', () => {
    expect(typeof validateChatPayload(null)).toBe('string');
    expect(typeof validateChatPayload({})).toBe('string');
    expect(typeof validateChatPayload({ messages: [] })).toBe('string');
    expect(typeof validateChatPayload({ messages: [{ role: 'root', content: 'x' }] })).toBe('string');
    expect(typeof validateChatPayload({ messages: [{ role: 'user', content: '' }] })).toBe('string');
    expect(typeof validateChatPayload({ messages: [{ role: 'user', content: 'x'.repeat(25_000) }] })).toBe('string');
  });

  it('caps max_tokens at the server ceiling', () => {
    const out = validateChatPayload({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 999_999 });
    expect(typeof out).not.toBe('string');
    if (typeof out !== 'string') expect(out.maxTokens).toBe(2000);
  });
});

/* ─── Upstream body: model forced, no client overrides ─── */

describe('buildUpstreamBody', () => {
  it('forces the operator model and modern token param', () => {
    const body = buildUpstreamBody({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 500 }, CONFIG);
    expect(body.model).toBe(CONFIG.model);
    expect(body.max_completion_tokens).toBe(500);
    expect(body).not.toHaveProperty('max_tokens');
    expect(JSON.stringify(body)).not.toContain(CONFIG.apiKey);
  });
});

/* ─── Provider error sanitation (spec #8 + no-leak) ─── */

describe('sanitizeProviderError', () => {
  it('maps statuses to safe messages with no request details', () => {
    expect(sanitizeProviderError(401)).toMatch(/rejected/i);
    expect(sanitizeProviderError(429)).toMatch(/rate/i);
    expect(sanitizeProviderError(500)).toMatch(/unavailable/i);
    expect(sanitizeProviderError(400)).toMatch(/HTTP 400/);
    // None of them can carry a key or payload echo:
    for (const s of [400, 401, 402, 403, 429, 500, 502]) {
      expect(sanitizeProviderError(s)).not.toContain('sk-');
    }
  });
});

/* ─── Admin auth (NIP-98-style signed events) ─── */

describe('verifyAdminAuth', () => {
  const URL_ = 'https://example.com/api/ai/admin';
  const now = 1_800_000_000;

  function signedHeader(sk: Uint8Array, overrides: Record<string, unknown> = {}): string {
    const event = finalizeEvent(
      {
        kind: 27235,
        content: '{}',
        tags: [['u', URL_], ['method', 'POST']],
        created_at: now,
        ...overrides,
      } as Parameters<typeof finalizeEvent>[0],
      sk,
    );
    return `Nostr ${btoa(JSON.stringify(event))}`;
  }

  it('accepts a fresh, correctly-signed event from the owner key', async () => {
    const sk = generateSecretKey();
    const env = { OWNER_PUBKEY: getPublicKey(sk) };
    const result = await verifyAdminAuth(signedHeader(sk), URL_, env, now);
    expect(result.ok).toBe(true);
  });

  it('rejects non-owner keys, stale events, wrong URL/method, bad signatures, missing config', async () => {
    const ownerSk = generateSecretKey();
    const otherSk = generateSecretKey();
    const env = { OWNER_PUBKEY: getPublicKey(ownerSk) };

    // Wrong signer
    expect((await verifyAdminAuth(signedHeader(otherSk), URL_, env, now)).ok).toBe(false);
    // Stale
    expect((await verifyAdminAuth(signedHeader(ownerSk, { created_at: now - 1000 }), URL_, env, now)).ok).toBe(false);
    // Wrong URL tag
    expect((await verifyAdminAuth(signedHeader(ownerSk, { tags: [['u', 'https://evil.com'], ['method', 'POST']] }), URL_, env, now)).ok).toBe(false);
    // Wrong method
    expect((await verifyAdminAuth(signedHeader(ownerSk, { tags: [['u', URL_], ['method', 'GET']] }), URL_, env, now)).ok).toBe(false);
    // Tampered content after signing → signature invalid
    const event = JSON.parse(atob(signedHeader(ownerSk).slice(6)));
    event.content = '{"action":"clear"}';
    expect((await verifyAdminAuth(`Nostr ${btoa(JSON.stringify(event))}`, URL_, env, now)).ok).toBe(false);
    // No owner configured on the deployment
    expect((await verifyAdminAuth(signedHeader(ownerSk), URL_, {}, now)).ok).toBe(false);
    // No header at all
    expect((await verifyAdminAuth(null, URL_, env, now)).ok).toBe(false);
  });
});

/* ─── Admin actions ─── */

describe('parseAdminAction', () => {
  it('validates set/clear/set-enabled shapes', () => {
    expect(parseAdminAction('not json')).toBe('Action payload must be JSON');
    expect(parseAdminAction('{"action":"set"}')).toBe('apiKey looks too short');
    expect(parseAdminAction('{"action":"set","apiKey":"sk-long-enough","endpoint":"http://insecure.example.com"}')).toBe('endpoint must be https://');
    expect(parseAdminAction('{"action":"nope"}')).toBe('Unknown action');
    expect(parseAdminAction('{"action":"set-enabled"}')).toBe('enabled must be a boolean');

    const good = parseAdminAction('{"action":"set","apiKey":"sk-long-enough-key","model":"m","endpoint":"https://api.example.com/v1"}');
    expect(typeof good).not.toBe('string');
  });
});

describe('applyAdminAction', () => {
  it('set writes a full config; clear deletes; set-enabled toggles (spec #7)', () => {
    const set = applyAdminAction(null, { action: 'set', apiKey: 'sk-new-key-here' });
    expect(set).not.toBeNull();
    if (set && typeof set !== 'string') {
      expect(set.apiKey).toBe('sk-new-key-here');
      expect(set.model).toBe(DEFAULT_ENGINE_MODEL);
      expect(set.enabled).toBe(true);
    }

    const toggled = applyAdminAction(CONFIG, { action: 'set-enabled', enabled: false });
    expect(toggled).toEqual({ ...CONFIG, enabled: false });

    expect(applyAdminAction(CONFIG, { action: 'clear' })).toBeNull();
    // Clearing → buildPublicStatus reports unconfigured → engine AI off.
    expect(buildPublicStatus(null).configured).toBe(false);

    // Toggle without a config is a graceful error, not a crash.
    expect(typeof applyAdminAction(null, { action: 'set-enabled', enabled: true })).toBe('string');
  });
});

/* ─── Config storage: KV wins over env (and never leaks) ─── */

describe('readEngineConfig / writeEngineConfig', () => {
  function fakeKV(): KVLike & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
      store,
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => void store.set(k, v),
      delete: async (k) => void store.delete(k),
    };
  }

  it('returns null with nothing configured (fresh clone)', async () => {
    expect(await readEngineConfig({})).toBeNull();
  });

  it('env-var config works without KV', async () => {
    const cfg = await readEngineConfig({ AI_API_KEY: 'sk-env-key' });
    expect(cfg?.apiKey).toBe('sk-env-key');
    expect(cfg?.model).toBe(DEFAULT_ENGINE_MODEL);
  });

  it('KV config takes precedence over env vars', async () => {
    const kv = fakeKV();
    await writeEngineConfig(kv, CONFIG);
    const cfg = await readEngineConfig({ AI_CONFIG_KV: kv, AI_API_KEY: 'sk-env-key' });
    expect(cfg?.apiKey).toBe(CONFIG.apiKey);
  });

  it('writeEngineConfig(false-y KV) reports no-op instead of throwing', async () => {
    expect(await writeEngineConfig(undefined, CONFIG)).toBe(false);
  });
});

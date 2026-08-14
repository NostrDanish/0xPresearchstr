/**
 * Engine-AI admin client — signed config actions for Admin → AI.
 *
 * NIP-98-flavored auth: the action payload rides in the content of a
 * signed kind 27235 event (with `u` + `method` tags), base64-encoded into
 * the Authorization header. The worker verifies the Schnorr signature,
 * the owner pubkey, freshness, and URL/method binding before applying
 * anything (see engineProxy.ts → verifyAdminAuth).
 *
 * The API key only ever travels this single authenticated path — from the
 * operator's own browser to their own deployment over TLS. It is never
 * written to localStorage, the bundle, or any public response.
 */
import type { AdminAction, EngineAIStatus } from '@/lib/ai/engineProxy';
import { ENGINE_AI_BASE } from '@/lib/aiConfig';

/** Minimal signer surface (matches Nostrify's user.signer). */
interface EventSigner {
  signEvent(event: {
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
  }): Promise<unknown>;
}

/** Base64-encode UTF-8 safely (btoa alone chokes on non-Latin-1). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export class EngineAdminError extends Error {
  constructor(
    message: string,
    /** 'unauthorized' when the worker rejected the signature/owner check. */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Send a signed admin action to the engine-AI proxy. Returns the new public status. */
export async function sendEngineAIAction(signer: EventSigner, action: AdminAction): Promise<EngineAIStatus> {
  const url = `${location.origin}${ENGINE_AI_BASE}/admin`;

  const event = await signer.signEvent({
    kind: 27235,
    content: JSON.stringify(action),
    tags: [
      ['u', url],
      ['method', 'POST'],
    ],
    created_at: Math.floor(Date.now() / 1000),
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Nostr ${toBase64(JSON.stringify(event))}` },
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    status?: EngineAIStatus;
    error?: { message?: string; type?: string };
  } | null;

  if (!res.ok || !data?.ok || !data.status) {
    const message = data?.error?.message ?? `Admin action failed (HTTP ${res.status})`;
    throw new EngineAdminError(message, data?.error?.type);
  }

  return data.status;
}

/** Ping the engine tier with a 1-token request to verify the stored config works. */
export async function testEngineAI(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${ENGINE_AI_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 8,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    } | null;

    if (!res.ok) {
      return { ok: false, message: data?.error?.message ?? `HTTP ${res.status}` };
    }
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text
      ? { ok: true, message: `Provider replied: "${text.slice(0, 80)}"` }
      : { ok: false, message: 'Provider returned an empty reply' };
  } catch {
    return { ok: false, message: 'Proxy unreachable — is the worker deployed?' };
  }
}

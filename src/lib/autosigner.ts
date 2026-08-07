/**
 * Autosigner — the shared NIP-46 remote signer (bunker) connection.
 *
 * The autosigner is what auto-indexes every search on 0xPresearchstr into
 * the federated Nostr cache. Its private key lives on the remote signer
 * (nsec.app); only the bunker:// connection URI ships with the app. That
 * means the signer can enforce signing policies and rotate/revoke access
 * without a redeploy — and anyone can verify the live connection from
 * Settings → Autosigner.
 *
 * Baked into the deployment: every visitor's client connects to the same
 * bunker and signs cache events as the trusted indexer identity
 * (be7cad9a…c4289), which readers accept via INDEXER_PUBKEYS.
 */
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { generateSecretKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * 0xPresearchstr autosigner — NIP-46 bunker connection URI.
 *
 * Carries the remote signer pubkey, the bunker relays, and the connection
 * secret authorizing this app to request signatures. Public by design (the
 * indexer is a bot identity); the actual private key stays on the bunker.
 */
export const BUNKER_URI = 'bunker://be7cad9a8e47ab0adfc877a008aea17692c08c49c1a5a6d87ee79ca4370c4289'
  + '?relay=wss://relay.nip46.com/&relay=wss://relay.nsec.app/&relay=wss://relay.ditto.pub/&secret=3964a062-62a0-4c15-9255-03bfda88256b';

/** localStorage key for the persistent NIP-46 client keypair. */
const LS_BUNKER_CLIENT_KEY = '0xsearchstr:nip46:client-key';

/**
 * The local client keypair for the NIP-46 encrypted conversation.
 * Persisted so the bunker sees a stable client identity across sessions
 * (re-generating per session can re-trigger approval prompts on nsec.app).
 */
function loadOrCreateClientKey(): Uint8Array {
  try {
    const raw = localStorage.getItem(LS_BUNKER_CLIENT_KEY);
    if (raw && /^[0-9a-f]{64}$/.test(raw)) return hexToBytes(raw);
    const fresh = generateSecretKey();
    localStorage.setItem(LS_BUNKER_CLIENT_KEY, bytesToHex(fresh));
    return fresh;
  } catch {
    // Storage unavailable — ephemeral key is fine, just less stable.
    return generateSecretKey();
  }
}

let bunkerPromise: Promise<BunkerSigner> | null = null;

/** Lazily connect to the bunker. One shared connection for the session. */
export function getBunkerSigner(): Promise<BunkerSigner> {
  if (!bunkerPromise) {
    bunkerPromise = (async () => {
      const bp = await parseBunkerInput(BUNKER_URI);
      if (!bp) throw new Error('Invalid bunker URI');
      const signer = BunkerSigner.fromBunker(loadOrCreateClientKey(), bp);
      await signer.connect(); // NIP-46 handshake (pong or rejection)
      return signer;
    })();
    // If the connection fails, allow a fresh attempt on the next call.
    bunkerPromise.catch(() => { bunkerPromise = null; });
  }
  return bunkerPromise;
}

export interface AutosignerStatus {
  ok: boolean;
  /** The actual signing pubkey reported by the bunker (hex). */
  pubkey?: string;
  /** Round-trip latency for the ping, in ms. */
  latencyMs?: number;
  error?: string;
}

/**
 * Ping the autosigner — full NIP-46 handshake + connect round-trip.
 * Used by the Settings status card to prove the live deployment's
 * bunker link works. Hard-capped at 15s.
 */
export async function pingAutosigner(): Promise<AutosignerStatus> {
  const start = performance.now();
  try {
    const signer = await Promise.race([
      getBunkerSigner(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out (15s)')), 15_000),
      ),
    ]);
    const pubkey = await Promise.race([
      signer.getPublicKey(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('get_public_key timed out (15s)')), 15_000),
      ),
    ]);
    return { ok: true, pubkey, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Connection failed',
      latencyMs: Math.round(performance.now() - start),
    };
  }
}

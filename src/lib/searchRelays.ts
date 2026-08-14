import { NRelay1, type NostrEvent, type NostrFilter } from '@nostrify/nostrify';

import { toSecureRelayUrl } from '@/lib/appRelays';

/** Dedicated NIP-50 search relay connections, separate from the main pool. */
const relayCache = new Map<string, NRelay1>();

export function getSearchRelay(url: string): NRelay1 {
  // ws:// → wss:// on HTTPS pages: a plain-ws relay throws a synchronous
  // SecurityError at WebSocket construction; upgrading turns it into a
  // normal (graceful, async) connection failure instead.
  const secure = toSecureRelayUrl(url);
  let relay = relayCache.get(secure);
  if (!relay) {
    relay = new NRelay1(secure);
    relayCache.set(secure, relay);
  }
  return relay;
}

/**
 * Query many relays in parallel, absorbing per-relay failure of ANY kind.
 *
 * The async map callback + try/catch is load-bearing: constructing a
 * ws:// WebSocket on an https page (e.g. the .onion index relay for
 * clearnet users) throws a SYNCHRONOUS SecurityError. A plain
 * `.map((url) => relay.query(...))` would crash the entire fan-out and
 * return nothing from every relay — this is the pattern every provider
 * uses, centralized. Returns per-relay settled results.
 */
export async function queryRelayPool(
  urls: string[],
  filters: NostrFilter[],
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<NostrEvent[][]> {
  const signal = AbortSignal.any([
    ...(opts.signal ? [opts.signal] : []),
    AbortSignal.timeout(opts.timeoutMs ?? 8000),
  ]);

  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      try {
        return await getSearchRelay(url).query(filters, { signal });
      } catch {
        return [] as NostrEvent[]; // dead/blocked relay = empty contribution
      }
    }),
  );

  return settled.map((r) => (r.status === 'fulfilled' ? r.value : []));
}

/**
 * Publish an event to many relays, absorbing per-relay failure (same
 * sync-throw hazard as queryRelayPool). Returns the number of relays that
 * accepted the event.
 */
export async function publishToRelayPool(
  urls: string[],
  event: NostrEvent,
  timeoutMs = 5000,
): Promise<number> {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      try {
        await getSearchRelay(url).event(event, { signal: AbortSignal.timeout(timeoutMs) });
        return true;
      } catch {
        return false;
      }
    }),
  );
  return results.filter((r) => r.status === 'fulfilled' && r.value).length;
}

/**
 * Query classification — what KIND of thing did the user type?
 *
 * Drives two optimizations:
 *   1. Instant answers (NIP-19 entities, NIP-05 addresses, URLs, math).
 *   2. Provider skipping — a bare npub or a URL gets zero value from
 *      clearnet web providers, so we don't send it to them at all
 *      (faster + more private).
 */
import { nip19 } from 'nostr-tools';

import { isMathQuery } from '@/lib/calculator';

export type QueryClass = 'nip19' | 'nip05' | 'url' | 'math' | 'text';

const NIP19_RE = /^(npub1|nprofile1|note1|nevent1|naddr1)[02-9ac-hj-np-z]+$/i;
/** name@domain.tld (NIP-05). */
const NIP05_RE = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;
/** Full URL with scheme, or a domain with a path (example.com/page). */
const URL_RE = /^(https?:\/\/\S+|\b[\w-]+(\.[\w-]+)+\/[^\s]*)$/i;

/** Classify a raw query string. */
export function classifyQuery(query: string): QueryClass {
  const q = query.trim();
  if (!q) return 'text';

  // NIP-19 bech32 entity (verify it actually decodes).
  if (NIP19_RE.test(q)) {
    try {
      nip19.decode(q);
      return 'nip19';
    } catch {
      // bech32-looking but invalid — fall through to text.
    }
  }

  // NIP-05 address.
  if (NIP05_RE.test(q)) return 'nip05';

  // URL (scheme + domain, or domain + path). Bare domains stay 'text' —
  // searching "wikipedia.org" should still run the engines.
  if (URL_RE.test(q)) return 'url';

  // Math expression.
  if (isMathQuery(q)) return 'math';

  return 'text';
}

/**
 * Provider id allowlist per query class — which providers are worth running.
 * Returns undefined for "no restriction" (text queries).
 *
 * - math:   no providers at all (the calculator IS the answer)
 * - nip19:  only the Nostr provider (a bech32 id means nothing to clearnet engines)
 * - nip05:  Nostr only (mentions); the address resolves via instant answer
 * - url:    Nostr-tier only — the SIP-01 index, cache, community, and stakes
 *           answer "is this page indexed?"; web engines don't need a URL
 */
export function providerAllowlistFor(cls: QueryClass): Set<string> | undefined {
  switch (cls) {
    case 'math':
      return new Set();
    case 'nip19':
    case 'nip05':
      return new Set(['nostr']);
    case 'url':
      return new Set(['web-index', 'cached-index', 'community', 'keyword-stakes', 'nostr']);
    case 'text':
      return undefined;
  }
}

/**
 * Privacy regression tests — the guarantees that make this app
 * privacy-oriented, pinned so no future refactor silently breaks them.
 *
 * 1. Query-class routing (audit: "special queries must never leak"):
 *    a NIP-19 id, NIP-05 address, URL, or math expression must NEVER be
 *    sent to clearnet engine providers (SearXNG/DDG/Brave/Wikipedia/HN/
 *    StackOverflow/Tor). Math runs zero providers. Text stays unrestricted.
 *
 * 2. URL sanitization (audit: "harden external URL handling"): only
 *    https/http (+ magnet with an xt hash) may become clickable result
 *    links; javascript:/data:/file:/blob:/chrome:/intent: never may.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { classifyQuery, providerAllowlistFor } from '@/lib/queryClassify';
import { sanitizeUrl, sanitizeResultUrl, sanitizePublicUrl } from '@/lib/sanitizeUrl';
import { ALL_PROVIDERS } from '@/lib/providers/registry';
import { TestApp } from '@/test/TestApp';
import { UnifiedResultCard } from '@/components/UnifiedResultCard';
import type { SearchResult } from '@/lib/providers/types';

/** A real, decodable npub (test-only value). */
const TEST_NPUB = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6';

/** Every clearnet engine that must never see a classified query. */
const EXTERNAL_ENGINES = [
  'searxng',
  'duckduckgo',
  'brave',
  'wikipedia',
  'hackernews',
  'stackoverflow',
  'tor',
];

describe('query classification privacy (no leaks to external engines)', () => {
  it('routes NIP-19 identifiers to Nostr-tier providers only', () => {
    expect(classifyQuery(TEST_NPUB)).toBe('nip19');
    const allow = providerAllowlistFor('nip19');
    expect(allow).toBeDefined();
    for (const engine of EXTERNAL_ENGINES) {
      expect(allow!.has(engine), `nip19 must not reach ${engine}`).toBe(false);
    }
  });

  it('routes NIP-05 addresses to Nostr only', () => {
    expect(classifyQuery('alice@example.com')).toBe('nip05');
    const allow = providerAllowlistFor('nip05');
    for (const engine of EXTERNAL_ENGINES) {
      expect(allow!.has(engine), `nip05 must not reach ${engine}`).toBe(false);
    }
  });

  it('routes URLs to the Nostr-tier index providers only', () => {
    expect(classifyQuery('https://example.com/some/page')).toBe('url');
    const allow = providerAllowlistFor('url');
    expect(allow).toBeDefined();
    for (const engine of EXTERNAL_ENGINES) {
      expect(allow!.has(engine), `URL must not reach ${engine}`).toBe(false);
    }
    // The URL lookup path must stay inside the Nostr network.
    for (const id of allow!) {
      const provider = ALL_PROVIDERS.find((p) => p.id === id);
      expect(provider?.privacy, `${id} must be Nostr-tier`).toBe('nostr');
    }
  });

  it('routes math to NO providers at all (the calculator is local)', () => {
    expect(classifyQuery('15% of 80')).toBe('math');
    const allow = providerAllowlistFor('math');
    expect(allow).toBeDefined();
    expect(allow!.size).toBe(0);
  });

  it('leaves plain text unrestricted', () => {
    expect(classifyQuery('best monero wallet')).toBe('text');
    expect(providerAllowlistFor('text')).toBeUndefined();
  });
});

describe('URL sanitization', () => {
  it('allows http/https only in sanitizeUrl', () => {
    expect(sanitizeUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(sanitizeUrl('http://example.onion/')).toBe('http://example.onion/');
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(sanitizeUrl('file:///etc/passwd')).toBe('');
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('');
    expect(sanitizeUrl('blob:https://example.com/abc')).toBe('');
    expect(sanitizeUrl('chrome://settings')).toBe('');
    expect(sanitizeUrl('intent://scan/#Intent;scheme=zxing;end')).toBe('');
    expect(sanitizeUrl('not a url')).toBe('');
  });

  it('sanitizeResultUrl additionally allows magnet links with an xt hash', () => {
    const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=test';
    expect(sanitizeResultUrl(magnet)).toBe(magnet);
    expect(sanitizeResultUrl('magnet:?')).toBe(''); // no hash — not a real magnet
    expect(sanitizeResultUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeResultUrl('ipfs://QmSomeHash')).toBe(''); // not browser-navigable
  });

  it('sanitizePublicUrl rejects http and loopback/private hosts', () => {
    expect(sanitizePublicUrl('https://example.com')).toBe('https://example.com/');
    expect(sanitizePublicUrl('http://example.com')).toBe('');
    expect(sanitizePublicUrl('http://127.0.0.1:3000/repo')).toBe('');
    expect(sanitizePublicUrl('https://192.168.1.5/x')).toBe('');
    expect(sanitizePublicUrl('https://10.0.0.2/')).toBe('');
    expect(sanitizePublicUrl('https://localhost:8080/')).toBe('');
  });
});

describe('result card link safety (hostile result data)', () => {
  const base: SearchResult = {
    id: 'test-1',
    title: 'Some result',
    url: 'https://example.com/',
    snippet: 'A snippet',
    source: 'web',
    provider: 'community',
  };

  it('does not render javascript: URLs as links', () => {
    const { container } = render(
      <TestApp>
        <UnifiedResultCard result={{ ...base, url: 'javascript:alert(1)' }} />
      </TestApp>,
    );
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    // No anchor at all for an unsafe external URL — the card still renders.
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('Some result');
  });

  it('renders https URLs as links', () => {
    const { container } = render(
      <TestApp>
        <UnifiedResultCard result={base} />
      </TestApp>,
    );
    const link = container.querySelector('a[href="https://example.com/"]');
    expect(link).not.toBeNull();
  });

  it('renders magnet torrent links (NIP-35)', () => {
    const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=test';
    const { container } = render(
      <TestApp>
        <UnifiedResultCard result={{ ...base, url: magnet, source: 'nostr' }} />
      </TestApp>,
    );
    expect(container.querySelector(`a[href^="magnet:"]`)).not.toBeNull();
  });
});

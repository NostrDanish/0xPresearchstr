import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';

import {
  WEB_INDEX_KIND,
  WEB_INDEX_SCHEMA_VERSION,
  buildIndexEvent,
  contentHash,
  documentId,
  normalizeIndexUrl,
  observationFromResult,
  parseIndexEvent,
} from './webIndex';

describe('normalizeIndexUrl', () => {
  it('lowercases host and strips www', () => {
    expect(normalizeIndexUrl('HTTPS://WWW.Example.COM/Page')).toBe('https://example.com/Page');
  });

  it('strips tracking parameters but keeps semantic ones', () => {
    const out = normalizeIndexUrl(
      'https://example.com/page?id=42&utm_source=twitter&utm_medium=social&fbclid=abc&page=2',
    );
    expect(out).toBe('https://example.com/page?id=42&page=2');
  });

  it('removes fragments entirely', () => {
    expect(normalizeIndexUrl('https://example.com/a#section-2')).toBe('https://example.com/a');
  });

  it('removes default ports', () => {
    expect(normalizeIndexUrl('https://example.com:443/a')).toBe('https://example.com/a');
    expect(normalizeIndexUrl('http://example.com:80/a')).toBe('http://example.com/a');
    expect(normalizeIndexUrl('https://example.com:8443/a')).toBe('https://example.com:8443/a');
  });

  it('strips trailing slash on non-root paths', () => {
    expect(normalizeIndexUrl('https://example.com/docs/')).toBe('https://example.com/docs');
    expect(normalizeIndexUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('sorts query parameters deterministically', () => {
    expect(normalizeIndexUrl('https://example.com/s?b=2&a=1')).toBe('https://example.com/s?a=1&b=2');
  });

  it('maps equivalent URLs to the same normalized form', () => {
    const a = normalizeIndexUrl('https://www.example.com/page/?utm_campaign=x#top');
    const b = normalizeIndexUrl('https://example.com/page');
    expect(a).toBe(b);
  });

  it('rejects non-http(s) schemes', () => {
    expect(normalizeIndexUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeIndexUrl('data:text/html,<script>')).toBeNull();
    expect(normalizeIndexUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeIndexUrl('magnet:?xt=urn:btih:abc')).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(normalizeIndexUrl('not a url')).toBeNull();
    expect(normalizeIndexUrl('')).toBeNull();
  });
});

describe('documentId / contentHash', () => {
  it('produces a stable widx id', async () => {
    const id = await documentId('https://example.com/page');
    expect(id).toMatch(/^widx:[0-9a-f]{32}$/);
    expect(await documentId('https://example.com/page')).toBe(id);
  });

  it('produces a 64-char content hash', async () => {
    expect(await contentHash('Title', 'Desc')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildIndexEvent', () => {
  const input = {
    url: 'https://example.com/page?utm_source=x&id=7',
    title: 'Example Page',
    description: 'A short description.',
    tags: ['Nostr', 'privacy tools', 'nostr'],
    language: 'EN',
    published: 1754600000,
    source: '0xsearchstr-web/1',
  };

  it('builds a valid observation event', async () => {
    const event = await buildIndexEvent(input);
    expect(event).not.toBeNull();
    expect(event!.kind).toBe(WEB_INDEX_KIND);

    const tags = event!.tags;
    expect(tags.find(([n]) => n === 'd')?.[1]).toMatch(/^widx:[0-9a-f]{32}$/);
    expect(tags.find(([n]) => n === 'u')?.[1]).toBe('https://example.com/page?id=7');
    expect(tags.find(([n]) => n === 'v')?.[1]).toBe(WEB_INDEX_SCHEMA_VERSION);
    expect(tags.find(([n]) => n === 'x')?.[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(tags.find(([n]) => n === 'l')?.[1]).toBe('en');
    expect(tags.find(([n]) => n === 'alt')?.[1]).toContain('Example Page');

    // Tags deduped + normalized.
    const tTags = tags.filter(([n]) => n === 't').map(([, v]) => v);
    expect(tTags).toEqual(['nostr', 'privacy-tools']);

    const content = JSON.parse(event!.content) as Record<string, string>;
    expect(content.title).toBe('Example Page');
    expect(content.description).toBe('A short description.');
  });

  it('produces the same d-tag for equivalent URLs (cross-indexer agreement)', async () => {
    const a = await buildIndexEvent({ url: 'https://www.example.com/p/?gclid=z', title: 'T' });
    const b = await buildIndexEvent({ url: 'https://example.com/p', title: 'T' });
    expect(a!.tags.find(([n]) => n === 'd')).toEqual(b!.tags.find(([n]) => n === 'd'));
  });

  it('rejects unusable input', async () => {
    expect(await buildIndexEvent({ url: 'javascript:alert(1)', title: 'X' })).toBeNull();
    expect(await buildIndexEvent({ url: 'https://example.com/', title: '   ' })).toBeNull();
  });

  it('caps field lengths', async () => {
    const event = await buildIndexEvent({
      url: 'https://example.com/',
      title: 'T'.repeat(1000),
      description: 'D'.repeat(5000),
      tags: Array.from({ length: 30 }, (_, i) => `tag${i}`),
    });
    const content = JSON.parse(event!.content) as Record<string, string>;
    expect(content.title.length).toBe(300);
    expect(content.description.length).toBe(1000);
    expect(event!.tags.filter(([n]) => n === 't').length).toBe(8);
  });

  it('signs + verifies as a real Nostr event', async () => {
    const sk = generateSecretKey();
    const template = (await buildIndexEvent(input))!;
    const signed = finalizeEvent(
      { ...template, created_at: Math.floor(Date.now() / 1000), pubkey: getPublicKey(sk) },
      sk,
    );
    expect(verifyEvent(signed)).toBe(true);
  });
});

describe('parseIndexEvent', () => {
  async function makeEvent(overrides: { content?: string; tags?: string[][] } = {}) {
    const sk = generateSecretKey();
    const template = (await buildIndexEvent({
      url: 'https://example.com/page',
      title: 'Example Page',
      description: 'Desc',
      tags: ['nostr'],
    }))!;
    return finalizeEvent(
      {
        kind: WEB_INDEX_KIND,
        created_at: 1754650000,
        tags: overrides.tags ?? template.tags,
        content: overrides.content ?? template.content,
        pubkey: getPublicKey(sk),
      },
      sk,
    );
  }

  it('round-trips a built event', async () => {
    const event = await makeEvent();
    const obs = parseIndexEvent(event);
    expect(obs).not.toBeNull();
    expect(obs!.title).toBe('Example Page');
    expect(obs!.url).toBe('https://example.com/page');
    expect(obs!.topics).toEqual(['nostr']);
    expect(obs!.indexer).toBe(event.pubkey);
    expect(obs!.observedAt).toBe(1754650000);
  });

  it('rejects wrong kind / version / malformed content', async () => {
    const wrongKind = await makeEvent();
    expect(parseIndexEvent({ ...wrongKind, kind: 30078 })).toBeNull();

    const badVersion = await makeEvent({
      tags: (await buildIndexEvent({ url: 'https://example.com/page', title: 'T' }))!.tags.map(
        (t) => (t[0] === 'v' ? ['v', '999'] : t),
      ),
    });
    expect(parseIndexEvent(badVersion)).toBeNull();

    const badContent = await makeEvent({ content: 'not json' });
    expect(parseIndexEvent(badContent)).toBeNull();
  });

  it('rejects events whose u tag fails the allowlist', async () => {
    const event = await makeEvent({
      tags: (await buildIndexEvent({ url: 'https://example.com/page', title: 'T' }))!.tags.map(
        (t) => (t[0] === 'u' ? ['u', 'javascript:alert(1)'] : t),
      ),
    });
    expect(parseIndexEvent(event)).toBeNull();
  });
});

describe('observationFromResult', () => {
  it('converts web results and skips nostr-internal ones', () => {
    const web = observationFromResult({
      id: 'x', title: 'Page', url: 'https://example.com/', snippet: 'S',
      source: 'web', provider: 'searxng',
    });
    expect(web).not.toBeNull();
    expect(web!.source).toBe('0xpresearchstr-web/1');

    const internal = observationFromResult({
      id: 'x', title: 'Note', url: '/note1abc', snippet: 'S',
      source: 'nostr', provider: 'nostr',
    });
    expect(internal).toBeNull();
  });
});

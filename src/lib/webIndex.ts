/**
 * Search Index Protocol (SIP-01) v1.1 — reference implementation.
 * Canonical spec: https://github.com/NostrDanish/SIP-01 (local copy: docs/SIP-01.md)
 *
 * One addressable event (kind 39697) per indexed web document:
 *   d = "widx:" + sha256(normalized_url)[0:32]   ← URL identity
 *   u = canonical URL
 *   x = sha256(title + "\n" + description)       ← content identity
 *   v = "1"                                      ← schema version
 *   content = { title, description?, image? }
 *
 * The event NEVER contains a search query, a user identity, or anything
 * about who surfaced the page. Indexer identity = the event pubkey.
 *
 * Byte-compatibility matters: every implementation in the ecosystem must
 * produce identical `d`/`x` values for the same page, or deduplication
 * breaks. This module is covered by the spec §13 test vectors
 * (see webIndex.test.ts).
 */
import type { NostrEvent } from '@nostrify/nostrify';

import type { SearchResult } from '@/lib/providers/types';

/** Web Index Observation kind (addressable). Draft allocation — see spec §2. */
export const WEB_INDEX_KIND = 39697;

/** Current schema version (the `v` tag). */
export const WEB_INDEX_SCHEMA_VERSION = '1';

/** d-tag namespace prefix (spec §3). */
export const WEB_INDEX_D_PREFIX = 'widx:';

/* Hard caps (spec §5/§6) */
const MAX_URL_LEN = 2048;
const MAX_TITLE_LEN = 300;
const MAX_DESCRIPTION_LEN = 1000;
const MAX_IMAGE_LEN = 2048;
const MAX_SOURCE_LEN = 100;
const MAX_TAGS = 8;

/** Topic tag shape (spec §6): lowercase keyword, e.g. "nostr", "web-search". */
export const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** Extension keyword shape (spec §9.1 rule 5). */
export const EXTENSION_VALUE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/;

/** MIME type with optional parameters (spec §9.2, `mime` extension). */
export const MIME_RE =
  /^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]{0,126}\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]{0,126}(;\s*[^\s;=]+=[^\s;]+)*$/;

/** ISO 639-1 language code shape (spec §6, `l` tag). */
const LANGUAGE_RE = /^[a-z]{2}$/;

/** ISO 3166-1 alpha-2 country code shape (spec §9.2, `country` extension). */
const COUNTRY_RE = /^[A-Z]{2}$/;

/** Registered keyword-shaped extension tags (spec §9.2). */
const KEYWORD_EXTENSIONS = ['type', 'platform', 'category', 'network'] as const;

/** All registered extension tags this module knows how to build/parse. */
const EXTENSION_TAGS = [...KEYWORD_EXTENSIONS, 'country', 'mime'] as const;

/** Tracking parameters stripped during normalization (spec §7 step 5). */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'dclid', 'mc_cid', 'mc_eid', 'igshid', 'ref_src',
  'spm', 'si',
]);

/**
 * Normalize a URL for document identity (spec §7).
 * Implementations MUST produce byte-identical output for the same page.
 * Returns null for invalid or disallowed (non-http/https) URLs.
 */
export function normalizeIndexUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  // Lowercase host handled by URL; strip leading www.
  url.hostname = url.hostname.replace(/^www\./, '');

  // Default ports.
  if ((url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }

  // Fragment never identifies content for indexing purposes.
  url.hash = '';

  // Strip tracking params, keep everything else, sort deterministically
  // (stable for duplicate keys).
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [key, value] of params) url.searchParams.append(key, value);

  // Trailing slash on non-root paths.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/** SHA-256 hex (lowercase) of a UTF-8 string. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** URL identity (spec §3): "widx:" + first 32 hex chars of sha256(normalized). */
export async function documentId(normalizedUrl: string): Promise<string> {
  const hex = await sha256Hex(normalizedUrl);
  return `${WEB_INDEX_D_PREFIX}${hex.slice(0, 32)}`;
}

/** Content identity (spec §8): sha256(title + "\n" + description), absent description = "". */
export async function contentHash(title: string, description = ''): Promise<string> {
  return sha256Hex(`${title}\n${description}`);
}

/** Input for building an observation event. */
export interface IndexObservationInput {
  url: string;
  title: string;
  description?: string;
  image?: string;
  tags?: string[];
  language?: string;
  published?: number;
  source?: string; // indexer software id, e.g. "0xpresearchstr-web/1"
  /* Registered extension tags (spec §9.2) — all optional, all validated. */
  /** Logical document type: page, article, repository, video, image, file, … */
  type?: string;
  /** Source platform: github, gitlab, youtube, … */
  platform?: string;
  /** Content category, engine-defined vocabulary. */
  category?: string;
  /** Network the document lives on: clearnet, tor, i2p, … */
  network?: string;
  /** ISO 3166-1 alpha-2 country code (normalized to uppercase). */
  country?: string;
  /** Document media type, e.g. application/pdf. */
  mime?: string;
}

export interface UnsignedIndexEvent {
  kind: number;
  content: string;
  tags: string[][];
}

/**
 * Build an unsigned web-index observation event.
 * Returns null when the input is unusable (bad/overlong URL, empty title).
 * Invalid optional fields are dropped, never fatal (extensions are optional
 * by definition — spec §9.1 rule 1).
 */
export async function buildIndexEvent(
  input: IndexObservationInput,
): Promise<UnsignedIndexEvent | null> {
  const normalized = normalizeIndexUrl(input.url);
  if (!normalized || normalized.length > MAX_URL_LEN) return null;

  const title = input.title.trim().slice(0, MAX_TITLE_LEN);
  if (!title) return null;

  const description = (input.description ?? '').trim().slice(0, MAX_DESCRIPTION_LEN);

  let image = (input.image ?? '').trim().slice(0, MAX_IMAGE_LEN);
  if (image && !/^https:\/\//i.test(image)) image = ''; // images: https only

  const d = await documentId(normalized);
  // x is computed over the truncated values actually published (spec §8).
  const x = await contentHash(title, description);

  const topics = (input.tags ?? [])
    .map((t) => t.toLowerCase().trim().replace(/\s+/g, '-'))
    .filter((t) => TOPIC_RE.test(t))
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, MAX_TAGS);

  const language = (input.language ?? '').trim().toLowerCase();

  const tags: string[][] = [
    ['d', d],
    ['u', normalized],
    ...topics.map((t): string[] => ['t', t]),
    ...(LANGUAGE_RE.test(language) ? [['l', language] as string[]] : []),
    ['x', x],
    ['v', WEB_INDEX_SCHEMA_VERSION],
    ...(input.published ? [['published', String(Math.floor(input.published))] as string[]] : []),
    ...(input.source ? [['source', input.source.trim().slice(0, MAX_SOURCE_LEN)] as string[]] : []),
    ...buildExtensionTags(input),
    ['alt', `Web index observation: ${title}`],
  ];

  const content: Record<string, string> = { title };
  if (description) content.description = description;
  if (image) content.image = image;

  return { kind: WEB_INDEX_KIND, content: JSON.stringify(content), tags };
}

/** Validate + normalize the registered extension tags (spec §9.2). Invalid values are omitted. */
function buildExtensionTags(input: IndexObservationInput): string[][] {
  const tags: string[][] = [];

  for (const name of KEYWORD_EXTENSIONS) {
    const value = input[name];
    if (value && EXTENSION_VALUE_RE.test(value)) {
      tags.push([name, value.toLowerCase()]);
    }
  }

  if (input.country) {
    const country = input.country.trim().toUpperCase();
    if (COUNTRY_RE.test(country)) tags.push(['country', country]);
  }

  if (input.mime) {
    const mime = input.mime.trim().toLowerCase();
    if (MIME_RE.test(mime)) tags.push(['mime', mime]);
  }

  return tags;
}

/** A parsed, validated observation. */
export interface IndexObservation {
  /** Document id (d tag). */
  d: string;
  /** Canonical URL (u tag). */
  url: string;
  title: string;
  description: string;
  image?: string;
  topics: string[];
  language?: string;
  contentHash?: string;
  published?: number;
  source?: string;
  /** Registered extension tags present on the event (spec §9.2). */
  extensions: Record<string, string>;
  /** Event created_at — the observation time. */
  observedAt: number;
  /** Indexer pubkey (event author). */
  indexer: string;
  /** The raw event, for provenance. */
  event: NostrEvent;
}

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}

/**
 * Parse + validate a kind 39697 event. Returns null for anything malformed:
 * wrong kind, missing required fields, bad/overlong URL, unsupported version.
 * Cheap synchronous checks only — hash verification (d ↔ u, x ↔ content) is
 * available via verifyObservation() for readers that want spec §18 step 2.
 */
export function parseIndexEvent(event: NostrEvent): IndexObservation | null {
  if (event.kind !== WEB_INDEX_KIND) return null;

  const d = getTag(event, 'd');
  const url = getTag(event, 'u');
  const version = getTag(event, 'v');
  if (!d?.startsWith(WEB_INDEX_D_PREFIX) || !url || version !== WEB_INDEX_SCHEMA_VERSION) {
    return null;
  }
  if (url.length > MAX_URL_LEN) return null;

  const normalized = normalizeIndexUrl(url);
  if (!normalized) return null;

  let title = '';
  let description = '';
  let image: string | undefined;
  try {
    const parsed = JSON.parse(event.content) as Record<string, unknown>;
    title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, MAX_TITLE_LEN) : '';
    description = typeof parsed.description === 'string' ? parsed.description.trim().slice(0, MAX_DESCRIPTION_LEN) : '';
    if (typeof parsed.image === 'string' && /^https:\/\//i.test(parsed.image)) {
      image = parsed.image.slice(0, MAX_IMAGE_LEN);
    }
  } catch {
    return null;
  }
  if (!title) return null;

  const topics = event.tags
    .filter(([n]) => n === 't')
    .map(([, v]) => v)
    .filter((v) => TOPIC_RE.test(v))
    .slice(0, MAX_TAGS);

  const language = getTag(event, 'l');

  const publishedTag = getTag(event, 'published');
  const published = publishedTag ? parseInt(publishedTag, 10) : NaN;

  const extensions: Record<string, string> = {};
  for (const name of EXTENSION_TAGS) {
    const value = getTag(event, name);
    if (value !== undefined) extensions[name] = value;
  }

  return {
    d,
    url: normalized,
    title,
    description,
    image,
    topics,
    language: language && LANGUAGE_RE.test(language) ? language : undefined,
    contentHash: getTag(event, 'x'),
    published: Number.isFinite(published) ? published : undefined,
    source: getTag(event, 'source'),
    extensions,
    observedAt: event.created_at,
    indexer: event.pubkey,
    event,
  };
}

/**
 * Full integrity check (spec §18 step 2): verify the d tag matches the
 * normalized u tag, and — when present — the x tag matches the content.
 * This is what stops a spoofed observation from squatting on a popular
 * document's d-tag with fake metadata. Async because of SHA-256.
 */
export async function verifyObservation(obs: IndexObservation): Promise<boolean> {
  const expectedD = await documentId(obs.url);
  if (obs.d !== expectedD) return false;

  if (obs.contentHash) {
    const expectedX = await contentHash(obs.title, obs.description);
    if (obs.contentHash !== expectedX) return false;
  }

  return true;
}

/** Convert a search result into an observation input (for auto-indexing). */
export function observationFromResult(result: SearchResult): IndexObservationInput | null {
  if (!result.url || !/^https?:\/\//i.test(result.url)) return null;
  if (!result.title?.trim()) return null;
  return {
    url: result.url,
    title: result.title,
    description: result.snippet,
    image: result.thumbnail,
    tags: result.tags,
    published: result.timestamp,
    source: '0xpresearchstr-web/1',
  };
}

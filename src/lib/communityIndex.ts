/**
 * Community Index — user-submitted search results on Nostr.
 *
 * Presearchstr/0xSearchstr were built independently; the idea of letting
 * EVERY user curate the index (not just bots/crawlers) was adopted after
 * discovering Nostra Search (github.com/nostrasearch/nostrasearch.github.io,
 * GPL-3.0), a project exploring the same territory. Credit to them for the
 * community-curation idea — this is our own implementation with an
 * improved schema (unique per-URL d-tags; theirs reuse one d-tag per
 * author, so one author can only hold a single entry):
 *
 *   Presearchstr submissions (kind 30078, shared "0xsearchstr" namespace):
 *     ["d", "0xsearchstr:submit:<url-hash>"]   ← unique per URL
 *     ["t", "0xsearchstr-submit"]
 *     ["t", "<user tag>"] ...
 *     ["title", "<title>"]
 *     ["url", "<url>"]
 *     ["type", "<content type>"]
 *     ["alt", "..."]
 *     content: description
 *
 * Interop: this module also READS Nostra Search index events
 * (d-tag "nostra:index"), including their NOSTRA_ENC_V1 AES-GCM payloads.
 * Their encryption key is a published constant — it exists to evade
 * relay-level content filtering, not to restrict read access.
 */
import type { NostrEvent } from '@nostrify/nostrify';

import type { SearchResult } from '@/lib/providers/types';
import { detectContentType, contentTypeLabel, isValidSubmissionUrl, type ContentType } from '@/lib/contentType';

/** Kind used for community submissions (NIP-78 application data). */
export const COMMUNITY_KIND = 30078;

/** t-tag marking community submissions (shared with 0xSearchstr + forks). */
export const COMMUNITY_T_TAG = '0xsearchstr-submit';

/** Nostra Search index d-tag (for read interop). */
export const NOSTRA_D_TAG = 'nostra:index';

/** NIP-B0 web bookmark kind (read interop — user-curated web links). */
export const BOOKMARK_KIND = 39701;

/* ------------------------------------------------------------------ */
/* Building (Presearchstr submissions)                               */
/* ------------------------------------------------------------------ */

export interface SubmissionInput {
  url: string;
  title: string;
  description: string;
  tags: string[];
  type?: ContentType; // auto-detected when omitted
}

/** Deterministic d-tag so re-submitting the same URL replaces the user's entry. */
export async function submissionDTag(url: string): Promise<string> {
  const normalized = url.trim().toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `0xsearchstr:submit:${hex.slice(0, 24)}`;
}

/** Build tags + content for a community submission event (kind 30078). */
export async function buildSubmissionEvent(
  input: SubmissionInput,
): Promise<{ kind: number; content: string; tags: string[][] }> {
  const type = input.type ?? detectContentType(input.url);
  const dTag = await submissionDTag(input.url);

  const userTags = input.tags
    .map((t) => t.toLowerCase().trim().replace(/\s+/g, '-'))
    .filter((t) => t.length > 0 && t.length <= 40)
    .slice(0, 8);

  return {
    kind: COMMUNITY_KIND,
    content: input.description.trim(),
    tags: [
      ['d', dTag],
      ['t', COMMUNITY_T_TAG],
      ['t', type],
      ...userTags.map((t): string[] => ['t', t]),
      ['title', input.title.trim()],
      ['url', input.url.trim()],
      ['type', type],
      ['alt', `Presearchstr community index submission: ${input.title.trim()}`],
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Parsing (shared helpers)                                            */
/* ------------------------------------------------------------------ */

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}

/** Map a content type to the source tab it belongs to. */
function sourceForType(type: ContentType): SearchResult['source'] {
  return type === 'onion' ? 'tor' : 'web';
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch {
    if (url.startsWith('magnet:?')) return 'magnet link';
    if (url.startsWith('ipfs://') || url.startsWith('ipns://')) return 'ipfs';
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Parsing (0xsearchstr-protocol submissions)                          */
/* ------------------------------------------------------------------ */

/** Parse a 0xsearchstr-protocol community submission into a SearchResult. */
export function parseSubmissionEvent(event: NostrEvent): SearchResult | null {
  if (event.kind !== COMMUNITY_KIND) return null;
  if (!event.tags.some(([n, v]) => n === 't' && v === COMMUNITY_T_TAG)) return null;

  const title = getTag(event, 'title');
  const url = getTag(event, 'url');
  if (!title?.trim() || !url || !isValidSubmissionUrl(url)) return null;

  const typeTag = getTag(event, 'type') as ContentType | undefined;
  const type = typeTag ?? detectContentType(url);

  return {
    id: event.id,
    title: title.trim(),
    url: url.trim(),
    snippet: event.content.trim(),
    source: sourceForType(type),
    provider: 'community',
    timestamp: event.created_at,
    domain: extractDomain(url),
    // Type badge only for non-plain-web links ("Link" would be noise).
    kind: type === 'web' || type === 'other' ? undefined : contentTypeLabel(type),
    engine: 'Community',
    tags: event.tags.filter(([n]) => n === 't').map(([, v]) => v)
      .filter((v) => v !== COMMUNITY_T_TAG && v !== type).slice(0, 5),
    score: 96, // Nostr-curated — just below organic Nostr results (100)
    nostrEvent: event,
  };
}

/* ------------------------------------------------------------------ */
/* Parsing (NIP-B0 web bookmarks, kind 39701)                          */
/* ------------------------------------------------------------------ */

/**
 * Parse a NIP-B0 web bookmark into a SearchResult. The `d` tag is the
 * bookmarked URI — with the scheme omitted when it's https (per the NIP),
 * so reconstruct it. Bookmarks are user-curated by definition: any author
 * is accepted, structure + URL scheme are validated instead.
 */
export function parseBookmarkEvent(event: NostrEvent): SearchResult | null {
  if (event.kind !== BOOKMARK_KIND) return null;

  const d = getTag(event, 'd');
  if (!d?.trim()) return null;

  const raw = d.trim();
  const url = raw.includes('://') ? raw : `https://${raw}`;
  if (!isValidSubmissionUrl(url)) return null;

  const title = getTag(event, 'title')?.trim() || url;
  const publishedTag = getTag(event, 'published_at');
  const published = publishedTag ? parseInt(publishedTag, 10) : NaN;

  return {
    id: event.id,
    title,
    url,
    snippet: event.content.trim(),
    source: 'web',
    provider: 'nostr-bookmark',
    timestamp: Number.isFinite(published) ? published : event.created_at,
    domain: extractDomain(url),
    kind: 'Bookmark',
    engine: 'Nostr Bookmark',
    tags: event.tags.filter(([n]) => n === 't').map(([, v]) => v).slice(0, 5),
    score: 94, // curated by a real user, below native submissions (96)
    nostrEvent: event,
  };
}

/* ------------------------------------------------------------------ */
/* Nostra Search interop (read-only)                                   */
/* ------------------------------------------------------------------ */

/**
 * Their published obfuscation key — SHA-256 of this constant becomes the
 * AES-GCM key. Public by design: it defeats naive relay-level censorship
 * of index entries, it is not an access-control mechanism.
 */
const NOSTRA_CIPHER_SECRET = 'NOSTRA_CENSORSHIP_RESISTANT_SEARCH_KEY_V1';

let nostraKeyPromise: Promise<CryptoKey> | null = null;

function getNostraKey(): Promise<CryptoKey> {
  if (!nostraKeyPromise) {
    nostraKeyPromise = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(NOSTRA_CIPHER_SECRET))
      .then((material) =>
        crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['decrypt']),
      );
  }
  return nostraKeyPromise;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

interface NostraPayload {
  title?: string;
  url?: string;
  type?: ContentType;
  description?: string;
  tags?: string[];
  lang?: string;
}

/** Decrypt a NOSTRA_ENC_V1 payload. Returns null on plaintext or failure. */
async function decryptNostraPayload(content: string): Promise<NostraPayload | null> {
  if (!content.startsWith('NOSTRA_ENC_V1:')) return null;

  const parts = content.split(':');
  if (parts.length < 3) return null;
  const [, ivB64, cipherB64] = parts;

  try {
    if (ivB64 === 'RAW') {
      // Their fallback when Web Crypto is unavailable: base64-encoded JSON.
      const json = decodeURIComponent(escape(atob(cipherB64)));
      return JSON.parse(json) as NostraPayload;
    }

    const key = await getNostraKey();
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivB64) as BufferSource },
      key,
      base64ToBytes(cipherB64) as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as NostraPayload;
  } catch {
    return null;
  }
}

/**
 * Parse a Nostra Search index event (d-tag "nostra:index") into a
 * SearchResult. Handles both plaintext (title/url tags) and
 * NOSTRA_ENC_V1 encrypted payloads. Async because of Web Crypto.
 */
export async function parseNostraEvent(event: NostrEvent): Promise<SearchResult | null> {
  if (event.kind !== COMMUNITY_KIND) return null;
  if (getTag(event, 'd') !== NOSTRA_D_TAG) return null;

  let title: string | undefined;
  let url: string | undefined;
  let type: ContentType | undefined;
  let description = '';
  let tags: string[] = [];

  if (event.content.startsWith('NOSTRA_ENC_V1:')) {
    const payload = await decryptNostraPayload(event.content);
    if (!payload) return null;
    title = payload.title;
    url = payload.url;
    type = payload.type;
    description = payload.description ?? '';
    tags = Array.isArray(payload.tags) ? payload.tags : [];
  } else {
    title = getTag(event, 'title') ?? getTag(event, 'subject');
    url = getTag(event, 'url') ?? getTag(event, 'magnet') ?? getTag(event, 'r');
    description = event.content;
    tags = event.tags.filter(([n]) => n === 't').map(([, v]) => v);
  }

  if (!title?.trim() || !url || !isValidSubmissionUrl(url)) return null;

  const resolvedType = type ?? detectContentType(url);

  return {
    id: event.id,
    title: title.trim(),
    url: url.trim(),
    snippet: description.trim(),
    source: sourceForType(resolvedType),
    provider: 'nostra-index',
    timestamp: event.created_at,
    domain: extractDomain(url),
    kind: resolvedType === 'web' || resolvedType === 'other' ? undefined : contentTypeLabel(resolvedType),
    engine: 'Nostra Index',
    tags: tags.filter((t) => t !== 'nostra-encrypted').slice(0, 5),
    score: 92,
    nostrEvent: event,
  };
}

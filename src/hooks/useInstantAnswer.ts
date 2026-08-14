/**
 * Instant answers — direct answers shown above the result list.
 *
 * Detectors, in priority order:
 *
 *   1. Calculator    — "2 + 2", "(3+4)*5", "15% of 80" → computed locally.
 *   2. Nostr profile — a bare npub1…/nprofile1… query → profile card.
 *   3. Nostr event   — a bare note1…/nevent1…/naddr1… → open-event card.
 *   4. NIP-05        — name@domain.tld → resolve to profile card.
 *   5. URL           — a pasted link → SIP-01 index status + open card.
 *   6. Wikipedia     — strong title match → first-paragraph summary card.
 *   7. DuckDuckGo    — free keyless Instant Answer API (abstracts, definitions,
 *                      direct answers) as the backfill when Wikipedia doesn't
 *                      strong-match.
 *
 * The Wikipedia, NIP-05, and DuckDuckGo detectors are skipped in Privacy Mode
 * (direct/proxied API calls). Calculator, NIP-19, and URL-index detection are
 * local or Nostr-tier.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { NIP05 } from '@nostrify/nostrify';

import { evaluateMath, formatMathResult, isMathQuery } from '@/lib/calculator';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { classifyQuery } from '@/lib/queryClassify';
import { documentId, normalizeIndexUrl, parseIndexEvent } from '@/lib/webIndex';
import { getIndexRelayUrls } from '@/lib/appRelays';
import { queryRelayPool } from '@/lib/searchRelays';
import { useAppContext } from '@/hooks/useAppContext';

export type InstantAnswer =
  | { type: 'calculator'; expression: string; result: string }
  | { type: 'profile'; pubkey: string; bech32: string }
  | { type: 'event'; bech32: string; label: string }
  | { type: 'url'; url: string; indexed?: { title: string; description: string; indexerCount: number } }
  | { type: 'wikipedia'; title: string; extract: string; url: string; thumbnail?: string }
  | { type: 'duckduckgo'; heading: string; text: string; source: string; url: string; image?: string };

/* ─── Wikipedia ─── */

interface WikiSearchResponse {
  query?: { search: { title: string }[] };
}

interface WikiExtractResponse {
  query?: {
    pages?: Record<string, {
      title?: string;
      extract?: string;
      thumbnail?: { source: string };
      missing?: boolean;
    }>;
  };
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Does the Wikipedia article title match the query strongly enough for an instant answer? */
function isStrongTitleMatch(query: string, title: string): boolean {
  const q = normalizeTitle(query);
  const t = normalizeTitle(title);
  if (q === t) return true;
  // "bitcoin" matches "Bitcoin (protocol)"? No — too fuzzy. Only prefix matches.
  if (t.startsWith(q) && t.length <= q.length + 4) return true;
  return false;
}

async function fetchWikipediaAnswer(query: string, signal?: AbortSignal): Promise<InstantAnswer | null> {
  // Step 1: find the top article title.
  const searchParams = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '3',
    format: 'json',
    origin: '*',
  });

  const searchRes = await fetch(`https://en.wikipedia.org/w/api.php?${searchParams}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
    headers: { Accept: 'application/json' },
  });
  if (!searchRes.ok) return null;

  const searchData = await searchRes.json() as WikiSearchResponse;
  const hits = searchData.query?.search ?? [];
  const match = hits.find((h) => isStrongTitleMatch(query, h.title));
  if (!match) return null;

  // Step 2: fetch the plain-text intro extract + thumbnail.
  const extractParams = new URLSearchParams({
    action: 'query',
    prop: 'extracts|pageimages',
    exintro: '1',
    explaintext: '1',
    exchars: '420',
    pithumbsize: '160',
    titles: match.title,
    format: 'json',
    origin: '*',
    redirects: '1',
  });

  const extractRes = await fetch(`https://en.wikipedia.org/w/api.php?${extractParams}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
    headers: { Accept: 'application/json' },
  });
  if (!extractRes.ok) return null;

  const extractData = await extractRes.json() as WikiExtractResponse;
  const page = Object.values(extractData.query?.pages ?? {})[0];
  if (!page || page.missing || !page.extract) return null;

  const title = page.title ?? match.title;
  return {
    type: 'wikipedia',
    title,
    extract: page.extract.trim(),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    thumbnail: page.thumbnail?.source ? sanitizeUrl(page.thumbnail.source) : undefined,
  };
}

/* ─── DuckDuckGo Instant Answers (free, keyless) ─── */

const CORS_PROXY = 'https://proxy.shakespeare.diy/?url=';

interface DDGInstantResponse {
  Heading?: string;
  AbstractText?: string;
  AbstractSource?: string;
  AbstractURL?: string;
  Answer?: string;
  Definition?: string;
  DefinitionSource?: string;
  DefinitionURL?: string;
  Image?: string;
}

/**
 * DuckDuckGo's Instant Answer API — free, no key, no account. Returns direct
 * answers, abstracts (mostly Wikipedia-sourced), and dictionary definitions.
 * Not a web-results API — it fills the "answer box" slot only.
 */
async function fetchDuckDuckGoAnswer(query: string, signal?: AbortSignal): Promise<InstantAnswer | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
    t: 'presearchstr',
  });
  const target = `https://api.duckduckgo.com/?${params}`;
  const res = await fetch(`${CORS_PROXY}${encodeURIComponent(target)}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as DDGInstantResponse;

  // Priority: direct Answer (facts/conversions) > abstract > definition.
  const answerText = data.Answer?.trim();
  const abstract = data.AbstractText?.trim();
  const definition = data.Definition?.trim();
  const text = answerText || abstract || definition;
  if (!text) return null;

  const sourceUrl = sanitizeUrl(data.AbstractURL ?? '') || sanitizeUrl(data.DefinitionURL ?? '');
  return {
    type: 'duckduckgo',
    heading: data.Heading?.trim() || query,
    text,
    source: answerText ? 'DuckDuckGo' : (data.AbstractSource ?? data.DefinitionSource ?? 'DuckDuckGo'),
    url: sourceUrl || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    // DDG image paths are relative ("/i/abc.png").
    image: data.Image ? sanitizeUrl(`https://duckduckgo.com${data.Image}`) || undefined : undefined,
  };
}

/* ─── NIP-19 (profile + event) ─── */

function detectNip19(query: string): InstantAnswer | null {
  const q = query.trim();

  let decoded: ReturnType<typeof nip19.decode>;
  try {
    decoded = nip19.decode(q);
  } catch {
    return null;
  }

  switch (decoded.type) {
    case 'npub':
      return { type: 'profile', pubkey: decoded.data, bech32: q };
    case 'nprofile':
      return { type: 'profile', pubkey: decoded.data.pubkey, bech32: q };
    case 'note':
      return { type: 'event', bech32: q, label: 'Open this note' };
    case 'nevent':
      return { type: 'event', bech32: q, label: 'Open this event' };
    case 'naddr':
      return { type: 'event', bech32: q, label: 'Open this addressable event' };
    default:
      return null;
  }
}

/* ─── NIP-05 resolution ─── */

async function resolveNip05(address: string, signal?: AbortSignal): Promise<InstantAnswer | null> {
  const pointer = await NIP05.lookup(address, { signal });
  if (!pointer?.pubkey) return null;
  return {
    type: 'profile',
    pubkey: pointer.pubkey,
    bech32: nip19.npubEncode(pointer.pubkey),
  };
}

/* ─── URL → SIP-01 index status ─── */

async function fetchUrlAnswer(query: string, signal?: AbortSignal): Promise<InstantAnswer | null> {
  // Ensure a scheme so normalization works on bare "domain.tld/path" input.
  const withScheme = /^https?:\/\//i.test(query) ? query : `https://${query}`;
  const normalized = normalizeIndexUrl(withScheme);
  if (!normalized) return { type: 'url', url: withScheme };

  const d = await documentId(normalized);

  const settled = await queryRelayPool(
    getIndexRelayUrls(),
    [{ kinds: [39697], '#d': [d], limit: 20 }],
    { signal, timeoutMs: 4000 },
  );

  const indexers = new Set<string>();
  let latest: { title: string; description: string; observedAt: number } | null = null;

  for (const value of settled) {
    for (const ev of value) {
      const obs = parseIndexEvent(ev);
      if (!obs) continue;
      indexers.add(obs.indexer);
      if (!latest || obs.observedAt > latest.observedAt) {
        latest = { title: obs.title, description: obs.description, observedAt: obs.observedAt };
      }
    }
  }

  return {
    type: 'url',
    url: normalized,
    indexed: latest
      ? { title: latest.title, description: latest.description, indexerCount: indexers.size }
      : undefined,
  };
}

/* ─── Hook ─── */

export function useInstantAnswer(query: string, enabled: boolean): {
  answer: InstantAnswer | null;
  isLoading: boolean;
} {
  const { config } = useAppContext();
  const trimmed = query.trim();
  const queryClass = useMemo(() => classifyQuery(trimmed), [trimmed]);

  // 1. Calculator — fully local, always allowed.
  const calculator = useMemo<InstantAnswer | null>(() => {
    if (!enabled || queryClass !== 'math') return null;
    const value = evaluateMath(trimmed);
    if (value === null) return null;
    return { type: 'calculator', expression: trimmed, result: formatMathResult(value) };
  }, [trimmed, enabled, queryClass]);

  // 2+3. NIP-19 profile/event — local decode, always allowed.
  const nip19Answer = useMemo<InstantAnswer | null>(() => {
    if (!enabled || queryClass !== 'nip19') return null;
    return detectNip19(trimmed);
  }, [trimmed, enabled, queryClass]);

  // 4. NIP-05 — resolves name@domain to a profile (direct API: skipped in Privacy Mode).
  const nip05Enabled = enabled && !calculator && !nip19Answer && queryClass === 'nip05' && !config.privacyMode;
  const { data: nip05Answer } = useQuery({
    queryKey: ['instant-answer', 'nip05', trimmed],
    queryFn: ({ signal }) => resolveNip05(trimmed, signal),
    enabled: nip05Enabled,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  // 5. URL — SIP-01 index lookup (Nostr-tier, works in Privacy Mode).
  const urlEnabled = enabled && !calculator && !nip19Answer && queryClass === 'url';
  const { data: urlAnswer } = useQuery({
    queryKey: ['instant-answer', 'url', trimmed],
    queryFn: ({ signal }) => fetchUrlAnswer(trimmed, signal),
    enabled: urlEnabled,
    staleTime: 60_000,
    retry: 0,
  });

  // 6. Wikipedia — direct API, skipped in Privacy Mode and for non-text queries.
  const wikiEnabled =
    enabled &&
    !calculator &&
    !nip19Answer &&
    !config.privacyMode &&
    queryClass === 'text' &&
    trimmed.length >= 2 &&
    trimmed.length <= 80;

  const { data: wikiAnswer, isLoading } = useQuery({
    queryKey: ['instant-answer', 'wikipedia', trimmed],
    queryFn: ({ signal }) => fetchWikipediaAnswer(trimmed, signal),
    enabled: wikiEnabled,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  // 7. DuckDuckGo instant answers — the backfill when Wikipedia doesn't
  // strong-match (definitions, direct answers, disambiguated topics).
  // Proxied third-party API: skipped in Privacy Mode.
  const ddgEnabled = wikiEnabled && wikiAnswer === null;
  const { data: ddgAnswer } = useQuery({
    queryKey: ['instant-answer', 'duckduckgo', trimmed],
    queryFn: ({ signal }) => fetchDuckDuckGoAnswer(trimmed, signal),
    enabled: ddgEnabled,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  const answer = calculator
    ?? nip19Answer
    ?? (nip05Enabled ? nip05Answer ?? null : null)
    ?? (urlEnabled ? urlAnswer ?? null : null)
    ?? (wikiEnabled ? wikiAnswer ?? null : null)
    ?? (ddgEnabled ? ddgAnswer ?? null : null);

  return { answer, isLoading: wikiEnabled && isLoading };
}

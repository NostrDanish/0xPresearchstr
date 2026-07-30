/**
 * Instant answers — direct answers shown above the result list.
 *
 * Three detectors, in priority order:
 *
 *   1. Calculator   — "2 + 2", "(3+4)*5", "15% of 80" → computed locally.
 *   2. Nostr profile — a bare npub1…/nprofile1… query → profile card.
 *   3. Wikipedia    — strong title match → first-paragraph summary card.
 *
 * The Wikipedia detector is skipped in Privacy Mode (it's a direct API).
 * Calculator and profile detection are fully local / Nostr-tier.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';

import { evaluateMath, formatMathResult, isMathQuery } from '@/lib/calculator';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { useAppContext } from '@/hooks/useAppContext';

export type InstantAnswer =
  | { type: 'calculator'; expression: string; result: string }
  | { type: 'profile'; pubkey: string; bech32: string }
  | { type: 'wikipedia'; title: string; extract: string; url: string; thumbnail?: string };

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

/* ─── NIP-19 profile ─── */

function detectProfile(query: string): InstantAnswer | null {
  const q = query.trim();
  if (!/^(npub1|nprofile1)[02-9ac-hj-np-z]+$/.test(q)) return null;

  try {
    const decoded = nip19.decode(q);
    if (decoded.type === 'npub') {
      return { type: 'profile', pubkey: decoded.data, bech32: q };
    }
    if (decoded.type === 'nprofile') {
      return { type: 'profile', pubkey: decoded.data.pubkey, bech32: q };
    }
  } catch {
    return null;
  }
  return null;
}

/* ─── Hook ─── */

export function useInstantAnswer(query: string, enabled: boolean): {
  answer: InstantAnswer | null;
  isLoading: boolean;
} {
  const { config } = useAppContext();
  const trimmed = query.trim();

  // 1. Calculator — fully local, always allowed.
  const calculator = useMemo<InstantAnswer | null>(() => {
    if (!enabled || !isMathQuery(trimmed)) return null;
    const value = evaluateMath(trimmed);
    if (value === null) return null;
    return { type: 'calculator', expression: trimmed, result: formatMathResult(value) };
  }, [trimmed, enabled]);

  // 2. NIP-19 profile — local decode, always allowed.
  const profile = useMemo<InstantAnswer | null>(() => {
    if (!enabled || calculator) return null;
    return detectProfile(trimmed);
  }, [trimmed, enabled, calculator]);

  // 3. Wikipedia — direct API, skipped in Privacy Mode.
  const wikiEnabled =
    enabled &&
    !calculator &&
    !profile &&
    !config.privacyMode &&
    trimmed.length >= 2 &&
    trimmed.length <= 80 &&
    // Skip queries that look like NIP-19 identifiers or URLs.
    !/^(npub1|nprofile1|note1|nevent1|naddr1|https?:)/i.test(trimmed);

  const { data: wikiAnswer, isLoading } = useQuery({
    queryKey: ['instant-answer', 'wikipedia', trimmed],
    queryFn: ({ signal }) => fetchWikipediaAnswer(trimmed, signal),
    enabled: wikiEnabled,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  const answer = calculator ?? profile ?? (wikiEnabled ? wikiAnswer ?? null : null);

  return { answer, isLoading: wikiEnabled && isLoading };
}

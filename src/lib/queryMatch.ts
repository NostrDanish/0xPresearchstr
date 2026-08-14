/**
 * Shared query tokenization + matching for client-side providers.
 *
 * Relays can't full-text search arbitrary tags, so the community and
 * web-index providers fetch recent events and match locally. This module
 * makes that matching smarter than a naive substring AND:
 *
 *   - punctuation-insensitive: "C++" matches "c", "state-of-the-art"
 *     matches "state of the art";
 *   - stop-word tolerant: "the / a / of / …" don't filter results out when
 *     the query also carries meaningful words (they still count when the
 *     query is ONLY stop words, e.g. "the who");
 *   - naive plural folding: a term also matches its de-pluralized form
 *     ("wallets" matches "wallet", "queries" matches "query");
 *   - NIP-50 operator tokens (containing ':') never match literally —
 *     they're relay-side directives (site:, lang:, after:, …);
 *   - phrase-aware: a full-phrase substring match scores highest;
 *   - gutting guard: when stop-word removal shrinks a multi-word query to a
 *     single keyword ("how to build" → "build"), a document must ALSO match
 *     a second query word or the phrase itself — otherwise every page
 *     containing "build" (or "builder", via substring) would rank for it.
 *     This was the "it only searched one word" bug.
 */

/** Words too common to discriminate with (dropped when other terms exist). */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'at',
  'by', 'from', 'with', 'is', 'it', 'its', 'as', 'be', 'are', 'was', 'were',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'how', 'why',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'i', 'my',
]);

/** Normalize a text chunk for matching: lowercase, fold punctuation to spaces. */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
}

/** Naive singular: "wallets"→"wallet", "queries"→"query", "pages"→"page". */
function foldPlural(term: string): string {
  if (term.length > 4 && term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  if (term.length > 3 && term.endsWith('es')) return term.slice(0, -2);
  if (term.length > 2 && term.endsWith('s') && !term.endsWith('ss')) return term.slice(0, -1);
  return term;
}

export interface QueryTerms {
  /** Terms that must ALL match (after stop-word/operator filtering). */
  terms: string[];
  /** Every raw term incl. stop words (deduped) — used for coverage scoring. */
  allTerms: string[];
  /** The whole normalized query — used for phrase matching. */
  phrase: string;
  /** True when the query had no discriminating terms (all stop words). */
  onlyStopWords: boolean;
}

/**
 * Tokenize a raw query into matchable terms.
 * - Splits on whitespace/punctuation, drops sub-2-char fragments.
 * - Drops operator tokens (containing ':').
 * - Drops stop words when meaningful terms exist alongside them.
 * - Each returned term also implicitly covers its plural-folded form
 *   (handled at match time, not duplicated here).
 */
export function tokenizeQuery(query: string): QueryTerms {
  const raw = normalizeText(query)
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const meaningful = raw.filter((t) => !STOP_WORDS.has(t));
  const onlyStopWords = raw.length > 0 && meaningful.length === 0;

  return {
    terms: meaningful.length > 0 ? meaningful : raw,
    allTerms: [...new Set(raw)],
    phrase: normalizeText(query).trim(),
    onlyStopWords,
  };
}

/** Also split operators out BEFORE normalization for the raw query form. */
export function tokenizeRaw(query: string): QueryTerms {
  const noOperators = query
    .split(/\s+/)
    .filter((t) => !t.includes(':'))
    .join(' ');
  return tokenizeQuery(noOperators);
}

/** Does a single term appear in the (space-padded) haystack? */
function termMatches(haystack: string, term: string): boolean {
  const folded = foldPlural(term);
  return (
    haystack.includes(` ${term} `)
    || (folded !== term && haystack.includes(` ${folded} `))
    // Substring fallback for compounds ("websearch" contains "search") —
    // long terms only: a 2–3 char substring ("to", "ai") matches inside
    // unrelated words ("history", "said") and destroys the guard's value.
    || (term.length >= 4 && haystack.includes(term))
  );
}

export interface TermMatch {
  /** Whether the haystack passes the match gate at all. */
  match: boolean;
  /**
   * 0..1 relevance: coverage of ALL query words (stop words included) with
   * a phrase-match bonus. Providers can use this to rank — a boolean match
   * alone says nothing about how well a document fits a multi-word query.
   */
  relevance: number;
}

/**
 * Match + score a haystack against tokenized query terms.
 *
 * Gate (must all hold):
 *   1. every meaningful term matches (word, plural-folded, or substring);
 *   2. gutting guard — when the query had 3+ words but only ONE meaningful
 *      term survived stop-word removal ("how to build" → "build"), at least
 *      one other raw query word must also appear, or the whole phrase must
 *      be a substring. Single-word and two-word queries stay loose.
 *
 * Relevance: fraction of all query words found in the haystack; a full
 * phrase substring match floors relevance at 0.9.
 */
export function matchWithRelevance(haystackFields: (string | undefined)[], query: QueryTerms): TermMatch {
  if (query.terms.length === 0) return { match: true, relevance: 0.5 };

  // Haystack is space-padded, so a phrase substring match needs no padding of its own.
  const haystack = ` ${normalizeText(haystackFields.filter(Boolean).join(' '))} `;
  const phraseHit = query.phrase.length >= 3 && haystack.includes(query.phrase);
  // A phrase hit in the TITLE (first field by convention) is the strongest
  // signal a document can give — it means the page is about the query, not
  // just mentioning it in passing.
  const titleText = haystackFields[0] ? ` ${normalizeText(haystackFields[0])} ` : '';
  const titlePhraseHit = phraseHit && titleText.includes(query.phrase);

  // Gate 1: every meaningful term must match.
  for (const term of query.terms) {
    if (!termMatches(haystack, term)) return { match: false, relevance: 0 };
  }

  // Gate 2: gutting guard for multi-word queries reduced to one keyword.
  if (!query.onlyStopWords && query.terms.length === 1 && query.allTerms.length >= 3 && !phraseHit) {
    const secondary = query.allTerms.filter((t) => t !== query.terms[0]);
    const secondaryHits = secondary.filter((t) => termMatches(haystack, t)).length;
    if (secondaryHits === 0) return { match: false, relevance: 0 };
  }

  // Relevance: coverage across every query word (stop words count again here),
  // phrase match floors at 0.9, title phrase match tops it off.
  const matched = query.allTerms.filter((t) => termMatches(haystack, t)).length;
  const coverage = query.allTerms.length > 0 ? matched / query.allTerms.length : 0;
  const relevance = Math.min(1, (phraseHit ? Math.max(0.9, coverage) : coverage) + (titlePhraseHit ? 0.1 : 0));

  return { match: true, relevance };
}

/**
 * AND-match: every meaningful term must appear in the haystack (with the
 * gutting guard applied). Empty term list matches everything.
 */
export function matchesTerms(haystackFields: (string | undefined)[], query: QueryTerms): boolean {
  return matchWithRelevance(haystackFields, query).match;
}

/** Convenience: tokenize + match in one call. */
export function queryMatches(query: string, haystackFields: (string | undefined)[]): boolean {
  return matchesTerms(haystackFields, tokenizeRaw(query));
}

/** Convenience: tokenize + match + relevance in one call. */
export function queryRelevance(query: string, haystackFields: (string | undefined)[]): TermMatch {
  return matchWithRelevance(haystackFields, tokenizeRaw(query));
}

/**
 * Raw word coverage, 0..1: the fraction of ALL query words (stop words
 * included — "walk in the park" counts four) found in the haystack. A full
 * phrase substring hit scores a perfect 1. NO gate — this is the ranking
 * signal ("4 words match > 3 > 2 > 1"), not a filter. Pair with
 * matchWithRelevance().match when you need the gate.
 */
export function wordCoverage(haystackFields: (string | undefined)[], query: QueryTerms): number {
  if (query.allTerms.length === 0) return 1;
  const haystack = ` ${normalizeText(haystackFields.filter(Boolean).join(' '))} `;
  if (query.phrase.length >= 3 && haystack.includes(query.phrase)) return 1;
  let hits = 0;
  for (const t of query.allTerms) {
    if (termMatches(haystack, t)) hits++;
  }
  return hits / query.allTerms.length;
}

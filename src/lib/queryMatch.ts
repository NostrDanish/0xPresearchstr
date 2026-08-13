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
 *     they're relay-side directives (site:, lang:, after:, …).
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

/**
 * AND-match: every term must appear in the haystack — as itself or in its
 * plural-folded form. Empty term list matches everything.
 */
export function matchesTerms(haystackFields: (string | undefined)[], query: QueryTerms): boolean {
  if (query.terms.length === 0) return true;
  const haystack = ` ${normalizeText(haystackFields.filter(Boolean).join(' '))} `;
  return query.terms.every((term) => {
    const folded = foldPlural(term);
    return (
      haystack.includes(` ${term} `)
      || (folded !== term && haystack.includes(` ${folded} `))
      // Substring fallback for compounds: "websearch" contains "search".
      || haystack.includes(term)
    );
  });
}

/** Convenience: tokenize + match in one call. */
export function queryMatches(query: string, haystackFields: (string | undefined)[]): boolean {
  return matchesTerms(haystackFields, tokenizeRaw(query));
}

/**
 * Result language filter — shared helpers.
 *
 * The user's preferred languages (ISO 639-1, two-letter, lowercase) live in
 * the app config (`languageFilter`, empty = off). The filter is applied at
 * two levels:
 *
 *   1. ENGINE side — SearXNG (`language=en,da`) and Brave (`search_lang`)
 *      receive the filter as request parameters, so their results come back
 *      pre-filtered. DuckDuckGo's HTML endpoint has no multi-language
 *      concept (only region bias), so it stays neutral.
 *   2. CLIENT side — SIP-01 web-index observations carry a bare `l` tag
 *      (spec §6/§12.5): observations with a KNOWN language that isn't in the
 *      filter are dropped; unknown-language pages pass (most indexers don't
 *      tag language yet — hard-dropping them would gut the index).
 *
 * Everything is local and synchronous — no detection heuristics, no network.
 */

/** ISO 639-1 two-letter shape — same as the SIP-01 `l` tag rule. */
export const LANG_CODE_RE = /^[a-z]{2}$/;

/** Normalize a user-entered language code; returns null when invalid. */
export function normalizeLangCode(input: string): string | null {
  const code = input.trim().toLowerCase();
  return LANG_CODE_RE.test(code) ? code : null;
}

/** Normalize + dedupe a list of codes. */
export function normalizeLangList(codes: string[]): string[] {
  const out: string[] = [];
  for (const c of codes) {
    const code = normalizeLangCode(c);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * Does a result with this (possibly unknown) language pass the filter?
 * Empty filter passes everything; unknown language passes (see module doc).
 */
export function passesLanguageFilter(language: string | undefined, filter: string[]): boolean {
  if (filter.length === 0) return true;
  if (!language) return true;
  return filter.includes(language);
}

/**
 * The SearXNG `language` request parameter for the filter. One code goes out
 * bare; several go comma-separated (supported by current SearXNG; older
 * instances that reject it simply lose the failover race). Empty filter →
 * undefined (no parameter, SearXNG default).
 */
export function searxngLanguageParam(filter: string[]): string | undefined {
  if (filter.length === 0) return undefined;
  return filter.join(',');
}

/** The Brave `search_lang` request parameter — Brave takes ONE language. */
export function braveLanguageParam(filter: string[]): string | undefined {
  return filter[0];
}

/**
 * The browser's primary language as an ISO 639-1 code — "da-DK" → "da" —
 * with English as the fallback when the browser language can't be read or
 * isn't a two-letter code. Used as the DEFAULT filter: the user's stored
 * choice (including a deliberately cleared, empty filter) always wins over
 * this default.
 */
export function getBrowserLanguage(): string {
  try {
    const raw = typeof navigator !== 'undefined'
      ? (navigator.languages?.[0] ?? navigator.language ?? '')
      : '';
    // BCP-47 → ISO 639-1: keep the primary subtag ("en-US" → "en").
    const code = normalizeLangCode(raw.split('-')[0] ?? '');
    return code ?? 'en';
  } catch {
    return 'en';
  }
}

/** Common languages offered as one-click chips in Settings. */
export const COMMON_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'da', label: 'Dansk' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'no', label: 'Norsk' },
  { code: 'sv', label: 'Svenska' },
  { code: 'fi', label: 'Suomi' },
  { code: 'pl', label: 'Polski' },
  { code: 'pt', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'ru', label: 'Русский' },
];

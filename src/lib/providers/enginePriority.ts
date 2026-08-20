/**
 * Web engine priority — which clearnet engine leads the organic band.
 *
 * The rule (user-configurable engines aside):
 *
 *   Brave API key set  →  Brave leads (80), DuckDuckGo second (79)
 *   No Brave key       →  DuckDuckGo leads (80)  (Brave is dormant anyway)
 *   Always             →  SearXNG is the fallback band (78): it still runs
 *                         in parallel and fills in whenever the lead engine
 *                         is bot-gated or slow, but its results slot below.
 *
 * The web index (SIP-01) ranks WITH this organic band on purpose — see the
 * web-index provider. Scores are per-result bases; each provider decays by
 * position (`base - index * 0.5`) and the merge pass reweights by query-word
 * coverage.
 */
import { getBraveApiKey } from './brave';

export interface WebEngineBases {
  brave: number;
  duckduckgo: number;
  searxng: number;
}

/** Base scores for the three clearnet web engines, given the current key state. */
export function getWebEngineBases(): WebEngineBases {
  const braveActive = getBraveApiKey().length > 0;
  return braveActive
    ? { brave: 80, duckduckgo: 79, searxng: 78 }
    : { brave: 79, duckduckgo: 80, searxng: 78 };
}

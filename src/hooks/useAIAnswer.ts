/**
 * useAIAnswer — the AI Answer Layer over the search federation.
 *
 * Flow: search results stream in → when enough evidence exists, the top
 * results become a numbered evidence pack → the configured AI provider
 * synthesizes an answer with [n] citations back to that evidence.
 *
 * Boundaries (deliberate, per the project model):
 *   - Runs only for 'text' query class — NIP-19/05/URL/math queries keep
 *     their deterministic paths and never leave for an AI provider.
 *   - Nostr-tier results are excluded from evidence unless the user opted
 *     in (Settings → AI), since Nostr content is tied to identities.
 *   - AI answers are ephemeral: displayed, never indexed into SIP-01.
 */
import { useQuery } from '@tanstack/react-query';

import type { SearchResult } from '@/lib/providers/types';
import { classifyQuery } from '@/lib/queryClassify';
import { getAIProvider } from '@/lib/ai/registry';
import { getAIConfig, resolveAIConfig } from '@/lib/aiConfig';
import type { AIEvidenceItem, AIAnswer } from '@/lib/ai/types';

/** Max evidence items handed to the model. */
const MAX_EVIDENCE = 8;
/** Snippet cap per evidence item (tokens cost money). */
const MAX_SNIPPET = 400;

/** Pick + number the evidence pack from search results. */
function buildEvidence(results: SearchResult[], includeNostr: boolean): AIEvidenceItem[] {
  const usable = results.filter((r) => {
    if (!r.url || !/^https?:\/\//i.test(r.url)) return false; // links the user can open
    if (!r.title?.trim()) return false;
    if (!includeNostr && (r.source === 'nostr' || r.provider === 'keyword-stake' || r.provider === 'community')) return false;
    return true;
  });

  // Domain diversity: at most 2 items per domain while the pack can still be
  // filled — a single site shouldn't dominate the answer. The second pass
  // lifts the cap when there simply aren't enough distinct domains.
  const perDomain = new Map<string, number>();
  const picked = new Set<SearchResult>();
  const domainOf = (r: SearchResult): string => {
    if (r.domain) return r.domain;
    try { return new URL(r.url).hostname; } catch { return r.url; }
  };
  for (const cap of [2, Number.POSITIVE_INFINITY]) {
    for (const r of usable) {
      if (picked.size >= MAX_EVIDENCE) break;
      if (picked.has(r)) continue;
      const domain = domainOf(r);
      const count = perDomain.get(domain) ?? 0;
      if (count >= cap) continue;
      perDomain.set(domain, count + 1);
      picked.add(r);
    }
    if (picked.size >= MAX_EVIDENCE) break;
  }

  return [...picked].map((r, i) => ({
    n: i + 1,
    title: r.title.trim().slice(0, 200),
    url: r.url,
    snippet: (r.snippet ?? '').trim().slice(0, MAX_SNIPPET),
  }));
}

export interface UseAIAnswerResult {
  answer?: AIAnswer;
  /** The evidence pack the answer was synthesized from (for citation links). */
  evidence: AIEvidenceItem[];
  isLoading: boolean;
  error?: string;
  /** Whether the AI layer is active for this query right now. */
  active: boolean;
}

export function useAIAnswer(query: string, results: SearchResult[], enabled: boolean): UseAIAnswerResult {
  const aiConfig = getAIConfig();
  // Own key wins; otherwise the built-in free tier (locked PPQ + Qwen) applies.
  const resolved = resolveAIConfig(aiConfig);
  const queryClass = classifyQuery(query);

  // AI runs when: enabled by user, a text-class query, and we have evidence.
  const evidence = buildEvidence(results, aiConfig.includeNostr);
  const shouldRun =
    enabled &&
    aiConfig.enabled &&
    queryClass === 'text' &&
    evidence.length >= 2 &&
    (resolved.apiKey.length > 0 || getAIProvider(resolved.providerId)?.requiresKey === false);

  const { data, isLoading, error } = useQuery<AIAnswer>({
    queryKey: ['ai-answer', query, resolved.providerId, resolved.model, resolved.community, evidence.map((e) => e.url).join('|')],
    queryFn: async ({ signal }) => {
      const provider = getAIProvider(resolved.providerId);
      if (!provider) throw new Error(`Unknown AI provider: ${resolved.providerId}`);

      return provider.answer(resolved.endpoint || provider.defaultEndpoint, resolved.apiKey, {
        query,
        evidence,
        model: resolved.model || 'auto',
        signal,
      });
    },
    enabled: shouldRun,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  return {
    answer: data,
    evidence,
    isLoading: shouldRun && isLoading,
    error: error instanceof Error ? error.message : undefined,
    active: shouldRun,
  };
}

export { buildEvidence };

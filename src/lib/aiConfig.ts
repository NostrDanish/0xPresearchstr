/**
 * AI config — localStorage-backed settings for the AI Answer Layer.
 *
 * AI is OFF by default and fully opt-in. The API key never leaves the
 * browser except inside requests to the chosen provider (via the CORS
 * proxy — disclosed in Settings → AI).
 *
 * Community tier: a built-in, rate-limited API key lets every user try AI
 * answers with zero setup — provider (PPQ) and model (Qwen 2.5 7B) are FIXED
 * on this tier. The moment the user pastes their own API key, the community
 * key is paused and their provider/endpoint/model settings (stored on their
 * device only) take over. Removing their key drops back to the free tier.
 */

import { getAIProvider } from '@/lib/ai/registry';

const LS_KEY = 'presearchstr:ai-config';

/** Built-in free tier — shared, rate-limited PPQ key. Provider + model are locked. */
export const COMMUNITY_AI_PROVIDER_ID = 'ppq';
export const COMMUNITY_AI_ENDPOINT = 'https://api.ppq.ai/v1';
export const COMMUNITY_AI_KEY = 'sk-VPVVNlf79DvGjUfjjrHeFT';
export const COMMUNITY_AI_MODEL = 'qwen/qwen-2.5-7b-instruct';

export interface AIConfig {
  /** Master switch — AI answers only run when enabled. */
  enabled: boolean;
  /** Provider id from the registry ('ppq', 'openrouter', 'ollama', 'custom', …). */
  providerId: string;
  /** API base URL (editable for custom/self-hosted). */
  endpoint: string;
  /** API key (sk-… for PPQ). Empty = community tier (or keyless provider). */
  apiKey: string;
  /** Model id ('auto' = provider's router default). Ignored on the community tier. */
  model: string;
  /** Privacy: also include Nostr-tier results in the evidence sent to the AI. */
  includeNostr: boolean;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: false,
  providerId: 'ppq',
  endpoint: 'https://api.ppq.ai/v1',
  apiKey: '',
  model: 'auto',
  includeNostr: false,
};

/** True when the user has pasted their own API key (pauses the community tier). */
export function hasOwnAIKey(cfg: AIConfig): boolean {
  return cfg.apiKey.trim().length > 0;
}

/** The effective runtime config after applying the community-tier fallback. */
export interface ResolvedAIConfig {
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
  /** True when running on the built-in free key (provider + model locked). */
  community: boolean;
}

/**
 * Resolve what a search actually runs with:
 *  - user's own key present  → their provider/endpoint/model (their device, their choice);
 *  - keyless provider (e.g. Ollama), no key → their config as-is;
 *  - otherwise               → the built-in community tier (locked PPQ + Qwen 2.5 7B).
 */
export function resolveAIConfig(cfg: AIConfig): ResolvedAIConfig {
  if (hasOwnAIKey(cfg)) {
    return {
      providerId: cfg.providerId,
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey.trim(),
      model: cfg.model,
      community: false,
    };
  }

  const provider = getAIProvider(cfg.providerId);
  if (provider && provider.requiresKey === false) {
    return {
      providerId: cfg.providerId,
      endpoint: cfg.endpoint,
      apiKey: '',
      model: cfg.model,
      community: false,
    };
  }

  return {
    providerId: COMMUNITY_AI_PROVIDER_ID,
    endpoint: COMMUNITY_AI_ENDPOINT,
    apiKey: COMMUNITY_AI_KEY,
    model: COMMUNITY_AI_MODEL,
    community: true,
  };
}

export function getAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_AI_CONFIG };
    const parsed = JSON.parse(raw) as Partial<AIConfig>;
    return { ...DEFAULT_AI_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export function setAIConfig(patch: Partial<AIConfig>): AIConfig {
  const next = { ...getAIConfig(), ...patch };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — config just won't persist.
  }
  return next;
}

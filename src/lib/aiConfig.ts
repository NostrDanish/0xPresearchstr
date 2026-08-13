/**
 * AI config — localStorage-backed settings for the AI Answer Layer.
 *
 * AI is OFF by default and fully opt-in. The API key never leaves the
 * browser except inside requests to the chosen provider (via the CORS
 * proxy — disclosed in Settings → AI).
 */

const LS_KEY = 'presearchstr:ai-config';

export interface AIConfig {
  /** Master switch — AI answers only run when enabled. */
  enabled: boolean;
  /** Provider id from the registry ('ppq', 'openrouter', 'ollama', 'custom', …). */
  providerId: string;
  /** API base URL (editable for custom/self-hosted). */
  endpoint: string;
  /** API key (sk-… for PPQ). Empty for keyless providers. */
  apiKey: string;
  /** Model id ('auto' = provider's router default). */
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

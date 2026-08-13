/**
 * AI provider types — the "AI Answer Layer".
 *
 * AI sits AFTER the search federation: providers gather evidence, the AI
 * synthesizes an answer with citations back to that evidence. AI answers are
 * ephemeral — never indexed, never fed back into SIP-01.
 *
 * Any OpenAI-compatible API works out of the box (PPQ, OpenRouter, Ollama,
 * self-hosted). The provider abstraction exists so nothing is hardwired to
 * one vendor.
 */

/** A model exposed by an AI provider. */
export interface AIModel {
  id: string;
  name?: string;
  contextLength?: number;
}

/** One piece of search evidence handed to the model. */
export interface AIEvidenceItem {
  /** Citation number (1-based) shown as [n] in the answer. */
  n: number;
  title: string;
  url: string;
  snippet: string;
}

export interface AIAnswerRequest {
  query: string;
  evidence: AIEvidenceItem[];
  model: string;
  signal?: AbortSignal;
}

export interface AIAnswer {
  text: string;
  model: string;
  provider: string;
}

/** An AI backend that can answer from evidence. */
export interface AIProvider {
  id: string;
  name: string;
  /** Default API base URL (no trailing slash). */
  defaultEndpoint: string;
  /** Whether an API key is required (Ollama/self-hosted may not need one). */
  requiresKey: boolean;
  /** Fetch the available model list (best-effort). */
  models(endpoint: string, apiKey: string, signal?: AbortSignal): Promise<AIModel[]>;
  /** Ask for an evidence-cited answer. */
  answer(endpoint: string, apiKey: string, req: AIAnswerRequest): Promise<AIAnswer>;
}

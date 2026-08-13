/**
 * OpenAI-compatible AI provider — works for PPQ, OpenRouter, Ollama,
 * self-hosted vLLM/llama.cpp servers, and anything speaking the
 * /chat/completions + /models schema.
 *
 * Browser reality: most of these endpoints don't send CORS headers, so
 * requests route through the CORS proxy (same pattern as the search
 * providers). The proxy sees the request including the API key — this is
 * disclosed in Settings → AI.
 */
import { ANSWER_SYSTEM_PROMPT, buildEvidencePrompt } from './prompts';
import type { AIProvider, AIModel, AIAnswerRequest, AIAnswer } from './types';

const CORS_PROXY = 'https://proxy.shakespeare.diy/?url=';

interface OpenAIModelsResponse {
  data?: { id: string; name?: string; context_length?: number }[];
}

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[];
}

/** Fetch through the CORS proxy (OpenAI-compatible APIs rarely send CORS). */
async function proxiedFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(`${CORS_PROXY}${encodeURIComponent(url)}`, init);
}

export function createOpenAICompatibleProvider(partial: {
  id: string;
  name: string;
  defaultEndpoint: string;
  requiresKey?: boolean;
}): AIProvider {
  const { id, name, defaultEndpoint, requiresKey = true } = partial;

  return {
    id,
    name,
    defaultEndpoint,
    requiresKey,

    async models(endpoint, apiKey, signal): Promise<AIModel[]> {
      const base = endpoint.replace(/\/$/, '');
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await proxiedFetch(`${base}/models`, {
        headers,
        signal: signal ?? AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as OpenAIModelsResponse;
      return (data.data ?? [])
        .map((m): AIModel => ({ id: m.id, name: m.name, contextLength: m.context_length }))
        .filter((m) => m.id);
    },

    async answer(endpoint, apiKey, req: AIAnswerRequest): Promise<AIAnswer> {
      const base = endpoint.replace(/\/$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await proxiedFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: req.model,
          messages: [
            { role: 'system', content: ANSWER_SYSTEM_PROMPT },
            { role: 'user', content: buildEvidencePrompt(req.query, req.evidence) },
          ],
          temperature: 0.3,
          max_tokens: 1200,
        }),
        signal: req.signal ?? AbortSignal.timeout(45000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${name} returned HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
      }

      const data = (await res.json()) as OpenAIChatResponse;
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('Empty answer from the model');

      return { text, model: req.model, provider: name };
    },
  };
}

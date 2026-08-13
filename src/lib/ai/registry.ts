/**
 * AI provider registry — the catalog of known backends.
 *
 * PPQ is the first-class default (pay-per-prompt, Lightning-native,
 * hundreds of models, OpenAI-compatible). Everything else is the same
 * OpenAI-compatible shape with a different endpoint — the user picks.
 *
 * Support the project: https://ppq.ai/invite/949880ca
 */
import { createOpenAICompatibleProvider } from './openai-compatible';
import type { AIProvider } from './types';

/** PPQ invite link — supports the project. Use wherever PPQ is linked. */
export const PPQ_INVITE_URL = 'https://ppq.ai/invite/949880ca';

export const AI_PROVIDERS: AIProvider[] = [
  createOpenAICompatibleProvider({
    id: 'ppq',
    name: 'PPQ.ai',
    defaultEndpoint: 'https://api.ppq.ai/v1',
  }),
  createOpenAICompatibleProvider({
    id: 'openrouter',
    name: 'OpenRouter',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
  }),
  createOpenAICompatibleProvider({
    id: 'openai',
    name: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1',
  }),
  createOpenAICompatibleProvider({
    id: 'ollama',
    name: 'Ollama (local)',
    defaultEndpoint: 'http://localhost:11434/v1',
    requiresKey: false,
  }),
  createOpenAICompatibleProvider({
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    defaultEndpoint: '',
  }),
];

export function getAIProvider(id: string): AIProvider | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

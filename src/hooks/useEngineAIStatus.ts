/**
 * Engine-AI status — does this deployment offer engine-provided AI?
 *
 * Reads GET /api/ai/status (served by worker.ts). The response is public
 * by construction (provider label, model, masked key tail) and NEVER
 * contains the engine API key. On static-only deployments the endpoint
 * doesn't exist at all — the fetch fails and the hook reports
 * "not configured", which the AI layer treats as unavailable.
 */
import { useQuery } from '@tanstack/react-query';

import { ENGINE_AI_BASE, type EngineAIStatus } from '@/lib/aiConfig';

async function fetchEngineStatus(signal: AbortSignal): Promise<EngineAIStatus> {
  const res = await fetch(`${ENGINE_AI_BASE}/status`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return { configured: false, enabled: false };
  const data = (await res.json()) as Partial<EngineAIStatus>;
  return {
    configured: data.configured === true,
    enabled: data.enabled === true,
    providerName: typeof data.providerName === 'string' ? data.providerName : undefined,
    endpoint: typeof data.endpoint === 'string' ? data.endpoint : undefined,
    model: typeof data.model === 'string' ? data.model : undefined,
    keyTail: typeof data.keyTail === 'string' ? data.keyTail.slice(0, 4) : undefined,
  };
}

export function useEngineAIStatus(): { status: EngineAIStatus | null; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['engine-ai-status'],
    queryFn: ({ signal }) => fetchEngineStatus(signal),
    staleTime: 5 * 60_000,
    retry: 0,
  });
  return { status: data ?? null, isLoading };
}

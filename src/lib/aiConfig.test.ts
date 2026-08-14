/**
 * AI credential precedence tests — the spec's exact chain:
 *
 *   user-provided key → engine-provided proxy → AI unavailable
 *
 * plus the secrecy invariant: the engine tier never puts any key in the
 * client-side resolved config (spec #5/#6).
 */
import { describe, it, expect } from 'vitest';

import {
  resolveAIConfig,
  engineAIAvailable,
  hasOwnAIKey,
  DEFAULT_AI_CONFIG,
  ENGINE_AI_BASE,
  type EngineAIStatus,
} from './aiConfig';

const ENGINE_ON: EngineAIStatus = {
  configured: true,
  enabled: true,
  providerName: 'PPQ.ai',
  endpoint: 'https://api.ppq.ai/v1',
  model: 'qwen/qwen-2.5-7b-instruct',
  keyTail: 'cdef',
};

const ENGINE_OFF: EngineAIStatus = { configured: false, enabled: false };

describe('resolveAIConfig precedence', () => {
  it('1. no engine key + no user key → AI unavailable', () => {
    const r = resolveAIConfig({ ...DEFAULT_AI_CONFIG, apiKey: '' }, ENGINE_OFF);
    expect(r.tier).toBe('unavailable');
    expect(r.apiKey).toBe('');
  });

  it('1b. status endpoint missing entirely (static deploy) → unavailable', () => {
    const r = resolveAIConfig({ ...DEFAULT_AI_CONFIG, apiKey: '' }, null);
    expect(r.tier).toBe('unavailable');
  });

  it('2. engine key only → engine tier via the same-origin proxy', () => {
    const r = resolveAIConfig({ ...DEFAULT_AI_CONFIG, apiKey: '' }, ENGINE_ON);
    expect(r.tier).toBe('engine');
    expect(r.endpoint).toBe(ENGINE_AI_BASE); // same-origin /api/ai
    expect(r.model).toBe('qwen/qwen-2.5-7b-instruct');
    expect(r.engine?.providerName).toBe('PPQ.ai');
  });

  it('3. user key only → user tier with their provider/endpoint/model', () => {
    const r = resolveAIConfig(
      { ...DEFAULT_AI_CONFIG, providerId: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', apiKey: 'sk-user-own-key', model: 'auto' },
      ENGINE_OFF,
    );
    expect(r.tier).toBe('user');
    expect(r.apiKey).toBe('sk-user-own-key');
    expect(r.providerId).toBe('openrouter');
  });

  it('4. both configured → user key takes precedence (spec precedence)', () => {
    const r = resolveAIConfig({ ...DEFAULT_AI_CONFIG, apiKey: 'sk-user-own-key' }, ENGINE_ON);
    expect(r.tier).toBe('user');
    expect(r.apiKey).toBe('sk-user-own-key');
  });

  it('engine disabled by operator → unavailable even when configured', () => {
    const r = resolveAIConfig(
      { ...DEFAULT_AI_CONFIG, apiKey: '' },
      { ...ENGINE_ON, enabled: false },
    );
    expect(r.tier).toBe('unavailable');
  });

  it('keyless provider selection (Ollama) beats the engine tier', () => {
    const r = resolveAIConfig(
      { ...DEFAULT_AI_CONFIG, providerId: 'ollama', endpoint: 'http://localhost:11434/v1', apiKey: '' },
      ENGINE_ON,
    );
    expect(r.tier).toBe('keyless');
    expect(r.endpoint).toBe('http://localhost:11434/v1');
  });
});

describe('secrecy invariants', () => {
  it('5/6. the engine tier never puts any key into client config', () => {
    const r = resolveAIConfig({ ...DEFAULT_AI_CONFIG, apiKey: '' }, ENGINE_ON);
    expect(r.apiKey).toBe('');
    // The masked tail is display metadata, not credential material.
    expect(JSON.stringify(r)).not.toContain('sk-');
  });

  it('hasOwnAIKey: whitespace is not a key', () => {
    expect(hasOwnAIKey({ ...DEFAULT_AI_CONFIG, apiKey: '   ' })).toBe(false);
    expect(hasOwnAIKey({ ...DEFAULT_AI_CONFIG, apiKey: 'sk-x' })).toBe(true);
  });

  it('engineAIAvailable requires configured AND enabled', () => {
    expect(engineAIAvailable(ENGINE_ON)).toBe(true);
    expect(engineAIAvailable(ENGINE_OFF)).toBe(false);
    expect(engineAIAvailable({ configured: true, enabled: false })).toBe(false);
    expect(engineAIAvailable(null)).toBe(false);
    expect(engineAIAvailable(undefined)).toBe(false);
  });
});

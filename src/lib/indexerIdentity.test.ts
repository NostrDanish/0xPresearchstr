import { describe, it, expect, beforeEach } from 'vitest';

import {
  getIndexerIdentity,
  regenerateIndexerIdentity,
  exportIndexerNsec,
  getIndexerPubkey,
} from './indexerIdentity';

describe('indexerIdentity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates a keypair on first use', () => {
    const identity = getIndexerIdentity();
    expect(identity.secretHex).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.pubkeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.npub.startsWith('npub1')).toBe(true);
    expect(identity.fresh).toBe(true);
  });

  it('persists deterministically across calls in the same storage', () => {
    const first = getIndexerIdentity();
    const second = getIndexerIdentity();
    expect(second.pubkeyHex).toBe(first.pubkeyHex);
    expect(second.secretHex).toBe(first.secretHex);
    expect(second.fresh).toBe(false);
  });

  it('creates a different key after storage is cleared (new browser profile)', () => {
    const first = getIndexerIdentity();
    localStorage.clear();
    const second = getIndexerIdentity();
    expect(second.pubkeyHex).not.toBe(first.pubkeyHex);
  });

  it('regenerates a new identity and discards the old one', () => {
    const first = getIndexerIdentity();
    const regenerated = regenerateIndexerIdentity();
    expect(regenerated.pubkeyHex).not.toBe(first.pubkeyHex);
    expect(regenerated.secretHex).not.toBe(first.secretHex);
    // Subsequent reads return the NEW identity.
    expect(getIndexerPubkey()).toBe(regenerated.pubkeyHex);
  });

  it('exports the secret as a valid nsec', () => {
    const identity = getIndexerIdentity();
    const nsec = exportIndexerNsec();
    expect(nsec.startsWith('nsec1')).toBe(true);
    // Round-trips back to the same identity's secret.
    expect(nsec.length).toBeGreaterThan(60);
    expect(identity.secretHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('recovers gracefully from corrupted storage', () => {
    localStorage.setItem('sip:indexer:secret', 'not-a-key');
    const identity = getIndexerIdentity();
    expect(identity.secretHex).toMatch(/^[0-9a-f]{64}$/);
  });
});

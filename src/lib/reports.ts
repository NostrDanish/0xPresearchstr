/**
 * Abuse reports (NIP-56, kind 1984) — shared builders.
 *
 * Reports are public, attributable events: anyone reading the
 * `0xsearchstr.abuse` label namespace (our dashboard, relays, other
 * clients) sees the same inbox. Published from the Policy page and from
 * the flag action on result cards.
 */
import { nip19 } from 'nostr-tools';

import { REPORT_KIND, REPORT_NS } from '@/lib/moderation';

/** NIP-56 report types. */
export const REPORT_TYPES = [
  { value: 'illegal', label: 'Illegal content (CSAM, trafficking, weapons, drug markets)' },
  { value: 'malware', label: 'Malware / phishing' },
  { value: 'spam', label: 'Spam' },
  { value: 'nudity', label: 'Nudity / explicit content' },
  { value: 'profanity', label: 'Hateful or abusive content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Other policy violation' },
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]['value'];

/**
 * Build the target tags for a kind 1984 report from a free-form target
 * string. Supports URLs (r tag), note1/nevent1 (e tag), npub1/nprofile1
 * (p tag), and naddr1 (a tag). Returns null when the target can't be parsed.
 */
export function buildReportTags(target: string, type: string): string[][] | null {
  const input = target.trim();

  // NIP-19 identifiers.
  if (/^(note1|nevent1|npub1|nprofile1|naddr1)/.test(input)) {
    try {
      const decoded = nip19.decode(input);
      switch (decoded.type) {
        case 'note':
          return [['e', decoded.data, type]];
        case 'nevent': {
          const tags: string[][] = [['e', decoded.data.id, type]];
          if (decoded.data.author) tags.push(['p', decoded.data.author]);
          return tags;
        }
        case 'npub':
          return [['p', decoded.data, type]];
        case 'nprofile':
          return [['p', decoded.data.pubkey, type]];
        case 'naddr': {
          const { kind, pubkey, identifier } = decoded.data;
          return [['a', `${kind}:${pubkey}:${identifier}`, type]];
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  // Bare 64-char hex = event id.
  if (/^[0-9a-f]{64}$/i.test(input)) {
    return [['e', input.toLowerCase(), type]];
  }

  // Plain URLs (reported web content).
  if (/^https?:\/\//i.test(input)) {
    return [['r', input, type]];
  }

  return null;
}

/** Build a full kind 1984 report event template. */
export function buildReportEvent(target: string, type: string, details: string): {
  kind: number;
  content: string;
  tags: string[][];
} | null {
  const targetTags = buildReportTags(target, type);
  if (!targetTags) return null;

  return {
    kind: REPORT_KIND,
    content: details.trim(),
    tags: [
      ...targetTags,
      // NIP-32 self-labels so moderators can filter reports by namespace.
      ['L', REPORT_NS],
      ['l', type, REPORT_NS],
      ['alt', `Abuse report (${type})`],
    ],
  };
}

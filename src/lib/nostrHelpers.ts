import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

/** Get the display name for a kind number. */
export function kindLabel(kind: number): string {
  switch (kind) {
    case 0: return 'Profile';
    case 1: return 'Note';
    case 6: return 'Repost';
    case 7: return 'Reaction';
    case 1063: return 'File';
    case 1337: return 'Code Snippet';
    case 1617: return 'Patch';
    case 1618: return 'Pull Request';
    case 1621: return 'Issue';
    case 2003: return 'Torrent';
    case 30023: return 'Article';
    case 30024: return 'Draft Article';
    case 30078: return 'App Data';
    case 30617: return 'Repository';
    case 30618: return 'Repo State';
    case 30818: return 'Wiki Article';
    case 39697: return 'Web Index';
    default: return `Kind ${kind}`;
  }
}

/** Get the d-tag from an addressable event. */
export function getDTag(event: NostrEvent): string | undefined {
  return event.tags.find(([n]) => n === 'd')?.[1];
}

/** Get the display title: `title` tag (long-form/wiki), else `name` (NIP-34
 *  repos), else `subject` (NIP-34 issues/PRs). */
export function getTitle(event: NostrEvent): string | undefined {
  return event.tags.find(([n]) => n === 'title')?.[1]
    ?? event.tags.find(([n]) => n === 'name')?.[1]
    ?? event.tags.find(([n]) => n === 'subject')?.[1];
}

/** Get the summary/description tag (`summary` for articles/wiki, `description` for repos). */
export function getSummary(event: NostrEvent): string | undefined {
  return event.tags.find(([n]) => n === 'summary')?.[1]
    ?? event.tags.find(([n]) => n === 'description')?.[1];
}

/** Get the image tag. */
export function getImage(event: NostrEvent): string | undefined {
  return event.tags.find(([n]) => n === 'image')?.[1];
}

/** Generate a NIP-19 identifier for linking to an event. */
export function eventToNip19(event: NostrEvent): string {
  if (event.kind >= 30000 && event.kind < 40000) {
    const d = getDTag(event);
    if (d !== undefined) {
      return nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: d,
      });
    }
  }
  return nip19.neventEncode({
    id: event.id,
    author: event.pubkey,
  });
}

/** Format a unix timestamp as a relative time string. */
export function timeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;

  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Truncate text to a maximum length, breaking at word boundaries. */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.7 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

/** Npub from hex pubkey (short form). */
export function npubShort(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return npub.slice(0, 12) + '...' + npub.slice(-4);
}

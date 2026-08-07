/**
 * 0xPresearchstr Nostr Crawler
 *
 * Subscribes to NIP-01 REQ on a curated, health-checked relay list.
 * Indexes kinds 0 (profiles), 1 (notes), 30023 (long-form), 1063 (files).
 * Deduplicates by event ID, resolves nostr: references, and pushes
 * normalized documents to Meilisearch.
 */

import { NRelay1 } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { createLogger } from '../../shared/src/logger.js';
import { indexDocuments, getSearchIndex } from '../../shared/src/meili.js';
import { checkContentPolicy } from '../../shared/src/content-policy.js';
import type { SearchDocument, NostrEvent, CrawlerStatus } from '../../shared/src/types.js';

const log = createLogger('nostr-crawler');

// ─── Configuration ───
const INDEXED_KINDS = [0, 1, 1063, 30023];
const BATCH_SIZE = parseInt(process.env.NOSTR_BATCH_SIZE || '50', 10);
const FLUSH_INTERVAL_MS = parseInt(process.env.NOSTR_FLUSH_INTERVAL || '5000', 10);

/**
 * Default relay list. Override with NOSTR_RELAYS env var (comma-separated).
 * These relays are chosen for their stability, NIP-50 support, and coverage.
 */
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.ditto.pub',
  'wss://nostr.wine',
  'wss://relay.snort.social',
];

function getRelayUrls(): string[] {
  const envRelays = process.env.NOSTR_RELAYS;
  if (envRelays) {
    return envRelays.split(',').map(r => r.trim()).filter(Boolean);
  }
  return DEFAULT_RELAYS;
}

// ─── Event deduplication ───
const seenEvents = new Set<string>();
const MAX_SEEN_SIZE = 500_000;

function dedupe(eventId: string): boolean {
  if (seenEvents.has(eventId)) return false;
  seenEvents.add(eventId);
  // Evict oldest entries when set gets too large.
  if (seenEvents.size > MAX_SEEN_SIZE) {
    const iter = seenEvents.values();
    for (let i = 0; i < MAX_SEEN_SIZE / 4; i++) {
      const val = iter.next().value;
      if (val) seenEvents.delete(val);
    }
  }
  return true;
}

// ─── Batch buffer ───
let batch: SearchDocument[] = [];
const status: CrawlerStatus = {
  name: 'nostr-crawler',
  running: false,
  documentsIndexed: 0,
  documentsBlocked: 0,
  lastActivity: 0,
  errors: 0,
};

async function flushBatch(): Promise<void> {
  if (batch.length === 0) return;
  const toFlush = [...batch];
  batch = [];

  try {
    await indexDocuments(toFlush);
    status.documentsIndexed += toFlush.length;
    status.lastActivity = Date.now();
    log.info(`Indexed ${toFlush.length} Nostr events (total: ${status.documentsIndexed})`);
  } catch (err) {
    status.errors++;
    log.error({ err }, `Failed to index batch of ${toFlush.length} events`);
    // Re-add to batch for retry.
    batch.push(...toFlush);
  }
}

// ─── nostr: reference resolver ───
function resolveNostrReferences(content: string): string {
  return content.replace(/nostr:(npub1|note1|nevent1|nprofile1|naddr1)[a-z0-9]+/g, (match) => {
    try {
      const bech32 = match.replace('nostr:', '');
      const decoded = nip19.decode(bech32);
      switch (decoded.type) {
        case 'npub':
          return `[nostr:${bech32.slice(0, 12)}...]`;
        case 'note':
          return `[nostr:${bech32.slice(0, 12)}...]`;
        case 'nevent':
          return `[nostr:${bech32.slice(0, 12)}...]`;
        case 'nprofile':
          return `[nostr:${bech32.slice(0, 12)}...]`;
        case 'naddr':
          return `[nostr:${bech32.slice(0, 12)}...]`;
        default:
          return match;
      }
    } catch {
      return match;
    }
  });
}

/** Convert a Nostr event to a search document. */
function eventToDocument(event: NostrEvent): SearchDocument {
  const tags = event.tags.filter(([n]) => n === 't').map(([, v]) => v);
  const title = event.tags.find(([n]) => n === 'title')?.[1];
  const summary = event.tags.find(([n]) => n === 'summary')?.[1];
  const dTag = event.tags.find(([n]) => n === 'd')?.[1];

  // Generate NIP-19 identifier.
  let nip19Id: string;
  if (event.kind >= 30000 && event.kind < 40000 && dTag !== undefined) {
    nip19Id = nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: dTag,
    });
  } else {
    nip19Id = nip19.neventEncode({
      id: event.id,
      author: event.pubkey,
    });
  }

  // Resolve nostr: references in content for better search.
  const resolvedContent = resolveNostrReferences(event.content);

  // For profiles (kind 0), extract metadata from content JSON.
  let authorName: string | undefined;
  let profileContent = resolvedContent;
  if (event.kind === 0) {
    try {
      const meta = JSON.parse(event.content) as Record<string, unknown>;
      authorName = (meta.display_name as string) || (meta.name as string) || undefined;
      // For profiles, use name + about as searchable content.
      const about = (meta.about as string) || '';
      const nip05 = (meta.nip05 as string) || '';
      profileContent = [authorName, about, nip05].filter(Boolean).join(' ');
    } catch {
      // Not valid JSON, use raw content.
    }
  }

  return {
    id: event.id,
    source: 'nostr',
    content: event.kind === 0 ? profileContent : resolvedContent,
    title: title || (event.kind === 0 ? authorName : undefined),
    summary,
    timestamp: event.created_at,
    date: new Date(event.created_at * 1000).toISOString(),
    kind: event.kind,
    pubkey: event.pubkey,
    author_name: authorName,
    nip19: nip19Id,
    tags,
    raw_event: JSON.stringify(event),
  };
}

/** Process an incoming event: dedupe, check policy, buffer for indexing. */
function processEvent(event: NostrEvent): void {
  // Deduplicate.
  if (!dedupe(event.id)) return;

  // Content policy check.
  const verdict = checkContentPolicy(event.content);
  if (!verdict.allowed) {
    status.documentsBlocked++;
    log.debug({ eventId: event.id, category: verdict.category }, 'Event blocked by content policy');
    return;
  }

  // Convert and buffer.
  const doc = eventToDocument(event);
  batch.push(doc);

  // Auto-flush when batch is full.
  if (batch.length >= BATCH_SIZE) {
    void flushBatch();
  }
}

/** Connect to a single relay and subscribe to indexed kinds. */
async function subscribeToRelay(url: string): Promise<void> {
  log.info({ relay: url }, 'Connecting to relay');

  const relay = new NRelay1(url);

  try {
    // Subscribe to recent events for each indexed kind.
    const filters = INDEXED_KINDS.map(kind => ({
      kinds: [kind],
      limit: 500,
    }));

    for await (const msg of relay.req(filters)) {
      if (msg[0] === 'EVENT') {
        const event = msg[2] as unknown as NostrEvent;
        processEvent(event);
      } else if (msg[0] === 'EOSE') {
        log.info({ relay: url }, 'Received EOSE, now streaming live events');
      }
    }
  } catch (err) {
    status.errors++;
    log.error({ err, relay: url }, 'Relay connection error');
    // Reconnect after delay.
    setTimeout(() => void subscribeToRelay(url), 10_000);
  }
}

/** Health check: verify Meilisearch is reachable and index exists. */
async function healthCheck(): Promise<void> {
  try {
    await getSearchIndex();
    log.info('Meilisearch health check passed');
  } catch (err) {
    log.error({ err }, 'Meilisearch health check failed — will retry');
    await new Promise(resolve => setTimeout(resolve, 5000));
    return healthCheck();
  }
}

// ─── Main ───
async function main(): Promise<void> {
  log.info('Starting 0xPresearchstr Nostr Crawler');
  log.info({ kinds: INDEXED_KINDS, batchSize: BATCH_SIZE, flushInterval: FLUSH_INTERVAL_MS });

  // Wait for Meilisearch.
  await healthCheck();

  status.running = true;

  // Periodic batch flush.
  setInterval(() => void flushBatch(), FLUSH_INTERVAL_MS);

  // Connect to all relays in parallel.
  const relays = getRelayUrls();
  log.info({ relays: relays.length }, 'Connecting to relays');

  await Promise.allSettled(relays.map(url => subscribeToRelay(url)));
}

main().catch(err => {
  log.fatal({ err }, 'Fatal error in Nostr crawler');
  process.exit(1);
});

export { status };

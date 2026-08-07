/**
 * 0xPresearchstr NIP-50 Relay Proxy
 *
 * A lightweight Nostr relay that implements NIP-50 search filters.
 * When a client sends a REQ with a `search` field, this relay:
 * 1. Queries Meilisearch for matching documents
 * 2. Returns the original signed Nostr events from the index
 * 3. Sends EOSE when done
 *
 * This allows any existing Nostr client to query our search index
 * natively using standard NIP-01 + NIP-50 messages.
 *
 * Non-search REQs are rejected with a NOTICE.
 */

import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../../shared/src/logger.js';
import { searchIndex, getSearchIndex } from '../../shared/src/meili.js';
import type { NostrEvent, SearchDocument } from '../../shared/src/types.js';

const log = createLogger('nip50-relay');

const PORT = parseInt(process.env.NIP50_PORT || '7777', 10);
const HOST = process.env.NIP50_HOST || '0.0.0.0';
const MAX_LIMIT = parseInt(process.env.NIP50_MAX_LIMIT || '100', 10);

// ─── NIP-11 Relay Information Document ───
const RELAY_INFO = {
  name: '0xPresearchstr NIP-50 Relay',
  description: 'Federated search relay powered by Meilisearch. Supports NIP-50 search filters across Nostr events indexed by 0xPresearchstr.',
  pubkey: '',
  contact: '',
  supported_nips: [1, 11, 50],
  software: 'https://github.com/NostrDanish/0xPresearchstr',
  version: '0.1.0',
  limitation: {
    max_message_length: 65536,
    max_subscriptions: 10,
    max_filters: 5,
    max_limit: MAX_LIMIT,
    auth_required: false,
    payment_required: false,
  },
};

// ─── Nostr message types ───
interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  search?: string;
  [key: `#${string}`]: string[] | undefined;
}

type ClientMessage =
  | ['REQ', string, ...NostrFilter[]]
  | ['CLOSE', string]
  | ['EVENT', NostrEvent];

// ─── Build Meilisearch filter from Nostr filter ───
function buildMeiliFilter(filter: NostrFilter): string {
  const conditions: string[] = [];

  // Only return Nostr-sourced documents.
  conditions.push('source = "nostr"');

  if (filter.kinds && filter.kinds.length > 0) {
    const kindList = filter.kinds.map(k => `kind = ${k}`).join(' OR ');
    conditions.push(`(${kindList})`);
  }

  if (filter.authors && filter.authors.length > 0) {
    const authorList = filter.authors.map(a => `pubkey = "${a}"`).join(' OR ');
    conditions.push(`(${authorList})`);
  }

  if (filter.since) {
    conditions.push(`timestamp >= ${filter.since}`);
  }

  if (filter.until) {
    conditions.push(`timestamp <= ${filter.until}`);
  }

  // Tag filters: #t, #p, #e, etc.
  if (filter['#t']) {
    const tagList = filter['#t'].map(t => `tags = "${t}"`).join(' OR ');
    conditions.push(`(${tagList})`);
  }

  return conditions.join(' AND ');
}

// ─── Handle a single REQ subscription ───
async function handleReq(
  ws: WebSocket,
  subscriptionId: string,
  filters: NostrFilter[],
): Promise<void> {
  for (const filter of filters) {
    if (!filter.search) {
      // We only handle search queries. Send NOTICE for non-search.
      const msg = JSON.stringify(['NOTICE', 'This relay only supports NIP-50 search queries. Include a "search" field in your filter.']);
      ws.send(msg);
      continue;
    }

    const limit = Math.min(filter.limit || 20, MAX_LIMIT);
    const meiliFilter = buildMeiliFilter(filter);

    try {
      const results = await searchIndex(filter.search, {
        filter: meiliFilter,
        limit,
        sort: ['timestamp:desc'],
      });

      for (const hit of results.hits) {
        const doc = hit as unknown as SearchDocument;
        if (doc.raw_event) {
          try {
            const event = JSON.parse(doc.raw_event) as NostrEvent;
            const eventMsg = JSON.stringify(['EVENT', subscriptionId, event]);
            ws.send(eventMsg);
          } catch {
            log.debug({ docId: doc.id }, 'Failed to parse raw_event JSON');
          }
        }
      }
    } catch (err) {
      log.error({ err, subscriptionId }, 'Meilisearch query failed');
    }
  }

  // Send EOSE.
  ws.send(JSON.stringify(['EOSE', subscriptionId]));
}

// ─── WebSocket connection handler ───
function handleConnection(ws: WebSocket): void {
  const subscriptions = new Set<string>();

  ws.on('message', (data: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      ws.send(JSON.stringify(['NOTICE', 'Invalid JSON']));
      return;
    }

    if (!Array.isArray(msg) || msg.length < 2) {
      ws.send(JSON.stringify(['NOTICE', 'Invalid message format']));
      return;
    }

    const type = msg[0];

    switch (type) {
      case 'REQ': {
        const subId = msg[1] as string;
        const filters = msg.slice(2) as NostrFilter[];

        if (subscriptions.size >= 10) {
          ws.send(JSON.stringify(['NOTICE', 'Too many subscriptions']));
          return;
        }

        subscriptions.add(subId);
        void handleReq(ws, subId, filters);
        break;
      }

      case 'CLOSE': {
        const subId = msg[1] as string;
        subscriptions.delete(subId);
        break;
      }

      case 'EVENT': {
        // This relay is read-only. Reject published events.
        ws.send(JSON.stringify(['OK', '', false, 'error: this relay is read-only']));
        break;
      }

      default:
        ws.send(JSON.stringify(['NOTICE', `Unknown message type: ${type}`]));
    }
  });

  ws.on('close', () => {
    subscriptions.clear();
  });

  ws.on('error', (err) => {
    log.error({ err }, 'WebSocket error');
  });
}

// ─── HTTP server (NIP-11 + WebSocket upgrade) ───
const server = createServer((req: IncomingMessage, res) => {
  // NIP-11: Return relay information for Accept: application/nostr+json.
  const accept = req.headers.accept || '';
  if (accept.includes('application/nostr+json')) {
    res.writeHead(200, {
      'Content-Type': 'application/nostr+json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(RELAY_INFO));
    return;
  }

  // Health check endpoint.
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', relay: '0xPresearchstr NIP-50' }));
    return;
  }

  // Default: redirect to the about page.
  res.writeHead(302, { Location: 'https://github.com/NostrDanish/0xPresearchstr' });
  res.end();
});

const wss = new WebSocketServer({ server });
wss.on('connection', handleConnection);

// ─── Main ───
async function main(): Promise<void> {
  log.info('Starting 0xPresearchstr NIP-50 Relay');

  // Wait for Meilisearch.
  try {
    await getSearchIndex();
    log.info('Meilisearch connected');
  } catch (err) {
    log.error({ err }, 'Meilisearch connection failed, retrying in 5s');
    await new Promise(resolve => setTimeout(resolve, 5000));
    return main();
  }

  server.listen(PORT, HOST, () => {
    log.info(`NIP-50 relay listening on ws://${HOST}:${PORT}`);
    log.info(`NIP-11 info at http://${HOST}:${PORT} (Accept: application/nostr+json)`);
  });
}

main().catch(err => {
  log.fatal({ err }, 'Fatal error in NIP-50 relay');
  process.exit(1);
});

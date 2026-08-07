/**
 * 0xPresearchstr Tor / I2P Crawler
 *
 * Crawls hidden services via:
 * - Tor SOCKS5 proxy for .onion sites
 * - I2P HTTP proxy for .i2p eepsites
 *
 * Enforces the strictest content policy layer before any content
 * reaches the public index. This is the most security-critical
 * component of the stack.
 *
 * Content policy (non-negotiable, mirrors Ahmia):
 * - Hard-block CSAM, human trafficking, weapons sales, drug marketplace listings
 * - Filter by known-bad domain/hash lists AND keyword/category classifiers
 * - Log and drop blocked content (never surface)
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { SocksProxyAgent } from 'socks-proxy-agent';
import PQueue from 'p-queue';
import { createLogger } from '../../shared/src/logger.js';
import { indexDocuments, getSearchIndex } from '../../shared/src/meili.js';
import { checkContentPolicy, loadBlocklists } from '../../shared/src/content-policy.js';
import type { SearchDocument, CrawlerStatus } from '../../shared/src/types.js';

const log = createLogger('tor-crawler');

// ─── Configuration ───
const TOR_SOCKS_PROXY = process.env.TOR_SOCKS_PROXY || 'socks5h://127.0.0.1:9050';
const I2P_HTTP_PROXY = process.env.I2P_HTTP_PROXY || 'http://127.0.0.1:4444';
const MAX_CONCURRENT = parseInt(process.env.TOR_CONCURRENCY || '3', 10);
const RATE_LIMIT_MS = parseInt(process.env.TOR_RATE_LIMIT_MS || '5000', 10);
const BATCH_SIZE = parseInt(process.env.TOR_BATCH_SIZE || '10', 10);
const MAX_CONTENT_LENGTH = parseInt(process.env.TOR_MAX_CONTENT_LENGTH || '2097152', 10); // 2MB
const ONION_SEED_FILE = process.env.TOR_SEED_FILE || './config/seeds-onion.txt';
const I2P_SEED_FILE = process.env.I2P_SEED_FILE || './config/seeds-i2p.txt';
const BLOCKLIST_REFRESH_INTERVAL = parseInt(process.env.BLOCKLIST_REFRESH_INTERVAL || '3600000', 10); // 1 hour

// ─── SOCKS5 agent for Tor ───
const torAgent = new SocksProxyAgent(TOR_SOCKS_PROXY);

// ─── State ───
const visited = new Set<string>();
const queue = new PQueue({ concurrency: MAX_CONCURRENT });
const domainLastFetch = new Map<string, number>();
let batch: SearchDocument[] = [];

const status: CrawlerStatus = {
  name: 'tor-crawler',
  running: false,
  documentsIndexed: 0,
  documentsBlocked: 0,
  lastActivity: 0,
  errors: 0,
};

// ─── Network detection ───
type NetworkType = 'tor' | 'i2p';

function detectNetwork(url: string): NetworkType | null {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.endsWith('.onion')) return 'tor';
    if (hostname.endsWith('.i2p')) return 'i2p';
    return null;
  } catch {
    return null;
  }
}

// ─── Rate limiting ───
async function waitForRateLimit(domain: string): Promise<void> {
  const lastFetch = domainLastFetch.get(domain) || 0;
  const elapsed = Date.now() - lastFetch;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  domainLastFetch.set(domain, Date.now());
}

// ─── Seed URLs ───
function loadSeeds(filePath: string): string[] {
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, 'utf-8');
    return raw.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  }
  return [];
}

// ─── Page fetching ───
async function fetchPage(url: string, network: NetworkType): Promise<string | null> {
  try {
    const domain = new URL(url).hostname;
    await waitForRateLimit(domain);

    // Use appropriate proxy.
    const fetchOptions: RequestInit & { agent?: unknown } = {
      headers: {
        'User-Agent': '0xPresearchstr/0.1',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(30000), // Tor is slow, allow 30s.
      redirect: 'follow',
    };

    // For Tor, we need the SOCKS5 agent.
    // For I2P, we use the HTTP proxy.
    // Note: Node.js native fetch doesn't support SOCKS directly.
    // In production, use undici or node-fetch with agent support.
    // This code demonstrates the architecture — real implementation
    // would use: import { fetch as undiciFetch } from 'undici';

    let html: string;

    if (network === 'tor') {
      // Tor via SOCKS5 proxy.
      // Using global fetch with proxy requires Node 22+ or undici.
      // Fallback: use the socks-proxy-agent with http module.
      const http = await import('node:http');
      html = await new Promise<string>((resolve, reject) => {
        const req = http.request(url, {
          agent: torAgent as unknown as http.Agent,
          timeout: 30000,
          headers: {
            'User-Agent': '0xPresearchstr/0.1',
            'Accept': 'text/html',
          },
        }, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          const contentLength = parseInt(res.headers['content-length'] || '0', 10);
          if (contentLength > MAX_CONTENT_LENGTH) {
            reject(new Error('Content too large'));
            return;
          }

          let body = '';
          res.setEncoding('utf-8');
          res.on('data', (chunk: string) => {
            body += chunk;
            if (body.length > MAX_CONTENT_LENGTH) {
              req.destroy();
              reject(new Error('Content too large'));
            }
          });
          res.on('end', () => resolve(body));
          res.on('error', reject);
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
        req.end();
      });
    } else {
      // I2P via HTTP proxy.
      const proxyUrl = `${I2P_HTTP_PROXY}/${url}`;
      const res = await fetch(proxyUrl, fetchOptions);
      if (!res.ok) return null;
      html = await res.text();
    }

    if (html.length > MAX_CONTENT_LENGTH) return null;
    return html;
  } catch (err) {
    status.errors++;
    log.debug({ err, url }, 'Failed to fetch hidden service page');
    return null;
  }
}

// ─── Content extraction ───
function extractContent(html: string, url: string, network: NetworkType): SearchDocument | null {
  const $ = cheerio.load(html);

  $('script, style, nav, footer, header, aside').remove();

  const title = $('title').text().trim() || $('h1').first().text().trim() || '';
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 10000);

  if (!title && !bodyText) return null;

  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return null;
  }

  const id = createHash('sha256').update(url).digest('hex').slice(0, 32);

  // Extract links for crawl frontier (same network only).
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const absoluteUrl = new URL(href, url).href;
      const linkNetwork = detectNetwork(absoluteUrl);
      if (linkNetwork === network && !visited.has(absoluteUrl)) {
        void enqueueUrl(absoluteUrl);
      }
    } catch {
      // Invalid URL, skip.
    }
  });

  return {
    id,
    source: network,
    content: bodyText,
    title: title || undefined,
    summary: bodyText.slice(0, 300),
    url,
    page_url: url,
    domain,
    timestamp: Math.floor(Date.now() / 1000),
    date: new Date().toISOString(),
  };
}

// ─── Batch indexing ───
async function flushBatch(): Promise<void> {
  if (batch.length === 0) return;
  const toFlush = [...batch];
  batch = [];

  try {
    await indexDocuments(toFlush);
    status.documentsIndexed += toFlush.length;
    status.lastActivity = Date.now();
    log.info(`Indexed ${toFlush.length} hidden service pages (total: ${status.documentsIndexed})`);
  } catch (err) {
    status.errors++;
    log.error({ err }, `Failed to index batch of ${toFlush.length} pages`);
    batch.push(...toFlush);
  }
}

// ─── URL processing ───
async function processUrl(url: string): Promise<void> {
  if (visited.has(url)) return;
  visited.add(url);

  const network = detectNetwork(url);
  if (!network) return;

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  CONTENT POLICY ENFORCEMENT — THIS IS THE CRITICAL PATH       ║
  // ║  Every piece of content goes through THREE checks before       ║
  // ║  it can enter the index:                                       ║
  // ║  1. Domain blocklist (known-bad .onion/.i2p addresses)         ║
  // ║  2. Content hash blocklist (SHA-256 of page content)           ║
  // ║  3. Keyword/category classifier                                ║
  // ║  If ANY check triggers, the content is logged and dropped.     ║
  // ╚══════════════════════════════════════════════════════════════════╝

  // Pre-check: is the domain itself blocked?
  try {
    const domain = new URL(url).hostname;
    const domainVerdict = checkContentPolicy('', { domain });
    if (!domainVerdict.allowed) {
      status.documentsBlocked++;
      log.warn({ url, category: domainVerdict.category }, 'Domain blocked before fetch');
      return;
    }
  } catch {
    return;
  }

  const html = await fetchPage(url, network);
  if (!html) return;

  // Full content policy check on raw HTML.
  const htmlVerdict = checkContentPolicy(html, { url });
  if (!htmlVerdict.allowed) {
    status.documentsBlocked++;
    log.warn({ url, category: htmlVerdict.category }, 'Raw HTML blocked by content policy');
    return;
  }

  const doc = extractContent(html, url, network);
  if (!doc) return;

  // Final content policy check on extracted text.
  const textVerdict = checkContentPolicy(doc.content, { domain: doc.domain, url });
  if (!textVerdict.allowed) {
    status.documentsBlocked++;
    log.warn({ url, category: textVerdict.category }, 'Extracted text blocked by content policy');
    return;
  }

  batch.push(doc);
  if (batch.length >= BATCH_SIZE) {
    await flushBatch();
  }
}

async function enqueueUrl(url: string): Promise<void> {
  if (visited.has(url)) return;
  void queue.add(() => processUrl(url));
}

// ─── Main ───
async function main(): Promise<void> {
  log.info('Starting 0xPresearchstr Tor/I2P Crawler');
  log.info({
    torProxy: TOR_SOCKS_PROXY,
    i2pProxy: I2P_HTTP_PROXY,
    concurrency: MAX_CONCURRENT,
    rateLimitMs: RATE_LIMIT_MS,
  });

  // Wait for Meilisearch.
  try {
    await getSearchIndex();
    log.info('Meilisearch connected');
  } catch (err) {
    log.error({ err }, 'Meilisearch connection failed, retrying in 5s');
    await new Promise(resolve => setTimeout(resolve, 5000));
    return main();
  }

  status.running = true;

  // Periodic batch flush.
  setInterval(() => void flushBatch(), 15000);

  // Periodic blocklist refresh.
  setInterval(() => {
    log.info('Refreshing blocklists');
    loadBlocklists();
  }, BLOCKLIST_REFRESH_INTERVAL);

  // Load seed URLs.
  const onionSeeds = loadSeeds(ONION_SEED_FILE);
  const i2pSeeds = loadSeeds(I2P_SEED_FILE);
  log.info({ onionSeeds: onionSeeds.length, i2pSeeds: i2pSeeds.length }, 'Loaded seed URLs');

  for (const seed of [...onionSeeds, ...i2pSeeds]) {
    await enqueueUrl(seed);
  }

  queue.on('idle', () => {
    log.info('Queue drained, flushing remaining batch');
    void flushBatch();
  });
}

main().catch(err => {
  log.fatal({ err }, 'Fatal error in Tor/I2P crawler');
  process.exit(1);
});

export { status };

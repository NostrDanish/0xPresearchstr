/**
 * 0xPresearchstr Clearnet Crawler
 *
 * Polite web crawler that:
 * - Respects robots.txt for every domain
 * - Rate-limits requests per domain (configurable)
 * - Seeds from curated seed URLs + sitemap discovery
 * - Extracts text, title, meta description from HTML
 * - Runs content policy checks before indexing
 * - Pushes normalized documents to Meilisearch
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import PQueue from 'p-queue';
import { createLogger } from '../../shared/src/logger.js';
import { indexDocuments, getSearchIndex } from '../../shared/src/meili.js';
import { checkContentPolicy } from '../../shared/src/content-policy.js';
import type { SearchDocument, CrawlerStatus } from '../../shared/src/types.js';

const log = createLogger('clearnet-crawler');

// ─── Configuration ───
const USER_AGENT = process.env.CRAWLER_USER_AGENT || '0xPresearchstr/0.1 (+https://github.com/NostrDanish/0xPresearchstr)';
const MAX_CONCURRENT = parseInt(process.env.CLEARNET_CONCURRENCY || '5', 10);
const RATE_LIMIT_MS = parseInt(process.env.CLEARNET_RATE_LIMIT_MS || '2000', 10);
const MAX_PAGES_PER_DOMAIN = parseInt(process.env.CLEARNET_MAX_PAGES_PER_DOMAIN || '1000', 10);
const MAX_CONTENT_LENGTH = parseInt(process.env.CLEARNET_MAX_CONTENT_LENGTH || '5242880', 10); // 5MB
const BATCH_SIZE = parseInt(process.env.CLEARNET_BATCH_SIZE || '25', 10);
const SEED_FILE_PATH = process.env.CLEARNET_SEED_FILE || './config/seeds-clearnet.txt';

// ─── State ───
const visited = new Set<string>();
const queue = new PQueue({ concurrency: MAX_CONCURRENT });
const domainLastFetch = new Map<string, number>();
const domainPageCount = new Map<string, number>();
const robotsCache = new Map<string, ReturnType<typeof robotsParser>>();
let batch: SearchDocument[] = [];

const status: CrawlerStatus = {
  name: 'clearnet-crawler',
  running: false,
  documentsIndexed: 0,
  documentsBlocked: 0,
  lastActivity: 0,
  errors: 0,
};

// ─── Seed URLs ───
function loadSeeds(): string[] {
  if (existsSync(SEED_FILE_PATH)) {
    const raw = readFileSync(SEED_FILE_PATH, 'utf-8');
    return raw.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  }
  log.warn(`Seed file not found at ${SEED_FILE_PATH}, using defaults`);
  return [
    'https://en.wikipedia.org/wiki/Nostr',
    'https://nostr.com',
    'https://njump.me',
  ];
}

// ─── robots.txt ───
async function getRobots(domain: string): Promise<ReturnType<typeof robotsParser>> {
  if (robotsCache.has(domain)) {
    return robotsCache.get(domain)!;
  }

  const robotsUrl = `https://${domain}/robots.txt`;
  try {
    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    const text = res.ok ? await res.text() : '';
    const robots = robotsParser(robotsUrl, text);
    robotsCache.set(domain, robots);
    return robots;
  } catch {
    // If robots.txt is unreachable, assume everything is allowed.
    const robots = robotsParser(robotsUrl, '');
    robotsCache.set(domain, robots);
    return robots;
  }
}

async function isAllowed(url: string): Promise<boolean> {
  try {
    const domain = new URL(url).hostname;
    const robots = await getRobots(domain);
    return robots.isAllowed(url, USER_AGENT) ?? true;
  } catch {
    return false;
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

// ─── Page fetching and parsing ───
async function fetchPage(url: string): Promise<{ html: string; contentType: string } | null> {
  try {
    const domain = new URL(url).hostname;

    // Check page-per-domain limit.
    const count = domainPageCount.get(domain) || 0;
    if (count >= MAX_PAGES_PER_DOMAIN) {
      log.debug({ domain }, 'Max pages reached for domain');
      return null;
    }

    await waitForRateLimit(domain);

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_CONTENT_LENGTH) return null;

    const html = await res.text();
    domainPageCount.set(domain, count + 1);

    return { html, contentType };
  } catch (err) {
    status.errors++;
    log.debug({ err, url }, 'Failed to fetch page');
    return null;
  }
}

function extractContent(html: string, url: string): SearchDocument | null {
  const $ = cheerio.load(html);

  // Remove script, style, nav, footer elements.
  $('script, style, nav, footer, header, aside, .sidebar, .nav, .menu, .cookie-banner').remove();

  const title = $('title').text().trim()
    || $('meta[property="og:title"]').attr('content')?.trim()
    || $('h1').first().text().trim()
    || '';

  const description = $('meta[name="description"]').attr('content')?.trim()
    || $('meta[property="og:description"]').attr('content')?.trim()
    || '';

  const bodyText = $('body').text()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10000); // Cap at 10k chars for indexing.

  const language = $('html').attr('lang')?.slice(0, 2)?.toLowerCase() || undefined;

  if (!title && !bodyText) return null;

  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return null;
  }

  const id = createHash('sha256').update(url).digest('hex').slice(0, 32);

  // Extract links for crawl frontier.
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const absoluteUrl = new URL(href, url).href;
      if (absoluteUrl.startsWith('https://') || absoluteUrl.startsWith('http://')) {
        links.push(absoluteUrl);
      }
    } catch {
      // Invalid URL, skip.
    }
  });

  // Enqueue discovered links.
  for (const link of links.slice(0, 50)) { // Cap link extraction per page.
    if (!visited.has(link)) {
      void enqueueUrl(link);
    }
  }

  return {
    id,
    source: 'clearnet',
    content: bodyText,
    title: title || undefined,
    summary: description || bodyText.slice(0, 300),
    url,
    page_url: url,
    domain,
    language,
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
    log.info(`Indexed ${toFlush.length} clearnet pages (total: ${status.documentsIndexed})`);
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

  // Check robots.txt.
  if (!(await isAllowed(url))) {
    log.debug({ url }, 'Disallowed by robots.txt');
    return;
  }

  const page = await fetchPage(url);
  if (!page) return;

  const doc = extractContent(page.html, url);
  if (!doc) return;

  // Content policy check.
  const verdict = checkContentPolicy(doc.content, { domain: doc.domain, url });
  if (!verdict.allowed) {
    status.documentsBlocked++;
    log.debug({ url, category: verdict.category }, 'Page blocked by content policy');
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

// ─── Sitemap discovery ───
async function discoverSitemap(domain: string): Promise<string[]> {
  const urls: string[] = [];
  try {
    const robots = await getRobots(domain);
    const sitemapUrls = robots.getSitemaps();

    for (const sitemapUrl of sitemapUrls.slice(0, 3)) {
      try {
        const res = await fetch(sitemapUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) continue;
        const xml = await res.text();
        const $ = cheerio.load(xml, { xmlMode: true });
        $('url > loc').each((_, el) => {
          const loc = $(el).text().trim();
          if (loc) urls.push(loc);
        });
      } catch {
        // Sitemap fetch failed, continue.
      }
    }
  } catch {
    // robots.txt not available.
  }
  return urls.slice(0, 500); // Cap sitemap URLs.
}

// ─── Main ───
async function main(): Promise<void> {
  log.info('Starting 0xPresearchstr Clearnet Crawler');
  log.info({ concurrency: MAX_CONCURRENT, rateLimitMs: RATE_LIMIT_MS });

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
  setInterval(() => void flushBatch(), 10000);

  // Load seed URLs.
  const seeds = loadSeeds();
  log.info({ seeds: seeds.length }, 'Loaded seed URLs');

  // Discover sitemaps from seed domains.
  for (const seed of seeds) {
    try {
      const domain = new URL(seed).hostname;
      const sitemapUrls = await discoverSitemap(domain);
      log.info({ domain, sitemapUrls: sitemapUrls.length }, 'Discovered sitemap URLs');
      for (const url of sitemapUrls) {
        await enqueueUrl(url);
      }
    } catch {
      // Not a valid URL, just enqueue directly.
    }
    await enqueueUrl(seed);
  }

  // Wait for the queue to drain, then repeat.
  queue.on('idle', () => {
    log.info('Queue drained, flushing remaining batch');
    void flushBatch();
  });
}

main().catch(err => {
  log.fatal({ err }, 'Fatal error in clearnet crawler');
  process.exit(1);
});

export { status };

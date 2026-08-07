/**
 * 0xPresearchstr Abuse Report API
 *
 * Provides endpoints for:
 * - Submitting abuse reports (POST /api/report)
 * - Listing pending reports (GET /api/reports) — admin only
 * - Reviewing a report (PATCH /api/reports/:id) — admin only
 * - Health check (GET /health)
 * - REST search API for the frontend (GET /api/search)
 *
 * Reports are stored as JSON files in a volume-mounted directory.
 * In production, replace with a proper database (SQLite/PostgreSQL).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../shared/src/logger.js';
import { searchIndex, removeDocuments } from '../../shared/src/meili.js';
import type { AbuseReport } from '../../shared/src/types.js';

const log = createLogger('abuse-api');

const PORT = parseInt(process.env.ABUSE_API_PORT || '8080', 10);
const HOST = process.env.ABUSE_API_HOST || '0.0.0.0';
const ADMIN_TOKEN = process.env.ABUSE_ADMIN_TOKEN || '';
const REPORTS_DIR = process.env.REPORTS_DIR || './data/reports';

// Ensure reports directory exists.
if (!existsSync(REPORTS_DIR)) {
  mkdirSync(REPORTS_DIR, { recursive: true });
}

// ─── Helper: parse JSON body ───
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Helper: send JSON response ───
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

// ─── Helper: check admin auth ───
function isAdmin(req: IncomingMessage): boolean {
  if (!ADMIN_TOKEN) {
    log.warn('ABUSE_ADMIN_TOKEN not set — admin endpoints are disabled');
    return false;
  }
  const auth = req.headers.authorization;
  return auth === `Bearer ${ADMIN_TOKEN}`;
}

// ─── Report persistence ───
function saveReport(report: AbuseReport): void {
  const filePath = join(REPORTS_DIR, `${report.id}.json`);
  writeFileSync(filePath, JSON.stringify(report, null, 2));
}

function loadReport(id: string): AbuseReport | null {
  const filePath = join(REPORTS_DIR, `${id}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8')) as AbuseReport;
}

function listReports(statusFilter?: string): AbuseReport[] {
  const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
  const reports: AbuseReport[] = [];
  for (const file of files) {
    try {
      const report = JSON.parse(readFileSync(join(REPORTS_DIR, file), 'utf-8')) as AbuseReport;
      if (!statusFilter || report.status === statusFilter) {
        reports.push(report);
      }
    } catch {
      // Skip corrupted files.
    }
  }
  return reports.sort((a, b) => b.reportedAt - a.reportedAt);
}

// ─── Route handlers ───

/** POST /api/report — Submit an abuse report. */
async function handleSubmitReport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseBody(req) as Record<string, unknown>;

  const url = (body.url as string)?.trim();
  const reason = (body.reason as string)?.trim();
  const category = body.category as AbuseReport['category'] || 'other';

  if (!url || !reason) {
    sendJson(res, 400, { error: 'url and reason are required' });
    return;
  }

  const report: AbuseReport = {
    id: randomUUID(),
    url,
    reason,
    category,
    reportedAt: Math.floor(Date.now() / 1000),
    status: 'pending',
  };

  saveReport(report);
  log.info({ reportId: report.id, url }, 'New abuse report submitted');

  sendJson(res, 201, { id: report.id, status: 'pending' });
}

/** GET /api/reports — List reports (admin only). */
function handleListReports(req: IncomingMessage, res: ServerResponse): void {
  if (!isAdmin(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const statusFilter = url.searchParams.get('status') || undefined;
  const reports = listReports(statusFilter);

  sendJson(res, 200, { reports, total: reports.length });
}

/** PATCH /api/reports/:id — Review a report (admin only). */
async function handleReviewReport(req: IncomingMessage, res: ServerResponse, reportId: string): Promise<void> {
  if (!isAdmin(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const report = loadReport(reportId);
  if (!report) {
    sendJson(res, 404, { error: 'Report not found' });
    return;
  }

  const body = await parseBody(req) as Record<string, unknown>;
  const newStatus = body.status as AbuseReport['status'];
  const reviewNote = body.reviewNote as string;

  if (!newStatus || !['reviewed', 'removed', 'dismissed'].includes(newStatus)) {
    sendJson(res, 400, { error: 'Invalid status. Must be: reviewed, removed, dismissed' });
    return;
  }

  report.status = newStatus;
  report.reviewedAt = Math.floor(Date.now() / 1000);
  report.reviewNote = reviewNote;

  // If status is "removed", remove the document from the search index.
  if (newStatus === 'removed') {
    try {
      // Try to find and remove the document by URL hash.
      const { createHash } = await import('node:crypto');
      const docId = createHash('sha256').update(report.url).digest('hex').slice(0, 32);
      await removeDocuments([docId]);
      log.info({ reportId, docId }, 'Document removed from index');
    } catch (err) {
      log.error({ err, reportId }, 'Failed to remove document from index');
    }
  }

  saveReport(report);
  log.info({ reportId, status: newStatus }, 'Report reviewed');

  sendJson(res, 200, { report });
}

/** GET /api/search — REST search endpoint for the frontend. */
async function handleSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const query = url.searchParams.get('q') || '';
  const source = url.searchParams.get('source') || undefined;
  const kind = url.searchParams.get('kind') || undefined;
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  if (!query) {
    sendJson(res, 400, { error: 'q parameter is required' });
    return;
  }

  const filterParts: string[] = [];
  if (source) filterParts.push(`source = "${source}"`);
  if (kind) filterParts.push(`kind = ${kind}`);

  try {
    const results = await searchIndex(query, {
      filter: filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      limit: Math.min(limit, 100),
      offset,
      facets: ['source', 'kind', 'tags', 'domain'],
    });

    sendJson(res, 200, {
      query,
      hits: results.hits,
      totalHits: results.estimatedTotalHits,
      facets: results.facetDistribution,
      processingTimeMs: results.processingTimeMs,
    });
  } catch (err) {
    log.error({ err }, 'Search query failed');
    sendJson(res, 500, { error: 'Search failed' });
  }
}

// ─── HTTP server ───
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = req.method || 'GET';
  const urlPath = req.url?.split('?')[0] || '/';

  // CORS preflight.
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  try {
    // Health check.
    if (urlPath === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    // Search API.
    if (method === 'GET' && urlPath === '/api/search') {
      await handleSearch(req, res);
      return;
    }

    // Submit abuse report.
    if (method === 'POST' && urlPath === '/api/report') {
      await handleSubmitReport(req, res);
      return;
    }

    // List reports (admin).
    if (method === 'GET' && urlPath === '/api/reports') {
      handleListReports(req, res);
      return;
    }

    // Review report (admin).
    const reportMatch = urlPath.match(/^\/api\/reports\/([a-f0-9-]+)$/);
    if (method === 'PATCH' && reportMatch) {
      await handleReviewReport(req, res, reportMatch[1]);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    log.error({ err }, 'Request handler error');
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  log.info(`Abuse API / REST Search listening on http://${HOST}:${PORT}`);
  log.info(`  POST /api/report       — Submit abuse report`);
  log.info(`  GET  /api/search?q=... — Search the index`);
  log.info(`  GET  /api/reports      — List reports (admin)`);
  log.info(`  PATCH /api/reports/:id — Review report (admin)`);
});

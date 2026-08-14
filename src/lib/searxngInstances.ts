/**
 * Dynamic SearXNG instance pool — inspired by searxist (codeberg.org/searxist).
 *
 * Instead of a hardcoded instance list, the pool is built from three layers:
 *
 *   1. CUSTOM    — user-added instances (self-hosted or trusted), highest priority
 *   2. DISCOVERED — live public instances from searx.space, privacy-filtered
 *                  (OPT-IN — off by default for speed; enable in Settings)
 *   3. DEFAULT   — hardcoded bootstrap list (always-on baseline)
 *
 * The pool is self-healing: per-instance health stats are tracked in
 * localStorage. Instances that fail get demoted; ones that respond fast
 * get promoted. Everything runs client-side — no backend, no tracking.
 *
 * Privacy filters applied to discovered instances:
 *   - network_type === 'normal' (reachable without Tor)
 *   - no analytics
 *   - HTTP 200 + running a real SearXNG version
 *   - search success rate >= 80%
 */

import { proxiedFetch } from '@/lib/corsProxy';

/** searx.space live instance database (updated continuously). */
const SEARX_SPACE_URL = 'https://searx.space/data/instances.json';

/** Hardcoded default instances — the active set from first run. */
export const SEED_INSTANCES = [
  'https://search.bus-hit.me',
  'https://baresearch.org',
  'https://search.ononoki.org',
  'https://ooglester.com',
  'https://searxng.site',
  'https://search.mectov.my.id',
  'https://search.im-in.space',
];

/** localStorage keys. */
const LS_DISCOVERED = '0xsearchstr:searxng:discovered';
const LS_CUSTOM = '0xsearchstr:searxng:custom';
const LS_HEALTH = '0xsearchstr:searxng:health';
const LS_DISABLED = '0xsearchstr:searxng:disabled';
const LS_DISCOVERY_ON = '0xsearchstr:searxng:discovery';

/** How long discovered instances stay fresh (24h). */
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

/** Max discovered instances to keep. */
const MAX_DISCOVERED = 24;

/** Instance health record. */
export interface InstanceHealth {
  /** Consecutive successes. */
  ok: number;
  /** Consecutive failures. */
  fail: number;
  /** Last successful response timestamp (ms). */
  lastOk?: number;
  /** Last observed latency (ms). */
  latencyMs?: number;
  /**
   * Exponential moving average of result counts per successful query.
   * An instance returning 20 results is strictly more useful than one
   * returning 2 — quality, not just speed, drives pool ranking.
   */
  avgResults?: number;
}

export interface DiscoveredCache {
  urls: string[];
  fetchedAt: number;
}

export type InstanceOrigin = 'custom' | 'discovered' | 'seed';

export interface PoolInstance {
  url: string;
  origin: InstanceOrigin;
  health?: InstanceHealth;
  /** True when the user disabled this instance (one click in Settings). */
  disabled?: boolean;
}

/* ------------------------------------------------------------------ */
/* localStorage helpers                                                */
/* ------------------------------------------------------------------ */

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — non-fatal.
  }
}

/* ------------------------------------------------------------------ */
/* Custom instances (user-managed)                                     */
/* ------------------------------------------------------------------ */

/** Normalize an instance URL: https only, no trailing slash. */
export function normalizeInstanceUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'https:') return null;
    return `${u.origin}${u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

export function getCustomInstances(): string[] {
  return readJson<string[]>(LS_CUSTOM) ?? [];
}

export function addCustomInstance(url: string): string | null {
  const normalized = normalizeInstanceUrl(url);
  if (!normalized) return null;
  const current = getCustomInstances();
  if (!current.includes(normalized)) {
    writeJson(LS_CUSTOM, [...current, normalized]);
  }
  return normalized;
}

export function removeCustomInstance(url: string): void {
  writeJson(LS_CUSTOM, getCustomInstances().filter((u) => u !== url));
}

/* ------------------------------------------------------------------ */
/* Disabled instances (one-click off/on, any origin)                    */
/* ------------------------------------------------------------------ */

export function getDisabledInstances(): string[] {
  return readJson<string[]>(LS_DISABLED) ?? [];
}

export function isInstanceDisabled(url: string): boolean {
  return getDisabledInstances().includes(url);
}

/** Toggle an instance's active state. Returns the new disabled state. */
export function toggleInstanceDisabled(url: string): boolean {
  const current = getDisabledInstances();
  const disabled = !current.includes(url);
  writeJson(LS_DISABLED, disabled ? [...current, url] : current.filter((u) => u !== url));
  return disabled;
}

/* ------------------------------------------------------------------ */
/* Health tracking (adaptive, per-browser)                             */
/* ------------------------------------------------------------------ */

type HealthMap = Record<string, InstanceHealth>;

export function getHealthMap(): HealthMap {
  return readJson<HealthMap>(LS_HEALTH) ?? {};
}

export function recordInstanceSuccess(url: string, latencyMs: number, resultCount?: number): void {
  const map = getHealthMap();
  const h = map[url] ?? { ok: 0, fail: 0 };

  // EMA of result counts (alpha = 0.4) — recent quality weighs most.
  let avgResults = h.avgResults;
  if (resultCount !== undefined) {
    avgResults = avgResults === undefined
      ? resultCount
      : avgResults * 0.6 + resultCount * 0.4;
  }

  map[url] = { ok: h.ok + 1, fail: 0, lastOk: Date.now(), latencyMs, avgResults };
  writeJson(LS_HEALTH, map);
}

export function recordInstanceFailure(url: string): void {
  const map = getHealthMap();
  const h = map[url] ?? { ok: 0, fail: 0 };
  map[url] = { ...h, ok: 0, fail: h.fail + 1 };
  writeJson(LS_HEALTH, map);
}

/** Health score: lower = better position in pool. */
function healthPenalty(h: InstanceHealth | undefined): number {
  if (!h) return 0;
  // Each consecutive failure pushes the instance down heavily;
  // recent success + low latency pulls it up.
  let penalty = h.fail * 1000;
  if (h.latencyMs) penalty += Math.min(h.latencyMs, 5000) / 10;
  if (h.ok > 0) penalty -= Math.min(h.ok, 10) * 50;
  // Result quality: instances that consistently return full result pages
  // outrank thin ones (a 20-result instance beats a 2-result instance).
  if (h.avgResults !== undefined) penalty -= Math.min(h.avgResults, 20) * 5;
  return penalty;
}

/* ------------------------------------------------------------------ */
/* Discovery — searx.space                                             */
/* ------------------------------------------------------------------ */

/** Shape of the parts of searx.space instances.json we care about. */
interface SearxSpaceInstance {
  analytics?: boolean;
  network_type?: string;
  version?: string;
  http?: { status_code?: number | null; grade?: string | null };
  tls?: { grade?: string | null };
  timing?: {
    search?: {
      success_percentage?: number;
      all?: { median?: number };
    };
  };
}

interface SearxSpaceData {
  instances: Record<string, SearxSpaceInstance>;
}

export function getDiscoveredCache(): DiscoveredCache | null {
  return readJson<DiscoveredCache>(LS_DISCOVERED);
}

/* ------------------------------------------------------------------ */
/* Discovery opt-in (off by default)                                   */
/* ------------------------------------------------------------------ */

/**
 * Whether live discovery from searx.space is enabled. OFF by default:
 * the hardcoded default instances are the active pool until the user
 * opts in (Settings → SearXNG). No searx.space request is ever made
 * while disabled.
 */
export function isDiscoveryEnabled(): boolean {
  return readJson<boolean>(LS_DISCOVERY_ON) === true;
}

export function setDiscoveryEnabled(enabled: boolean): void {
  writeJson(LS_DISCOVERY_ON, enabled);
}

function isDiscoveryFresh(cache: DiscoveredCache | null): boolean {
  return !!cache && Date.now() - cache.fetchedAt < DISCOVERY_TTL_MS;
}

/** In-flight discovery guard so we only fetch once at a time. */
let discoveryPromise: Promise<string[]> | null = null;

/**
 * Fetch and rank public instances from searx.space.
 * Filters for privacy + reliability, sorts by median search latency.
 */
async function fetchPublicInstances(signal?: AbortSignal): Promise<string[]> {
  const res = await proxiedFetch(SEARX_SPACE_URL, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`searx.space returned ${res.status}`);

  const data = (await res.json()) as SearxSpaceData;
  if (!data.instances) throw new Error('Malformed searx.space data');

  const candidates: { url: string; median: number }[] = [];

  for (const [rawUrl, inst] of Object.entries(data.instances)) {
    // Privacy + reliability filters.
    if (inst.network_type !== 'normal') continue;      // clearnet only
    if (inst.analytics) continue;                       // no trackers
    if (inst.http?.status_code !== 200) continue;       // alive
    if (!inst.version) continue;                        // real SearXNG

    const search = inst.timing?.search;
    const success = search?.success_percentage ?? 0;
    if (success < 80) continue;                         // reliable

    const url = normalizeInstanceUrl(rawUrl);
    if (!url) continue;

    candidates.push({
      url,
      median: search?.all?.median ?? 99,
    });
  }

  // Fastest first.
  candidates.sort((a, b) => a.median - b.median);

  return candidates.slice(0, MAX_DISCOVERED).map((c) => c.url);
}

/**
 * Refresh the discovered instance list if stale.
 * Fire-and-forget safe; errors keep the old cache.
 * No-op while discovery is disabled (default) — never touches the network.
 */
export async function refreshDiscoveredInstances(force = false): Promise<string[]> {
  if (!isDiscoveryEnabled()) return getDiscoveredCache()?.urls ?? [];

  const cache = getDiscoveredCache();
  if (!force && cache && isDiscoveryFresh(cache)) return cache.urls;

  if (!discoveryPromise) {
    discoveryPromise = fetchPublicInstances()
      .then((urls) => {
        if (urls.length > 0) {
          writeJson(LS_DISCOVERED, { urls, fetchedAt: Date.now() } satisfies DiscoveredCache);
        }
        return urls;
      })
      .catch(() => cache?.urls ?? [])
      .finally(() => {
        discoveryPromise = null;
      });
  }

  return discoveryPromise;
}

/* ------------------------------------------------------------------ */
/* The pool                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the current instance pool, ranked:
 *   1. Custom instances (user's own — always first)
 *   2. Discovered instances (searx.space, health-sorted) — OPT-IN tier,
 *      empty unless the user enabled discovery in Settings → SearXNG
 *   3. Default instances (health-sorted within tier)
 *
 * Instances with repeated recent failures sink to the bottom of
 * their tier but are never removed — they may come back.
 */
export function getInstancePool(): PoolInstance[] {
  const health = getHealthMap();
  const disabled = new Set(getDisabledInstances());
  const seen = new Set<string>();
  const pool: PoolInstance[] = [];

  const push = (url: string, origin: InstanceOrigin) => {
    if (seen.has(url)) return;
    seen.add(url);
    pool.push({ url, origin, health: health[url], disabled: disabled.has(url) });
  };

  // Tier 1: custom.
  for (const url of getCustomInstances()) push(url, 'custom');

  // Tier 2: discovered (health-sorted within tier) — only when the user
  // opted into live discovery. Off by default: fewer proxy round-trips,
  // faster first search, and no searx.space fetch at all.
  if (isDiscoveryEnabled()) {
    const discovered = (getDiscoveredCache()?.urls ?? [])
      .slice()
      .sort((a, b) => healthPenalty(health[a]) - healthPenalty(health[b]));
    for (const url of discovered) push(url, 'discovered');
  }

  // Tier 3: defaults (health-sorted within tier).
  const seeds = SEED_INSTANCES
    .slice()
    .sort((a, b) => healthPenalty(health[a]) - healthPenalty(health[b]));
  for (const url of seeds) push(url, 'seed');

  return pool;
}

/** Convenience: just the ACTIVE instance URLs, in pool order (used by the provider). */
export function getInstanceUrls(): string[] {
  return getInstancePool().filter((p) => !p.disabled).map((p) => p.url);
}

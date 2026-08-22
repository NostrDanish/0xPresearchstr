/**
 * Dynamic SearXNG instance pool — inspired by searxist (codeberg.org/searxist).
 *
 * The pool is built from three layers:
 *
 *   1. CUSTOM    — user-added instances (self-hosted or trusted), highest priority
 *   2. DISCOVERED — live public instances from searx.space, privacy-filtered.
 *                  ON BY DEFAULT: the top few (MAX_ACTIVE_DISCOVERED) are
 *                  auto-activated — language-aware when a result language
 *                  filter is set — and the rest sit on standby in Settings.
 *   3. SEEDS     — hardcoded bootstrap list. Runs only before the first
 *                  successful discovery fetch (cold start) or when the user
 *                  turns discovery off.
 *
 * The pool is self-healing: per-instance health stats are tracked in
 * localStorage. Instances that fail get demoted; ones that respond fast
 * get promoted. When a language-filtered search succeeds on an instance,
 * that language competence is recorded (`health.langs`) so later filtered
 * searches prefer proven instances. Everything runs client-side — no
 * backend, no tracking.
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

/**
 * Hardcoded bootstrap instances — they run only until the first discovery
 * fetch lands (cold start) or when the user turns discovery off. Once the
 * live pool exists, these retire from the active set.
 */
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
const LS_EXTRAS = '0xsearchstr:searxng:extras';
const LS_DISCOVERY_ON = '0xsearchstr:searxng:discovery';

/** How long discovered instances stay fresh (24h). */
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

/** Max discovered instances to keep in the cache. */
const MAX_DISCOVERED = 24;

/**
 * How many discovered instances are auto-activated (the "picks 3-5 from the
 * list" rule — 4 active + the provider's failover covers the rest of the
 * race). Beyond this, discovered instances sit on standby in Settings until
 * the user force-enables them.
 */
export const MAX_ACTIVE_DISCOVERED = 4;

/** Instance health record. */
export interface InstanceHealth {
  /** Consecutive successes. */
  ok: number;
  /** Consecutive failures. */
  fail: number;
  /** Last successful response timestamp (ms). */
  lastOk?: number;
  /** Last failure timestamp (ms) — drives the failure cooldown. */
  lastFail?: number;
  /** Last observed latency (ms). */
  latencyMs?: number;
  /**
   * Exponential moving average of result counts per successful query.
   * An instance returning 20 results is strictly more useful than one
   * returning 2 — quality, not just speed, drives pool ranking.
   */
  avgResults?: number;
  /**
   * Language competences PROVEN by real searches: when a language-filtered
   * search succeeds on this instance, the filtered codes are merged in here.
   * Absence of a code means "not proven yet", not "unsupported" — unproven
   * instances still run; proven ones just rank first on filtered searches.
   */
  langs?: string[];
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
  /**
   * True when this discovered instance is beyond the auto-activated cap and
   * the user hasn't force-enabled it — it shows in Settings but doesn't run.
   */
  standby?: boolean;
  /** Language codes this instance has proven it can serve (from health). */
  langs?: string[];
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
/* Disabled / extra instances (one-click off/on, any origin)            */
/* ------------------------------------------------------------------ */

export function getDisabledInstances(): string[] {
  return readJson<string[]>(LS_DISABLED) ?? [];
}

export function isInstanceDisabled(url: string): boolean {
  return getDisabledInstances().includes(url);
}

/** Discovered instances the user force-enabled beyond the auto-pick cap. */
export function getExtraInstances(): string[] {
  return readJson<string[]>(LS_EXTRAS) ?? [];
}

/** The computed state of a pool instance. */
export type InstanceState = 'active' | 'standby' | 'disabled';

export function instanceState(inst: PoolInstance): InstanceState {
  if (inst.disabled) return 'disabled';
  if (inst.standby) return 'standby';
  return 'active';
}

/**
 * One-click flip for the Settings power button. The pool's computed state
 * decides the direction:
 *   active   → disabled   (explicitly off)
 *   standby  → active     (force-enabled beyond the auto-pick cap)
 *   disabled → natural    (back to whatever the cap logic says)
 * Returns the new state.
 */
export function toggleInstanceState(inst: PoolInstance): InstanceState {
  const state = instanceState(inst);
  const disabled = new Set(getDisabledInstances());
  const extras = new Set(getExtraInstances());

  if (state === 'active') {
    disabled.add(inst.url);
    extras.delete(inst.url);
  } else if (state === 'standby') {
    extras.add(inst.url);
    disabled.delete(inst.url);
  } else {
    disabled.delete(inst.url);
  }

  writeJson(LS_DISABLED, [...disabled]);
  writeJson(LS_EXTRAS, [...extras]);

  if (state === 'active') return 'disabled';
  if (state === 'standby') return 'active';
  // Un-disabled: the cap logic decides whether it's active or back on
  // standby — recompute the pool for the honest answer.
  const fresh = getInstancePool().find((p) => p.url === inst.url);
  return fresh ? instanceState(fresh) : 'active';
}

/* ------------------------------------------------------------------ */
/* Health tracking (adaptive, per-browser)                             */
/* ------------------------------------------------------------------ */

type HealthMap = Record<string, InstanceHealth>;

export function getHealthMap(): HealthMap {
  return readJson<HealthMap>(LS_HEALTH) ?? {};
}

export function recordInstanceSuccess(
  url: string,
  latencyMs: number,
  resultCount?: number,
  /** Language codes this search proved the instance can serve. */
  languages?: string[],
): void {
  const map = getHealthMap();
  const h: InstanceHealth = map[url] ?? { ok: 0, fail: 0 };

  // EMA of result counts (alpha = 0.4) — recent quality weighs most.
  let avgResults = h.avgResults;
  if (resultCount !== undefined) {
    avgResults = avgResults === undefined
      ? resultCount
      : avgResults * 0.6 + resultCount * 0.4;
  }

  // Merge proven language competence (cap the list so a hostile/buggy
  // filter set can't grow localStorage unbounded).
  let langs = h.langs;
  if (languages && languages.length > 0) {
    langs = [...new Set([...(langs ?? []), ...languages])].slice(0, 12);
  }

  map[url] = { ok: h.ok + 1, fail: 0, lastOk: Date.now(), latencyMs, avgResults, langs };
  writeJson(LS_HEALTH, map);
}

export function recordInstanceFailure(url: string): void {
  const map = getHealthMap();
  const h: InstanceHealth = map[url] ?? { ok: 0, fail: 0 };
  map[url] = { ...h, ok: 0, fail: h.fail + 1, lastFail: Date.now() };
  writeJson(LS_HEALTH, map);
}

/** Consecutive failures before the cooldown kicks in. */
const COOLDOWN_FAILS = 3;
/** How long a failing instance sits out (10 min) before retry. */
const COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Failure cooldown: an instance that has failed COOLDOWN_FAILS times in a
 * row sits out searches for COOLDOWN_MS instead of being hammered on every
 * query (public instances are community resources). After the window it
 * re-enters the pool and health re-proves it.
 */
export function isCoolingDown(h: InstanceHealth | undefined): boolean {
  return !!h && h.fail >= COOLDOWN_FAILS && !!h.lastFail && Date.now() - h.lastFail < COOLDOWN_MS;
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
/* Discovery opt-out (ON by default)                                    */
/* ------------------------------------------------------------------ */

/**
 * Whether live discovery from searx.space is enabled. ON by default: the
 * live pool replaces the hardcoded seeds as the active set — only an
 * explicit opt-out (Settings → SearXNG) restores the seeds-only behavior.
 * No searx.space request is ever made while disabled.
 */
export function isDiscoveryEnabled(): boolean {
  return readJson<boolean>(LS_DISCOVERY_ON) !== false;
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
 * No-op while discovery is disabled (opt-out) — never touches the network.
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
 * Language-competence rank for sorting discovered instances when a result
 * language filter is set (lower = earlier). An instance proves a language
 * by succeeding on a real filtered search; unproven isn't "unsupported".
 */
function languageRank(langs: string[] | undefined, filter: string[]): number {
  if (filter.length === 0) return 0;
  if (!langs || langs.length === 0) return 1; // unproven — middle of the pack
  const covered = filter.filter((f) => langs.includes(f)).length;
  if (covered === filter.length) return 0;    // proven full coverage — first
  if (covered > 0) return 0.5;                // partial coverage
  return 2;                                    // proven, but only other languages
}

/**
 * Build the current instance pool, ranked:
 *   1. Custom instances (user's own — always first, always all)
 *   2. Discovered instances (searx.space; on by default) — the top
 *      MAX_ACTIVE_DISCOVERED are auto-activated (language-aware when a
 *      filter is set, then health-sorted), the rest sit on standby.
 *      Force-enables (Settings power button) join the active set.
 *   3. Seed instances — ONLY as the cold-start bootstrap (no discovered
 *      cache yet) or when discovery is turned off.
 *
 * Instances with repeated recent failures sink within their tier but are
 * never removed — they may come back.
 *
 * @param filterLanguages  Active result language filter (ISO 639-1). Only
 *                         affects discovered-tier ordering.
 */
export function getInstancePool(filterLanguages: string[] = []): PoolInstance[] {
  const health = getHealthMap();
  const disabled = new Set(getDisabledInstances());
  const extras = new Set(getExtraInstances());
  const seen = new Set<string>();
  const pool: PoolInstance[] = [];

  const push = (url: string, origin: InstanceOrigin, standby = false) => {
    if (seen.has(url)) return;
    seen.add(url);
    pool.push({
      url,
      origin,
      health: health[url],
      disabled: disabled.has(url),
      standby,
      langs: health[url]?.langs,
    });
  };

  // Tier 1: custom.
  for (const url of getCustomInstances()) push(url, 'custom');

  const discoveredCache = getDiscoveredCache()?.urls ?? [];
  const discoveryOn = isDiscoveryEnabled();

  // Tier 2: discovered — language-aware (filter on) then health-sorted.
  if (discoveryOn && discoveredCache.length > 0) {
    const ranked = discoveredCache
      .slice()
      .sort((a, b) =>
        languageRank(health[a]?.langs, filterLanguages) - languageRank(health[b]?.langs, filterLanguages)
        || healthPenalty(health[a]) - healthPenalty(health[b]),
      );

    // Auto-activate the top N; force-enabled extras join them no matter
    // where they rank. Everything else sits on standby (visible in
    // Settings, one click to activate). Instances in failure cooldown sit
    // out too — hammering a dead public instance on every search is how a
    // client becomes the DoS. A user's force-enable beats the cooldown
    // (explicit choice wins over automation).
    const activeCount = Math.min(MAX_ACTIVE_DISCOVERED, ranked.length);
    const autoActive = new Set(ranked.slice(0, activeCount));
    for (const url of ranked) {
      const forced = extras.has(url);
      const isActive = forced || (autoActive.has(url) && !isCoolingDown(health[url]));
      push(url, 'discovered', !isActive);
    }
  }

  // Tier 3: seeds — the bootstrap. They run when discovery is off, or when
  // no discovery fetch has ever succeeded (cold start / offline). Once the
  // live pool exists, seeds retire from the active set entirely.
  if (!discoveryOn || discoveredCache.length === 0) {
    const seeds = SEED_INSTANCES
      .slice()
      .sort((a, b) => healthPenalty(health[a]) - healthPenalty(health[b]));
    // Same cooldown rule as discovered — a dead seed sits out unless the
    // user force-enabled it.
    for (const url of seeds) {
      push(url, 'seed', isCoolingDown(health[url]) && !extras.has(url));
    }
  }

  return pool;
}

/** Convenience: just the ACTIVE instance URLs, in pool order (used by the provider). */
export function getInstanceUrls(filterLanguages?: string[]): string[] {
  return getInstancePool(filterLanguages)
    .filter((p) => !p.disabled && !p.standby)
    .map((p) => p.url);
}

# SIP-01 Implementation Guide

How to publish to, consume, or relay the shared search index. Everything here is
normative where it restates [the specification](../public/spec/SIP-01.md) — when in
doubt, the spec wins. Section numbers (`§n`) refer to the spec.

> **Rule zero:** byte-compatibility. If your URL normalization or hashing drifts by
> a single character, your observations stop deduplicating against everyone else's.
> Run your implementation against the §13 test vectors before anything else.

---

## 0. The 60-second architecture

```
 CRAWLERS                RELAYS                   ENGINES
 (Crwalstr,              (UNCAGED Index Relay,    (0xSearchstr,
  autosigners,            any stock Nostr relay)   0xPresearchstr,
  your bot)                                        your fork)
     │                        │                        │
     │  signed kind 39697     │  validate at ingest    │
     │ ─────────────────────▶ │  index to fields       │
     │                        │ ◀───── NIP-01 filters / NIP-50 search
     │                        │                        │  group by d
     │  NIP-77 negentropy     │                        │  count distinct pubkeys
     │        relay ◀──────▶ relay                    │  rank locally
```

- **Publishers** only publish signed events. They never talk to a search backend.
- **Relays** store and (optionally) validate + index + answer search operators.
- **Engines** read, validate, group, and rank however they want.

Trust model: signatures prove authorship, not accuracy. Agreement between
*independent* indexers (same `d`, many pubkeys, same `x`) is the signal.

---

## 1. Publishing (crawlers)

### 1.1 Indexer identity (§14)

- Generate a keypair **locally** (e.g. `generateSecretKey()` from nostr-tools),
  persist it locally (`localStorage`, a secrets manager, an env var). Never upload it.
- **Never** sign observations with a user's personal key. Per-device pseudonymous
  keys are the point: the `pubkey` is the indexer identity.
- Rotating the key starts a new indexer. Old observations stay valid under the old key.

### 1.2 Build the event

The whole algorithm (lift `src/lib/sip01-utils.ts` from this repo — it's the
byte-compatible browser port of every shipping implementation):

```ts
import {
  normalizeIndexUrl, documentId, contentHash,
  SIP01_KIND, SIP01_SCHEMA_VERSION,
} from './sip01-utils';

const normalized = normalizeIndexUrl(rawUrl);       // §7 — null if not http(s)
if (!normalized) return;

const title = pageTitle.trim().slice(0, 300);       // §5 hard cap
if (!title) return;

const description = (pageDescription ?? '').trim().slice(0, 1000);
const d = await documentId(normalized);             // §3
const x = await contentHash(title, description);    // §8

const event = await signer.signEvent({
  kind: SIP01_KIND,                                 // 39697
  content: JSON.stringify({ title, ...(description && { description }) }),
  tags: [
    ['d', d],
    ['u', normalized],                              // ≤ 2048 chars (§5)
    ['x', x],
    ['v', SIP01_SCHEMA_VERSION],                    // "1"
    ['alt', `Web index observation: ${title}`],     // ≤ 1000 chars (§5)
    // optional: ['t', topic] × ≤ 8, ['l', 'en'], ['published', unix],
    //           ['source', 'mycrawler/1'], extension tags (§9)…
  ],
  created_at: Math.floor(Date.now() / 1000),
});
```

### 1.3 Publish

- Publish to **2+ relays**, including at least one SIP-01-aware index relay.
- Re-crawling the same URL? Publish again with the same `d` — the addressable slot
  replaces your previous observation (§2). Don't delete first.

### 1.4 Publisher checklist

| Check | Why |
|---|---|
| `normalizeIndexUrl` passes all §13.1 vectors | dedup breaks otherwise |
| `x` recomputed from the *truncated* title/description you actually publish | relay verifies `x` against content |
| `u` ≤ 2048 chars | relays reject longer |
| topics lowercase, `^[a-z0-9][a-z0-9-]{0,99}$`, ≤ 8 | relays reject otherwise |
| `image` https-only | relays reject http images |
| SSRF protections on any server-side fetch (§11) | no RFC-1918/loopback/metadata targets |

---

## 2. Consuming (search nodes & engines)

### 2.1 Read

```ts
// Baseline — works on every stock NIP-01 relay:
const events = await nostr.query([
  { kinds: [39697], '#t': ['privacy'], limit: 100 },
]);

// SIP-01-aware relays additionally understand NIP-50 operators:
// { kinds: [39697], search: 'bitcoin site:github.com lang:en after:2026-01-01' }
```

Query 2+ relays and merge by event `id`. Baseline filterable tags: `#d`, `#t`,
`#u`, `#x`, `#v`, `#l` (single-letter = relay-indexed per NIP-01), plus `authors`,
`since`/`until` on observation time. Where a relay supports NIP-45, a `COUNT`
request gives cheap totals (e.g. observations per `#d`) — but distinct-pubkey
counting stays client-side unless the relay advertises an extension for it.

### 2.2 Validate (§18)

Drop anything that fails — or use `validateSip01Event()` from
`src/lib/sip01-utils.ts`, which mirrors the UNCAGED relay's ingestion rules:

1. exactly one `d`, `u`, `v`, `alt`; `v === '1'`;
2. `u` is http(s) and ≤ 2048 chars;
3. `d === 'widx:' + sha256(normalize(u))[0:32]` — **verify this**;
4. content JSON has a `title` (1–300 trimmed), `description` ≤ 1000;
5. when `x` is present, it equals `sha256(title + '\n' + description)`.

### 2.3 Group and rank

```ts
const byDoc = new Map<string, NostrEvent[]>();
for (const e of events) {
  const d = e.tags.find(([n]) => n === 'd')?.[1];
  if (!d) continue;
  byDoc.set(d, [...(byDoc.get(d) ?? []), e]);
}

for (const [d, observations] of byDoc) {
  const indexers = new Set(observations.map((o) => o.pubkey));
  const agree = new Set(observations.map((o) => o.tags.find(([n]) => n === 'x')?.[1]));
  // indexers.size  → independent-observation count (your core ranking signal)
  // agree.size > 1 → indexers disagree or the page changed (freshness signal)
  // newest created_at → last-observed time
}
```

Ranking is deliberately out of scope (§1). Combine indexer count, agreement,
freshness, your own trust graph of indexer pubkeys, domain reputation — anything.
The protocol carries facts; engines decide.

---

## 3. Relaying

Any stock relay can carry kind 39697 (it's a normal addressable event). To be a
SIP-01 **index relay**, add:

1. **Ingestion validation** — the rule table in §2.2 above, rejected with
   `OK false invalid: <reason>`. Unknown *tags* are ignored (§9.1.3); unknown
   *versions* are rejected (§10).
2. **Structured indexing** — dedicated fields: `url`, `url_host`,
   `url_domain_hierarchy` (host + dotted parents, powers `site:`), `file_ext`,
   `title`, `description`, `language`, `content_hash`, `published_at`,
   `observed_at` (always = `created_at`), `source`, plus lowercased extension
   fields `doc_type`, `platform`, `category`, `network`, uppercased `country`,
   lowercased `content_type`.
3. **NIP-50 operators** mapped onto those fields — the full operator table lives
   on the site's `/query` page (`site:`, `domain:`, `url:`, `inurl:`, `title:`,
   `topic:`, `type:`, `platform:`, `category:`, `network:`, `country:`, `mime:`,
   `filetype:`, `source:`, `lang:`, `before:`, `after:`, `distinct:domain`, each
   with a `-op:` negation). Two precision rules: list `50` in `supported_nips`
   so clients know the search field is live, and note that `domain:` collides
   with NIP-50's own registered extension (author NIP-05 domain) — SIP-01-aware
   relays give it URL-host semantics, and clients are told to prefer `site:`
   when the relay's nature is unknown (spec §15).
4. **NIP-11 advertisement** — an `uncaged_index` block declaring scope, domains,
   languages, document types, and supported filters (spec §15). NIP-11 requires
   clients to ignore fields they don't understand, so the block is always safe.
5. **Federation** — NIP-77 negentropy on `{ "kinds": [39697] }` against peer
   relays. There is no master; sync is how the index replicates.

Reference: [UNCAGED-Index-Relay](https://github.com/NostrDanish/UNCAGED-Index-Relay)
(`src/web-document.ts` is the validator to match).

---

## 4. Extending the protocol

New facet? Don't fork the kind — register a tag:

1. Experiment with `["x-your-facet", "value"]` — everyone ignores it safely.
2. Get one crawler publishing it and one engine consuming it.
3. PR a row into spec §9.2: tag name, value shape, case rule, meaning,
   introducing implementation.

Reserved: single-letter names (relay-filterable; need broad relay awareness) and
the core field semantics (change those only with a `v` bump). Content-body hashes
(simhash, full-HTML SHA-256, …) belong in the hash registry, §9.3.

---

## 5. Test vectors (run these first)

From spec §13 — every value independently reproducible:

| Input | Expected |
|---|---|
| `https://example.com/` | `widx:0f115db062b7c0dd030b16878c99dea5` |
| `HTTPS://WWW.Example.Com:443/page/?b=2&utm_source=x&a=1#top` | normalize → `https://example.com/page?a=1&b=2` → `widx:f68176b3eb966bd682c3c6eadcc5fe44` |
| `https://example.com/page` | `widx:3641c5f2274c5471278ab5bf1df6d185` |
| `https://github.com/NostrDanish/Crwalstr` | `widx:cdfd4df8c01d609fc9cdf943afa80197` (paths stay case-sensitive) |
| `sha256("Example\n")` | `e1762f14d9924e37b32f1c81dfd256410af462f5136415c96877efa8c80345d0` |
| `sha256("Example Page\nA page about examples.")` | `2a5cbdf44513f552fb571d6c6de2ddf16c5452b235cc887980b52898fb38e7c1` |

If your implementation reproduces all six, you're wire-compatible with every
crawler, relay, and engine in the ecosystem.

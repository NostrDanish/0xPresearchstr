# SIP-01 — Search Index Protocol

**Web Index Observations on Nostr**

`draft` `optional` `kind: 39697`

> **Status:** protocol draft, submission candidate. SIP-01 is the shared contract
> between [0xSearchstr](https://github.com/NostrDanish/0xSearchstr),
> [0xPresearchstr](https://github.com/NostrDanish/0xPresearchstr),
> [Crawlstr](https://github.com/NostrDanish/Crwalstr),
> [UNCAGED-ENGINE](https://github.com/NostrDanish/UNCAGED-ENGINE), and the
> [UNCAGED Index Relay](https://github.com/NostrDanish/UNCAGED-Index-Relay).
> It is implemented in production by two independent clients, one crawler, and
> one relay. This revision (v1.1) consolidates the extension-tag registry and
> replaces all placeholder hashes with verifiable test vectors.

**One shared decentralized index. Many independent indexers. Many independent
search nodes. Many independent search engines. No mandatory identity. No single
owner.**

---

## Abstract

SIP-01 defines a stable, interoperable Nostr representation of an **indexed web
document** — a signed observation, by an indexer, of a URL and its lightweight
public metadata. Any crawler can publish observations, any relay can store and
replicate them, any search node can consume them into a local index, and any
search engine can rank and filter them however it wants — without depending on
Google, Bing, a single company, one crawler, one relay, one search engine, or
one signing key.

An event answers exactly one question:

> **"Indexer `pubkey` observed this web document at this time, and here is its
> lightweight metadata."**

## 1. Scope

The protocol describes **what an indexed web document looks like on Nostr** —
nothing else. It does **not** define:

- ranking algorithms (that belongs to search engines);
- moderation/filtering policy (that belongs to search nodes/engines);
- application branding or per-app features;
- user identity or reputation (optional higher layers);
- NIP-50 search syntax (a *query mechanism*, not a document format);
- relay-internal scoring (e.g. crawl/authority/quality/spam scores). Such
  signals are computed locally by relays and engines and are **never**
  published as part of this document format.

## 2. Event kind

| Property | Value |
|---|---|
| Kind | **39697** |
| Name | Web Index Observation |
| Range | Addressable (30000–39999, NIP-01/NIP-33) |
| Registry status | Unused by any registered NIP at time of writing (draft allocation) |

Addressability is deliberate:

- A crawler re-observing a page **updates** its previous observation instead of
  spamming a new immutable event per crawl — relay storage stays bounded: one
  live slot per `(pubkey, d)`.
- **Multiple independent indexers** observing the same URL produce multiple
  events with the **same `d` tag and different pubkeys** — the core of the
  "*N* independent indexers saw this page" model. Consumers group by `d` and
  count distinct authors.
- Trade-off: no built-in observation history. Search nodes that want history
  archive every version they see; relays MAY preserve superseded versions.

### Why not NIP-78 (kind 30078)

NIP-78 is explicitly for applications "that do not care about
interoperability" — the opposite of a shared index. Kind 30078 remains fine
for genuinely app-specific data, but it is not a shared document protocol.

## 3. Document identity

Three distinct identities, kept separate on purpose:

| Identity | Field | Meaning |
|---|---|---|
| URL identity | `d` tag | Stable slot for the **normalized URL** (§7). All indexers observing the same normalized URL produce the same `d`. |
| Canonical URL | `u` tag | The page's preferred URL after canonical/redirect resolution. Defaults to the normalized URL when unknown. |
| Content identity | `x` tag | Hash of the observed metadata (§8). Changes when the page meaningfully changes. |
| Observation | the event itself | One indexer's signed view at `created_at`. |

```
d = "widx:" + sha256_utf8(normalized_url) hex, truncated to 32 chars
```

The `widx:` namespace prefix prevents collisions with other addressable
schemas a reader might encounter.

## 4. Event structure

```json
{
  "kind": 39697,
  "pubkey": "<indexer pubkey, hex>",
  "created_at": 1786250000,
  "content": "{\"title\":\"Example Page\",\"description\":\"A page about examples.\",\"image\":\"https://example.com/og.jpg\"}",
  "tags": [
    ["d", "widx:3641c5f2274c5471278ab5bf1df6d185"],
    ["u", "https://example.com/page"],
    ["t", "nostr"],
    ["t", "privacy"],
    ["l", "en"],
    ["x", "2a5cbdf44513f552fb571d6c6de2ddf16c5452b235cc887980b52898fb38e7c1"],
    ["v", "1"],
    ["published", "1786200000"],
    ["source", "crawlstr/1"],
    ["alt", "Web index observation: Example Page"]
  ],
  "sig": "..."
}
```

Every hash and identifier in this document is real and reproducible — see
§13 (Test vectors). The example above is fully self-consistent: its `d`
matches its `u`, and its `x` matches its `content`.

## 5. Required fields

| Field | Location | Rule |
|---|---|---|
| `d` | tag | Exactly one. `widx:` + 32 lowercase hex chars. MUST equal the SHA-256-derived id of the `u` tag's normalized form (§7). Readers SHOULD verify. |
| `u` | tag | Exactly one. The canonical URL. MUST be a valid `http(s)` URL, ≤ 2048 chars, and pass the URL allowlist (§11). |
| `title` | content JSON | String, 1–300 chars after trim. |
| `v` | tag | Exactly one. Schema version. This document defines `"1"`. |
| `alt` | tag | Exactly one. Human-readable summary (the `alt` tag convention), non-empty, ≤ 1000 chars. See §12.3 for the rationale. |

## 6. Optional fields

| Field | Location | Meaning |
|---|---|---|
| `description` | content JSON | ≤ 1000 chars. Plain text, no markup. |
| `image` | content JSON | `https:` URL to a representative image, ≤ 2048 chars. |
| `t` | tag | 0–8 lowercase topic tags matching `^[a-z0-9][a-z0-9-]{0,99}$` (e.g. `["t","nostr"]`). Relay-filterable — this is how topical engines slice the index without a new kind. |
| `l` | tag | ISO 639-1 language code (follows the NIP-23/NIP-24 `l` convention). Implementations validate the two-letter shape. |
| `x` | tag | Content hash (§8), lowercase 64-char hex SHA-256. |
| `published` | tag | Unix seconds — the page's own claimed publication time, if known. See §12.2 for the naming deviation. |
| `source` | tag | Indexer software identifier, ≤ 100 chars, e.g. `crawlstr/1`. Informational only; the `pubkey` is the real indexer identity. |

Optional fields MUST NOT be required to interpret the event. A consumer that
only understands `d`, `u`, `title`, `v` has a working index entry.

## 7. URL normalization

Before hashing into `d`, URLs MUST be normalized:

1. Parse; reject anything not `http://` or `https://`.
2. Lowercase scheme and host; strip a leading `www.` from the host.
3. Remove default ports (`:80` http, `:443` https).
4. Remove the fragment (`#…`) entirely.
5. Remove known tracking parameters: `utm_source`, `utm_medium`,
   `utm_campaign`, `utm_term`, `utm_content`, `fbclid`, `gclid`, `dclid`,
   `mc_cid`, `mc_eid`, `igshid`, `ref_src`, `spm`, `si`. **All other query
   parameters are preserved** — many are semantically required (`?id=`,
   `?page=`, `?q=`).
6. Sort remaining query parameters alphabetically by key (stable for
   duplicate keys).
7. Remove a trailing `/` from the path (except the bare root `/`).
8. Re-encode: `URL.toString()` after the above (WHATWG URL semantics).

Implementations MUST produce byte-identical `d` tags for the same page or
deduplication breaks. The reference implementation is `normalizeIndexUrl()`
in `src/lib/webIndex.ts` (0xSearchstr / UNCAGED-ENGINE), mirrored
byte-compatibly by Crawlstr and the UNCAGED Index Relay, and covered by
tests. §13 provides test vectors.

## 8. Content identity (`x` tag)

`x` = lowercase hex SHA-256 of the UTF-8 string:

```
title + "\n" + description
```

of the **observed** metadata (before any consumer-side truncation), with an
absent `description` treated as the empty string. It is a cheap agreement
signal: two indexers with the same `d` and same `x` observed the same
content; same `d` different `x` means the page changed or indexers disagree —
both useful to search nodes. It is deliberately **not** a hash of the full
HTML; crawlers may add a full-content hash as an extension tag (§9).

## 9. Extension tag registry

SIP-01 is **modular**: the core schema is fixed, but engines and crawlers
need domain-specific facets (repositories, media types, networks, …) without
forking the protocol. Extensions are additional **optional tags** registered
in this section.

### 9.1 Rules for all extensions

1. Extensions MUST be optional. A consumer that ignores every extension still
   has a fully working index entry.
2. Extensions MUST NOT change the meaning of core fields. Publishers MUST NOT
   change the meaning of an existing field without bumping `v` (§10).
3. Consumers and relays MUST ignore unknown tags (forwards compatibility).
4. **Single-letter tag names are reserved for relay-filterable fields** —
   NIP-01 relays index only single-letter tags. A new single-letter extension
   therefore requires updating this registry and broad relay awareness.
   Multi-letter extensions are engine-level facets: usable on SIP-01-aware
   relays (via NIP-50 operators or local indexing) but not via `#tag` filters
   on stock relays.
5. Extension values SHOULD be keyword-shaped (`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$`)
   unless the registry entry says otherwise, so they map cleanly onto
   keyword index fields.
6. Extensions are registered by adding a row to §9.2 (via specification
   update). Before registration, experimental extensions SHOULD use the
   `x-` name prefix (e.g. `["x-rank-hint", "..."]`) to avoid squatting on
   future registry names.

### 9.2 Registered extensions (v1)

| Tag | Shape | Case | Meaning | Introduced by |
|---|---|---|---|---|
| `type` | keyword | lower | Logical document type: `page`, `article`, `repository`, `video`, `image`, `file`, … | UNCAGED Index Relay |
| `platform` | keyword | lower | Source platform: `github`, `gitlab`, `youtube`, … | UNCAGED Index Relay |
| `category` | keyword | lower | Content category, engine-defined vocabulary | UNCAGED Index Relay |
| `network` | keyword | lower | Network the document lives on: `clearnet`, `tor`, `i2p`, … | UNCAGED Index Relay |
| `country` | `^[a-zA-Z]{2}$` | upper (ISO 3166-1 alpha-2) | Country the document targets or originates from | UNCAGED Index Relay |
| `mime` | MIME type | lower | Document media type, e.g. `application/pdf` | UNCAGED Index Relay |

### 9.3 Hash extensions

`x` (core) hashes the *metadata*. Future hash extensions (full-body HTML
hash, screenshot hash, simhash for near-duplicate detection, …) are
registered here as new tags with their hash algorithm stated explicitly:

| Tag | Status | Meaning |
|---|---|---|
| _(none registered yet)_ | — | Reserved for content-body and perceptual hashes. |

### 9.4 Application-specific data

Application-specific signals (e.g. a staking signal, a vote, a curated
badge) go in **separate events referencing the observation** (by `d` tag or
event coordinate) — never by changing the meaning of core fields.

## 10. Versioning

`v` versions the **schema**, not any application. `v = 1` is this document.
Consumers MUST ignore events with unknown `v` (or attempt best-effort parsing
of the fields they know). Publishers MUST NOT change the meaning of an
existing field without bumping `v`. Relays MAY reject unknown `v` at
ingestion — a relay cannot index what it cannot interpret.

## 11. Security & URL allowlist

- `u` MUST be `http(s)` (`https` preferred; `http` is tolerated but MAY be
  ranked lower). `image` MUST be `https:`. `javascript:`, `data:`, `file:`,
  `vbscript:` etc. MUST be rejected at parse AND build time.
- Consumers MUST sanitize all event-sourced strings before DOM use (framework
  escaping covers text; URLs additionally pass an allowlist sanitizer).
- Field length caps (§5/§6) are hard limits — drop or truncate overlong
  input.
- Server-side crawlers fetching these URLs MUST apply SSRF protections
  (no RFC-1918/loopback/link-local/cloud-metadata targets, redirect limits).
- The protocol carries **no search queries**. An observation event reveals a
  URL + metadata, never who searched for what (§14).

## 12. Deviations and reviewer notes

Decisions that deliberately diverge from existing conventions, stated up
front:

### 12.1 The `x` tag (vs. NIP-94)

NIP-94 defines `x` as the SHA-256 of a **file's binary**. SIP-01 reuses the
tag letter as a **metadata-agreement hash** (`sha256(title + "\n" +
description)`) because the indexed object is a web page observation, not a
file, and the agreement signal — not download integrity — is what search
nodes need. The two never collide in practice (kind 39697 carries no NIP-94
payloads), and the letter choice keeps the tag relay-filterable.

### 12.2 The `published` tag (vs. NIP-23's `published_at`)

NIP-23 uses `published_at`. SIP-01 uses `published` for brevity in a
high-volume index record. Multi-letter tags are not relay-indexed either
way, so this costs no filterability; the relay profile maps it to a
`published_at` index field.

### 12.3 The `alt` tag (NIP-31 status)

NIP-31 is currently marked *unrecommended* in the NIPs repository
("unnecessarily bloated"). SIP-01 keeps a **required** `alt` tag anyway,
treating it as the now-common `alt` *convention* rather than a NIP-31
dependency: kind 39697 events surface in generic clients, relay monitors,
and moderation tools where one line of human-readable context
("Web index observation: Example Page") is worth its bytes. Consumers MUST
NOT rely on `alt` for parsing; it is presentation-only.

### 12.4 Relay-side validation

Relays implementing SIP-01 ingestion (e.g. the UNCAGED Index Relay) reject
invalid observations with an `OK false` `invalid:` message — this is reader
guidance (§15) applied at the door. It does not change the event format:
other relays remain free to store kind 39697 without validation.

## 13. Test vectors

All vectors are reproducible with any SHA-256 implementation.
Normalization inputs are processed per §7.

### 13.1 URL identity (`d`)

| Input URL | Normalized URL | `d` tag |
|---|---|---|
| `https://example.com/` | `https://example.com/` | `widx:0f115db062b7c0dd030b16878c99dea5` |
| `HTTPS://WWW.Example.Com:443/page/?b=2&utm_source=x&a=1#top` | `https://example.com/page?a=1&b=2` | `widx:f68176b3eb966bd682c3c6eadcc5fe44` |
| `https://example.com/page` | `https://example.com/page` | `widx:3641c5f2274c5471278ab5bf1df6d185` |
| `https://github.com/NostrDanish/Crwalstr` | `https://github.com/NostrDanish/Crwalstr` | `widx:cdfd4df8c01d609fc9cdf943afa80197` |

Note vector 2: scheme/host lowercased, `www.` stripped, default port removed,
fragment removed, tracking parameter removed, remaining parameters sorted,
trailing slash removed. Note vector 4: the **path is case-sensitive** — only
scheme and host are lowercased.

### 13.2 Content identity (`x`)

| `title` | `description` | `x` tag |
|---|---|---|
| `Example` | _(absent)_ | `e1762f14d9924e37b32f1c81dfd256410af462f5136415c96877efa8c80345d0` |
| `Example Page` | `A page about examples.` | `2a5cbdf44513f552fb571d6c6de2ddf16c5452b235cc887980b52898fb38e7c1` |

## 14. Indexer identity

Every observation is signed by the indexer's Nostr keypair — the `pubkey` IS
the indexer identity. Requirements:

- Indexer keys are **generated locally, stored locally, never uploaded**.
- Indexer keys are **separate from any personal Nostr identity**. Automatic
  indexing never uses the logged-in user's key.
- Indexer keys are **replaceable**: regenerating creates a new indexer. Old
  events remain signed by the old key and keep their history; reputation
  does not transfer.
- No single central signing key is authoritative. A server-side crawler or
  autosigner is just one more independent indexer among the browsers.

## 15. Relay usage & querying

- Publishers SHOULD publish to 2+ relays. Consumers SHOULD query 2+ and merge
  by event id, grouping by `d`.
- **Baseline (works on every NIP-01 relay):** plain filters on the indexed
  single-letter tags — `{ "kinds": [39697], "#d": ["widx:…"] }`,
  `{ "kinds": [39697], "#t": ["privacy"] }`, plus `authors`, `since`/`until`
  (observation time), and `limit`.
- **Acceleration (optional):** NIP-50 `search` on capable relays. SIP-01-aware
  relays map web-search operators onto the document fields — `site:`,
  `domain:`, `url:`, `inurl:`, `title:`, `topic:`, `type:`, `platform:`,
  `category:`, `network:`, `country:`, `mime:`, `filetype:`, `source:`,
  `lang:`, `before:`, `after:`, `distinct:domain` (each with a negated
  `-op:` form). NIP-50 explicitly sanctions `key:value` extensions and
  requires relays to ignore ones they don't support, so these queries are
  safe to send anywhere.
- SIP-01-aware relays SHOULD advertise their scope in the NIP-11 relay
  information document under a custom field, e.g.:

```json
{
  "uncaged_index": {
    "sip01": true,
    "nip50": true,
    "nip77": true,
    "document_kinds": [39697],
    "scope": "global",
    "domains": ["*"],
    "languages": ["en", "de"],
    "document_types": ["page", "repository"],
    "filters": ["site", "domain", "url", "inurl", "title", "topic", "type",
                "platform", "category", "network", "country", "mime",
                "filetype", "source", "lang", "before", "after",
                "distinct:domain"]
  }
}
```

- **Federation:** NIP-77 negentropy sync works on any filter, so two relays
  can reconcile their SIP-01 indexes efficiently:
  `["NEG-OPEN", "sync", {"kinds": [39697]}, <hex>]`. No relay is the
  permanent global index — if one disappears, the index lives on elsewhere.

## 16. Privacy

- **Searching needs no login, no key, no profile.** Reads are unauthenticated.
- **Auto-indexing publishes document observations, never queries.** The event
  contains a URL and its public metadata — nothing about the user whose
  search surfaced it.
- The auto-indexing identity is pseudonymous: it is not cryptographically
  tied to the user's personal Nostr identity. Network observers may still
  correlate IP/timing; the protocol guarantees key separation, not network
  anonymity.

## 17. Compatibility & migration

Kind 39697 is the canonical document index. Earlier app-specific query caches
(e.g. kind 30078 `d:"0xsearchstr:cache:*"`, written by historical 0xSearchstr
deployments) are frozen legacy data: consumers MAY merge them in by
normalized URL, but new document indexing MUST use kind 39697. There is no
flag day — old data keeps working, new data uses this protocol.

## 18. Search node behavior (guidance)

A search node consuming this protocol SHOULD:

1. Subscribe to kind 39697 across several relays.
2. Verify `d` ↔ normalized `u` consistency and `v` support; drop invalid.
   When `x` is present, verify it against the content.
3. Group by `d`: distinct `pubkey` count = independent observations.
4. Store locally (inverted index), rank locally, filter locally.
5. Use `x` and `created_at` for freshness/agreement signals.
6. Never treat any single indexer, relay, or engine as authoritative.

## 19. Examples

Minimal valid event (only required fields; every value real):

```json
{
  "kind": 39697,
  "content": "{\"title\":\"Example\"}",
  "tags": [
    ["d", "widx:0f115db062b7c0dd030b16878c99dea5"],
    ["u", "https://example.com/"],
    ["v", "1"],
    ["alt", "Web index observation: Example"]
  ]
}
```

Full event: see §4. An event with extension tags (§9):

```json
{
  "kind": 39697,
  "content": "{\"title\":\"Crwalstr — a browser-based web crawler for Nostr\",\"description\":\"A browser-based web crawler that publishes SIP-01 web index observations.\"}",
  "tags": [
    ["d", "widx:cdfd4df8c01d609fc9cdf943afa80197"],
    ["u", "https://github.com/NostrDanish/Crwalstr"],
    ["t", "nostr"],
    ["t", "crawler"],
    ["t", "search"],
    ["l", "en"],
    ["x", "<sha256(title + \"\\n\" + description)>"],
    ["v", "1"],
    ["type", "repository"],
    ["platform", "github"],
    ["network", "clearnet"],
    ["source", "crawlstr/1"],
    ["alt", "Web index observation: Crwalstr — a browser-based web crawler for Nostr"]
  ]
}
```

## 20. References

- NIP-01 (events, addressable kinds, tag indexing), NIP-11 (relay
  information document), NIP-19 (bech32), NIP-31 (`alt` convention),
  NIP-33 (addressable events), NIP-45 (counts), NIP-50 (search capability),
  NIP-77 (negentropy sync), NIP-78 (app data)
- Relay profile: [UNCAGED-Index-Relay `docs/SIP-01.md`](https://github.com/NostrDanish/UNCAGED-Index-Relay/blob/main/docs/SIP-01.md)
- Reference implementations:
  [0xSearchstr](https://github.com/NostrDanish/0xSearchstr) /
  [UNCAGED-ENGINE](https://github.com/NostrDanish/UNCAGED-ENGINE)
  (`src/lib/webIndex.ts`, `src/lib/indexerIdentity.ts`),
  [Crawlstr](https://github.com/NostrDanish/Crwalstr) (`src/crawler/`),
  [UNCAGED Index Relay](https://github.com/NostrDanish/UNCAGED-Index-Relay)
  (`src/web-document.ts`)

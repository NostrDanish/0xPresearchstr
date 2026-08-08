# Search Index Protocol (SIP-01) — Draft v1

> **Status:** project/protocol draft. This is **not** an official NIP. It is the
> shared contract between 0xSearchstr, 0xPresearchstr, and any compatible fork
> or third-party implementation. If the ecosystem adopts it, it may be proposed
> as a NIP.

**One shared decentralized index. Many independent indexers. Many independent
search nodes. Many independent search engines. No mandatory identity. No single
owner.**

---

## 1. Purpose

Define a stable, interoperable Nostr representation of an **indexed web
document** so that:

- any crawler/indexer can publish observations of web pages;
- any relay can store and replicate them;
- any search node can consume them and build a local index;
- any search engine can rank/filter them however it wants;

without depending on Google, Bing, a single company, one crawler, one relay,
one search engine, or one signing key.

## 2. Scope

The protocol describes **what an indexed web document looks like on Nostr** —
nothing else. It does **not** define:

- ranking algorithms (that belongs to search engines);
- moderation/filtering policy (that belongs to search nodes/engines);
- application branding or per-app features;
- user identity or reputation (optional higher layers);
- NIP-50 search syntax (a *query mechanism*, not a document format).

An event answers one question: **"Indexer `pubkey` observed this web document
at this time, and here is its lightweight metadata."**

## 3. Event kind

| Property | Value |
|---|---|
| Kind | **39697** (addressable, 30000–39999 range) |
| Name | Web Index Observation |
| Mutability | Addressable: one live slot per `(pubkey, d)`. Re-indexing the same URL replaces the indexer's previous observation. Historical immutability is intentionally NOT provided by the core event; archivists may keep superseded versions. |

The kind is currently unused by any official NIP (verified against the kind
registry at time of writing). It is a draft allocation for this protocol.

### Why addressable (not regular/immutable)

- A crawler re-observing a page should update, not spam a new immutable event
  every crawl — relay storage stays bounded.
- **Multiple independent indexers** observing the same URL naturally produce
  multiple events with the **same `d` tag and different pubkeys** — this is
  the core of the "7 independent indexers saw this page" model. Search nodes
  group by `d` and count distinct authors.
- Tradeoff: no built-in observation history. Acceptable for v1 — search nodes
  that want history can archive every version they see.

### Why not NIP-78 (kind 30078)

NIP-78 is explicitly for applications "that do not care about
interoperability" — the opposite of a shared index. Kind 30078 remains in use
for the **legacy query cache** during migration (see §15) and for genuinely
app-specific data, but it is not the shared document protocol.

## 4. Document identity

Three distinct identities, kept separate on purpose:

| Identity | Field | Meaning |
|---|---|---|
| URL identity | `d` tag | Stable slot for the **normalized URL** (see §8). All indexers observing the same normalized URL produce the same `d`. |
| Canonical URL | `u` tag | The page's preferred URL after canonical/redirect resolution. Defaults to the normalized URL when unknown. |
| Content identity | `x` tag | Hash of the observed content/metadata (see §9). Changes when the page meaningfully changes. |
| Observation | the event itself | One indexer's signed view at `created_at`. |

`d = "widx:" + lowercase hex of SHA-256(normalized_url), truncated to 32 hex chars`.

The `widx:` namespace prefix prevents collisions with other addressable
schemas a reader might encounter.

## 5. Event structure

```json
{
  "kind": 39697,
  "pubkey": "<indexer pubkey, hex>",
  "created_at": 1754650000,
  "content": "{\"title\":\"Example Page\",\"description\":\"Short description.\",\"image\":\"https://example.com/og.jpg\"}",
  "tags": [
    ["d", "widx:9f86d081884c7d659a2feaa0c55ad015"],
    ["u", "https://example.com/page"],
    ["t", "nostr"],
    ["t", "privacy"],
    ["l", "en"],
    ["x", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["v", "1"],
    ["published", "1754600000"],
    ["alt", "Web index observation: Example Page"]
  ],
  "sig": "..."
}
```

## 6. Required fields

| Field | Location | Rule |
|---|---|---|
| `d` | tag | Exactly one. `widx:` + 32 lowercase hex chars. MUST equal the SHA-256-derived id of the `u` tag's normalized form (§8). Readers SHOULD verify. |
| `u` | tag | Exactly one. The canonical URL. MUST pass the URL allowlist (§12). |
| `title` | content JSON | 1–300 chars after trim. |
| `v` | tag | Exactly one. Schema version. This document defines `"1"`. |
| `alt` | tag | Exactly one (NIP-31-style human description). |

## 7. Optional fields

| Field | Location | Meaning |
|---|---|---|
| `description` | content JSON | ≤ 1000 chars. Plain text, no markup. |
| `image` | content JSON | https URL to a representative image. |
| `t` | tag | 0–8 lowercase topic tags (e.g. `["t","nostr"]`). Relay-filterable — this is how topical engines (Foodstr, DeveloperSearch) slice the index without a new kind. |
| `l` | tag | ISO 639-1 language code (follows NIP-23/24 `l` convention). |
| `x` | tag | Content hash (§9), NIP-94 `x` convention. |
| `published` | tag | Unix seconds — page's own claimed publication time, if known. |
| `source` | tag | Indexer software identifier, e.g. `0xsearchstr-web/1`. Informational only; the `pubkey` is the real indexer identity. |

Optional fields MUST NOT be required to interpret the event. A consumer that
only understands `d`, `u`, `title`, `v` has a working index entry.

Application-specific extensions (e.g. a Presearchstr staking signal) go in
**additional tags or separate events referencing this one** — never by
changing the meaning of core fields.

## 8. URL normalization

Before hashing into `d`, URLs MUST be normalized:

1. Parse; reject anything not `http://` or `https://`.
2. Lowercase scheme and host; strip a leading `www.` from the host.
3. Remove default ports (`:80` http, `:443` https).
4. Remove the fragment (`#…`) entirely.
5. Remove known tracking parameters: `utm_source`, `utm_medium`, `utm_campaign`,
   `utm_term`, `utm_content`, `fbclid`, `gclid`, `dclid`, `mc_cid`, `mc_eid`,
   `igshid`, `ref_src`, `spm`, `si`. **All other query parameters are
   preserved** — many are semantically required (`?id=`, `?page=`, `?q=`).
6. Sort remaining query parameters alphabetically by key.
7. Remove a trailing `/` from the path (except the bare root `/`).
8. Re-encode: `URL.toString()` after the above.

The canonical implementation is `normalizeIndexUrl()` in
`src/lib/webIndex.ts`, covered by tests. Implementations MUST produce
byte-identical `d` tags for the same page or deduplication breaks.

## 9. Content identity (`x` tag)

`x = lowercase hex SHA-256` of the UTF-8 string:

```
title + "\n" + description
```

of the **observed** metadata (before any consumer-side truncation). It is a
cheap agreement signal: two indexers with the same `d` and same `x` observed
the same content; same `d` different `x` means the page changed or indexers
disagree — both useful to search nodes. It is **not** a hash of the full HTML
(crawlers may add a separate extension tag for that).

## 10. Indexer identity

Every observation is signed by the indexer's Nostr keypair — the `pubkey` IS
the indexer identity. Requirements:

- Indexer keys are **generated locally, stored locally, never uploaded**.
- Indexer keys are **separate from any personal Nostr identity**. Automatic
  indexing never uses the logged-in user's key.
- Indexer keys are **replaceable**: regenerating creates a new indexer.
  Old events remain signed by the old key and keep their history; reputation
  does not transfer.
- No single central signing key is authoritative. Server-side autosigners
  (like the 0xSearchstr worker) are just one more independent indexer.

## 11. Versioning

`v` versions the **schema**, not any application. `v = 1` is this document.
Consumers MUST ignore events with unknown `v` (or attempt best-effort parsing
of the fields they know). Publishers MUST NOT change the meaning of an
existing field without bumping `v`.

## 12. Security & URL allowlist

- `u` and `image` MUST be `https://` (or `http://` for `u`, tolerated but
  ranked lower). `javascript:`, `data:`, `file:`, `vbscript:` etc. MUST be
  rejected at parse AND build time.
- Consumers MUST sanitize all event-sourced strings before DOM use (React
  escaping covers text; URLs additionally pass an allowlist sanitizer).
- Field length caps (§6/§7) are hard limits — drop or truncate overlong input.
- Server-side crawlers fetching these URLs MUST apply SSRF protections
  (no RFC-1918/loopback/link-local/cloud-metadata targets, redirect limits).
  This browser-based reference implementation never fetches indexed URLs
  server-side.
- The protocol carries **no search queries**. An observation event reveals a
  URL + metadata, never who searched for what (§14).

## 13. Relay usage

- Publishers SHOULD publish to 2+ relays. Consumers SHOULD query 2+ and merge
  by event id, grouping by `d`.
- Plain Nostr filters work everywhere: `{ kinds:[39697], '#d':[…] }`,
  `{ kinds:[39697], '#t':['recipe'] }`. NIP-50 `search` is an OPTIONAL
  acceleration on capable relays, never a requirement.
- No relay is the permanent global index. If a relay disappears, the index
  lives on elsewhere.

## 14. Privacy

- **Searching needs no login, no key, no profile.** Reads are unauthenticated.
- **Auto-indexing publishes document observations, never queries.** The event
  contains a URL and its public metadata — nothing about the user whose
  search surfaced it.
- The auto-indexing identity is pseudonymous: it is not cryptographically
  tied to the user's personal Nostr identity. Network observers may still
  correlate IP/timing; the protocol guarantees key separation, not network
  anonymity.

## 15. Compatibility & migration

The legacy 0xsearchstr query-cache (kind 30078, `d:"0xsearchstr:cache:*"`) and
community submissions (kind 30078, `t:"0xsearchstr-submit"`) remain valid and
readable. Consumers SHOULD read both the legacy cache and kind 39697, merging
by normalized URL. Publishers SHOULD prefer 39697 for new document data. The
legacy cache schema is frozen; it will not gain new fields. There is no flag
day — old data keeps working.

## 16. Search node behavior (guidance)

A search node consuming this protocol SHOULD:

1. Subscribe to kind 39697 across several relays.
2. Verify `d` ↔ normalized `u` consistency and `v` support; drop invalid.
3. Group by `d`: distinct `pubkey` count = independent observations.
4. Store locally (inverted index), rank locally, filter locally.
5. Use `x` and `created_at` for freshness/agreement signals.
6. Never treat any single indexer, relay, or engine as authoritative.

## 17. Examples

Minimal valid event (only required fields):

```json
{
  "kind": 39697,
  "content": "{\"title\":\"Example\"}",
  "tags": [
    ["d", "widx:3a6eb0790f39ac87c94f3856b2dd2c5d"],
    ["u", "https://example.com/"],
    ["v", "1"],
    ["alt", "Web index observation: Example"]
  ]
}
```

Full event: see §5.

## 18. References

- Legacy schema & federation notes: [../NIP.md](../NIP.md)
- Reference implementation: `src/lib/webIndex.ts`, `src/lib/indexerIdentity.ts`
- NIP-01 (events), NIP-19 (bech32), NIP-33 (addressable events),
  NIP-50 (search capability), NIP-78 (legacy app data)

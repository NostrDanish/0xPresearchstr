# 0xPresearchstr Custom Event Schemas

> **Federation note:** these schemas are the shared **`0xsearchstr` protocol** — originally
> defined by 0xSearchstr, implemented identically by 0xPresearchstr, and open to any fork.
> Same kinds, same d-tag namespaces, same t-tags. The only per-app difference is **which
> key signs auto-index cache events**. Readers trust every known indexer pubkey, so the
> index is one shared pool across all compatible clients.

> **SIP-01 (v1.1):** the shared **web document index** now lives at **kind 39697** — one
> addressable event per URL per indexer, signed by per-device pseudonymous indexing
> identities (no central key, no queries in events). The canonical spec lives at
> [github.com/NostrDanish/SIP-01](https://github.com/NostrDanish/SIP-01) — local copy at
> [docs/SIP-01.md](docs/SIP-01.md), implementation guide at
> [docs/IMPLEMENTATION-GUIDE.md](docs/IMPLEMENTATION-GUIDE.md). The kind 30078 query
> cache below is **legacy but frozen and still read** — there is no flag day.

## Trusted Indexers

Cache events (below) are only read from these author pubkeys:

| App | Pubkey (hex) |
|-----|--------------|
| 0xSearchstr bot | `12ad55ad1fdb918f5314c9e9a5cd135be9b746e6eee15fd871df131a5677d199` |
| 0xPresearchstr built-in autosigner (Cloudflare Worker) | `be7cad9a8e47ab0adfc877a008aea17692c08c49c1a5a6d87ee79ca4370c4289` |
| 0xPresearchstr bot (embedded-key fallback) | `e34726ccb624f4bb6aebabdfd9a41f5e160ca97ba2ea13fad8f8ff29a7f84bca` |

The 0xPresearchstr autosigner is a **Cloudflare Worker** (`worker.ts`, served at
`POST /api/index`): clients POST `{ query, results }`, the Worker validates and strips
the payload down to whitelisted fields (`title`/`url`/`snippet`/`source`/`provider`),
rate-limits by IP and dedupes per query (KV), signs the kind 30078 event with the indexer
key (a Cloudflare secret — never shipped to browsers), and publishes to the index relays
over WebSocket. If the service is unreachable, the app falls back to the legacy embedded
key so the shared index keeps growing.

Running a fork with your own auto-indexing signer? Add your pubkey to
`INDEXER_PUBKEYS` in `src/lib/searchIndex.ts` and your searches feed the same index.

---

## Search Cache (kind 30078) — legacy, frozen

0xPresearchstr uses **kind 30078** (NIP-78 Application-specific Data) to cache search results on Nostr.

> **Migration note (SIP-01):** new document indexing goes to **kind 39697** (see
> [docs/SIP-01.md](docs/SIP-01.md)). This legacy query cache
> is frozen — it will not gain new fields — but remains published and read so older
> clients keep their warm cache. Readers SHOULD merge both, by normalized URL.

### Purpose

Every time a user searches and gets results from external providers (SearXNG, DuckDuckGo, Wikipedia, Hacker News, etc.), the results are published to Nostr as an addressable event. Subsequent searches for the same query read from this cache first — instant results, no external API call.

The cache is **community-driven**: every user's search grows the index. The more people use any compatible client, the smarter every client gets.

### Event Structure

```json
{
  "kind": 30078,
  "pubkey": "<indexer bot pubkey>",
  "content": "<JSON array of cached SearchResult objects>",
  "tags": [
    ["d", "0xsearchstr:cache:<normalized-query>"],
    ["t", "0xsearchstr"],
    ["t", "search-cache"],
    ["query", "<original query text>"],
    ["cached_at", "<unix timestamp>"],
    ["result_count", "<number of cached results>"],
    ["alt", "Community search index cache for: <query>"]
  ]
}
```

### Security

- Only events from **trusted indexer accounts** (see table above) are read.
- Readers always filter by `authors: INDEXER_PUBKEYS` to prevent cache poisoning.
- Events are addressable per indexer — each app's bot holds one cache slot per query; readers take the most recent valid event from any trusted indexer.
- Cache expires after **24 hours** (client-side staleness check).

### Content Schema (SearchResult)

```typescript
interface CachedResult {
  id: string;        // unique key
  title: string;
  url: string;
  snippet: string;
  source: string;    // 'web' | 'wiki' | 'news' | 'code' | 'tor'
  provider: string;  // 'searxng' | 'duckduckgo' | 'wikipedia' | 'hackernews' | etc.
  timestamp?: number;
  author?: string;
  domain?: string;
  thumbnail?: string;
  kind?: string;     // 'Encyclopedia' | 'Story' | 'Question' | '.onion'
  engine?: string;
  tags?: string[];
}
```

### Query Normalization

Queries are normalized before use as d-tags:
1. Lowercased
2. Trimmed
3. Whitespace collapsed to single spaces
4. Punctuation stripped

This means "Bitcoin mining" and "bitcoin  mining!" map to the same cache entry.

---

## Community Index Submissions (kind 30078)

The index is not just a bot cache — any Nostr user can curate it. Community submissions are user-signed **kind 30078** events describing a single link. The community-curation idea was adopted after discovering [Nostra Search](https://github.com/nostrasearch/nostrasearch.github.io) (GPL-3.0) — credit to them for the idea; this is an independent implementation with an improved schema (unique d-tag per URL instead of one shared d-tag per author).

### Event Structure

```json
{
  "kind": 30078,
  "pubkey": "<submitter's pubkey>",
  "content": "<description (shown as the search snippet)>",
  "tags": [
    ["d", "0xsearchstr:submit:<first-24-hex-of-sha256(normalized-url)>"],
    ["t", "0xsearchstr-submit"],
    ["t", "<content-type>"],
    ["t", "<user tag>"] ,
    ["title", "<title>"],
    ["url", "<url>"],
    ["type", "web | torrent | onion | ipfs | video | audio | pdf | other"],
    ["alt", "0xPresearchstr community index submission: <title>"]
  ]
}
```

### Rules

- **Any author may submit** — these are public UGC (like kind 1 notes), so readers do NOT filter by author. Clients MUST validate structure and URL scheme instead.
- **URL allowlist**: `https://`, `http://`, `magnet:?xt=…`, `ipfs://`, `ipns://`. Everything else (including `javascript:`/`data:`) is rejected at parse time.
- **Addressable per user+URL**: the d-tag is derived from the URL hash, so re-submitting the same URL replaces the user's previous entry without colliding with other submitters.
- Onion-type submissions are routed to the Tor source tab and rendered behind a warning interstitial.

### Discovery & Filtering

Relays can't full-text search tags, so readers fetch recent events with `{ kinds: [30078], '#t': ['0xsearchstr-submit'], limit: 150 }` and filter client-side (AND-match of query terms across title, description, tags, and URL).

---

## Keyword Stakes (kind 30078)

Presearch-style keyword staking, Nostr-native. Instead of staking PRE tokens, a user stakes
their **identity**: an addressable event binding a normalized keyword to a URL. When a
search query exactly matches a staked keyword, the stake renders as the top
"Community Stake" placement.

### Event Structure

```json
{
  "kind": 30078,
  "pubkey": "<staker's pubkey>",
  "content": "<pitch (shown as the search snippet), max 280 chars>",
  "tags": [
    ["d", "0xsearchstr:stake:<normalized-keyword>"],
    ["t", "0xsearchstr-stake"],
    ["keyword", "<original keyword text>"],
    ["title", "<display title>"],
    ["url", "<target url>"],
    ["alt", "Keyword stake on \"<keyword>\": <title>"]
  ]
}
```

### Rules

- **Any author may stake** — public UGC, readers do NOT filter by author. Clients MUST validate structure (`d`, `title`, `url` tags required) and apply the same URL allowlist as community submissions.
- **One stake per keyword per pubkey**: the d-tag is `0xsearchstr:stake:<normalized-keyword>`, so re-staking the same keyword atomically replaces the staker's previous entry.
- **Exact-match placement**: stakes only surface when the normalized query equals the normalized keyword. No fuzzy matching — placement is predictable and relay queries stay cheap (a single `#d` filter).
- **Competition**: when multiple pubkeys stake the same keyword, clients rank by recency (newest first) and show at most 3. The schema intentionally leaves room for **zap-weighted ranking** (kind 9735 receipts against the stake event) without a breaking change.

### Query

```json
{ "kinds": [30078], "#d": ["0xsearchstr:stake:<normalized-query>"], "limit": 25 }
```

---

## Nostra Search Interop (read-only)

For ecosystem compatibility, 0xPresearchstr also reads **Nostra Search** index events:

- Filter: `{ kinds: [30078], '#d': ['nostra:index'] }`
- Plaintext events are parsed from `title`/`url`/`subject`/`magnet`/`r` tags.
- `NOSTRA_ENC_V1:` payloads are AES-256-GCM obfuscated JSON. The key is SHA-256 of a **published constant** (`NOSTRA_CENSORSHIP_RESISTANT_SEARCH_KEY_V1`) — it exists to evade relay-level content filtering, not to restrict read access. Format: `NOSTRA_ENC_V1:<base64-iv>:<base64-ciphertext>`, with `RAW` in the iv slot indicating base64-encoded plaintext JSON.
- Nostra entries are rendered with provider attribution `nostra-index` and rank slightly below native 0xsearchstr-protocol submissions.

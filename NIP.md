# 0xSearchstr Custom Event Schemas

## Search Cache (kind 30078)

0xSearchstr uses **kind 30078** (NIP-78 Application-specific Data) to cache search results on Nostr.

### Purpose

Every time a user searches and gets results from external providers (SearXNG, DuckDuckGo, Wikipedia, Hacker News, etc.), the results are published to Nostr as an addressable event. Subsequent searches for the same query read from this cache first — instant results, no external API call.

The cache is **community-driven**: every user's search grows the index. The more people use 0xSearchstr, the smarter it gets.

### Event Structure

```json
{
  "kind": 30078,
  "pubkey": "<0xSearchstr bot pubkey>",
  "content": "<JSON array of cached SearchResult objects>",
  "tags": [
    ["d", "0xsearchstr:cache:<normalized-query>"],
    ["t", "0xsearchstr"],
    ["t", "search-cache"],
    ["query", "<original query text>"],
    ["cached_at", "<unix timestamp>"],
    ["result_count", "<number of cached results>"],
    ["alt", "0xSearchstr cached results for: <query>"]
  ]
}
```

### Security

- Only events from the **0xSearchstr bot account** (`12ad55ad1fdb918f5314c9e9a5cd135be9b746e6eee15fd871df131a5677d199`) are trusted.
- Readers always filter by `authors: [BOT_PUBKEY]` to prevent cache poisoning.
- Events are addressable — newer caches replace older ones for the same query.
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

The index is not just a bot cache — any Nostr user can curate it. Community submissions are user-signed **kind 30078** events describing a single link. Concept inspired by [Nostra Search](https://github.com/nostrasearch/nostrasearch.github.io) (GPL-3.0), with an improved schema (unique d-tag per URL instead of one shared d-tag per author).

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
    ["alt", "0xSearchstr community index submission: <title>"]
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

### Nostra Search Interop (read-only)

For ecosystem compatibility, 0xSearchstr also reads **Nostra Search** index events:

- Filter: `{ kinds: [30078], '#d': ['nostra:index'] }`
- Plaintext events are parsed from `title`/`url`/`subject`/`magnet`/`r` tags.
- `NOSTRA_ENC_V1:` payloads are AES-256-GCM obfuscated JSON. The key is SHA-256 of a **published constant** (`NOSTRA_CENSORSHIP_RESISTANT_SEARCH_KEY_V1`) — it exists to evade relay-level content filtering, not to restrict read access. Format: `NOSTRA_ENC_V1:<base64-iv>:<base64-ciphertext>`, with `RAW` in the iv slot indicating base64-encoded plaintext JSON.
- Nostra entries are rendered with provider attribution `nostra-index` and rank slightly below native 0xSearchstr submissions.

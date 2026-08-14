# Presearchstr Custom Event Schemas

## NIP Support Matrix

Where existing NIPs cover a use case, we use them instead of inventing app-specific
formats. Current support:

| NIP | Name | Kind(s) | Support |
|-----|------|---------|---------|
| NIP-01 | Events & filters | all | ✅ core protocol |
| NIP-19 | bech32 identifiers | — | ✅ `/npub…`, `/note1…`, `/nevent1…`, `/naddr1…` routes |
| NIP-23 | Long-form articles | 30023 | ✅ read (Nostr tab + All) |
| NIP-24 | Extra metadata (`display_name`, `website`, `banner`, `bot`) | 0 | ✅ read (profile pages) |
| NIP-25 | Reactions (votes) | 7 | ✅ read + write — 👍/👎 on results; anonymous via the device indexing identity by default, or the user's npub when toggled |
| NIP-09 | Deletion | 5 | ✅ write (owner retracts moderation labels) |
| NIP-32 | Labeling (`L`/`l`) | —, 1985 | ✅ write (abuse reports self-label with `0xsearchstr.abuse`; owner moderation labels under `0xsearchstr.moderation`) + ✅ read (owner-signed `hidden` labels filter all users' results) |
| NIP-34 | Git collaboration | 30617, 1621, 1618, 1617 | ✅ read — Code tab: repos (link `web`/`clone`), issues, PRs, patches from the read-only ngit/GRASP pool (`GIT_RELAYS`) |
| NIP-35 | Torrents | 2003 | ✅ read — results link the constructed magnet URI |
| NIP-36 | Content warnings | any | ✅ `content-warning` events render collapsed until tapped |
| NIP-50 | Search capability | — | ✅ NIP-50 `search` filters on every Nostr read |
| NIP-54 | Wiki | 30818 | ✅ read (Wiki tab, Wikifreedia interop) |
| NIP-56 | Reporting | 1984 | ✅ write (Policy page abuse reports, with NIP-32 labels) |
| NIP-65 | Relay list metadata | 10002 | ✅ read + write (Settings → Your Relays) |
| NIP-77 | Negentropy sync | — | 📖 documented in SIP-01 §15 (relay-to-relay, nothing client-side) |
| NIP-78 | App-specific data | 30078 | ✅ submissions / stakes / term signals (read + write) · legacy cache (read-only, see below) |
| NIP-92 | Media attachments (`imeta`) | 1 | ✅ read (inline thumbnails in results) |
| NIP-94 | File metadata | 1063 | ✅ read (file results) |
| NIP-B0 | Web bookmarks | 39701 | ✅ read (Community provider — user-curated links) |
| NIP-C0 | Code snippets | 1337 | ✅ read (Code tab, language badges) |
| BUD-03 | Blossom user server list | 10063 | ✅ read + write (uploads) |
| SIP-01 | Search Index Protocol | 39697 | ✅ read + write ([spec](docs/SIP-01.md)) |

Considered and intentionally skipped for now: NIP-5A (nsite hosting — hosting, not
search), NIP-85 (trusted assertions — needs a provider-selection UX; a natural future
fit for indexer reputation and zap-weighted stake ranking), NIP-86 (relay operator API),
NIP-B7 (Blossom URL fallback — uploads already go through Blossom).

---


> **Federation note:** these schemas are the shared **`0xsearchstr` protocol** — originally
> defined by 0xSearchstr, implemented identically by Presearchstr, and open to any fork.
> Same kinds, same d-tag namespaces, same t-tags. The only per-app difference is **which
> key signs legacy cache events** (Presearchstr no longer writes them — SIP-01 only).
> Readers trust every known indexer pubkey, so the index is one shared pool across all
> compatible clients.

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
| Presearchstr legacy cache signer (retired) | `be7cad9a8e47ab0adfc877a008aea17692c08c49c1a5a6d87ee79ca4370c4289` |

Presearchstr no longer publishes kind 30078 cache events — its legacy signing service
is retired and the code removed. The pubkey stays in the trust list so historical
cache entries it signed remain readable until they age out (24h staleness window).
All new indexing is SIP-01 document observations (kind 39697), signed by per-device
identities — no central key, no service, no trust list.

Running a fork with your own auto-indexing signer? Add your pubkey to
`INDEXER_PUBKEYS` in `src/lib/searchIndex.ts` and your searches feed the same index.

---

## Search Cache (kind 30078) — legacy, frozen, read-only here

Presearchstr uses **kind 30078** (NIP-78 Application-specific Data) to cache search results on Nostr.

> **Migration note (SIP-01):** new document indexing goes to **kind 39697** (see
> [docs/SIP-01.md](docs/SIP-01.md)). This legacy query cache
> is frozen — it will not gain new fields — and Presearchstr no longer publishes it
> (its signing service is retired). It remains read so older clients keep their warm
> cache; 0xSearchstr may still write it. Readers SHOULD merge both, by normalized URL.

### Purpose

Historically, every time a user searched and got results from external providers (SearXNG, DuckDuckGo, Wikipedia, Hacker News, etc.), the results were published to Nostr as an addressable event. Subsequent searches for the same query read from this cache first — instant results, no external API call.

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
    ["alt", "Presearchstr community index submission: <title>"]
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

## Trending Term Signals (kind 30078) — k-anonymity

"Trending searches" without a public record of anyone's plaintext query. The legacy
cache carried plaintext queries; this schema replaces it for trending purposes with a
one-way-hash + threshold-reveal design.

### Signal event (hashed, one per device per term)

```json
{
  "kind": 30078,
  "pubkey": "<per-device indexing identity>",
  "content": "",
  "tags": [
    ["d", "0xsearchstr:term:<sha256-hex(normalized-query)>"],
    ["t", "0xsearchstr-term"],
    ["alt", "Hashed search-term signal (k-anonymity trending — no plaintext)"]
  ]
}
```

- **No plaintext anywhere** — a reader sees only that some pseudonymous device hashed
  this term. Addressable per device+term, so re-searching replaces the device's own
  signal and counting distinct pubkeys ≈ counting distinct searchers.
- Signed by the per-device indexing identity, never the user's personal key.
- Only plain-text queries are signaled — NIP-19 identifiers, NIP-05 addresses, URLs,
  and math expressions never leave the device even as a hash.

### Reveal event (only after the threshold)

A term stays hashed until at least **3 distinct devices** have signaled the same hash
(`TRENDING_THRESHOLD = 3`). The device whose search crosses the threshold knows the
plaintext (its user just typed it) and publishes:

```json
{
  "kind": 30078,
  "pubkey": "<the crossing device's indexing identity>",
  "content": "",
  "tags": [
    ["d", "0xsearchstr:term-reveal:<same hash>"],
    ["t", "0xsearchstr-term-reveal"],
    ["term", "<plaintext query>"],
    ["alt", "Public trending term (searched by 3+ independent devices): <query>"]
  ]
}
```

- **Self-verifying**: readers re-hash the normalized plaintext and compare it to the
  d-tag hash before displaying; fake reveals (wrong plaintext attached to a hash) fail
  verification and are dropped.
- **Below the threshold a term exists on relays only as a hash.** Rare or confidential
  queries never appear in plaintext — not in events, not in the trending UI.
- Readers fetch both families in one filter:
  `{ "kinds": [30078], "#t": ["0xsearchstr-term", "0xsearchstr-term-reveal"] }`.

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

For ecosystem compatibility, Presearchstr also reads **Nostra Search** index events:

- Filter: `{ kinds: [30078], '#d': ['nostra:index'] }`
- Plaintext events are parsed from `title`/`url`/`subject`/`magnet`/`r` tags.
- `NOSTRA_ENC_V1:` payloads are AES-256-GCM obfuscated JSON. The key is SHA-256 of a **published constant** (`NOSTRA_CENSORSHIP_RESISTANT_SEARCH_KEY_V1`) — it exists to evade relay-level content filtering, not to restrict read access. Format: `NOSTRA_ENC_V1:<base64-iv>:<base64-ciphertext>`, with `RAW` in the iv slot indicating base64-encoded plaintext JSON.
- Nostra entries are rendered with provider attribution `nostra-index` and rank slightly below native 0xsearchstr-protocol submissions.

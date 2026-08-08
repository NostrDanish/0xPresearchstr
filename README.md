# 0xPresearchstr

**The community-driven search engine.** Nostr first, web when needed. Presearch-style keyword staking, no tokens required. No backend required.

0xPresearchstr is the **community fork of [0xSearchstr](https://github.com/NostrDanish/0xSearchstr.git)**, re-imagined as the Nostr-native version of [Presearch](https://presearch.com): community-owned search with keyword staking — but the stake is your Nostr key, not a token.

[![Edit with Shakespeare](https://shakespeare.diy/badge.svg)](https://shakespeare.diy/clone?url=https%3A%2F%2Fgithub.com%2FNostrDanish%2F0xPresearchstr.git)

---

## One Index, Many Frontends (Federation)

0xPresearchstr and 0xSearchstr share **one search index** on Nostr. Both apps publish the
exact same event schemas — each signed by its own indexer keys:

| App | Indexer pubkey |
|-----|----------------|
| 0xSearchstr | `12ad55ad…77d199` |
| 0xPresearchstr (autosigner service, active) | `be7cad9a…c4289` |
| 0xPresearchstr (retired NIP-46 bunker, still trusted) | `8a13dadf…a6cbf` |
| 0xPresearchstr (legacy fallback) | `e34726cc…f84bca` |

Readers trust **all** keys (`INDEXER_PUBKEYS` in `src/lib/searchIndex.ts`). So:

- **0xSearchstr makes 0xPresearchstr better** — every cache event its users write is an instant hit here.
- **0xPresearchstr makes 0xSearchstr better** — every search here feeds the same shared pool.
- **Your fork makes everyone better** — embed your own signer, add your pubkey to the trust list, join the index.

Same kinds. Same tags. Different signers. One index.

---

## Search Index Protocol (SIP-01) — kind 39697

The shared web index has graduated from app-signed query caches to a real protocol:
**one addressable event per web document, per indexer**. Full spec:
[docs/SEARCH_INDEX_PROTOCOL.md](docs/SEARCH_INDEX_PROTOCOL.md).

```
Your search surfaces "https://example.com/great-page"
       │
       ▼
kind 39697 event — signed by THIS DEVICE's indexing identity
  d = "widx:" + sha256(normalized_url)[0:32]   ← URL identity
  u = canonical URL      x = sha256(title + "\n" + description)
  content = { title, description?, image? }
       │
       ▼
Published to index relays → every compatible client can search it
```

What makes it different from the old cache:

- **Every browser is an indexer** — a dedicated pseudonymous keypair is generated on first
  use (Settings → Indexing), stored locally, never your personal Nostr identity
- **No queries in events** — an observation reveals a URL + public page metadata, never
  who searched what
- **Independent observation counts** — N indexers seeing the same page produce N events
  with the same `d` tag; search nodes group by `d` and rank by agreement + recency
- **Anyone can join** — crawlers, other engines, other apps; the schema is the whole contract

The legacy kind 30078 query cache is **frozen but still written and read** (via the
autosigner worker below), so older clients keep working — no flag day. Automatic indexing
can be toggled in **Settings → Indexing**.

---

## Autosigner Service (Cloudflare Worker)

The built-in auto-indexer signs the legacy query cache via a server-side Worker so the
indexer key never touches a browser. `worker.ts` at the repo root implements:

- `POST /api/index` — validates the payload (whitelists `title`/`url`/`snippet`/`source`/`provider`,
  http/https URLs only), rate-limits by IP and dedupes per query via KV, signs the
  kind 30078 cache event with the bot key, publishes to the index relays over WebSocket,
  and returns which relays confirmed.
- `GET /api/index` — health/info (drives **Settings → Autosigner**).
- `wrangler.jsonc` — Worker config (assets + KV binding).

### Setup

```bash
npm i -g wrangler && wrangler login

# 1. Create the KV namespace, paste the id into wrangler.jsonc
wrangler kv namespace create RATE_LIMIT_KV

# 2. Convert the indexer bot's nsec to hex (one time, locally)
node -e "console.log(Buffer.from(require('nostr-tools/nip19').decode('nsec1…').data).toString('hex'))"

# 3. Store it as a Worker secret
wrangler secret put INDEXER_NSEC_HEX

# 4. Deploy
wrangler deploy
```

Notes:

- The nsec lives **only** as a Cloudflare secret, injected at runtime.
- `ALLOWED_ORIGINS` in `worker.ts` whitelists browser origins that may call the endpoint
  (this site + 0xSearchstr + localhost dev). Update the array if your domains differ.
- Deploying through Shakespeare's Cloudflare provider bundles the worker and static
  assets together — steps 1–3 still apply on the same Cloudflare account.
- **0xSearchstr** runs the same worker — its deployment signs the legacy cache with its
  own key until both fully migrate to SIP-01 document indexing.

---

## How It Works

```
User Search
       │
       ▼
 ┌─────────────── All providers run in parallel ──────────────┐
 │                                                             │
 │  Web Index  Federated  Nostr   Keyword  SearXNG  Wiki  Tor  │
 │  (SIP-01)   Cache      NIP-50  Stakes     │        │    │   │
 │  39697      30078        │        │    DuckDuckGo HN StackOverflow
 │    │           │         │        │        │        │    │  │
 │    ▼           ▼         ▼        ▼        ▼        ▼    ▼  │
 │   SearchResult[] from each provider                         │
 │                                                             │
 └──────────────────────┬──────────────────────────────────────┘
                        │
                   Merge + Deduplicate + Rank
                        │
                        ▼
                   Display Results
                        │
                        ▼
              Auto-index (SIP-01, per-device identity)
              + legacy cache via autosigner worker
                        │
                   Still nothing?
                        │
                        ▼
                Browser Fallback Links
          (DDG, Brave, Presearch, Mojeek, Marginalia)
```

Instead of building another centralized search engine, 0xPresearchstr is a **search aggregator** with a plugin-based provider architecture:

1. **Every source is a provider** — each returns a universal `SearchResult[]`
2. **All providers run in parallel** — results stream in as each completes
3. **Nostr scores highest** — decentralized results are prioritized
4. **Auto-indexing** — every search publishes results back to Nostr as cache events
5. **Never leaves you empty** — fallback links to privacy-respecting search engines

Everything runs in the browser. No backend, no crawler, no tracking.

### Auto-Indexing (Community Cache)

The killer feature: **every search grows the index.**

When you search, results from web providers get published as Nostr events (kind 30078) under the 0xPresearchstr bot account. Next time *anyone* — on this app, on 0xSearchstr, on any compatible fork — searches the same query, results come from Nostr instantly, no external API call needed.

```
Search "best monero wallet"
       │
       ├─→ Check Nostr cache (federated 0xsearchstr index)
       │     └─→ Cache HIT (from ANY indexer)? → instant results
       │
       ├─→ Run all providers in parallel
       │     └─→ Merge + deduplicate + rank
       │
       └─→ Publish results back to Nostr (auto-index, this app's signer)
             └─→ Next user on ANY compatible client gets an instant cache hit
```

### Keyword Staking (Presearch, but Nostr)

Presearch's signature feature, rebuilt for Nostr. Instead of staking PRE tokens on a
keyword, you stake **your identity**:

```
Stake "monero wallet" → your link
       │
       ├─→ Sign kind 30078 event with YOUR Nostr key
       │     d-tag: "0xsearchstr:stake:monero wallet"
       │
       └─→ Anyone searching "monero wallet" — on any compatible client —
           sees your link as the top "Community Stake" placement
```

- **One stake per keyword per npub** — re-staking replaces your previous stake
- **No tokens, no auction** — signatures make stakes attributable and Sybil-aware
- **Fork-portable** — stakes live in the shared `0xsearchstr` namespace, so they show on 0xSearchstr and every compatible client
- Click **"Stake this keyword"** on any results page (or the empty state) to claim a keyword

The ranking between competing stakes is recency-based today; the schema leaves room for
zap-weighted ranking later without a breaking change. See [NIP.md](NIP.md).

---

## Quick Start

```bash
git clone https://github.com/NostrDanish/0xPresearchstr.git
cd 0xPresearchstr
npm install
npm run dev
```

Open `http://localhost:8080` and search.

---

## Provider Architecture

```
src/lib/providers/
├── types.ts          ← SearchResult, SearchProvider interface
├── web-index.ts      ← SIP-01 web document index (kind 39697, reads first!)
├── cached-index.ts   ← Federated Nostr cache (legacy kind 30078, trusts all indexers)
├── nostr.ts          ← NIP-50 relay search
├── community.ts      ← User-curated index submissions + Nostra interop
├── stakes.ts         ← Keyword stakes (Presearch-style top placements)
├── searxng.ts        ← SearXNG meta-search with failover
├── duckduckgo.ts     ← DuckDuckGo HTML scraper
├── wikipedia.ts      ← MediaWiki API
├── hacker-news.ts    ← Algolia HN Search API
├── stackoverflow.ts  ← StackExchange API
├── tor.ts            ← Ahmia.fi .onion search
├── registry.ts       ← Provider catalog
└── index.ts          ← Barrel export
```

### Adding a Provider

1. Create `src/lib/providers/my-provider.ts` implementing `SearchProvider`
2. Import it in `registry.ts` and add to `ALL_PROVIDERS`
3. Done — the orchestrator picks it up automatically

### SearchProvider Interface

```typescript
interface SearchProvider {
  id: string;
  name: string;
  source: SearchSource;
  search(options: SearchOptions): Promise<ProviderSearchResponse>;
}
```

### Live Providers

| Provider | Source | API | Notes |
|----------|--------|-----|-------|
| **Web Index** | SIP-01 kind 39697 | WebSocket | Shared per-document index, any indexer, ranked by independent observations |
| **Cache Index** | Federated Nostr index | WebSocket | Legacy kind 30078 cache from BOTH 0xPresearchstr + 0xSearchstr indexers |
| **Nostr** | NIP-50 relays | WebSocket | relay.nostr.band + relay.ditto.pub + 2 more |
| **Keyword Stakes** | Community stakes | WebSocket | Presearch-style staked keyword placements |
| **Community** | User submissions | WebSocket | Curated links + Nostra Search interop |
| **SearXNG** | Dynamic instance pool | CORS proxy | DDG, Brave, Wikipedia, and dozens more |
| **DuckDuckGo** | HTML scraper | CORS proxy | Direct DDG fallback when SearXNG is slow |
| **Wikipedia** | MediaWiki API | Direct (CORS) | No proxy needed |
| **Hacker News** | Algolia API | Direct (CORS) | Stories with points/comments |
| **Stack Overflow** | StackExchange API | Direct (CORS) | Questions with votes/answers |
| **Tor (Ahmia)** | HTML scraping | CORS proxy | Policy-compliant .onion search |

### Dynamic SearXNG Instance Pool (searxist-style)

Instead of a hardcoded instance list, the SearXNG provider uses a **self-healing dynamic pool** (inspired by [searxist](https://codeberg.org/searxist)):

```
┌── Tier 1: Custom ──────┐   Your self-hosted / trusted instances (always first)
├── Tier 2: Discovered ──┤   Live from searx.space, privacy-filtered:
│                        │     • no analytics  • clearnet  • ≥80% search success
└── Tier 3: Seeds ───────┘   Hardcoded bootstrap fallback
```

- **Auto-discovery** — the pool refreshes from [searx.space](https://searx.space) every 24h, client-side
- **Health tracking** — per-instance success/failure/latency stats in localStorage; failing instances sink, fast ones rise
- **Self-hosting friendly** — add your own instance in Settings and it runs first on every search
- **Zero backend** — discovery, health, and ranking all happen in the browser

### Incremental Results

All providers run in parallel. The UI shows live status:
```
✔ Index (80ms)  ✔ Nostr (124ms)  ✔ Stakes (150ms)  ⏳ SearXNG...
```

Results appear as each provider finishes — no waiting for the slowest one.

---

## Themes

The default **Presearch** theme wears the brand's dodger blue (`#2D8EFF`) on a deep navy
canvas with a cool horizon glow. For fun, the original themes are still in Settings:
Light, Dark, Hacker (terminal green), and System.

---

## Search Tabs

| Tab | Sources |
|-----|---------|
| **All** | All providers merged + ranked (stakes on top) |
| **Nostr** | Profiles, notes, articles, Wikifreedia, files |
| **Web** | Stakes + Community + SearXNG + DuckDuckGo |
| **Wiki** | Wikipedia articles |
| **News** | Hacker News stories |
| **Code** | Stack Overflow questions |
| **Tor** | .onion hidden services via Ahmia |
| **I2P** | Eepsite directory links |

---

## Self-Hosted Backend (Optional)

The `backend/` directory contains a full self-hosted stack for when you want to run your own search infrastructure:

| Service | Description |
|---------|-------------|
| **Meilisearch** | Full-text search index engine |
| **Nostr Crawler** | NIP-01 subscriber indexing kinds 0/1/30023/1063 |
| **Clearnet Crawler** | Polite web crawler (robots.txt, rate-limited) |
| **Tor/I2P Crawler** | Hidden service crawler with content policy enforcement |
| **NIP-50 Relay** | Search relay proxy bridging Meilisearch to Nostr |
| **Abuse API** | REST search API + abuse report management |

```bash
cp .env.example .env   # Edit MEILI_API_KEY + ABUSE_ADMIN_TOKEN
docker compose up -d
```

See the `backend/` directory and [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## Content Policy

The self-hosted backend enforces content policy modeled on [Ahmia](https://ahmia.fi). Hard-blocked categories: CSAM, human trafficking, weapons sales, drug marketplace listings. See the Policy page in the app for details.

---

## Protocol

Everything this app writes to Nostr is documented in [NIP.md](NIP.md):

- **Search cache** (`0xsearchstr:cache:*`) — federated auto-index, kind 30078
- **Community submissions** (`0xsearchstr:submit:*`) — user-curated links, kind 30078
- **Keyword stakes** (`0xsearchstr:stake:*`) — Presearch-style keyword placement, kind 30078
- **Nostra Search interop** (read-only) — including NOSTRA_ENC_V1 payloads

---

## Tech Stack

- **React 19** + TypeScript + Vite
- **TailwindCSS 4** + shadcn/ui
- **Nostrify** — NIP-50 relay search
- **SearXNG** — meta-search fallback
- **Wikipedia** — MediaWiki API
- **Hacker News** — Algolia search
- **TanStack Query** — data fetching + caching

---

## License

MIT

---

*Vibed with [Shakespeare](https://shakespeare.diy)*

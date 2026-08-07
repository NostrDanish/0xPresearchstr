# 0xPresearchstr

**The community-driven search engine.** Nostr first, web when needed. Presearch-style keyword staking, no tokens required. No backend required.

0xPresearchstr is the **community fork of [0xSearchstr](https://github.com/NostrDanish/0xSearchstr.git)**, re-imagined as the Nostr-native version of [Presearch](https://presearch.com): community-owned search with keyword staking — but the stake is your Nostr key, not a token.

[![Edit with Shakespeare](https://shakespeare.diy/badge.svg)](https://shakespeare.diy/clone?url=https%3A%2F%2Fgithub.com%2FNostrDanish%2F0xPresearchstr.git)

---

## One Index, Many Frontends (Federation)

0xPresearchstr and 0xSearchstr share **one search index** on Nostr. Both apps publish the
exact same event schema — kind 30078, the `0xsearchstr` d-tag/t-tag namespace — each signed
by its own auto-indexing bot key:

| App | Indexer pubkey |
|-----|----------------|
| 0xSearchstr | `12ad55ad…77d199` |
| 0xPresearchstr (NIP-46 autosigner) | `8a13dadf…a6cbf` |
| 0xPresearchstr (legacy fallback) | `e34726cc…f84bca` |

The 0xPresearchstr autosigner signs cache events through a **NIP-46 remote signer**
(bunker) — the private key never ships with the app, and the signer can enforce policies
or rotate access without a redeploy. If the bunker is unreachable, a legacy embedded key
keeps the index growing. The connection URI is baked into the deployment, so **every
visitor auto-indexes into the shared cache** — you can watch the live NIP-46 handshake
status under **Settings → Autosigner**.

Readers trust **both** keys (`INDEXER_PUBKEYS` in `src/lib/searchIndex.ts`). So:

- **0xSearchstr makes 0xPresearchstr better** — every cache event its users write is an instant hit here.
- **0xPresearchstr makes 0xSearchstr better** — every search here feeds the same shared pool.
- **Your fork makes everyone better** — embed your own signer, add your pubkey to the trust list, join the index.

Same kinds. Same tags. Different signers. One index.

---

## How It Works

```
User Search
       │
       ▼
 ┌─────────────── All providers run in parallel ──────────────┐
 │                                                             │
 │  Federated   Nostr    Keyword   SearXNG   Wikipedia   Tor   │
 │  Cache       NIP-50   Stakes      │          │         │    │
 │  Index          │       │      DuckDuckGo  HN    StackOverflow
 │       │         │       │          │          │         │   │
 │       ▼         ▼       ▼          ▼          ▼         ▼   │
 │   SearchResult[] from each provider                         │
 │                                                             │
 └──────────────────────┬──────────────────────────────────────┘
                        │
                   Merge + Deduplicate + Rank
                        │
                        ▼
                   Display Results
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
├── cached-index.ts   ← Federated Nostr cache (reads first! trusts both indexers)
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
| **Cache Index** | Federated Nostr index | WebSocket | Reads cache from BOTH 0xPresearchstr + 0xSearchstr indexers |
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

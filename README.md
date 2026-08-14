# Presearchstr

**The community-driven search engine.** Nostr first, web when needed. Presearch-style keyword staking, no tokens required. No backend required.

Presearchstr is the **community fork of [0xSearchstr](https://github.com/NostrDanish/0xSearchstr.git)**, re-imagined as the Nostr-native version of [Presearch](https://presearch.com): community-owned search with keyword staking — but the stake is your Nostr key, not a token.

[![Edit with Shakespeare](https://shakespeare.diy/badge.svg)](https://shakespeare.diy/clone?url=https%3A%2F%2Fgithub.com%2FNostrDanish%2F0xPresearchstr.git)

---

## One Index, Many Frontends (Federation)

Presearchstr and 0xSearchstr share **one search index** on Nostr. Both apps publish the
exact same event schemas — each signed by its own indexer keys:

| App | Legacy cache signer |
|-----|---------------------|
| 0xSearchstr | `12ad55ad…77d199` |
| Presearchstr (retired) | `be7cad9a…c4289` |

Readers trust **all** keys (`INDEXER_PUBKEYS` in `src/lib/searchIndex.ts`). So:

- **0xSearchstr makes Presearchstr better** — every cache event its users write is an instant hit here.
- **Presearchstr makes 0xSearchstr better** — every search here feeds the same shared pool.
- **Your fork makes everyone better** — publish SIP-01 observations (no trust list needed) and you join the index on first search.

Same kinds. Same tags. Different signers. One index.

---

## Search Index Protocol (SIP-01) — kind 39697

The shared web index has graduated from app-signed query caches to a real protocol:
**one addressable event per web document, per indexer**. Canonical spec (v1.1):
**[github.com/NostrDanish/SIP-01](https://github.com/NostrDanish/SIP-01)** — local copy at
[docs/SIP-01.md](docs/SIP-01.md), plus an [implementation guide](docs/IMPLEMENTATION-GUIDE.md)
with test vectors every implementation must reproduce.

We implement the spec byte-compatibly (shared `webIndex.ts` + §13 test vectors),
including the §9.2 extension-tag registry (`type`/`platform`/`category`/`network`/`country`/`mime`)
and `verifyObservation()` integrity checks (d ↔ u, x ↔ content) before results are shown.

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
  use (Settings → Auto Indexer), stored locally, never your personal Nostr identity
- **No queries in events** — an observation reveals a URL + public page metadata, never
  who searched what
- **Independent observation counts** — N indexers seeing the same page produce N events
  with the same `d` tag; search nodes group by `d` and rank by agreement + recency
- **Anyone can join** — crawlers, other engines, other apps; the schema is the whole contract

The legacy kind 30078 query cache is **frozen and read-only here** — this app no longer
publishes it, but historical entries from trusted indexer keys are still read so older
clients keep working — no flag day. Automatic indexing can be toggled in
**Settings → Auto Indexer**.

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
                        │
                   Still nothing?
                        │
                        ▼
                Browser Fallback Links
             (DDG, Brave, Mojeek, Marginalia)
```

Instead of building another centralized search engine, Presearchstr is a **search aggregator** with a plugin-based provider architecture:

1. **Every source is a provider** — each returns a universal `SearchResult[]`
2. **All providers run in parallel** — results stream in as each completes
3. **Nostr scores highest** — decentralized results are prioritized
4. **Auto-indexing** — every search contributes its surfaced pages back to the shared SIP-01 index
5. **Never leaves you empty** — fallback links to privacy-respecting search engines

Everything runs in the browser. No backend, no crawler, no tracking.

### Auto-Indexing (Community Index)

The killer feature: **every search grows the index.**

When you search, the useful pages your results surface get published as SIP-01
document observations (kind 39697) — signed by this device's pseudonymous indexing
identity, never your personal key, never containing your query. Next time *anyone* —
on this app, on 0xSearchstr, on any compatible client — searches for something those
pages answer, results come from Nostr instantly, no external API call needed.

```
Search "best monero wallet"
       │
       ├─→ Read the shared index (SIP-01 docs + legacy cache)
       │     └─→ HIT (pages observed by ANY indexer)? → instant results
       │
       ├─→ Run all providers in parallel
       │     └─→ Merge + deduplicate + rank
       │
       └─→ Contribute surfaced pages back to the index
             ├─→ kind 39697 observations, signed by this device (SIP-01)
             └─→ kind 30078 term signal: sha256(query) only — NEVER plaintext
                   └─→ Next user on ANY compatible client gets an instant hit
```

The legacy query cache (kind 30078, signed by the trusted indexer keys above) is still
read in parallel for backwards compatibility — but SIP-01 is where the index grows.

**Your queries are never published in plaintext.** "Trending searches" are built from
one-way term signals: each device publishes only `sha256(normalized query)` under its
pseudonymous indexing identity. A term's plaintext is revealed by the network only
once **3+ independent devices** searched it (the reveal is self-verifying — readers
re-hash the plaintext and compare). Rare or confidential queries never appear in
plaintext anywhere, and sensitive query classes (NIP-19 ids, NIP-05 addresses, URLs,
math) are never signaled at all. See [NIP.md](NIP.md).

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
cd Presearchstr
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
| **Web Index** | SIP-01 kind 39697 | WebSocket | Shared per-document index, any indexer, ranked by relevance + independent observations |
| **Nostr** | NIP-50 relays | WebSocket | Profiles, notes, articles, wiki (NIP-54), files (NIP-94), torrents (NIP-35), code snippets (NIP-C0) |
| **Keyword Stakes** | Community stakes | WebSocket | Presearch-style staked keyword placements |
| **Community** | User submissions | WebSocket | Curated links + Nostra interop + NIP-B0 web bookmarks |
| **SearXNG** | Default instance pool (+ opt-in discovery) | CORS proxy | DDG, Brave, Wikipedia, and dozens more |
| **DuckDuckGo** | HTML scraper | CORS proxy | Direct DDG fallback when SearXNG is slow |
| **Hacker News** | Algolia API | Direct (CORS) | Stories with points/comments |
| **Git Repos** | ngit/GRASP relays (NIP-34) | WebSocket, read-only | Repos, issues, PRs & patches — pool editable in Settings → Git Relays |
| **Nostr Wiki** | Wiki relays (NIP-54) | WebSocket, read-only | Decentralized wiki articles (Wikifreedia corpus) — pool editable in Settings → Wiki Relays |
| **Cache Index** | Federated Nostr index | WebSocket | Legacy kind 30078 cache — **off by default** (frozen, read-only) |
| **Brave** | Brave Search API | CORS proxy | **Off by default** — BYOK: paste your free-tier key (2k queries/mo) in Settings → Brave |
| **Wikipedia** | MediaWiki API | Direct (CORS) | **Off by default** — enable in Settings → Engines |
| **Stack Overflow** | StackExchange API | Direct (CORS) | **Off by default** — enable in Settings → Engines |
| **Tor (Ahmia)** | HTML scraping | CORS proxy | **Off by default** — policy-compliant .onion search |

### Dynamic SearXNG Instance Pool (searxist-style)

Instead of a hardcoded instance list, the SearXNG provider uses a **self-healing dynamic pool** (inspired by [searxist](https://codeberg.org/searxist)):

```
┌── Tier 1: Custom ──────┐   Your self-hosted / trusted instances (always first)
├── Tier 2: Discovered ──┤   OPT-IN (Settings → SearXNG). Live from searx.space,
│                        │   privacy-filtered: no analytics • clearnet • ≥80% success
└── Tier 3: Default ─────┘   Hardcoded baseline — the active pool from first run
```

- **Discovery is opt-in** — off by default: faster first search, fewer proxy
  round-trips, and no searx.space request until you enable it
- **Auto-discovery** — when enabled, the pool refreshes from [searx.space](https://searx.space) every 24h, client-side
- **Health tracking** — per-instance success/failure/latency stats in localStorage; failing instances sink, fast ones rise
- **One-click control** — enable/disable any instance (custom, discovered, or default) with a click in Settings; remove customs entirely
- **Self-hosting friendly** — add your own instance in Settings and it runs first on every search

Default pool (active from first run): `search.bus-hit.me`, `baresearch.org`,
`search.ononoki.org`, `ooglester.com`, `searxng.site`, `search.mectov.my.id`,
`search.im-in.space`.
- **Zero backend** — discovery, health, and ranking all happen in the browser

### Incremental Results

All providers run in parallel — web engines first (SearXNG, DuckDuckGo, Brave),
then the community index. The UI shows live status:
```
✔ SearXNG (640ms)  ✔ DuckDuckGo (480ms)  ✔ Index (80ms)  ⏳ Brave...
```

Results render **the instant each provider resolves** — no waiting for the
slowest. And **Settings → Search Engines** lets you turn any engine off with a
click (including the index providers) — off engines never run, never see your
query.

### Voting & Reporting

Every result card carries 👍/👎 votes and a report flag:

- **Votes** are NIP-25 reactions (kind 7, `e` tag for events, `r` tag for URLs —
  SIP-01-normalized so the same page tallies together). **Anonymous by default**:
  signed by this device's built-in indexing identity, never your npub. Flip
   "Vote with my npub" in Settings → Auto Indexer to vote attributably (like staking).
- **Reports** are NIP-56 kind 1984 events — from the Policy page or any result
  card's flag — landing in the team's `/admin` inbox for one-click moderation.

### Query Classification

The search bar understands what you typed and routes accordingly:

| Input | What happens |
|-------|--------------|
| `15% of 80` | Calculator instant answer — **no providers run at all** |
| `npub1…` / `note1…` / `naddr1…` | Profile/event instant card — clearnet engines never see it |
| `name@domain.tld` | NIP-05 resolution to a profile card |
| `https://example.com/page` | SIP-01 index lookup ("observed by N indexers") + open-link card — only Nostr-tier providers run |
| anything else | Full provider fan-out, punctuation-insensitive + plural-folding matching |

Provider skipping isn't just speed — it's privacy: a NIP-19 identifier or URL never
leaves for a third-party engine.

---

## Team Console (`/admin`)

A hidden, role-gated dashboard. Not linked in navigation — team members see an
"Admin console" entry in their account dropdown when logged in with a team key.

Roles (resolved live from owner-signed kind 30078 role lists, relay-finder pattern):

| Role | Access |
|------|--------|
| **Owner** | Everything, incl. the Roles tab (add/remove admins & moderators) |
| **Admin** | Stats, Reports, Moderation, Filter test |
| **Moderator** | Stats, Reports, Moderation, Filter test |

- **Stats** — indexed pages, cached queries, stakes, open reports, relay pool sizes
- **Reports** — the NIP-56 abuse inbox (kind 1984, `0xsearchstr.abuse` namespace),
  one-click "hide from results"
- **Moderation** — team-signed NIP-32 labels (kind 1985, `0xsearchstr.moderation`)
  hide URLs/event ids from **every user's** results; un-hiding publishes a NIP-09
  deletion. Clients trust labels from the owner + role-list pubkeys only.
- **Roles** (owner) — add/remove admins and moderators by npub or hex; lists are
  addressable events (`presearchstr:admin-roles` / `presearchstr:mod-roles`)
- **Filter test** — check whether a URL or event id is currently filtered

---

---

## Relay Pools

Four default pools, all **fully user-editable** in Settings — hide any default
(restorable) or add your own:

| Pool | Purpose | Defaults |
|------|---------|----------|
| **Index Relays** | Where the community index lives — SIP-01 observations (kind 39697), legacy query cache, community submissions, and keyword stakes are published to **and** read from these. Every browser running the app is a crawler node; this is its peer list. | `relay-na1.metanomalist.com` (NIP-50 + NIP-77 index relay), `relay.ditto.pub`, `jskitty.cat/nostr`, `search.nos.today`, `relay.primal.net` |
| **Search Relays** | NIP-50 full-text Nostr search (read-only) | `relay.ditto.pub`, `relay-na1.metanomalist.com`, `search.nos.today`, `relay.noswhere.com`, `relay.pocketnostr.com` |
| **Git Relays** | NIP-34 repos/issues/PRs/patches for the Code tab (read-only) | `ngit.danconwaydev.com`, `gitnostr.com`, `relay.ngit.dev`, `indexer.coracle.social`, `index.ngit.dev`, `git.shakespeare.diy` |
| **Wiki Relays** | NIP-54 wiki articles (read-only) — the pool wikistr reads | `relay.wikifreedia.xyz`, `nostr.wine`, `nostr21.com` |

---

## Themes

Two core themes, both Presearch-branded: **Dark** (default) is dodger blue
(`#2D8EFF`) on deep navy with a horizon glow; **Light** is the same blue on clean
white. The retro Hacker theme hides behind a small "hacker mode?" toggle in
Settings → Appearance.

---

## Search Tabs

The tab bar is **fully modular** — Settings → Search Tabs lets every user pick which
tabs show, drag them into their own order, and star the tab a fresh visit starts on.

| Tab | Sources | Default |
|-----|---------|---------|
| **Web** | Web Index (SIP-01) + Stakes + Community + SearXNG + DuckDuckGo + Brave (BYOK) | ✅ visible, **default tab** |
| **Index** | The community index only — SIP-01 observations + legacy cache | ✅ visible |
| **All** | All providers merged + ranked (stakes on top) | ✅ visible |
| **Nostr** | Profiles, notes, articles, Wikifreedia, files | ✅ visible |
| **News** | Hacker News stories | ✅ visible |
| **Wiki** | Nostr wiki articles (NIP-54, wikistr relay pool); Wikipedia engine off until enabled | ✅ visible |
| **Code** | Git repos/issues/PRs (NIP-34 via ngit/GRASP) + NIP-C0 snippets; Stack Overflow off until enabled | ✅ visible |
| **Tor** | .onion hidden services via Ahmia | off — enable in Settings |
| **I2P** | Eepsite directory links | off — enable in Settings |

Deep links (`/?source=tor&q=…`) keep working even for hidden tabs.

Query matching is phrase-aware: client-side providers tokenize punctuation-insensitively,
tolerate stop words ("the best wallet" ≈ "best wallet"), fold plurals ("wallets" matches
"wallet"), and never literal-match NIP-50 operators like `site:` or `lang:`. A gutting
guard keeps multi-word queries honest — when stop-word removal shrinks "how to build" to
one keyword, a document must match a second query word or the full phrase, and a relevance
score (word coverage + phrase/title bonuses) ranks what survives.

The merged result list is then **coverage-ranked**: every result is reweighted by how many
of your words it actually contains — 50% title, 50% body (snippet + domain + tags + full
article text for Nostr-backed results). All four words of "walk in the park" beats three
beats two beats one; loose engine hits with zero word overlap sink to the bottom. Keyword
stakes are exempt (exact-match placement is their contract).

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

Everything this app writes to Nostr is documented in [NIP.md](NIP.md) and the canonical
[SIP-01 spec](https://github.com/NostrDanish/SIP-01) (local: [docs/SIP-01.md](docs/SIP-01.md)):

- **Web document index** (`widx:*`) — SIP-01, kind 39697, per-device indexer identities
- **Search cache** (`0xsearchstr:cache:*`) — federated auto-index, kind 30078 (legacy, frozen)
- **Term signals** (`0xsearchstr:term:*`) — hashed k-anonymity trending, kind 30078 (no plaintext queries)
- **Community submissions** (`0xsearchstr:submit:*`) — user-curated links, kind 30078
- **Keyword stakes** (`0xsearchstr:stake:*`) — Presearch-style keyword placement, kind 30078
- **Nostra Search interop** (read-only) — including NOSTRA_ENC_V1 payloads

We also read/write existing NIPs wherever they fit instead of inventing formats:
wiki articles (NIP-54), torrents (NIP-35), code snippets (NIP-C0), web bookmarks
(NIP-B0), abuse reports (NIP-56, from the Policy page), content warnings (NIP-36),
media attachments (NIP-92), relay lists (NIP-65). Full matrix in [NIP.md](NIP.md).

---

## AI Answers (Optional — BYOK + engine-provided)

An optional **AI Answer layer** sits on top of the search federation — off by
default, fully user-controlled:

```
Search federation (SIP-01 + web engines)
        │
        ▼
  Evidence pack (top results, numbered)
        │
        ▼
  AI synthesizes an answer with [n] citations
        │
        ▼
  Displayed above results — ephemeral, NEVER indexed into SIP-01
```

**Credential precedence (exactly):**

```
User's own key (Settings → AI)   ← always wins; stored only in their browser
        ↓
Engine-provided AI (/api/ai)     ← operator's key, server-side only (worker)
        ↓
Built-in free tier               ← shared rate-limited PPQ key, locked model,
                                   public by design (ships in the bundle)
        ↓
AI unavailable                   ← only for forks that remove the built-in key
```

- **AI works out of the box** — the built-in tier gives every user free
  answers with zero setup (PPQ.ai, `qwen/qwen-2.5-7b-instruct`, locked on this
  tier). Its key is **public and rate-limited by design** — it ships in the
  bundle, and abuse is bounded by the key's own limits. Operators who want a
  *private* key use the engine tier below (it overrides the built-in one).
- **No secret API key ships in this repository** for the engine tier — the
  operator's key lives only in worker env/KV. Forks can empty
  `COMMUNITY_AI_KEY` in `src/lib/aiConfig.ts` to disable the built-in tier.
- **User-provided (BYOK)** — any OpenAI-compatible API:
  [PPQ.ai](https://ppq.ai/invite/949880ca) (pay-per-prompt, Lightning-native),
  OpenRouter, OpenAI, Ollama (local), or a custom endpoint. Provider, endpoint,
  and model unlock the moment a key is pasted; removing the key returns to the
  engine tier. The key never leaves the device except in requests to the
  chosen provider.
- **Engine-provided** — the operator configures provider/model/key in
  **Admin → AI** (or via worker env vars). Users on this tier call the
  same-origin `/api/ai` proxy with **no key** — the worker injects the
  operator's key upstream. The key is never in the frontend bundle,
  localStorage, logs, or any API response (status returns only a masked
  4-char tail for the admin UI). The UI labels the active tier:
  "Using engine-provided AI" vs "Using your own AI provider".
- **Evidence, not vibes** — the model answers ONLY from the supplied results,
  with clickable [n] citations linking back to the actual sources
- **Privacy boundaries hold** — AI runs only on plain-text queries; NIP-19/05,
  URLs, and math keep their deterministic paths. Nostr results are excluded from
  evidence unless you opt in (Settings → AI)

The `AIProvider` interface (`src/lib/ai/`) mirrors the search `SearchProvider`
registry — add a provider in one file and it works.

### Operator setup: engine-provided AI

Requires deploying with the included worker (`worker.ts` — Cloudflare Workers
path, static assets included):

```bash
# 1. The provider key — a server secret, never committed:
wrangler secret put AI_API_KEY

# 2. Non-secret vars live in wrangler.jsonc (OWNER_PUBKEY enables Admin → AI):
#    AI_PROVIDER_ENDPOINT / AI_MODEL / AI_PROVIDER_NAME / AI_ENGINE_ENABLED

# 3. Optional: let the Admin tab manage config at runtime (no redeploys):
wrangler kv namespace create AI_CONFIG_KV
#    …paste the id into the kv_namespaces binding in wrangler.jsonc

wrangler deploy
```

Admin writes are authenticated with a NIP-98-style signed event from
`OWNER_PUBKEY` — no accounts or passwords. Without KV, env vars are the config
(admin tab shows status, edits need a redeploy). Without either, the proxy
reports "not configured" and everything else keeps working.

---

## Tech Stack

- **React 19** + TypeScript + Vite
- **TailwindCSS 4** + shadcn/ui
- **Nostrify** — NIP-50 relay search
- **SearXNG** — meta-search fallback
- **Wikipedia** — MediaWiki API
- **Hacker News** — Algolia search
- **TanStack Query** — data fetching + caching
- **Optional AI** — [PPQ.ai](https://ppq.ai/invite/949880ca) + any OpenAI-compatible API

---

## License

MIT

---

*Vibed with [Shakespeare](https://shakespeare.diy)* · *AI powered by [PPQ.ai](https://ppq.ai/invite/949880ca) (supports the project)*

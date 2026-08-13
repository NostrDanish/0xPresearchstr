# Presearchstr

**The community-driven search engine.** Nostr first, web when needed. Presearch-style keyword staking, no tokens required. No backend required.

Presearchstr is the **community fork of [0xSearchstr](https://github.com/NostrDanish/0xSearchstr.git)**, re-imagined as the Nostr-native version of [Presearch](https://presearch.com): community-owned search with keyword staking — but the stake is your Nostr key, not a token.

[![Edit with Shakespeare](https://shakespeare.diy/badge.svg)](https://shakespeare.diy/clone?url=https%3A%2F%2Fgithub.com%2FNostrDanish%2F0xPresearchstr.git)

---

## One Index, Many Frontends (Federation)

Presearchstr and 0xSearchstr share **one search index** on Nostr. Both apps publish the
exact same event schemas — each signed by its own indexer keys:

| App | Indexer pubkey |
|-----|----------------|
| 0xSearchstr | `12ad55ad…77d199` |
| Presearchstr (built-in autosigner) | `be7cad9a…c4289` |

Readers trust **all** keys (`INDEXER_PUBKEYS` in `src/lib/searchIndex.ts`). So:

- **0xSearchstr makes Presearchstr better** — every cache event its users write is an instant hit here.
- **Presearchstr makes 0xSearchstr better** — every search here feeds the same shared pool.
- **Your fork makes everyone better** — embed your own signer, add your pubkey to the trust list, join the index.

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
- `GET /api/index` — health/info endpoint (service name, derived pubkey, relay set).
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

Instead of building another centralized search engine, Presearchstr is a **search aggregator** with a plugin-based provider architecture:

1. **Every source is a provider** — each returns a universal `SearchResult[]`
2. **All providers run in parallel** — results stream in as each completes
3. **Nostr scores highest** — decentralized results are prioritized
4. **Auto-indexing** — every search contributes its surfaced pages back to the shared SIP-01 index (plus the legacy query cache)
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
             └─→ legacy kind 30078 query cache via the autosigner worker
                   └─→ Next user on ANY compatible client gets an instant hit
```

The legacy query cache (kind 30078, signed by the trusted indexer keys above) still
runs in parallel for backwards compatibility — but SIP-01 is where the index grows.

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
| **Web Index** | SIP-01 kind 39697 | WebSocket | Shared per-document index, any indexer, ranked by independent observations |
| **Cache Index** | Federated Nostr index | WebSocket | Legacy kind 30078 cache from BOTH Presearchstr + 0xSearchstr indexers |
| **Nostr** | NIP-50 relays | WebSocket | Profiles, notes, articles, wiki (NIP-54), files (NIP-94), torrents (NIP-35), code snippets (NIP-C0) |
| **Keyword Stakes** | Community stakes | WebSocket | Presearch-style staked keyword placements |
| **Community** | User submissions | WebSocket | Curated links + Nostra interop + NIP-B0 web bookmarks |
| **SearXNG** | Dynamic instance pool | CORS proxy | DDG, Brave, Wikipedia, and dozens more |
| **DuckDuckGo** | HTML scraper | CORS proxy | Direct DDG fallback when SearXNG is slow |
| **Brave** | Brave Search API | CORS proxy | BYOK — paste your free-tier key (2k queries/mo) in Settings; dormant without one |
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
- **One-click control** — enable/disable any instance (custom, discovered, or seed) with a click in Settings; remove customs entirely
- **Self-hosting friendly** — add your own instance in Settings and it runs first on every search

Default seed pool (active from first run): `search.bus-hit.me`, `baresearch.org`,
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
  "Vote with my npub" in Settings → Indexing to vote attributably (like staking).
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

Two default pools, both **fully user-editable** in Settings — hide any default
(restorable) or add your own:

| Pool | Purpose | Defaults |
|------|---------|----------|
| **Index Relays** | Where the community index lives — SIP-01 observations (kind 39697), legacy query cache, community submissions, and keyword stakes are published to **and** read from these. Every browser running the app is a crawler node; this is its peer list. | `relay-na1.metanomalist.com` (NIP-50 + NIP-77 index relay), `relay.ditto.pub`, `jskitty.cat/nostr`, `acuy3m…znqd.onion` (Tor only), `search.nos.today`, `relay.primal.net`, `nostr.hifish.org` |
| **Search Relays** | NIP-50 full-text Nostr search (read-only) | `relay.nostr.band`, `relay.ditto.pub`, `relay-na1.metanomalist.com`, `search.nos.today`, `relay.noswhere.com` |

The `.onion` index relay only connects for users on Tor (or a local Tor proxy) —
elsewhere it fails fast and is ignored. It keeps the index reachable without
clearnet exit points.

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
| **Web** | Web Index (SIP-01) + legacy cache + Stakes + Community + SearXNG + DuckDuckGo + Brave (BYOK) | ✅ visible, **default tab** |
| **Index** | The community index only — SIP-01 observations + legacy cache | ✅ visible |
| **All** | All providers merged + ranked (stakes on top) | ✅ visible |
| **Nostr** | Profiles, notes, articles, Wikifreedia, files | ✅ visible |
| **Wiki** | Wikipedia articles | ✅ visible |
| **News** | Hacker News stories | ✅ visible |
| **Code** | Stack Overflow + NIP-C0 code snippets | ✅ visible |
| **Tor** | .onion hidden services via Ahmia | off — enable in Settings |
| **I2P** | Eepsite directory links | off — enable in Settings |

Deep links (`/?source=tor&q=…`) keep working even for hidden tabs.

Query matching got smarter too: client-side providers tokenize punctuation-insensitively,
tolerate stop words ("the best wallet" ≈ "best wallet"), fold plurals ("wallets" matches
"wallet"), and never literal-match NIP-50 operators like `site:` or `lang:`.

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
- **Community submissions** (`0xsearchstr:submit:*`) — user-curated links, kind 30078
- **Keyword stakes** (`0xsearchstr:stake:*`) — Presearch-style keyword placement, kind 30078
- **Nostra Search interop** (read-only) — including NOSTRA_ENC_V1 payloads

We also read/write existing NIPs wherever they fit instead of inventing formats:
wiki articles (NIP-54), torrents (NIP-35), code snippets (NIP-C0), web bookmarks
(NIP-B0), abuse reports (NIP-56, from the Policy page), content warnings (NIP-36),
media attachments (NIP-92), relay lists (NIP-65). Full matrix in [NIP.md](NIP.md).

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

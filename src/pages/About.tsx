import { useSeoMeta } from '@unhead/react';
import {
  Search, Zap, Globe, Database, ArrowRight, Lock, Code,
  ExternalLink, BookOpen, Newspaper, Shield, Layers, Gem, Users, FileText,
} from 'lucide-react';

import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

export default function About() {
  useSeoMeta({
    title: 'About - Presearchstr',
    description: 'Learn about Presearchstr — the community-driven, Nostr-native fork of 0xSearchstr with Presearch-style keyword staking. Nostr-first, with SearXNG, Wikipedia, Hacker News, and Tor fallback.',
  });

  return (
    <Layout>
      <div className="container max-w-3xl py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <Search className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">About Presearchstr</h1>
        </div>
        <p className="text-muted-foreground mb-8 leading-relaxed max-w-2xl">
          The <strong>community-driven fork of 0xSearchstr</strong>, inspired by Presearch.
          A decentralized search aggregator built on a <strong>plugin-based provider architecture</strong>.
          Every search source is a standalone provider that returns a universal <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">SearchResult[]</code>.
          The UI merges, deduplicates, and ranks results from all providers — no backend, no crawler, no tracking.
        </p>

        <Separator className="mb-8" />

        {/* Federation */}
        <h2 className="text-xl font-semibold mb-4">One Index, Many Frontends</h2>
        <Card className="mb-8 border-primary/20">
          <CardContent className="py-6">
            <div className="flex items-start gap-3 mb-4">
              <Users className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground leading-relaxed">
                Presearchstr and 0xSearchstr share <strong className="text-foreground">one federated search index</strong>.
                Both publish the SIP-01 web document index
                (<code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">kind 39697</code>, signed by per-device indexing
                identities), and both read the legacy query cache
                (<code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">kind 30078</code>, the <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">0xsearchstr</code> tag
                namespace, signed by trusted indexer keys). Readers merge both, so a page indexed
                on one app is an instant hit on the other.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                <p className="font-medium text-foreground mb-1">0xSearchstr indexer</p>
                <p className="text-xs text-muted-foreground font-mono break-all">12ad55ad…77d199</p>
              </div>
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                <p className="font-medium text-foreground mb-1">Presearchstr legacy signer (retired)</p>
                <p className="text-xs text-muted-foreground font-mono break-all">be7cad9a…c4289</p>
                <p className="text-[11px] text-muted-foreground/70 mt-1">Signed the legacy query cache before SIP-01 — reads still trust its history</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground/70 mt-4 leading-relaxed">
              New indexing needs no trusted key at all: every browser signs SIP-01 observations
              with its own per-device identity (Settings → Auto Indexer). Running your own fork?
              Your users join the same shared index on first search.
            </p>
          </CardContent>
        </Card>

        {/* Keyword staking */}
        <h2 className="text-xl font-semibold mb-4">Keyword Staking — Presearch, but Nostr</h2>
        <Card className="mb-8 border-primary/20">
          <CardContent className="py-6">
            <div className="flex items-start gap-3 mb-4">
              <Gem className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground leading-relaxed">
                Presearch lets advertisers stake PRE tokens on keywords. Here, your{' '}
                <strong className="text-foreground">Nostr identity is the stake</strong>: sign an addressable
                event binding a keyword to your link, and it takes the top placement whenever anyone
                searches that keyword — on every compatible client.
              </p>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {[
                'One stake per keyword per npub — re-staking replaces your previous stake',
                'No tokens, no auction, no pay-to-win — signatures make stakes attributable and Sybil-aware',
                'Stakes are ordinary Nostr events (kind 30078) — censorship-resistant and fork-portable',
                'Search any staked keyword and the community stake shows above organic results',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-primary/60 mt-0.5 shrink-0">+</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Architecture */}
        <h2 className="text-xl font-semibold mb-4">Provider Architecture</h2>
        <Card className="mb-8 border-primary/20">
          <CardContent className="py-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                <Layers className="w-4 h-4 text-primary" />
                <span>All providers run <strong className="text-foreground">in parallel</strong> — results stream in as each provider completes</span>
              </div>
              <Step number={1} icon={<FileText className="w-4 h-4 text-primary" />} title="Web Index Provider (SIP-01)" description="Searches the shared kind 39697 document index — pages observed by independent per-device indexers, ranked by observation count and recency." active />
              <Step number={2} icon={<Database className="w-4 h-4 text-primary" />} title="Cached Index Provider" description="Reads the legacy federated query cache — hits from both Presearchstr and 0xSearchstr indexers are instant." active />
              <Step number={3} icon={<Zap className="w-4 h-4 text-nostr" />} title="Nostr Provider" description="NIP-50 search queries to relay.nostr.band and relay.ditto.pub. Profiles, notes, articles, and files — all with rich rendering." active />
              <Step number={4} icon={<Gem className="w-4 h-4 text-primary" />} title="Keyword Stakes Provider" description="Community-staked keywords — Nostr-native top placements, signed by the staker's own key." active />
              <Step number={5} icon={<Globe className="w-4 h-4 text-clearnet" />} title="SearXNG Provider" description="Meta-search across DuckDuckGo, Brave, Wikipedia, and dozens more via public instances with automatic failover." active />
              <Step number={6} icon={<BookOpen className="w-4 h-4" />} title="Wikipedia Provider" description="Direct MediaWiki API queries. No proxy needed — Wikipedia sets CORS headers." active />
              <Step number={7} icon={<Newspaper className="w-4 h-4" />} title="Hacker News Provider" description="Algolia-powered HN search API. Stories with points, comments, and author attribution." active />
              <Step number={8} icon={<Shield className="w-4 h-4 text-tor" />} title="Tor Provider (Ahmia)" description="Policy-compliant .onion search via Ahmia.fi with warning interstitials before opening hidden services." active />
            </div>
            <div className="mt-6 p-4 rounded-lg bg-muted/50 border border-border/50">
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">Adding a provider:</strong>{' '}
                Create <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">src/lib/providers/my-provider.ts</code>,
                implement <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">SearchProvider</code>,
                and add it to the registry. No core code changes needed.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* How it works */}
        <h2 className="text-xl font-semibold mb-4">Search Flow</h2>
        <Card className="mb-8">
          <CardContent className="py-6">
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span className="px-2 py-1 rounded bg-primary/10 text-primary font-medium">Query</span>
              <ArrowRight className="w-3 h-3" />
              <span className="px-2 py-1 rounded bg-nostr/10 text-nostr font-medium">Nostr</span>
              <span className="text-muted-foreground/30">+</span>
              <span className="px-2 py-1 rounded bg-clearnet/10 text-clearnet font-medium">SearXNG</span>
              <span className="text-muted-foreground/30">+</span>
              <span className="px-2 py-1 rounded bg-muted font-medium">Wiki</span>
              <span className="text-muted-foreground/30">+</span>
              <span className="px-2 py-1 rounded bg-muted font-medium">HN</span>
              <span className="text-muted-foreground/30">+</span>
              <span className="px-2 py-1 rounded bg-tor/10 text-tor font-medium">Tor</span>
              <ArrowRight className="w-3 h-3" />
              <span className="px-2 py-1 rounded bg-primary/10 text-primary font-medium">Merge + Rank</span>
              <ArrowRight className="w-3 h-3" />
              <span className="px-2 py-1 rounded bg-primary/10 text-primary font-medium">Display</span>
            </div>
          </CardContent>
        </Card>

        {/* Why this architecture */}
        <h2 className="text-xl font-semibold mb-4">Why an Aggregator?</h2>
        <Card className="mb-8">
          <CardContent className="py-5">
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                { label: 'No backend required', detail: 'Everything runs in the browser. No servers, no crawlers, no infrastructure to maintain.' },
                { label: 'Nostr-native', detail: 'Nostr results are first-class citizens with rich rendering — avatars, content previews, NIP-19 links.' },
                { label: 'Federated index', detail: 'Shares one search index with 0xSearchstr — same kinds, same tags, different signer keys. Every search on either app helps both communities.' },
                { label: 'Keyword staking', detail: 'Presearch-style keyword placement without tokens. Your Nostr key is the stake — sign once, own the top spot for that keyword everywhere.' },
                { label: 'Privacy as a spectrum', detail: 'Nostr-only searches never touch third-party servers. Web providers expose queries to their operators — see the threat model below and the traffic-light indicator by the search bar.' },
                { label: 'Plugin architecture', detail: 'Every provider is a standalone module. Add Wikipedia, Hacker News, GitHub, Archive.org — one file each, no core changes.' },
                { label: 'Incremental results', detail: 'Providers run in parallel. Results appear as each provider finishes, with live status indicators.' },
                { label: 'Resilient', detail: 'Multiple SearXNG instances with failover. Multiple Nostr relays. Browser fallback links as last resort.' },
              ].map((item) => (
                <li key={item.label} className="flex items-start gap-3">
                  <span className="text-primary font-mono mt-0.5 shrink-0 text-sm">{'>'}</span>
                  <div>
                    <span className="text-foreground font-medium">{item.label}</span>
                    <span className="text-muted-foreground"> — {item.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Search providers detail */}
        <h2 className="text-xl font-semibold mb-4">Search Providers</h2>
        <div className="grid gap-4 mb-8">
          <SourceCard
            icon={<Zap className="w-5 h-5" />}
            title="Nostr (NIP-50)"
            status="active"
            color="text-nostr"
            features={[
              'Direct client-side relay connections — no intermediary',
              'Indexes kinds 0 (profiles), 1 (notes), 30023 (articles), 1063 (files)',
              'Deduplicates across relay.nostr.band + relay.ditto.pub',
              'Results ranked by relay relevance, sorted by recency',
            ]}
          />
          <SourceCard
            icon={<Globe className="w-5 h-5" />}
            title="SearXNG (Meta-Search)"
            status="active"
            color="text-clearnet"
            features={[
              'Aggregates results from DuckDuckGo, Brave, Wikipedia, and more',
              'Dynamic instance pool discovered from searx.space, health-tracked and self-healing',
              'Privacy-preserving — no tracking, no user profiling',
              'Add your own instance in Settings',
            ]}
          />
          <SourceCard
            icon={<BookOpen className="w-5 h-5" />}
            title="Wikipedia"
            status="active"
            color="text-foreground"
            features={[
              'MediaWiki search API — no proxy needed',
              'Encyclopedia entries with article summaries',
              'Timestamps and revision metadata',
            ]}
          />
          <SourceCard
            icon={<Newspaper className="w-5 h-5" />}
            title="Hacker News"
            status="active"
            color="text-foreground"
            features={[
              'Algolia-powered search — stories, points, comments',
              'Author attribution and original source links',
              'No API key required',
            ]}
          />
          <SourceCard
            icon={<Shield className="w-5 h-5" />}
            title="Tor (Ahmia)"
            status="active"
            color="text-tor"
            features={[
              'Policy-compliant .onion search',
              'Warning interstitials before opening hidden services',
              'Fallback links to Torch and Haystak',
            ]}
          />
        </div>

        {/* Tech stack */}
        <h2 className="text-xl font-semibold mb-4">Technology Stack</h2>
        <Card className="mb-8">
          <CardContent className="py-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { name: 'React 19', category: 'Frontend' },
                { name: 'TypeScript', category: 'Language' },
                { name: 'TailwindCSS 4', category: 'Styling' },
                { name: 'Nostrify', category: 'Nostr SDK' },
                { name: 'NIP-50', category: 'Search Protocol' },
                { name: 'SearXNG', category: 'Web Meta-Search' },
                { name: 'TanStack Query', category: 'Data Fetching' },
                { name: 'shadcn/ui', category: 'Components' },
                { name: 'Vite', category: 'Build Tool' },
              ].map((tech) => (
                <div key={tech.name} className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{tech.name}</span>
                  <span className="text-xs text-muted-foreground">{tech.category}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Threat model */}
        <h2 className="text-xl font-semibold mb-4">Threat Model — The Honest Version</h2>
        <Card className="mb-8 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="w-4 h-4" />
              Who Can See Your Searches
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              "No backend" means <strong className="text-foreground">Presearchstr itself</strong> has no servers
              logging you — the app is static files in your browser. It does <em>not</em> mean your queries
              travel nowhere. Here is exactly who sees what:
            </p>

            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                <span className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-medium text-foreground">Nostr providers (green)</span>
                  <p className="text-muted-foreground mt-0.5">
                    Queries go to Nostr search relays over WebSocket. The relay operator sees the query
                    text and your IP address — but no account is linked, since reads are unauthenticated.
                    This is the minimum exposure a decentralized search can have.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <span className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-medium text-foreground">Direct API providers (yellow)</span>
                  <p className="text-muted-foreground mt-0.5">
                    Wikipedia, Hacker News (Algolia), and Stack Exchange are called over HTTPS straight
                    from your browser. Those operators see the query + your IP in standard server logs.
                    No intermediary in between.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-medium text-foreground">Proxied providers (red)</span>
                  <p className="text-muted-foreground mt-0.5">
                    SearXNG instances, DuckDuckGo HTML, and Ahmia are reached through a CORS proxy
                    (browsers block direct calls). The proxy sees every query in plaintext, and so does
                    the destination. This is the weakest link — the traffic-light indicator turns red
                    whenever these providers are active.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">What you can do about it:</h4>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {[
                  'Enable Privacy Mode (Settings) to run Nostr-tier providers only — zero third-party exposure',
                  'Watch the traffic-light indicator next to the search bar before every search',
                  'Add your own SearXNG instance in Settings — self-hosted instances always run first',
                  'Use Tor Browser or a VPN to hide your IP from relays and APIs',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-primary/60 mt-0.5 shrink-0">+</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">What Presearchstr itself never does:</h4>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {[
                  'Log, store, or transmit your searches to its own servers (there are none)',
                  'Track users, fingerprint browsers, or set cookies',
                  'Publish your queries — index events contain page metadata only, signed by a throwaway per-device indexing key',
                  'Run its own crawler or indexing backend',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-destructive/60 mt-0.5 shrink-0">-</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Links */}
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/NostrDanish/0xPresearchstr.git"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 text-sm font-medium transition-colors"
          >
            <Code className="w-4 h-4" />
            Source Code
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
          </a>
          <a
            href="https://shakespeare.diy/clone?url=https%3A%2F%2Fgithub.com%2FNostrDanish%2F0xPresearchstr.git"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 text-sm font-medium text-primary transition-colors"
          >
            Edit with Shakespeare
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </Layout>
  );
}

function Step({ number, icon, title, description, active }: {
  number: number;
  icon: React.ReactNode;
  title: string;
  description: string;
  active?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 text-sm font-bold ${
        active ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted text-muted-foreground'
      }`}>
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {icon}
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function SourceCard({ icon, title, status, color, features }: {
  icon: React.ReactNode;
  title: string;
  status: 'active' | 'optional';
  color: string;
  features: string[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className={color}>{icon}</span>
          {title}
          <Badge
            variant={status === 'active' ? 'default' : 'outline'}
            className={status === 'active' ? 'ml-auto text-[10px]' : 'ml-auto text-[10px] text-muted-foreground'}
          >
            {status === 'active' ? 'Live' : 'Self-Host'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className={`mt-0.5 shrink-0 ${color} opacity-60`}>{'>'}</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

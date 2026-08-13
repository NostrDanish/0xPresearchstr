/**
 * Explore page — browse the community search index.
 *
 * Three kinds of community content live here:
 *   1. Recently indexed pages — SIP-01 document observations (kind 39697),
 *      signed by per-device indexing identities across all compatible clients;
 *   2. Trending searches — hashed term signals (kind 30078): a term's
 *      plaintext only becomes visible once 3+ independent devices searched
 *      it, so nobody's confidential query ever appears here;
 *   3. Staked keywords — Presearch-style community keyword placements.
 * Clicking any query runs it instantly — from Nostr, no external API call needed.
 */
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Compass, Search, TrendingUp, Clock, ArrowRight, Gem, FileText, Users } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useTrendingTerms, type TrendingTerm } from '@/hooks/useTrendingTerms';
import { useRecentStakes, type StakeEntry } from '@/hooks/useRecentStakes';
import { useRecentIndexedDocs, type IndexedDocEntry } from '@/hooks/useRecentIndexedDocs';
import { sanitizeUrl } from '@/lib/sanitizeUrl';

function timeAgo(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Explore() {
  const { data: entries, isLoading } = useTrendingTerms();
  const { data: stakes } = useRecentStakes();
  const { data: docs, isLoading: docsLoading } = useRecentIndexedDocs();

  useSeoMeta({
    title: 'Explore the Index - Presearchstr',
    description: 'Browse trending searches, staked keywords, and recently indexed pages from the shared Nostr web index.',
  });

  return (
    <Layout>
      <div className="container max-w-3xl py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <Compass className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Explore the Index</h1>
        </div>
        <p className="text-muted-foreground mb-8 leading-relaxed max-w-2xl">
          Every search on Presearchstr grows a shared index on Nostr. Recently indexed pages,
          trending searches, and staked keywords — all of it straight from relays,
          signed by the community.
        </p>

        {/* Stats */}
        {((entries && entries.length > 0) || (docs && docs.length > 0)) && (
          <div className="grid grid-cols-2 gap-3 mb-8">
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="py-4 px-5 flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="text-2xl font-bold tracking-tight">{entries?.length ?? 0}</p>
                  <p className="text-xs text-muted-foreground">trending searches</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="py-4 px-5 flex items-center gap-3">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="text-2xl font-bold tracking-tight">{docs?.length ?? 0}</p>
                  <p className="text-xs text-muted-foreground">indexed pages</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Recently indexed pages (Search Index Protocol, kind 39697) */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold mb-1">Recently indexed pages</h2>
          <p className="text-xs text-muted-foreground mb-4">
            The shared web index — each page observed by independent indexers, signed by
            their own keys. No queries, no accounts.
          </p>

          {docsLoading && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="py-4 px-5 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!docsLoading && (!docs || docs.length === 0) && (
            <Card className="border-dashed">
              <CardContent className="py-8 px-8 text-center">
                <FileText className="w-7 h-7 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  No pages indexed yet. Run a search with automatic indexing enabled —
                  the useful pages it surfaces appear here, signed by your device's
                  indexing identity.
                </p>
              </CardContent>
            </Card>
          )}

          {docs && docs.length > 0 && (
            <div className="space-y-3">
              {docs.map((doc) => (
                <DocCard key={doc.url} doc={doc} />
              ))}
            </div>
          )}
        </section>

        {/* Loading */}
        {isLoading && (
          <div className="grid sm:grid-cols-2 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="py-4 px-5 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && (!entries || entries.length === 0) && (
          <Card className="border-dashed">
            <CardContent className="py-12 px-8 text-center">
              <TrendingUp className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-muted-foreground max-w-sm mx-auto">
                Nothing is trending yet. Searches are signaled as one-way hashes —
                a term only becomes visible once at least 3 independent devices
                have searched it, so no one's unique query ever appears here.
              </p>
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 mt-4 text-sm text-primary hover:underline"
              >
                <Search className="w-4 h-4" />
                Run a search
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Trending searches (hashed k-anonymity signals) */}
        {entries && entries.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold mb-1">Trending searches</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Terms searched by 3+ independent devices — published as hashes and only
              revealed once they're clearly public. Clicking one runs it fresh.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {entries.map((entry) => (
                <QueryCard key={entry.query.toLowerCase()} entry={entry} />
              ))}
            </div>
          </section>
        )}

        {/* Recently staked keywords */}
        {stakes && stakes.length > 0 && (
          <>
            <div className="flex items-center gap-2 mt-10 mb-4">
              <Gem className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-semibold tracking-tight">Staked Keywords</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {stakes.slice(0, 10).map((stake) => (
                <StakeCard key={`${stake.staker}:${stake.keyword.toLowerCase()}`} stake={stake} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground/60 mt-3 leading-relaxed">
              Keyword stakes are signed by the staker&apos;s own Nostr key. Search a staked
              keyword and its link takes the top placement.
            </p>
          </>
        )}

        {/* Footnote */}
        <p className="text-xs text-muted-foreground/60 mt-8 leading-relaxed">
          Indexed pages are Search Index Protocol events (kind 39697) — one addressable event
          per URL per indexer, from any compatible client. Trending searches are k-anonymity
          term signals (kind 30078): devices publish only a hash of what they searched, and a
          term's plaintext is revealed by the network only after 3+ independent devices
          searched it. Your rare or confidential queries never leave this browser as text.
        </p>
      </div>
    </Layout>
  );
}

function DocCard({ doc }: { doc: IndexedDocEntry }) {
  const href = sanitizeUrl(doc.url);
  if (!href) return null;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="group block">
      <Card className="h-full hover:border-primary/30 hover:bg-card/80 transition-all duration-200">
        <CardContent className="py-4 px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">
                {doc.title}
              </p>
              <p className="text-[11px] text-muted-foreground/70 font-mono truncate mt-0.5">
                {doc.domain}
              </p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {doc.indexerCount > 1 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                    <Users className="w-2.5 h-2.5" />
                    {doc.indexerCount} indexers
                  </Badge>
                )}
                {doc.topics.slice(0, 3).map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">
                    {t}
                  </Badge>
                ))}
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
                  <Clock className="w-3 h-3" />
                  {timeAgo(doc.observedAt)}
                </span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
          </div>
        </CardContent>
      </Card>
    </a>
  );
}

function StakeCard({ stake }: { stake: StakeEntry }) {
  let domain = stake.url;
  try { domain = new URL(stake.url).hostname.replace(/^www\./, ''); } catch { /* magnet:/ipfs: etc. */ }

  return (
    <Link to={`/?q=${encodeURIComponent(stake.keyword)}`} className="group block">
      <Card className="h-full border-primary/20 bg-primary/[0.03] hover:border-primary/40 hover:bg-primary/[0.06] transition-all duration-200">
        <CardContent className="py-4 px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                {stake.keyword}
              </p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 border-primary/30 text-primary">
                  {domain}
                </Badge>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
                  <Clock className="w-3 h-3" />
                  {timeAgo(stake.stakedAt)}
                </span>
              </div>
            </div>
            <Gem className="w-4 h-4 text-primary/40 group-hover:text-primary transition-colors shrink-0 mt-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function QueryCard({ entry }: { entry: TrendingTerm }) {
  return (
    <Link to={`/?q=${encodeURIComponent(entry.query)}`} className="group block">
      <Card className="h-full hover:border-primary/30 hover:bg-card/80 transition-all duration-200">
        <CardContent className="py-4 px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                {entry.query}
              </p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                  <Users className="w-2.5 h-2.5" />
                  {entry.searchers} searchers
                </Badge>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
                  <Clock className="w-3 h-3" />
                  {timeAgo(entry.lastSearchedAt)}
                </span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

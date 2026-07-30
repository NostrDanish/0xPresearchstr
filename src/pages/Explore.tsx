/**
 * Explore page — browse the community search index.
 *
 * Every search anyone runs on 0xSearchstr gets cached to Nostr (kind 30078)
 * under the bot account. This page surfaces that cache as discoverable
 * content: trending queries, recent additions, result counts. Clicking any
 * query runs it instantly — from Nostr, no external API call needed.
 */
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Compass, Database, Search, TrendingUp, Clock, ArrowRight } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCachedQueries, type CachedQueryEntry } from '@/hooks/useCachedQueries';

function timeAgo(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Explore() {
  const { data: entries, isLoading } = useCachedQueries();

  useSeoMeta({
    title: 'Explore the Index - 0xSearchstr',
    description: 'Browse trending queries from the 0xSearchstr community search index, cached on Nostr.',
  });

  const totalCachedResults = entries?.reduce((sum, e) => sum + e.resultCount, 0) ?? 0;

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
          Every search on 0xSearchstr grows a shared index on Nostr. These are the queries
          the community has cached — clicking any of them loads results instantly, straight
          from relays.
        </p>

        {/* Stats */}
        {entries && entries.length > 0 && (
          <div className="grid grid-cols-2 gap-3 mb-8">
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="py-4 px-5 flex items-center gap-3">
                <Database className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="text-2xl font-bold tracking-tight">{entries.length}</p>
                  <p className="text-xs text-muted-foreground">cached queries</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="py-4 px-5 flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="text-2xl font-bold tracking-tight">{totalCachedResults.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">indexed results</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

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
              <Database className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-muted-foreground max-w-sm mx-auto">
                The index is quiet right now. Run a search — it gets cached to Nostr
                and appears here for everyone.
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

        {/* Query grid */}
        {entries && entries.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-3">
            {entries.map((entry) => (
              <QueryCard key={entry.query.toLowerCase()} entry={entry} />
            ))}
          </div>
        )}

        {/* Footnote */}
        <p className="text-xs text-muted-foreground/60 mt-8 leading-relaxed">
          Cache entries are addressable Nostr events (kind 30078) published by the 0xSearchstr
          bot account to public relays. Entries expire after 24 hours and are refreshed by new searches.
        </p>
      </div>
    </Layout>
  );
}

function QueryCard({ entry }: { entry: CachedQueryEntry }) {
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
                {entry.resultCount > 0 && (
                  <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
                    {entry.resultCount} result{entry.resultCount !== 1 ? 's' : ''}
                  </Badge>
                )}
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
                  <Clock className="w-3 h-3" />
                  {timeAgo(entry.cachedAt)}
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

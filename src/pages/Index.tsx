import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Search, Network, ExternalLink } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { SearchBar } from '@/components/SearchBar';
import { SourceTabs, type SourceTabValue } from '@/components/SourceTabs';
import { UnifiedResultCard } from '@/components/UnifiedResultCard';
import { ProviderStatus } from '@/components/ProviderStatus';
import { BrowserFallback } from '@/components/BrowserFallback';
import { SearchSkeleton } from '@/components/SearchSkeleton';
import { PrivacyIndicator } from '@/components/PrivacyIndicator';
import { InstantAnswer } from '@/components/InstantAnswer';
import { TrendingQueries } from '@/components/TrendingQueries';
import { Card, CardContent } from '@/components/ui/card';
import { useProviderSearch } from '@/hooks/useProviderSearch';
import { useInstantAnswer } from '@/hooks/useInstantAnswer';
import { useSearchHotkeys } from '@/hooks/useSearchHotkeys';
import type { SearchSource } from '@/lib/providers/types';

const Index = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialSource = (searchParams.get('source') as SourceTabValue) || 'all';

  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [source, setSource] = useState<SourceTabValue>(initialSource);

  const hasSearched = activeQuery.length > 0;

  // Global hotkeys: Ctrl+K / Cmd+K and "/" focus the search bar.
  useSearchHotkeys();

  // Map SourceTabValue to provider search source.
  // 'i2p' has no provider — it shows directory links only.
  const providerSource = source === 'i2p' ? 'all' : source;

  const {
    results,
    providers,
    isLoading,
    isFetching,
    isEmpty,
    suggestions,
    counts,
    privacyMode,
    suppressedProviders,
  } = useProviderSearch({
    query: activeQuery,
    source: providerSource as SearchSource | 'all',
    enabled: hasSearched && source !== 'i2p',
  });

  // Filter results for the current source tab.
  const filteredResults = useMemo(() => {
    if (source === 'all') return results;
    if (source === 'i2p') return [];
    return results.filter((r) => r.source === source);
  }, [results, source]);

  const totalResults = filteredResults.length;

  // Instant answers (calculator, NIP-19 profiles, Wikipedia summaries).
  const { answer: instantAnswer } = useInstantAnswer(
    activeQuery,
    hasSearched && source !== 'i2p',
  );

  useSeoMeta({
    title: hasSearched ? `${activeQuery} - 0xSearchstr` : '0xSearchstr - Decentralized Search Aggregator',
    description: 'Search Nostr first, enriched with privacy-respecting web results. No backend, no crawler, no tracking.',
  });

  const handleSubmit = useCallback((value: string) => {
    setActiveQuery(value);
    setSearchParams((prev) => {
      prev.set('q', value);
      prev.set('source', source);
      return prev;
    });
  }, [source, setSearchParams]);

  const handleSourceChange = useCallback((newSource: SourceTabValue) => {
    setSource(newSource);
    if (activeQuery) {
      setSearchParams((prev) => {
        prev.set('source', newSource);
        return prev;
      });
    }
  }, [activeQuery, setSearchParams]);

  // ─── Hero mode (no search yet) ───
  if (!hasSearched) {
    return (
      <Layout minimal>
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
          <div className="text-center mb-10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700">
            <div className="flex items-center justify-center mb-6">
              <div className="relative">
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 glow-primary-lg">
                  <Search className="w-8 h-8 text-primary" />
                </div>
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary animate-search-pulse" />
              </div>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-4">
              <span className="text-primary font-mono">0x</span>
              <span className="text-foreground">Searchstr</span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-lg mx-auto leading-relaxed">
              Decentralized search. No trackers. No surveillance.
            </p>
          </div>

          <div className="w-full max-w-2xl mb-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:delay-200">
            <SearchBar
              value={query}
              onChange={setQuery}
              onSubmit={handleSubmit}
              size="large"
              autoFocus
            />
          </div>

          <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500 motion-safe:delay-300">
            <SourceTabs value={source} onChange={handleSourceChange} />
          </div>

          {/* Privacy traffic-light — honest signal about who sees the query */}
          <div className="mt-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500 motion-safe:delay-500">
            <PrivacyIndicator source={providerSource as SearchSource | 'all'} />
          </div>

          {/* Trending cached queries — the community index as content */}
          <TrendingQueries
            onSelect={(q) => {
              setQuery(q);
              handleSubmit(q);
            }}
            className="mt-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500 motion-safe:delay-700"
          />
        </div>
      </Layout>
    );
  }

  // ─── Results mode ───
  return (
    <Layout>
      <div className="container py-6">
        <div className="max-w-2xl mb-5">
          <SearchBar
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            isLoading={isFetching}
          />
        </div>

        {/* Tabs + provider status */}
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex items-center gap-2 flex-wrap">
            <SourceTabs value={source} onChange={handleSourceChange} counts={hasSearched ? counts : undefined} />
            <PrivacyIndicator source={providerSource as SearchSource | 'all'} className="ml-auto" />
          </div>
          {providers.length > 0 && source !== 'i2p' && (
            <ProviderStatus providers={providers} hasResults={totalResults > 0} />
          )}
          {privacyMode && suppressedProviders.length > 0 && source !== 'i2p' && (
            <p className="text-xs text-green-600 dark:text-green-500 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
              Privacy Mode — {suppressedProviders.length} external provider{suppressedProviders.length !== 1 ? 's' : ''} blocked. This search never left the Nostr network.
            </p>
          )}
        </div>

        <div className="max-w-2xl">
          {/* I2P tab — directory links only */}
          {source === 'i2p' && (
            <I2PDirectory query={activeQuery} />
          )}

          {/* Instant answer — shown above everything else */}
          {source !== 'i2p' && instantAnswer && (
            <InstantAnswer answer={instantAnswer} className="mb-4" />
          )}

          {/* Loading state */}
          {source !== 'i2p' && isLoading && totalResults === 0 ? (
            <SearchSkeleton />
          ) : source !== 'i2p' && isEmpty ? (
            <>
              {!instantAnswer && (
                <Card className="border-dashed mb-4">
                  <CardContent className="py-10 px-8 text-center">
                    <Search className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
                    <p className="text-muted-foreground max-w-sm mx-auto mb-5">
                      No results found for &ldquo;{activeQuery}&rdquo;.
                    </p>
                    <TrendingQueries
                      limit={5}
                      onSelect={(q) => {
                        setQuery(q);
                        handleSubmit(q);
                      }}
                    />
                  </CardContent>
                </Card>
              )}
              <BrowserFallback query={activeQuery} />
            </>
          ) : source !== 'i2p' && (
            <div className="space-y-3">
              {/* Result count header */}
              {totalResults > 0 && (
                <p className="text-sm text-muted-foreground mb-1">
                  {totalResults} result{totalResults !== 1 ? 's' : ''}
                  {source === 'all' && providers.some((p) => p.status === 'searching') && (
                    <span className="ml-2 text-primary animate-search-pulse">more loading...</span>
                  )}
                </p>
              )}

              {/* Results */}
              {filteredResults.map((result) => (
                <UnifiedResultCard key={result.id} result={result} />
              ))}

              {/* Suggestions */}
              {suggestions.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-2">
                  <span className="text-xs text-muted-foreground">Related:</span>
                  {suggestions.slice(0, 5).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setQuery(suggestion);
                        handleSubmit(suggestion);
                      }}
                      className="text-xs px-2 py-1 rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              {/* Browser fallback when sparse */}
              {totalResults > 0 && totalResults < 5 && source !== 'tor' && (
                <BrowserFallback query={activeQuery} className="mt-4" />
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

/* ─── I2P directory ─── */
function I2PDirectory({ query }: { query: string }) {
  const links = [
    { name: 'Identiguy', url: 'http://identiguy.i2p', desc: 'I2P address book and directory' },
    { name: 'notbob.i2p', url: 'http://notbob.i2p', desc: 'I2P eepsite directory' },
    { name: 'stats.i2p', url: 'http://stats.i2p', desc: 'I2P network statistics' },
  ];

  return (
    <div className="space-y-4">
      <Card className="border-dashed border-i2p/20">
        <CardContent className="py-10 px-8 text-center">
          <Network className="w-8 h-8 mx-auto mb-3 text-i2p/30" />
          <p className="text-muted-foreground max-w-sm mx-auto mb-1">
            I2P search is available via eepsite directories.
          </p>
          <p className="text-xs text-muted-foreground/60">
            There is no public I2P search API. Use the directories below to explore eepsites.
          </p>
        </CardContent>
      </Card>
      <div className="rounded-xl border border-dashed p-5 border-i2p/20 bg-i2p/5">
        <div className="flex items-center gap-2 mb-3">
          <Network className="w-4 h-4 text-i2p/60" />
          <span className="text-sm font-medium text-muted-foreground">Explore I2P eepsites:</span>
        </div>
        <div className="space-y-2">
          {links.map((link) => (
            <a
              key={link.name}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/30 hover:border-primary/30 hover:bg-primary/5 transition-colors"
            >
              <span className="text-sm font-medium text-foreground">{link.name}</span>
              <span className="text-xs text-muted-foreground flex-1 truncate">{link.desc}</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground/40 shrink-0" />
            </a>
          ))}
        </div>
      </div>
      <BrowserFallback query={query} />
    </div>
  );
}

export default Index;

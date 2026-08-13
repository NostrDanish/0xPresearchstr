import { ExternalLink, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BrowserFallbackProps {
  query: string;
  className?: string;
}

const fallbackEngines = [
  {
    name: 'DuckDuckGo',
    url: (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    color: 'text-orange-500',
  },
  {
    name: 'Brave Search',
    url: (q: string) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
    color: 'text-orange-400',
  },
  {
    name: 'Mojeek',
    url: (q: string) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
    color: 'text-green-400',
  },
  {
    name: 'Marginalia',
    url: (q: string) => `https://search.marginalia.nu/search?query=${encodeURIComponent(q)}`,
    color: 'text-yellow-400',
  },
];

/**
 * Browser fallback links — opens external search engines in new tabs.
 * Shown when both Nostr and SearXNG return no results, so users are
 * never left with zero options.
 */
export function BrowserFallback({ query, className }: BrowserFallbackProps) {
  return (
    <div className={cn('rounded-xl border border-dashed border-border/50 bg-card/50 p-6', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Search className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Try these privacy-respecting search engines:</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {fallbackEngines.map((engine) => (
          <a
            key={engine.name}
            href={engine.url(query)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 text-sm',
              'hover:border-primary/30 hover:bg-primary/5 transition-colors',
              'text-muted-foreground hover:text-foreground',
            )}
          >
            <span>{engine.name}</span>
            <ExternalLink className="w-3 h-3 opacity-50" />
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * Trending queries strip — compact chips showing what the community
 * searches, WITHOUT anyone's plaintext ever leaking: terms are published
 * as one-way hashes and only become visible once 3+ independent devices
 * searched them (see src/lib/termSignals.ts). Used on the hero page and
 * in empty search states so the user is never left with nothing.
 */
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';

import { useTrendingTerms } from '@/hooks/useTrendingTerms';
import { cn } from '@/lib/utils';

interface TrendingQueriesProps {
  /** Called when a query chip is clicked. If omitted, chips link to /?q=… */
  onSelect?: (query: string) => void;
  /** Max chips to show. */
  limit?: number;
  className?: string;
}

export function TrendingQueries({ onSelect, limit = 8, className }: TrendingQueriesProps) {
  const { data: entries } = useTrendingTerms();

  if (!entries || entries.length === 0) return null;

  const shown = entries.slice(0, limit);

  return (
    <div className={cn('flex flex-col items-center gap-2.5', className)}>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70">
        <TrendingUp className="w-3.5 h-3.5" />
        Trending in the index
      </span>
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {shown.map((entry) =>
          onSelect ? (
            <button
              key={entry.query.toLowerCase()}
              type="button"
              onClick={() => onSelect(entry.query)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-colors"
            >
              {entry.query}
            </button>
          ) : (
            <Link
              key={entry.query.toLowerCase()}
              to={`/?q=${encodeURIComponent(entry.query)}`}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-colors"
            >
              {entry.query}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

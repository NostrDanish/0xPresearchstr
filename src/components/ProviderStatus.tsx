/**
 * Live provider status indicators — shows which providers have completed,
 * which are still searching, and latency for each.
 *
 * ```
 * ✔ Nostr (124ms)  ✔ Wikipedia (230ms)  ⏳ SearXNG...  ⏳ HN...
 * ```
 */
import { Check, X, Loader2, Minus } from 'lucide-react';
import type { ProviderState } from '@/hooks/useProviderSearch';
import { cn } from '@/lib/utils';

interface ProviderStatusProps {
  providers: ProviderState[];
  /**
   * When true, provider errors are rendered as a muted "skipped" dash
   * instead of a red X — graceful degradation: if other providers delivered
   * results, one failing provider isn't an error worth alarming over.
   */
  hasResults?: boolean;
  className?: string;
}

const SOURCE_COLORS: Record<string, string> = {
  nostr: 'text-nostr',
  web: 'text-clearnet',
  wiki: 'text-foreground/70',
  news: 'text-foreground/70',
  code: 'text-foreground/70',
  tor: 'text-tor',
  i2p: 'text-i2p',
};

export function ProviderStatus({ providers, hasResults = false, className }: ProviderStatusProps) {
  if (providers.length === 0) return null;

  // Only show while at least one provider is actively searching or just finished.
  const hasActivity = providers.some((p) => p.status !== 'idle');
  if (!hasActivity) return null;

  return (
    <div className={cn('flex items-center gap-3 flex-wrap', className)}>
      {providers.map((p) => (
        <div key={p.id} className="inline-flex items-center gap-1.5 text-xs">
          {p.status === 'searching' && (
            <Loader2 className={cn('w-3 h-3 animate-spin', SOURCE_COLORS[p.source] ?? 'text-muted-foreground')} />
          )}
          {p.status === 'done' && (
            <Check className="w-3 h-3 text-primary" />
          )}
          {p.status === 'error' && hasResults && (
            <Minus className="w-3 h-3 text-muted-foreground/40" />
          )}
          {p.status === 'error' && !hasResults && (
            <X className="w-3 h-3 text-destructive" />
          )}
          {p.status === 'idle' && (
            <span className="w-3 h-3 rounded-full bg-muted-foreground/20" />
          )}

          <span className={cn(
            'font-medium',
            p.status === 'searching' ? (SOURCE_COLORS[p.source] ?? 'text-muted-foreground') : 'text-muted-foreground',
            p.status === 'error' && !hasResults && 'text-destructive/70',
            p.status === 'error' && hasResults && 'text-muted-foreground/50 line-through',
          )}>
            {p.name}
          </span>

          {p.status === 'done' && p.latencyMs !== undefined && (
            <span className="text-muted-foreground/50 font-mono">
              {p.latencyMs}ms
            </span>
          )}

          {p.status === 'done' && p.resultCount > 0 && (
            <span className="text-muted-foreground/50">
              ({p.resultCount})
            </span>
          )}

          {p.status === 'searching' && (
            <span className="text-muted-foreground/50 animate-search-pulse">...</span>
          )}
        </div>
      ))}
    </div>
  );
}

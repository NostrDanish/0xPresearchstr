import { useState, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  isLoading?: boolean;
  /** Large variant for the home page hero. */
  size?: 'default' | 'large';
  className?: string;
  autoFocus?: boolean;
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  isLoading = false,
  size = 'default',
  className,
  autoFocus = false,
}: SearchBarProps) {
  const [focused, setFocused] = useState(false);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    // Collapse runs of whitespace so "best   monero   wallet" and
    // "best monero wallet" hit the same cache/observations.
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized) {
      onSubmit(normalized);
    }
  }, [value, onSubmit]);

  const handleClear = useCallback(() => {
    onChange('');
  }, [onChange]);

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'relative flex items-center w-full rounded-xl border bg-card transition-all duration-200 overflow-hidden',
        focused && 'border-primary/50 glow-primary',
        !focused && 'border-border hover:border-border/80',
        size === 'large' && 'rounded-2xl',
        className,
      )}
    >
      <div className={cn(
        'flex items-center justify-center shrink-0 text-muted-foreground',
        size === 'large' ? 'pl-5 pr-1' : 'pl-3.5 pr-0.5',
      )}>
        {isLoading ? (
          <Loader2 className={cn('animate-spin', size === 'large' ? 'w-5 h-5' : 'w-4 h-4')} />
        ) : (
          <Search className={cn(size === 'large' ? 'w-5 h-5' : 'w-4 h-4')} />
        )}
      </div>

      <input
        id="search-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search Nostr & the web…"
        autoFocus={autoFocus}
        autoComplete="off"
        className={cn(
          'flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60 text-foreground',
          size === 'large' ? 'px-3 py-4 text-lg' : 'px-2.5 py-2.5 text-sm',
        )}
        aria-label="Search query"
      />

      {/* Hotkey hint — hidden while typing or focused */}
      {!value && !focused && (
        <kbd className="hidden sm:flex items-center gap-1 shrink-0 mr-1.5 px-1.5 py-0.5 rounded border border-border/60 bg-muted/50 text-[10px] font-mono text-muted-foreground/60 select-none pointer-events-none">
          <span className="text-[9px]">CTRL</span>K
        </kbd>
      )}

      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center justify-center shrink-0 w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Clear search"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className={cn('shrink-0', size === 'large' ? 'pr-2' : 'pr-1.5')}>
        <Button
          type="submit"
          disabled={!value.trim() || isLoading}
          size={size === 'large' ? 'default' : 'sm'}
          aria-label="Search"
          className={cn(
            'rounded-lg font-medium flex items-center justify-center shrink-0',
            // Large: icon-only square on small screens, full "Search" label from sm up.
            // Small: always an icon button (a 36px button can't fit text).
            size === 'large' ? 'h-12 w-12 p-0 sm:w-28 sm:px-6' : 'h-9 w-9 p-0',
            // Use theme primary variable so hacker theme shows green automatically
            'bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-95'
          )}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : size === 'large' ? (
            <>
              <Search className="w-5 h-5 sm:hidden" />
              <span className="hidden sm:inline text-sm font-medium">Search</span>
            </>
          ) : (
            <Search className="w-4 h-4" />
          )}
        </Button>
      </div>
    </form>
  );
}

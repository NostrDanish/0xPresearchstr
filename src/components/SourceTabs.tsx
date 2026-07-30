import { cn } from '@/lib/utils';
import { Layers, Zap, Globe, Shield, Network, BookOpen, Newspaper, Code } from 'lucide-react';
import type { SearchSource } from '@/lib/providers/types';

export type SourceTabValue = SearchSource | 'all' | 'i2p';

interface SourceTabsProps {
  value: SourceTabValue;
  onChange: (source: SourceTabValue) => void;
  className?: string;
  /** Optional result counts to show in badges. */
  counts?: Partial<Record<SourceTabValue, number>>;
}

const sources: { id: SourceTabValue; label: string; icon: React.ReactNode; color: string; activeColor: string }[] = [
  {
    id: 'all',
    label: 'All',
    icon: <Layers className="w-3.5 h-3.5" />,
    // default: muted gray; active: use theme primary variable
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'nostr',
    label: 'Nostr',
    icon: <Zap className="w-3.5 h-3.5" />,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'web',
    label: 'Web',
    icon: <Globe className="w-3.5 h-3.5" />,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'wiki',
    label: 'Wiki',
    icon: <BookOpen className="w-3.5 h-3.5" />,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'news',
    label: 'News',
    icon: <Newspaper className="w-3.5 h-3.5" />,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'code',
    label: 'Code',
    icon: <Code className="w-3.5 h-3.5" />,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'tor',
    label: 'Tor',
    icon: <Shield className="w-3.5 h-3.5" />,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'i2p',
    label: 'I2P',
    icon: <Network className="w-3.5 h-3.5" />,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
];

export function SourceTabs({ value, onChange, className, counts }: SourceTabsProps) {
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)} role="tablist" aria-label="Search source">
      {sources.map((source) => {
        const isActive = value === source.id;
        const count = counts?.[source.id];
        return (
          <button
            key={source.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(source.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-transparent transition-all duration-150',
              isActive ? source.activeColor : cn('text-muted-foreground', source.color),
              !isActive && 'hover:bg-accent',
            )}
          >
            {source.icon}
            {source.label}
            {count !== undefined && count > 0 && (
              <span className={cn(
                'text-[10px] font-mono ml-0.5 opacity-70',
                isActive ? '' : 'text-muted-foreground',
              )}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

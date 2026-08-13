/**
 * AI Answer card — the synthesized answer above search results.
 *
 * Renders the model's answer with [n] citations as clickable superscripts
 * that open the actual evidence link. A sources strip at the bottom lists
 * the evidence the model used. Footer credits the provider + model and
 * notes the answer is ephemeral (never indexed).
 */
import { useMemo } from 'react';
import { Sparkles, ExternalLink, AlertTriangle } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import type { AIEvidenceItem, AIAnswer } from '@/lib/ai/types';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface AIAnswerCardProps {
  answer?: AIAnswer;
  evidence: AIEvidenceItem[];
  isLoading: boolean;
  error?: string | null;
  className?: string;
}

/** Split answer text into parts, turning [n] markers into citation links. */
function renderWithCitations(text: string, evidence: AIEvidenceItem[]) {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) return <span key={i}>{part}</span>;

    const n = parseInt(match[1], 10);
    const item = evidence[n - 1];
    if (!item) return <span key={i}>{part}</span>;

    const href = sanitizeUrl(item.url);
    if (!href) return <span key={i}>{part}</span>;

    return (
      <a
        key={i}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={item.title}
        className="inline-flex items-center text-[10px] font-mono text-primary bg-primary/10 border border-primary/20 rounded px-1 mx-0.5 align-super hover:bg-primary/20 transition-colors"
      >
        {n}
      </a>
    );
  });
}

export function AIAnswerCard({ answer, evidence, isLoading, error, className }: AIAnswerCardProps) {
  const body = useMemo(
    () => (answer ? renderWithCitations(answer.text, evidence) : null),
    [answer, evidence],
  );

  if (isLoading) {
    return (
      <div className={cn('p-4 rounded-xl border border-primary/25 bg-primary/[0.04]', className)}>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-primary animate-search-pulse" />
          <span className="text-xs font-medium text-primary">AI is synthesizing an answer…</span>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('p-4 rounded-xl border border-amber-500/25 bg-amber-500/5', className)}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500 shrink-0" />
          <p className="text-xs text-muted-foreground">
            AI answer unavailable: <span className="font-mono">{error}</span>
          </p>
        </div>
      </div>
    );
  }

  if (!answer) return null;

  // Evidence actually referenced in the answer, in citation order.
  const usedEvidence = [...new Set(
    [...answer.text.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10)),
  )]
    .map((n) => evidence[n - 1])
    .filter((e): e is AIEvidenceItem => !!e);

  return (
    <div className={cn(
      'p-4 rounded-xl border border-primary/25 bg-primary/[0.04]',
      'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500',
      className,
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2.5">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold text-primary">AI Answer</span>
        <span className="text-[10px] text-muted-foreground/60 ml-auto font-mono truncate">
          {answer.provider} · {answer.model}
        </span>
      </div>

      {/* Answer body with citation links */}
      <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
        {body}
      </div>

      {/* Sources actually cited */}
      {usedEvidence.length > 0 && (
        <div className="mt-3 pt-3 border-t border-primary/10 flex flex-wrap gap-1.5">
          {usedEvidence.map((item) => {
            const href = sanitizeUrl(item.url);
            if (!href) return null;
            return (
              <a
                key={item.n}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors max-w-full"
              >
                <span className="font-mono text-primary">[{item.n}]</span>
                <span className="truncate max-w-48">{item.title}</span>
                <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-50" />
              </a>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/50 mt-3">
        Synthesized from the search evidence above — ephemeral, never indexed.
      </p>
    </div>
  );
}

/**
 * Instant answer card — the direct answer shown above search results.
 *
 *   - Calculator:  "15% of 80"  →  12
 *   - Nostr profile: npub1… → avatar, name, bio (fetched from relays)
 *   - Wikipedia:   strong title match → first paragraph + thumbnail
 */
import { Link } from 'react-router-dom';
import { Calculator, BookOpen, User, BadgeCheck, Zap } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import type { InstantAnswer as InstantAnswerData } from '@/hooks/useInstantAnswer';
import { useAuthor } from '@/hooks/useAuthor';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface InstantAnswerProps {
  answer: InstantAnswerData;
  className?: string;
}

export function InstantAnswer({ answer, className }: InstantAnswerProps) {
  if (answer.type === 'calculator') return <CalculatorAnswer answer={answer} className={className} />;
  if (answer.type === 'profile') return <ProfileAnswer answer={answer} className={className} />;
  if (answer.type === 'wikipedia') return <WikipediaAnswer answer={answer} className={className} />;
  return null;
}

/* ─── Calculator ─── */

function CalculatorAnswer({ answer, className }: { answer: Extract<InstantAnswerData, { type: 'calculator' }>; className?: string }) {
  return (
    <div className={cn(
      'flex items-center gap-4 p-4 rounded-xl border border-primary/20 bg-primary/5',
      'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300',
      className,
    )}>
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
        <Calculator className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground font-mono truncate">{answer.expression} =</p>
        <p className="text-2xl font-bold text-foreground font-mono tracking-tight">{answer.result}</p>
      </div>
    </div>
  );
}

/* ─── Nostr profile ─── */

function ProfileAnswer({ answer, className }: { answer: Extract<InstantAnswerData, { type: 'profile' }>; className?: string }) {
  const author = useAuthor(answer.pubkey);
  const metadata = author.data?.metadata;
  const npub = nip19.npubEncode(answer.pubkey);

  const displayName = metadata?.display_name || metadata?.name || `${npub.slice(0, 12)}…`;
  const picture = metadata?.picture ? sanitizeUrl(metadata.picture) : undefined;
  const banner = metadata?.banner ? sanitizeUrl(metadata.banner) : undefined;

  if (author.isLoading) {
    return (
      <div className={cn('p-4 rounded-xl border border-nostr/20 bg-nostr/5', className)}>
        <div className="flex items-center gap-4">
          <Skeleton className="w-14 h-14 rounded-full shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Link to={`/${npub}`} className={cn('block group', className)}>
      <div className="rounded-xl border border-nostr/20 bg-nostr/5 overflow-hidden hover:border-nostr/40 transition-colors motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
        {banner && (
          <div className="h-16 w-full overflow-hidden">
            <img src={banner} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
        )}
        <div className="flex items-center gap-4 p-4">
          <Avatar size="lg" className="shrink-0 ring-2 ring-nostr/20">
            {picture && <AvatarImage src={picture} alt={displayName} />}
            <AvatarFallback><User className="w-5 h-5" /></AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground group-hover:text-nostr transition-colors truncate">
                {displayName}
              </span>
              {metadata?.nip05 && (
                <span className="inline-flex items-center gap-1 text-xs text-nostr">
                  <BadgeCheck className="w-3.5 h-3.5" />
                  <span className="truncate">{metadata.nip05}</span>
                </span>
              )}
            </div>
            {metadata?.about && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{metadata.about}</p>
            )}
            <p className="text-[11px] text-muted-foreground/50 font-mono mt-1 truncate">{npub}</p>
          </div>
          <Zap className="w-4 h-4 text-nostr/40 shrink-0" />
        </div>
      </div>
    </Link>
  );
}

/* ─── Wikipedia summary ─── */

function WikipediaAnswer({ answer, className }: { answer: Extract<InstantAnswerData, { type: 'wikipedia' }>; className?: string }) {
  return (
    <a
      href={answer.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('block group', className)}
    >
      <div className="flex gap-4 p-4 rounded-xl border border-border/60 bg-card hover:border-primary/30 transition-colors motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
        {answer.thumbnail && (
          <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-border/50">
            <img src={answer.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground font-mono">en.wikipedia.org</span>
          </div>
          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
            {answer.title}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed mt-1">
            {answer.extract}
          </p>
        </div>
      </div>
    </a>
  );
}

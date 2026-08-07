/**
 * Stake result card — renders a community keyword stake with the
 * staker's Nostr profile resolved (avatar + name), Presearch-style
 * "top placement" treatment: blue-tinted card, Staked badge,
 * staker attribution.
 */
import { ExternalLink, Gem } from 'lucide-react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAuthor } from '@/hooks/useAuthor';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import type { SearchResult } from '@/lib/providers/types';
import { cn } from '@/lib/utils';

interface StakeResultCardProps {
  result: SearchResult;
  className?: string;
}

export function StakeResultCard({ result, className }: StakeResultCardProps) {
  const stakerPubkey = result.nostrEvent?.pubkey;
  const author = useAuthor(stakerPubkey);
  const metadata = author.data?.metadata;

  const stakerName = metadata?.name || metadata?.display_name
    || (stakerPubkey ? `${nip19.npubEncode(stakerPubkey).slice(0, 12)}…` : 'anon');
  const stakerAvatar = metadata?.picture ? sanitizeUrl(metadata.picture) : undefined;
  const stakerNprofile = stakerPubkey ? `/${nip19.npubEncode(stakerPubkey)}` : undefined;

  return (
    <div
      className={cn(
        'p-4 rounded-xl border border-primary/25 bg-primary/[0.04]',
        'hover:border-primary/40 hover:bg-primary/[0.07] transition-all duration-200',
        className,
      )}
    >
      {/* URL line */}
      <div className="flex items-center gap-2 mb-1.5">
        <Gem className="w-3.5 h-3.5 shrink-0 text-primary" />
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground font-mono truncate hover:text-foreground transition-colors"
        >
          {result.domain || result.url}
        </a>
        <ExternalLink className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        <span className="flex items-center gap-1.5 ml-auto shrink-0">
          <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
            Staked
          </Badge>
          {result.engine && (
            <Badge variant="outline" className="text-[10px] border-border text-muted-foreground font-mono">
              {result.engine}
            </Badge>
          )}
        </span>
      </div>

      {/* Title */}
      <a href={result.url} target="_blank" rel="noopener noreferrer" className="block group">
        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors mb-1 line-clamp-2 text-sm">
          {result.title}
        </h3>
        {result.snippet && (
          <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
            {result.snippet}
          </p>
        )}
      </a>

      {/* Staker attribution */}
      <div className="flex items-center gap-2 mt-2.5 text-xs text-muted-foreground/70">
        <span>staked by</span>
        {stakerNprofile ? (
          <Link
            to={stakerNprofile}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Avatar size="sm" className="shrink-0 !size-4">
              {stakerAvatar && <AvatarImage src={stakerAvatar} alt={stakerName} />}
              <AvatarFallback>{stakerName.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="font-medium">{stakerName}</span>
          </Link>
        ) : (
          <span className="font-medium">{stakerName}</span>
        )}
      </div>
    </div>
  );
}

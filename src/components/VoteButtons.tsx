/**
 * Vote buttons — 👍/👎 on any result card (NIP-25 reactions, kind 7).
 *
 * Anonymous by default: votes are signed by this device's built-in SIP-01
 * indexing identity. Users can flip "Vote with my npub" in Settings →
 * Indexing to make votes attributable to their logged-in key (same trust
 * model as keyword staking).
 *
 * Tallies are fetched once per results list (VoteTalliesProvider batches
 * all visible targets into one relay query) and shared via context.
 */
import { createContext, useContext, useMemo, useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

import { useToast } from '@/hooks/useToast';
import { useVoteActions, useVoteCounts } from '@/hooks/useVotes';
import { getMyVote, voteTargetFor, type VoteTally } from '@/lib/votes';
import type { SearchResult } from '@/lib/providers/types';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Tallies context (one batched query per results list)                */
/* ------------------------------------------------------------------ */

const VoteTalliesContext = createContext<Map<string, VoteTally> | null>(null);

export function VoteTalliesProvider({ results, children }: {
  results: { url: string; nostrEvent?: { id: string } }[];
  children: React.ReactNode;
}) {
  const keys = useMemo(
    () => results.map(voteTargetFor).filter((t): t is NonNullable<typeof t> => t !== null).map((t) => t.key),
    [results],
  );
  const { data } = useVoteCounts(keys);
  return (
    <VoteTalliesContext.Provider value={data ?? null}>
      {children}
    </VoteTalliesContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* The buttons                                                         */
/* ------------------------------------------------------------------ */

interface VoteButtonsProps {
  result: SearchResult;
  className?: string;
}

export function VoteButtons({ result, className }: VoteButtonsProps) {
  const target = useMemo(() => voteTargetFor(result), [result]);
  const tallies = useContext(VoteTalliesContext);
  const tally = target ? tallies?.get(target.key) : undefined;

  const [mine, setMine] = useState(() => (target ? getMyVote(target.key) : null));
  const [pending, setPending] = useState(false);
  const { vote, asIdentity, canVoteWithIdentity } = useVoteActions();
  const { toast } = useToast();

  if (!target) return null;

  const handleVote = (direction: 1 | -1) => {
    if (pending || mine === direction) return;
    setPending(true);
    void (async () => {
      try {
        await vote(result, direction);
        setMine(direction);
      } catch (err) {
        toast({
          title: 'Vote failed',
          description: err instanceof Error ? err.message : 'Could not publish the vote.',
          variant: 'destructive',
        });
      } finally {
        setPending(false);
      }
    })();
  };

  // Counts come from the (refreshed-after-vote) tally; the active button
  // state shows my own vote immediately.
  const up = tally?.up ?? 0;
  const down = tally?.down ?? 0;

  const identityHint = asIdentity
    ? (canVoteWithIdentity ? 'Voting as your npub' : 'Log in to vote with your npub')
    : 'Anonymous vote (device identity)';

  return (
    <div
      className={cn('inline-flex items-center gap-1', className)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      role="group"
      aria-label={`Votes — ${identityHint}`}
      title={identityHint}
    >
      <button
        type="button"
        onClick={() => handleVote(1)}
        disabled={pending}
        aria-label="Upvote"
        aria-pressed={mine === 1}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs transition-colors',
          mine === 1
            ? 'text-green-600 dark:text-green-500 bg-green-500/10'
            : 'text-muted-foreground/60 hover:text-green-600 dark:hover:text-green-500 hover:bg-green-500/5',
          pending && 'opacity-50',
        )}
      >
        <ThumbsUp className="w-3.5 h-3.5" />
        {up > 0 && <span className="font-mono text-[10px]">{up}</span>}
      </button>
      <button
        type="button"
        onClick={() => handleVote(-1)}
        disabled={pending}
        aria-label="Downvote"
        aria-pressed={mine === -1}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs transition-colors',
          mine === -1
            ? 'text-destructive bg-destructive/10'
            : 'text-muted-foreground/60 hover:text-destructive hover:bg-destructive/5',
          pending && 'opacity-50',
        )}
      >
        <ThumbsDown className="w-3.5 h-3.5" />
        {down > 0 && <span className="font-mono text-[10px]">{down}</span>}
      </button>
    </div>
  );
}

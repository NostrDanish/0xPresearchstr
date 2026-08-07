/**
 * Stake a Keyword — Presearch-style keyword staking over Nostr.
 *
 * Presearch has keyword staking with PRE tokens. 0xPresearchstr has
 * keyword staking with Nostr identity: sign an addressable kind 30078
 * event binding a keyword to a URL, and your link takes the top
 * "Community Stake" placement whenever anyone searches that keyword —
 * on this app, on 0xSearchstr, and on every compatible fork.
 *
 * One stake per keyword per pubkey: re-staking the same keyword
 * replaces your previous stake (addressable d-tag).
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Gem, Loader2, Link2 } from 'lucide-react';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoginArea } from '@/components/auth/LoginArea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { buildStakeEvent } from '@/lib/keywordStakes';
import { isValidSubmissionUrl } from '@/lib/contentType';

interface StakeKeywordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keyword to prefill (usually the active search query). */
  initialKeyword?: string;
}

export function StakeKeywordDialog({ open, onOpenChange, initialKeyword = '' }: StakeKeywordDialogProps) {
  const { user } = useCurrentUser();
  const { mutate: createEvent, isPending } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState(initialKeyword);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [pitch, setPitch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Sync the prefill whenever the dialog opens with a new keyword.
  useEffect(() => {
    if (open) setKeyword(initialKeyword);
  }, [open, initialKeyword]);

  const reset = () => {
    setKeyword('');
    setUrl('');
    setTitle('');
    setPitch('');
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!keyword.trim()) {
      setError('A keyword is required.');
      return;
    }
    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    if (!isValidSubmissionUrl(url)) {
      setError('Enter a valid https://, magnet:, or ipfs:// link.');
      return;
    }

    const template = buildStakeEvent({ keyword, url, title, pitch });
    if (!template) {
      setError('Invalid stake — check the keyword, title, and link.');
      return;
    }

    createEvent(template, {
      onSuccess: () => {
        toast({
          title: 'Keyword staked',
          description: `"${keyword.trim()}" now shows your link to everyone searching it.`,
        });
        // Refresh searches so the new stake shows up immediately.
        void queryClient.invalidateQueries({ queryKey: ['provider-search'] });
        reset();
        onOpenChange(false);
      },
      onError: (err) => {
        setError(err.message || 'Failed to publish. Try again.');
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gem className="w-5 h-5 text-primary" />
            Stake a Keyword
          </DialogTitle>
          <DialogDescription>
            Claim the top placement for a search keyword. Your stake is signed with your
            Nostr key and shows to everyone searching it — on every compatible client.
            No tokens, no auction: your identity is the stake.
          </DialogDescription>
        </DialogHeader>

        {!user ? (
          <div className="py-6 text-center space-y-4">
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Log in with your Nostr key to stake keywords. Stakes are cryptographically
              signed and attributable to you — that&apos;s what makes them Sybil-resistant.
            </p>
            <LoginArea className="max-w-56 mx-auto" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Keyword */}
            <div className="space-y-1.5">
              <Label htmlFor="stake-keyword">Keyword *</Label>
              <Input
                id="stake-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. monero wallet"
                maxLength={80}
                required
              />
              <p className="text-[11px] text-muted-foreground/60">
                Exact match: your link appears when someone searches this keyword.
              </p>
            </div>

            {/* URL */}
            <div className="space-y-1.5">
              <Label htmlFor="stake-url">Link *</Label>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                <Input
                  id="stake-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-site.example"
                  className="pl-9 font-mono text-sm"
                  required
                />
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="stake-title">Title *</Label>
              <Input
                id="stake-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What searchers will see"
                maxLength={120}
                required
              />
            </div>

            {/* Pitch */}
            <div className="space-y-1.5">
              <Label htmlFor="stake-pitch">Pitch</Label>
              <Textarea
                id="stake-pitch"
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                placeholder="One or two sentences on why this link is the best answer."
                rows={3}
                maxLength={280}
                className="resize-none"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-muted-foreground/50 font-mono">kind 30078 · 1 stake / keyword / npub</span>
              <Button type="submit" disabled={isPending || !keyword.trim() || !title.trim() || !url.trim()}>
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Staking…
                  </>
                ) : (
                  <>
                    <Gem className="w-4 h-4 mr-1.5" />
                    Stake it
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

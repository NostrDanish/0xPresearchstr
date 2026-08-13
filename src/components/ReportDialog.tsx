/**
 * Report dialog — flag a result (link, post, profile) as a NIP-56
 * kind 1984 abuse report. Signed with the user's Nostr key (reports are
 * attributable by design); logged-out users get a login prompt.
 */
import { useEffect, useState } from 'react';
import { Flag, Loader2, ShieldCheck } from 'lucide-react';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoginArea } from '@/components/auth/LoginArea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { buildReportEvent, REPORT_TYPES } from '@/lib/reports';

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The thing being reported (URL, note1…, npub1…, …). */
  target: string;
  /** Display title of the target (for context). */
  targetTitle?: string;
}

export function ReportDialog({ open, onOpenChange, target, targetTitle }: ReportDialogProps) {
  const { user } = useCurrentUser();
  const { mutate: createEvent, isPending } = useNostrPublish();
  const { toast } = useToast();

  const [type, setType] = useState<string>('illegal');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setType('illegal');
      setDetails('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const template = buildReportEvent(target, type, details);
    if (!template) {
      setError('This target can\u2019t be reported — expected a URL or Nostr identifier.');
      return;
    }

    createEvent(template, {
      onSuccess: () => {
        toast({
          title: 'Report published',
          description: 'Your NIP-56 report is now public — moderators and relays can act on it.',
        });
        onOpenChange(false);
      },
      onError: (err) => setError(err.message || 'Failed to publish. Try again.'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="w-5 h-5 text-destructive" />
            Report this result
          </DialogTitle>
          <DialogDescription>
            Files a public NIP-56 report (kind 1984) signed with your key. The team console
            and compatible clients see it immediately.
          </DialogDescription>
        </DialogHeader>

        {/* Target being reported */}
        <div className="rounded-lg bg-muted/50 border border-border/50 px-3 py-2">
          {targetTitle && (
            <p className="text-sm font-medium text-foreground truncate">{targetTitle}</p>
          )}
          <p className="text-[11px] font-mono text-muted-foreground break-all">{target}</p>
        </div>

        {!user ? (
          <div className="py-4 text-center space-y-4">
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Reports are signed with your Nostr key — attributable and Sybil-resistant.
              Log in to file one.
            </p>
            <LoginArea className="max-w-56 mx-auto" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="report-type">Report type</Label>
              <select
                id="report-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {REPORT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-details">Details</Label>
              <Textarea
                id="report-details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Why should this be removed from the index?"
                rows={3}
                maxLength={500}
                className="resize-none"
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-muted-foreground/50 font-mono inline-flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> kind 1984 · NIP-56
              </span>
              <Button type="submit" variant="destructive" disabled={isPending || !details.trim()}>
                {isPending ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Flag className="w-4 h-4 mr-1.5" />
                )}
                Publish report
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

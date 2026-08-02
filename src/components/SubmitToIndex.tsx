/**
 * Submit to Index — let any Nostr user curate the decentralized index.
 *
 * Forked concept from Nostra Search: the index isn't just a bot cache,
 * it's community-curated. Submissions are kind 30078 events signed by
 * the user's own key, readable by every 0xSearchstr (and compatible)
 * client via the Community provider.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  PlusCircle, Loader2, Globe, Magnet, Package, Video, Music,
  FileText, ShieldAlert, Link2,
} from 'lucide-react';

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
import { buildSubmissionEvent } from '@/lib/communityIndex';
import { detectContentType, contentTypeLabel, isValidSubmissionUrl, type ContentType } from '@/lib/contentType';
import { cn } from '@/lib/utils';

interface SubmitToIndexProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TYPE_OPTIONS: { type: ContentType; icon: React.ReactNode }[] = [
  { type: 'web', icon: <Globe className="w-3.5 h-3.5" /> },
  { type: 'torrent', icon: <Magnet className="w-3.5 h-3.5" /> },
  { type: 'ipfs', icon: <Package className="w-3.5 h-3.5" /> },
  { type: 'video', icon: <Video className="w-3.5 h-3.5" /> },
  { type: 'audio', icon: <Music className="w-3.5 h-3.5" /> },
  { type: 'pdf', icon: <FileText className="w-3.5 h-3.5" /> },
  { type: 'onion', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
];

export function SubmitToIndex({ open, onOpenChange }: SubmitToIndexProps) {
  const { user } = useCurrentUser();
  const { mutate: createEvent, isPending } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [type, setType] = useState<ContentType>('web');
  const [typeTouched, setTypeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setUrl('');
    setTitle('');
    setDescription('');
    setTagsInput('');
    setType('web');
    setTypeTouched(false);
    setError(null);
  };

  const handleUrlChange = (value: string) => {
    setUrl(value);
    // Auto-detect type unless the user picked one manually.
    if (!typeTouched) setType(detectContentType(value));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    if (!isValidSubmissionUrl(url)) {
      setError('Enter a valid https://, magnet:, or ipfs:// link.');
      return;
    }

    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);

    void (async () => {
      const template = await buildSubmissionEvent({ url, title, description, tags, type });
      createEvent(template, {
        onSuccess: () => {
          toast({
            title: 'Added to the community index',
            description: 'Your submission is now searchable by everyone.',
          });
          // Let future searches pick up the new entry immediately.
          void queryClient.invalidateQueries({ queryKey: ['provider-search'] });
          reset();
          onOpenChange(false);
        },
        onError: (err) => {
          setError(err.message || 'Failed to publish. Try again.');
        },
      });
    })();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-primary" />
            Submit to the Index
          </DialogTitle>
          <DialogDescription>
            Curate the decentralized index. Your submission is signed with your Nostr key
            and becomes searchable by everyone — no middleman.
          </DialogDescription>
        </DialogHeader>

        {!user ? (
          <div className="py-6 text-center space-y-4">
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Log in with your Nostr key to submit links. Your submissions are
              cryptographically signed and attributable to you.
            </p>
            <LoginArea className="max-w-56 mx-auto" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* URL */}
            <div className="space-y-1.5">
              <Label htmlFor="submit-url">Link *</Label>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                <Input
                  id="submit-url"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://, magnet:?xt=…, ipfs://, or .onion"
                  className="pl-9 font-mono text-sm"
                  required
                />
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="submit-title">Title *</Label>
              <Input
                id="submit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What is this link?"
                maxLength={120}
                required
              />
            </div>

            {/* Type */}
            <div className="space-y-1.5">
              <Label>Type <span className="text-muted-foreground/60 font-normal">(auto-detected)</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => { setType(opt.type); setTypeTouched(true); }}
                    aria-pressed={type === opt.type}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                      type === opt.type
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-border',
                    )}
                  >
                    {opt.icon}
                    {contentTypeLabel(opt.type)}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="submit-description">Description</Label>
              <Textarea
                id="submit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Why is this worth finding? (shown as the search snippet)"
                rows={3}
                maxLength={500}
                className="resize-none"
              />
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label htmlFor="submit-tags">Tags</Label>
              <Input
                id="submit-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="privacy, tools, bitcoin (comma separated)"
              />
              <p className="text-[11px] text-muted-foreground/60">
                Tags make your submission discoverable — searches match against them.
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-muted-foreground/50 font-mono">kind 30078 · NIP-78</span>
              <Button type="submit" disabled={isPending || !title.trim() || !url.trim()}>
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Publishing…
                  </>
                ) : (
                  <>
                    <PlusCircle className="w-4 h-4 mr-1.5" />
                    Publish to Nostr
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

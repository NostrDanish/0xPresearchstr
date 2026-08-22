import { AlertTriangle, ExternalLink, Shield } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { sanitizeResultUrl } from '@/lib/sanitizeUrl';

interface OnionWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  type: 'tor' | 'i2p';
}

export function OnionWarningDialog({ open, onOpenChange, url, type }: OnionWarningDialogProps) {
  const networkName = type === 'tor' ? 'Tor (.onion)' : 'I2P (.i2p)';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg">Leaving the Clearnet</DialogTitle>
          </div>
          <DialogDescription className="text-left space-y-3">
            <p>
              You are about to visit a <strong>{networkName}</strong> hidden service. This link
              requires the {type === 'tor' ? 'Tor Browser' : 'I2P router'} to access.
            </p>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted text-sm">
              <Shield className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground mb-1">Privacy Notice</p>
                <p className="text-muted-foreground">
                  Presearchstr does not proxy, cache, or render hidden service content.
                  You are responsible for your own safety when visiting this link.
                  The content policy that governs our index does not extend to live site content.
                </p>
              </div>
            </div>
            <p className="font-mono text-xs break-all bg-muted/50 p-2 rounded border border-border/50 text-muted-foreground">
              {url}
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => {
              // Defense in depth: the URL came from a result set — only
              // ever open sanitizeable http(s)/magnet targets.
              const safe = sanitizeResultUrl(url);
              if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
              onOpenChange(false);
            }}
            className="w-full sm:w-auto"
          >
            <ExternalLink className="w-4 h-4 mr-1.5" />
            Continue to {type === 'tor' ? 'Onion' : 'I2P'} Site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

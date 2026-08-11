/**
 * Settings page — all app configuration in one place.
 *
 * Sections:
 *   - Appearance: theme selection (light / dark / hacker / system)
 *   - SearXNG Instances: dynamic pool management (add custom, health, refresh)
 */
import { useEffect, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import {
  Settings as SettingsIcon, Sun, Moon, Terminal, Monitor, Search,
  Plus, Trash2, RefreshCw, Globe, Anchor, KeyRound,
  CheckCircle2, XCircle, CircleDashed, ExternalLink, ShieldCheck, Check,
  ShieldAlert, ShieldX, Eye, EyeOff, Wifi, Zap, Fingerprint, Copy, Download, Undo2,
} from 'lucide-react';

import { Layout } from '@/components/Layout';
import { RelayListManager } from '@/components/RelayListManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/useToast';
import { useTheme } from '@/hooks/useTheme';
import { useAppContext } from '@/hooks/useAppContext';
import { useSearxngInstances } from '@/hooks/useSearxngInstances';
import { useSearchRelayPool, useIndexRelayPool } from '@/hooks/useSearchRelayPool';
import { checkIndexerService, type IndexerServiceStatus } from '@/lib/indexerService';
import { PRESEARCHSTR_INDEX_PUBKEY } from '@/lib/searchIndex';
import {
  getIndexerIdentity, regenerateIndexerIdentity, exportIndexerNsec,
} from '@/lib/indexerIdentity';
import type { PoolInstance, InstanceOrigin } from '@/lib/searxngInstances';
import type { Theme } from '@/contexts/AppContext';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

const THEMES: { value: Theme; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'presearch', label: 'Presearch', icon: <Search className="w-4 h-4" />, description: 'Community blue (default)' },
  { value: 'light', label: 'Light', icon: <Sun className="w-4 h-4" />, description: 'Clean and bright' },
  { value: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" />, description: 'Easy on the eyes' },
  { value: 'hacker', label: 'Hacker', icon: <Terminal className="w-4 h-4" />, description: 'Terminal green' },
  { value: 'system', label: 'System', icon: <Monitor className="w-4 h-4" />, description: 'Follows your device' },
];

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Appearance</h2>
      <p className="text-xs text-muted-foreground mb-4">Choose how 0xPresearchstr looks.</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {THEMES.map((t) => {
          const active = theme === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              aria-pressed={active}
              className={cn(
                'flex flex-col items-center gap-1.5 px-3 py-4 rounded-xl border text-center transition-colors',
                active
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border/60 bg-card text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              <span className={cn(active && 'text-primary')}>{t.icon}</span>
              <span className="text-sm font-medium flex items-center gap-1.5">
                {t.label}
                {active && <Check className="w-3.5 h-3.5 text-primary" />}
              </span>
              <span className="text-xs text-muted-foreground/70">{t.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

const EXPOSURE_ROWS = [
  {
    tier: 'Nostr providers',
    icon: <ShieldCheck className="w-4 h-4" />,
    dot: 'bg-green-500',
    text: 'text-green-600 dark:text-green-500',
    who: 'Nostr relay operators',
    detail: 'See the query text and your IP address. No account is linked — search reads are unauthenticated. This is the minimum possible exposure for a decentralized search.',
    blockedInPrivacyMode: false,
  },
  {
    tier: 'Direct API providers',
    icon: <ShieldAlert className="w-4 h-4" />,
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-500',
    who: 'Wikimedia, Algolia, Stack Exchange',
    detail: 'Your browser talks to them directly over HTTPS. They see the query + your IP in standard web server logs. No proxy in between.',
    blockedInPrivacyMode: true,
  },
  {
    tier: 'Proxied providers',
    icon: <ShieldX className="w-4 h-4" />,
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-500',
    who: 'CORS proxy + SearXNG instances, DuckDuckGo, Ahmia',
    detail: 'Queries route through a CORS proxy (to work around browser restrictions). The proxy sees every query in plaintext, and the destination service sees it too. This is the weakest link — enable Privacy Mode to eliminate it.',
    blockedInPrivacyMode: true,
  },
];

function PrivacySection() {
  const { config, updateConfig } = useAppContext();
  const privacyMode = config.privacyMode;

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Privacy</h2>
      <p className="text-xs text-muted-foreground mb-4">
        An honest breakdown of who can see your searches — and a switch to cut it to the minimum.
      </p>

      {/* Privacy Mode toggle */}
      <Card className={cn('mb-4 transition-colors', privacyMode ? 'border-green-500/30 bg-green-500/5' : 'border-border/60')}>
        <CardContent className="py-4 flex items-start gap-4">
          <div className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
            privacyMode
              ? 'bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-500'
              : 'bg-muted text-muted-foreground border-border',
          )}>
            {privacyMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Privacy Mode</span>
              <Switch
                checked={privacyMode}
                onCheckedChange={(checked) => updateConfig(() => ({ privacyMode: checked }))}
                aria-label="Toggle Privacy Mode"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {privacyMode
                ? 'Active. Only Nostr-tier providers run — no clearnet APIs, no CORS proxies. Fewer results, zero third-party exposure.'
                : 'Nostr-only search. Disables every provider that talks to clearnet APIs or CORS proxies — at the cost of fewer results.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Exposure breakdown */}
      <div className="space-y-2">
        {EXPOSURE_ROWS.map((row) => (
          <Card key={row.tier} className="border-border/60">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={cn('w-2 h-2 rounded-full shrink-0', row.dot)} />
                <span className={cn('text-xs font-semibold flex items-center gap-1.5', row.text)}>
                  {row.icon}
                  {row.tier}
                </span>
                <span className="text-[11px] text-muted-foreground">→ {row.who}</span>
                {row.blockedInPrivacyMode && privacyMode && (
                  <Badge variant="outline" className="text-[10px] ml-auto border-green-500/30 text-green-600 dark:text-green-500">
                    Blocked
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed pl-4">
                {row.detail}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground/70 mt-3 leading-relaxed">
        0xPresearchstr itself never logs, stores, or transmits your searches to its own servers — there are no
        servers. Contributed index entries are published to public Nostr relays under this device's dedicated
        indexing identity (see Indexing below), never under your personal Nostr account, and never contain
        your query. For the full picture, read the <a href="/about" className="text-primary hover:underline">threat model</a>.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Indexing (Search Index Protocol identity)                           */
/* ------------------------------------------------------------------ */

function IndexingSection() {
  const { config, updateConfig } = useAppContext();
  const { toast } = useToast();
  const autoIndex = config.autoIndex;

  // Read the device identity once per mount; regenerate bumps this state.
  const [identity, setIdentity] = useState(() => getIndexerIdentity());

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${what} copied` });
    } catch {
      toast({ title: 'Copy failed', description: 'Clipboard is unavailable.', variant: 'destructive' });
    }
  };

  const exportKey = async () => {
    const nsec = exportIndexerNsec();
    await copy(nsec, 'Indexing key (nsec)');
  };

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Indexing</h2>
      <p className="text-xs text-muted-foreground mb-4">
        How this browser contributes to the shared decentralized web index.
      </p>

      {/* Auto-index toggle */}
      <Card className={cn('mb-4 transition-colors', autoIndex ? 'border-primary/30 bg-primary/5' : 'border-border/60')}>
        <CardContent className="py-4 flex items-start gap-4">
          <div className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
            autoIndex ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted text-muted-foreground border-border',
          )}>
            <Globe className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Automatic indexing</span>
              <Switch
                checked={autoIndex}
                onCheckedChange={(checked) => updateConfig(() => ({ autoIndex: checked }))}
                aria-label="Toggle automatic indexing"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              When enabled, useful web pages discovered during your searches are anonymously
              contributed to the shared Nostr index — one small event per URL, containing
              only the page&apos;s public title and description. <strong className="text-foreground">Your
              search queries are never published</strong>, and your personal Nostr identity
              is never used.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Indexing identity */}
      <Card className="border-border/60">
        <CardContent className="py-4 flex items-start gap-4">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border bg-muted text-muted-foreground border-border">
            <Fingerprint className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Indexing identity</span>
              <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-600 dark:text-green-500">
                Active
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              A dedicated keypair generated on this device, used only for automatic indexing.
              It is <strong className="text-foreground">not</strong> your Nostr account — the two
              are never linked. It guarantees key separation, not network anonymity (relays
              still see IP/timing).
            </p>

            {/* Public key */}
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                {identity.npub}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => void copy(identity.npub, 'Indexing npub')}
                aria-label="Copy indexing public key"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Actions */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => void exportKey()}>
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Export key
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Regenerate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate indexing identity?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <span className="block">
                        This creates a <strong>brand-new indexer</strong>. Nothing is deleted,
                        but:
                      </span>
                      <span className="block">
                        · events you already published stay signed by the <em>old</em> key;
                        <br />
                        · the new key does <em>not</em> inherit any reputation or history;
                        <br />
                        · your previous indexing history remains tied to the old key.
                      </span>
                      <span className="block">
                        Only do this if you want to start over as a fresh indexer.
                      </span>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep current identity</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setIdentity(regenerateIndexerIdentity());
                        toast({
                          title: 'New indexing identity active',
                          description: 'Future index events are signed by the new key.',
                        });
                      }}
                    >
                      Regenerate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Autosigner (signing service)                                        */
/* ------------------------------------------------------------------ */

function AutosignerSection() {
  const [status, setStatus] = useState<IndexerServiceStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    setStatus(await checkIndexerService());
    setChecking(false);
  };

  // Auto-check once on mount — answers "is the autosigner live?" immediately.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    void checkIndexerService().then((s) => {
      if (cancelled) return;
      setStatus(s);
      setChecking(false);
    });
    return () => { cancelled = true; };
  }, []);

  const live = status?.ok === true;
  const failed = status?.ok === false;
  const expected = status?.pubkey === PRESEARCHSTR_INDEX_PUBKEY;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold">Autosigner</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void check()}
          disabled={checking}
        >
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', checking && 'animate-spin')} />
          {checking ? 'Checking…' : 'Re-check'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Every search on this site auto-indexes into the shared Nostr cache, signed
        server-side by the autosigner service. The indexer key lives only as a
        Cloudflare secret — no key material ever ships to the browser, and the
        service rate-limits and validates instead of trusting clients.
      </p>

      <Card className={cn(
        'transition-colors',
        live ? 'border-green-500/30 bg-green-500/5'
          : failed ? 'border-amber-500/30 bg-amber-500/5'
          : 'border-border/60',
      )}>
        <CardContent className="py-4 flex items-start gap-4">
          <div className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
            live ? 'bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-500'
              : failed ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-500'
              : 'bg-muted text-muted-foreground border-border',
          )}>
            <KeyRound className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">
                {checking && !status ? 'Contacting autosigner…'
                  : live ? 'Autosigner online'
                  : failed ? 'Autosigner unreachable' : 'Autosigner'}
              </span>
              {live && status?.latencyMs != null && (
                <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-600 dark:text-green-500">
                  {status.latencyMs}ms
                </Badge>
              )}
              {live && !expected && (
                <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-500">
                  unexpected key
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {checking && !status
                ? 'Pinging the signing endpoint…'
                : live
                  ? `Signing as ${status?.pubkey?.slice(0, 12)}…${status?.pubkey?.slice(-4)} — this search session feeds the federated index.`
                  : failed
                    ? `${status?.error ?? 'No response'} — indexing falls back to the embedded legacy key, so the index still grows.`
                    : 'Checking the autosigner service…'}
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Your relays (NIP-65)                                                */
/* ------------------------------------------------------------------ */

function YourRelaysSection() {
  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Your Relays</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Your NIP-65 relay list — where your profile, submissions, and other events are
        published and read. Defaults to the 0xPresearchstr app relays for new users;
        changes sync to Nostr (kind 10002) when you're logged in.
      </p>
      <Card className="border-border/60">
        <CardContent className="py-4">
          <RelayListManager />
        </CardContent>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Relay pools (search + index)                                        */
/* ------------------------------------------------------------------ */

interface RelayPoolSectionProps {
  title: string;
  description: string;
  addLabel: string;
  /** Which pool to manage. */
  kind: 'search' | 'index';
}

/**
 * Generic relay pool editor. Every relay — default or custom — is
 * user-changeable: customs are deleted, defaults are hidden (restorable
 * via "Restore defaults").
 */
function RelayPoolSection({ title, description, addLabel, kind }: RelayPoolSectionProps) {
  const { pool, testing, testRelays, addRelay, removeRelay, restoreDefaults, hiddenCount } =
    kind === 'search' ? useSearchRelayPool() : useIndexRelayPool();
  const { toast } = useToast();
  const [newUrl, setNewUrl] = useState('');

  const handleAdd = () => {
    if (!newUrl.trim()) return;
    const added = addRelay(newUrl);
    if (added) {
      toast({ title: `${title.slice(0, -1)} added`, description: `${added} is now in the pool.` });
      setNewUrl('');
    } else {
      toast({
        title: 'Invalid relay URL',
        description: 'Enter a valid relay, e.g. wss://relay.example.com',
        variant: 'destructive',
      });
    }
  };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-1 gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                restoreDefaults();
                toast({ title: 'Defaults restored', description: 'All default relays are back in the pool.' });
              }}
              className="text-muted-foreground"
            >
              <Undo2 className="w-3.5 h-3.5 mr-1.5" />
              Restore {hiddenCount} default{hiddenCount !== 1 ? 's' : ''}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void testRelays()}
            disabled={testing}
          >
            <Wifi className={cn('w-3.5 h-3.5 mr-1.5', testing && 'animate-pulse')} />
            {testing ? 'Testing…' : 'Test latency'}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{description}</p>

      {/* Add custom */}
      <Card className="mb-4 border-primary/20">
        <CardContent className="py-4">
          <div className="flex gap-2">
            <Input
              placeholder="wss://relay.example.com"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="font-mono text-sm"
              aria-label={addLabel}
            />
            <Button onClick={handleAdd} className="shrink-0">
              <Plus className="w-4 h-4 mr-1.5" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pool */}
      <div className="space-y-2">
        {pool.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-8 px-8 text-center">
              <p className="text-sm text-muted-foreground">
                All relays are hidden. Restore the defaults or add a custom relay —
                an empty pool means this feature talks to no one.
              </p>
            </CardContent>
          </Card>
        )}
        {pool.map((entry) => {
          const hostname = (() => {
            try { return new URL(entry.url).host; } catch { return entry.url; }
          })();
          const isOnion = entry.url.includes('.onion');

          return (
            <div
              key={entry.url}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border/60 bg-card hover:border-border transition-colors"
            >
              <Zap className={cn('w-4 h-4 shrink-0', isOnion ? 'text-tor' : 'text-nostr')} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="font-mono text-sm truncate">{hostname}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] px-1.5 py-0',
                      entry.origin === 'default'
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'bg-clearnet/10 text-clearnet border-clearnet/30',
                    )}
                  >
                    {entry.origin === 'default' ? 'Default' : 'Custom'}
                  </Badge>
                  {isOnion && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-tor/30 text-tor/80">
                      Tor only
                    </Badge>
                  )}
                </div>
                {entry.status === 'untested' && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CircleDashed className="w-3.5 h-3.5" />
                    Untested
                  </span>
                )}
                {entry.status === 'testing' && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Testing…
                  </span>
                )}
                {entry.status === 'ok' && (
                  <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Reachable{entry.latencyMs !== undefined ? ` · ${entry.latencyMs}ms` : ''}
                  </span>
                )}
                {entry.status === 'error' && (
                  <span className="flex items-center gap-1.5 text-xs text-destructive">
                    <XCircle className="w-3.5 h-3.5" />
                    {isOnion ? 'Needs Tor' : 'Unreachable'}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => {
                  removeRelay(entry.url);
                  toast({
                    title: entry.origin === 'default' ? 'Default relay hidden' : 'Relay removed',
                    description: entry.origin === 'default'
                      ? `${hostname} is out of the pool. "Restore defaults" brings it back.`
                      : entry.url,
                  });
                }}
                aria-label={`Remove ${hostname}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Instances                                                           */
/* ------------------------------------------------------------------ */

const ORIGIN_META: Record<InstanceOrigin, { label: string; icon: React.ReactNode; className: string }> = {
  custom: {
    label: 'Custom',
    icon: <ShieldCheck className="w-3 h-3" />,
    className: 'bg-primary/10 text-primary border-primary/30',
  },
  discovered: {
    label: 'Discovered',
    icon: <Globe className="w-3 h-3" />,
    className: 'bg-clearnet/10 text-clearnet border-clearnet/30',
  },
  seed: {
    label: 'Seed',
    icon: <Anchor className="w-3 h-3" />,
    className: 'bg-muted text-muted-foreground border-border',
  },
};

function healthIndicator(inst: PoolInstance) {
  const h = inst.health;
  if (!h || (h.ok === 0 && h.fail === 0)) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleDashed className="w-3.5 h-3.5" />
        Untested
      </span>
    );
  }
  if (h.fail > 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <XCircle className="w-3.5 h-3.5" />
        {h.fail} consecutive fail{h.fail > 1 ? 's' : ''}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500">
      <CheckCircle2 className="w-3.5 h-3.5" />
      Healthy
      {h.latencyMs ? ` · ${h.latencyMs}ms` : ''}
      {h.avgResults !== undefined ? ` · ~${Math.round(h.avgResults)} results` : ''}
    </span>
  );
}

function InstancesSection() {
  const { pool, refreshing, refresh, addInstance, removeInstance, discoveredAt } = useSearxngInstances();
  const { toast } = useToast();
  const [newUrl, setNewUrl] = useState('');

  const custom = pool.filter((p) => p.origin === 'custom');
  const discovered = pool.filter((p) => p.origin === 'discovered');
  const seeds = pool.filter((p) => p.origin === 'seed');

  const handleAdd = () => {
    if (!newUrl.trim()) return;
    const added = addInstance(newUrl);
    if (added) {
      toast({ title: 'Instance added', description: `${added} is now first in the pool.` });
      setNewUrl('');
    } else {
      toast({
        title: 'Invalid URL',
        description: 'Instance must be a valid https:// URL.',
        variant: 'destructive',
      });
    }
  };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold">SearXNG Instances</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Instances are discovered live from{' '}
        <a
          href="https://searx.space"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-0.5"
        >
          searx.space
          <ExternalLink className="w-3 h-3" />
        </a>
        {' '}(privacy-filtered), health-tracked in your browser, and self-heal automatically.
        {discoveredAt && (
          <span className="block mt-1 text-muted-foreground/70">
            Last discovery: {new Date(discoveredAt).toLocaleString()}
          </span>
        )}
      </p>

      {/* Add custom */}
      <Card className="mb-6 border-primary/20">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground mb-3">
            <strong className="text-foreground">Add your own instance</strong> — self-hosted instances
            always run first. Enable <code className="bg-muted px-1 py-0.5 rounded font-mono">format: json</code> in your SearXNG settings.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="https://searx.example.com"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="font-mono text-sm"
              aria-label="Custom SearXNG instance URL"
            />
            <Button onClick={handleAdd} className="shrink-0">
              <Plus className="w-4 h-4 mr-1.5" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Custom list */}
      {custom.length > 0 && (
        <>
          <SectionHeader title="Your instances" count={custom.length} />
          <div className="space-y-2 mb-6">
            {custom.map((inst) => (
              <InstanceRow
                key={inst.url}
                inst={inst}
                onRemove={() => {
                  removeInstance(inst.url);
                  toast({ title: 'Instance removed', description: inst.url });
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* Discovered list */}
      <SectionHeader title="Discovered" count={discovered.length} />
      {discovered.length > 0 ? (
        <div className="space-y-2 mb-6">
          {discovered.map((inst) => (
            <InstanceRow key={inst.url} inst={inst} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed mb-6">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              {refreshing
                ? 'Discovering live instances…'
                : 'No discovered instances yet. They appear automatically after a search.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Seed list */}
      <SectionHeader title="Seeds (bootstrap fallback)" count={seeds.length} />
      <div className="space-y-2">
        {seeds.map((inst) => (
          <InstanceRow key={inst.url} inst={inst} />
        ))}
      </div>
    </section>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-2 mb-2">
      {title}
      <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">{count}</Badge>
    </h3>
  );
}

function InstanceRow({ inst, onRemove }: { inst: PoolInstance; onRemove?: () => void }) {
  const meta = ORIGIN_META[inst.origin];
  const hostname = (() => {
    try { return new URL(inst.url).hostname; } catch { return inst.url; }
  })();

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border/60 bg-card hover:border-border transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <a
            href={inst.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm truncate hover:text-primary transition-colors"
          >
            {hostname}
          </a>
          <Badge variant="outline" className={cn('text-[10px] gap-1 px-1.5 py-0', meta.className)}>
            {meta.icon}
            {meta.label}
          </Badge>
        </div>
        {healthIndicator(inst)}
      </div>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
          onClick={onRemove}
          aria-label={`Remove ${hostname}`}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Settings() {
  useSeoMeta({
    title: 'Settings - 0xPresearchstr',
    description: 'Configure appearance and SearXNG instances for 0xPresearchstr.',
  });

  return (
    <Layout>
      <div className="container max-w-2xl py-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <SettingsIcon className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        </div>
        <p className="text-muted-foreground mb-8">
          Everything is stored locally in your browser. Nothing leaves your device except search queries.
        </p>

        <AppearanceSection />
        <Separator className="mb-10" />
        <PrivacySection />
        <Separator className="mb-10" />
        <IndexingSection />
        <Separator className="mb-10" />
        <AutosignerSection />
        <Separator className="mb-10" />
        <YourRelaysSection />
        <Separator className="mb-10" />
        <RelayPoolSection
          title="Index Relays"
          description="Where the community index lives: SIP-01 web-index observations, the legacy query cache, community submissions, and keyword stakes are published to and read from these relays. Every browser running this app is a crawler node — this is its peer list. Hide any default or add your own."
          addLabel="Custom index relay URL"
          kind="index"
        />
        <Separator className="mb-10" />
        <RelayPoolSection
          title="Search Relays"
          description="NIP-50 relays queried in parallel for every full-text Nostr search. 0xPresearchstr's defaults are suggestions — hide any of them or add your own."
          addLabel="Custom search relay URL"
          kind="search"
        />
        <Separator className="mb-10" />
        <InstancesSection />
      </div>
    </Layout>
  );
}

/**
 * Settings page — all app configuration in one place.
 *
 * Sections:
 *   - Appearance: theme selection (light / dark / hacker / system)
 *   - SearXNG Instances: dynamic pool management (add custom, health, refresh)
 */
import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import {
  Settings as SettingsIcon, Sun, Moon, Terminal, Search,
  Plus, Trash2, RefreshCw, Globe, Anchor,
  CheckCircle2, XCircle, CircleDashed, ExternalLink, ShieldCheck, Check,
  ShieldAlert, ShieldX, Shield, Eye, EyeOff, Wifi, Zap, Fingerprint, Copy, Download, Undo2,
  ChevronUp, ChevronDown, Star, Power, ThumbsUp, Database, Sparkles, Lock, Code, BookOpen,
} from 'lucide-react';

import { Layout } from '@/components/Layout';
import { RelayListManager } from '@/components/RelayListManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { ALL_SOURCE_TABS, DEFAULT_TAB_CONFIG } from '@/components/SourceTabs';
import { useAppContext } from '@/hooks/useAppContext';
import { useSearxngInstances } from '@/hooks/useSearxngInstances';
import { useSearchRelayPool, useIndexRelayPool, useGitRelayPool, useWikiRelayPool } from '@/hooks/useSearchRelayPool';
import { getBraveApiKey, setBraveApiKey } from '@/lib/providers/brave';
import { ALL_PROVIDERS } from '@/lib/providers/registry';
import { AI_PROVIDERS, getAIProvider, PPQ_INVITE_URL } from '@/lib/ai/registry';
import { COMMUNITY_AI_MODEL, getAIConfig, hasOwnAIKey, setAIConfig, type AIConfig } from '@/lib/aiConfig';
import type { AIModel } from '@/lib/ai/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  { value: 'light', label: 'Light', icon: <Sun className="w-4 h-4" />, description: 'Presearch blue on white' },
  { value: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" />, description: 'Brand navy (default)' },
];

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  // Hacker theme is hidden behind a mini-toggle — it's a joke/retro theme.
  const [showHacker, setShowHacker] = useState(false);

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Appearance</h2>
      <p className="text-xs text-muted-foreground mb-4">Choose how Presearchstr looks.</p>
      <div className="grid grid-cols-2 gap-2">
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

      {/* Hacker theme — hidden behind a small toggle (it's the joke one) */}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowHacker((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          aria-expanded={showHacker}
        >
          <Terminal className="w-3 h-3" />
          {showHacker ? 'Hide hacker mode' : 'hacker mode?'}
        </button>
        {(showHacker || theme === 'hacker') && (
          <button
            type="button"
            onClick={() => setTheme(theme === 'hacker' ? 'dark' : 'hacker')}
            aria-pressed={theme === 'hacker'}
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] transition-colors',
              theme === 'hacker'
                ? 'border-green-500/40 text-green-600 dark:text-green-500 bg-green-500/10'
                : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {theme === 'hacker' ? 'on — terminal green' : 'off'}
          </button>
        )}
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
        Presearchstr itself never logs, stores, or transmits your searches to its own servers — there are no
        servers. Contributed index entries are published to public Nostr relays under this device's dedicated
        indexing identity (see the Auto Indexer tab), never under your personal Nostr account, and never contain
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
  const voteWithIdentity = config.voteWithIdentity;
  const { user } = useCurrentUser();

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
      <h2 className="text-sm font-semibold mb-1">Auto Indexer</h2>
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

      {/* Vote identity toggle */}
      <Card className={cn('mb-4 transition-colors', voteWithIdentity ? 'border-primary/30 bg-primary/5' : 'border-border/60')}>
        <CardContent className="py-4 flex items-start gap-4">
          <div className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
            voteWithIdentity ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted text-muted-foreground border-border',
          )}>
            <ThumbsUp className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Vote with my npub</span>
              <Switch
                checked={voteWithIdentity}
                onCheckedChange={(checked) => updateConfig(() => ({ voteWithIdentity: checked }))}
                aria-label="Toggle voting with your Nostr identity"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {voteWithIdentity
                ? 'On: 👍/👎 votes are signed by your logged-in Nostr key — attributable, like keyword stakes.'
                : 'Off (default): votes are anonymous — signed by this device\u2019s built-in indexing identity, never linked to you.'}
              {voteWithIdentity && !user && (
                <span className="block mt-1 text-amber-600 dark:text-amber-500">
                  Not logged in — anonymous voting stays active until you log in.
                </span>
              )}
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
/* Your relays (NIP-65)                                                */
/* ------------------------------------------------------------------ */

function YourRelaysSection() {
  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Your Relays</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Your NIP-65 relay list — where your profile, submissions, and other events are
        published and read. Defaults to the Presearchstr app relays for new users;
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
/* Search tabs (modular tab bar)                                       */
/* ------------------------------------------------------------------ */

function SearchTabsSection() {
  const { config, updateConfig } = useAppContext();
  const { toast } = useToast();
  const { order, hidden, defaultTab } = config.tabConfig;

  // Merge stored order with any tabs added since (forward-compat).
  const knownIds = ALL_SOURCE_TABS.map((t) => t.id as string);
  const effectiveOrder = [
    ...order.filter((id) => knownIds.includes(id)),
    ...knownIds.filter((id) => !order.includes(id)),
  ];

  const setTabConfig = (patch: Partial<typeof config.tabConfig>) =>
    updateConfig(() => ({ tabConfig: { ...config.tabConfig, ...patch } }));

  const move = (id: string, dir: -1 | 1) => {
    const next = [...effectiveOrder];
    const i = next.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setTabConfig({ order: next });
  };

  const toggleHidden = (id: string) => {
    const isHidden = hidden.includes(id);
    if (isHidden) {
      setTabConfig({ hidden: hidden.filter((h) => h !== id) });
      return;
    }
    // Hiding the default tab? Promote the first still-visible tab instead.
    const patch: Partial<typeof config.tabConfig> = { hidden: [...hidden, id] };
    if (defaultTab === id) {
      const fallback = effectiveOrder.find((t) => t !== id && !hidden.includes(t));
      if (fallback) patch.defaultTab = fallback;
    }
    setTabConfig(patch);
  };

  const reset = () => {
    setTabConfig({ ...DEFAULT_TAB_CONFIG, order: [...DEFAULT_TAB_CONFIG.order], hidden: [...DEFAULT_TAB_CONFIG.hidden] });
    toast({ title: 'Tabs reset', description: 'Back to the default layout (Web first, Tor/I2P off).' });
  };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold">Search Tabs</h2>
        <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
          <Undo2 className="w-3.5 h-3.5 mr-1.5" />
          Reset
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        The tab bar is fully modular: choose which tabs show, their order, and the one a
        fresh visit starts on. Tor and I2P are off by default — turn them on here.
      </p>

      <div className="space-y-2">
        {effectiveOrder.map((id, index) => {
          const meta = ALL_SOURCE_TABS.find((t) => t.id === id);
          if (!meta) return null;
          const isHidden = hidden.includes(id);
          const isDefault = defaultTab === id;

          return (
            <div
              key={id}
              className={cn(
                'flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-colors',
                isHidden ? 'border-border/40 bg-card/50 opacity-60' : 'border-border/60 bg-card',
              )}
            >
              {/* Reorder */}
              <div className="flex flex-col shrink-0">
                <button
                  onClick={() => move(id, -1)}
                  disabled={index === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                  aria-label={`Move ${meta.label} up`}
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => move(id, 1)}
                  disabled={index === effectiveOrder.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                  aria-label={`Move ${meta.label} down`}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Tab identity */}
              <span className="text-muted-foreground shrink-0">{meta.icon}</span>
              <span className="text-sm font-medium flex-1 min-w-0 truncate">{meta.label}</span>

              {/* Default marker */}
              <button
                onClick={() => !isHidden && setTabConfig({ defaultTab: id })}
                disabled={isHidden}
                title={isDefault ? 'Default tab' : 'Make this the default tab'}
                aria-label={isDefault ? `${meta.label} is the default tab` : `Make ${meta.label} the default tab`}
                className={cn(
                  'shrink-0 transition-colors',
                  isDefault ? 'text-primary' : 'text-muted-foreground/40 hover:text-foreground',
                  isHidden && 'cursor-not-allowed',
                )}
              >
                <Star className={cn('w-4 h-4', isDefault && 'fill-primary')} />
              </button>

              {/* Visibility */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => toggleHidden(id)}
                aria-label={isHidden ? `Show ${meta.label} tab` : `Hide ${meta.label} tab`}
              >
                {isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground/70 mt-3 leading-relaxed">
        The starred tab opens on fresh visits. Deep links still work for hidden tabs
        (e.g. <code className="font-mono">/?source=tor&q=…</code>).
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Search engines (per-provider on/off)                                */
/* ------------------------------------------------------------------ */

const ENGINE_META: Record<string, { icon: React.ReactNode; note: string }> = {
  searxng: { icon: <Globe className="w-4 h-4" />, note: 'Meta-search across dozens of engines via community instances' },
  duckduckgo: { icon: <Globe className="w-4 h-4" />, note: 'Direct DuckDuckGo fallback (HTML endpoint)' },
  brave: { icon: <Shield className="w-4 h-4" />, note: 'Official Brave Search API — add your free key in the Brave tab' },
  'web-index': { icon: <Search className="w-4 h-4" />, note: 'The shared SIP-01 community web index (kind 39697)' },
  'cached-index': { icon: <Database className="w-4 h-4" />, note: 'Legacy federated query cache (kind 30078)' },
  'keyword-stakes': { icon: <Star className="w-4 h-4" />, note: 'Community keyword stakes — Presearch-style top placements' },
  community: { icon: <Check className="w-4 h-4" />, note: 'User-curated submissions + NIP-B0 bookmarks' },
  nostr: { icon: <Zap className="w-4 h-4" />, note: 'NIP-50 full-text search: notes, articles, wiki, files, torrents, code' },
  wikipedia: { icon: <Globe className="w-4 h-4" />, note: 'Wikipedia articles (direct MediaWiki API)' },
  'nostr-wiki': { icon: <BookOpen className="w-4 h-4" />, note: 'NIP-54 wiki articles from the wiki relay pool (wikistr relays)' },
  hackernews: { icon: <Globe className="w-4 h-4" />, note: 'Hacker News stories (Algolia API)' },
  stackoverflow: { icon: <Globe className="w-4 h-4" />, note: 'Stack Overflow questions (StackExchange API)' },
  git: { icon: <Code className="w-4 h-4" />, note: 'NIP-34 repos, issues, PRs & patches from ngit/GRASP relays (read-only)' },
  tor: { icon: <Shield className="w-4 h-4" />, note: '.onion hidden services via Ahmia (Tor tab)' },
};

function EnginesSection() {
  const { config, updateConfig } = useAppContext();
  const disabled = config.disabledProviders ?? [];

  const toggle = (id: string) => {
    // Read from the merged config (never the raw stored partial — older
    // stored configs predate this field and would crash with
    // "disabledProviders is not iterable").
    const current = config.disabledProviders ?? [];
    updateConfig(() => ({
      disabledProviders: current.includes(id)
        ? current.filter((p) => p !== id)
        : [...current, id],
    }));
  };

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Search Engines</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Turn engines on or off with a click — including the community index itself.
        Off engines never run, never see your query.
      </p>

      <div className="space-y-2">
        {ALL_PROVIDERS.map((p) => {
          const off = disabled.includes(p.id);
          const meta = ENGINE_META[p.id] ?? { icon: <Globe className="w-4 h-4" />, note: '' };
          return (
            <div
              key={p.id}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
                off ? 'border-border/40 bg-card/50 opacity-60' : 'border-border/60 bg-card',
              )}
            >
              <button
                type="button"
                onClick={() => toggle(p.id)}
                aria-pressed={!off}
                aria-label={`${off ? 'Enable' : 'Disable'} ${p.name}`}
                title={off ? `Enable ${p.name}` : `Disable ${p.name}`}
                className={cn(
                  'shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border transition-colors',
                  off
                    ? 'border-border/60 text-muted-foreground/50 hover:text-foreground'
                    : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
                )}
              >
                <Power className="w-3.5 h-3.5" />
              </button>
              <span className="text-muted-foreground shrink-0">{meta.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{p.name}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] px-1.5 py-0',
                      p.privacy === 'nostr'
                        ? 'border-green-500/30 text-green-600 dark:text-green-500'
                        : p.privacy === 'direct'
                          ? 'border-amber-500/30 text-amber-600 dark:text-amber-500'
                          : 'border-red-500/30 text-red-600 dark:text-red-500',
                    )}
                  >
                    {p.privacy}
                  </Badge>
                  {off && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                      Off
                    </Badge>
                  )}
                </div>
                {meta.note && (
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">{meta.note}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* AI (answer layer)                                                   */
/* ------------------------------------------------------------------ */

function AISection() {
  const { toast } = useToast();
  // Read once per mount; local edits buffer until Save.
  const [cfg, setCfg] = useState(() => getAIConfig());
  const [models, setModels] = useState<AIModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const provider = getAIProvider(cfg.providerId);
  /** Own key pasted → community tier pauses, everything below unlocks. */
  const ownKey = hasOwnAIKey(cfg);
  /** Keyless providers (Ollama) run their own config even without a key. */
  const keylessProvider = provider?.requiresKey === false;
  const onCommunity = !ownKey && !keylessProvider;
  const ready = cfg.enabled && (ownKey || keylessProvider || onCommunity);

  const save = (patch: Partial<AIConfig>) => {
    const next = setAIConfig(patch);
    setCfg(next);
  };

  const loadModels = async () => {
    if (!provider) return;
    setLoadingModels(true);
    try {
      const list = await provider.models(cfg.endpoint || provider.defaultEndpoint, cfg.apiKey.trim());
      setModels(list);
      toast({ title: `${list.length} models available`, description: 'Pick one from the list or type a model id.' });
    } catch (err) {
      toast({
        title: 'Could not load models',
        description: err instanceof Error ? err.message : 'Endpoint unreachable.',
        variant: 'destructive',
      });
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">AI Answers</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Optional: an AI layer synthesizes an evidence-cited answer from your search results.
        Off by default. Your query + results leave for the chosen provider only when enabled.
      </p>

      {/* Master toggle */}
      <Card className={cn('mb-4 transition-colors', cfg.enabled ? 'border-primary/30 bg-primary/5' : 'border-border/60')}>
        <CardContent className="py-4 flex items-start gap-4">
          <div className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
            cfg.enabled ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted text-muted-foreground border-border',
          )}>
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">AI answers</span>
              <Switch
                checked={cfg.enabled}
                onCheckedChange={(checked) => save({ enabled: checked })}
                aria-label="Toggle AI answers"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {cfg.enabled
                ? 'On — searches show a synthesized answer with citations to the underlying results.'
                : 'Off — search works exactly as before, nothing is sent to any AI.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {cfg.enabled && (
        <>
          {/* Free community tier — locked provider + model */}
          {onCommunity && (
            <Card className="mb-4 border-primary/25 bg-primary/[0.04]">
              <CardContent className="py-4 flex items-start gap-4">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border bg-primary/10 border-primary/30 text-primary">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">Free community tier</span>
                    <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-600 dark:text-green-500">
                      Active
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Answers run on the built-in key — free for everyone, shared and rate-limited.
                    Provider and model are fixed on this tier:
                  </p>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-[10px] font-mono">PPQ.ai</Badge>
                    <Badge variant="secondary" className="text-[10px] font-mono">{COMMUNITY_AI_MODEL}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground/70 mt-2 leading-relaxed">
                    Paste your own API key below and the community key pauses instantly —
                    your key and settings never leave this device except in requests to
                    your chosen provider.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-border/60">
            <CardContent className="py-4 space-y-4">
              {/* API key — the unlock for everything else */}
              <div className="space-y-1.5">
                <Label htmlFor="ai-key">
                  Your API key <span className="text-muted-foreground/60 font-normal">(optional — free tier built in)</span>
                </Label>
                <Input
                  id="ai-key"
                  type="password"
                  value={cfg.apiKey}
                  onChange={(e) => save({ apiKey: e.target.value })}
                  placeholder="sk-…"
                  className="font-mono text-sm"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground/70">
                  {ownKey
                    ? 'Your key is active — the built-in free key is paused.'
                    : 'Empty = free community tier. Paste a key to unlock provider + model choice.'}
                  {cfg.providerId === 'ppq' && !ownKey && (
                    <>
                      {' '}No key yet?{' '}
                      <a
                        href={PPQ_INVITE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Get one at PPQ.ai
                      </a>{' '}
                      (pay-per-prompt, no subscription — supports us too).
                    </>
                  )}
                </p>
              </div>

              {/* Provider / endpoint / model — locked on the community tier */}
              <fieldset disabled={onCommunity} className={cn('space-y-4', onCommunity && 'opacity-50 pointer-events-none select-none')}>
                {/* Provider */}
                <div className="space-y-1.5">
                  <Label htmlFor="ai-provider">Provider</Label>
                  <select
                    id="ai-provider"
                    value={cfg.providerId}
                    onChange={(e) => {
                      const next = getAIProvider(e.target.value);
                      save({
                        providerId: e.target.value,
                        endpoint: next?.defaultEndpoint ?? cfg.endpoint,
                      });
                      setModels([]);
                    }}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                  >
                    {AI_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* Endpoint */}
                <div className="space-y-1.5">
                  <Label htmlFor="ai-endpoint">API endpoint</Label>
                  <Input
                    id="ai-endpoint"
                    value={cfg.endpoint}
                    onChange={(e) => save({ endpoint: e.target.value })}
                    placeholder="https://api.ppq.ai/v1"
                    className="font-mono text-sm"
                  />
                </div>

                {/* Model */}
                <div className="space-y-1.5">
                  <Label htmlFor="ai-model">Model</Label>
                  <div className="flex gap-2">
                    <Input
                      id="ai-model"
                      value={cfg.model}
                      onChange={(e) => save({ model: e.target.value })}
                      placeholder="auto"
                      className="font-mono text-sm"
                      list="ai-models"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void loadModels()}
                      disabled={loadingModels}
                      className="shrink-0"
                    >
                      {loadingModels ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Load models'}
                    </Button>
                  </div>
                  <datalist id="ai-models">
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                    ))}
                  </datalist>
                  <p className="text-[11px] text-muted-foreground/70">
                    Leave as <code className="font-mono">auto</code> for the provider&apos;s router default.
                  </p>
                </div>
              </fieldset>

              {/* Privacy: include Nostr results */}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Include Nostr results in AI evidence</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    Nostr content is tied to identities. Off = only web/wiki/news/code results are sent.
                  </p>
                </div>
                <Switch
                  checked={cfg.includeNostr}
                  onCheckedChange={(checked) => save({ includeNostr: checked })}
                  aria-label="Include Nostr results in AI evidence"
                />
              </div>

              {/* Ready state */}
              {ready && (
                <p className="text-[11px] text-green-600 dark:text-green-500">
                  {onCommunity
                    ? `Active on the free community key (${COMMUNITY_AI_MODEL}) — shared and rate-limited.`
                    : keylessProvider && !ownKey
                      ? 'Active — running against your keyless provider.'
                      : 'Active on your own key — your next search will include an AI-synthesized answer.'}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <p className="text-[11px] text-muted-foreground/70 mt-3 leading-relaxed">
        Requests route through the CORS proxy (most AI APIs block browser CORS), so the proxy
        sees the request including the key in use. For maximum privacy run a local model
        (Ollama) with your own setup.
      </p>
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
  kind: 'search' | 'index' | 'git' | 'wiki';
}

/**
 * Generic relay pool editor. Every relay — default or custom — is
 * user-changeable: customs are deleted, defaults are hidden (restorable
 * via "Restore defaults").
 *
 * Hooks are called unconditionally (rules of hooks) and the active pool is
 * selected after — cheap: each pool hook is a localStorage read + useState.
 */
function RelayPoolSection({ title, description, addLabel, kind }: RelayPoolSectionProps) {
  const searchPool = useSearchRelayPool();
  const indexPool = useIndexRelayPool();
  const gitPool = useGitRelayPool();
  const wikiPool = useWikiRelayPool();
  const { pool, testing, testRelays, addRelay, removeRelay, restoreDefaults, hiddenCount } =
    kind === 'search' ? searchPool : kind === 'index' ? indexPool : kind === 'git' ? gitPool : wikiPool;
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
      <div className="flex flex-wrap items-center justify-between mb-1 gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold shrink-0">{title}</h2>
        <div className="flex items-center gap-2 flex-wrap">
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
    label: 'Default',
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
  const { pool, refreshing, refresh, addInstance, removeInstance, toggleInstance, discoveredAt, discoveryOn, setDiscovery } = useSearxngInstances();
  const { toast } = useToast();
  const [newUrl, setNewUrl] = useState('');

  const custom = pool.filter((p) => p.origin === 'custom');
  const discovered = pool.filter((p) => p.origin === 'discovered');
  const seeds = pool.filter((p) => p.origin === 'seed');

  const handleToggle = (url: string) => {
    const disabled = toggleInstance(url);
    toast({
      title: disabled ? 'Instance disabled' : 'Instance enabled',
      description: url,
    });
  };

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
          disabled={refreshing || !discoveryOn}
          title={discoveryOn ? 'Refresh discovered instances' : 'Enable discovery below first'}
        >
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        The default instances below are the active pool from first run — health-tracked in
        your browser, self-healing. Live discovery from{' '}
        <a
          href="https://searx.space"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-0.5"
        >
          searx.space
          <ExternalLink className="w-3 h-3" />
        </a>
        {' '}is opt-in.
        {discoveryOn && discoveredAt && (
          <span className="block mt-1 text-muted-foreground/70">
            Last discovery: {new Date(discoveredAt).toLocaleString()}
          </span>
        )}
      </p>

      {/* Discovery opt-in */}
      <Card className={cn('mb-6 transition-colors', discoveryOn ? 'border-primary/30 bg-primary/5' : 'border-border/60')}>
        <CardContent className="py-4 flex items-start gap-4">
          <div className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
            discoveryOn ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted text-muted-foreground border-border',
          )}>
            <Globe className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Discover public instances</span>
              <Switch
                checked={discoveryOn}
                onCheckedChange={(checked) => {
                  setDiscovery(checked);
                  toast({
                    title: checked ? 'Discovery enabled' : 'Discovery disabled',
                    description: checked
                      ? 'Live instances from searx.space join the pool (privacy-filtered).'
                      : 'Back to the default instance set only.',
                  });
                }}
                aria-label="Toggle live instance discovery"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {discoveryOn
                ? 'On — the pool includes privacy-filtered instances discovered live from searx.space.'
                : 'Off (default) — only your custom instances and the defaults run. Faster first search, no searx.space request.'}
            </p>
          </div>
        </CardContent>
      </Card>

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
                onToggle={() => handleToggle(inst.url)}
                onRemove={() => {
                  removeInstance(inst.url);
                  toast({ title: 'Instance removed', description: inst.url });
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* Default list */}
      <SectionHeader title="Default" count={seeds.length} />
      <div className="space-y-2 mb-6">
        {seeds.map((inst) => (
          <InstanceRow key={inst.url} inst={inst} onToggle={() => handleToggle(inst.url)} />
        ))}
      </div>

      {/* Discovered list (opt-in) */}
      <SectionHeader title="Discovered" count={discovered.length} />
      {discovered.length > 0 ? (
        <div className="space-y-2">
          {discovered.map((inst) => (
            <InstanceRow key={inst.url} inst={inst} onToggle={() => handleToggle(inst.url)} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              {discoveryOn
                ? refreshing
                  ? 'Discovering live instances…'
                  : 'No discovered instances yet — hit Refresh to fetch the live pool.'
                : 'Discovery is off. Turn it on above to pull live instances from searx.space.'}
            </p>
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground/70 mt-3 leading-relaxed">
        Click the power button to enable/disable any instance — disabled instances stay in
        your list but are skipped by search. Custom instances can also be removed entirely.
      </p>
    </section>
  );
}

/** Brave tab — BYOK card for the Brave Search API. */
function BraveSection() {
  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Brave Search</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Brave's official Search API joins the web engine pool when you add your own free key.
      </p>
      <BraveKeyCard />
    </section>
  );
}

/** Brave Search API key (BYOK — free tier, stored locally only). */
function BraveKeyCard() {
  const { toast } = useToast();
  const { config, updateConfig } = useAppContext();
  const [key, setKey] = useState(() => getBraveApiKey());

  const active = getBraveApiKey().length > 0;

  /** Adding a key opts the engine in; removing it parks the engine again. */
  const syncEngineToggle = (hasKey: boolean) => {
    const current = config.disabledProviders ?? [];
    if (hasKey && current.includes('brave')) {
      updateConfig(() => ({ disabledProviders: current.filter((p) => p !== 'brave') }));
    } else if (!hasKey && !current.includes('brave')) {
      updateConfig(() => ({ disabledProviders: [...current, 'brave'] }));
    }
  };

  return (
    <Card className={cn('mb-6 transition-colors', active ? 'border-orange-500/30 bg-orange-500/5' : 'border-border/60')}>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-medium">Brave Search API</span>
          {active && (
            <Badge variant="outline" className="text-[10px] border-orange-500/30 text-orange-600 dark:text-orange-400">
              Active
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          Brave's API has a <strong className="text-foreground">free tier</strong> (2,000 queries/month) but
          needs a key. Paste your own — it's stored only in this browser and joins the search pool instantly.{' '}
          <a
            href="https://brave.com/search/api/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            Get a free key
            <ExternalLink className="w-3 h-3" />
          </a>
        </p>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="BSA… (your Brave API key)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="font-mono text-sm"
            aria-label="Brave Search API key"
            autoComplete="off"
          />
          <Button
            variant={active ? 'outline' : 'default'}
            className="shrink-0"
            onClick={() => {
              setBraveApiKey(key);
              const nowActive = getBraveApiKey().length > 0;
              syncEngineToggle(nowActive);
              toast({
                title: nowActive ? 'Brave Search enabled' : 'Brave Search disabled',
                description: nowActive
                  ? 'Brave results now join every web search.'
                  : 'Key removed — the Brave provider is dormant.',
              });
            }}
          >
            {active ? 'Update' : 'Save'}
          </Button>
          {active && (
            <Button
              variant="ghost"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => {
                setBraveApiKey('');
                setKey('');
                syncEngineToggle(false);
                toast({ title: 'Brave Search disabled', description: 'Key removed.' });
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
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

function InstanceRow({ inst, onRemove, onToggle }: {
  inst: PoolInstance;
  onRemove?: () => void;
  onToggle?: () => void;
}) {
  const meta = ORIGIN_META[inst.origin];
  const hostname = (() => {
    try { return new URL(inst.url).hostname; } catch { return inst.url; }
  })();
  const disabled = inst.disabled === true;

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
      disabled
        ? 'border-border/40 bg-card/50 opacity-60'
        : 'border-border/60 bg-card hover:border-border',
    )}>
      {/* One-click enable/disable — works for every origin */}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={!disabled}
        aria-label={disabled ? `Enable ${hostname}` : `Disable ${hostname}`}
        title={disabled ? 'Enable this instance' : 'Disable this instance'}
        className={cn(
          'shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border transition-colors',
          disabled
            ? 'border-border/60 text-muted-foreground/50 hover:text-foreground'
            : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
        )}
      >
        <Power className="w-3.5 h-3.5" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
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
          {disabled && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
              Off
            </Badge>
          )}
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
    title: 'Settings - Presearchstr',
    description: 'Configure appearance and SearXNG instances for Presearchstr.',
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
        <p className="text-muted-foreground mb-6">
          Everything is stored locally in your browser. Nothing leaves your device except search queries.
        </p>

        <Tabs defaultValue="general">
          <TabsList className="mb-8 flex-wrap h-auto">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="engines">Engines</TabsTrigger>
            <TabsTrigger value="searxng">SearXNG</TabsTrigger>
            <TabsTrigger value="brave">Brave</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
            <TabsTrigger value="relays">Relays</TabsTrigger>
            <TabsTrigger value="indexer">Auto Indexer</TabsTrigger>
          </TabsList>

          {/* Themes, tab bar config, privacy */}
          <TabsContent value="general">
            <AppearanceSection />
            <Separator className="mb-10" />
            <SearchTabsSection />
            <Separator className="mb-10" />
            <PrivacySection />
          </TabsContent>

          {/* Engine toggles */}
          <TabsContent value="engines">
            <EnginesSection />
          </TabsContent>

          {/* SearXNG instance pool */}
          <TabsContent value="searxng">
            <InstancesSection />
          </TabsContent>

          {/* Brave Search API key */}
          <TabsContent value="brave">
            <BraveSection />
          </TabsContent>

          {/* AI answer layer */}
          <TabsContent value="ai">
            <AISection />
          </TabsContent>

          {/* Relay pools */}
          <TabsContent value="relays">
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
              description="NIP-50 relays queried in parallel for every full-text Nostr search. Presearchstr's defaults are suggestions — hide any of them or add your own."
              addLabel="Custom search relay URL"
              kind="search"
            />
            <Separator className="mb-10" />
            <RelayPoolSection
              title="Git Relays"
              description="Read-only NIP-34 pool for the Code tab — ngit/GRASP servers and git indexers serving repository announcements, issues, PRs, and patches. Nothing is ever published to these."
              addLabel="Custom git relay URL"
              kind="git"
            />
            <Separator className="mb-10" />
            <RelayPoolSection
              title="Wiki Relays"
              description="Read-only NIP-54 pool for Nostr-native wiki articles (the relays wikistr reads: relay.wikifreedia.xyz and friends). Nothing is ever published to these."
              addLabel="Custom wiki relay URL"
              kind="wiki"
            />
          </TabsContent>

          {/* Auto-indexing + the community index identity */}
          <TabsContent value="indexer">
            <IndexingSection />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

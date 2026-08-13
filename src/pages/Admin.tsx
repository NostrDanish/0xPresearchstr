/**
 * Admin dashboard — hidden owner console (not linked in any nav).
 *
 * Route: /admin. Functional only when the owner key is logged in
 * (npub1udrj…). Everyone else gets a quiet access-denied card.
 *
 * Tabs:
 *   - Stats      — index + community metrics at a glance
 *   - Reports    — the NIP-56 abuse inbox (kind 1984, 0xsearchstr.abuse)
 *   - Moderation — owner-signed hidden targets (NIP-32 labels), un-hide
 *   - Filter     — test whether a URL/event id is currently filtered
 *
 * Moderation is Nostr-native: hiding publishes a kind 1985 label signed by
 * the owner key; every client filters results against owner-signed labels
 * (author filter = the trust boundary). Un-hiding publishes a NIP-09
 * deletion of the label.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import {
  ShieldCheck, BarChart3, Flag, EyeOff, SearchCheck, Database,
  FileText, Gem, Inbox, Globe, Zap, Clock, ExternalLink,
  Loader2, Eye, RotateCcw,
} from 'lucide-react';

import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoginArea } from '@/components/auth/LoginArea';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { useCachedQueries } from '@/hooks/useCachedQueries';
import { useRecentIndexedDocs } from '@/hooks/useRecentIndexedDocs';
import { useRecentStakes } from '@/hooks/useRecentStakes';
import {
  useAbuseReports,
  useHiddenTargets,
  useModerationActions,
  useModerationSet,
} from '@/hooks/useModeration';
import {
  OWNER_PUBKEY,
  isHiddenResult,
  type HiddenTarget,
  type AbuseReport,
} from '@/lib/moderation';
import { normalizeIndexUrl } from '@/lib/webIndex';
import { getIndexRelayUrls, getSearchRelayUrls } from '@/lib/appRelays';

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortNpub(hex: string): string {
  const npub = nip19.npubEncode(hex);
  return `${npub.slice(0, 12)}…${npub.slice(-4)}`;
}

export default function Admin() {
  const { user } = useCurrentUser();
  const isOwner = user?.pubkey === OWNER_PUBKEY;

  useSeoMeta({
    title: 'Admin - Presearchstr',
    description: 'Owner console.',
  });

  return (
    <Layout>
      <div className="container max-w-3xl py-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        </div>
        <p className="text-muted-foreground mb-8 text-sm">
          Owner console — index stats, abuse reports, and result moderation.
        </p>

        {!user ? (
          <Card className="border-dashed">
            <CardContent className="py-12 px-8 text-center space-y-4">
              <p className="text-muted-foreground max-w-sm mx-auto text-sm">
                This console requires the owner key.
              </p>
              <LoginArea className="max-w-56 mx-auto" />
            </CardContent>
          </Card>
        ) : !isOwner ? (
          <Card className="border-dashed">
            <CardContent className="py-12 px-8 text-center">
              <p className="text-muted-foreground max-w-sm mx-auto text-sm">
                Signed in as <span className="font-mono">{shortNpub(user.pubkey)}</span> — no admin access.
              </p>
              <Link to="/" className="inline-block mt-4 text-sm text-primary hover:underline">
                Back to search
              </Link>
            </CardContent>
          </Card>
        ) : (
          <AdminTabs />
        )}
      </div>
    </Layout>
  );
}

/* ─── Tabs ─── */

function AdminTabs() {
  return (
    <Tabs defaultValue="stats">
      <TabsList className="mb-6">
        <TabsTrigger value="stats" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Stats</TabsTrigger>
        <TabsTrigger value="reports" className="gap-1.5"><Flag className="w-3.5 h-3.5" />Reports</TabsTrigger>
        <TabsTrigger value="moderation" className="gap-1.5"><EyeOff className="w-3.5 h-3.5" />Moderation</TabsTrigger>
        <TabsTrigger value="filter" className="gap-1.5"><SearchCheck className="w-3.5 h-3.5" />Filter test</TabsTrigger>
      </TabsList>
      <TabsContent value="stats"><StatsTab /></TabsContent>
      <TabsContent value="reports"><ReportsTab /></TabsContent>
      <TabsContent value="moderation"><ModerationTab /></TabsContent>
      <TabsContent value="filter"><FilterTab /></TabsContent>
    </Tabs>
  );
}

/* ─── Stats ─── */

function StatsTab() {
  const { data: cached, isLoading: cachedLoading } = useCachedQueries();
  const { data: docs, isLoading: docsLoading } = useRecentIndexedDocs();
  const { data: stakes } = useRecentStakes();
  const { data: reports } = useAbuseReports();
  const hidden = useHiddenTargets();

  const totalCachedResults = cached?.reduce((sum, e) => sum + e.resultCount, 0) ?? 0;

  const stats = [
    { icon: <FileText className="w-4 h-4" />, label: 'Indexed pages (SIP-01)', value: docs?.length, loading: docsLoading },
    { icon: <Database className="w-4 h-4" />, label: 'Cached queries (legacy)', value: cached?.length, loading: cachedLoading },
    { icon: <BarChart3 className="w-4 h-4" />, label: 'Cached results (legacy)', value: cached ? totalCachedResults : undefined, loading: cachedLoading },
    { icon: <Gem className="w-4 h-4" />, label: 'Staked keywords', value: stakes?.length },
    { icon: <Inbox className="w-4 h-4" />, label: 'Open abuse reports', value: reports?.length },
    { icon: <EyeOff className="w-4 h-4" />, label: 'Hidden targets', value: hidden?.length },
    { icon: <Globe className="w-4 h-4" />, label: 'Index relays (your pool)', value: getIndexRelayUrls().length },
    { icon: <Zap className="w-4 h-4" />, label: 'Search relays (your pool)', value: getSearchRelayUrls().length },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardContent className="py-4 px-5 flex items-center gap-3">
            <span className="text-primary shrink-0">{s.icon}</span>
            <div className="min-w-0">
              {s.loading || s.value === undefined ? (
                <Skeleton className="h-6 w-12 mb-1" />
              ) : (
                <p className="text-xl font-bold tracking-tight">{s.value.toLocaleString()}</p>
              )}
              <p className="text-[11px] text-muted-foreground truncate">{s.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── Reports (NIP-56 inbox) ─── */

const TYPE_COLORS: Record<string, string> = {
  illegal: 'border-destructive/40 text-destructive',
  malware: 'border-destructive/40 text-destructive',
  spam: 'border-amber-500/40 text-amber-600 dark:text-amber-500',
  nudity: 'border-amber-500/40 text-amber-600 dark:text-amber-500',
  profanity: 'border-amber-500/40 text-amber-600 dark:text-amber-500',
  impersonation: 'border-primary/40 text-primary',
  other: 'border-border text-muted-foreground',
};

function ReportsTab() {
  const { data: reports, isLoading } = useAbuseReports();
  const hidden = useModerationSet();
  const { hideTarget } = useModerationActions();
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleHide = async (report: AbuseReport) => {
    setPendingId(report.id);
    try {
      const target = report.targetKind === 'url'
        ? { url: report.target }
        : report.targetKind === 'event'
          ? { eventId: report.target }
          : null;
      if (!target) {
        toast({ title: 'Cannot hide this target type', description: 'Only URLs and events can be hidden.', variant: 'destructive' });
        return;
      }
      await hideTarget(target);
      toast({ title: 'Hidden from results', description: 'The moderation label is published to the index relays.' });
    } catch (err) {
      toast({ title: 'Failed', description: err instanceof Error ? err.message : 'Publish failed', variant: 'destructive' });
    } finally {
      setPendingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}><CardContent className="py-4 px-5 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (!reports || reports.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 px-8 text-center">
          <Inbox className="w-7 h-7 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No reports. The NIP-56 inbox is quiet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {reports.map((report) => {
        const alreadyHidden = hidden && (
          (report.targetKind === 'url' && hidden.urls.has(normalizeIndexUrl(report.target) ?? report.target))
          || (report.targetKind === 'event' && hidden.eventIds.has(report.target.toLowerCase()))
        );
        return (
          <Card key={report.id}>
            <CardContent className="py-4 px-5">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Badge variant="outline" className={`text-[10px] ${TYPE_COLORS[report.type] ?? TYPE_COLORS.other}`}>
                  {report.type}
                </Badge>
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  {report.targetKind}
                </Badge>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 ml-auto">
                  <Clock className="w-3 h-3" />
                  {timeAgo(report.createdAt)}
                </span>
              </div>
              <p className="font-mono text-xs text-foreground break-all mb-1.5">{report.target}</p>
              {report.content && (
                <p className="text-sm text-muted-foreground mb-2 whitespace-pre-wrap">{report.content}</p>
              )}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className="text-[11px] text-muted-foreground/60">
                  by <Link to={`/${nip19.npubEncode(report.reporter)}`} className="font-mono hover:text-primary transition-colors">{shortNpub(report.reporter)}</Link>
                </span>
                <span className="flex-1" />
                {report.targetKind === 'url' && (
                  <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
                    <a href={report.target} target="_blank" rel="noopener noreferrer">
                      Open <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </Button>
                )}
                {alreadyHidden ? (
                  <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">
                    <EyeOff className="w-3 h-3 mr-1" /> Hidden
                  </Badge>
                ) : (report.targetKind === 'url' || report.targetKind === 'event') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    disabled={pendingId === report.id}
                    onClick={() => void handleHide(report)}
                  >
                    {pendingId === report.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <EyeOff className="w-3 h-3 mr-1" />}
                    Hide from results
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─── Moderation (hidden targets) ─── */

function ModerationTab() {
  const hidden = useHiddenTargets();
  const { unhideTarget } = useModerationActions();
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [manualTarget, setManualTarget] = useState('');
  const { hideTarget } = useModerationActions();

  const handleUnhide = async (t: HiddenTarget) => {
    setPendingId(t.labelEventId);
    try {
      await unhideTarget(t.labelEventId);
      toast({ title: 'Un-hidden', description: 'Deletion request published (NIP-09).' });
    } catch (err) {
      toast({ title: 'Failed', description: err instanceof Error ? err.message : 'Publish failed', variant: 'destructive' });
    } finally {
      setPendingId(null);
    }
  };

  const handleManualHide = async () => {
    const input = manualTarget.trim();
    if (!input) return;
    setPendingId('manual');
    try {
      if (/^[0-9a-f]{64}$/i.test(input)) {
        await hideTarget({ eventId: input });
      } else {
        await hideTarget({ url: input });
      }
      toast({ title: 'Hidden from results', description: input });
      setManualTarget('');
    } catch (err) {
      toast({ title: 'Failed', description: err instanceof Error ? err.message : 'Publish failed', variant: 'destructive' });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Manual hide */}
      <Card className="border-destructive/20">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground mb-3">
            Hide any URL or event id from results (publishes an owner-signed NIP-32 label to the index relays).
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="https://… or 64-hex event id"
              value={manualTarget}
              onChange={(e) => setManualTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleManualHide()}
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              onClick={() => void handleManualHide()}
              disabled={pendingId === 'manual' || !manualTarget.trim()}
              className="shrink-0 text-destructive"
            >
              {pendingId === 'manual' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <EyeOff className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!hidden || hidden.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 px-8 text-center">
            <Eye className="w-7 h-7 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nothing hidden — all results are visible.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {hidden.map((t) => (
            <Card key={t.labelEventId}>
              <CardContent className="py-3 px-4 flex items-center gap-3">
                <EyeOff className="w-4 h-4 text-destructive/70 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs truncate">{t.value}</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                    {t.targetType === 'u' ? 'URL' : 'Event'} · hidden {timeAgo(t.createdAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  disabled={pendingId === t.labelEventId}
                  onClick={() => void handleUnhide(t)}
                >
                  {pendingId === t.labelEventId ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3 h-3 mr-1" />
                  )}
                  Unhide
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Filter test ─── */

function FilterTab() {
  const moderationSet = useModerationSet();
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState<{ input: string; hidden: boolean; normalized: string | null } | null>(null);

  const check = () => {
    const value = input.trim();
    if (!value) return;
    const isHexEvent = /^[0-9a-f]{64}$/i.test(value);
    const normalized = isHexEvent ? null : normalizeIndexUrl(value);
    const hidden = moderationSet
      ? isHiddenResult({ url: value, ...(isHexEvent ? { nostrEvent: { id: value.toLowerCase() } } : {}) }, moderationSet)
      : false;
    setChecked({ input: value, hidden, normalized });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Would this be filtered?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="https://… or 64-hex event id"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && check()}
              className="font-mono text-sm"
            />
            <Button onClick={check} disabled={!input.trim() || !moderationSet} className="shrink-0">
              <SearchCheck className="w-4 h-4 mr-1.5" />
              Check
            </Button>
          </div>
          {!moderationSet && (
            <p className="text-xs text-muted-foreground">Loading the moderation set…</p>
          )}
          {checked && moderationSet && (
            <div className={cn2(checked.hidden)}>
              <p className="text-sm font-medium">
                {checked.hidden ? 'Hidden — filtered from all users\u2019 results' : 'Visible — not on the moderation list'}
              </p>
              {checked.normalized && checked.normalized !== checked.input && (
                <p className="text-[11px] font-mono text-muted-foreground/70 mt-1 break-all">
                  normalized: {checked.normalized}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        Filtering is applied in <code className="font-mono">useProviderSearch</code> for every user,
        against labels signed by the owner key only.
      </p>
    </div>
  );
}

function cn2(hidden: boolean): string {
  return hidden
    ? 'p-3 rounded-lg text-sm bg-destructive/5 border border-destructive/20 text-destructive'
    : 'p-3 rounded-lg text-sm bg-green-500/5 border border-green-500/20 text-green-600 dark:text-green-500';
}

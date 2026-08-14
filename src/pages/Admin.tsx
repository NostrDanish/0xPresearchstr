/**
 * Admin dashboard — hidden team console (not linked in any nav).
 *
 * Route: /admin. Functional when the owner key or an owner-listed
 * admin/moderator key is logged in. Everyone else gets a quiet
 * access-denied card.
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
import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import {
  ShieldCheck, BarChart3, Flag, EyeOff, SearchCheck, Database,
  FileText, Gem, Inbox, Globe, Zap, Clock, ExternalLink,
  Loader2, Eye, RotateCcw, Users, Crown, UserCog, Plus, Trash2,
  Sparkles, Lock, RefreshCw, CheckCircle2, XCircle, KeyRound,
} from 'lucide-react';

import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoginArea } from '@/components/auth/LoginArea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { useAuthor } from '@/hooks/useAuthor';
import { useEngineAIStatus } from '@/hooks/useEngineAIStatus';
import { sendEngineAIAction, testEngineAI } from '@/lib/ai/engineAdmin';
import { AI_PROVIDERS, getAIProvider } from '@/lib/ai/registry';
import { useCachedQueries } from '@/hooks/useCachedQueries';
import { useRecentIndexedDocs } from '@/hooks/useRecentIndexedDocs';
import { useRecentStakes } from '@/hooks/useRecentStakes';
import {
  useAbuseReports,
  useHiddenTargets,
  useModerationActions,
  useModerationSet,
  useRoleActions,
} from '@/hooks/useModeration';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import {
  OWNER_PUBKEY,
  ADMIN_ROLES_D_TAG,
  MOD_ROLES_D_TAG,
  isHiddenResult,
  type AppRole,
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
  const { role, isMod, isLoading } = useAdminAccess();

  useSeoMeta({
    title: 'Admin - Presearchstr',
    description: 'Team console.',
  });

  return (
    <Layout>
      <div className="container max-w-3xl py-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
          {isMod && <RoleBadge role={role} />}
        </div>
        <p className="text-muted-foreground mb-8 text-sm">
          Team console — index stats, abuse reports, and result moderation.
        </p>

        {!user ? (
          <Card className="border-dashed">
            <CardContent className="py-12 px-8 text-center space-y-4">
              <p className="text-muted-foreground max-w-sm mx-auto text-sm">
                This console requires a team key.
              </p>
              <LoginArea className="max-w-56 mx-auto" />
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !isMod ? (
          <Card className="border-dashed">
            <CardContent className="py-12 px-8 text-center">
              <p className="text-muted-foreground max-w-sm mx-auto text-sm">
                Signed in as <span className="font-mono">{shortNpub(user.pubkey)}</span> — no team access.
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
  const { canManageRoles } = useAdminAccess();

  return (
    <Tabs defaultValue="stats">
      <TabsList className="mb-6 flex-wrap h-auto">
        <TabsTrigger value="stats" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Stats</TabsTrigger>
        <TabsTrigger value="reports" className="gap-1.5"><Flag className="w-3.5 h-3.5" />Reports</TabsTrigger>
        <TabsTrigger value="moderation" className="gap-1.5"><EyeOff className="w-3.5 h-3.5" />Moderation</TabsTrigger>
        <TabsTrigger value="filter" className="gap-1.5"><SearchCheck className="w-3.5 h-3.5" />Filter test</TabsTrigger>
        <TabsTrigger value="ai" className="gap-1.5"><Sparkles className="w-3.5 h-3.5" />AI</TabsTrigger>
        {canManageRoles && (
          <TabsTrigger value="roles" className="gap-1.5"><Users className="w-3.5 h-3.5" />Roles</TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="stats"><StatsTab /></TabsContent>
      <TabsContent value="reports"><ReportsTab /></TabsContent>
      <TabsContent value="moderation"><ModerationTab /></TabsContent>
      <TabsContent value="filter"><FilterTab /></TabsContent>
      <TabsContent value="ai"><AITab /></TabsContent>
      {canManageRoles && <TabsContent value="roles"><RolesTab /></TabsContent>}
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

/* ─── AI (engine-provided tier) ─── */

/**
 * Engine-AI management. The key lives SERVER-SIDE (worker env secret or KV)
 * and is never readable here — the status endpoint returns only provider,
 * model, and the last 4 characters as a masked fingerprint.
 *
 * Writes (set/clear/toggle) are signed NIP-98-style events from the owner
 * key; the worker verifies signature + pubkey + freshness. Team members
 * without the owner key see status only.
 */
function AITab() {
  const { user } = useCurrentUser();
  const { isOwner } = useAdminAccess();
  const { status, isLoading } = useEngineAIStatus();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [providerId, setProviderId] = useState('ppq');
  const [endpoint, setEndpoint] = useState('https://api.ppq.ai/v1');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const refreshStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['engine-ai-status'] });
  }, [queryClient]);

  const doAction = async (action: Parameters<typeof sendEngineAIAction>[1], what: string) => {
    if (!user) return;
    setPending(what);
    try {
      const status = await sendEngineAIAction(user.signer, action);
      toast({ title: `${what} applied`, description: status.configured ? `Model: ${status.model}` : 'Engine AI cleared' });
      setTestResult(null);
      refreshStatus();
    } catch (err) {
      toast({
        title: `${what} failed`,
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setPending(null);
    }
  };

  const handleSave = () => {
    const provider = getAIProvider(providerId);
    void doAction({
      action: 'set',
      apiKey,
      endpoint: endpoint.trim() || provider?.defaultEndpoint,
      model: model.trim() || undefined,
      providerName: provider?.name,
    }, 'Configuration');
  };

  const handleTest = async () => {
    setPending('test');
    setTestResult(null);
    setTestResult(await testEngineAI());
    setPending(null);
  };

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  // Static-only deployment: the worker isn't there, so engine AI can't be.
  if (!status) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 px-8 text-center">
          <Sparkles className="w-7 h-7 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            The engine-AI proxy (<code className="font-mono text-xs">/api/ai</code>) isn't reachable on
            this deployment. Engine-provided AI requires deploying with the included worker
            (see README → Engine-provided AI). Users can still add their own keys in
            Settings → AI.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status — safe fields only, key is masked to its last 4 chars */}
      <Card className={status.configured && status.enabled ? 'border-primary/25 bg-primary/[0.03]' : 'border-border/60'}>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Engine-provided AI</span>
            {status.configured ? (
              status.enabled ? (
                <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-600 dark:text-green-500">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Live
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-500">
                  Configured · disabled
                </Badge>
              )
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Not configured
              </Badge>
            )}
            <span className="ml-auto" />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={pending !== null || !status.configured || !status.enabled}
              onClick={() => void handleTest()}
            >
              {pending === 'test' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
              Test
            </Button>
          </div>

          {status.configured ? (
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <p className="text-muted-foreground">Provider: <span className="text-foreground font-medium">{status.providerName ?? '—'}</span></p>
              <p className="text-muted-foreground">Model: <span className="font-mono text-foreground">{status.model ?? '—'}</span></p>
              <p className="text-muted-foreground truncate">Endpoint: <span className="font-mono text-foreground">{status.endpoint ?? '—'}</span></p>
              <p className="text-muted-foreground">Key: <span className="font-mono text-foreground">…{status.keyTail}</span> <span className="text-muted-foreground/60">(masked)</span></p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed">
              No engine key configured. Users fall back to their own keys (Settings → AI).
              {isOwner
                ? ' Configure one below, or set AI_API_KEY as a worker secret and redeploy.'
                : ' Only the owner can configure engine AI.'}
            </p>
          )}

          {testResult && (
            <p className={`text-xs mt-3 flex items-center gap-1.5 ${testResult.ok ? 'text-green-600 dark:text-green-500' : 'text-destructive'}`}>
              {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {testResult.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Owner-only editor */}
      {isOwner && user && (
        <Card className="border-yellow-500/20">
          <CardContent className="py-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Crown className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-500" />
                <span className="text-xs font-semibold">Owner controls</span>
              </div>
              {status.configured && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Enabled</span>
                  <Switch
                    checked={status.enabled}
                    disabled={pending !== null}
                    onCheckedChange={(enabled) => void doAction({ action: 'set-enabled', enabled }, enabled ? 'Enable' : 'Disable')}
                    aria-label="Toggle engine-provided AI"
                  />
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="engine-ai-provider">Provider</label>
                <select
                  id="engine-ai-provider"
                  value={providerId}
                  onChange={(e) => {
                    const next = getAIProvider(e.target.value);
                    setProviderId(e.target.value);
                    setEndpoint(next?.defaultEndpoint ?? endpoint);
                  }}
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring dark:bg-input/30"
                >
                  {AI_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="engine-ai-model">Model</label>
                <Input
                  id="engine-ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={status.model ?? 'qwen/qwen-2.5-7b-instruct'}
                  className="font-mono text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="engine-ai-endpoint">API endpoint</label>
              <Input
                id="engine-ai-endpoint"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://api.ppq.ai/v1"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="engine-ai-key">API key</label>
              <Input
                id="engine-ai-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={status.keyTail ? `Current key ends …${status.keyTail} — paste to replace` : 'sk-…'}
                className="font-mono text-sm"
                autoComplete="off"
              />
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Sent once, signed with your owner key, straight to your deployment over TLS —
                then stored server-side only. It is never written to this browser's storage,
                the repo, or any public response.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                disabled={pending !== null || apiKey.trim().length < 8}
                onClick={handleSave}
              >
                {pending === 'Configuration' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5 mr-1.5" />}
                Save configuration
              </Button>
              {status.configured && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={pending !== null}>
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                      Clear engine key
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear engine-provided AI?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The server-side key is deleted from runtime storage. Users without
                        their own key immediately lose AI answers. Env-var config, if any,
                        still applies after redeploy.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void doAction({ action: 'clear' }, 'Clear')}>
                        Clear engine key
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground/70 leading-relaxed flex items-start gap-1.5">
        <Lock className="w-3 h-3 mt-0.5 shrink-0" />
        Users on the engine tier call the same-origin proxy with no key; the worker injects
        the operator's key upstream. A user's own key (Settings → AI) always takes precedence.
      </p>
    </div>
  );
}

/* ─── Roles (owner only) ─── */

function RoleBadge({ role }: { role: AppRole }) {
  const cfg: Record<string, { cls: string; icon: React.ReactNode }> = {
    owner: { cls: 'border-yellow-500/40 text-yellow-600 dark:text-yellow-500', icon: <Crown className="w-2.5 h-2.5" /> },
    admin: { cls: 'border-primary/40 text-primary', icon: <ShieldCheck className="w-2.5 h-2.5" /> },
    moderator: { cls: 'border-clearnet/40 text-clearnet', icon: <UserCog className="w-2.5 h-2.5" /> },
    user: { cls: 'border-border text-muted-foreground', icon: null },
  };
  const c = cfg[role] ?? cfg.user;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-semibold capitalize ${c.cls}`}>
      {c.icon}{role}
    </span>
  );
}

/** One team member row (profile-resolved name + remove). */
function MemberRow({ pubkey, role, onRemove, removing }: {
  pubkey: string;
  role: 'admin' | 'moderator';
  onRemove: () => void;
  removing: boolean;
}) {
  const author = useAuthor(pubkey);
  const name = author.data?.metadata?.name || author.data?.metadata?.display_name || shortNpub(pubkey);
  const picture = author.data?.metadata?.picture;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border/60 bg-card">
      <Avatar size="sm" className="shrink-0">
        {picture && <AvatarImage src={picture} alt={name} />}
        <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-[11px] text-muted-foreground/60 font-mono truncate">{shortNpub(pubkey)}</p>
      </div>
      <RoleBadge role={role} />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
        disabled={removing}
        onClick={onRemove}
        aria-label={`Remove ${name}`}
      >
        {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
      </Button>
    </div>
  );
}

function RolesTab() {
  const { adminList, modList } = useAdminAccess();
  const { updateRoleList } = useRoleActions();
  const { toast } = useToast();
  const [newMember, setNewMember] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'moderator'>('moderator');
  const [pending, setPending] = useState<string | null>(null);

  const resolveToHex = (input: string): string | null => {
    const v = input.trim();
    if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase();
    if (v.startsWith('npub1') || v.startsWith('nprofile1')) {
      try {
        const decoded = nip19.decode(v);
        if (decoded.type === 'npub') return decoded.data;
        if (decoded.type === 'nprofile') return decoded.data.pubkey;
      } catch { /* fall through */ }
    }
    return null;
  };

  const handleAdd = async () => {
    const hex = resolveToHex(newMember);
    if (!hex) {
      toast({ title: 'Invalid key', description: 'Enter an npub…, nprofile1…, or 64-char hex pubkey.', variant: 'destructive' });
      return;
    }
    const list = newRole === 'admin' ? adminList : modList;
    if (hex === OWNER_PUBKEY || adminList.includes(hex) || modList.includes(hex)) {
      toast({ title: 'Already on the team', variant: 'destructive' });
      return;
    }
    setPending('add');
    try {
      await updateRoleList(newRole === 'admin' ? ADMIN_ROLES_D_TAG : MOD_ROLES_D_TAG, [...list, hex]);
      toast({ title: `${newRole === 'admin' ? 'Admin' : 'Moderator'} added`, description: shortNpub(hex) });
      setNewMember('');
    } catch (err) {
      toast({ title: 'Failed', description: err instanceof Error ? err.message : 'Publish failed', variant: 'destructive' });
    } finally {
      setPending(null);
    }
  };

  const handleRemove = async (role: 'admin' | 'moderator', hex: string) => {
    const list = role === 'admin' ? adminList : modList;
    setPending(hex);
    try {
      await updateRoleList(
        role === 'admin' ? ADMIN_ROLES_D_TAG : MOD_ROLES_D_TAG,
        list.filter((p) => p !== hex),
      );
      toast({ title: `${role === 'admin' ? 'Admin' : 'Moderator'} removed`, description: shortNpub(hex) });
    } catch (err) {
      toast({ title: 'Failed', description: err instanceof Error ? err.message : 'Publish failed', variant: 'destructive' });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add member */}
      <Card className="border-primary/20">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground mb-3">
            Add a team member by npub or hex key. The role list is an owner-signed
            addressable event (kind 30078) — every client resolves it live.
          </p>
          <div className="flex gap-2 flex-wrap sm:flex-nowrap">
            <Input
              placeholder="npub1… or 64-hex pubkey"
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
              className="font-mono text-sm"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'admin' | 'moderator')}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring dark:bg-input/30"
              aria-label="Role"
            >
              <option value="moderator">Moderator</option>
              <option value="admin">Admin</option>
            </select>
            <Button onClick={() => void handleAdd()} disabled={pending === 'add' || !newMember.trim()} className="shrink-0">
              {pending === 'add' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Owner (immutable) */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2">Owner</h3>
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
          <Crown className="w-4 h-4 text-yellow-600 dark:text-yellow-500 shrink-0" />
          <p className="font-mono text-xs truncate flex-1">{shortNpub(OWNER_PUBKEY)}</p>
          <RoleBadge role="owner" />
        </div>
      </div>

      {/* Admins */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2">Admins</h3>
        {adminList.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-6 text-center text-sm text-muted-foreground">No admins yet.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {adminList.map((hex) => (
              <MemberRow key={hex} pubkey={hex} role="admin" removing={pending === hex} onRemove={() => void handleRemove('admin', hex)} />
            ))}
          </div>
        )}
      </div>

      {/* Moderators */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2">Moderators</h3>
        {modList.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-6 text-center text-sm text-muted-foreground">No moderators yet.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {modList.map((hex) => (
              <MemberRow key={hex} pubkey={hex} role="moderator" removing={pending === hex} onRemove={() => void handleRemove('moderator', hex)} />
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        Admins and moderators see this console in their account menu and can hide/unhide
        results. Only the owner manages roles.
      </p>
    </div>
  );
}

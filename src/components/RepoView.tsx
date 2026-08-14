/**
 * Embedded NIP-34 repository view — the in-app repo page.
 *
 * Renders a kind 30617 repository announcement as a real repo page instead
 * of bouncing users to the author's announced `web` URL (often a local
 * GRASP instance like http://127.0.0.1:3000, dead for everyone else) or to
 * third-party viewers (git.iris.to is gone). Everything is relay data:
 *
 *   - Header: name, description, topics, maintainer, timestamps
 *   - Clone box: public https clone URLs + the nostr:// clone URI
 *   - Branches: from the repo state announcement (kind 30618) when published
 *   - Activity: issues (1621), PRs (1618), patches (1617) embedded in-app,
 *     with status badges (1630–1633: open/merged/closed/draft)
 *
 * No Blossom, no git smart-HTTP — pure relay reads via the git pool.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import {
  GitBranch, GitPullRequest, CircleDot, FileDiff, Copy, Check,
  ExternalLink, Users, User,
} from 'lucide-react';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { VoteButtons, VoteTalliesProvider } from '@/components/VoteButtons';
import { useAuthor } from '@/hooks/useAuthor';
import { sanitizePublicUrl } from '@/lib/sanitizeUrl';
import { npubShort, timeAgo } from '@/lib/nostrHelpers';
import { queryRelayPool } from '@/lib/searchRelays';
import { getGitRelayUrls } from '@/lib/appRelays';
import type { NostrMetadata } from '@nostrify/nostrify';

/* ─── NIP-34 parsing helpers ─── */

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}
function getTags(event: NostrEvent, name: string): string[] {
  return event.tags.filter(([n]) => n === name).map(([, v]) => v);
}

/** The addressable coordinate of a 30617 repo: "30617:<pubkey>:<d>". */
function repoAddress(event: NostrEvent): string {
  return `30617:${event.pubkey}:${getTag(event, 'd') ?? ''}`;
}

/** Status kinds (NIP-34): open / applied-merged-resolved / closed / draft. */
const STATUS_KINDS = [1630, 1631, 1632, 1633];

const STATUS_META: Record<number, { label: string; cls: string }> = {
  1630: { label: 'Open', cls: 'border-green-500/30 text-green-600 dark:text-green-500' },
  1631: { label: 'Merged', cls: 'border-primary/30 text-primary' },
  1632: { label: 'Closed', cls: 'border-destructive/30 text-destructive' },
  1633: { label: 'Draft', cls: 'border-amber-500/30 text-amber-600 dark:text-amber-500' },
};

/* ─── Activity (issues / PRs / patches) ─── */

interface ActivityItem {
  event: NostrEvent;
  kindLabel: string;
  title: string;
  status: number; // 1630 default = open
}

function activityTitle(event: NostrEvent): string {
  const subject = getTag(event, 'subject');
  if (subject?.trim()) return subject.trim();
  if (event.kind === 1617) {
    const m = event.content.match(/^Subject:\s*(?:\[PATCH[^\]]*\]\s*)?(.+)$/m);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  const firstLine = event.content.split('\n').find((l) => l.trim());
  return firstLine?.trim().slice(0, 90) || 'Untitled';
}

/** Latest status per target, authored by a maintainer or the item's author. */
function resolveStatuses(
  statusEvents: NostrEvent[],
  items: ActivityItem[],
  maintainers: Set<string>,
): Map<string, number> {
  const authorByItem = new Map(items.map((i) => [i.event.id, i.event.pubkey]));
  const latest = new Map<string, { kind: number; at: number }>();

  for (const ev of statusEvents) {
    const target = ev.tags.find(([n, , , marker]) => n === 'e' && marker === 'root')?.[1]
      ?? ev.tags.find(([n]) => n === 'e')?.[1];
    if (!target) continue;
    const itemAuthor = authorByItem.get(target);
    if (!itemAuthor) continue;
    if (ev.pubkey !== itemAuthor && !maintainers.has(ev.pubkey)) continue; // spec: author or maintainer

    const existing = latest.get(target);
    if (!existing || ev.created_at > existing.at) {
      latest.set(target, { kind: ev.kind, at: ev.created_at });
    }
  }

  return new Map([...latest].map(([id, s]) => [id, s.kind]));
}

function useRepoActivity(repo: NostrEvent) {
  const address = repoAddress(repo);
  const maintainers = useMemo(
    () => new Set([repo.pubkey, ...getTags(repo, 'maintainers')]),
    [repo],
  );

  return useQuery({
    queryKey: ['repo-activity', address],
    queryFn: async ({ signal }) => {
      const filters: NostrFilter[] = [
        { kinds: [1621, 1618, 1617], '#a': [address], limit: 100 },
      ];

      const activitySets = await queryRelayPool(getGitRelayUrls(), filters, { signal, timeoutMs: 6000 });

      const items = new Map<string, ActivityItem>();
      for (const events of activitySets) {
        for (const ev of events) {
          if (![1621, 1618, 1617].includes(ev.kind)) continue;
          if (items.has(ev.id)) continue;
          items.set(ev.id, {
            event: ev,
            kindLabel: ev.kind === 1621 ? 'Issue' : ev.kind === 1618 ? 'PR' : 'Patch',
            title: activityTitle(ev),
            status: 1630,
          });
        }
      }

      const list = [...items.values()].sort((a, b) => b.event.created_at - a.event.created_at);
      if (list.length === 0) return [] as ActivityItem[];

      // Status resolution: latest 163x per target from maintainer or author.
      const statusSets = await queryRelayPool(
        getGitRelayUrls(),
        [{ kinds: STATUS_KINDS, '#e': list.map((i) => i.event.id), limit: 300 }],
        { signal, timeoutMs: 6000 },
      );
      const statusEvents: NostrEvent[] = [];
      const seen = new Set<string>();
      for (const events of statusSets) {
        for (const ev of events) {
          if (!STATUS_KINDS.includes(ev.kind) || seen.has(ev.id)) continue;
          seen.add(ev.id);
          statusEvents.push(ev);
        }
      }
      const statuses = resolveStatuses(statusEvents, list, maintainers);
      for (const item of list) {
        item.status = statuses.get(item.event.id) ?? 1630;
      }

      return list;
    },
    staleTime: 60_000,
    retry: 1,
  });
}

/** Branch/state announcement (kind 30618): HEAD + refs. */
function useRepoState(repo: NostrEvent) {
  const d = getTag(repo, 'd') ?? '';
  return useQuery({
    queryKey: ['repo-state', repo.pubkey, d],
    queryFn: async ({ signal }) => {
      const sets = await queryRelayPool(
        getGitRelayUrls(),
        [{ kinds: [30618], authors: [repo.pubkey], '#d': [d], limit: 1 }],
        { signal, timeoutMs: 5000 },
      );
      for (const events of sets) {
        if (events.length > 0) return events[0];
      }
      return undefined;
    },
    staleTime: 60_000,
    retry: 1,
  });
}

/* ─── Page ─── */

export function RepoView({ event, nip19Id }: { event: NostrEvent; nip19Id: string }) {
  const name = getTag(event, 'name') ?? getTag(event, 'd') ?? 'repository';
  const description = getTag(event, 'description') ?? '';
  const topics = getTags(event, 't').slice(0, 8);
  const maintainers = [event.pubkey, ...getTags(event, 'maintainers')].filter((v, i, a) => a.indexOf(v) === i);
  const cloneUrls = getTags(event, 'clone').map(sanitizePublicUrl).filter(Boolean);
  const webUrls = getTags(event, 'web').map(sanitizePublicUrl).filter(Boolean);
  const d = getTag(event, 'd') ?? '';
  const nostrClone = `nostr://${nip19.npubEncode(event.pubkey)}/${encodeURIComponent(d)}`;

  const author = useAuthor(event.pubkey);
  const authorMeta: NostrMetadata | undefined = author.data?.metadata;
  const authorName = authorMeta?.name || authorMeta?.display_name || npubShort(event.pubkey);

  const activity = useRepoActivity(event);
  const state = useRepoState(event);

  const head = state.data ? getTag(state.data, 'HEAD')?.replace('ref: refs/heads/', '') : undefined;
  const branches = state.data
    ? state.data.tags
      .filter(([n]) => n === 'refs/heads' || n.startsWith('refs/heads/'))
      .map(([n]) => n.replace('refs/heads/', ''))
      .filter((b) => b && b !== head)
      .slice(0, 12)
    : [];

  return (
    <div className="space-y-4">
      {/* Repo header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 mb-2">
            <Avatar size="default">
              {authorMeta?.picture && <AvatarImage src={sanitizePublicUrl(authorMeta.picture) || undefined} alt={authorName} />}
              <AvatarFallback><User className="w-4 h-4" /></AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <Link to={`/${nip19.npubEncode(event.pubkey)}`} className="font-semibold truncate hover:text-primary transition-colors">
                {authorName}
              </Link>
              <p className="text-xs text-muted-foreground">announced {timeAgo(event.created_at)}</p>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px]">Repository</Badge>
          </div>
          <h1 className="text-xl font-bold break-words">{name}</h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
          )}
          {topics.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {topics.map((t) => (
                <span key={t} className="text-xs text-primary/70 font-mono">#{t}</span>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Clone */}
          <div className="space-y-1.5">
            {cloneUrls.map((url) => (
              <CloneRow key={url} command={`git clone ${url}`} />
            ))}
            <CloneRow command={nostrClone} note="ngit / git-remote-nostr" />
            {cloneUrls.length === 0 && (
              <p className="text-[11px] text-muted-foreground/60">
                No public clone URL announced — the nostr URI works with ngit or a git-remote-nostr helper.
              </p>
            )}
          </div>

          {/* Web links (public only) */}
          {webUrls.length > 0 && (
            <div className="space-y-1">
              {webUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline truncate"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{url.replace(/^https:\/\//, '')}</span>
                </a>
              ))}
            </div>
          )}

          {/* Branches from repo state */}
          {(head || branches.length > 0) && (
            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border/50">
              <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
              {head && (
                <Badge variant="secondary" className="text-[10px] font-mono">{head} (HEAD)</Badge>
              )}
              {branches.map((b) => (
                <Badge key={b} variant="outline" className="text-[10px] font-mono">{b}</Badge>
              ))}
            </div>
          )}

          {/* Maintainers */}
          {maintainers.length > 1 && (
            <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
              <Users className="w-3 h-3" />
              {maintainers.length} maintainers
            </p>
          )}

          {/* Votes */}
          <VoteTalliesProvider results={[{ url: `/${nip19Id}`, nostrEvent: event }]}>
            <div className="flex items-center gap-2 pt-1 border-t border-border/50">
              <VoteButtons
                result={{
                  id: event.id,
                  title: name,
                  url: `/${nip19Id}`,
                  snippet: description,
                  source: 'nostr',
                  provider: 'git',
                  nostrEvent: event,
                }}
                className="py-2"
              />
            </div>
          </VoteTalliesProvider>
        </CardContent>
      </Card>

      {/* Embedded activity: issues, PRs, patches */}
      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-sm font-semibold">Activity</h2>
          <p className="text-[11px] text-muted-foreground/70">
            Issues, pull requests, and patches — straight from the git relays.
          </p>
        </CardHeader>
        <CardContent>
          {activity.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1.5 py-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : !activity.data || activity.data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No issues, PRs, or patches yet.
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {activity.data.map((item) => (
                <ActivityRow key={item.event.id} item={item} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Rows ─── */

function ActivityRow({ item }: { item: ActivityItem }) {
  const status = STATUS_META[item.status] ?? STATUS_META[1630];
  const nevent = nip19.neventEncode({ id: item.event.id, author: item.event.pubkey });
  const Icon = item.kindLabel === 'Issue' ? CircleDot : item.kindLabel === 'PR' ? GitPullRequest : FileDiff;

  return (
    <Link to={`/${nevent}`} className="flex items-center gap-3 py-3 group">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
          {item.title}
        </p>
        <p className="text-[11px] text-muted-foreground/60">
          {item.kindLabel} · {timeAgo(item.event.created_at)}
        </p>
      </div>
      <Badge variant="outline" className={`text-[10px] shrink-0 ${status.cls}`}>
        {status.label}
      </Badge>
    </Link>
  );
}

function CloneRow({ command, note }: { command: string; note?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/50 px-3 py-2">
      <code className="flex-1 min-w-0 truncate text-xs font-mono text-foreground/90">{command}</code>
      {note && <span className="text-[10px] text-muted-foreground/60 shrink-0">{note}</span>}
      <button
        type="button"
        onClick={() => void copy()}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Copy clone command"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

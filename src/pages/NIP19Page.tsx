import { nip19 } from 'nostr-tools';
import { useParams, Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { ArrowLeft, ExternalLink, Copy, Check, User } from 'lucide-react';
import { useState } from 'react';
import type { NostrEvent, NostrMetadata, NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { VoteButtons, VoteTalliesProvider } from '@/components/VoteButtons';
import { useAuthor } from '@/hooks/useAuthor';
import { sanitizeUrl, sanitizePublicUrl } from '@/lib/sanitizeUrl';
import { kindLabel, timeAgo, npubShort, getTitle, getSummary, getDTag } from '@/lib/nostrHelpers';
import { queryRelayPool } from '@/lib/searchRelays';
import { getGitRelayUrls, getWikiRelayUrls, getIndexRelayUrls, getSearchRelayUrls } from '@/lib/appRelays';
import NotFound from './NotFound';

/**
 * Events linked from search results don't necessarily live on the user's
 * NIP-65 relays: wiki articles live on the wiki pool, git events on the
 * ngit/GRASP pool, index/stake events on the index pool. Look every event
 * up across ALL app relay pools (in addition to the user's pool) or linked
 * content would 404 with "not found" for most users.
 */
async function queryAcrossPools(
  nostr: { query: (filters: NostrFilter[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]> },
  filter: NostrFilter,
  signal: AbortSignal,
): Promise<NostrEvent | undefined> {
  const poolUrls = [
    ...new Set([
      ...getSearchRelayUrls(),
      ...getWikiRelayUrls(),
      ...getGitRelayUrls(),
      ...getIndexRelayUrls(),
    ]),
  ];

  const [fromUserPool, poolResults] = await Promise.all([
    nostr.query([filter], { signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]) })
      .catch(() => [] as NostrEvent[]),
    queryRelayPool(poolUrls, [filter], { signal, timeoutMs: 7000 }),
  ]);

  if (fromUserPool.length > 0) return fromUserPool[0];
  for (const events of poolResults) {
    if (events.length > 0) return events[0];
  }
  return undefined;
}

export function NIP19Page() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  if (!identifier) {
    return <NotFound />;
  }

  let decoded;
  try {
    decoded = nip19.decode(identifier);
  } catch {
    return <NotFound />;
  }

  const { type } = decoded;

  switch (type) {
    case 'npub':
      return <ProfileView pubkey={decoded.data} nip19Id={identifier} />;
    case 'nprofile':
      return <ProfileView pubkey={decoded.data.pubkey} nip19Id={identifier} />;
    case 'note':
      return <EventView eventId={decoded.data} nip19Id={identifier} />;
    case 'nevent':
      return <EventView eventId={decoded.data.id} author={decoded.data.author} nip19Id={identifier} />;
    case 'naddr':
      return <AddressableView kind={decoded.data.kind} pubkey={decoded.data.pubkey} identifier={decoded.data.identifier} nip19Id={identifier} />;
    default:
      return <NotFound />;
  }
}

/* ─── Profile View ─── */
function ProfileView({ pubkey, nip19Id }: { pubkey: string; nip19Id: string }) {
  const author = useAuthor(pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;

  const name = metadata?.name || metadata?.display_name || npubShort(pubkey);
  const avatar = metadata?.picture ? sanitizeUrl(metadata.picture) : '';
  const banner = metadata?.banner ? sanitizeUrl(metadata.banner) : '';

  useSeoMeta({
    title: `${name} - Presearchstr`,
    description: metadata?.about || `Nostr profile: ${npubShort(pubkey)}`,
  });

  return (
    <Layout>
      <div className="container max-w-2xl py-6">
        <BackButton />
        <Card>
          {banner && (
            <div className="h-32 rounded-t-xl overflow-hidden bg-muted">
              <img src={banner} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <CardHeader className="pb-3">
            <div className="flex items-start gap-4">
              <Avatar size="lg" className="ring-2 ring-primary/10 -mt-6 relative z-10">
                {avatar && <AvatarImage src={avatar} alt={name} />}
                <AvatarFallback><User className="w-5 h-5" /></AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 pt-1">
                <h1 className="text-xl font-bold truncate flex items-center gap-2">
                  {name}
                  {metadata?.bot && (
                    <Badge variant="outline" className="text-[10px] shrink-0 border-muted-foreground/30 text-muted-foreground">
                      Bot
                    </Badge>
                  )}
                </h1>
                {metadata?.nip05 && (
                  <p className="text-sm text-muted-foreground font-mono truncate">{metadata.nip05}</p>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {metadata?.about && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{metadata.about}</p>
            )}
            {/* NIP-24 extra metadata: website */}
            {metadata?.website && sanitizeUrl(metadata.website) && (
              <a
                href={sanitizeUrl(metadata.website)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {sanitizeUrl(metadata.website)!.replace(/^https?:\/\//, '')}
              </a>
            )}
            <CopyId identifier={nip19Id} />
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

/* ─── Event View ─── */
function EventView({ eventId, author: authorHint, nip19Id }: { eventId: string; author?: string; nip19Id: string }) {
  const { nostr } = useNostr();

  const { data: event, isLoading } = useQuery<NostrEvent | undefined>({
    queryKey: ['nostr', 'event', eventId],
    queryFn: async ({ signal }) => {
      const filter: NostrFilter = { ids: [eventId], limit: 1 };
      if (authorHint) {
        (filter as NostrFilter & { authors?: string[] }).authors = [authorHint];
      }
      return queryAcrossPools(nostr, filter, signal);
    },
    retry: 2,
  });

  const authorQuery = useAuthor(event?.pubkey);
  const metadata: NostrMetadata | undefined = authorQuery.data?.metadata;
  const displayName = metadata?.name || metadata?.display_name || (event ? npubShort(event.pubkey) : '');
  const avatar = metadata?.picture ? sanitizeUrl(metadata.picture) : '';

  useSeoMeta({
    title: event ? `${displayName}: ${event.content.slice(0, 60)}... - Presearchstr` : 'Event - Presearchstr',
    description: event?.content?.slice(0, 200) || 'Nostr event',
  });

  return (
    <Layout>
      <div className="container max-w-2xl py-6">
        <BackButton />
        {isLoading ? (
          <EventSkeleton />
        ) : event ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <Avatar size="default">
                  {avatar && <AvatarImage src={avatar} alt={displayName} />}
                  <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(event.created_at)}</p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {kindLabel(event.kind)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{event.content}</p>
              {/* NIP-25 voting — anonymous by default, npub if toggled */}
              <VoteTalliesProvider results={[{ url: `/${nip19Id}`, nostrEvent: event }]}>
                <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                  <VoteButtons
                    result={{
                      id: event.id,
                      title: event.content.slice(0, 80),
                      url: `/${nip19Id}`,
                      snippet: '',
                      source: 'nostr',
                      provider: 'nostr',
                      nostrEvent: event,
                    }}
                    className="py-2"
                  />
                </div>
              </VoteTalliesProvider>
              <CopyId identifier={nip19Id} />
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Event not found on connected relays.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

/* ─── Addressable Event View ─── */
function AddressableView({ kind, pubkey, identifier, nip19Id }: {
  kind: number;
  pubkey: string;
  identifier: string;
  nip19Id: string;
}) {
  const { nostr } = useNostr();

  const { data: event, isLoading } = useQuery<NostrEvent | undefined>({
    queryKey: ['nostr', 'addr', kind, pubkey, identifier],
    queryFn: async ({ signal }) => {
      return queryAcrossPools(
        nostr,
        { kinds: [kind], authors: [pubkey], '#d': [identifier], limit: 1 },
        signal,
      );
    },
    retry: 2,
  });

  const authorQuery = useAuthor(pubkey);
  const metadata: NostrMetadata | undefined = authorQuery.data?.metadata;
  const displayName = metadata?.name || metadata?.display_name || npubShort(pubkey);
  const avatar = metadata?.picture ? sanitizeUrl(metadata.picture) : '';
  const title = event ? getTitle(event) || getDTag(event) || 'Untitled' : 'Loading...';
  const summary = event ? getSummary(event) : undefined;

  useSeoMeta({
    title: `${title} - Presearchstr`,
    description: summary || event?.content?.slice(0, 200) || 'Nostr addressable event',
  });

  return (
    <Layout>
      <div className="container max-w-2xl py-6">
        <BackButton />
        {isLoading ? (
          <EventSkeleton />
        ) : event ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3 mb-3">
                <Avatar size="default">
                  {avatar && <AvatarImage src={avatar} alt={displayName} />}
                  <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(event.created_at)}</p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {kindLabel(event.kind)}
                </Badge>
              </div>
              <h1 className="text-xl font-bold">{title}</h1>
              {summary && (
                <p className="text-sm text-muted-foreground mt-1">{summary}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {event.content && (
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {event.content}
                </div>
              )}
              {/* NIP-34 repository: web/clone links are the payload */}
              {event.kind === 30617 && <RepoLinks event={event} />}
              {/* NIP-25 voting — anonymous by default, npub if toggled */}
              <VoteTalliesProvider results={[{ url: `/${nip19Id}`, nostrEvent: event }]}>
                <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                  <VoteButtons
                    result={{
                      id: event.id,
                      title,
                      url: `/${nip19Id}`,
                      snippet: summary ?? '',
                      source: 'nostr',
                      provider: 'nostr',
                      nostrEvent: event,
                    }}
                    className="py-2"
                  />
                </div>
              </VoteTalliesProvider>
              <CopyId identifier={nip19Id} />
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Event not found on connected relays.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

/* ─── Shared components ─── */

/** NIP-34 repo links: public browsable web URLs + clone URLs, plus a link to
 *  the git.iris.to repo browser (renders the tree from the relays — works even
 *  when the author only announced a local GRASP instance like 127.0.0.1:3000). */
function RepoLinks({ event }: { event: NostrEvent }) {
  const links: { label: string; url: string }[] = [];
  for (const [n, v] of event.tags) {
    if ((n !== 'web' && n !== 'clone') || !v) continue;
    const safe = sanitizePublicUrl(v);
    if (!safe) continue; // https + public host only — no http/loopback/private
    if (links.some((l) => l.url === safe)) continue;
    links.push({ label: n === 'web' ? safe.replace(/^https:\/\//, '') : `git clone ${safe}`, url: safe });
  }

  const d = event.tags.find(([n]) => n === 'd')?.[1];
  const viewerUrl = d !== undefined
    ? `https://git.iris.to/${nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: d })}`
    : null;

  return (
    <div className="space-y-1.5">
      {viewerUrl && (
        <a
          href={viewerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          Open repo browser (files, commits)
        </a>
      )}
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm font-mono text-muted-foreground hover:text-primary hover:underline truncate"
        >
          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{link.label}</span>
        </a>
      ))}
      {!viewerUrl && links.length === 0 && (
        <p className="text-xs text-muted-foreground/70">
          This repo announced no public browsing URL — clone it with any NIP-34 client.
        </p>
      )}
    </div>
  );
}

function BackButton() {
  return (
    <Button variant="ghost" size="sm" asChild className="mb-4 text-muted-foreground hover:text-foreground">
      <Link to="/">
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        Back to Search
      </Link>
    </Button>
  );
}

function CopyId({ identifier }: { identifier: string }) {
  const [copied, setCopied] = useState(false);
  const njumpUrl = `https://njump.me/${identifier}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(identifier);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex items-center gap-2 pt-2 border-t border-border/50">
      <code className="flex-1 text-xs text-muted-foreground font-mono truncate">{identifier}</code>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCopy} aria-label="Copy NIP-19 identifier">
        {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild aria-label="View on njump.me">
        <a href={njumpUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="w-3 h-3" />
        </a>
      </Button>
    </div>
  );
}

function EventSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </CardContent>
    </Card>
  );
}

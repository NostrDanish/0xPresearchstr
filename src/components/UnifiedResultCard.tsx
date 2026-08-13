/**
 * Universal result card — renders any SearchResult from any provider.
 *
 * Adapts its visual style based on the result's `source`:
 * - Nostr results: avatar, author, nip19 internal link, hashtags
 * - Web results: domain breadcrumb, external link, engine badge
 * - Wiki results: encyclopedia styling, Wikipedia icon
 * - News results: HN points/comments, author
 * - Tor results: onion badge, warning interstitial
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Globe, ExternalLink, Zap, Shield, AlertTriangle,
  BookOpen, Newspaper, Code, User, FileText, Flag,
} from 'lucide-react';

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { OnionWarningDialog } from '@/components/OnionWarningDialog';
import { ReportDialog } from '@/components/ReportDialog';
import { VoteButtons } from '@/components/VoteButtons';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import type { SearchResult } from '@/lib/providers/types';
import { cn } from '@/lib/utils';

interface UnifiedResultCardProps {
  result: SearchResult;
  className?: string;
}

/** Source icon + color for badges. */
const SOURCE_STYLE: Record<string, { icon: React.ReactNode; color: string; hoverBorder: string }> = {
  nostr: {
    icon: <Zap className="w-3 h-3" />,
    color: 'border-nostr/30 text-nostr',
    hoverBorder: 'hover:border-nostr/30',
  },
  web: {
    icon: <Globe className="w-3 h-3" />,
    color: 'border-clearnet/20 text-clearnet/70',
    hoverBorder: 'hover:border-clearnet/30',
  },
  wiki: {
    icon: <BookOpen className="w-3 h-3" />,
    color: 'border-border text-muted-foreground',
    hoverBorder: 'hover:border-primary/30',
  },
  news: {
    icon: <Newspaper className="w-3 h-3" />,
    color: 'border-border text-muted-foreground',
    hoverBorder: 'hover:border-primary/30',
  },
  code: {
    icon: <Code className="w-3 h-3" />,
    color: 'border-border text-muted-foreground',
    hoverBorder: 'hover:border-primary/30',
  },
  tor: {
    icon: <Shield className="w-3 h-3" />,
    color: 'border-tor/20 text-tor/60',
    hoverBorder: 'hover:border-tor/40',
  },
};

export function UnifiedResultCard({ result, className }: UnifiedResultCardProps) {
  // Tor results get the warning dialog flow.
  if (result.source === 'tor') {
    return <TorResultCard result={result} className={className} />;
  }

  // Nostr profile results get a distinct layout.
  if (result.source === 'nostr' && result.kind === 'Profile') {
    return <NostrProfileCard result={result} className={className} />;
  }

  // Nostr results with internal links.
  if (result.source === 'nostr') {
    return <NostrCard result={result} className={className} />;
  }

  // External results (web, wiki, news).
  return <ExternalResultCard result={result} className={className} />;
}

/* ─── Nostr profile ─── */
function NostrProfileCard({ result, className }: { result: SearchResult; className?: string }) {
  return (
    <Link to={result.url} className={cn('block group', className)}>
      <div className="flex items-start gap-4 p-4 rounded-xl border border-border/50 bg-card hover:border-primary/30 hover:bg-card/80 transition-all duration-200">
        <Avatar size="lg" className="shrink-0 ring-2 ring-primary/10">
          {result.authorAvatar && <AvatarImage src={result.authorAvatar} alt={result.title} />}
          <AvatarFallback><User className="w-5 h-5" /></AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {result.title}
            </span>
            <Badge variant="outline" className="text-[10px] shrink-0 border-nostr/30 text-nostr">
              Profile
            </Badge>
          </div>
          {result.domain && (
            <p className="text-xs text-muted-foreground font-mono mb-1.5 truncate">{result.domain}</p>
          )}
          {result.snippet && (
            <p className="text-sm text-muted-foreground line-clamp-2">{result.snippet}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ─── Nostr note / article / file / torrent / snippet ─── */
function NostrCard({ result, className }: { result: SearchResult; className?: string }) {
  const style = SOURCE_STYLE.nostr;
  const [reportOpen, setReportOpen] = useState(false);

  // NIP-36: content-warning tag hides the content until explicitly revealed.
  const cwTag = result.nostrEvent?.tags.find(([n]) => n === 'content-warning');
  const cw = cwTag ? (cwTag[1] ?? '') : null;
  const [cwRevealed, setCwRevealed] = useState(false);

  // NIP-92: first imeta image becomes an inline thumbnail.
  const mediaThumb = (() => {
    const imeta = result.nostrEvent?.tags.find(([n]) => n === 'imeta');
    if (!imeta) return undefined;
    const urlField = imeta.find((v, i) => i > 0 && v.startsWith('url '));
    const mimeField = imeta.find((v, i) => i > 0 && v.startsWith('m '));
    if (!urlField) return undefined;
    const url = urlField.slice(4);
    // Only render https images (never data: or http on an https page).
    if (mimeField && !mimeField.slice(2).startsWith('image/')) return undefined;
    return sanitizeUrl(url) || undefined;
  })();

  // Internal links (/<nip19>) use the router; external protocol links
  // (magnet:, https:) use a plain anchor.
  const isInternal = result.url.startsWith('/');

  const card = (
      <div className={cn(
        'p-4 rounded-xl border border-border/50 bg-card hover:bg-card/80 transition-all duration-200',
        style.hoverBorder,
      )}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-2.5">
          {result.authorAvatar && (
            <Avatar size="sm" className="shrink-0">
              <AvatarImage src={result.authorAvatar} alt={result.author || ''} />
              <AvatarFallback>{(result.author || '?').charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
          {result.author && (
            <span className="text-sm text-muted-foreground truncate">{result.author}</span>
          )}
          {result.timestamp && (
            <span className="text-xs text-muted-foreground/60">{timeAgo(result.timestamp)}</span>
          )}
          {result.kind && (
            <Badge variant="outline" className={cn('text-[10px] ml-auto shrink-0', style.color)}>
              {result.kind === 'Article' && <FileText className="w-3 h-3 mr-0.5" />}
              {result.kind}
            </Badge>
          )}
        </div>

        {/* Title (for articles, code snippets, torrents, wiki pages) */}
        {['Article', 'Code', 'Torrent', 'Wiki'].includes(result.kind ?? '') && result.title !== result.snippet && (
          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors mb-1.5 line-clamp-2">
            {result.title}
          </h3>
        )}

        {/* Content / snippet — hidden behind a NIP-36 content warning if present */}
        {cw === null ? (
          <p className="text-sm text-foreground/90 leading-relaxed line-clamp-4 whitespace-pre-wrap break-words">
            {result.snippet}
          </p>
        ) : cwRevealed ? (
          <p className="text-sm text-foreground/90 leading-relaxed line-clamp-4 whitespace-pre-wrap break-words">
            {result.snippet}
          </p>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCwRevealed(true); }}
            className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 hover:bg-amber-500/10 transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Content warning{cw ? `: ${cw}` : ''} — tap to reveal</span>
          </button>
        )}

        {/* NIP-92 imeta media thumbnail */}
        {mediaThumb && (cw === null || cwRevealed) && (
          <div className="mt-3 rounded-lg overflow-hidden border border-border/50 max-w-xs">
            <img src={mediaThumb} alt="" loading="lazy" className="w-full h-auto object-cover max-h-40" />
          </div>
        )}

        {/* Tags + votes + report */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {result.tags && result.tags.length > 0 && (
            <div className="flex items-center gap-1.5">
              {result.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="text-xs text-primary/60 font-mono">#{tag}</span>
              ))}
            </div>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <VoteButtons result={result} />
            {result.nostrEvent && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setReportOpen(true); }}
                className="inline-flex items-center p-1 rounded-md text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                aria-label="Report this result"
                title="Report this result (NIP-56)"
              >
                <Flag className="w-3 h-3" />
              </button>
            )}
          </span>
        </div>
      </div>
  );

  return (
    <>
      {isInternal ? (
        <Link to={result.url} className={cn('block group', className)}>{card}</Link>
      ) : (
        <a href={result.url} className={cn('block group', className)}>{card}</a>
      )}
      {result.nostrEvent && (
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          target={result.nostrEvent.id}
          targetTitle={result.title}
        />
      )}
    </>
  );
}

/* ─── External result (web, wiki, news) ─── */
function ExternalResultCard({ result, className }: { result: SearchResult; className?: string }) {
  const style = SOURCE_STYLE[result.source] ?? SOURCE_STYLE.web;
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn('block group', className)}
      >
        <div className={cn(
          'p-4 rounded-xl border border-border/50 bg-card hover:bg-card/80 transition-all duration-200',
          style.hoverBorder,
        )}>
          {/* URL line */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="shrink-0 text-muted-foreground/60">{style.icon}</span>
            <span className="text-xs text-muted-foreground font-mono truncate">
              {result.domain || result.engine || result.provider}
            </span>
            <ExternalLink className="w-3 h-3 text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            {(result.kind || result.engine) && (
              <span className="flex items-center gap-1.5 ml-auto shrink-0">
                {result.kind && (
                  <Badge variant="outline" className={cn('text-[10px]', style.color)}>
                    {result.kind}
                  </Badge>
                )}
                {result.engine && (
                  <Badge variant="outline" className={cn('text-[10px]', style.color)}>
                    {result.engine}
                  </Badge>
                )}
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors mb-1 line-clamp-2 text-sm">
            {result.title}
          </h3>

          {/* Snippet */}
          {result.snippet && (
            <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
              {result.snippet}
            </p>
          )}

          {/* Footer: votes, author, timestamp, tags, report */}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/60 flex-wrap">
            <VoteButtons result={result} />
            {result.author && <span>by {result.author}</span>}
            {result.timestamp && <span>{timeAgo(result.timestamp)}</span>}
            {result.tags && result.tags.length > 0 && (
              <span className="font-mono">{result.tags.join(' · ')}</span>
            )}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setReportOpen(true); }}
              className="ml-auto inline-flex items-center gap-1 text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
              aria-label="Report this result"
              title="Report this result (NIP-56)"
            >
              <Flag className="w-3 h-3" />
            </button>
          </div>
        </div>
      </a>

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        target={result.url}
        targetTitle={result.title}
      />
    </>
  );
}

/* ─── Tor result with warning dialog ─── */
function TorResultCard({ result, className }: { result: SearchResult; className?: string }) {
  const [warningOpen, setWarningOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setWarningOpen(true)}
        className={cn('block group w-full text-left', className)}
      >
        <div className="p-4 rounded-xl border border-tor/20 bg-card hover:border-tor/40 hover:bg-tor/5 transition-all duration-200">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1.5">
            <Shield className="w-3.5 h-3.5 shrink-0 text-tor/60" />
            <span className="text-xs font-mono truncate text-tor/70">
              {result.domain || result.url}
            </span>
            <AlertTriangle className="w-3 h-3 text-muted-foreground/40 shrink-0" />
            <Badge variant="outline" className="text-[10px] ml-auto shrink-0 border-tor/20 text-tor/60">
              Tor
            </Badge>
          </div>

          {/* Title */}
          <h3 className="font-semibold text-foreground group-hover:text-tor transition-colors mb-1 line-clamp-2 text-sm">
            {result.title}
          </h3>

          {/* Description */}
          {result.snippet && (
            <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">{result.snippet}</p>
          )}

          <p className="text-[11px] text-muted-foreground/50 mt-2 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Requires Tor Browser — click to see warning
          </p>
        </div>
      </button>

      <OnionWarningDialog
        open={warningOpen}
        onOpenChange={setWarningOpen}
        url={result.url}
        type="tor"
      />
    </>
  );
}

/* ─── Utilities ─── */
function timeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;

  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

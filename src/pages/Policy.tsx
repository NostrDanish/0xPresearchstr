import { useSeoMeta } from '@unhead/react';
import { Shield, AlertTriangle, Flag, Ban, Scale, Eye, Loader2 } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { LoginArea } from '@/components/auth/LoginArea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useState } from 'react';

export default function Policy() {
  useSeoMeta({
    title: 'Content Policy - 0xPresearchstr',
    description: 'Content policy and moderation practices for 0xPresearchstr federated search engine. Modeled on the Ahmia approach to responsible dark-web indexing.',
  });

  return (
    <Layout>
      <div className="container max-w-3xl py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Content Policy</h1>
        </div>
        <p className="text-muted-foreground mb-8 leading-relaxed">
          0xPresearchstr indexes content from multiple networks. This document describes what we do
          and don't index, and why. Our approach mirrors the{' '}
          <a
            href="https://ahmia.fi/documentation/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Ahmia project's
          </a>{' '}
          established practices for responsible search indexing.
        </p>

        <Separator className="mb-8" />

        {/* Hard-blocked content */}
        <Card className="mb-6 border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Ban className="w-5 h-5" />
              Hard-Blocked Content (Non-Negotiable)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              The following categories are permanently excluded from the index. Content matching
              these categories is logged and dropped before it ever reaches the public index.
              No exceptions.
            </p>
            <ul className="space-y-3">
              {[
                {
                  title: 'Child Sexual Abuse Material (CSAM)',
                  description: 'Any content depicting or promoting the sexual exploitation of minors. Filtered by known-bad hash lists (e.g., IWF/NCMEC), domain blocklists, and keyword classifiers.',
                },
                {
                  title: 'Human Trafficking',
                  description: 'Listings, advertisements, or recruitment content related to the trafficking or exploitation of persons.',
                },
                {
                  title: 'Weapons Sales',
                  description: 'Active marketplace listings for weapons, explosives, or other instruments of violence.',
                },
                {
                  title: 'Drug Marketplace Listings',
                  description: 'Active vendor listings and marketplace pages for controlled substances. Note: harm-reduction information and policy discussion content is NOT blocked.',
                },
              ].map((item) => (
                <li key={item.title} className="flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
                  <div>
                    <span className="text-sm font-medium text-foreground">{item.title}</span>
                    <p className="text-sm text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Filtering methods */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Filtering Methods
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {[
                {
                  title: 'Known-Bad Domain / Hash Lists',
                  description: 'Cross-referenced against maintained blocklists of known illegal content domains and content hashes (SHA-256). Updated regularly from law enforcement and NGO partnerships.',
                },
                {
                  title: 'Keyword / Category Classifiers',
                  description: 'Machine learning classifiers trained to identify illegal marketplace content, CSAM-adjacent text, and trafficking indicators. False positives are preferred over false negatives.',
                },
                {
                  title: 'Pre-Index Filtering',
                  description: 'All content is filtered BEFORE entering the public index. The pipeline is: crawl -> classify -> filter -> index. Blocked content is logged for auditing but never surfaced.',
                },
                {
                  title: 'Abuse Reports',
                  description: 'Human-submitted reports are reviewed and actioned. Reported URLs are immediately queued for review and removed from the index pending investigation.',
                },
              ].map((item) => (
                <li key={item.title} className="flex items-start gap-3">
                  <span className="text-primary font-mono mt-0.5 shrink-0 text-sm">{'>'}</span>
                  <div>
                    <span className="text-sm font-medium text-foreground">{item.title}</span>
                    <p className="text-sm text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* What we DO index */}
        <Card className="mb-6 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-primary" />
              What We DO Index
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              0xPresearchstr exists to serve legitimate privacy, journalism, and whistleblowing use cases.
              We index:
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {[
                'Nostr content (notes, profiles, articles, files) from NIP-50 capable relays',
                'Privacy-focused services, tools, and documentation',
                'Journalism and independent media outlets',
                'Whistleblowing platforms and secure communication tools',
                'Academic and research content',
                'Forums and communities discussing technology, privacy, and civil liberties',
                'Harm-reduction information and policy advocacy',
                'Standard clearnet websites (respecting robots.txt)',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-primary/60 mt-0.5 shrink-0">+</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Separator className="my-8" />

        {/* Abuse report */}
        <AbuseReportSection />

        {/* Legal */}
        <div className="mt-8 p-4 rounded-xl bg-muted/50 border border-border/50">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Threat Model Note:</strong> 0xPresearchstr is a search
            interface and indexing system, not a proxy or gateway. We do not host, cache, or serve
            any indexed content. Search results link to their original sources. Users are responsible
            for understanding the legal implications of accessing content in their jurisdiction. The
            content policy exists to prevent 0xPresearchstr from becoming a discovery vector for the
            worst categories of illegal content — an indiscriminate crawler is how a project like
            this gets its domain seized or its maintainer prosecuted.
          </p>
        </div>
      </div>
    </Layout>
  );
}

/** NIP-56 report types (kind 1984). */
const REPORT_TYPES = [
  { value: 'illegal', label: 'Illegal content (CSAM, trafficking, weapons, drug markets)' },
  { value: 'malware', label: 'Malware / phishing' },
  { value: 'spam', label: 'Spam' },
  { value: 'nudity', label: 'Nudity / explicit content' },
  { value: 'profanity', label: 'Hateful or abusive content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Other policy violation' },
] as const;

/**
 * Build the tags for a kind 1984 report from a free-form target string.
 * Supports URLs (r tag), note1/nevent1 (e tag), npub1/nprofile1 (p tag),
 * and naddr1 (a tag). Returns null when the target can't be understood.
 */
function buildReportTags(target: string, type: string): string[][] | null {
  const input = target.trim();

  // NIP-19 identifiers.
  if (/^(note1|nevent1|npub1|nprofile1|naddr1)/.test(input)) {
    try {
      const decoded = nip19.decode(input);
      switch (decoded.type) {
        case 'note':
          return [['e', decoded.data, type]];
        case 'nevent': {
          const tags: string[][] = [['e', decoded.data.id, type]];
          if (decoded.data.author) tags.push(['p', decoded.data.author]);
          return tags;
        }
        case 'npub':
          return [['p', decoded.data, type]];
        case 'nprofile':
          return [['p', decoded.data.pubkey, type]];
        case 'naddr': {
          const { kind, pubkey, identifier } = decoded.data;
          return [['a', `${kind}:${pubkey}:${identifier}`, type]];
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  // Plain URLs (reported web content).
  if (/^https?:\/\//i.test(input)) {
    return [['r', input, type]];
  }

  return null;
}

function AbuseReportSection() {
  const { user } = useCurrentUser();
  const { mutate: createEvent, isPending } = useNostrPublish();
  const [submitted, setSubmitted] = useState(false);
  const [url, setUrl] = useState('');
  const [reason, setReason] = useState('');
  const [type, setType] = useState<string>('illegal');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const targetTags = buildReportTags(url, type);
    if (!targetTags) {
      setError('Enter a valid https:// URL or a Nostr identifier (note1…, nevent1…, npub1…, naddr1…).');
      return;
    }

    // NIP-32 self-labels so moderators can filter reports by namespace.
    const tags = [
      ...targetTags,
      ['L', '0xsearchstr.abuse'],
      ['l', type, '0xsearchstr.abuse'],
    ];

    createEvent(
      { kind: 1984, content: reason.trim(), tags },
      {
        onSuccess: () => {
          setSubmitted(true);
          setUrl('');
          setReason('');
          setType('illegal');
        },
        onError: (err) => setError(err.message || 'Failed to publish the report. Try again.'),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Flag className="w-5 h-5" />
          Report Content for Removal
        </CardTitle>
      </CardHeader>
      <CardContent>
        {submitted ? (
          <div className="text-center py-6">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mx-auto mb-3">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Report Published</p>
            <p className="text-sm text-muted-foreground mb-4">
              Your report is now a public Nostr event (kind 1984). Moderators, relays, and
              compatible clients — including this index — can act on it.
            </p>
            <Button variant="outline" size="sm" onClick={() => setSubmitted(false)}>
              Submit Another Report
            </Button>
          </div>
        ) : !user ? (
          <div className="py-4 text-center space-y-4">
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Reports are NIP-56 events signed with your Nostr key — attributable and
              Sybil-resistant. Log in to file one.
            </p>
            <LoginArea className="max-w-56 mx-auto" />
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              Found content in the index that violates the policy above? File a NIP-56 report —
              it publishes as a public <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">kind 1984</code> event
              that moderators and relays can act on.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="abuse-url" className="text-sm font-medium text-foreground mb-1 block">
                  URL or Nostr identifier
                </label>
                <input
                  id="abuse-url"
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://... or note1... / nevent1... / npub1..."
                  required
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 placeholder:text-muted-foreground/60 dark:bg-input/30"
                />
              </div>
              <div>
                <label htmlFor="abuse-type" className="text-sm font-medium text-foreground mb-1 block">
                  Report type
                </label>
                <select
                  id="abuse-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                >
                  {REPORT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="abuse-reason" className="text-sm font-medium text-foreground mb-1 block">
                  Details
                </label>
                <textarea
                  id="abuse-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe why this content should be removed..."
                  required
                  rows={3}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 placeholder:text-muted-foreground/60 resize-none dark:bg-input/30"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground/50 font-mono">kind 1984 · NIP-56</span>
                <Button type="submit" size="sm" disabled={isPending || !url.trim() || !reason.trim()}>
                  {isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Flag className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Publish Report
                </Button>
              </div>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

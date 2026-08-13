/**
 * Moderation hooks.
 *
 * useModerationSet() — PUBLIC read path, used by the search pipeline for
 * every user: fetches owner-signed "hidden" labels (minus NIP-09 retracted
 * ones) from the index relays and returns them as a lookup set.
 *
 * useAbuseReports() — the NIP-56 report inbox (dashboard).
 *
 * useModerationActions() — owner publish actions (hide / unhide).
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelay } from '@/lib/searchRelays';
import { getIndexRelayUrls, getSearchRelayUrls } from '@/lib/appRelays';
import {
  OWNER_PUBKEY,
  MODERATION_KIND,
  MODERATION_NS,
  REPORT_KIND,
  REPORT_NS,
  parseHiddenLabel,
  toModerationSet,
  buildHideLabel,
  buildUnhideDelete,
  type HiddenTarget,
  type ModerationSet,
} from '@/lib/moderation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';

/** Relays the moderation data lives on. */
function moderationRelays(): string[] {
  return [...new Set([...getIndexRelayUrls(), ...getSearchRelayUrls()])];
}

/* ------------------------------------------------------------------ */
/* Public read: the hidden-targets set                                 */
/* ------------------------------------------------------------------ */

async function fetchModerationSet(signal: AbortSignal): Promise<ModerationSet> {
  const filters: NostrFilter[] = [
    // Owner-signed "hidden" labels (author filter = trust boundary).
    { kinds: [MODERATION_KIND], authors: [OWNER_PUBKEY], '#L': [MODERATION_NS], limit: 500 },
    // Owner's NIP-09 deletions (retractions of labels).
    { kinds: [5], authors: [OWNER_PUBKEY], limit: 500 },
  ];

  const settled = await Promise.allSettled(
    moderationRelays().map((url) =>
      getSearchRelay(url).query(filters, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      }),
    ),
  );

  const labelEvents = new Map<string, NostrEvent>();
  const deletedLabelIds = new Set<string>();

  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const ev of r.value) {
      if (ev.pubkey !== OWNER_PUBKEY) continue; // belt + suspenders
      if (ev.kind === MODERATION_KIND) {
        if (!labelEvents.has(ev.id)) labelEvents.set(ev.id, ev);
      } else if (ev.kind === 5) {
        for (const [n, v] of ev.tags) {
          if (n === 'e' && v) deletedLabelIds.add(v);
        }
      }
    }
  }

  const targets: HiddenTarget[] = [];
  for (const ev of labelEvents.values()) {
    if (deletedLabelIds.has(ev.id)) continue; // retracted
    const parsed = parseHiddenLabel(ev);
    if (parsed) targets.push(parsed);
  }

  return toModerationSet(targets);
}

/** The current moderation set (empty until loaded — filtering is additive). */
export function useModerationSet(): ModerationSet | undefined {
  return useQuery({
    queryKey: ['moderation-set'],
    queryFn: ({ signal }) => fetchModerationSet(signal),
    staleTime: 60_000,
    retry: 1,
  }).data;
}

/** Full hidden-target list with label ids (dashboard view). */
export function useHiddenTargets(): HiddenTarget[] | undefined {
  return useQuery({
    queryKey: ['moderation-targets'],
    queryFn: async ({ signal }) => {
      // Same fetch, but keep the label metadata for management.
      const filters: NostrFilter[] = [
        { kinds: [MODERATION_KIND], authors: [OWNER_PUBKEY], '#L': [MODERATION_NS], limit: 500 },
        { kinds: [5], authors: [OWNER_PUBKEY], limit: 500 },
      ];
      const settled = await Promise.allSettled(
        moderationRelays().map((url) =>
          getSearchRelay(url).query(filters, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          }),
        ),
      );
      const labelEvents = new Map<string, NostrEvent>();
      const deletedLabelIds = new Set<string>();
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const ev of r.value) {
          if (ev.pubkey !== OWNER_PUBKEY) continue;
          if (ev.kind === MODERATION_KIND) labelEvents.set(ev.id, ev);
          else if (ev.kind === 5) {
            for (const [n, v] of ev.tags) if (n === 'e' && v) deletedLabelIds.add(v);
          }
        }
      }
      return [...labelEvents.values()]
        .filter((ev) => !deletedLabelIds.has(ev.id))
        .map(parseHiddenLabel)
        .filter((t): t is HiddenTarget => t !== null)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    staleTime: 60_000,
    retry: 1,
  }).data;
}

/* ------------------------------------------------------------------ */
/* Abuse reports inbox (NIP-56)                                        */
/* ------------------------------------------------------------------ */

export interface AbuseReport {
  id: string;
  reporter: string;
  type: string;
  /** The reported target: url / event id / pubkey / address. */
  target: string;
  targetKind: 'url' | 'event' | 'profile' | 'address';
  content: string;
  createdAt: number;
}

function parseReport(event: NostrEvent): AbuseReport | null {
  if (event.kind !== REPORT_KIND) return null;
  const inNamespace = event.tags.some(([n, v]) => n === 'L' && v === REPORT_NS);
  if (!inNamespace) return null;

  // Report type from the target tag's 3rd entry or the l label.
  const labeled = event.tags.find(([n, , ns]) => n === 'l' && ns === REPORT_NS)?.[1];

  const rTag = event.tags.find(([n]) => n === 'r');
  const eTag = event.tags.find(([n]) => n === 'e');
  const pTag = event.tags.find(([n]) => n === 'p');
  const aTag = event.tags.find(([n]) => n === 'a');

  const targetTag = rTag ?? eTag ?? pTag ?? aTag;
  if (!targetTag?.[1]) return null;

  return {
    id: event.id,
    reporter: event.pubkey,
    type: labeled ?? targetTag[2] ?? 'other',
    target: targetTag[1],
    targetKind: rTag ? 'url' : eTag ? 'event' : pTag ? 'profile' : 'address',
    content: event.content.trim(),
    createdAt: event.created_at,
  };
}

export function useAbuseReports() {
  return useQuery({
    queryKey: ['abuse-reports'],
    queryFn: async ({ signal }) => {
      const filter: NostrFilter = {
        kinds: [REPORT_KIND],
        '#L': [REPORT_NS],
        limit: 200,
      };
      const settled = await Promise.allSettled(
        moderationRelays().map((url) =>
          getSearchRelay(url).query([filter], {
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          }),
        ),
      );

      const events = new Map<string, NostrEvent>();
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const ev of r.value) {
          if (!events.has(ev.id)) events.set(ev.id, ev);
        }
      }

      return [...events.values()]
        .map(parseReport)
        .filter((r): r is AbuseReport => r !== null)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    staleTime: 60_000,
    retry: 1,
  });
}

/* ------------------------------------------------------------------ */
/* Owner actions                                                       */
/* ------------------------------------------------------------------ */

export function useModerationActions() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  const isOwner = user?.pubkey === OWNER_PUBKEY;

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['moderation-set'] });
    void queryClient.invalidateQueries({ queryKey: ['moderation-targets'] });
  }, [queryClient]);

  /** Hide a result (URL or event id) from everyone's results. Owner only. */
  const hideTarget = useCallback(async (target: { url?: string; eventId?: string }) => {
    if (!isOwner) throw new Error('Not authorized');
    const template = buildHideLabel(target);
    if (!template) throw new Error('Invalid target');
    await createEvent(template);
    // Give relays a moment, then refresh the moderation reads.
    setTimeout(invalidate, 2000);
  }, [isOwner, createEvent, invalidate]);

  /** Un-hide (NIP-09 delete the label). Owner only. */
  const unhideTarget = useCallback(async (labelEventId: string) => {
    if (!isOwner) throw new Error('Not authorized');
    await createEvent(buildUnhideDelete(labelEventId));
    setTimeout(invalidate, 2000);
  }, [isOwner, createEvent, invalidate]);

  return { isOwner, hideTarget, unhideTarget };
}

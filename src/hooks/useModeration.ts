/**
 * Moderation hooks.
 *
 * useModerationSet() — PUBLIC read path, used by the search pipeline for
 * every user: fetches team-signed "hidden" labels (minus NIP-09 retracted
 * ones) and returns them as a lookup set. Trusted signers = owner + the
 * owner-published admin/mod role lists (see useAdminAccess).
 *
 * useAbuseReports() — the NIP-56 report inbox (dashboard).
 *
 * useModerationActions() — team publish actions (hide / unhide).
 * useRoleActions() — owner-only role list management.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelay } from '@/lib/searchRelays';
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
  buildRoleListEvent,
  getModerationRelayUrls,
  type HiddenTarget,
  type ModerationSet,
} from '@/lib/moderation';
import { useTrustedModerators, useAdminAccess } from '@/hooks/useAdminAccess';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/* ------------------------------------------------------------------ */
/* Public read: the hidden-targets set                                 */
/* ------------------------------------------------------------------ */

async function fetchHiddenLabels(
  signal: AbortSignal,
  trusted: Set<string>,
): Promise<{ targets: HiddenTarget[]; events: Map<string, NostrEvent>; deleted: Set<string> }> {
  const authorList = [...trusted];
  const filters: NostrFilter[] = [
    // Team-signed "hidden" labels (author filter = trust boundary).
    { kinds: [MODERATION_KIND], authors: authorList, '#L': [MODERATION_NS], limit: 500 },
    // Team NIP-09 deletions (retractions of labels).
    { kinds: [5], authors: authorList, limit: 500 },
  ];

  const settled = await Promise.allSettled(
    getModerationRelayUrls().map((url) =>
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
      if (!trusted.has(ev.pubkey)) continue; // belt + suspenders
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
    const parsed = parseHiddenLabel(ev, trusted);
    if (parsed) targets.push(parsed);
  }

  return { targets, events: labelEvents, deleted: deletedLabelIds };
}

/** The current moderation set (empty until loaded — filtering is additive). */
export function useModerationSet(): ModerationSet | undefined {
  const trusted = useTrustedModerators();
  const trustedKey = [...trusted].sort().join(',');

  return useQuery({
    queryKey: ['moderation-set', trustedKey],
    queryFn: ({ signal }) => fetchHiddenLabels(signal, trusted).then((r) => toModerationSet(r.targets)),
    staleTime: 60_000,
    retry: 1,
  }).data;
}

/** Full hidden-target list with label ids (dashboard view). */
export function useHiddenTargets(): HiddenTarget[] | undefined {
  const trusted = useTrustedModerators();
  const trustedKey = [...trusted].sort().join(',');

  return useQuery({
    queryKey: ['moderation-targets', trustedKey],
    queryFn: async ({ signal }) => {
      const { targets } = await fetchHiddenLabels(signal, trusted);
      return targets.sort((a, b) => b.createdAt - a.createdAt);
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
        getModerationRelayUrls().map((url) =>
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
/* Team actions (hide / unhide)                                        */
/* ------------------------------------------------------------------ */

/**
 * Publish a team-signed event to the MODERATION RELAY SET — the exact relays
 * every client reads labels/role lists from.
 *
 * Why not useNostrPublish? That publishes to the user's NIP-65 relay list.
 * Team events must land where readers look (getModerationRelayUrls) —
 * otherwise an owner whose personal relays don't overlap the app pools would
 * publish role lists nobody ever sees (the "added a mod but they can't see
 * the dashboard" bug).
 */
async function publishTeamEvent(
  user: NonNullable<ReturnType<typeof useCurrentUser>['user']>,
  template: { kind: number; content: string; tags: string[][] },
): Promise<void> {
  const event = await user.signer.signEvent({
    kind: template.kind,
    content: template.content,
    tags: template.tags,
    created_at: Math.floor(Date.now() / 1000),
  });

  const results = await Promise.allSettled(
    getModerationRelayUrls().map((url) =>
      getSearchRelay(url).event(event, { signal: AbortSignal.timeout(6000) }),
    ),
  );
  if (!results.some((r) => r.status === 'fulfilled')) {
    throw new Error('No moderation relay accepted the event');
  }
}

export function useModerationActions() {
  const { user } = useCurrentUser();
  const { isMod } = useAdminAccess();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['moderation-set'] });
    void queryClient.invalidateQueries({ queryKey: ['moderation-targets'] });
  }, [queryClient]);

  /** Hide a result (URL or event id) from everyone's results. Team only. */
  const hideTarget = useCallback(async (target: { url?: string; eventId?: string }) => {
    if (!user || !isMod) throw new Error('Not authorized');
    const template = buildHideLabel(target);
    if (!template) throw new Error('Invalid target');
    await publishTeamEvent(user, template);
    // Give relays a moment, then refresh the moderation reads.
    setTimeout(invalidate, 2000);
  }, [user, isMod, invalidate]);

  /** Un-hide (NIP-09 delete the label). Team only. */
  const unhideTarget = useCallback(async (labelEventId: string) => {
    if (!user || !isMod) throw new Error('Not authorized');
    await publishTeamEvent(user, buildUnhideDelete(labelEventId));
    setTimeout(invalidate, 2000);
  }, [user, isMod, invalidate]);

  return { isMod, hideTarget, unhideTarget };
}

/* ------------------------------------------------------------------ */
/* Owner actions (role lists)                                          */
/* ------------------------------------------------------------------ */

export function useRoleActions() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const isOwner = user?.pubkey === OWNER_PUBKEY;

  /** Publish a full role list (admins or mods) to the moderation relays. Owner only. */
  const updateRoleList = useCallback(async (dTag: string, pubkeys: string[]) => {
    if (!user || !isOwner) throw new Error('Only the owner can manage roles');
    await publishTeamEvent(user, buildRoleListEvent(dTag, pubkeys));
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
    }, 2000);
  }, [user, isOwner, queryClient]);

  return { isOwner, updateRoleList };
}

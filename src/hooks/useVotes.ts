/**
 * Vote hooks — 👍/👎 tallies and publishing (NIP-25, kind 7).
 *
 * Identity model (user's choice, Settings → Indexing):
 *   - Anonymous (default): signed by this device's built-in SIP-01
 *     indexing identity — pseudonymous, per-device, never the user's npub.
 *   - Attributable: signed with the logged-in Nostr key (like staking).
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { finalizeEvent } from 'nostr-tools/pure';
import { NRelay1, type NostrEvent, type NostrFilter } from '@nostrify/nostrify';

import { getSearchRelay } from '@/lib/searchRelays';
import { getIndexRelayUrls, getSearchRelayUrls } from '@/lib/appRelays';
import { getIndexerIdentity } from '@/lib/indexerIdentity';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useAppContext } from '@/hooks/useAppContext';
import {
  VOTE_KIND,
  buildVoteEvent,
  setMyVote,
  tallyVotes,
  voteTargetFor,
  type VoteDirection,
  type VoteTally,
  type VoteTarget,
} from '@/lib/votes';

/* Local hex helper (same as the indexer modules). */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Relay connection cache for anonymous vote publishes. */
const voteRelayCache = new Map<string, NRelay1>();
function getVoteRelay(url: string): NRelay1 {
  let relay = voteRelayCache.get(url);
  if (!relay) {
    relay = new NRelay1(url);
    voteRelayCache.set(url, relay);
  }
  return relay;
}

/** Batch-fetch tallies for a set of result targets (top visible results). */
export function useVoteCounts(targetKeys: string[]) {
  const key = targetKeys.slice(0, 20).sort().join(',');

  return useQuery({
    queryKey: ['vote-tallies', key],
    queryFn: async ({ signal }) => {
      const keys = key.split(',').filter(Boolean);
      if (keys.length === 0) return new Map<string, VoteTally>();

      const eventIds = keys.filter((k) => k.startsWith('e:')).map((k) => k.slice(2));
      const urls = keys.filter((k) => k.startsWith('u:')).map((k) => k.slice(2));

      const filters: NostrFilter[] = [];
      if (eventIds.length > 0) filters.push({ kinds: [VOTE_KIND], '#e': eventIds, limit: 500 });
      if (urls.length > 0) filters.push({ kinds: [VOTE_KIND], '#r': urls, limit: 500 });
      if (filters.length === 0) return new Map<string, VoteTally>();

      const relayUrls = [...new Set([...getIndexRelayUrls(), ...getSearchRelayUrls()])];
      const settled = await Promise.allSettled(
        relayUrls.map((url) =>
          getSearchRelay(url).query(filters, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
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

      return tallyVotes([...events.values()]);
    },
    enabled: key.length > 0,
    staleTime: 30_000,
    retry: 0,
  });
}

/** Publish votes. Anonymous (device identity) by default, npub when toggled. */
export function useVoteActions() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { config } = useAppContext();
  const queryClient = useQueryClient();

  const asIdentity = config.voteWithIdentity;

  const vote = useCallback(async (
    result: { url: string; nostrEvent?: { id: string } },
    direction: VoteDirection,
  ): Promise<VoteTarget> => {
    const target = voteTargetFor(result);
    if (!target) throw new Error('This result cannot be voted on');

    const template = buildVoteEvent(target, direction);

    if (asIdentity) {
      // Attributable: the user's own Nostr key (like keyword staking).
      if (!user) throw new Error('Log in to vote with your npub (or turn off "Vote with my npub")');
      await createEvent(template);
    } else {
      // Anonymous: this device's built-in indexing identity, direct to the
      // index relays (never the user's key, never the app relays' auth).
      const identity = getIndexerIdentity();
      const signedEvent = finalizeEvent(
        {
          kind: template.kind,
          created_at: Math.floor(Date.now() / 1000),
          tags: template.tags,
          content: template.content,
          pubkey: identity.pubkeyHex,
        },
        hexToBytes(identity.secretHex),
      );
      await Promise.allSettled(
        getIndexRelayUrls().map(async (url) => {
          const relay = getVoteRelay(url);
          await relay.event(signedEvent, { signal: AbortSignal.timeout(5000) });
        }),
      );
    }

    // Record locally (active button state) + refresh tallies.
    setMyVote(target.key, direction);
    void queryClient.invalidateQueries({ queryKey: ['vote-tallies'] });
    return target;
  }, [asIdentity, user, createEvent, queryClient]);

  return { vote, asIdentity, canVoteWithIdentity: !!user };
}

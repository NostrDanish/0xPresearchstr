import { useNostr } from '@nostrify/react';
import {
  NLogin,
  type NLoginType,
  type NostrConnectParams,
  type NostrConnectStatus,
  useNostrLogin,
} from '@nostrify/react/login';
import { useAppContext } from '@/hooks/useAppContext';
import { APP_RELAYS, toSecureRelayUrl } from '@/lib/appRelays';

// NOTE: This file should not be edited except for adding new login methods.

export type { NostrConnectParams, NostrConnectStatus };
export { generateNostrConnectParams, generateNostrConnectURI } from '@nostrify/react/login';

/** Upgrade any ws:// relay hints inside a bunker:// URI to wss:// (HTTPS pages). */
function sanitizeBunkerUri(uri: string): string {
  try {
    const u = new URL(uri);
    const relays = u.searchParams.getAll('relay');
    if (relays.length === 0) return uri;
    u.searchParams.delete('relay');
    for (const r of relays) u.searchParams.append('relay', toSecureRelayUrl(r));
    return u.toString();
  } catch {
    return uri; // unparsable — let Nostrify report the error as-is
  }
}

export function useLoginActions() {
  const { nostr } = useNostr();
  const { logins, addLogin, setLogin, removeLogin } = useNostrLogin();
  const { config } = useAppContext();

  // Add a login and promote it to be the current user. Without the
  // setLogin call the new login is appended to the end of the array,
  // leaving the prior account as logins[0] — which is what
  // useCurrentUser / useLoggedInAccounts treat as the active user.
  // Promoting here makes "Add another account" actually switch.
  const addAndActivate = (login: NLoginType) => {
    addLogin(login);
    setLogin(login.id);
  };

  return {
    // Login with a Nostr secret key
    nsec(nsec: string): void {
      const login = NLogin.fromNsec(nsec);
      addAndActivate(login);
    },
    // Login with a NIP-46 "bunker://" URI
    async bunker(uri: string): Promise<void> {
      // A bunker URI can carry its own relay hints (?relay=ws://…) that
      // bypass getRelayUrls() — upgrade them too, or one insecure hint
      // throws a synchronous SecurityError and kills the connect flow.
      const login = await NLogin.fromBunker(sanitizeBunkerUri(uri), nostr);
      addAndActivate(login);
    },
    // Login with a NIP-07 browser extension
    async extension(): Promise<void> {
      const login = await NLogin.fromExtension();
      addAndActivate(login);
    },
    // Login via nostrconnect:// (client-initiated NIP-46)
    // The client displays a QR code and waits for the remote signer to connect.
    //
    // `onStatus` is forwarded from @nostrify/react so the UI can render
    // live progress through the handshake phases — see NostrConnectStatus.
    async nostrconnect(
      params: NostrConnectParams,
      signal?: AbortSignal,
      onStatus?: (status: NostrConnectStatus) => void,
    ): Promise<void> {
      const login = await NLogin.fromNostrConnect(params, nostr, { signal, onStatus });
      addAndActivate(login);
    },
    // Get the relay URLs for NIP-46 nostrconnect communication.
    //
    // A handshake needs ONE relay both sides can reach — not the user's
    // whole (possibly exotic) NIP-65 list. Canonical NIP-46 relays lead,
    // then the user's own write relays (ws:// upgraded — a plain-ws entry
    // can't even be constructed on an HTTPS page), then app defaults.
    getRelayUrls(): string[] {
      const HANDSHAKE_RELAYS = [
        'wss://relay.nsec.app/',   // the canonical NIP-46 relay (nsec.app)
        'wss://relay.ditto.pub/',  // app default, reliable
      ];

      const userRelays = config.relayMetadata.relays
        .filter((r) => r.write)
        .map((r) => toSecureRelayUrl(r.url));
      const fallback = APP_RELAYS.relays.filter((r) => r.write).map((r) => r.url);

      return [...new Set([...HANDSHAKE_RELAYS, ...userRelays, ...fallback])];
    },
    // Log out the current user
    async logout(): Promise<void> {
      const login = logins[0];
      if (login) {
        removeLogin(login.id);
      }
    }
  };
}

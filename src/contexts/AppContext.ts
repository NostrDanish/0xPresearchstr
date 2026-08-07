import { createContext } from "react";

export type Theme = "dark" | "light" | "system" | "hacker" | "presearch";

export interface RelayMetadata {
  /** List of relays with read/write permissions */
  relays: { url: string; read: boolean; write: boolean }[];
  /** Unix timestamp of when the relay list was last updated */
  updatedAt: number;
}

/** Blossom server list metadata (BUD-03 / kind 10063), mirroring RelayMetadata for parity. */
export interface BlossomServerMetadata {
  /** Ordered list of Blossom server URLs (most trusted/reliable first per BUD-03). */
  servers: string[];
  /** Unix timestamp of when the server list was last updated (from kind 10063 created_at). */
  updatedAt: number;
}

export interface AppConfig {
  /** Current theme */
  theme: Theme;
  /** NIP-65 relay list metadata */
  relayMetadata: RelayMetadata;
  /** User's kind 10063 Blossom server list. */
  blossomServerMetadata: BlossomServerMetadata;
  /**
   * When true, the app's default Blossom servers are merged with the user's
   * servers (app servers first, deduped). When false, only the user's servers
   * are used.
   */
  useAppBlossomServers: boolean;
  /**
   * Privacy Mode — when true, only Nostr-tier providers run (cached index +
   * NIP-50 relay search). No queries leave for clearnet APIs, CORS proxies,
   * or third-party servers.
   */
  privacyMode: boolean;
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

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
  /**
   * Automatic indexing — when true, useful web results discovered during
   * searches are anonymously contributed to the shared Nostr index as
   * kind 39697 document observations, signed by this device's dedicated
   * indexing identity (never the personal Nostr identity, never the query).
   */
  autoIndex: boolean;
  /**
   * Search tab customization — fully modular: which tabs are visible, in
   * what order, and which one a fresh visit starts on.
   */
  tabConfig: TabConfig;
}

export interface TabConfig {
  /** All tabs in display order (visible + hidden). */
  order: string[];
  /** Tab ids currently hidden from the tab bar (e.g. tor/i2p by default). */
  hidden: string[];
  /** Tab a fresh visit starts on (when no ?source= URL param). */
  defaultTab: string;
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

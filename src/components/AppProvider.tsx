import { ReactNode, useEffect } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { AppContext, type AppConfig, type AppContextType, type Theme, type RelayMetadata, type BlossomServerMetadata } from '@/contexts/AppContext';
import { getBraveApiKey } from '@/lib/providers/brave';

interface AppProviderProps {
  children: ReactNode;
  /** Application storage key */
  storageKey: string;
  /** Default app configuration */
  defaultConfig: AppConfig;
}

// Zod schema for RelayMetadata validation
const RelayMetadataSchema = z.object({
  relays: z.array(z.object({
    url: z.url(),
    read: z.boolean(),
    write: z.boolean(),
  })),
  updatedAt: z.number(),
}) satisfies z.ZodType<RelayMetadata>;

// Zod schema for BlossomServerMetadata validation
const BlossomServerMetadataSchema = z.object({
  servers: z.array(z.url()),
  updatedAt: z.number(),
}) satisfies z.ZodType<BlossomServerMetadata>;

// Zod schema for TabConfig validation
const TabConfigSchema = z.object({
  order: z.array(z.string()),
  hidden: z.array(z.string()),
  defaultTab: z.string(),
});

// Zod schema for AppConfig validation
const AppConfigSchema = z.object({
  theme: z.enum(['dark', 'light', 'hacker']),
  relayMetadata: RelayMetadataSchema,
  blossomServerMetadata: BlossomServerMetadataSchema,
  useAppBlossomServers: z.boolean(),
  privacyMode: z.boolean(),
  autoIndex: z.boolean(),
  tabConfig: TabConfigSchema,
  voteWithIdentity: z.boolean(),
  disabledProviders: z.array(z.string()),
}) satisfies z.ZodType<AppConfig>;

export function AppProvider(props: AppProviderProps) {
  const {
    children,
    storageKey,
    defaultConfig,
  } = props;

  // App configuration state with localStorage persistence
  const [rawConfig, setConfig] = useLocalStorage<Partial<AppConfig>>(
    storageKey,
    {},
    {
      serialize: JSON.stringify,
      deserialize: (value: string) => {
        const parsed = JSON.parse(value);
        // Migrate retired themes: 'presearch' was the brand dark (now just
        // 'dark'), 'system' followed the device (removed). Map both to 'dark'
        // BEFORE zod so the enum doesn't reject the whole stored config.
        if (parsed && typeof parsed === 'object' && 'theme' in parsed) {
          const t = (parsed as { theme?: unknown }).theme;
          if (t === 'presearch' || t === 'system') {
            (parsed as { theme: unknown }).theme = 'dark';
          }
        }
        return AppConfigSchema.partial().parse(parsed);
      }
    }
  );

  // Generic config updater with callback pattern.
  // The updater returns the fields to change — they are MERGED into the
  // current stored config (never replace it), so callers can't wipe
  // unrelated settings by omitting them from the returned object.
  const updateConfig = (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => {
    setConfig((currentConfig) => ({ ...currentConfig, ...updater(currentConfig) }));
  };

  const config = { ...defaultConfig, ...rawConfig };

  // Migration: Brave is off by default now, but a stored Brave API key is an
  // explicit past opt-in. Users who never touched the engine list get Brave
  // re-enabled automatically; an explicitly stored list always wins.
  if (rawConfig.disabledProviders === undefined && config.disabledProviders.includes('brave') && getBraveApiKey()) {
    config.disabledProviders = config.disabledProviders.filter((id) => id !== 'brave');
  }

  const appContextValue: AppContextType = {
    config,
    updateConfig,
  };

  // Apply theme effects to document
  useApplyTheme(config.theme);

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}

/**
 * Hook to apply theme changes to the document root.
 * Two core themes (light/dark, both Presearch-branded) + hidden hacker.
 */
function useApplyTheme(theme: Theme) {
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark', 'hacker', 'presearch');

    // Hacker theme is dark-based, so we add both classes
    // so that dark-variant styles also apply.
    if (theme === 'hacker') {
      root.classList.add('dark', 'hacker');
      return;
    }

    root.classList.add(theme);
  }, [theme]);
}
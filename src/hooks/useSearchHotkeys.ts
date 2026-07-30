/**
 * Global search hotkeys:
 *   - Ctrl+K / Cmd+K → focus the search bar (from anywhere)
 *   - /              → focus the search bar (when not already typing)
 *
 * Relies on the search input carrying `id="search-input"` (SearchBar sets it).
 */
import { useEffect } from 'react';

function focusSearchInput() {
  const el = document.getElementById('search-input');
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
  }
}

export function useSearchHotkeys() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+K / Cmd+K — always intercept.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        focusSearchInput();
        return;
      }

      // "/" — only when the user isn't typing somewhere.
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const isTyping =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target?.isContentEditable ?? false);

        if (!isTyping) {
          e.preventDefault();
          focusSearchInput();
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

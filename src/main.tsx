import { createRoot } from 'react-dom/client';

/**
 * Relay machinery (NRelay1/websocket-ts) occasionally lets an AbortError
 * escape its internals when a relay times out or a query is cancelled —
 * e.g. a dead relay, or the .onion index relay on a clearnet browser.
 * Every call site treats these as non-fatal by design, so swallow ONLY
 * AbortError rejections here. Genuine errors still surface normally.
 *
 * Matched by `name` rather than `instanceof DOMException` — the abort
 * reason may be a cross-realm DOMException (iframes, sandboxed previews)
 * where instanceof fails.
 */
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { name?: unknown } | null | undefined;
  if (reason !== null && typeof reason === 'object' && reason.name === 'AbortError') {
    event.preventDefault();
  }
});

// Import polyfills first
import './lib/polyfills.ts';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import App from './App.tsx';
import './index.css';

import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

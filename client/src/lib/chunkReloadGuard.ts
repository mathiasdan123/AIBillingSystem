/**
 * Stale-tab self-healing after deploys.
 *
 * Production serves content-hashed JS chunks. After a deploy, a tab loaded
 * before the deploy still references old chunk hashes; when the user then
 * navigates to a lazily-loaded route, the old chunk no longer exists, the
 * server falls back to index.html for the missing asset, and the browser
 * rejects it ("Failed to load module script: ... MIME type of text/html").
 * Without intervention the page goes blank with no recovery.
 *
 * The fix is to reload the page once so the tab picks up the new bundle —
 * guarded by a sessionStorage timestamp (at most one automatic reload per
 * RELOAD_WINDOW_MS) so a genuinely broken build cannot reload-loop.
 *
 * Two hooks feed into the same guard:
 *  - Vite's `vite:preloadError` window event (dynamic-import/preload failure),
 *    installed by installChunkReloadListener() in main.tsx.
 *  - The route-level ErrorBoundary in App.tsx, which detects chunk-load
 *    errors by message pattern (isChunkLoadError) for failures that surface
 *    as a rejected React.lazy() promise instead of the Vite event.
 */

const RELOAD_GUARD_KEY = "chunk-reload-at";

/** At most one automatic reload per window; a second failure inside the
 * window means the new build itself is broken — surface the error instead. */
export const RELOAD_WINDOW_MS = 30_000;

const CHUNK_ERROR_PATTERNS = [
  // Chrome/Edge: dynamic import of a missing chunk
  /failed to fetch dynamically imported module/i,
  // Safari
  /importing a module script failed/i,
  // Firefox
  /error loading dynamically imported module/i,
  // Served index.html instead of the (now-missing) hashed chunk
  /expected a javascript.*module script/i,
  // Webpack-style / generic names kept for safety
  /chunkloaderror/i,
  /loading chunk [\w-]+ failed/i,
  /unable to preload css/i,
];

/** True when the error looks like a failed lazy-chunk load (stale deploy). */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : String((error as any)?.message ?? "");
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function readLastReloadAt(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
  } catch {
    // sessionStorage can throw (privacy mode, disabled storage) — in that
    // case we cannot persist the guard, so refuse the automatic reload
    // rather than risk an unbounded reload loop.
    return Number.NaN;
  }
}

/**
 * Reload the page to pick up a fresh bundle, at most once per
 * RELOAD_WINDOW_MS (tracked in sessionStorage). Returns true when a reload
 * was initiated, false when the guard suppressed it.
 */
export function attemptGuardedReload(
  reload: () => void = () => window.location.reload(),
): boolean {
  const last = readLastReloadAt();
  if (Number.isNaN(last) || Date.now() - last <= RELOAD_WINDOW_MS) {
    return false;
  }
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * Install the window-level listener for Vite's `vite:preloadError` event.
 * Only swallows the error (preventDefault) when a reload is actually
 * happening; otherwise the error propagates so the route ErrorBoundary can
 * render its fallback instead of the page hanging blank on a lazy import
 * that will never resolve.
 */
export function installChunkReloadListener(
  reload: () => void = () => window.location.reload(),
): () => void {
  const handler = (event: Event) => {
    if (attemptGuardedReload(reload)) {
      event.preventDefault();
    }
  };
  window.addEventListener("vite:preloadError", handler);
  return () => window.removeEventListener("vite:preloadError", handler);
}

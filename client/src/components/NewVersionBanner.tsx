/**
 * "TherapyBill was updated — refresh" nudge.
 *
 * SPA tabs never reload themselves, so a tab left open keeps RUNNING the
 * bundle it loaded — indefinitely. Across 2026-08-06→13 that produced a
 * recurring class of support noise: a user reports a bug, the fix deploys,
 * and their still-open tab keeps exhibiting the old behavior ("it's still
 * broken") until someone tells them to hard-refresh. The existing
 * vite:preloadError auto-reload only catches stale tabs that try to
 * lazy-load a chunk the new deploy deleted; a tab idling on already-loaded
 * screens stays silently stale.
 *
 * This compares the SHA baked into the bundle at build time
 * (VITE_RELEASE_SHA, set in the Dockerfile client stage) against the
 * server's current SHA via GET /api/release — on tab-refocus (the moment
 * stale tabs come back to life) plus a slow poll. Mismatch → banner with a
 * refresh button. Deliberately click-to-refresh, never auto-reload: a
 * front desk mid-way through an intake form must not lose their work to a
 * surprise reload.
 */

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

const CLIENT_SHA: string | undefined = import.meta.env.VITE_RELEASE_SHA;
const POLL_MS = 5 * 60 * 1000;
/** Session-scoped snooze so dismissing X doesn't nag again for the SAME release. */
const SNOOZE_KEY = "tb-version-snooze";

export default function NewVersionBanner() {
  const [serverSha, setServerSha] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const checking = useRef(false);

  // No baked SHA (local dev, storybook) → feature is inert.
  const enabled = !!CLIENT_SHA && CLIENT_SHA !== "unknown";

  useEffect(() => {
    if (!enabled) return;

    const check = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        const res = await fetch("/api/release", { cache: "no-store" });
        if (!res.ok) return; // transient server trouble is not this banner's job
        const data = await res.json();
        if (data?.release && data.release !== "unknown") {
          setServerSha(data.release);
        }
      } catch {
        // Offline / mid-deploy blips: stay quiet, the next check will see.
      } finally {
        checking.current = false;
      }
    };

    // Refocus is the moment stale tabs wake up — check immediately.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    const interval = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  const outdated = enabled && serverSha !== null && serverSha !== CLIENT_SHA;
  const snoozed =
    outdated && sessionStorage.getItem(SNOOZE_KEY) === serverSha;

  if (!outdated || dismissed || snoozed) return null;

  return (
    <div
      role="status"
      data-testid="new-version-banner"
      className="flex items-center justify-center gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"
    >
      <span>TherapyBill was updated.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 font-medium text-white hover:bg-blue-700"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Refresh to get the latest
      </button>
      <button
        type="button"
        aria-label="Dismiss until the next update"
        onClick={() => {
          if (serverSha) sessionStorage.setItem(SNOOZE_KEY, serverSha);
          setDismissed(true);
        }}
        className="text-blue-700 hover:text-blue-900 dark:text-blue-300"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

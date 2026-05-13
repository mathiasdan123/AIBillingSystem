import { useEffect, useState } from "react";

/**
 * Polls /api/health and compares the deployed git SHA against the SHA that
 * was baked into this client bundle at build time. Returns true when they
 * differ — i.e. the user is running a stale tab against a newer server.
 *
 * Caveats:
 *   - Returns false in dev (VITE_RELEASE_SHA is undefined/"unknown") so we
 *     don't spam reload prompts during local work.
 *   - Returns false if the server's release is "unknown" (legacy image
 *     pre-RELEASE_SHA plumbing). Avoids false positives during rollover.
 */
export function useVersionCheck(intervalMs: number = 5 * 60 * 1000): boolean {
  const buildSha = import.meta.env.VITE_RELEASE_SHA as string | undefined;
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    // Skip entirely when we don't have a real build SHA to compare against.
    if (!buildSha || buildSha === "unknown" || buildSha === "development") {
      return;
    }

    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/api/health", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const serverSha = data?.release;
        if (!serverSha || serverSha === "unknown") return;
        if (!cancelled && serverSha !== buildSha) {
          setIsStale(true);
        }
      } catch {
        // Network/server errors aren't actionable here; we'll try again.
      }
    };

    // Initial check on mount + interval + on focus.
    void check();
    const intervalId = window.setInterval(check, intervalMs);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [buildSha, intervalMs]);

  return isStale;
}

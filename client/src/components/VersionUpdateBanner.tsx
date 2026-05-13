import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, X } from "lucide-react";
import { useVersionCheck } from "@/hooks/useVersionCheck";

/**
 * Bottom-right toast-style banner that appears when the server is running
 * a newer build than the JavaScript currently executing in the tab. Click
 * "Reload" → full page reload → fresh HTML → fresh hashed bundle URLs.
 *
 * Dismissible (state only persists within the session). If the user
 * dismisses, the banner stays hidden until they refresh on their own or a
 * yet-newer version ships.
 */
export default function VersionUpdateBanner() {
  const isStale = useVersionCheck();
  const [dismissed, setDismissed] = useState(false);

  if (!isStale || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="version-update-banner"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-border bg-background shadow-lg p-4"
    >
      <div className="flex items-start gap-3">
        <RefreshCw className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">A new version is available</p>
          <p className="text-xs text-muted-foreground mt-1">
            Reload to get the latest fixes and features.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Button
              size="sm"
              onClick={() => window.location.reload()}
              data-testid="version-update-reload"
            >
              Reload now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(true)}
              data-testid="version-update-dismiss"
            >
              Later
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

interface Props {
  saving: boolean;
  lastSavedAt: Date | null;
}

function formatRelative(d: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** Renders a small "Draft saved Xs ago" line. Re-ticks every 15s. */
export function DraftSavedIndicator({ saving, lastSavedAt }: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!lastSavedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  if (saving) {
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
        data-testid="draft-saving"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        Saving draft…
      </div>
    );
  }
  if (!lastSavedAt) return null;
  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="draft-saved"
    >
      <Check className="w-3 h-3 text-green-600" />
      Draft saved {formatRelative(lastSavedAt)}
    </div>
  );
}

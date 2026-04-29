import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Info, AlertTriangle, AlertOctagon } from "lucide-react";

interface MaintenanceWindow {
  id: number;
  practiceId: number | null;
  message: string;
  severity: "info" | "warning" | "critical" | string;
  startsAt: string;
  endsAt: string;
  dismissible: boolean;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; Icon: typeof Info }> = {
  info: {
    bg: "bg-blue-50 dark:bg-blue-950",
    text: "text-blue-900 dark:text-blue-100",
    border: "border-blue-200 dark:border-blue-800",
    Icon: Info,
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-950",
    text: "text-amber-900 dark:text-amber-100",
    border: "border-amber-200 dark:border-amber-800",
    Icon: AlertTriangle,
  },
  critical: {
    bg: "bg-red-50 dark:bg-red-950",
    text: "text-red-900 dark:text-red-100",
    border: "border-red-200 dark:border-red-800",
    Icon: AlertOctagon,
  },
};

function formatCountdown(endsAt: string, nowMs: number): string {
  const endMs = new Date(endsAt).getTime();
  const diff = endMs - nowMs;
  if (diff <= 0) return "ending now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "ends in <1 min";
  if (minutes < 60) return `ends in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return remMin ? `ends in ${hours}h ${remMin}m` : `ends in ${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `ends in ${days}d ${remHours}h` : `ends in ${days}d`;
}

export default function MaintenanceWindowBanner() {
  const { data: windows } = useQuery<MaintenanceWindow[]>({
    queryKey: ["/api/maintenance-windows/active"],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
  });

  const [dismissedIds, setDismissedIds] = useState<Set<number>>(() => new Set());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Re-tick the countdown every 30s so the banner text stays accurate between refetches.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!windows || windows.length === 0) return null;

  const visible = windows.filter((w) => !dismissedIds.has(w.id));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col" role="region" aria-label="Maintenance announcements">
      {visible.map((w) => {
        const style = SEVERITY_STYLES[w.severity] ?? SEVERITY_STYLES.info;
        const { Icon } = style;
        return (
          <div
            key={w.id}
            data-testid={`maintenance-banner-${w.id}`}
            className={`flex items-start gap-3 px-4 py-2.5 border-b ${style.bg} ${style.text} ${style.border}`}
            role="alert"
          >
            <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 text-sm">
              <span className="font-medium">{w.message}</span>
              <span className="ml-2 opacity-75">({formatCountdown(w.endsAt, nowMs)})</span>
            </div>
            {w.dismissible && (
              <button
                type="button"
                onClick={() => setDismissedIds((prev) => new Set(prev).add(w.id))}
                className="flex-shrink-0 p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-current"
                aria-label="Dismiss maintenance banner"
                data-testid={`dismiss-maintenance-${w.id}`}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

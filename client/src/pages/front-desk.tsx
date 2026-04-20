import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import CopayModal from "@/components/CopayModal";
import {
  LogIn,
  LogOut,
  PlayCircle,
  CheckCircle2,
  Clock3,
  UserCheck,
  Activity,
} from "lucide-react";
import type { Appointment } from "@shared/schema";

// ---------- Design tokens (match the polished sidebar) ----------
const ICON_STROKE = 1.5;

// ---------- Types ----------
interface Patient {
  id: number;
  firstName: string;
  lastName: string;
}

interface Therapist {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
}

type ColumnKey = "arriving" | "waiting" | "inSession" | "readyToCheckOut";

interface ColumnConfig {
  key: ColumnKey;
  labelKey: string;
  emptyKey: string;
  icon: typeof LogIn;
  accent: string; // Tailwind text/border color class for the column header + card border
  accentBg: string;
}

// ---------- Helpers ----------
const startOfDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const endOfDay = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

function minutesBetween(from: Date | string, to: Date | string) {
  const a = typeof from === "string" ? new Date(from) : from;
  const b = typeof to === "string" ? new Date(to) : to;
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

function formatClock(iso: Date | string) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---------- Column definitions ----------
const COLUMNS: ColumnConfig[] = [
  {
    key: "arriving",
    labelKey: "frontDesk.columnArriving",
    emptyKey: "frontDesk.emptyArriving",
    icon: Clock3,
    accent: "text-sky-600",
    accentBg: "bg-sky-500",
  },
  {
    key: "waiting",
    labelKey: "frontDesk.columnWaiting",
    emptyKey: "frontDesk.emptyWaiting",
    icon: UserCheck,
    accent: "text-amber-600",
    accentBg: "bg-amber-500",
  },
  {
    key: "inSession",
    labelKey: "frontDesk.columnInSession",
    emptyKey: "frontDesk.emptyInSession",
    icon: Activity,
    accent: "text-emerald-600",
    accentBg: "bg-emerald-500",
  },
  {
    key: "readyToCheckOut",
    labelKey: "frontDesk.columnReadyToCheckOut",
    emptyKey: "frontDesk.emptyReadyToCheckOut",
    icon: CheckCircle2,
    accent: "text-slate-600",
    accentBg: "bg-slate-500",
  },
];

// ---------- Bucketing ----------
function bucketFor(apt: Appointment, now: Date): ColumnKey | null {
  // Terminal states don't appear on the board.
  if (apt.status === "cancelled" || apt.status === "no_show") return null;
  if (apt.checkedOutAt) return null;
  if (apt.status === "completed") return null;

  // Ready to check out: session ended but patient hasn't checked out yet.
  if (apt.sessionEndedAt && !apt.checkedOutAt) return "readyToCheckOut";

  // In session: started but not ended.
  if (apt.sessionStartedAt && !apt.sessionEndedAt) return "inSession";

  // Waiting: checked in but session not started.
  if (apt.checkedInAt && !apt.sessionStartedAt) return "waiting";

  // Arriving: starts within the next hour OR already late but not checked in.
  // Filter noisy future appointments by only showing those within 60 min of start.
  const startTime = new Date(apt.startTime);
  const minutesUntilStart = minutesBetween(now, startTime);
  if (!apt.checkedInAt && minutesUntilStart <= 60) return "arriving";

  return null;
}

// ---------- Page ----------
export default function FrontDeskPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Tick every 30s for live wait-time counters + re-bucketing.
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Today's appointments, auto-refetched by React Query.
  const { data: appointments = [], isLoading } = useQuery<{ data: Appointment[] } | Appointment[]>({
    queryKey: ["/api/appointments", "today", startOfDay(), endOfDay()],
    queryFn: async () => {
      const url = `/api/appointments?start=${encodeURIComponent(startOfDay())}&end=${encodeURIComponent(endOfDay())}&limit=200`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load appointments");
      return res.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Response shape: the endpoint returns either an array or a { data, page, ... } envelope.
  const flatAppointments: Appointment[] = Array.isArray(appointments)
    ? appointments
    : ((appointments as any)?.data ?? []);

  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
  });
  const { data: therapists = [] } = useQuery<Therapist[]>({
    queryKey: ["/api/therapists"],
  });

  // ---------- Mutations ----------
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });

  const stateMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "check-in" | "session-start" | "session-end" | "check-out" }) => {
      const res = await apiRequest("POST", `/api/appointments/${id}/${action}`, {});
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidate();
      const labels: Record<string, string> = {
        "check-in": t("frontDesk.checkIn"),
        "session-start": t("frontDesk.startSession"),
        "session-end": t("frontDesk.endSession"),
        "check-out": t("frontDesk.checkOut"),
      };
      toast({ title: labels[vars.action], description: "Saved." });
    },
    onError: (err: any) => {
      toast({
        title: "Action failed",
        description: err?.message ?? "Could not update the appointment",
        variant: "destructive",
      });
    },
  });

  // ---------- Copay modal wiring ----------
  // When the user clicks "Check in" for an arriving appointment, we first
  // open the copay modal. The modal fetches expected copay + payment methods,
  // then (on confirm) calls /copay/skip if the user chose "skip", and always
  // calls us back via onProceed to actually fire the check-in mutation.
  const [copayModalFor, setCopayModalFor] = useState<number | null>(null);

  const handleColumnAction = (id: number, action: "check-in" | "session-start" | "session-end" | "check-out") => {
    if (action === "check-in") {
      // Route through the copay modal. The modal renders instantly and the
      // fetch happens inside it — no blocking flicker on the card.
      setCopayModalFor(id);
      return;
    }
    stateMutation.mutate({ id, action });
  };

  // ---------- Bucket + summary ----------
  const { buckets, summary } = useMemo(() => {
    const b: Record<ColumnKey, Appointment[]> = {
      arriving: [],
      waiting: [],
      inSession: [],
      readyToCheckOut: [],
    };
    let total = 0;
    let completed = 0;
    for (const apt of flatAppointments) {
      const bucket = bucketFor(apt, nowTick);
      if (bucket) b[bucket].push(apt);
      // Today's total excludes cancellations; completed = done-and-checked-out.
      if (apt.status !== "cancelled") total++;
      if (apt.checkedOutAt || apt.status === "completed") completed++;
    }
    // Sort each bucket by startTime ascending (earliest first).
    for (const key of Object.keys(b) as ColumnKey[]) {
      b[key].sort((x, y) => new Date(x.startTime).getTime() - new Date(y.startTime).getTime());
    }
    return {
      buckets: b,
      summary: {
        total,
        waiting: b.waiting.length,
        inSession: b.inSession.length,
        completed,
      },
    };
  }, [flatAppointments, nowTick]);

  const patientName = (id: number | null | undefined) => {
    if (id == null) return "Unknown patient";
    const p = patients.find((p) => p.id === id);
    return p ? `${p.firstName} ${p.lastName}` : `Patient #${id}`;
  };
  const therapistName = (id: string | null | undefined) => {
    if (!id) return null;
    const tr = therapists.find((t) => t.id === id);
    if (!tr) return null;
    const first = tr.firstName ?? "";
    const last = tr.lastName ?? "";
    return `${first} ${last}`.trim() || null;
  };

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            {t("frontDesk.title", "Front Desk")}
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {t("frontDesk.subtitle", "Today's arrivals, waiting, in session, and checkouts")}
          </p>
        </div>
        <div className="flex gap-6 text-right">
          <SummaryStat label={t("frontDesk.summary.total", "Today")} value={summary.total} />
          <SummaryStat label={t("frontDesk.summary.waiting", "Waiting")} value={summary.waiting} accent="text-amber-600" />
          <SummaryStat label={t("frontDesk.summary.inSession", "In session")} value={summary.inSession} accent="text-emerald-600" />
          <SummaryStat label={t("frontDesk.summary.completed", "Completed")} value={summary.completed} accent="text-slate-600" />
        </div>
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => (
          <Column
            key={col.key}
            config={col}
            items={buckets[col.key]}
            isLoading={isLoading}
            now={nowTick}
            patientName={patientName}
            therapistName={therapistName}
            onAction={handleColumnAction}
            isPending={stateMutation.isPending}
          />
        ))}
      </div>

      <CopayModal
        appointmentId={copayModalFor}
        open={copayModalFor != null}
        onOpenChange={(o) => !o && setCopayModalFor(null)}
        onProceed={() => {
          if (copayModalFor != null) {
            stateMutation.mutate({ id: copayModalFor, action: "check-in" });
          }
          setCopayModalFor(null);
        }}
      />
    </div>
  );
}

// ---------- Summary stat ----------
function SummaryStat({ label, value, accent = "text-foreground" }: { label: string; value: number; accent?: string }) {
  return (
    <div className="min-w-[56px]">
      <div className={`text-[20px] font-semibold leading-none ${accent}`}>{value}</div>
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground mt-1">
        {label}
      </div>
    </div>
  );
}

// ---------- Column ----------
interface ColumnProps {
  config: ColumnConfig;
  items: Appointment[];
  isLoading: boolean;
  now: Date;
  patientName: (id: number | null | undefined) => string;
  therapistName: (id: string | null | undefined) => string | null;
  onAction: (id: number, action: "check-in" | "session-start" | "session-end" | "check-out") => void;
  isPending: boolean;
}

function Column({ config, items, isLoading, now, patientName, therapistName, onAction, isPending }: ColumnProps) {
  const { t } = useTranslation();
  const Icon = config.icon;

  return (
    <div className="flex flex-col gap-2">
      {/* Column header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${config.accent}`} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t(config.labelKey)}
          </span>
        </div>
        <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </div>

      {/* Column body */}
      <div className="flex flex-col gap-2">
        {isLoading && items.length === 0 ? (
          <EmptyColumn message={t("frontDesk.empty", "Loading…")} />
        ) : items.length === 0 ? (
          <EmptyColumn message={t(config.emptyKey)} />
        ) : (
          items.map((apt) => (
            <AppointmentCard
              key={apt.id}
              apt={apt}
              column={config.key}
              accentBg={config.accentBg}
              now={now}
              patientName={patientName}
              therapistName={therapistName}
              onAction={onAction}
              isPending={isPending}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyColumn({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-transparent px-3 py-6 text-center">
      <p className="text-[12px] text-muted-foreground">{message}</p>
    </div>
  );
}

// ---------- Appointment card ----------
interface CardProps {
  apt: Appointment;
  column: ColumnKey;
  accentBg: string;
  now: Date;
  patientName: (id: number | null | undefined) => string;
  therapistName: (id: string | null | undefined) => string | null;
  onAction: (id: number, action: "check-in" | "session-start" | "session-end" | "check-out") => void;
  isPending: boolean;
}

function AppointmentCard({ apt, column, accentBg, now, patientName, therapistName, onAction, isPending }: CardProps) {
  const { t } = useTranslation();
  const startTime = new Date(apt.startTime);
  const therapist = therapistName(apt.therapistId);

  // Relative time line per column.
  let relativeLine: string | null = null;
  if (column === "arriving") {
    const mins = minutesBetween(now, startTime);
    relativeLine = mins >= 0
      ? t("frontDesk.arrivingInMin", { minutes: mins, defaultValue: `Arrives in ${mins}m` })
      : t("frontDesk.overdueByMin", { minutes: Math.abs(mins), defaultValue: `${Math.abs(mins)}m late` });
  } else if (column === "waiting" && apt.checkedInAt) {
    const mins = minutesBetween(apt.checkedInAt, now);
    relativeLine = t("frontDesk.waitedForMin", { minutes: mins, defaultValue: `Waited ${mins}m` });
  } else if (column === "inSession" && apt.sessionStartedAt) {
    const mins = minutesBetween(apt.sessionStartedAt, now);
    relativeLine = t("frontDesk.inSessionForMin", { minutes: mins, defaultValue: `In session ${mins}m` });
  }

  // Action button per column.
  let primaryAction: { label: string; action: "check-in" | "session-start" | "session-end" | "check-out"; icon: typeof LogIn } | null = null;
  if (column === "arriving") primaryAction = { label: t("frontDesk.checkIn"), action: "check-in", icon: LogIn };
  else if (column === "waiting") primaryAction = { label: t("frontDesk.startSession"), action: "session-start", icon: PlayCircle };
  else if (column === "inSession") primaryAction = { label: t("frontDesk.endSession"), action: "session-end", icon: CheckCircle2 };
  else if (column === "readyToCheckOut") primaryAction = { label: t("frontDesk.checkOut"), action: "check-out", icon: LogOut };

  // Flag: waiting longer than a soft threshold → amber text
  const longWait =
    column === "waiting" &&
    apt.checkedInAt &&
    minutesBetween(apt.checkedInAt, now) >= 15;

  // Copay status pill — only meaningful after check-in and only when the
  // patient actually has a copay expected on the appointment row.
  const copayStatus = (apt as any).copayStatus as string | null;
  const copayExpected = (apt as any).copayExpected as string | null;
  const copayCollected = (apt as any).copayCollected as string | null;
  const copayAmount = copayCollected ?? copayExpected;
  const showCopayPill =
    apt.checkedInAt &&
    copayStatus &&
    copayStatus !== "not_applicable" &&
    (copayAmount || copayStatus === "skipped");

  return (
    <Card className="relative overflow-hidden border border-border/70 shadow-sm">
      {/* Left-edge accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentBg}`} aria-hidden="true" />

      <div className="pl-4 pr-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-foreground truncate leading-tight">
              {patientName(apt.patientId)}
            </div>
            <div className="text-[11.5px] text-muted-foreground mt-0.5 truncate">
              {formatClock(startTime)}
              {therapist ? ` · ${therapist}` : ""}
              {apt.title ? ` · ${apt.title}` : ""}
            </div>
          </div>
          {relativeLine && (
            <span
              className={`text-[10.5px] font-medium whitespace-nowrap tabular-nums ${
                longWait ? "text-amber-600" : "text-muted-foreground"
              }`}
            >
              {relativeLine}
            </span>
          )}
        </div>

        {showCopayPill && (
          <div className="mt-1.5">
            <CopayPill status={copayStatus!} amount={copayAmount ?? "0"} />
          </div>
        )}

        {primaryAction && (
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[12px] gap-1.5"
              onClick={() => onAction(apt.id, primaryAction!.action)}
              disabled={isPending}
            >
              <primaryAction.icon className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
              {primaryAction.label}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// Small status indicator for the copay state on waiting-room cards.
function CopayPill({ status, amount }: { status: string; amount: string }) {
  const { t } = useTranslation();
  const formatted = amount ? `$${parseFloat(amount).toFixed(2)}` : '—';
  let label = '';
  let tone = '';
  if (status === 'collected') {
    label = t('copay.checkedInCopayCollected', { amount: formatted });
    tone = 'bg-emerald-100 text-emerald-800 border-emerald-200';
  } else if (status === 'skipped') {
    label = t('copay.checkedInCopaySkipped');
    tone = 'bg-slate-100 text-slate-700 border-slate-200';
  } else if (status === 'pending' || status === 'failed') {
    label = t('copay.checkedInCopayPending', { amount: formatted });
    tone = 'bg-amber-100 text-amber-800 border-amber-200';
  } else {
    return null;
  }
  return (
    <Badge
      variant="outline"
      className={`text-[10.5px] font-medium h-5 px-1.5 border ${tone}`}
    >
      {label}
    </Badge>
  );
}

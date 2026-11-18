import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatDateOnly, isoDatePart, dateInputDaysFromNow, todayDateInput } from "@/lib/dateOnly";
import PageLayout from "@/components/PageLayout";
import {
  DollarSign,
  TrendingUp,
  FileWarning,
  Clock,
  ChevronRight,
  Check,
  AlarmClock,
  CalendarDays,
  RotateCcw,
} from "lucide-react";

interface ActionItem {
  id: string;
  kind: "follow_up";
  followUpId: number;
  followUpType: string;
  claimId: number;
  claimNumber: string | null;
  patientName: string | null;
  amount: number;
  priority: string;
  dueDate: string | null;
  notes: string | null;
  appealId?: number;
  status: string;
  snoozedUntil: string | null;
  completedAt: string | null;
}

interface RevenueAtRiskSummary {
  atRisk: { deniedAwaitingAppeal: number; aging61Plus: number; total: number };
  recovered: { last90Days: number; appealsWon: number; successRate: number };
  appeals: { pendingSubmission: number; pastDeadline: number };
  followUps: { total: number; byPriority: Record<string, number> };
  actionQueue: ActionItem[];
}

// Which slice of the queue the server returns (see revenueAtRiskService).
type QueueView = "open" | "snoozed" | "completed";
const QUEUE_VIEW_LABEL: Record<QueueView, string> = {
  open: "Open",
  snoozed: "Snoozed",
  completed: "Completed",
};

const money = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const PRIORITY_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  urgent: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};

const FOLLOW_UP_LABEL: Record<string, string> = {
  denial_appeal: "Denial — appeal",
  aging_30: "Aging 30+ days",
  aging_60: "Aging 60+ days",
  aging_90: "Aging 90+ days",
  missing_info: "Missing info",
  underpayment: "Underpaid claim",
};

function actionFor(item: ActionItem): { label: string; href: string } {
  if (item.followUpType === "denial_appeal") {
    return item.appealId
      ? { label: "Review appeal", href: `/appeals?appealId=${item.appealId}` }
      : { label: "Open appeals", href: "/appeals" };
  }
  return { label: "View claim", href: `/claims?claimId=${item.claimId}` };
}

const SNOOZE_PRESETS = [1, 3, 7] as const;

export default function RevenueAtRisk() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<QueueView>("open");
  // Follow-up id whose due date is being edited inline, if any.
  const [editingDueFor, setEditingDueFor] = useState<number | null>(null);
  const [snoozeDateFor, setSnoozeDateFor] = useState<Record<number, string>>({});

  // The default queryFn joins the key into the URL, so the view travels as
  // ?queue=…; the open queue (what used to be the only queue) is the default
  // and never shows completed or snoozed items.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["/api/revenue-at-risk/summary", `?queue=${view}`],
    enabled: isAuthenticated,
  }) as {
    data: RevenueAtRiskSummary | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
  };

  const refreshQueue = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/revenue-at-risk/summary"] });

  const fail = (title: string) => (err: Error) =>
    toast({ title, description: err.message, variant: "destructive" });

  const completeMutation = useMutation({
    mutationFn: async (followUpId: number) => {
      const res = await apiRequest("POST", `/api/follow-ups/${followUpId}/complete`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Marked complete", description: "It is listed under Completed." });
      refreshQueue();
    },
    onError: fail("Could not mark complete"),
  });

  const reopenMutation = useMutation({
    mutationFn: async (followUpId: number) => {
      const res = await apiRequest("PATCH", `/api/follow-ups/${followUpId}`, { status: "pending" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reopened", description: "It is back in the open queue." });
      refreshQueue();
    },
    onError: fail("Could not reopen"),
  });

  const snoozeMutation = useMutation({
    mutationFn: async ({ followUpId, until, days }: { followUpId: number; until?: string; days?: number }) => {
      const res = await apiRequest("POST", `/api/follow-ups/${followUpId}/snooze`, until ? { until } : { days });
      return res.json();
    },
    onSuccess: (updated: { snoozedUntil?: string | null }) => {
      toast({
        title: "Snoozed",
        description: updated?.snoozedUntil
          ? `Back in the queue on ${formatDateOnly(updated.snoozedUntil)}.`
          : "Hidden from the open queue.",
      });
      refreshQueue();
    },
    onError: fail("Could not snooze"),
  });

  const unsnoozeMutation = useMutation({
    mutationFn: async (followUpId: number) => {
      const res = await apiRequest("PATCH", `/api/follow-ups/${followUpId}`, { snoozedUntil: null });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Snooze cleared" });
      refreshQueue();
    },
    onError: fail("Could not clear snooze"),
  });

  const dueDateMutation = useMutation({
    mutationFn: async ({ followUpId, dueDate }: { followUpId: number; dueDate: string | null }) => {
      const res = await apiRequest("PATCH", `/api/follow-ups/${followUpId}`, { dueDate });
      return res.json();
    },
    onSuccess: () => {
      setEditingDueFor(null);
      toast({ title: "Due date updated" });
      refreshQueue();
    },
    onError: fail("Could not update due date"),
  });

  const queue = data?.actionQueue ?? [];

  return (
    <PageLayout
      title="Revenue at Risk"
      description="Money tied up in denials and aging claims, what's been recovered, and the prioritized work queue to recover the rest."
      isLoading={isLoading || (!isError && !data)}
      isError={isError}
      errorMessage="Failed to load revenue-at-risk data"
      onRetry={refetch}
    >
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4" /> Total at Risk
                </CardDescription>
                <CardTitle className="text-2xl text-amber-600">
                  {money(data.atRisk.total)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {money(data.atRisk.deniedAwaitingAppeal)} unappealed denials ·{" "}
                {money(data.atRisk.aging61Plus)} aging 61+ days
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4" /> Recovered (90 days)
                </CardDescription>
                <CardTitle className="text-2xl text-emerald-600">
                  {money(data.recovered.last90Days)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {data.recovered.appealsWon} appeals won ·{" "}
                {Math.round(data.recovered.successRate)}% success rate
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <FileWarning className="h-4 w-4" /> Appeals to Submit
                </CardDescription>
                <CardTitle className="text-2xl">{data.appeals.pendingSubmission}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Drafted and ready for review
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" /> Past Deadline
                </CardDescription>
                <CardTitle
                  className={`text-2xl ${data.appeals.pastDeadline > 0 ? "text-red-600" : ""}`}
                >
                  {data.appeals.pastDeadline}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Appeals past their filing deadline
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="text-base md:text-lg">Action Queue</CardTitle>
                  <CardDescription className="text-xs md:text-sm">
                    {view === "open"
                      ? `${queue.length} open item${queue.length === 1 ? "" : "s"}, highest priority first`
                      : view === "snoozed"
                        ? `${queue.length} snoozed item${queue.length === 1 ? "" : "s"}, hidden from the open queue until their date`
                        : `${queue.length} completed in the last 90 days, most recent first`}
                  </CardDescription>
                </div>
                <div className="flex gap-1" role="tablist" aria-label="Queue view">
                  {(Object.keys(QUEUE_VIEW_LABEL) as QueueView[]).map((v) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={view === v ? "default" : "outline"}
                      role="tab"
                      aria-selected={view === v}
                      onClick={() => setView(v)}
                      data-testid={`queue-view-${v}`}
                    >
                      {QUEUE_VIEW_LABEL[v]}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {queue.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  {view === "open"
                    ? "Nothing in the queue — no open denials or aging claims need attention."
                    : view === "snoozed"
                      ? "Nothing is snoozed."
                      : "Nothing completed in the last 90 days."}
                </p>
              ) : (
                <div className="divide-y">
                  {queue.map((item) => {
                    const action = actionFor(item);
                    const busy =
                      completeMutation.isPending || snoozeMutation.isPending ||
                      unsnoozeMutation.isPending || dueDateMutation.isPending || reopenMutation.isPending;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-4 py-3"
                        data-testid={`queue-item-${item.followUpId}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={PRIORITY_VARIANT[item.priority] ?? "secondary"}>
                              {item.priority}
                            </Badge>
                            <span className="text-sm font-medium">
                              {FOLLOW_UP_LABEL[item.followUpType] ?? item.followUpType}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {money(item.amount)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                            <span className="truncate">
                              {item.patientName ? `${item.patientName} · ` : ""}
                              Claim {item.claimNumber || item.claimId}
                            </span>
                            {/* Due date: rendered from the stored calendar day, never through
                                a local-time Date (a UTC-midnight 2027-01-17 showed as Jan 16). */}
                            {editingDueFor === item.followUpId ? (
                              <span className="inline-flex items-center gap-1">
                                <Input
                                  type="date"
                                  className="h-7 w-[9.5rem] text-xs"
                                  defaultValue={isoDatePart(item.dueDate) ?? ""}
                                  aria-label="Due date"
                                  data-testid={`due-date-input-${item.followUpId}`}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v) dueDateMutation.mutate({ followUpId: item.followUpId, dueDate: v });
                                  }}
                                />
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingDueFor(null)}>
                                  Cancel
                                </Button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                                title="Edit due date"
                                onClick={() => setEditingDueFor(item.followUpId)}
                                data-testid={`due-date-${item.followUpId}`}
                              >
                                <CalendarDays className="h-3 w-3" />
                                {item.dueDate ? `due ${formatDateOnly(item.dueDate)}` : "set due date"}
                              </button>
                            )}
                            {view === "snoozed" && item.snoozedUntil && (
                              <span data-testid={`snoozed-until-${item.followUpId}`}>
                                · Snoozed until {formatDateOnly(item.snoozedUntil)}
                              </span>
                            )}
                            {view === "completed" && item.completedAt && (
                              <span data-testid={`completed-at-${item.followUpId}`}>
                                · Completed {formatDateOnly(item.completedAt)}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {view === "completed" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => reopenMutation.mutate(item.followUpId)}
                              data-testid={`reopen-${item.followUpId}`}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" /> Reopen
                            </Button>
                          ) : (
                            <>
                              {view === "snoozed" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => unsnoozeMutation.mutate(item.followUpId)}
                                  data-testid={`unsnooze-${item.followUpId}`}
                                >
                                  <AlarmClock className="h-4 w-4 mr-1" /> Unsnooze
                                </Button>
                              ) : (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button size="sm" variant="outline" disabled={busy} data-testid={`snooze-${item.followUpId}`}>
                                      <AlarmClock className="h-4 w-4 mr-1" /> Snooze
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-56 space-y-2" align="end">
                                    <p className="text-xs text-muted-foreground">Hide until</p>
                                    <div className="flex gap-1">
                                      {SNOOZE_PRESETS.map((d) => (
                                        <Button
                                          key={d}
                                          size="sm"
                                          variant="secondary"
                                          className="flex-1"
                                          onClick={() => snoozeMutation.mutate({ followUpId: item.followUpId, days: d })}
                                          data-testid={`snooze-${item.followUpId}-${d}d`}
                                        >
                                          {d}d
                                        </Button>
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Input
                                        type="date"
                                        className="h-8 text-xs"
                                        min={dateInputDaysFromNow(1)}
                                        value={snoozeDateFor[item.followUpId] ?? ""}
                                        onChange={(e) =>
                                          setSnoozeDateFor((s) => ({ ...s, [item.followUpId]: e.target.value }))
                                        }
                                        aria-label="Snooze until date"
                                      />
                                      <Button
                                        size="sm"
                                        disabled={!snoozeDateFor[item.followUpId] || snoozeDateFor[item.followUpId] <= todayDateInput()}
                                        onClick={() =>
                                          snoozeMutation.mutate({ followUpId: item.followUpId, until: snoozeDateFor[item.followUpId] })
                                        }
                                      >
                                        Set
                                      </Button>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => completeMutation.mutate(item.followUpId)}
                                data-testid={`complete-${item.followUpId}`}
                              >
                                <Check className="h-4 w-4 mr-1" /> Done
                              </Button>
                            </>
                          )}
                          <Link href={action.href}>
                            <Button size="sm" variant="ghost">
                              {action.label}
                              <ChevronRight className="h-4 w-4 ml-1" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageLayout>
  );
}

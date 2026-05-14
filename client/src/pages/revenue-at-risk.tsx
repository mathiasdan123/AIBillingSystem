import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertTriangle,
  DollarSign,
  TrendingUp,
  FileWarning,
  Clock,
  ChevronRight,
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
}

interface RevenueAtRiskSummary {
  atRisk: { deniedAwaitingAppeal: number; aging61Plus: number; total: number };
  recovered: { last90Days: number; appealsWon: number; successRate: number };
  appeals: { pendingSubmission: number; pastDeadline: number };
  followUps: { total: number; byPriority: Record<string, number> };
  actionQueue: ActionItem[];
}

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
};

function actionFor(item: ActionItem): { label: string; href: string } {
  if (item.followUpType === "denial_appeal") {
    return item.appealId
      ? { label: "Review appeal", href: `/appeals?appealId=${item.appealId}` }
      : { label: "Open appeals", href: "/appeals" };
  }
  return { label: "View claim", href: `/claims?claimId=${item.claimId}` };
}

export default function RevenueAtRisk() {
  const { isAuthenticated } = useAuth();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["/api/revenue-at-risk/summary"],
    enabled: isAuthenticated,
  }) as {
    data: RevenueAtRiskSummary | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          Revenue at Risk
        </h1>
        <p className="text-sm text-muted-foreground">
          Money tied up in denials and aging claims, what's been recovered, and the
          prioritized work queue to recover the rest.
        </p>
      </div>

      {isError ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground mb-2">
            Failed to load revenue-at-risk data
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : isLoading || !data ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
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
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base md:text-lg">Action Queue</CardTitle>
                  <CardDescription className="text-xs md:text-sm">
                    {data.actionQueue.length} open item
                    {data.actionQueue.length === 1 ? "" : "s"}, highest priority first
                  </CardDescription>
                </div>
                <Link href="/follow-ups">
                  <Button size="sm" variant="outline" className="text-xs md:text-sm">
                    All follow-ups
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {data.actionQueue.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Nothing in the queue — no open denials or aging claims need attention.
                </p>
              ) : (
                <div className="divide-y">
                  {data.actionQueue.map((item) => {
                    const action = actionFor(item);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-4 py-3"
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
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {item.patientName ? `${item.patientName} · ` : ""}
                            Claim {item.claimNumber || item.claimId}
                            {item.dueDate
                              ? ` · due ${new Date(item.dueDate).toLocaleDateString()}`
                              : ""}
                          </p>
                        </div>
                        <Link href={action.href}>
                          <Button size="sm" variant="ghost" className="shrink-0">
                            {action.label}
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Radio } from "lucide-react";

interface SessionLogRow {
  therapistId: string;
  therapistName: string;
  credentials: string | null;
  completedSessions: number;
  completedEvaluations: number;
  totalCompleted: number;
  cancelled: number;
  noShow: number;
}
interface SessionLog {
  period: { start: string; end: string };
  generatedAt: string;
  therapists: SessionLogRow[];
  totals: { completedSessions: number; completedEvaluations: number; totalCompleted: number };
}

/**
 * HR session log: live per-therapist tally of completed sessions and
 * evaluations for a date range. Replaces the biweekly manual HR confirmation
 * — it reflects the current schedule (cancellations, waitlist adds) on every
 * load. Defaults to the last 14 days (the usual biweekly window).
 */
export default function SessionLogCard({ start, end }: { start: string; end: string }) {
  const [downloaded, setDownloaded] = useState(false);
  const { data, isLoading } = useQuery<SessionLog>({
    queryKey: [`/api/analytics/session-log?start=${start}&end=${end}`],
  });

  const exportCsv = () => {
    if (!data) return;
    const headers = ["Therapist", "Credentials", "Completed Sessions", "Completed Evaluations", "Total Completed", "Cancelled", "No-Show"];
    const rows = data.therapists.map((r) => [
      r.therapistName, r.credentials ?? "", r.completedSessions, r.completedEvaluations, r.totalCompleted, r.cancelled, r.noShow,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-log-${start}-to-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
  };

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            Session Log for HR
            <Badge variant="outline" className="gap-1 text-green-700 border-green-300">
              <Radio className="w-3 h-3" /> Live
            </Badge>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!data} data-testid="button-export-session-log">
            <Download className="w-3.5 h-3.5 mr-1" /> {downloaded ? "Downloaded" : "Export CSV"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Completed sessions and evaluations per therapist, {start} to {end}. Updates automatically with cancellations and additions.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : !data || data.therapists.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No therapists or sessions in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-1.5 pr-3">Therapist</th>
                  <th className="py-1.5 px-2 text-right">Sessions</th>
                  <th className="py-1.5 px-2 text-right">Evaluations</th>
                  <th className="py-1.5 px-2 text-right font-medium">Total</th>
                  <th className="py-1.5 px-2 text-right">Cancelled</th>
                  <th className="py-1.5 pl-2 text-right">No-Show</th>
                </tr>
              </thead>
              <tbody>
                {data.therapists.map((r) => (
                  <tr key={r.therapistId} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">
                      {r.therapistName}
                      {r.credentials && <span className="text-xs text-muted-foreground"> · {r.credentials}</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{r.completedSessions}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{r.completedEvaluations}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{r.totalCompleted}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{r.cancelled}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-muted-foreground">{r.noShow}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5 pr-3">All therapists</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{data.totals.completedSessions}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{data.totals.completedEvaluations}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{data.totals.totalCompleted}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ReportPageLayout from "./ReportPageLayout";

interface Row {
  therapistId: string | null;
  therapistFirstName: string | null;
  therapistLastName: string | null;
  avgDays: number | null;
  sessionCount: number;
  signedWithin24h: number;
  signedWithin7d: number;
  unsigned: number;
}

interface ReportResponse {
  start: string;
  end: string;
  rows: Row[];
}

const fmtPct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
const fmtDays = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}d`);

export default function DaysToNoteCompletion() {
  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/days-to-note-completion"],
    queryFn: async () => {
      const res = await fetch("/api/reports/days-to-note-completion", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const rows = data?.rows ?? [];
  const totalSessions = rows.reduce((s, r) => s + r.sessionCount, 0);
  const totalSignedIn24h = rows.reduce((s, r) => s + r.signedWithin24h, 0);
  const totalUnsigned = rows.reduce((s, r) => s + r.unsigned, 0);
  const avgDaysOverall =
    rows.length === 0 || totalSessions === 0
      ? null
      : rows.reduce((s, r) => s + (r.avgDays ?? 0) * r.sessionCount, 0) / totalSessions;

  return (
    <ReportPageLayout
      title="Days to Note Completion"
      description="Time from treatment session to signed SOAP note, per therapist."
      isLoading={isLoading}
      isError={isError}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Sessions in range</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{totalSessions}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Avg days to sign</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtDays(avgDaysOverall)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Signed within 24h</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtPct(totalSignedIn24h, totalSessions)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Unsigned</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-destructive">{totalUnsigned}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Therapist</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Avg Days</TableHead>
                <TableHead className="text-right">Signed &lt; 24h</TableHead>
                <TableHead className="text-right">Signed &lt; 7d</TableHead>
                <TableHead className="text-right">Unsigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No sessions in this date range.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.therapistId || "unknown"}>
                    <TableCell>{r.therapistFirstName || r.therapistLastName ? `${r.therapistFirstName ?? ""} ${r.therapistLastName ?? ""}`.trim() : "Unknown"}</TableCell>
                    <TableCell className="text-right">{r.sessionCount}</TableCell>
                    <TableCell className="text-right">{fmtDays(r.avgDays)}</TableCell>
                    <TableCell className="text-right">{fmtPct(r.signedWithin24h, r.sessionCount)}</TableCell>
                    <TableCell className="text-right">{fmtPct(r.signedWithin7d, r.sessionCount)}</TableCell>
                    <TableCell className="text-right">{r.unsigned}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ReportPageLayout>
  );
}

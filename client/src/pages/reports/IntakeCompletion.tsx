import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ReportPageLayout from "./ReportPageLayout";

interface PendingPatient {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

interface ReportResponse {
  start: string;
  end: string;
  totals: { total: number; completed: number; avgHoursToComplete: number | null };
  pending: PendingPatient[];
}

const fmtPct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
const fmtHours = (h: number | null) =>
  h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));

export default function IntakeCompletion() {
  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/intake-completion"],
    queryFn: async () => {
      const res = await fetch("/api/reports/intake-completion", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const totals = data?.totals ?? { total: 0, completed: 0, avgHoursToComplete: null };
  const pending = data?.pending ?? [];

  return (
    <ReportPageLayout
      title="Intake Completion"
      description="Intake form completion rates and time-to-complete for new patients."
      isLoading={isLoading}
      isError={isError}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">New patients</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{totals.total}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Completed</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{totals.completed}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Completion rate</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtPct(totals.completed, totals.total)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Avg time to complete</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtHours(totals.avgHoursToComplete)}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Pending intakes ({pending.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Days waiting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No pending intakes.</TableCell></TableRow>
              ) : (
                pending.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.firstName} {p.lastName}</TableCell>
                    <TableCell>{p.email || "—"}</TableCell>
                    <TableCell>{p.phone || "—"}</TableCell>
                    <TableCell className="text-right">{daysSince(p.createdAt)}</TableCell>
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

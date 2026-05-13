import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import ReportPageLayout from "./ReportPageLayout";

interface Row {
  therapistId: string | null;
  therapistFirstName: string | null;
  therapistLastName: string | null;
  availableHours: number;
  bookedHours: number;
  appointmentCount: number;
  utilization: number | null;
}

interface ReportResponse {
  start: string;
  end: string;
  rows: Row[];
}

const fmtHrs = (n: number) => `${n.toFixed(1)}h`;
const fmtPct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

export default function CapacityUtilization() {
  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/capacity-utilization"],
    queryFn: async () => {
      const res = await fetch("/api/reports/capacity-utilization", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const rows = data?.rows ?? [];
  const totalAvailable = rows.reduce((s, r) => s + r.availableHours, 0);
  const totalBooked = rows.reduce((s, r) => s + r.bookedHours, 0);
  const overallUtil = totalAvailable > 0 ? totalBooked / totalAvailable : null;

  return (
    <ReportPageLayout
      title="Capacity Utilization"
      description="Booked vs available hours per therapist. Available hours come from each therapist's weekly availability windows."
      isLoading={isLoading}
      isError={isError}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Therapists</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{rows.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Available hours</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtHrs(totalAvailable)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Booked hours</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtHrs(totalBooked)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Overall utilization</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtPct(overallUtil)}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Therapist</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Booked</TableHead>
                <TableHead className="text-right">Appts</TableHead>
                <TableHead className="text-right w-48">Utilization</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No availability or appointments in this date range.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.therapistId || "unknown"}>
                    <TableCell>{r.therapistFirstName || r.therapistLastName ? `${r.therapistFirstName ?? ""} ${r.therapistLastName ?? ""}`.trim() : "Unknown"}</TableCell>
                    <TableCell className="text-right">{fmtHrs(r.availableHours)}</TableCell>
                    <TableCell className="text-right">{fmtHrs(r.bookedHours)}</TableCell>
                    <TableCell className="text-right">{r.appointmentCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Progress value={r.utilization == null ? 0 : Math.min(100, r.utilization * 100)} className="w-24" />
                        <span className="tabular-nums text-sm w-12 text-right">{fmtPct(r.utilization)}</span>
                      </div>
                    </TableCell>
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

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ReportPageLayout from "./ReportPageLayout";

interface ByReason {
  reason: string | null;
  cancelledBy: string | null;
  count: number;
}

interface ByTherapist {
  therapistId: string | null;
  therapistFirstName: string | null;
  therapistLastName: string | null;
  cancelled: number;
  noShow: number;
  total: number;
}

interface ReportResponse {
  start: string;
  end: string;
  byReason: ByReason[];
  byTherapist: ByTherapist[];
}

const fmtPct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export default function Cancellations() {
  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/cancellations"],
    queryFn: async () => {
      const res = await fetch("/api/reports/cancellations", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const byReason = data?.byReason ?? [];
  const byTherapist = data?.byTherapist ?? [];
  const totalCancellations = byReason.reduce((s, r) => s + r.count, 0);
  const totalAppointments = byTherapist.reduce((s, r) => s + r.total, 0);

  return (
    <ReportPageLayout
      title="Cancellations Report"
      description="Cancellations and no-shows broken down by reason and therapist."
      isLoading={isLoading}
      isError={isError}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total appointments</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{totalAppointments}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Cancellations + no-shows</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{totalCancellations}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Cancellation rate</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtPct(totalCancellations, totalAppointments)}</p></CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">By Reason</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead>Cancelled by</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byReason.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No cancellations in range.</TableCell></TableRow>
                ) : (
                  byReason.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.reason || "—"}</TableCell>
                      <TableCell className="capitalize">{r.cancelledBy || "—"}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By Therapist</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Therapist</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">No-show</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byTherapist.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No appointments in range.</TableCell></TableRow>
                ) : (
                  byTherapist.map((r) => (
                    <TableRow key={r.therapistId || "unknown"}>
                      <TableCell>{r.therapistFirstName || r.therapistLastName ? `${r.therapistFirstName ?? ""} ${r.therapistLastName ?? ""}`.trim() : "Unknown"}</TableCell>
                      <TableCell className="text-right">{r.cancelled}</TableCell>
                      <TableCell className="text-right">{r.noShow}</TableCell>
                      <TableCell className="text-right">{fmtPct(r.cancelled + r.noShow, r.total)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ReportPageLayout>
  );
}

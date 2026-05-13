import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ReportPageLayout from "./ReportPageLayout";

interface Row {
  month: string;
  scheduled: number;
  completed: number;
  cancelled: number;
  noShow: number;
  newPatients: number;
  notesSigned: number;
  claimsSubmitted: number;
  paymentsCollected: number;
}

interface Totals {
  scheduled: number;
  completed: number;
  cancelled: number;
  noShow: number;
  newPatients: number;
  notesSigned: number;
  claimsSubmitted: number;
  paymentsCollected: number;
}

interface ReportResponse {
  start: string;
  end: string;
  totals: Totals;
  rows: Row[];
}

const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function OperationsReport() {
  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/operations"],
    queryFn: async () => {
      const res = await fetch("/api/reports/operations", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const rows = data?.rows ?? [];
  const t = data?.totals;

  return (
    <ReportPageLayout
      title="Operations Report"
      description="Practice-wide rollup: visits, cancellations, new patients, notes, claims, payments — by month."
      isLoading={isLoading}
      isError={isError}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Visits completed</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{t?.completed ?? 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Cancellations + no-shows</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{(t?.cancelled ?? 0) + (t?.noShow ?? 0)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">New patients</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{t?.newPatients ?? 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Payments collected</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtUSD(t?.paymentsCollected ?? 0)}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Cancelled</TableHead>
                <TableHead className="text-right">No-show</TableHead>
                <TableHead className="text-right">New pts</TableHead>
                <TableHead className="text-right">Notes signed</TableHead>
                <TableHead className="text-right">Claims sub.</TableHead>
                <TableHead className="text-right">Collected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No activity in this date range.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.month}>
                    <TableCell className="font-medium">{r.month}</TableCell>
                    <TableCell className="text-right">{r.completed}</TableCell>
                    <TableCell className="text-right">{r.cancelled}</TableCell>
                    <TableCell className="text-right">{r.noShow}</TableCell>
                    <TableCell className="text-right">{r.newPatients}</TableCell>
                    <TableCell className="text-right">{r.notesSigned}</TableCell>
                    <TableCell className="text-right">{r.claimsSubmitted}</TableCell>
                    <TableCell className="text-right">{fmtUSD(r.paymentsCollected)}</TableCell>
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

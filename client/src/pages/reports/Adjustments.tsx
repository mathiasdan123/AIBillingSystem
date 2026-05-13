import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ReportPageLayout from "./ReportPageLayout";

interface Row {
  month: string | null;
  payerName: string | null;
  primaryAdjustments: string;
  claimCount: number;
}

interface ReportResponse {
  start: string;
  end: string;
  rows: Row[];
}

const fmtMoney = (s: string | null | undefined) => `$${Number(s ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Adjustments() {
  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/adjustments"],
    queryFn: async () => {
      const res = await fetch("/api/reports/adjustments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const rows = data?.rows ?? [];
  const totalAdjustments = rows.reduce((s, r) => s + Number(r.primaryAdjustments), 0);
  const totalClaims = rows.reduce((s, r) => s + r.claimCount, 0);

  return (
    <ReportPageLayout
      title="Adjustments Report"
      description="Primary-payer contractual write-offs grouped by month and payer."
      isLoading={isLoading}
      isError={isError}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total adjustments</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtMoney(String(totalAdjustments))}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Claims with adjustments</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{totalClaims}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Avg per claim</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{totalClaims > 0 ? fmtMoney(String(totalAdjustments / totalClaims)) : "—"}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead className="text-right">Claims</TableHead>
                <TableHead className="text-right">Adjustments</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No adjustments in this range.</TableCell></TableRow>
              ) : (
                rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.month || "—"}</TableCell>
                    <TableCell>{r.payerName || "Unknown"}</TableCell>
                    <TableCell className="text-right">{r.claimCount}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.primaryAdjustments)}</TableCell>
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

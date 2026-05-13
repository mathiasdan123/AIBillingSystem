import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import ReportPageLayout from "./ReportPageLayout";

interface Row {
  id: number;
  claimNumber: string | null;
  patientFirstName: string | null;
  patientLastName: string | null;
  dateOfService: string | null;
  status: string | null;
  payerName: string | null;
  totalAmount: string | null;
  daysSinceDOS: number;
}

interface ReportResponse {
  filingDays: number;
  totals: { pastDue: number; atRisk: number; safe: number };
  rows: Row[];
}

const bucketBadge = (days: number, filingDays: number) => {
  if (days > filingDays) return <Badge variant="destructive">Past due</Badge>;
  if (days > filingDays - 14) return <Badge className="bg-amber-500 hover:bg-amber-600">At risk</Badge>;
  return <Badge variant="secondary">Safe</Badge>;
};

export default function TimelyFiling() {
  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/timely-filing"],
    queryFn: async () => {
      const res = await fetch("/api/reports/timely-filing", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const rows = data?.rows ?? [];
  const filingDays = data?.filingDays ?? 90;

  return (
    <ReportPageLayout
      title="Timely Filing"
      description={`Open claims sorted by days since date of service. Filing deadline assumed ${filingDays} days unless overridden per payer.`}
      isLoading={isLoading}
      isError={isError}
    >
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive">Past due</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-destructive">{data?.totals.pastDue ?? 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-600">At risk (within 14d)</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold text-amber-600">{data?.totals.atRisk ?? 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Safe</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{data?.totals.safe ?? 0}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim #</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>DOS</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No open claims at risk.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.claimNumber || `#${r.id}`}</TableCell>
                    <TableCell>{`${r.patientFirstName ?? ""} ${r.patientLastName ?? ""}`.trim() || "—"}</TableCell>
                    <TableCell>{r.payerName || "—"}</TableCell>
                    <TableCell>{r.dateOfService || "—"}</TableCell>
                    <TableCell className="text-right">{r.daysSinceDOS}</TableCell>
                    <TableCell className="capitalize">{r.status || "—"}</TableCell>
                    <TableCell>{bucketBadge(r.daysSinceDOS, filingDays)}</TableCell>
                    <TableCell className="text-right">${Number(r.totalAmount ?? 0).toFixed(2)}</TableCell>
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

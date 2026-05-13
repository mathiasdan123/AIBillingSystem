import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ReportPageLayout from "./ReportPageLayout";

interface ByMonth { month: string | null; count: number; }
interface BySource { sourceName: string; sourceType: string | null; count: number; }
interface ReportResponse { start: string; end: string; byMonth: ByMonth[]; bySource: BySource[]; }

export default function ReferralsByMonth() {
  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/referrals"],
    queryFn: async () => {
      const res = await fetch("/api/reports/referrals", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const byMonth = data?.byMonth ?? [];
  const bySource = data?.bySource ?? [];
  const total = byMonth.reduce((s, r) => s + r.count, 0);

  return (
    <ReportPageLayout
      title="Referrals by Month"
      description="Incoming referral volume broken down by month and source."
      isLoading={isLoading}
      isError={isError}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total referrals</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{total}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Distinct sources</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{bySource.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Top source</CardTitle></CardHeader>
          <CardContent><p className="text-base font-semibold truncate">{bySource[0]?.sourceName || "—"}</p></CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">By Month</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Referrals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byMonth.length === 0 ? (
                  <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-8">No referrals in range.</TableCell></TableRow>
                ) : (
                  byMonth.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.month || "—"}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By Source</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Referrals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySource.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No referrals in range.</TableCell></TableRow>
                ) : (
                  bySource.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.sourceName}</TableCell>
                      <TableCell className="capitalize">{r.sourceType || "—"}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
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

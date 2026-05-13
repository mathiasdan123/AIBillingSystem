import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import ReportPageLayout from "./ReportPageLayout";

interface Row {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  insuranceProvider: string | null;
  lastChecked: string | null;
}

interface ReportResponse {
  staleDays: number;
  count: number;
  rows: Row[];
}

const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)) : null);

export default function UnverifiedBenefits() {
  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/unverified-benefits"],
    queryFn: async () => {
      const res = await fetch("/api/reports/unverified-benefits", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const rows = data?.rows ?? [];
  const never = rows.filter((r) => !r.lastChecked).length;

  return (
    <ReportPageLayout
      title="Unverified Benefits"
      description={`Patients with insurance but no eligibility check in the last ${data?.staleDays ?? 90} days.`}
      isLoading={isLoading}
      isError={isError}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Patients needing check</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{data?.count ?? 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Never checked</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{never}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Previously checked, stale</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{(data?.count ?? 0) - never}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Insurance</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Last checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">All patient benefits are up to date.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.firstName} {r.lastName}</TableCell>
                    <TableCell>{r.insuranceProvider || "—"}</TableCell>
                    <TableCell>{r.email || "—"}</TableCell>
                    <TableCell>{r.phone || "—"}</TableCell>
                    <TableCell>
                      {r.lastChecked ? (
                        <span className="text-muted-foreground">{daysSince(r.lastChecked)}d ago</span>
                      ) : (
                        <Badge variant="destructive">Never</Badge>
                      )}
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

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import ReportPageLayout from "./ReportPageLayout";

interface Row {
  patientId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  paidByPatient: number;
  patientResponsibility: number;
  credit: number;
}

interface ReportResponse {
  count: number;
  totalCredit: number;
  rows: Row[];
}

const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function PatientCredits() {
  const [, setLocation] = useLocation();
  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/patient-credits"],
    queryFn: async () => {
      const res = await fetch("/api/reports/patient-credits", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const rows = data?.rows ?? [];

  return (
    <ReportPageLayout
      title="Patient Credits"
      description="Patients whose payments exceed their patient responsibility on file. Positive credit only."
      isLoading={isLoading}
      isError={isError}
    >
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Patients with credit</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{data?.count ?? 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total credit owed</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{fmtUSD(data?.totalCredit ?? 0)}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Patient paid</TableHead>
                <TableHead className="text-right">Responsibility</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No patient credits found.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.patientId}>
                    <TableCell>{`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Unknown"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.email || "—"}</TableCell>
                    <TableCell className="text-right">{fmtUSD(r.paidByPatient)}</TableCell>
                    <TableCell className="text-right">{fmtUSD(r.patientResponsibility)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtUSD(r.credit)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setLocation(`/patients/${r.patientId}`)}>
                        View
                      </Button>
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

import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, Activity, FileText, DollarSign } from "lucide-react";

type ReportStatus = "available" | "coming_soon";

interface CannedReport {
  name: string;
  description: string;
  route: string;
  status: ReportStatus;
  /** Optional query string appended to route (e.g. preset filters). */
  query?: string;
}

interface ReportCategory {
  id: string;
  label: string;
  icon: typeof Activity;
  reports: CannedReport[];
}

const CATEGORIES: ReportCategory[] = [
  {
    id: "operations",
    label: "Operations",
    icon: Activity,
    reports: [
      { name: "Outcomes", description: "Patient outcome measure summaries", route: "/outcome-measures", status: "available" },
      { name: "Expected Collections", description: "Forecasted A/R based on contracted rates", route: "/reimbursement", status: "available" },
      { name: "Tasking Report", description: "Open and overdue billing tasks", route: "/billing-tasks", status: "available" },
      { name: "Cancellations Report", description: "Cancellations by reason, therapist, and month", route: "/reports/cancellations", status: "available" },
      { name: "Days to Note Completion", description: "Time from visit to signed SOAP note, per therapist", route: "/reports/days-to-note-completion", status: "available" },
      { name: "Intake Completion", description: "Intake form completion rate and time-to-complete", route: "/reports/intake-completion", status: "available" },
      { name: "Referrals by Month", description: "Referral volume broken down by source", route: "/reports/referrals", status: "available" },
      { name: "Unverified Benefits", description: "Patients with no recent eligibility check", route: "/reports/unverified-benefits", status: "available" },
    ],
  },
  {
    id: "claims",
    label: "Claims",
    icon: FileText,
    reports: [
      { name: "Claims Report", description: "All claims filterable by status, payer, and date", route: "/claims", status: "available" },
      { name: "Detailed Charges", description: "Per-line-item charge breakdown", route: "/claims", status: "available" },
      { name: "Failed Edits & Rejections", description: "Claims rejected by the clearinghouse", route: "/claims", query: "?status=rejected", status: "available" },
      { name: "Productivity", description: "Visits and revenue per therapist", route: "/therapist-productivity", status: "available" },
      { name: "Claim Submission Log", description: "Submission timestamps and clearinghouse references", route: "/claims", status: "available" },
      { name: "Timely Filing", description: "Claims approaching the payer filing deadline", route: "/reports/timely-filing", status: "available" },
    ],
  },
  {
    id: "revenue",
    label: "Revenue",
    icon: DollarSign,
    reports: [
      { name: "Collections Report", description: "Money received by period and payment method", route: "/analytics", status: "available" },
      { name: "A/R Report", description: "Accounts receivable aging buckets", route: "/reimbursement", status: "available" },
      { name: "Old A/R Report", description: "Accounts receivable older than 120 days", route: "/reimbursement", query: "?bucket=120plus", status: "available" },
      { name: "Detailed ERA Report", description: "ERA breakdown by claim and CPT", route: "/remittance", status: "available" },
      { name: "Revenue by CPT Code", description: "Revenue aggregated by procedure code", route: "/analytics", status: "available" },
      { name: "Adjustments Report", description: "Contractual and bad-debt adjustments", route: "/reports/adjustments", status: "available" },
    ],
  },
];

export default function CannedReportsLibrary() {
  const [, setLocation] = useLocation();

  const openReport = (report: CannedReport) => {
    if (report.status !== "available") return;
    setLocation(`${report.route}${report.query || ""}`);
  };

  return (
    <Tabs defaultValue="operations" className="w-full">
      <TabsList className="grid w-full max-w-md grid-cols-3 mb-4">
        {CATEGORIES.map((cat) => (
          <TabsTrigger key={cat.id} value={cat.id} className="flex items-center gap-2">
            <cat.icon className="w-4 h-4" />
            {cat.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {CATEGORIES.map((cat) => (
        <TabsContent key={cat.id} value={cat.id} className="mt-0">
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {cat.reports.map((report) => {
                const isAvailable = report.status === "available";
                return (
                  <div
                    key={report.name}
                    className={`flex items-center justify-between gap-4 p-4 ${
                      isAvailable ? "hover:bg-accent/50 cursor-pointer" : "opacity-60"
                    }`}
                    onClick={() => openReport(report)}
                    role={isAvailable ? "button" : undefined}
                    tabIndex={isAvailable ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (isAvailable && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        openReport(report);
                      }
                    }}
                    data-testid={`canned-report-${cat.id}-${report.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-foreground">{report.name}</h3>
                        {!isAvailable && (
                          <Badge variant="secondary" className="text-xs">
                            <Clock className="w-3 h-3 mr-1" /> Coming soon
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{report.description}</p>
                    </div>
                    {isAvailable && (
                      <Button variant="ghost" size="sm" className="shrink-0">
                        Open <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  );
}

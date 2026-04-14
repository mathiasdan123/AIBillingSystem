import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Calendar,
  DollarSign,
  FileText,
  Mail,
  Printer,
  BarChart3,
  Users,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";

type ReportView = "daily" | "weekly";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function getChangeIcon(value: number) {
  if (value > 0) return <ArrowUpRight className="w-3.5 h-3.5 text-green-600" />;
  if (value < 0) return <ArrowDownRight className="w-3.5 h-3.5 text-red-600" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
}

function getChangeColor(value: number, invertPositive = false): string {
  if (value > 0) return invertPositive ? "text-red-600" : "text-green-600";
  if (value < 0) return invertPositive ? "text-green-600" : "text-red-600";
  return "text-gray-500";
}

function getPriorityBadge(priority: string) {
  const colors: Record<string, string> = {
    high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[priority] || "bg-gray-100 text-gray-800"}`}
    >
      {priority.toUpperCase()}
    </span>
  );
}

export default function InsightsReport() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<ReportView>("daily");
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0],
  );

  const dailyQuery = useQuery({
    queryKey: [`/api/analytics/reports/daily-insights?date=${selectedDate}`],
    enabled: isAuthenticated && view === "daily",
  });

  const weeklyQuery = useQuery({
    queryKey: [`/api/analytics/reports/weekly-insights?weekOf=${selectedDate}`],
    enabled: isAuthenticated && view === "weekly",
  });

  const emailMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/analytics/reports/daily-insights/email");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Report Emailed",
        description:
          data.message || "Daily insights report has been sent to practice admins.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Email Failed",
        description:
          error.message || "Could not send the report email. Check SMTP settings.",
        variant: "destructive",
      });
    },
  });

  const report: any = view === "daily" ? dailyQuery.data : weeklyQuery.data;
  const isLoading: boolean =
    view === "daily" ? dailyQuery.isLoading : weeklyQuery.isLoading;
  const isError: boolean = view === "daily" ? dailyQuery.isError : weeklyQuery.isError;

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64 print:ml-0 print:p-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            Practice Insights
          </h1>
          <p className="text-sm text-muted-foreground">
            AI-generated reports for front desk staff and practice owners
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
          >
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => emailMutation.mutate()}
            disabled={emailMutation.isPending}
          >
            <Mail className="w-4 h-4 mr-1" />{" "}
            {emailMutation.isPending ? "Sending..." : "Email Report"}
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6 print:hidden">
        <div className="flex rounded-lg border overflow-hidden">
          <Button
            variant={view === "daily" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setView("daily")}
          >
            Daily
          </Button>
          <Button
            variant={view === "weekly" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setView("weekly")}
          >
            Weekly
          </Button>
        </div>
        <Input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-auto"
        />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {isError && (
        <Card className="border-red-200">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Failed to load report. Please try again.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Daily Report */}
      {view === "daily" && report && !isLoading && (
        <DailyReportView report={report as any} />
      )}

      {/* Weekly Report */}
      {view === "weekly" && report && !isLoading && (
        <WeeklyReportView report={report as any} />
      )}
    </div>
  );
}

// ==================== DAILY REPORT VIEW ====================

function DailyReportView({ report }: { report: any }) {
  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">
                Claims Today
              </span>
            </div>
            <p className="text-2xl font-bold">{report.claimsSummary.newToday}</p>
            <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
              <span className="text-green-600">{report.claimsSummary.paidToday} paid</span>
              <span className="text-red-600">{report.claimsSummary.deniedToday} denied</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Revenue</span>
            </div>
            <p className="text-2xl font-bold">
              {formatCurrency(report.revenueCollectedToday)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">
                Appointments
              </span>
            </div>
            <p className="text-2xl font-bold">
              {report.patientVolume.completed}
            </p>
            <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
              <span>{report.patientVolume.noShows} no-shows</span>
              <span>{report.patientVolume.cancellations} cancelled</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-yellow-500" />
              <span className="text-xs text-muted-foreground">
                7-Day Denial Rate
              </span>
            </div>
            <p className={`text-2xl font-bold ${report.denialRateTrailing7Day > 10 ? "text-red-600" : "text-green-600"}`}>
              {report.denialRateTrailing7Day}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Action Items */}
      {report.actionItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Action Items
            </CardTitle>
            <CardDescription>
              Priority tasks based on today's data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.actionItems.map((item: any, i: number) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                >
                  <div className="mt-0.5">{getPriorityBadge(item.priority)}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.category}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aging Claims */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-500" />
            Aging Claims
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-100 dark:border-yellow-900">
              <p className="text-xl font-bold text-yellow-700 dark:text-yellow-400">
                {report.agingClaims.over30.count}
              </p>
              <p className="text-xs text-muted-foreground">30+ Days</p>
              <p className="text-xs font-medium text-yellow-600 dark:text-yellow-500 mt-1">
                {formatCurrency(report.agingClaims.over30.amount)}
              </p>
            </div>
            <div className="text-center p-3 rounded-lg bg-orange-50 dark:bg-orange-950 border border-orange-100 dark:border-orange-900">
              <p className="text-xl font-bold text-orange-700 dark:text-orange-400">
                {report.agingClaims.over60.count}
              </p>
              <p className="text-xs text-muted-foreground">60+ Days</p>
              <p className="text-xs font-medium text-orange-600 dark:text-orange-500 mt-1">
                {formatCurrency(report.agingClaims.over60.amount)}
              </p>
            </div>
            <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-100 dark:border-red-900">
              <p className="text-xl font-bold text-red-700 dark:text-red-400">
                {report.agingClaims.over90.count}
              </p>
              <p className="text-xs text-muted-foreground">90+ Days</p>
              <p className="text-xs font-medium text-red-600 dark:text-red-500 mt-1">
                {formatCurrency(report.agingClaims.over90.amount)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Expiring Authorizations */}
      {report.expiringAuthorizations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-500" />
              Authorizations Expiring (Next 7 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {report.expiringAuthorizations.map((auth: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50"
                >
                  <div>
                    <p className="text-sm font-medium">{auth.patientName}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires: {auth.expirationDate}
                    </p>
                  </div>
                  {auth.remainingVisits !== null && (
                    <span className="text-xs font-medium px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                      {auth.remainingVisits} visits left
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ==================== WEEKLY REPORT VIEW ====================

function WeeklyReportView({ report }: { report: any }) {
  return (
    <div className="space-y-6">
      {/* Week Header */}
      <p className="text-sm text-muted-foreground">
        Week of {report.weekOf} to {report.weekEnd}
      </p>

      {/* Claim Trends */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            Claim Trends
          </CardTitle>
          <CardDescription>This week vs. last week</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Total</p>
              <p className="text-xl font-bold">
                {report.claimTrends.thisWeek.total}
              </p>
              <div className="flex items-center justify-center gap-1 mt-1">
                {getChangeIcon(report.claimTrends.changePercent.total)}
                <span
                  className={`text-xs font-medium ${getChangeColor(report.claimTrends.changePercent.total)}`}
                >
                  {Math.abs(report.claimTrends.changePercent.total)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                vs {report.claimTrends.lastWeek.total} last week
              </p>
            </div>

            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Paid</p>
              <p className="text-xl font-bold text-green-600">
                {report.claimTrends.thisWeek.paid}
              </p>
              <div className="flex items-center justify-center gap-1 mt-1">
                {getChangeIcon(report.claimTrends.changePercent.paid)}
                <span
                  className={`text-xs font-medium ${getChangeColor(report.claimTrends.changePercent.paid)}`}
                >
                  {Math.abs(report.claimTrends.changePercent.paid)}%
                </span>
              </div>
            </div>

            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Denied</p>
              <p className="text-xl font-bold text-red-600">
                {report.claimTrends.thisWeek.denied}
              </p>
              <div className="flex items-center justify-center gap-1 mt-1">
                {getChangeIcon(report.claimTrends.changePercent.denied)}
                <span
                  className={`text-xs font-medium ${getChangeColor(report.claimTrends.changePercent.denied, true)}`}
                >
                  {Math.abs(report.claimTrends.changePercent.denied)}%
                </span>
              </div>
            </div>

            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Submitted</p>
              <p className="text-xl font-bold text-yellow-600">
                {report.claimTrends.thisWeek.submitted}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                vs {report.claimTrends.lastWeek.submitted}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Revenue Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-500" />
            Revenue Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-100 dark:border-green-900">
              <p className="text-lg font-bold text-green-700 dark:text-green-400">
                {formatCurrency(report.revenueSummary.totalCollected)}
              </p>
              <p className="text-xs text-muted-foreground">Collected</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-100 dark:border-yellow-900">
              <p className="text-lg font-bold text-yellow-700 dark:text-yellow-400">
                {formatCurrency(report.revenueSummary.totalOutstanding)}
              </p>
              <p className="text-xs text-muted-foreground">Outstanding</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
              <p className="text-lg font-bold text-blue-700 dark:text-blue-400">
                {formatCurrency(report.revenueSummary.totalExpected)}
              </p>
              <p className="text-xs text-muted-foreground">Expected</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Denial Reasons */}
        {report.topDenialReasons.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                Top Denial Reasons
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {report.topDenialReasons.map((item: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 rounded bg-muted/50"
                  >
                    <span className="text-sm truncate mr-2">{item.reason}</span>
                    <span className="text-sm font-bold text-red-600 flex-shrink-0">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Patient Volume Trends */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-500" />
              Patient Volume
            </CardTitle>
            <CardDescription>This week vs. last week</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  Completed
                </span>
                <span className="text-sm font-medium">
                  {report.patientVolumeTrends.thisWeek.completed}{" "}
                  <span className="text-muted-foreground">
                    (prev: {report.patientVolumeTrends.lastWeek.completed})
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm flex items-center gap-2">
                  <XCircle className="w-3.5 h-3.5 text-red-500" />
                  No-Shows
                </span>
                <span className="text-sm font-medium">
                  {report.patientVolumeTrends.thisWeek.noShows}{" "}
                  <span className="text-muted-foreground">
                    (prev: {report.patientVolumeTrends.lastWeek.noShows})
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />
                  Cancellations
                </span>
                <span className="text-sm font-medium">
                  {report.patientVolumeTrends.thisWeek.cancellations}{" "}
                  <span className="text-muted-foreground">
                    (prev: {report.patientVolumeTrends.lastWeek.cancellations})
                  </span>
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Collection Rate by Payer */}
      {report.collectionRateByPayer.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Collection Rate by Payer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                      Payer
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Billed
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Collected
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.collectionRateByPayer.map((payer: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 px-3">{payer.payer}</td>
                      <td className="py-2 px-3 text-right">
                        {formatCurrency(payer.billed)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {formatCurrency(payer.collected)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span
                          className={`font-medium ${payer.rate >= 90 ? "text-green-600" : payer.rate >= 70 ? "text-yellow-600" : "text-red-600"}`}
                        >
                          {payer.rate.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              AI Recommendations
            </CardTitle>
            <CardDescription>
              Suggestions based on this week's patterns
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {report.recommendations.map((rec: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-blue-500 mt-0.5 flex-shrink-0">
                    {i + 1}.
                  </span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Expiring Authorizations */}
      {report.expiringAuthorizations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-500" />
              Authorizations Expiring (Next 14 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {report.expiringAuthorizations.map((auth: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50"
                >
                  <div>
                    <p className="text-sm font-medium">{auth.patientName}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires: {auth.expirationDate}
                    </p>
                  </div>
                  {auth.remainingVisits !== null && (
                    <span className="text-xs font-medium px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                      {auth.remainingVisits} visits left
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  BarChart3,
  Download,
  Play,
  Save,
  Trash2,
  FolderOpen,
  FileText,
  PieChart,
  TrendingUp,
  LineChart,
  TableIcon,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart as RechartsLineChart,
  Line,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const REPORT_TYPES = [
  { value: "claims", label: "reportBuilder.types.claims" },
  { value: "revenue", label: "reportBuilder.types.revenue" },
  { value: "patients", label: "reportBuilder.types.patients" },
  { value: "appointments", label: "reportBuilder.types.appointments" },
  { value: "payer_performance", label: "reportBuilder.types.payerPerformance" },
  { value: "clinical", label: "Clinical" },
  { value: "operational", label: "Operational" },
  { value: "compliance", label: "Compliance" },
];

const DATE_PRESETS = [
  { value: "this_month", label: "reportBuilder.datePresets.thisMonth" },
  { value: "last_month", label: "reportBuilder.datePresets.lastMonth" },
  { value: "this_quarter", label: "reportBuilder.datePresets.thisQuarter" },
  { value: "last_quarter", label: "reportBuilder.datePresets.lastQuarter" },
  { value: "ytd", label: "reportBuilder.datePresets.ytd" },
  { value: "custom", label: "reportBuilder.datePresets.custom" },
];

const GROUP_BY_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  claims: [
    { value: "month", label: "Month" },
    { value: "status", label: "Status" },
    { value: "payer", label: "Payer" },
    { value: "therapist", label: "Therapist" },
  ],
  revenue: [
    { value: "month", label: "Month" },
    { value: "payer", label: "Payment Method" },
    { value: "cpt_code", label: "CPT Code" },
  ],
  patients: [
    { value: "month", label: "Month" },
    { value: "payer", label: "Insurance" },
  ],
  appointments: [
    { value: "month", label: "Month" },
    { value: "therapist", label: "Therapist" },
    { value: "status", label: "Status" },
  ],
  payer_performance: [
    { value: "payer", label: "Payer" },
    { value: "month", label: "Month" },
  ],
  clinical: [
    { value: "month", label: "Month" },
    { value: "patient", label: "Patient" },
    { value: "therapist", label: "Therapist" },
    { value: "cpt_code", label: "CPT Code" },
  ],
  operational: [
    { value: "month", label: "Month" },
    { value: "therapist", label: "Therapist" },
    { value: "cancellation_reason", label: "Cancellation Reason" },
  ],
  compliance: [
    { value: "month", label: "Month" },
    { value: "event_category", label: "Event Category" },
    { value: "mfa_status", label: "MFA Status" },
    { value: "consent_status", label: "Consent Status" },
  ],
};

const CHART_TYPES = [
  { value: "bar", label: "reportBuilder.chartTypes.bar", icon: BarChart3 },
  { value: "line", label: "reportBuilder.chartTypes.line", icon: LineChart },
  { value: "pie", label: "reportBuilder.chartTypes.pie", icon: PieChart },
  { value: "table", label: "reportBuilder.chartTypes.tableOnly", icon: TableIcon },
];

const CHART_COLORS = [
  "#2563eb", "#16a34a", "#dc2626", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
];

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "paid", label: "Paid" },
  { value: "denied", label: "Denied" },
];

const APPOINTMENT_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No Show" },
];

export default function Reports() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Report builder state
  const [reportType, setReportType] = useState("claims");
  const [datePreset, setDatePreset] = useState("this_month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [groupBy, setGroupBy] = useState("month");
  const [chartType, setChartType] = useState("bar");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayer, setFilterPayer] = useState("");
  const [filterTherapist, setFilterTherapist] = useState("");

  // Report results
  const [reportData, setReportData] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Save dialog
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");

  // Saved reports sidebar
  const [showSavedReports, setShowSavedReports] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: t("reportBuilder.unauthorized"),
        description: t("reportBuilder.loggedOut"),
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast, t]);

  // Fetch saved reports
  const { data: savedReports = [] } = useQuery({
    queryKey: ["/api/reports/custom/saved"],
    enabled: isAuthenticated,
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/reports/custom/saved", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  }) as any;

  // Reset groupBy when report type changes
  useEffect(() => {
    const options = GROUP_BY_OPTIONS[reportType];
    if (options && options.length > 0) {
      setGroupBy(options[0].value);
    }
    setFilterStatus("all");
    setFilterPayer("");
    setFilterTherapist("");
  }, [reportType]);

  // Build filters object
  const buildFilters = () => {
    const filters: any = { datePreset };
    if (datePreset === "custom") {
      filters.dateRange = { start: customStartDate, end: customEndDate };
    }
    if (filterStatus && filterStatus !== "all") filters.status = filterStatus;
    if (filterPayer) filters.payer = filterPayer;
    if (filterTherapist) filters.therapist = filterTherapist;
    return filters;
  };

  // Generate report
  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch("/api/reports/custom/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          reportType,
          filters: buildFilters(),
          groupBy,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to generate report");
      }
      const data = await res.json();
      setReportData(data);
    } catch (error: any) {
      toast({
        title: t("reportBuilder.error"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Save report
  const handleSave = async () => {
    if (!saveName.trim()) return;
    try {
      const res = await fetch("/api/reports/custom/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: saveName,
          description: saveDescription,
          reportType,
          filters: buildFilters(),
          groupBy,
          chartType,
        }),
      });
      if (!res.ok) throw new Error("Failed to save report");
      toast({
        title: t("reportBuilder.saved"),
        description: t("reportBuilder.savedDescription"),
      });
      setSaveDialogOpen(false);
      setSaveName("");
      setSaveDescription("");
      queryClient.invalidateQueries({ queryKey: ["/api/reports/custom/saved"] });
    } catch (error: any) {
      toast({
        title: t("reportBuilder.error"),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // Load saved report
  const handleLoadSavedReport = (report: any) => {
    setReportType(report.reportType);
    setChartType(report.chartType || "bar");
    setGroupBy(report.groupBy || "month");
    if (report.filters) {
      const f = report.filters as any;
      setDatePreset(f.datePreset || "this_month");
      if (f.dateRange) {
        setCustomStartDate(f.dateRange.start || "");
        setCustomEndDate(f.dateRange.end || "");
      }
      setFilterStatus(f.status || "all");
      setFilterPayer(f.payer || "");
      setFilterTherapist(f.therapist || "");
    }
    setShowSavedReports(false);
    toast({
      title: t("reportBuilder.loaded"),
      description: `${report.name}`,
    });
  };

  // Run saved report
  const handleRunSavedReport = async (reportId: number) => {
    setIsGenerating(true);
    try {
      const res = await fetch(`/api/reports/custom/saved/${reportId}/run`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to run report");
      const data = await res.json();
      setReportData(data);
      if (data.reportConfig) {
        setReportType(data.reportConfig.reportType);
        setChartType(data.reportConfig.chartType || "bar");
        setGroupBy(data.reportConfig.groupBy || "month");
      }
      setShowSavedReports(false);
    } catch (error: any) {
      toast({
        title: t("reportBuilder.error"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Delete saved report
  const handleDeleteSavedReport = async (reportId: number) => {
    try {
      const res = await fetch(`/api/reports/custom/saved/${reportId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete report");
      toast({
        title: t("reportBuilder.deleted"),
        description: t("reportBuilder.deletedDescription"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/custom/saved"] });
    } catch (error: any) {
      toast({
        title: t("reportBuilder.error"),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // Export CSV
  const handleExport = () => {
    const filters = buildFilters();
    const params = new URLSearchParams({
      reportType,
      filters: JSON.stringify(filters),
      groupBy,
    });
    window.open(`/api/reports/custom/export/csv?${params.toString()}`, "_blank");
    toast({
      title: t("reportBuilder.exportStarted"),
      description: t("reportBuilder.exportDescription"),
    });
  };

  // Get column headers for data table
  const tableColumns = useMemo(() => {
    if (!reportData?.data?.length) return [];
    const firstRow = reportData.data[0];
    // Filter out internal fields
    const excludeKeys = new Set(["patientFirstName", "patientLastName", "therapistFirstName", "therapistLastName", "createdAt"]);
    return Object.keys(firstRow).filter(k => !excludeKeys.has(k));
  }, [reportData]);

  // Format column name for display
  const formatColumnName = (key: string) => {
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .replace(/^\w/, c => c.toUpperCase())
      .trim();
  };

  // Format cell value
  const formatCellValue = (value: any, key: string) => {
    if (value === null || value === undefined) return "-";
    if (key.includes("amount") || key.includes("Amount") || key.includes("revenue") || key.includes("Revenue") ||
        key.includes("Billed") || key.includes("Paid") || key.includes("billed") || key.includes("paid")) {
      return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (key.includes("Rate") || key.includes("rate")) {
      return `${value}%`;
    }
    if (key.includes("At") || key.includes("Date") || key.includes("date") || key.includes("Time") || key.includes("time")) {
      if (typeof value === "string" && value.includes("T")) {
        return new Date(value).toLocaleDateString();
      }
    }
    return String(value);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const statusOptions = reportType === "appointments" ? APPOINTMENT_STATUS_OPTIONS : STATUS_OPTIONS;

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
      <div className="mb-6 md:mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100 mb-1 md:mb-2">
              {t("reportBuilder.title")}
            </h1>
            <p className="text-sm md:text-base text-slate-600 dark:text-slate-400">
              {t("reportBuilder.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSavedReports(!showSavedReports)}
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              {t("reportBuilder.savedReports")}
              {savedReports.length > 0 && (
                <span className="ml-1 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                  {savedReports.length}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Report Builder Controls */}
          <Card className="mb-6">
            <CardHeader className="px-4 md:px-6 pb-4">
              <CardTitle className="text-base md:text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                {t("reportBuilder.buildReport")}
              </CardTitle>
              <CardDescription className="text-xs md:text-sm">
                {t("reportBuilder.buildDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 md:px-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Report Type */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t("reportBuilder.reportType")}</Label>
                  <Select value={reportType} onValueChange={setReportType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REPORT_TYPES.map(rt => (
                        <SelectItem key={rt.value} value={rt.value}>
                          {t(rt.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Date Range */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t("reportBuilder.dateRange")}</Label>
                  <Select value={datePreset} onValueChange={setDatePreset}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_PRESETS.map(dp => (
                        <SelectItem key={dp.value} value={dp.value}>
                          {t(dp.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Group By */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t("reportBuilder.groupBy")}</Label>
                  <Select value={groupBy} onValueChange={setGroupBy}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(GROUP_BY_OPTIONS[reportType] || []).map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Chart Type */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t("reportBuilder.chartType")}</Label>
                  <Select value={chartType} onValueChange={setChartType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHART_TYPES.map(ct => (
                        <SelectItem key={ct.value} value={ct.value}>
                          <span className="flex items-center gap-2">
                            <ct.icon className="w-4 h-4" />
                            {t(ct.label)}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Custom date range */}
              {datePreset === "custom" && (
                <div className="flex items-center gap-3 mt-4">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("reportBuilder.startDate")}</Label>
                    <Input
                      type="date"
                      value={customStartDate}
                      onChange={e => setCustomStartDate(e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <span className="text-slate-500 mt-5">to</span>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("reportBuilder.endDate")}</Label>
                    <Input
                      type="date"
                      value={customEndDate}
                      onChange={e => setCustomEndDate(e.target.value)}
                      className="w-40"
                    />
                  </div>
                </div>
              )}

              {/* Filters row */}
              <div className="flex flex-wrap items-end gap-4 mt-4">
                {(reportType === "claims" || reportType === "appointments") && (
                  <div className="space-y-1">
                    <Label className="text-xs">{t("reportBuilder.status")}</Label>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger className="w-36">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map(s => (
                          <SelectItem key={s.value} value={s.value || "all"}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {(reportType === "claims" || reportType === "payer_performance") && (
                  <div className="space-y-1">
                    <Label className="text-xs">{t("reportBuilder.payerId")}</Label>
                    <Input
                      type="text"
                      placeholder={t("reportBuilder.payerIdPlaceholder")}
                      value={filterPayer}
                      onChange={e => setFilterPayer(e.target.value)}
                      className="w-36"
                    />
                  </div>
                )}

                {(reportType === "appointments" || reportType === "clinical" || reportType === "operational") && (
                  <div className="space-y-1">
                    <Label className="text-xs">{t("reportBuilder.therapistId")}</Label>
                    <Input
                      type="text"
                      placeholder={t("reportBuilder.therapistIdPlaceholder")}
                      value={filterTherapist}
                      onChange={e => setFilterTherapist(e.target.value)}
                      className="w-36"
                    />
                  </div>
                )}

                <div className="flex gap-2 ml-auto">
                  <Button onClick={handleGenerate} disabled={isGenerating}>
                    <Play className="w-4 h-4 mr-2" />
                    {isGenerating ? t("reportBuilder.generating") : t("reportBuilder.generate")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          {reportData && (
            <>
              {/* Summary */}
              {reportData.summary && (
                <Card className="mb-6">
                  <CardHeader className="px-4 md:px-6 pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base md:text-lg">
                        {t("reportBuilder.summary")}
                      </CardTitle>
                      <div className="flex gap-2">
                        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                              <Save className="w-4 h-4 mr-2" />
                              {t("reportBuilder.saveReport")}
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>{t("reportBuilder.saveReportTitle")}</DialogTitle>
                              <DialogDescription>
                                {t("reportBuilder.saveReportDescription")}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div className="space-y-2">
                                <Label>{t("reportBuilder.reportName")}</Label>
                                <Input
                                  value={saveName}
                                  onChange={e => setSaveName(e.target.value)}
                                  placeholder={t("reportBuilder.reportNamePlaceholder")}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>{t("reportBuilder.reportDescription")}</Label>
                                <Textarea
                                  value={saveDescription}
                                  onChange={e => setSaveDescription(e.target.value)}
                                  placeholder={t("reportBuilder.reportDescriptionPlaceholder")}
                                  rows={3}
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
                                {t("common.cancel")}
                              </Button>
                              <Button onClick={handleSave} disabled={!saveName.trim()}>
                                {t("common.save")}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                        <Button variant="outline" size="sm" onClick={handleExport}>
                          <Download className="w-4 h-4 mr-2" />
                          {t("reportBuilder.exportCsv")}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 md:px-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {Object.entries(reportData.summary)
                        .filter(([key]) => typeof reportData.summary[key] !== "object")
                        .map(([key, value]) => (
                          <div key={key} className="text-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border">
                            <p className="text-lg md:text-xl font-bold text-slate-900 dark:text-slate-100">
                              {formatCellValue(value, key)}
                            </p>
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                              {formatColumnName(key)}
                            </p>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Chart */}
              {chartType !== "table" && reportData.chartData && reportData.chartData.length > 0 && (
                <Card className="mb-6">
                  <CardHeader className="px-4 md:px-6 pb-3">
                    <CardTitle className="text-base md:text-lg">
                      {t("reportBuilder.visualization")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 md:px-6">
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        {chartType === "bar" ? (
                          <BarChart data={reportData.chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 12 }}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Legend />
                            {getChartDataKeys(reportData.chartData).map((key, i) => (
                              <Bar
                                key={key}
                                dataKey={key}
                                fill={CHART_COLORS[i % CHART_COLORS.length]}
                                name={formatColumnName(key)}
                              />
                            ))}
                          </BarChart>
                        ) : chartType === "line" ? (
                          <RechartsLineChart data={reportData.chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 12 }}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Legend />
                            {getChartDataKeys(reportData.chartData).map((key, i) => (
                              <Line
                                key={key}
                                type="monotone"
                                dataKey={key}
                                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                                name={formatColumnName(key)}
                                strokeWidth={2}
                              />
                            ))}
                          </RechartsLineChart>
                        ) : (
                          <RechartsPieChart>
                            <Tooltip />
                            <Legend />
                            <Pie
                              data={reportData.chartData}
                              dataKey={getPieDataKey(reportData.chartData)}
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              outerRadius={120}
                              label={({ name, percent }: any) =>
                                `${name}: ${(percent * 100).toFixed(0)}%`
                              }
                            >
                              {reportData.chartData.map((_: any, i: number) => (
                                <Cell key={`cell-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                          </RechartsPieChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Data Table */}
              {reportData.data && reportData.data.length > 0 && (
                <Card>
                  <CardHeader className="px-4 md:px-6 pb-3">
                    <CardTitle className="text-base md:text-lg">
                      {t("reportBuilder.dataTable")} ({reportData.data.length} {t("reportBuilder.rows")})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 md:px-6">
                    <div className="border rounded-lg overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50 dark:bg-slate-800">
                            {tableColumns.map(col => (
                              <TableHead key={col} className="whitespace-nowrap text-xs">
                                {formatColumnName(col)}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportData.data.slice(0, 100).map((row: any, idx: number) => (
                            <TableRow key={idx}>
                              {tableColumns.map(col => (
                                <TableCell key={col} className="whitespace-nowrap text-sm">
                                  {formatCellValue(row[col], col)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {reportData.data.length > 100 && (
                      <p className="text-sm text-slate-500 mt-2 text-center">
                        {t("reportBuilder.showingFirst", { count: 100, total: reportData.data.length })}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {reportData.data && reportData.data.length === 0 && (
                <Card>
                  <CardContent className="py-12 text-center">
                    <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                    <p className="text-lg font-medium text-slate-900 dark:text-slate-100">
                      {t("reportBuilder.noData")}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400">
                      {t("reportBuilder.noDataDescription")}
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Empty state */}
          {!reportData && !isGenerating && (
            <Card>
              <CardContent className="py-12 text-center">
                <BarChart3 className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-slate-900 dark:text-slate-100">
                  {t("reportBuilder.getStarted")}
                </p>
                <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  {t("reportBuilder.getStartedDescription")}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Saved Reports Sidebar */}
        {showSavedReports && (
          <div className="hidden lg:block w-72 flex-shrink-0">
            <Card className="sticky top-6">
              <CardHeader className="px-4 pb-3">
                <CardTitle className="text-sm font-medium">
                  {t("reportBuilder.savedReports")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                {savedReports.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">
                    {t("reportBuilder.noSavedReports")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {savedReports.map((report: any) => (
                      <div
                        key={report.id}
                        className="p-3 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                            {report.name}
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-slate-400 hover:text-red-500"
                            onClick={() => handleDeleteSavedReport(report.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                        {report.description && (
                          <p className="text-xs text-slate-500 mb-2 truncate">
                            {report.description}
                          </p>
                        )}
                        <div className="flex items-center gap-1 text-xs text-slate-400 mb-2">
                          <span className="capitalize">{report.reportType?.replace("_", " ")}</span>
                          <span>-</span>
                          <span>{report.chartType}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs flex-1"
                            onClick={() => handleLoadSavedReport(report)}
                          >
                            {t("reportBuilder.load")}
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-xs flex-1"
                            onClick={() => handleRunSavedReport(report.id)}
                          >
                            <Play className="w-3 h-3 mr-1" />
                            {t("reportBuilder.run")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper to extract numeric data keys from chart data (excluding 'name')
function getChartDataKeys(chartData: any[]): string[] {
  if (!chartData || chartData.length === 0) return [];
  const firstItem = chartData[0];
  return Object.keys(firstItem).filter(
    k => k !== "name" && typeof firstItem[k] === "number"
  );
}

// Helper to get the pie chart data key (first numeric field that's not 'name')
function getPieDataKey(chartData: any[]): string {
  const keys = getChartDataKeys(chartData);
  return keys[0] || "value";
}

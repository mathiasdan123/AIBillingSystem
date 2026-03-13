import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { Users, TrendingUp, DollarSign, Percent, ArrowUpDown, Download, UserCheck } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";

interface TherapistMetrics {
  therapistId: string;
  therapistName: string;
  credentials: string;
  appointmentsScheduled: number;
  appointmentsCompleted: number;
  cancellationRate: number;
  noShowRate: number;
  totalBilled: number;
  totalCollected: number;
  collectionRate: number;
  averageSessionsPerDay: number;
  averageRevenuePerSession: number;
  documentationCompletionRate: number;
  patientRetentionRate: number;
  totalPatients: number;
  totalSessions: number;
}

interface TrendMonth {
  month: string;
  appointmentsScheduled: number;
  appointmentsCompleted: number;
  cancellationRate: number;
  noShowRate: number;
  totalBilled: number;
  totalCollected: number;
  collectionRate: number;
}

interface TherapistTrend {
  therapistId: string;
  therapistName: string;
  months: TrendMonth[];
}

type SortKey = keyof TherapistMetrics;
type SortDir = "asc" | "desc";

const DATE_PRESETS: Record<string, { label: string; months: number }> = {
  "1month": { label: "Last 30 Days", months: 1 },
  "3months": { label: "Last 3 Months", months: 3 },
  "6months": { label: "Last 6 Months", months: 6 },
  "12months": { label: "Last 12 Months", months: 12 },
};

const COMPARISON_METRICS: Record<string, { key: SortKey; label: string; format: "number" | "currency" | "percent" }> = {
  appointmentsCompleted: { key: "appointmentsCompleted", label: "Appointments Completed", format: "number" },
  totalCollected: { key: "totalCollected", label: "Revenue Collected", format: "currency" },
  collectionRate: { key: "collectionRate", label: "Collection Rate", format: "percent" },
  noShowRate: { key: "noShowRate", label: "No-Show Rate", format: "percent" },
  documentationCompletionRate: { key: "documentationCompletionRate", label: "Documentation Rate", format: "percent" },
  averageSessionsPerDay: { key: "averageSessionsPerDay", label: "Sessions / Day", format: "number" },
  patientRetentionRate: { key: "patientRetentionRate", label: "Patient Retention", format: "percent" },
};

const TREND_METRICS: Record<string, { key: keyof TrendMonth; label: string; color: string }> = {
  appointmentsCompleted: { key: "appointmentsCompleted", label: "Appts Completed", color: "#2563eb" },
  totalCollected: { key: "totalCollected", label: "Revenue", color: "#16a34a" },
  collectionRate: { key: "collectionRate", label: "Collection Rate %", color: "#9333ea" },
  cancellationRate: { key: "cancellationRate", label: "Cancellation Rate %", color: "#dc2626" },
  noShowRate: { key: "noShowRate", label: "No-Show Rate %", color: "#ea580c" },
};

function formatValue(val: number, format: "number" | "currency" | "percent") {
  if (format === "currency") return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (format === "percent") return `${val.toFixed(1)}%`;
  return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export default function TherapistProductivity() {
  const { isAuthenticated } = useAuth();
  const { t } = useTranslation();

  const [datePreset, setDatePreset] = useState("3months");
  const [sortKey, setSortKey] = useState<SortKey>("totalCollected");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [comparisonMetric, setComparisonMetric] = useState("totalCollected");
  const [selectedTherapist, setSelectedTherapist] = useState<string>("all");
  const [trendMetric, setTrendMetric] = useState("appointmentsCompleted");

  const dateRange = useMemo(() => {
    const months = DATE_PRESETS[datePreset]?.months || 3;
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] };
  }, [datePreset]);

  const { data: productivityData = [], isLoading: prodLoading } = useQuery<TherapistMetrics[]>({
    queryKey: ["/api/analytics/therapist-productivity", dateRange.start, dateRange.end],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/therapist-productivity?start=${dateRange.start}&end=${dateRange.end}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const { data: trendData = [], isLoading: trendLoading } = useQuery<TherapistTrend[]>({
    queryKey: ["/api/analytics/therapist-productivity/trends", dateRange.start, dateRange.end],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/therapist-productivity/trends?start=${dateRange.start}&end=${dateRange.end}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  // Sorted data for the table
  const sortedData = useMemo(() => {
    const copy = [...productivityData];
    copy.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return copy;
  }, [productivityData, sortKey, sortDir]);

  // Overview aggregates
  const overview = useMemo(() => {
    if (productivityData.length === 0) return { therapists: 0, avgUtilization: 0, avgCollection: 0 };
    const totalAppts = productivityData.reduce((s, t) => s + t.appointmentsScheduled, 0);
    const completedAppts = productivityData.reduce((s, t) => s + t.appointmentsCompleted, 0);
    const avgCollection = productivityData.reduce((s, t) => s + t.collectionRate, 0) / productivityData.length;
    return {
      therapists: productivityData.length,
      avgUtilization: totalAppts > 0 ? Math.round((completedAppts / totalAppts) * 100) : 0,
      avgCollection: Math.round(avgCollection * 10) / 10,
    };
  }, [productivityData]);

  // Bar chart data
  const barChartData = useMemo(() => {
    const metric = COMPARISON_METRICS[comparisonMetric];
    if (!metric) return [];
    return sortedData.map((t) => ({
      name: t.therapistName.split(" ")[0],
      value: t[metric.key] as number,
    }));
  }, [sortedData, comparisonMetric]);

  // Line chart data for selected therapist
  const lineChartData = useMemo(() => {
    if (selectedTherapist === "all") {
      // Aggregate across all therapists
      const allMonths = new Map<string, TrendMonth>();
      for (const t of trendData) {
        for (const m of t.months) {
          const existing = allMonths.get(m.month);
          if (existing) {
            existing.appointmentsScheduled += m.appointmentsScheduled;
            existing.appointmentsCompleted += m.appointmentsCompleted;
            existing.totalBilled += m.totalBilled;
            existing.totalCollected += m.totalCollected;
            // For rates, we'll recompute after summing
          } else {
            allMonths.set(m.month, { ...m });
          }
        }
      }
      // Recompute rates
      const result = Array.from(allMonths.values()).sort((a, b) => a.month.localeCompare(b.month));
      for (const m of result) {
        m.cancellationRate = m.appointmentsScheduled > 0
          ? Math.round(((m.appointmentsScheduled - m.appointmentsCompleted) / m.appointmentsScheduled) * 100)
          : 0;
        m.collectionRate = m.totalBilled > 0
          ? Math.round((m.totalCollected / m.totalBilled) * 100)
          : 0;
      }
      return result;
    }
    const found = trendData.find((t) => t.therapistId === selectedTherapist);
    return found?.months || [];
  }, [trendData, selectedTherapist]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const exportCsv = () => {
    const headers = [
      "Therapist", "Credentials", "Appts Scheduled", "Appts Completed",
      "Cancellation Rate %", "No-Show Rate %", "Total Billed", "Total Collected",
      "Collection Rate %", "Avg Sessions/Day", "Avg Revenue/Session",
      "Documentation Rate %", "Patient Retention %",
    ];
    const rows = sortedData.map((t) => [
      t.therapistName, t.credentials, t.appointmentsScheduled, t.appointmentsCompleted,
      t.cancellationRate, t.noShowRate, t.totalBilled, t.totalCollected,
      t.collectionRate, t.averageSessionsPerDay, t.averageRevenuePerSession,
      t.documentationCompletionRate, t.patientRetentionRate,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `therapist-productivity-${dateRange.start}-to-${dateRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-accent/50"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className="w-3 h-3" />
        {sortKey === field && <span className="text-xs">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
      </div>
    </TableHead>
  );

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">{t("therapistProductivity.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("therapistProductivity.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={datePreset} onValueChange={setDatePreset}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DATE_PRESETS).map(([key, { label }]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={productivityData.length === 0}>
            <Download className="w-4 h-4 mr-1" />
            {t("therapistProductivity.exportCsv")}
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{overview.therapists}</p>
              <p className="text-xs text-muted-foreground">{t("therapistProductivity.totalTherapists")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{overview.avgUtilization}%</p>
              <p className="text-xs text-muted-foreground">{t("therapistProductivity.avgUtilization")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
              <Percent className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{overview.avgCollection}%</p>
              <p className="text-xs text-muted-foreground">{t("therapistProductivity.avgCollectionRate")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Comparison Table */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">{t("therapistProductivity.comparisonTable")}</CardTitle>
          <CardDescription>{t("therapistProductivity.comparisonDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {prodLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : sortedData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t("therapistProductivity.noData")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader label={t("therapistProductivity.colName")} field="therapistName" />
                  <SortHeader label={t("therapistProductivity.colAppointments")} field="appointmentsCompleted" />
                  <SortHeader label={t("therapistProductivity.colRevenue")} field="totalCollected" />
                  <SortHeader label={t("therapistProductivity.colCollectionRate")} field="collectionRate" />
                  <SortHeader label={t("therapistProductivity.colNoShowRate")} field="noShowRate" />
                  <SortHeader label={t("therapistProductivity.colDocCompletion")} field="documentationCompletionRate" />
                  <SortHeader label={t("therapistProductivity.colRetention")} field="patientRetentionRate" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.map((row) => (
                  <TableRow key={row.therapistId}>
                    <TableCell className="font-medium">
                      <div>{row.therapistName}</div>
                      {row.credentials && <span className="text-xs text-muted-foreground">{row.credentials}</span>}
                    </TableCell>
                    <TableCell>
                      <div>{row.appointmentsCompleted} / {row.appointmentsScheduled}</div>
                    </TableCell>
                    <TableCell>${row.totalCollected.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>
                      <Badge variant={row.collectionRate >= 80 ? "default" : row.collectionRate >= 60 ? "secondary" : "destructive"}>
                        {row.collectionRate.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.noShowRate <= 5 ? "default" : row.noShowRate <= 15 ? "secondary" : "destructive"}>
                        {row.noShowRate.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.documentationCompletionRate >= 90 ? "default" : row.documentationCompletionRate >= 70 ? "secondary" : "destructive"}>
                        {row.documentationCompletionRate.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell>{row.patientRetentionRate.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart - Therapist Comparison */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">{t("therapistProductivity.comparison")}</CardTitle>
              <Select value={comparisonMetric} onValueChange={setComparisonMetric}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(COMPARISON_METRICS).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {barChartData.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">{t("therapistProductivity.noData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip
                    formatter={(value: number) =>
                      formatValue(value, COMPARISON_METRICS[comparisonMetric]?.format || "number")
                    }
                  />
                  <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Line Chart - Trends Over Time */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <CardTitle className="text-base">{t("therapistProductivity.trends")}</CardTitle>
              <div className="flex gap-2">
                <Select value={selectedTherapist} onValueChange={setSelectedTherapist}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("therapistProductivity.allTherapists")}</SelectItem>
                    {productivityData.map((t) => (
                      <SelectItem key={t.therapistId} value={t.therapistId}>{t.therapistName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={trendMetric} onValueChange={setTrendMetric}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TREND_METRICS).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {trendLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : lineChartData.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">{t("therapistProductivity.noData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={lineChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey={TREND_METRICS[trendMetric]?.key || "appointmentsCompleted"}
                    stroke={TREND_METRICS[trendMetric]?.color || "#2563eb"}
                    name={TREND_METRICS[trendMetric]?.label || "Value"}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

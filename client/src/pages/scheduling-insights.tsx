import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarClock,
  Brain,
  Clock,
  TrendingUp,
  AlertTriangle,
  Info,
  XCircle,
  Lightbulb,
  BarChart3,
  Loader2,
} from "lucide-react";

interface ScheduleAnalysis {
  therapistId: string;
  therapistName: string;
  dateRange: { start: string; end: string };
  totalDays: number;
  totalAppointments: number;
  overallUtilizationRate: number;
  averageDailyAppointments: number;
  peakHours: { hour: number; count: number }[];
  offPeakHours: { hour: number; count: number }[];
  totalGapMinutes: number;
  averageGapMinutes: number;
  gaps: { date: string; startTime: string; endTime: string; durationMinutes: number; dayOfWeek: string }[];
  dailyUtilization: { date: string; dayOfWeek: string; scheduledMinutes: number; availableMinutes: number; utilizationRate: number; appointmentCount: number }[];
  backToBackRisks: { date: string; startTime: string; endTime: string; consecutiveCount: number }[];
  noShowRate: number;
}

interface ScheduleInsight {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

interface SlotSuggestion {
  date: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  score: number;
  reason: string;
}

interface HeatmapCell {
  dayOfWeek: number;
  hour: number;
  utilizationRate: number;
  appointmentCount: number;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getDateRange(period: string): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 7);

  const start = new Date(now);
  if (period === "week") {
    start.setDate(start.getDate() - 7);
  } else if (period === "month") {
    start.setMonth(start.getMonth() - 1);
  } else if (period === "quarter") {
    start.setMonth(start.getMonth() - 3);
  }

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function getHeatmapColor(rate: number): string {
  if (rate === 0) return "bg-muted";
  if (rate < 0.25) return "bg-green-100 dark:bg-green-950";
  if (rate < 0.5) return "bg-green-300 dark:bg-green-800";
  if (rate < 0.75) return "bg-yellow-300 dark:bg-yellow-800";
  return "bg-red-400 dark:bg-red-700";
}

function getSeverityIcon(severity: string) {
  switch (severity) {
    case "critical":
      return <XCircle className="w-5 h-5 text-red-500" />;
    case "warning":
      return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    default:
      return <Info className="w-5 h-5 text-blue-500" />;
  }
}

function getSeverityBadge(severity: string) {
  switch (severity) {
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "warning":
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Warning</Badge>;
    default:
      return <Badge variant="secondary">Info</Badge>;
  }
}

export default function SchedulingInsightsPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState("month");
  const [selectedTherapist, setSelectedTherapist] = useState<string>("all");

  const dateRange = getDateRange(period);

  // Fetch therapists
  const { data: therapists = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
  });

  const therapistList = therapists.filter(
    (u: any) => u.role === "therapist" || u.role === "admin"
  );

  // Fetch utilization heatmap
  const { data: heatmapData, isLoading: heatmapLoading } = useQuery<{
    heatmap: HeatmapCell[];
  }>({
    queryKey: ["/api/scheduling/utilization", dateRange.start, dateRange.end, selectedTherapist],
    queryFn: async () => {
      const params = new URLSearchParams({
        start: dateRange.start,
        end: dateRange.end,
      });
      if (selectedTherapist !== "all") {
        params.set("therapistId", selectedTherapist);
      }
      const res = await fetch(`/api/scheduling/utilization?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch heatmap");
      return res.json();
    },
  });

  // Fetch insights
  const {
    data: insightsData,
    isLoading: insightsLoading,
    refetch: refetchInsights,
  } = useQuery<{ insights: ScheduleInsight[] }>({
    queryKey: ["/api/scheduling/insights", dateRange.start, dateRange.end],
    queryFn: async () => {
      const params = new URLSearchParams({
        start: dateRange.start,
        end: dateRange.end,
      });
      const res = await fetch(`/api/scheduling/insights?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch insights");
      return res.json();
    },
    enabled: false, // Only fetch on button click
  });

  // Fetch analysis for selected therapist
  const { data: analysisData, isLoading: analysisLoading } = useQuery<ScheduleAnalysis>({
    queryKey: ["/api/scheduling/analysis", selectedTherapist, dateRange.start, dateRange.end],
    queryFn: async () => {
      const params = new URLSearchParams({
        therapistId: selectedTherapist,
        start: dateRange.start,
        end: dateRange.end,
      });
      const res = await fetch(`/api/scheduling/analysis?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch analysis");
      return res.json();
    },
    enabled: selectedTherapist !== "all",
  });

  // Fetch optimal slots for selected therapist
  const { data: slotsData, isLoading: slotsLoading } = useQuery<{
    slots: SlotSuggestion[];
  }>({
    queryKey: ["/api/scheduling/optimal-slots", selectedTherapist],
    queryFn: async () => {
      const params = new URLSearchParams({
        therapistId: selectedTherapist,
        duration: "50",
      });
      const res = await fetch(`/api/scheduling/optimal-slots?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch slots");
      return res.json();
    },
    enabled: selectedTherapist !== "all",
  });

  const heatmap = heatmapData?.heatmap || [];
  const insights = insightsData?.insights || [];
  const analysis = analysisData;
  const optimalSlots = slotsData?.slots || [];

  return (
    <div className="md:ml-64 pt-14 md:pt-0 pb-20 md:pb-0">
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <CalendarClock className="w-7 h-7 text-primary" />
              {t("schedulingInsights.title", "Scheduling Insights")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t(
                "schedulingInsights.subtitle",
                "AI-powered analysis to optimize therapist utilization and reduce scheduling gaps"
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">
                  {t("schedulingInsights.lastWeek", "Last Week")}
                </SelectItem>
                <SelectItem value="month">
                  {t("schedulingInsights.lastMonth", "Last Month")}
                </SelectItem>
                <SelectItem value="quarter">
                  {t("schedulingInsights.lastQuarter", "Last Quarter")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedTherapist} onValueChange={setSelectedTherapist}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("schedulingInsights.allTherapists", "All Therapists")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("schedulingInsights.allTherapists", "All Therapists")}
                </SelectItem>
                {therapistList.map((th: any) => (
                  <SelectItem key={th.id} value={th.id}>
                    {th.firstName && th.lastName
                      ? `${th.firstName} ${th.lastName}`
                      : th.email || th.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Stats Cards (shown when therapist selected) */}
        {selectedTherapist !== "all" && analysis && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="w-4 h-4" />
                  {t("schedulingInsights.utilizationRate", "Utilization Rate")}
                </div>
                <p className="text-2xl font-bold mt-1">
                  {Math.round(analysis.overallUtilizationRate * 100)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarClock className="w-4 h-4" />
                  {t("schedulingInsights.avgDailyAppts", "Avg Daily Appts")}
                </div>
                <p className="text-2xl font-bold mt-1">
                  {analysis.averageDailyAppointments}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  {t("schedulingInsights.totalGapHours", "Gap Hours")}
                </div>
                <p className="text-2xl font-bold mt-1">
                  {Math.round((analysis.totalGapMinutes / 60) * 10) / 10}h
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertTriangle className="w-4 h-4" />
                  {t("schedulingInsights.noShowRate", "No-Show Rate")}
                </div>
                <p className="text-2xl font-bold mt-1">
                  {Math.round(analysis.noShowRate * 100)}%
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs defaultValue="heatmap" className="space-y-4">
          <TabsList>
            <TabsTrigger value="heatmap">
              <BarChart3 className="w-4 h-4 mr-1" />
              {t("schedulingInsights.heatmap", "Heatmap")}
            </TabsTrigger>
            <TabsTrigger value="insights">
              <Brain className="w-4 h-4 mr-1" />
              {t("schedulingInsights.insights", "AI Insights")}
            </TabsTrigger>
            {selectedTherapist !== "all" && (
              <TabsTrigger value="slots">
                <Lightbulb className="w-4 h-4 mr-1" />
                {t("schedulingInsights.optimalSlots", "Optimal Slots")}
              </TabsTrigger>
            )}
          </TabsList>

          {/* Heatmap Tab */}
          <TabsContent value="heatmap">
            <Card>
              <CardHeader>
                <CardTitle>
                  {t("schedulingInsights.utilizationHeatmap", "Utilization Heatmap")}
                </CardTitle>
                <CardDescription>
                  {t(
                    "schedulingInsights.heatmapDesc",
                    "Appointment density by day of week and time of day. Darker cells indicate higher utilization."
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {heatmapLoading ? (
                  <div className="flex items-center justify-center h-48">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : heatmap.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    {t("schedulingInsights.noData", "No scheduling data found for this period.")}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-xs text-muted-foreground font-medium p-2 text-left w-16">
                            {t("schedulingInsights.time", "Time")}
                          </th>
                          {[1, 2, 3, 4, 5].map((dow) => (
                            <th
                              key={dow}
                              className="text-xs text-muted-foreground font-medium p-2 text-center"
                            >
                              {DAY_NAMES[dow]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 11 }, (_, i) => i + 8).map((hour) => (
                          <tr key={hour}>
                            <td className="text-xs text-muted-foreground p-2 whitespace-nowrap">
                              {formatHour(hour)}
                            </td>
                            {[1, 2, 3, 4, 5].map((dow) => {
                              const cell = heatmap.find(
                                (c) => c.dayOfWeek === dow && c.hour === hour
                              );
                              const rate = cell?.utilizationRate || 0;
                              const count = cell?.appointmentCount || 0;
                              return (
                                <td key={dow} className="p-1">
                                  <div
                                    className={`rounded-md h-10 flex items-center justify-center text-xs font-medium transition-colors ${getHeatmapColor(rate)} ${
                                      rate > 0.5
                                        ? "text-white dark:text-gray-100"
                                        : "text-foreground"
                                    }`}
                                    title={`${DAY_FULL_NAMES[dow]} ${formatHour(hour)}: ${Math.round(rate * 100)}% utilized (${count} appts)`}
                                  >
                                    {count > 0 ? count : ""}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Legend */}
                    <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                      <span>{t("schedulingInsights.legend", "Legend")}:</span>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded bg-muted" />
                        <span>0%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded bg-green-100 dark:bg-green-950" />
                        <span>&lt;25%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded bg-green-300 dark:bg-green-800" />
                        <span>&lt;50%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded bg-yellow-300 dark:bg-yellow-800" />
                        <span>&lt;75%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded bg-red-400 dark:bg-red-700" />
                        <span>75%+</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Insights Tab */}
          <TabsContent value="insights">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>
                      {t("schedulingInsights.aiInsights", "AI Scheduling Insights")}
                    </CardTitle>
                    <CardDescription>
                      {t(
                        "schedulingInsights.insightsDesc",
                        "Data-driven recommendations to optimize your practice schedule."
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    onClick={() => refetchInsights()}
                    disabled={insightsLoading}
                  >
                    {insightsLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Brain className="w-4 h-4 mr-2" />
                    )}
                    {t("schedulingInsights.analyzeSchedule", "Analyze Schedule")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {insightsLoading ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {t("schedulingInsights.analyzing", "Analyzing schedule patterns...")}
                    </p>
                  </div>
                ) : insights.length === 0 ? (
                  <div className="text-center py-12">
                    <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">
                      {t(
                        "schedulingInsights.clickAnalyze",
                        'Click "Analyze Schedule" to generate AI-powered insights about your scheduling patterns.'
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {insights.map((insight, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-3 p-4 rounded-lg border border-border"
                      >
                        {getSeverityIcon(insight.severity)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{insight.title}</span>
                            {getSeverityBadge(insight.severity)}
                          </div>
                          <p className="text-sm text-muted-foreground">{insight.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Optimal Slots Tab */}
          {selectedTherapist !== "all" && (
            <TabsContent value="slots">
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t("schedulingInsights.suggestedSlots", "Suggested Appointment Slots")}
                  </CardTitle>
                  <CardDescription>
                    {t(
                      "schedulingInsights.slotsDesc",
                      "Optimal times for scheduling a new 50-minute appointment. Slots that fill gaps score higher."
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {slotsLoading ? (
                    <div className="flex items-center justify-center h-48">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : optimalSlots.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      {t(
                        "schedulingInsights.noSlots",
                        "No optimal slots found. The therapist may have a fully booked schedule."
                      )}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {optimalSlots.map((slot, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div className="text-center min-w-[80px]">
                              <p className="text-sm font-medium">{slot.dayOfWeek}</p>
                              <p className="text-xs text-muted-foreground">{slot.date}</p>
                            </div>
                            <div>
                              <p className="font-medium text-sm">
                                {slot.startTime} - {slot.endTime}
                              </p>
                              <p className="text-xs text-muted-foreground">{slot.reason}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="flex items-center gap-1">
                                <div
                                  className="h-2 rounded-full bg-primary"
                                  style={{ width: `${slot.score}px` }}
                                />
                                <span className="text-xs font-medium text-muted-foreground">
                                  {slot.score}
                                </span>
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                {t("schedulingInsights.matchScore", "match score")}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>

        {/* Therapist Utilization Summary (when viewing all) */}
        {selectedTherapist === "all" && therapistList.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                {t("schedulingInsights.therapistUtilization", "Therapist Utilization")}
              </CardTitle>
              <CardDescription>
                {t(
                  "schedulingInsights.utilizationDesc",
                  "Select a therapist above for detailed analysis and optimal slot suggestions."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {therapistList.map((th: any) => (
                  <button
                    key={th.id}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors text-left"
                    onClick={() => setSelectedTherapist(th.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                        {(th.firstName?.[0] || th.email?.[0] || "?").toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {th.firstName && th.lastName
                            ? `${th.firstName} ${th.lastName}`
                            : th.email || th.id}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">{th.role}</p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {t("schedulingInsights.viewDetails", "View Details")} &rarr;
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

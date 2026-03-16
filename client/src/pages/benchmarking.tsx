import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  Clock,
  FileCheck,
  AlertTriangle,
  Zap,
  CalendarX,
  UserX,
  Users,
  Activity,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IndustryBenchmark {
  key: string;
  label: string;
  group: "financial" | "operational" | "clinical";
  unit: string;
  min: number;
  max: number;
  target: number;
  lowerIsBetter: boolean;
}

type KPIValues = Record<string, number>;

interface TrendMonth {
  month: string;
  [key: string]: string | number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PERIOD_OPTIONS = [
  { value: "1m", label: "Current Month" },
  { value: "3m", label: "Last 3 Months" },
  { value: "6m", label: "Last 6 Months" },
  { value: "12m", label: "Last 12 Months" },
];

const GROUP_LABELS: Record<string, string> = {
  financial: "Financial Performance",
  operational: "Operational Efficiency",
  clinical: "Clinical Metrics",
};

const GROUP_ORDER = ["financial", "operational", "clinical"];

const METRIC_ICONS: Record<string, typeof DollarSign> = {
  collectionsRate: DollarSign,
  avgDaysInAR: Clock,
  cleanClaimRate: FileCheck,
  denialRate: AlertTriangle,
  firstPassPaymentRate: Zap,
  revenuePerVisit: DollarSign,
  sessionsPerProviderPerWeek: Activity,
  noShowRate: UserX,
  cancellationRate: CalendarX,
  patientRetentionRate: Users,
};

function formatValue(value: number, unit: string): string {
  if (unit === "$") return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  if (unit === "%") return `${value}%`;
  if (unit === "days") return `${value} days`;
  return `${value}`;
}

/** Determine status: green (at/above), yellow (close), red (below). */
function getStatus(
  value: number,
  benchmark: IndustryBenchmark,
): "green" | "yellow" | "red" {
  const { min, max, target, lowerIsBetter } = benchmark;
  if (lowerIsBetter) {
    if (value <= target) return "green";
    if (value <= max) return "yellow";
    return "red";
  }
  if (value >= target) return "green";
  if (value >= min) return "yellow";
  return "red";
}

const STATUS_COLORS = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  yellow: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const STATUS_DOT = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

const STATUS_LABEL: Record<string, string> = {
  green: "On Target",
  yellow: "Near Target",
  red: "Below Target",
};

// ---------------------------------------------------------------------------
// Sparkline component (pure SVG, no extra deps)
// ---------------------------------------------------------------------------

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const h = 28;
  const w = 80;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} className="inline-block" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Trend arrow
// ---------------------------------------------------------------------------

function TrendArrow({ current, previous, lowerIsBetter }: { current: number; previous: number; lowerIsBetter: boolean }) {
  if (previous === 0 && current === 0) return <Minus className="w-4 h-4 text-muted-foreground" />;
  const diff = current - previous;
  const improving = lowerIsBetter ? diff < 0 : diff > 0;
  const worsening = lowerIsBetter ? diff > 0 : diff < 0;

  if (Math.abs(diff) < 0.1) return <Minus className="w-4 h-4 text-muted-foreground" />;
  if (improving) return <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
  if (worsening) return <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Benchmarking() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [period, setPeriod] = useState("3m");

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
      setTimeout(() => { window.location.href = "/api/login"; }, 500);
    }
  }, [isAuthenticated, authLoading, toast]);

  // Fetch industry benchmarks
  const { data: benchmarks } = useQuery<IndustryBenchmark[]>({
    queryKey: ["/api/benchmarking/industry"],
    enabled: isAuthenticated,
  });

  // Fetch practice KPIs for selected period
  const { data: metrics, isLoading: metricsLoading } = useQuery<KPIValues>({
    queryKey: [`/api/benchmarking/metrics?period=${period}`],
    enabled: isAuthenticated,
  });

  // Fetch trend data (always 6 months for sparklines)
  const { data: trends } = useQuery<TrendMonth[]>({
    queryKey: ["/api/benchmarking/trends?months=6"],
    enabled: isAuthenticated,
  });

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Summary stats
  const totalMetrics = benchmarks?.length ?? 0;
  const onTarget = benchmarks?.filter((b) => {
    const val = metrics?.[b.key];
    if (val === undefined) return false;
    return getStatus(val, b) === "green";
  }).length ?? 0;

  // Group benchmarks
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    items: (benchmarks || []).filter((b) => b.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="md:ml-64 p-4 md:p-8 mt-14 md:mt-0 mb-20 md:mb-0 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Practice Benchmarking</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compare your practice KPIs against industry benchmarks (MGMA / AOTA / CMS)
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary banner */}
      {metrics && benchmarks && (
        <Card className="mb-6">
          <CardContent className="py-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${onTarget >= totalMetrics / 2 ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-amber-100 dark:bg-amber-900/40"}`}>
              <Activity className={`w-5 h-5 ${onTarget >= totalMetrics / 2 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                You are meeting or exceeding benchmarks in{" "}
                <span className="font-bold">{onTarget}</span> of{" "}
                <span className="font-bold">{totalMetrics}</span> metrics
              </p>
              <p className="text-xs text-muted-foreground">
                {onTarget === totalMetrics
                  ? "Excellent! All metrics are on target."
                  : onTarget >= totalMetrics / 2
                    ? "Good performance overall. Review yellow/red metrics for improvement opportunities."
                    : "Several metrics need attention. Review the details below for improvement areas."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {metricsLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {/* Grouped KPI cards */}
      {!metricsLoading &&
        grouped.map(({ group, label, items }) => (
          <div key={group} className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-3">{label}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((b) => {
                const value = metrics?.[b.key] ?? 0;
                const status = getStatus(value, b);
                const Icon = METRIC_ICONS[b.key] || Activity;
                const trendData = (trends || []).map((t) => Number(t[b.key]) || 0);
                const prevValue = trendData.length >= 2 ? trendData[trendData.length - 2] : value;
                const sparkColor =
                  status === "green"
                    ? "#10b981"
                    : status === "yellow"
                      ? "#f59e0b"
                      : "#ef4444";

                return (
                  <Card key={b.key} className="relative overflow-hidden">
                    <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-md flex items-center justify-center ${STATUS_COLORS[status]}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <CardTitle className="text-sm font-medium leading-tight">
                          {b.label}
                        </CardTitle>
                      </div>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[status]}`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${STATUS_DOT[status]}`} />
                        {STATUS_LABEL[status]}
                      </Badge>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {/* Value row */}
                      <div className="flex items-end justify-between mb-2">
                        <span className="text-2xl font-bold text-foreground">
                          {formatValue(value, b.unit)}
                        </span>
                        <div className="flex items-center gap-1">
                          <TrendArrow
                            current={value}
                            previous={prevValue}
                            lowerIsBetter={b.lowerIsBetter}
                          />
                          <Sparkline data={trendData} color={sparkColor} />
                        </div>
                      </div>

                      {/* Benchmark info */}
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div className="flex justify-between">
                          <span>Industry range</span>
                          <span>
                            {formatValue(b.min, b.unit)} &ndash; {formatValue(b.max, b.unit)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Target</span>
                          <span className="font-medium">{formatValue(b.target, b.unit)}</span>
                        </div>
                      </div>

                      {/* Progress bar showing position in range */}
                      <div className="mt-2">
                        <BenchmarkBar value={value} benchmark={b} status={status} />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Benchmark bar – shows where the practice value sits relative to the range
// ---------------------------------------------------------------------------

function BenchmarkBar({
  value,
  benchmark,
  status,
}: {
  value: number;
  benchmark: IndustryBenchmark;
  status: "green" | "yellow" | "red";
}) {
  const { min, max, target, lowerIsBetter } = benchmark;

  // Expand visible range slightly beyond min/max so values outside still show
  const rangeMin = Math.min(min * 0.8, value);
  const rangeMax = Math.max(max * 1.2, value);
  const range = rangeMax - rangeMin || 1;

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - rangeMin) / range) * 100));

  const barColor =
    status === "green"
      ? "bg-emerald-500"
      : status === "yellow"
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="relative h-2 w-full bg-muted rounded-full overflow-visible">
      {/* Industry range background */}
      <div
        className="absolute top-0 h-full bg-muted-foreground/10 rounded-full"
        style={{ left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }}
      />
      {/* Target marker */}
      <div
        className="absolute top-[-2px] w-0.5 h-[12px] bg-foreground/40 rounded-full"
        style={{ left: `${pct(target)}%` }}
        title={`Target: ${target}`}
      />
      {/* Practice value dot */}
      <div
        className={`absolute top-[-2px] w-3 h-3 rounded-full border-2 border-background ${barColor}`}
        style={{ left: `${pct(value)}%`, transform: "translateX(-50%)" }}
        title={`Your value: ${value}`}
      />
    </div>
  );
}

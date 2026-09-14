import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, Target } from "lucide-react";

interface ProgressPoint { date: string; value: number; severity?: string | null; reliableChange?: boolean | null; }
interface GoalSeries { goalId: number; description: string; status: string; points: ProgressPoint[]; }
interface MeasureSeries { templateId: number; name: string; shortName: string | null; clinicalCutoff: number | null; maxScore: number | null; points: ProgressPoint[]; }
interface PatientProgress { goals: GoalSeries[]; outcomeMeasures: MeasureSeries[]; }

const LINE_COLORS = ["#0E7A6E", "#2563EB", "#9333EA", "#D97706", "#DC2626", "#0891B2"];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PatientProgressCharts({ patientId }: { patientId: number }) {
  const { data, isLoading, isError } = useQuery<PatientProgress>({
    queryKey: [`/api/patients/${patientId}/progress`],
    enabled: !!patientId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading progress…
      </div>
    );
  }
  if (isError) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Couldn't load progress right now.</p>;
  }

  const goals = data?.goals ?? [];
  const measures = data?.outcomeMeasures ?? [];

  if (goals.length === 0 && measures.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        <TrendingUp className="w-6 h-6 mx-auto mb-2 opacity-50" />
        No progress data yet. Goal progress and outcome-measure scores appear here as sessions are documented.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {goals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-teal-600" /> Goal progress over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart margin={{ top: 5, right: 12, bottom: 5, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  type="category"
                  allowDuplicatedCategory={false}
                  tickFormatter={fmtDate}
                  tick={{ fontSize: 11 }}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip
                  labelFormatter={(d) => fmtDate(String(d))}
                  formatter={(v: number, name: string) => [`${v}%`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {goals.map((g, i) => (
                  <Line
                    key={g.goalId}
                    data={g.points}
                    dataKey="value"
                    name={g.description.length > 42 ? g.description.slice(0, 42) + "…" : g.description}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {measures.map((m) => (
        <Card key={m.templateId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600" /> {m.shortName || m.name} — score over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={m.points} margin={{ top: 5, right: 12, bottom: 5, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, m.maxScore ?? "auto"]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={(d) => fmtDate(String(d))} />
                {m.clinicalCutoff != null && (
                  <ReferenceLine
                    y={m.clinicalCutoff}
                    stroke="#DC2626"
                    strokeDasharray="4 4"
                    label={{ value: "Clinical cutoff", fontSize: 10, fill: "#DC2626", position: "insideTopRight" }}
                  />
                )}
                <Line dataKey="value" name={m.shortName || m.name} stroke="#2563EB" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
            {m.clinicalCutoff != null && (
              <p className="text-[11px] text-muted-foreground mt-1">
                The dashed line is the clinical cutoff for this measure — movement across it is clinically meaningful.
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

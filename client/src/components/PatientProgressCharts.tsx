import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, TrendingUp, Target, FileText, Copy } from "lucide-react";

interface ProgressPoint { date: string; value: number; severity?: string | null; reliableChange?: boolean | null; }
interface GoalSeries { goalId: number; description: string; status: string; points: ProgressPoint[]; }
interface MeasureSeries { templateId: number; name: string; shortName: string | null; clinicalCutoff: number | null; maxScore: number | null; points: ProgressPoint[]; }
interface ActivitySeries { activityName: string; points: Array<{ date: string; score: number; level: string }>; }
interface PatientProgress { goals: GoalSeries[]; outcomeMeasures: MeasureSeries[]; activities?: ActivitySeries[]; }

const ASSIST_TICKS = ["", "Dependent", "Max", "Mod", "Min", "Tactile", "Gestural", "Verbal", "Indep."];

const LINE_COLORS = ["#0E7A6E", "#2563EB", "#9333EA", "#D97706", "#DC2626", "#0891B2"];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PatientProgressCharts({ patientId }: { patientId: number }) {
  const { data, isLoading, isError } = useQuery<PatientProgress>({
    queryKey: [`/api/patients/${patientId}/progress`],
    enabled: !!patientId,
  });

  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [reportOpen, setReportOpen] = useState(false);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<{ subjective: string; objective: string; assessment: string; plan: string } | null>(null);

  const generateReport = async () => {
    setDrafting(true);
    try {
      const res = await apiRequest("POST", "/api/ai/progress-report", { patientId, from, to });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not draft the report.");
      setDraft(body.report);
    } catch (e: any) {
      toast({ title: "Couldn't draft the report", description: e.message, variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };

  const copyDraft = async () => {
    if (!draft) return;
    const text = `PROGRESS SUMMARY (${from} to ${to})\n\nSUBJECTIVE:\n${draft.subjective}\n\nOBJECTIVE:\n${draft.objective}\n\nASSESSMENT:\n${draft.assessment}\n\nPLAN:\n${draft.plan}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Progress summary copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Select and copy manually.", variant: "destructive" });
    }
  };

  const reportDialog = (
    <Dialog open={reportOpen} onOpenChange={setReportOpen}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="progress-report-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-teal-600" /> Draft progress summary
          </DialogTitle>
          <DialogDescription>
            The AI reviews this patient's signed notes and goal progress in the range and drafts a summary. Review and edit before using; it never invents beyond the documented sessions.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2 flex-wrap">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8" /></div>
          <Button size="sm" onClick={generateReport} disabled={drafting} data-testid="button-generate-progress-report">
            {drafting ? (<><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Drafting…</>) : "Generate draft"}
          </Button>
          {draft && (
            <Button size="sm" variant="outline" onClick={copyDraft}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
          )}
        </div>
        {draft && (
          <div className="space-y-3 mt-2">
            {(["subjective", "objective", "assessment", "plan"] as const).map((section) => (
              <div key={section}>
                <Label className="text-xs font-semibold uppercase text-muted-foreground">{section}</Label>
                <Textarea
                  value={draft[section]}
                  onChange={(e) => setDraft((prev) => (prev ? { ...prev, [section]: e.target.value } : prev))}
                  rows={section === "assessment" ? 6 : 3}
                  className="text-sm mt-1"
                  data-testid={`textarea-report-${section}`}
                />
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

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
  const activities = data?.activities ?? [];

  if (goals.length === 0 && measures.length === 0 && activities.length === 0) {
    return (
      <>
        <div className="flex justify-end mb-2">
          <Button size="sm" variant="outline" onClick={() => setReportOpen(true)} data-testid="button-open-progress-report">
            <FileText className="w-3.5 h-3.5 mr-1" /> Draft progress summary
          </Button>
        </div>
        <div className="text-center py-10 text-muted-foreground text-sm">
          <TrendingUp className="w-6 h-6 mx-auto mb-2 opacity-50" />
          No progress data yet. Goal progress and outcome-measure scores appear here as sessions are documented.
        </div>
        {reportDialog}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setReportOpen(true)} data-testid="button-open-progress-report">
          <FileText className="w-3.5 h-3.5 mr-1" /> Draft progress summary
        </Button>
      </div>
      {reportDialog}
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

      {activities.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-teal-600" /> Per-exercise progress (level of assist)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[11px] text-muted-foreground">
              Higher is more independent — an upward line means the child needs less help with that exercise.
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart margin={{ top: 5, right: 12, bottom: 5, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  type="category"
                  allowDuplicatedCategory={false}
                  tickFormatter={fmtDate}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  domain={[1, 8]}
                  ticks={[1, 2, 3, 4, 5, 6, 7, 8]}
                  tickFormatter={(v: number) => ASSIST_TICKS[v] ?? ""}
                  tick={{ fontSize: 10 }}
                  width={54}
                />
                <Tooltip
                  labelFormatter={(d) => fmtDate(String(d))}
                  formatter={(_v: number, _n: string, item: any) => [item?.payload?.level ?? "", item?.payload?.activityName ?? ""]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {activities.map((a, i) => (
                  <Line
                    key={a.activityName}
                    data={a.points.map((p) => ({ ...p, activityName: a.activityName }))}
                    dataKey="score"
                    name={a.activityName}
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

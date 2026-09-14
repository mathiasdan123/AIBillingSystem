/**
 * Assembles a patient's progress time series for the Progress view.
 *
 * Two sources, both already captured today:
 *  - Treatment-goal progress: the 0-100% figure recorded per signed SOAP note
 *    per goal (soap_note_goal_progress) → one line per goal over time.
 *  - Standardized outcome measures: patient_assessments totalScore over time
 *    per template (PDMS-2, BOT-3, PHQ-9, …), with the clinical cutoff for
 *    reference.
 *
 * Read-only aggregation — no new clinical data is invented here.
 */
import { storage } from '../storage';

export interface ProgressPoint {
  date: string; // ISO
  value: number;
}

export interface GoalProgressSeries {
  goalId: number;
  description: string;
  status: string;
  points: ProgressPoint[];
}

export interface OutcomeMeasureSeries {
  templateId: number;
  name: string;
  shortName: string | null;
  clinicalCutoff: number | null;
  maxScore: number | null;
  points: Array<ProgressPoint & { severity?: string | null; reliableChange?: boolean | null }>;
}

export interface PatientProgress {
  goals: GoalProgressSeries[];
  outcomeMeasures: OutcomeMeasureSeries[];
}

export async function getPatientProgress(patientId: number): Promise<PatientProgress> {
  // ---- Treatment-goal progress lines ----
  const plans = await storage.getPatientTreatmentPlans(patientId);
  const goals: GoalProgressSeries[] = [];
  for (const plan of plans ?? []) {
    const planGoals = await storage.getTreatmentGoals(plan.id);
    for (const goal of planGoals ?? []) {
      const rows = await storage.getSoapNoteGoalProgressByGoalWithDetails(goal.id);
      const points: ProgressPoint[] = rows
        .map((r: any) => {
          const when = r.soapNote?.therapistSignedAt ?? r.progress?.createdAt;
          const value = r.progress?.progressPercentage;
          return when != null && value != null
            ? { date: new Date(when).toISOString(), value: Number(value) }
            : null;
        })
        .filter((p: ProgressPoint | null): p is ProgressPoint => p !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
      // A line needs at least one datapoint to plot; a goal with zero
      // recorded progress is omitted rather than shown as an empty axis.
      if (points.length > 0) {
        goals.push({ goalId: goal.id, description: goal.description, status: goal.status ?? 'active', points });
      }
    }
  }

  // ---- Standardized outcome-measure lines ----
  const assessments = await storage.getPatientAssessments(patientId);
  const byTemplate = new Map<number, any[]>();
  for (const a of assessments ?? []) {
    if (a.totalScore == null) continue;
    const list = byTemplate.get(a.templateId) ?? [];
    list.push(a);
    byTemplate.set(a.templateId, list);
  }
  const outcomeMeasures: OutcomeMeasureSeries[] = [];
  for (const [templateId, list] of Array.from(byTemplate.entries())) {
    let template: any = null;
    try {
      template = await storage.getOutcomeMeasureTemplate(templateId);
    } catch {
      // template lookup is best-effort; the series still plots without its name
    }
    const points = list
      .map((a: any) => ({
        date: new Date(a.administeredAt ?? a.createdAt).toISOString(),
        value: Number(a.totalScore),
        severity: a.severity ?? null,
        reliableChange: a.isReliableChange ?? null,
      }))
      .sort((x: ProgressPoint, y: ProgressPoint) => x.date.localeCompare(y.date));
    outcomeMeasures.push({
      templateId,
      name: template?.name ?? `Measure ${templateId}`,
      shortName: template?.shortName ?? null,
      clinicalCutoff: template?.clinicalCutoff ?? null,
      maxScore: template?.maxScore ?? null,
      points,
    });
  }

  return { goals, outcomeMeasures };
}

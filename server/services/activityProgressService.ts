/**
 * Per-exercise progress: persist the optional per-activity "level of assist"
 * on note save, and read it back per patient as a time series.
 *
 * Opt-in by design (clinician + product decision): a log row is written ONLY
 * for activities where the therapist filled the Level of Assist. Filling it is
 * what produces the graph; skipping it costs nothing but the chart.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { activityProgressLog } from '@shared/schema';

/** Assist ladder → ordinal. Higher = more independent, so an upward line reads
 * as improvement. Unknown/blank values return null and are not logged. */
const ASSIST_SCORE: Record<string, number> = {
  dependent: 1,
  'maximal assist': 2,
  'max assist': 2,
  'moderate assist': 3,
  'mod assist': 3,
  'minimal assist': 4,
  'min assist': 4,
  'verbal cues only': 5,
  'verbal cues': 5,
  supervision: 5,
  independent: 6,
  'modified independent': 6,
};

export function assistScore(level: string | undefined | null): number | null {
  if (!level) return null;
  return ASSIST_SCORE[level.trim().toLowerCase()] ?? null;
}

export interface ActivityAssistInput {
  name: string;
  assistLevel?: string;
}

/**
 * Write one progress-log row per activity that carries a recognized assist
 * level. No-ops for activities without one — that is the opt-in gate.
 */
export async function logActivityProgress(params: {
  practiceId: number;
  patientId: number;
  soapNoteId: number;
  sessionDate?: string;
  activities: ActivityAssistInput[];
}): Promise<number> {
  const rows = params.activities
    .map((a) => {
      const score = assistScore(a.assistLevel);
      if (score == null || !a.name?.trim()) return null;
      return {
        practiceId: params.practiceId,
        patientId: params.patientId,
        soapNoteId: params.soapNoteId,
        activityName: a.name.trim(),
        assistLevel: a.assistLevel!.trim(),
        assistScore: score,
        sessionDate: params.sessionDate ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return 0;
  await db.insert(activityProgressLog).values(rows);
  return rows.length;
}

export interface ActivityProgressSeries {
  activityName: string;
  points: Array<{ date: string; score: number; level: string }>;
}

/** Per-activity assist time series for a patient (activities with >= 2 points
 * plot a trend; a single point still shows). */
export async function getActivityProgress(patientId: number): Promise<ActivityProgressSeries[]> {
  const rows = await db
    .select()
    .from(activityProgressLog)
    .where(eq(activityProgressLog.patientId, patientId))
    .orderBy(asc(activityProgressLog.createdAt));

  const byActivity = new Map<string, ActivityProgressSeries>();
  for (const r of rows) {
    const series: ActivityProgressSeries =
      byActivity.get(r.activityName) ?? { activityName: r.activityName, points: [] };
    series.points.push({
      date: new Date(r.sessionDate ?? r.createdAt!).toISOString(),
      score: r.assistScore,
      level: r.assistLevel,
    });
    byActivity.set(r.activityName, series);
  }
  return Array.from(byActivity.values()).sort((a, b) => a.activityName.localeCompare(b.activityName));
}

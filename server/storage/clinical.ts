import {
  soapNotes,
  treatmentSessions,
  treatmentPlans,
  treatmentGoals,
  treatmentObjectives,
  treatmentInterventions,
  goalProgressNotes,
  soapNoteGoalProgress,
  outcomeMeasureTemplates,
  patientAssessments,
  assessmentSchedules,
  referralSources,
  referrals,
  referralCommunications,
  therapyBank,
  exerciseBank,
  users,
  type SoapNote,
  type InsertSoapNote,
  type TreatmentPlan,
  type InsertTreatmentPlan,
  type TreatmentGoal,
  type InsertTreatmentGoal,
  type TreatmentObjective,
  type InsertTreatmentObjective,
  type TreatmentIntervention,
  type InsertTreatmentIntervention,
  type GoalProgressNote,
  type InsertGoalProgressNote,
  type SoapNoteGoalProgress,
  type InsertSoapNoteGoalProgress,
  type OutcomeMeasureTemplate,
  type InsertOutcomeMeasureTemplate,
  type PatientAssessment,
  type InsertPatientAssessment,
  type AssessmentSchedule,
  type InsertAssessmentSchedule,
  type ReferralSource,
  type InsertReferralSource,
  type Referral,
  type InsertReferral,
  type ReferralCommunication,
  type InsertReferralCommunication,
  type TherapyBank,
  type InsertTherapyBank,
  type ExerciseBank,
  type InsertExerciseBank,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lte, isNull, inArray, sql, or } from "drizzle-orm";
import {
  encryptSoapNoteRecord,
  decryptSoapNoteRecord,
} from "../services/phiEncryptionService";
import { getUser } from "./users";

// ==================== SOAP NOTES ====================

export async function createSoapNote(soapNote: InsertSoapNote): Promise<SoapNote> {
  let cosignStatus = 'not_required';
  if (soapNote.therapistId) {
    const therapist = await getUser(soapNote.therapistId);
    if (therapist?.requiresCosign) {
      cosignStatus = 'pending';
    }
  }

  const noteWithCosignStatus = { ...soapNote, cosignStatus };
  const encrypted = encryptSoapNoteRecord(noteWithCosignStatus as any);
  const [created] = await db.insert(soapNotes).values(encrypted as any).returning();
  return decryptSoapNoteRecord(created) as SoapNote;
}

export async function getSoapNotes(practiceId?: number): Promise<SoapNote[]> {
  if (practiceId) {
    const results = await db
      .select({
        id: soapNotes.id,
        sessionId: soapNotes.sessionId,
        subjective: soapNotes.subjective,
        objective: soapNotes.objective,
        assessment: soapNotes.assessment,
        plan: soapNotes.plan,
        location: soapNotes.location,
        sessionType: soapNotes.sessionType,
        interventions: soapNotes.interventions,
        progressNotes: soapNotes.progressNotes,
        homeProgram: soapNotes.homeProgram,
        aiSuggestedCptCodes: soapNotes.aiSuggestedCptCodes,
        originalCptCode: soapNotes.originalCptCode,
        optimizedCptCode: soapNotes.optimizedCptCode,
        cptOptimizationReason: soapNotes.cptOptimizationReason,
        dataSource: soapNotes.dataSource,
        createdAt: soapNotes.createdAt,
        updatedAt: soapNotes.updatedAt,
      })
      .from(soapNotes)
      .innerJoin(treatmentSessions, eq(soapNotes.sessionId, treatmentSessions.id))
      .where(eq(treatmentSessions.practiceId, practiceId))
      .orderBy(desc(soapNotes.createdAt));
    return results.map((r: any) => decryptSoapNoteRecord(r) as SoapNote);
  }
  const rows = await db.select().from(soapNotes).orderBy(desc(soapNotes.createdAt));
  return rows.map((r: any) => decryptSoapNoteRecord(r) as SoapNote);
}

export async function getSoapNote(id: number): Promise<SoapNote | undefined> {
  const [soapNote] = await db.select().from(soapNotes).where(eq(soapNotes.id, id));
  return soapNote ? decryptSoapNoteRecord(soapNote) as SoapNote : undefined;
}

export async function getSoapNoteBySession(sessionId: number): Promise<SoapNote | undefined> {
  const [soapNote] = await db.select().from(soapNotes).where(eq(soapNotes.sessionId, sessionId));
  return soapNote ? decryptSoapNoteRecord(soapNote) as SoapNote : undefined;
}

export async function signSoapNote(id: number, signatureData: {
  therapistId: string;
  therapistSignature: string;
  therapistSignedAt: Date;
  therapistSignedName: string;
  therapistCredentials: string;
  signatureIpAddress: string;
}): Promise<SoapNote | undefined> {
  const [updated] = await db
    .update(soapNotes)
    .set({
      therapistId: signatureData.therapistId,
      therapistSignature: signatureData.therapistSignature,
      therapistSignedAt: signatureData.therapistSignedAt,
      therapistSignedName: signatureData.therapistSignedName,
      therapistCredentials: signatureData.therapistCredentials,
      signatureIpAddress: signatureData.signatureIpAddress,
      updatedAt: new Date()
    })
    .where(eq(soapNotes.id, id))
    .returning();
  return updated ? decryptSoapNoteRecord(updated) as SoapNote : undefined;
}

export async function updateSoapNoteCosignStatus(id: number, data: {
  cosignedBy?: string;
  cosignedAt?: Date;
  cosignStatus: string;
  cosignRejectionReason?: string;
}): Promise<SoapNote | undefined> {
  const [updated] = await db
    .update(soapNotes)
    .set({
      cosignedBy: data.cosignedBy,
      cosignedAt: data.cosignedAt,
      cosignStatus: data.cosignStatus,
      cosignRejectionReason: data.cosignRejectionReason,
      updatedAt: new Date()
    })
    .where(eq(soapNotes.id, id))
    .returning();
  return updated ? decryptSoapNoteRecord(updated) as SoapNote : undefined;
}

export async function getPendingCosignNotes(supervisorId: string): Promise<SoapNote[]> {
  const superviseeIds = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.supervisorId, supervisorId));

  if (superviseeIds.length === 0) return [];

  const ids = superviseeIds.map((s: { id: string }) => s.id);
  const rows = await db
    .select()
    .from(soapNotes)
    .where(
      and(
        eq(soapNotes.cosignStatus, 'pending'),
        inArray(soapNotes.therapistId, ids)
      )
    )
    .orderBy(desc(soapNotes.createdAt));

  return rows.map((r: any) => decryptSoapNoteRecord(r) as SoapNote);
}

export async function getAllSoapNotes(): Promise<SoapNote[]> {
  const rows = await db.select().from(soapNotes).orderBy(desc(soapNotes.createdAt));
  return rows.map((r: any) => decryptSoapNoteRecord(r) as SoapNote);
}

// ==================== TREATMENT PLANS ====================

export async function createTreatmentPlan(plan: InsertTreatmentPlan): Promise<TreatmentPlan> {
  const [created] = await db.insert(treatmentPlans).values(plan).returning();
  return created;
}

export async function getTreatmentPlans(practiceId: number, filters?: {
  patientId?: number;
  status?: string;
  therapistId?: string;
}): Promise<TreatmentPlan[]> {
  const conditions: any[] = [eq(treatmentPlans.practiceId, practiceId)];
  if (filters?.patientId) conditions.push(eq(treatmentPlans.patientId, filters.patientId));
  if (filters?.status) conditions.push(eq(treatmentPlans.status, filters.status));
  if (filters?.therapistId) conditions.push(eq(treatmentPlans.therapistId, filters.therapistId));

  return await db
    .select()
    .from(treatmentPlans)
    .where(and(...conditions))
    .orderBy(desc(treatmentPlans.createdAt));
}

export async function getTreatmentPlan(id: number): Promise<TreatmentPlan | undefined> {
  const [plan] = await db.select().from(treatmentPlans).where(eq(treatmentPlans.id, id));
  return plan;
}

export async function updateTreatmentPlan(id: number, updates: Partial<InsertTreatmentPlan>): Promise<TreatmentPlan | undefined> {
  const [updated] = await db
    .update(treatmentPlans)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(treatmentPlans.id, id))
    .returning();
  return updated;
}

export async function getTreatmentPlanWithDetails(id: number): Promise<{
  plan: TreatmentPlan;
  goals: TreatmentGoal[];
  objectives: TreatmentObjective[];
  interventions: TreatmentIntervention[];
} | null> {
  const plan = await getTreatmentPlan(id);
  if (!plan) return null;

  const goals = await getTreatmentGoals(id);
  const interventions = await getTreatmentInterventions(id);

  const allObjectives: TreatmentObjective[] = [];
  for (const goal of goals) {
    const objs = await getTreatmentObjectives(goal.id);
    allObjectives.push(...objs);
  }

  return { plan, goals, objectives: allObjectives, interventions };
}

export async function getPatientTreatmentPlans(patientId: number): Promise<TreatmentPlan[]> {
  return await db
    .select()
    .from(treatmentPlans)
    .where(eq(treatmentPlans.patientId, patientId))
    .orderBy(desc(treatmentPlans.createdAt));
}

export async function getActiveTreatmentPlan(patientId: number): Promise<TreatmentPlan | undefined> {
  const plans = await db
    .select()
    .from(treatmentPlans)
    .where(and(
      eq(treatmentPlans.patientId, patientId),
      or(
        eq(treatmentPlans.status, 'active'),
        eq(treatmentPlans.status, 'in_progress')
      )
    ))
    .orderBy(desc(treatmentPlans.createdAt))
    .limit(1);
  return plans[0];
}

// ==================== TREATMENT GOALS ====================

export async function createTreatmentGoal(goal: InsertTreatmentGoal): Promise<TreatmentGoal> {
  const [created] = await db.insert(treatmentGoals).values(goal).returning();
  return created;
}

export async function getTreatmentGoals(treatmentPlanId: number): Promise<TreatmentGoal[]> {
  return await db
    .select()
    .from(treatmentGoals)
    .where(eq(treatmentGoals.treatmentPlanId, treatmentPlanId))
    .orderBy(treatmentGoals.goalNumber);
}

export async function getTreatmentGoal(id: number): Promise<TreatmentGoal | undefined> {
  const [goal] = await db.select().from(treatmentGoals).where(eq(treatmentGoals.id, id));
  return goal;
}

export async function updateTreatmentGoal(id: number, updates: Partial<InsertTreatmentGoal> & {
  progressPercentage?: number;
  lastUpdated?: Date;
}): Promise<TreatmentGoal | undefined> {
  const [updated] = await db
    .update(treatmentGoals)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(treatmentGoals.id, id))
    .returning();
  return updated;
}

export async function deleteTreatmentGoal(id: number): Promise<void> {
  await db.delete(treatmentObjectives).where(eq(treatmentObjectives.goalId, id));
  await db.delete(goalProgressNotes).where(eq(goalProgressNotes.goalId, id));
  await db.delete(treatmentGoals).where(eq(treatmentGoals.id, id));
}

// ==================== TREATMENT OBJECTIVES ====================

export async function createTreatmentObjective(objective: InsertTreatmentObjective): Promise<TreatmentObjective> {
  const [created] = await db.insert(treatmentObjectives).values(objective).returning();
  return created;
}

export async function getTreatmentObjectives(goalId: number): Promise<TreatmentObjective[]> {
  return await db
    .select()
    .from(treatmentObjectives)
    .where(eq(treatmentObjectives.goalId, goalId))
    .orderBy(treatmentObjectives.objectiveNumber);
}

export async function getTreatmentObjective(id: number): Promise<TreatmentObjective | undefined> {
  const [obj] = await db.select().from(treatmentObjectives).where(eq(treatmentObjectives.id, id));
  return obj;
}

export async function updateTreatmentObjective(id: number, updates: Partial<InsertTreatmentObjective> & {
  progressPercentage?: number;
}): Promise<TreatmentObjective | undefined> {
  const [updated] = await db
    .update(treatmentObjectives)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(treatmentObjectives.id, id))
    .returning();
  return updated;
}

export async function deleteTreatmentObjective(id: number): Promise<void> {
  await db.delete(treatmentObjectives).where(eq(treatmentObjectives.id, id));
}

// ==================== TREATMENT INTERVENTIONS ====================

export async function createTreatmentIntervention(intervention: InsertTreatmentIntervention): Promise<TreatmentIntervention> {
  const [created] = await db.insert(treatmentInterventions).values(intervention).returning();
  return created;
}

export async function getTreatmentInterventions(treatmentPlanId: number): Promise<TreatmentIntervention[]> {
  return await db
    .select()
    .from(treatmentInterventions)
    .where(eq(treatmentInterventions.treatmentPlanId, treatmentPlanId))
    .orderBy(treatmentInterventions.createdAt);
}

export async function updateTreatmentIntervention(id: number, updates: Partial<InsertTreatmentIntervention>): Promise<TreatmentIntervention | undefined> {
  const [updated] = await db
    .update(treatmentInterventions)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(treatmentInterventions.id, id))
    .returning();
  return updated;
}

export async function deleteTreatmentIntervention(id: number): Promise<void> {
  await db.delete(treatmentInterventions).where(eq(treatmentInterventions.id, id));
}

// ==================== GOAL PROGRESS NOTES ====================

export async function createGoalProgressNote(note: InsertGoalProgressNote): Promise<GoalProgressNote> {
  const [created] = await db.insert(goalProgressNotes).values(note).returning();

  if (note.progressRating) {
    await db
      .update(treatmentGoals)
      .set({ progressPercentage: note.progressRating * 10, updatedAt: new Date() })
      .where(eq(treatmentGoals.id, note.goalId));
  }

  return created;
}

export async function getGoalProgressNotes(goalId: number): Promise<GoalProgressNote[]> {
  return await db
    .select()
    .from(goalProgressNotes)
    .where(eq(goalProgressNotes.goalId, goalId))
    .orderBy(desc(goalProgressNotes.createdAt));
}

export async function getSessionProgressNotes(sessionId: number): Promise<GoalProgressNote[]> {
  return await db
    .select()
    .from(goalProgressNotes)
    .where(eq(goalProgressNotes.sessionId, sessionId))
    .orderBy(desc(goalProgressNotes.createdAt));
}

// ==================== SOAP NOTE GOAL PROGRESS ====================

export async function createSoapNoteGoalProgress(entry: InsertSoapNoteGoalProgress): Promise<SoapNoteGoalProgress> {
  const [created] = await db.insert(soapNoteGoalProgress).values(entry).returning();

  if (entry.progressPercentage != null) {
    await db
      .update(treatmentGoals)
      .set({ progressPercentage: entry.progressPercentage, updatedAt: new Date() })
      .where(eq(treatmentGoals.id, entry.goalId));
  }

  return created;
}

export async function getSoapNoteGoalProgressBySoapNote(soapNoteId: number): Promise<SoapNoteGoalProgress[]> {
  return await db
    .select()
    .from(soapNoteGoalProgress)
    .where(eq(soapNoteGoalProgress.soapNoteId, soapNoteId));
}

export async function getSoapNoteGoalProgressByGoal(goalId: number): Promise<SoapNoteGoalProgress[]> {
  return await db
    .select()
    .from(soapNoteGoalProgress)
    .where(eq(soapNoteGoalProgress.goalId, goalId))
    .orderBy(desc(soapNoteGoalProgress.createdAt));
}

export async function getSoapNoteGoalProgressByGoalWithDetails(goalId: number): Promise<Array<{
  progress: SoapNoteGoalProgress;
  soapNote: SoapNote | null;
}>> {
  const progressList = await getSoapNoteGoalProgressByGoal(goalId);
  return await Promise.all(progressList.map(async (progress) => {
    const [note] = await db.select().from(soapNotes).where(eq(soapNotes.id, progress.soapNoteId));
    return {
      progress,
      soapNote: note ? decryptSoapNoteRecord(note) as SoapNote : null,
    };
  }));
}

// ==================== TREATMENT PLAN ANALYTICS ====================

export async function getTreatmentPlanStats(practiceId: number): Promise<{
  totalActive: number;
  totalCompleted: number;
  avgGoalsPerPlan: number;
  avgProgressPercentage: number;
  plansNeedingReview: number;
}> {
  const plans = await db.select().from(treatmentPlans).where(eq(treatmentPlans.practiceId, practiceId));

  const totalActive = plans.filter((p: TreatmentPlan) => p.status === 'active' || p.status === 'in_progress').length;
  const totalCompleted = plans.filter((p: TreatmentPlan) => p.status === 'completed').length;

  const allGoals = await db
    .select()
    .from(treatmentGoals)
    .where(inArray(treatmentGoals.treatmentPlanId, plans.map((p: TreatmentPlan) => p.id)));

  const avgGoalsPerPlan = plans.length > 0 ? allGoals.length / plans.length : 0;
  const avgProgressPercentage = allGoals.length > 0
    ? allGoals.reduce((sum: number, g: TreatmentGoal) => sum + (g.progressPercentage || 0), 0) / allGoals.length
    : 0;

  const reviewDate = new Date();
  reviewDate.setDate(reviewDate.getDate() + 7);
  const plansNeedingReview = plans.filter((p: TreatmentPlan) =>
    p.nextReviewDate && new Date(p.nextReviewDate) <= reviewDate
  ).length;

  return { totalActive, totalCompleted, avgGoalsPerPlan, avgProgressPercentage, plansNeedingReview };
}

export async function getPlansNeedingReview(practiceId: number, daysAhead: number = 7): Promise<TreatmentPlan[]> {
  const reviewDate = new Date();
  reviewDate.setDate(reviewDate.getDate() + daysAhead);

  return await db
    .select()
    .from(treatmentPlans)
    .where(and(
      eq(treatmentPlans.practiceId, practiceId),
      or(
        eq(treatmentPlans.status, 'active'),
        eq(treatmentPlans.status, 'in_progress')
      ),
      lte(treatmentPlans.nextReviewDate, reviewDate.toISOString().split('T')[0])
    ))
    .orderBy(treatmentPlans.nextReviewDate);
}

// ==================== OUTCOME MEASURE TEMPLATES ====================

export async function createOutcomeMeasureTemplate(template: InsertOutcomeMeasureTemplate): Promise<OutcomeMeasureTemplate> {
  const [created] = await db.insert(outcomeMeasureTemplates).values(template).returning();
  return created;
}

export async function getOutcomeMeasureTemplates(practiceId?: number): Promise<OutcomeMeasureTemplate[]> {
  if (practiceId) {
    return await db
      .select()
      .from(outcomeMeasureTemplates)
      .where(or(
        isNull(outcomeMeasureTemplates.practiceId),
        eq(outcomeMeasureTemplates.practiceId, practiceId)
      ))
      .orderBy(outcomeMeasureTemplates.name);
  }
  return await db.select().from(outcomeMeasureTemplates).orderBy(outcomeMeasureTemplates.name);
}

export async function getOutcomeMeasureTemplate(id: number): Promise<OutcomeMeasureTemplate | undefined> {
  const [template] = await db.select().from(outcomeMeasureTemplates).where(eq(outcomeMeasureTemplates.id, id));
  return template;
}

export async function updateOutcomeMeasureTemplate(id: number, updates: Partial<InsertOutcomeMeasureTemplate>): Promise<OutcomeMeasureTemplate | undefined> {
  const [updated] = await db
    .update(outcomeMeasureTemplates)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(outcomeMeasureTemplates.id, id))
    .returning();
  return updated;
}

export async function getTemplatesByCategory(category: string, practiceId?: number): Promise<OutcomeMeasureTemplate[]> {
  const conditions: any[] = [eq(outcomeMeasureTemplates.category, category)];
  if (practiceId) {
    conditions.push(or(
      isNull(outcomeMeasureTemplates.practiceId),
      eq(outcomeMeasureTemplates.practiceId, practiceId)
    ));
  }

  return await db
    .select()
    .from(outcomeMeasureTemplates)
    .where(and(...conditions))
    .orderBy(outcomeMeasureTemplates.name);
}

// ==================== PATIENT ASSESSMENTS ====================

export async function createPatientAssessment(assessment: InsertPatientAssessment): Promise<PatientAssessment> {
  const [created] = await db.insert(patientAssessments).values(assessment).returning();
  return created;
}

export async function getPatientAssessments(patientId: number, templateId?: number): Promise<PatientAssessment[]> {
  const conditions: any[] = [eq(patientAssessments.patientId, patientId)];
  if (templateId) conditions.push(eq(patientAssessments.templateId, templateId));

  return await db
    .select()
    .from(patientAssessments)
    .where(and(...conditions))
    .orderBy(desc(patientAssessments.administeredAt));
}

export async function getPatientAssessment(id: number): Promise<PatientAssessment | undefined> {
  const [assessment] = await db.select().from(patientAssessments).where(eq(patientAssessments.id, id));
  return assessment;
}

export async function getLatestPatientAssessment(patientId: number, templateId: number): Promise<PatientAssessment | undefined> {
  const [assessment] = await db
    .select()
    .from(patientAssessments)
    .where(and(
      eq(patientAssessments.patientId, patientId),
      eq(patientAssessments.templateId, templateId)
    ))
    .orderBy(desc(patientAssessments.administeredAt))
    .limit(1);
  return assessment;
}

export async function updatePatientAssessment(id: number, updates: Partial<InsertPatientAssessment>): Promise<PatientAssessment | undefined> {
  const [updated] = await db
    .update(patientAssessments)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(patientAssessments.id, id))
    .returning();
  return updated;
}

export async function getPracticeAssessments(practiceId: number, filters?: {
  templateId?: number;
  patientId?: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<PatientAssessment[]> {
  const conditions: any[] = [eq(patientAssessments.practiceId, practiceId)];
  if (filters?.templateId) conditions.push(eq(patientAssessments.templateId, filters.templateId));
  if (filters?.patientId) conditions.push(eq(patientAssessments.patientId, filters.patientId));
  if (filters?.startDate) conditions.push(gte(patientAssessments.administeredAt, filters.startDate));
  if (filters?.endDate) conditions.push(lte(patientAssessments.administeredAt, filters.endDate));

  return await db
    .select()
    .from(patientAssessments)
    .where(and(...conditions))
    .orderBy(desc(patientAssessments.administeredAt));
}

export async function getPatientAssessmentHistory(patientId: number, templateId: number): Promise<{
  assessments: PatientAssessment[];
  trend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
  latestScore: number | null;
  changeFromBaseline: number | null;
}> {
  const assessments = await getPatientAssessments(patientId, templateId);

  if (assessments.length < 2) {
    return {
      assessments,
      trend: 'insufficient_data',
      latestScore: assessments[0]?.totalScore ?? null,
      changeFromBaseline: null,
    };
  }

  const latest = assessments[0];
  const baseline = assessments[assessments.length - 1];
  const latestScore = latest.totalScore;
  const baselineScore = baseline.totalScore;

  let changeFromBaseline: number | null = null;
  if (latestScore != null && baselineScore != null) {
    changeFromBaseline = latestScore - baselineScore;
  }

  const recentScores = assessments.slice(0, Math.min(3, assessments.length)).map(a => a.totalScore ?? 0);
  let trend: 'improving' | 'stable' | 'declining' | 'insufficient_data' = 'stable';
  if (recentScores.length >= 2) {
    const avgChange = (recentScores[0] - recentScores[recentScores.length - 1]) / (recentScores.length - 1);
    if (avgChange < -2) trend = 'improving';
    else if (avgChange > 2) trend = 'declining';
    else trend = 'stable';
  }

  return { assessments, trend, latestScore: latestScore ?? null, changeFromBaseline };
}

// ==================== ASSESSMENT SCHEDULES ====================

export async function createAssessmentSchedule(schedule: InsertAssessmentSchedule): Promise<AssessmentSchedule> {
  const [created] = await db.insert(assessmentSchedules).values(schedule).returning();
  return created;
}

export async function getPatientAssessmentSchedules(patientId: number): Promise<AssessmentSchedule[]> {
  return await db
    .select()
    .from(assessmentSchedules)
    .where(eq(assessmentSchedules.patientId, patientId))
    .orderBy(assessmentSchedules.nextDueAt);
}

export async function getAssessmentSchedule(id: number): Promise<AssessmentSchedule | undefined> {
  const [schedule] = await db.select().from(assessmentSchedules).where(eq(assessmentSchedules.id, id));
  return schedule;
}

export async function updateAssessmentSchedule(id: number, updates: Partial<InsertAssessmentSchedule>): Promise<AssessmentSchedule | undefined> {
  const [updated] = await db
    .update(assessmentSchedules)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(assessmentSchedules.id, id))
    .returning();
  return updated;
}

export async function deleteAssessmentSchedule(id: number): Promise<void> {
  await db.delete(assessmentSchedules).where(eq(assessmentSchedules.id, id));
}

export async function getDueAssessments(practiceId: number): Promise<AssessmentSchedule[]> {
  const today = new Date();
  return await db
    .select()
    .from(assessmentSchedules)
    .where(and(
      eq(assessmentSchedules.practiceId, practiceId),
      eq(assessmentSchedules.isActive, true),
      lte(assessmentSchedules.nextDueAt, today)
    ))
    .orderBy(assessmentSchedules.nextDueAt);
}

// ==================== OUTCOME MEASURE ANALYTICS ====================

export async function getOutcomeMeasureStats(practiceId: number, templateId?: number): Promise<{
  totalAssessments: number;
  avgScore: number;
  improvementRate: number;
  bySeverity: { severity: string; count: number }[];
}> {
  const conditions: any[] = [eq(patientAssessments.practiceId, practiceId)];
  if (templateId) conditions.push(eq(patientAssessments.templateId, templateId));

  const assessments = await db
    .select()
    .from(patientAssessments)
    .where(and(...conditions));

  const totalAssessments = assessments.length;
  const avgScore = totalAssessments > 0
    ? assessments.reduce((sum: number, a: PatientAssessment) => sum + (a.totalScore || 0), 0) / totalAssessments
    : 0;

  const assessmentsWithChange = assessments.filter((a: PatientAssessment) => a.scoreChange !== null);
  const improved = assessmentsWithChange.filter((a: PatientAssessment) => (a.scoreChange || 0) < 0).length;
  const improvementRate = assessmentsWithChange.length > 0 ? (improved / assessmentsWithChange.length) * 100 : 0;

  const severityCounts: Record<string, number> = {};
  for (const a of assessments) {
    const sev = a.severity || 'unknown';
    severityCounts[sev] = (severityCounts[sev] || 0) + 1;
  }
  const bySeverity = Object.entries(severityCounts).map(([severity, count]) => ({ severity, count }));

  return { totalAssessments, avgScore, improvementRate, bySeverity };
}

// ==================== REFERRAL SOURCES ====================

export async function createReferralSource(source: InsertReferralSource): Promise<ReferralSource> {
  const [created] = await db.insert(referralSources).values(source).returning();
  return created;
}

export async function getReferralSources(practiceId: number, filters?: {
  type?: string;
  isActive?: boolean;
}): Promise<ReferralSource[]> {
  const conditions: any[] = [eq(referralSources.practiceId, practiceId)];
  if (filters?.type) conditions.push(eq(referralSources.type, filters.type));
  if (filters?.isActive !== undefined) conditions.push(eq(referralSources.isActive, filters.isActive));

  return await db
    .select()
    .from(referralSources)
    .where(and(...conditions))
    .orderBy(referralSources.name);
}

export async function getReferralSource(id: number): Promise<ReferralSource | undefined> {
  const [source] = await db.select().from(referralSources).where(eq(referralSources.id, id));
  return source;
}

export async function updateReferralSource(id: number, updates: Partial<InsertReferralSource>): Promise<ReferralSource | undefined> {
  const [updated] = await db
    .update(referralSources)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(referralSources.id, id))
    .returning();
  return updated;
}

export async function deleteReferralSource(id: number): Promise<void> {
  await db.delete(referralSources).where(eq(referralSources.id, id));
}

// ==================== REFERRALS ====================

export async function createReferral(referral: InsertReferral): Promise<Referral> {
  const [created] = await db.insert(referrals).values(referral).returning();
  return created;
}

export async function getReferrals(practiceId: number, filters?: {
  patientId?: number;
  status?: string;
  referralSourceId?: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<Referral[]> {
  const conditions: any[] = [eq(referrals.practiceId, practiceId)];
  if (filters?.patientId) conditions.push(eq(referrals.patientId, filters.patientId));
  if (filters?.status) conditions.push(eq(referrals.status, filters.status));
  if (filters?.referralSourceId) conditions.push(eq(referrals.referralSourceId, filters.referralSourceId));
  if (filters?.startDate) conditions.push(gte(referrals.referralDate, filters.startDate.toISOString().split('T')[0]));
  if (filters?.endDate) conditions.push(lte(referrals.referralDate, filters.endDate.toISOString().split('T')[0]));

  return await db
    .select()
    .from(referrals)
    .where(and(...conditions))
    .orderBy(desc(referrals.createdAt));
}

export async function getReferral(id: number): Promise<Referral | undefined> {
  const [referral] = await db.select().from(referrals).where(eq(referrals.id, id));
  return referral;
}

export async function updateReferral(id: number, updates: Partial<InsertReferral> & {
  completedAt?: Date;
  scheduledAt?: Date;
}): Promise<Referral | undefined> {
  const [updated] = await db
    .update(referrals)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(referrals.id, id))
    .returning();
  return updated;
}

export async function updateReferralStatus(id: number, status: string, userId: string): Promise<Referral | undefined> {
  const updates: any = { status, updatedAt: new Date() };
  if (status === 'completed') updates.completedAt = new Date();
  if (status === 'scheduled') updates.scheduledAt = new Date();

  const [updated] = await db
    .update(referrals)
    .set(updates)
    .where(eq(referrals.id, id))
    .returning();
  return updated;
}

export async function getPatientReferrals(patientId: number): Promise<Referral[]> {
  return await db
    .select()
    .from(referrals)
    .where(eq(referrals.patientId, patientId))
    .orderBy(desc(referrals.createdAt));
}

export async function getPendingReferrals(practiceId: number): Promise<Referral[]> {
  return await db
    .select()
    .from(referrals)
    .where(and(
      eq(referrals.practiceId, practiceId),
      or(
        eq(referrals.status, 'pending'),
        eq(referrals.status, 'sent')
      )
    ))
    .orderBy(referrals.referralDate);
}

export async function getReferralsNeedingFollowUp(practiceId: number): Promise<Referral[]> {
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  return await db
    .select()
    .from(referrals)
    .where(and(
      eq(referrals.practiceId, practiceId),
      or(
        eq(referrals.status, 'sent'),
        eq(referrals.status, 'pending')
      ),
      lte(referrals.referralDate, threeDaysAgo.toISOString().split('T')[0])
    ))
    .orderBy(referrals.referralDate);
}

// ==================== REFERRAL COMMUNICATIONS ====================

export async function createReferralCommunication(communication: InsertReferralCommunication): Promise<ReferralCommunication> {
  const [created] = await db.insert(referralCommunications).values(communication).returning();
  return created;
}

export async function getReferralCommunications(referralId: number): Promise<ReferralCommunication[]> {
  return await db
    .select()
    .from(referralCommunications)
    .where(eq(referralCommunications.referralId, referralId))
    .orderBy(desc(referralCommunications.createdAt));
}

// ==================== REFERRAL ANALYTICS ====================

export async function getReferralStats(practiceId: number, startDate?: Date, endDate?: Date): Promise<{
  totalIncoming: number;
  totalOutgoing: number;
  conversionRate: number;
  avgTimeToSchedule: number;
  topSources: { name: string; count: number }[];
  byStatus: { status: string; count: number }[];
}> {
  const conditions: any[] = [eq(referrals.practiceId, practiceId)];
  if (startDate) conditions.push(gte(referrals.referralDate, startDate.toISOString().split('T')[0]));
  if (endDate) conditions.push(lte(referrals.referralDate, endDate.toISOString().split('T')[0]));

  const allReferrals = await db.select().from(referrals).where(and(...conditions));

  const totalIncoming = allReferrals.filter((r: Referral) => r.direction === 'incoming').length;
  const totalOutgoing = allReferrals.filter((r: Referral) => r.direction === 'outgoing').length;

  const incomingScheduled = allReferrals.filter((r: Referral) =>
    r.direction === 'incoming' &&
    (r.status === 'scheduled' || r.status === 'completed')
  ).length;
  const conversionRate = totalIncoming > 0 ? (incomingScheduled / totalIncoming) * 100 : 0;

  const avgTimeToSchedule = 0;

  const sourceCounts: Record<string, number> = {};
  for (const r of allReferrals) {
    if (r.referralSourceId) {
      const key = `source_${r.referralSourceId}`;
      sourceCounts[key] = (sourceCounts[key] || 0) + 1;
    }
  }
  const topSources = Object.entries(sourceCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const statusCounts: Record<string, number> = {};
  for (const r of allReferrals) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  }
  const byStatus = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));

  return { totalIncoming, totalOutgoing, conversionRate, avgTimeToSchedule, topSources, byStatus };
}

export async function getReferralWithDetails(id: number): Promise<{
  referral: Referral;
  source: ReferralSource | null;
  communications: ReferralCommunication[];
} | null> {
  const referral = await getReferral(id);
  if (!referral) return null;

  let source: ReferralSource | null = null;
  if (referral.referralSourceId) {
    source = (await getReferralSource(referral.referralSourceId)) ?? null;
  }

  const communications = await getReferralCommunications(id);
  return { referral, source, communications };
}

// ==================== THERAPY BANK ====================

export async function getTherapyBank(practiceId: number): Promise<TherapyBank[]> {
  return await db
    .select()
    .from(therapyBank)
    .where(eq(therapyBank.practiceId, practiceId))
    .orderBy(desc(therapyBank.createdAt));
}

export async function createTherapyBankEntry(entry: InsertTherapyBank): Promise<TherapyBank> {
  const [newEntry] = await db
    .insert(therapyBank)
    .values(entry)
    .returning();
  return newEntry;
}

export async function deleteTherapyBankEntry(id: number): Promise<void> {
  await db.delete(therapyBank).where(eq(therapyBank.id, id));
}

// ==================== EXERCISE BANK ====================

export async function getExerciseBank(practiceId: number, category?: string): Promise<ExerciseBank[]> {
  let query = db
    .select()
    .from(exerciseBank)
    .where(eq(exerciseBank.practiceId, practiceId));

  if (category) {
    query = query.where(and(
      eq(exerciseBank.practiceId, practiceId),
      eq(exerciseBank.category, category)
    )) as any;
  }

  return await query.orderBy(exerciseBank.category, exerciseBank.exerciseName);
}

export async function createExerciseBankEntry(entry: InsertExerciseBank): Promise<ExerciseBank> {
  const [newEntry] = await db
    .insert(exerciseBank)
    .values(entry)
    .returning();
  return newEntry;
}

export async function deleteExerciseBankEntry(id: number): Promise<void> {
  await db.delete(exerciseBank).where(eq(exerciseBank.id, id));
}

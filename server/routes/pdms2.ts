/**
 * PDMS-2 structured scoring routes (outcome-measures feature).
 *
 * Handles:
 * - GET    /api/pdms2-assessments?patientId= - list a patient's structured PDMS-2 assessments
 * - GET    /api/pdms2-assessments/:id        - fetch one assessment
 * - POST   /api/pdms2-assessments            - create (scoring state computed server-side)
 * - PATCH  /api/pdms2-assessments/:id        - update scores/manual entries/notes/narrative (recomputes)
 * - POST   /api/pdms2-assessments/:id/narrative - AI-draft the narrative (returned, not saved;
 *          the therapist edits and saves via PATCH — AI assists, therapist decides)
 *
 * Scoring state (basal/ceiling/raw/domain sums) is ALWAYS recomputed on the
 * server from the entered item scores — the client's live indicators are a
 * preview, never the source of truth.
 */

import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { isAuthenticated } from "../replitAuth";
import { pdms2SubtestsSchema } from "@shared/pdms2";
import { computeAssessmentState } from "../services/pdms2ScoringService";
import logger from "../services/logger";

const router = Router();

// Same authorization helper pattern as the clinical router.
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin' && req.isPlatformAdmin) return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) return userPracticeId;
  return requestedPracticeId || userPracticeId;
};

const quotientSchema = z.number().int().min(1).max(200).nullable().optional();

const createSchema = z.object({
  patientId: z.number().int().positive(),
  ageInMonths: z.number().int().min(0).max(120),
  assessmentDate: z.string().optional(),
  subtests: pdms2SubtestsSchema.default({}),
  grossMotorQuotient: quotientSchema,
  fineMotorQuotient: quotientSchema,
  totalMotorQuotient: quotientSchema,
  tasksWentWell: z.string().max(5000).nullable().optional(),
  tasksChallenging: z.string().max(5000).nullable().optional(),
  narrative: z.string().max(20000).nullable().optional(),
  status: z.enum(["in_progress", "completed"]).optional(),
});

const updateSchema = createSchema.partial().omit({ patientId: true });

async function loadAuthorizedAssessment(req: any, res: any) {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ message: "Invalid assessment id" });
    return null;
  }
  const practiceId = getAuthorizedPracticeId(req);
  const assessment = await storage.getPdms2Assessment(id);
  if (!assessment || assessment.practiceId !== practiceId) {
    res.status(404).json({ message: "Assessment not found" });
    return null;
  }
  return assessment;
}

router.get("/pdms2-assessments", isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const patientId = parseInt(req.query.patientId as string);
    if (!Number.isInteger(patientId)) {
      return res.status(400).json({ message: "patientId is required" });
    }
    const assessments = await storage.getPdms2AssessmentsForPatient(patientId, practiceId);
    res.json(assessments);
  } catch (error) {
    logger.error("Error fetching PDMS-2 assessments", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch PDMS-2 assessments" });
  }
});

router.get("/pdms2-assessments/:id", isAuthenticated, async (req: any, res) => {
  try {
    const assessment = await loadAuthorizedAssessment(req, res);
    if (!assessment) return;
    res.json(assessment);
  } catch (error) {
    logger.error("Error fetching PDMS-2 assessment", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch PDMS-2 assessment" });
  }
});

router.post("/pdms2-assessments", isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid PDMS-2 assessment data", errors: parsed.error.flatten() });
    }
    const data = parsed.data;

    // Tenant guard: never attach an assessment to another practice's patient.
    const patient = await storage.getPatient(data.patientId);
    if (!patient || patient.practiceId !== practiceId) {
      return res.status(404).json({ message: "Patient not found" });
    }

    const computed = computeAssessmentState({
      ageInMonths: data.ageInMonths,
      subtests: data.subtests,
      grossMotorQuotient: data.grossMotorQuotient,
      fineMotorQuotient: data.fineMotorQuotient,
      totalMotorQuotient: data.totalMotorQuotient,
    });

    const assessment = await storage.createPdms2Assessment({
      patientId: data.patientId,
      practiceId,
      administeredBy: req.user?.claims?.sub ?? req.user?.id ?? null,
      assessmentDate: data.assessmentDate ? new Date(data.assessmentDate) : new Date(),
      ageInMonths: data.ageInMonths,
      subtests: data.subtests,
      computed,
      grossMotorQuotient: data.grossMotorQuotient ?? null,
      fineMotorQuotient: data.fineMotorQuotient ?? null,
      totalMotorQuotient: data.totalMotorQuotient ?? null,
      tasksWentWell: data.tasksWentWell ?? null,
      tasksChallenging: data.tasksChallenging ?? null,
      narrative: data.narrative ?? null,
      status: data.status ?? "in_progress",
    });
    res.status(201).json(assessment);
  } catch (error) {
    logger.error("Error creating PDMS-2 assessment", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to create PDMS-2 assessment" });
  }
});

router.patch("/pdms2-assessments/:id", isAuthenticated, async (req: any, res) => {
  try {
    const assessment = await loadAuthorizedAssessment(req, res);
    if (!assessment) return;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid PDMS-2 assessment data", errors: parsed.error.flatten() });
    }
    const data = parsed.data;

    const merged = {
      ageInMonths: data.ageInMonths ?? assessment.ageInMonths,
      subtests: data.subtests ?? (assessment.subtests as any),
      grossMotorQuotient: data.grossMotorQuotient !== undefined ? data.grossMotorQuotient : assessment.grossMotorQuotient,
      fineMotorQuotient: data.fineMotorQuotient !== undefined ? data.fineMotorQuotient : assessment.fineMotorQuotient,
      totalMotorQuotient: data.totalMotorQuotient !== undefined ? data.totalMotorQuotient : assessment.totalMotorQuotient,
    };
    const computed = computeAssessmentState(merged);

    const updates: Record<string, unknown> = { ...merged, computed };
    if (data.assessmentDate !== undefined) updates.assessmentDate = new Date(data.assessmentDate);
    if (data.tasksWentWell !== undefined) updates.tasksWentWell = data.tasksWentWell;
    if (data.tasksChallenging !== undefined) updates.tasksChallenging = data.tasksChallenging;
    if (data.narrative !== undefined) updates.narrative = data.narrative;
    if (data.status !== undefined) updates.status = data.status;

    const updated = await storage.updatePdms2Assessment(assessment.id, updates as any);
    res.json(updated);
  } catch (error) {
    logger.error("Error updating PDMS-2 assessment", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to update PDMS-2 assessment" });
  }
});

router.post("/pdms2-assessments/:id/narrative", isAuthenticated, async (req: any, res) => {
  try {
    const assessment = await loadAuthorizedAssessment(req, res);
    if (!assessment) return;
    const { generatePdms2Narrative } = await import("../services/pdms2NarrativeService");
    const result = await generatePdms2Narrative({
      assessmentId: assessment.id,
      practiceId: assessment.practiceId,
    });
    // Returned as a DRAFT only — the therapist edits and saves it via PATCH.
    res.json(result);
  } catch (error: any) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("unavailable") || msg.includes("not configured") || msg.includes("disabled")) {
      return res.status(503).json({ message: "Narrative generation is unavailable right now." });
    }
    if (msg.includes("No scores entered")) {
      return res.status(400).json({ message: msg });
    }
    logger.error("PDMS-2 narrative generation failed", { error: msg });
    res.status(500).json({ message: "Could not draft the narrative. Please try again." });
  }
});

export default router;

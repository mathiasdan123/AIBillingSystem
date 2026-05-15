/**
 * SOAP Note Draft Routes
 *
 * Autosave endpoint for in-progress SOAP notes. One draft per
 * (authenticated therapist, patient). Distinct from signed soap notes —
 * see `soap-notes.ts` for the canonical clinical record.
 *
 * - GET    /api/soap-drafts?patientId=N    → current draft for me + patient
 * - PUT    /api/soap-drafts                → upsert (autosave)
 * - DELETE /api/soap-drafts/:id            → discard
 */

import { Router } from "express";
import { isAuthenticated } from "../replitAuth";
import { storage } from "../storage";
import logger from "../services/logger";

const router = Router();

const requireTherapistContext = (req: any): { practiceId: number; therapistId: string } => {
  const therapistId: string | undefined = req.user?.claims?.sub || req.userId;
  const practiceId: number | undefined = req.userPracticeId;
  if (!therapistId) throw new Error("Authenticated user missing therapist id");
  if (!practiceId) throw new Error("Authenticated user not assigned to a practice");
  return { practiceId, therapistId };
};

// GET /api/soap-drafts?patientId=N
router.get("/", isAuthenticated, async (req: any, res) => {
  try {
    const { practiceId, therapistId } = requireTherapistContext(req);
    const patientId = parseInt(req.query.patientId as string, 10);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ message: "patientId query param is required" });
    }
    const draft = await storage.getSoapDraftForTherapistPatient(
      practiceId,
      therapistId,
      patientId,
    );
    if (!draft) return res.status(404).json({ message: "No draft found" });
    res.json(draft);
  } catch (error: any) {
    logger.error("Error fetching soap draft", { error: error.message });
    res.status(500).json({ message: "Failed to fetch soap draft" });
  }
});

// PUT /api/soap-drafts  — upsert
router.put("/", isAuthenticated, async (req: any, res) => {
  try {
    const { practiceId, therapistId } = requireTherapistContext(req);
    const patientId = Number(req.body?.patientId);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ message: "patientId is required in body" });
    }
    // Whitelist — never trust the client to set practice/therapist scope.
    const draft = await storage.upsertSoapDraft({
      practiceId,
      therapistId,
      patientId,
      sessionId: req.body.sessionId ?? null,
      subjective: req.body.subjective ?? null,
      objective: req.body.objective ?? null,
      assessment: req.body.assessment ?? null,
      plan: req.body.plan ?? null,
      progressNotes: req.body.progressNotes ?? null,
      homeProgram: req.body.homeProgram ?? null,
      interventions: req.body.interventions ?? null,
      location: req.body.location ?? null,
      sessionType: req.body.sessionType ?? null,
    });
    res.json(draft);
  } catch (error: any) {
    logger.error("Error upserting soap draft", { error: error.message });
    res.status(500).json({ message: "Failed to save soap draft" });
  }
});

// DELETE /api/soap-drafts/:id  — scoped to caller
router.delete("/:id", isAuthenticated, async (req: any, res) => {
  try {
    const { practiceId, therapistId } = requireTherapistContext(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid draft id" });
    }
    const deleted = await storage.deleteSoapDraft(practiceId, therapistId, id);
    if (!deleted) return res.status(404).json({ message: "Draft not found" });
    res.json({ success: true });
  } catch (error: any) {
    logger.error("Error deleting soap draft", { error: error.message });
    res.status(500).json({ message: "Failed to delete soap draft" });
  }
});

export default router;

/**
 * Progress Notes routes (Wonder Kids pilot — Megan's clinical spec).
 *
 * - GET  /api/progress-notes/patient/:patientId          - list a patient's progress notes
 * - GET  /api/progress-notes/patient/:patientId/cadence  - due-ness (10 sessions / 90 days, read-time)
 * - POST /api/progress-notes/patient/:patientId          - start a draft note (goal table snapshotted from the plan)
 * - GET  /api/progress-notes/:id                         - one note
 * - POST /api/progress-notes/:id/generate                - AI-draft the commentary/narratives (draft only)
 * - PATCH /api/progress-notes/:id                        - save therapist edits (sections, per-goal commentary, progress %)
 * - POST /api/progress-notes/:id/finalize                - lock the note; applies the plan extension if requested
 *
 * Mounted under /api/progress-notes to stay clear of the pre-existing
 * /api/patients/:id/progress-notes (per-session goal progress notes in
 * routes/clinical.ts — a different record). Listed in PHI_ROUTE_PATTERNS
 * (server/middleware/mfa-required.ts) so MFA is enforced.
 *
 * Every route resolves the caller's practice via getUserPracticeContext
 * (fails closed — no practice, no access); notes are read through
 * practice-scoped storage so cross-tenant ids 404.
 *
 * Compliance framing: the AI assists with drafting; the treating therapist
 * reviews, edits, and approves. The progress % per goal is therapist-entered
 * clinical judgment — nothing in these routes computes it.
 */

import { Router, type Response } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { getUserPracticeContext, type PracticeContext } from '../services/practiceContext';
import {
  buildGoalEntries,
  generateProgressNoteDraft,
  getProgressNoteCadence,
  type ProgressNoteGoalEntry,
} from '../services/progressNoteService';
import logger from '../services/logger';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireContext(req: any, res: Response): Promise<PracticeContext | null> {
  const context = await getUserPracticeContext(req);
  if (!context) {
    res.status(403).json({ message: 'No practice context' });
    return null;
  }
  return context;
}

async function loadNote(req: any, res: Response, context: PracticeContext) {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ message: 'Invalid progress note ID' });
    return null;
  }
  const note = await storage.getProgressNote(id, context.practiceId);
  if (!note) {
    res.status(404).json({ message: 'Progress note not found' });
    return null;
  }
  return note;
}

async function loadScopedPatient(req: any, res: Response, context: PracticeContext) {
  const patientId = parseInt(req.params.patientId);
  if (isNaN(patientId)) {
    res.status(400).json({ message: 'Invalid patient ID' });
    return null;
  }
  const patient = await storage.getPatient(patientId);
  if (!patient || patient.practiceId !== context.practiceId) {
    res.status(404).json({ message: 'Patient not found' });
    return null;
  }
  return patient;
}

// ==================== LIST / CADENCE / CREATE ====================

// GET /api/progress-notes/patient/:patientId
router.get('/progress-notes/patient/:patientId', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const patient = await loadScopedPatient(req, res, context);
    if (!patient) return;

    const notes = await storage.getProgressNotesForPatient(patient.id, context.practiceId);
    res.json(notes);
  } catch (error) {
    logger.error('Error fetching progress notes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch progress notes' });
  }
});

// GET /api/progress-notes/patient/:patientId/cadence — read-time due-ness
router.get('/progress-notes/patient/:patientId/cadence', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const patient = await loadScopedPatient(req, res, context);
    if (!patient) return;

    const cadence = await getProgressNoteCadence(patient.id, context.practiceId);
    res.json(cadence);
  } catch (error) {
    logger.error('Error computing progress note cadence', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to compute progress note cadence' });
  }
});

// POST /api/progress-notes/patient/:patientId — start a draft. The reporting
// window runs from the cadence anchor to today; the goal table is seeded
// from EVERY goal on the active treatment plan (legacy null metadata kept
// null, never invented).
router.post('/progress-notes/patient/:patientId', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const patient = await loadScopedPatient(req, res, context);
    if (!patient) return;

    const plan = await storage.getActiveTreatmentPlan(patient.id);
    if (!plan) {
      return res.status(409).json({ message: 'No active treatment plan — a progress note reviews the goals of a plan of care' });
    }
    const goals = await storage.getTreatmentGoals(plan.id);
    if (!goals || goals.length === 0) {
      return res.status(409).json({ message: 'The active treatment plan has no goals to review' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const cadence = await getProgressNoteCadence(patient.id, context.practiceId, today);
    const windowStart = cadence.anchorDate ?? today;

    const note = await storage.createProgressNote({
      practiceId: context.practiceId,
      patientId: patient.id,
      treatmentPlanId: plan.id,
      therapistId: context.userId,
      status: 'draft',
      windowStart,
      windowEnd: today,
      sessionsReviewed: cadence.completedSessionsSinceAnchor,
      goalEntries: buildGoalEntries(goals),
    });
    res.status(201).json(note);
  } catch (error) {
    logger.error('Error creating progress note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create progress note' });
  }
});

// ==================== READ / GENERATE / EDIT ====================

// GET /api/progress-notes/:id
router.get('/progress-notes/:id', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const note = await loadNote(req, res, context);
    if (!note) return;
    res.json(note);
  } catch (error) {
    logger.error('Error fetching progress note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch progress note' });
  }
});

// POST /api/progress-notes/:id/generate — AI draft of the per-goal
// commentary and narratives. Never touches progressPercent: that stays
// whatever the therapist has entered (or null).
router.post('/progress-notes/:id/generate', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const note = await loadNote(req, res, context);
    if (!note) return;
    if (note.status === 'finalized') {
      return res.status(409).json({ message: 'Progress note is finalized and can no longer be regenerated' });
    }

    const { draft, meta } = await generateProgressNoteDraft({
      noteId: note.id,
      practiceId: context.practiceId,
    });

    const entries = (note.goalEntries ?? []) as ProgressNoteGoalEntry[];
    const byGoalId = new Map(draft.goalCommentary.map((c) => [c.goalId, c]));
    const nextEntries = entries.map((e) => {
      const c = byGoalId.get(e.goalId);
      return c
        ? {
            ...e,
            interventions: c.interventions,
            assistanceLevels: c.assistanceLevels,
            currentAbility: c.currentAbility,
            // progressPercent deliberately untouched — therapist judgment only.
          }
        : e;
    });

    const updated = await storage.updateProgressNote(note.id, context.practiceId, {
      goalEntries: nextEntries,
      presentLevel: draft.presentLevel,
      annualGoals: draft.annualGoals,
      recommendations: draft.recommendations,
      sessionsReviewed: meta.sessionsReviewed,
      generatedAt: new Date(),
    });
    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('unavailable') || message.includes('not configured')) {
      return res.status(503).json({ message: 'Progress note drafting is unavailable right now.' });
    }
    logger.error('Error generating progress note draft', { error: message });
    res.status(message.includes('not found') ? 404 : 422).json({ message });
  }
});

function parseGoalEntryEdits(raw: any, existing: ProgressNoteGoalEntry[]): ProgressNoteGoalEntry[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'goalEntries must be an array' };
  const byGoalId = new Map<number, any>();
  for (const item of raw) {
    if (typeof item?.goalId !== 'number') return { error: 'Each goal entry needs its goalId' };
    byGoalId.set(item.goalId, item);
  }
  const next: ProgressNoteGoalEntry[] = [];
  for (const entry of existing) {
    const edit = byGoalId.get(entry.goalId);
    if (!edit) {
      next.push(entry);
      continue;
    }
    let progressPercent = entry.progressPercent;
    if ('progressPercent' in edit) {
      const p = edit.progressPercent;
      if (p === null) {
        progressPercent = null;
      } else if (typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 100) {
        progressPercent = p;
      } else {
        return { error: 'progressPercent must be an integer 0-100 (the therapist\'s judgment) or null' };
      }
    }
    const str = (key: keyof ProgressNoteGoalEntry) =>
      typeof edit[key] === 'string' ? edit[key] : (entry[key] as string);
    next.push({
      ...entry,
      progressPercent,
      interventions: str('interventions'),
      assistanceLevels: str('assistanceLevels'),
      currentAbility: str('currentAbility'),
    });
  }
  return next;
}

// PATCH /api/progress-notes/:id — therapist edits: narrative sections,
// per-goal commentary, therapist-entered progress %, extension decision.
router.patch('/progress-notes/:id', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const note = await loadNote(req, res, context);
    if (!note) return;
    if (note.status === 'finalized') {
      return res.status(409).json({ message: 'Progress note is finalized and can no longer be edited' });
    }

    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};

    for (const field of ['presentLevel', 'annualGoals', 'recommendations', 'extensionRationale'] as const) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'string') {
          return res.status(400).json({ message: `${field} must be text` });
        }
        updates[field] = body[field];
      }
    }
    if (body.extensionRequested !== undefined) {
      if (typeof body.extensionRequested !== 'boolean') {
        return res.status(400).json({ message: 'extensionRequested must be a boolean' });
      }
      updates.extensionRequested = body.extensionRequested;
    }
    if (body.extensionNewEndDate !== undefined) {
      if (body.extensionNewEndDate !== null && !(typeof body.extensionNewEndDate === 'string' && DATE_RE.test(body.extensionNewEndDate))) {
        return res.status(400).json({ message: 'extensionNewEndDate must be YYYY-MM-DD or null' });
      }
      updates.extensionNewEndDate = body.extensionNewEndDate;
    }
    if (body.goalEntries !== undefined) {
      const parsed = parseGoalEntryEdits(body.goalEntries, (note.goalEntries ?? []) as ProgressNoteGoalEntry[]);
      if ('error' in parsed) return res.status(400).json({ message: parsed.error });
      updates.goalEntries = parsed;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No editable fields in request' });
    }
    const updated = await storage.updateProgressNote(note.id, context.practiceId, updates);
    res.json(updated);
  } catch (error) {
    logger.error('Error updating progress note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update progress note' });
  }
});

// ==================== FINALIZE ====================

// POST /api/progress-notes/:id/finalize { updateGoalProgress?: boolean }
// Locks the note. Requires: content reviewed (narratives present), a
// therapist-entered progress % on EVERY goal, and — if the plan extension
// was selected — the therapist's written rationale (documented, not
// optional). Optionally writes the entered % back to treatment_goals.
router.post('/progress-notes/:id/finalize', isAuthenticated, async (req: any, res) => {
  try {
    const context = await requireContext(req, res);
    if (!context) return;
    const note = await loadNote(req, res, context);
    if (!note) return;
    if (note.status === 'finalized') {
      return res.status(409).json({ message: 'Progress note is already finalized' });
    }

    const entries = (note.goalEntries ?? []) as ProgressNoteGoalEntry[];
    if (entries.length === 0) {
      return res.status(409).json({ message: 'The note has no goal entries to finalize' });
    }
    if (!note.presentLevel?.trim() || !note.recommendations?.trim()) {
      return res.status(409).json({ message: 'Draft and review the note sections before finalizing' });
    }
    const missingPercent = entries.filter((e) => e.progressPercent == null);
    if (missingPercent.length > 0) {
      return res.status(400).json({
        message: 'Enter a progress % for every goal before finalizing — it is the therapist\'s clinical judgment and is never auto-computed',
      });
    }

    // Extension: selecting it REQUIRES the therapist's written rationale.
    if (note.extensionRequested) {
      if (!note.extensionRationale?.trim()) {
        return res.status(400).json({
          message: 'A written rationale is required to extend the plan — why the extension is appropriate and why continued treatment remains medically necessary',
        });
      }
      if (!note.extensionNewEndDate) {
        return res.status(400).json({ message: 'Choose the new plan end date for the extension' });
      }
    }

    let extensionAppliedAt: Date | null = null;
    if (note.extensionRequested && note.treatmentPlanId) {
      const plan = await storage.getTreatmentPlan(note.treatmentPlanId);
      if (plan) {
        await storage.updateTreatmentPlan(plan.id, {
          targetEndDate: note.extensionNewEndDate,
          notes: [
            plan.notes?.trim() || null,
            `Plan extended to ${note.extensionNewEndDate} with progress note #${note.id}. Rationale: ${note.extensionRationale!.trim()}`,
          ]
            .filter(Boolean)
            .join('\n'),
        });
        extensionAppliedAt = new Date();
      }
    }

    // Optional: write the therapist-entered % back onto the goal records so
    // the Progress tab reflects the note. Explicit opt-in per finalize.
    let goalProgressSyncedAt: Date | null = null;
    if (req.body?.updateGoalProgress === true) {
      for (const entry of entries) {
        await storage.updateTreatmentGoal(entry.goalId, {
          progressPercentage: entry.progressPercent!,
        });
      }
      goalProgressSyncedAt = new Date();
    }

    const updated = await storage.updateProgressNote(note.id, context.practiceId, {
      status: 'finalized',
      finalizedAt: new Date(),
      ...(extensionAppliedAt ? { extensionAppliedAt } : {}),
      ...(goalProgressSyncedAt ? { goalProgressSyncedAt } : {}),
    });
    res.json(updated);
  } catch (error) {
    logger.error('Error finalizing progress note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to finalize progress note' });
  }
});

export default router;

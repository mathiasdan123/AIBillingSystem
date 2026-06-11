import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateSoapNoteAndBilling } from '../../services/aiSoapBillingService';
import { storage } from '../../storage';
import { withAudit } from '../audit';
import { withMcpMutationGate } from '../confirmation';
import type { McpPracticeContext } from '../types';

export function registerSoapTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const generateSoapNote = withAudit(
    'generate_soap_note',
    'soap_note',
    true,
    withMcpMutationGate(async (input: {
      patientId: number;
      activities: string[];
      mood: string;
      caregiverReport?: string;
      duration: number;
      location: string;
      assessment: {
        performance: string;
        assistance: string;
        strength: string;
        motorPlanning: string;
        sensoryRegulation: string;
      };
      planNextSteps: string;
      ratePerUnit?: number;
      therapistName?: string;
    }) => {
      return generateSoapNoteAndBilling({
        patientId: input.patientId,
        activities: input.activities,
        mood: input.mood,
        caregiverReport: input.caregiverReport,
        duration: input.duration,
        location: input.location,
        assessment: input.assessment,
        planNextSteps: input.planNextSteps,
        ratePerUnit: input.ratePerUnit,
        therapistName: input.therapistName,
      });
    }),
  );

  server.tool(
    'generate_soap_note',
    'Generate an AI-powered SOAP note with CPT billing codes from session details. Returns subjective, objective, assessment, plan sections plus recommended CPT codes, time blocks, and billing rationale. IMPORTANT: All coding decisions must be reviewed and approved by the treating provider.',
    {
      patientId: z.number().describe('Patient ID'),
      activities: z
        .array(z.string())
        .describe('Activities performed during session'),
      mood: z.string().describe('Patient mood/presentation'),
      caregiverReport: z.string().optional().describe('Caregiver report'),
      duration: z.number().describe('Session duration in minutes'),
      location: z.string().describe('Treatment location'),
      assessment: z
        .object({
          performance: z.string().describe('Overall performance level'),
          assistance: z.string().describe('Level of assistance needed'),
          strength: z.string().describe('Strength observations'),
          motorPlanning: z.string().describe('Motor planning observations'),
          sensoryRegulation: z
            .string()
            .describe('Sensory regulation observations'),
        })
        .describe('Clinical assessment observations'),
      planNextSteps: z.string().describe('Plan for next session'),
      ratePerUnit: z
        .number()
        .optional()
        .describe('Reimbursement rate per 15-min unit'),
      therapistName: z.string().optional().describe('Therapist name'),
    },
    (input) => generateSoapNote(input, context),
  );

  // ── get_prior_session_notes ───────────────────────────────────────────
  // Pre-charting helper. Tenant guards: patient.practiceId check first to
  // prevent a "no notes found" 200 from probing out-of-practice patient
  // existence; the storage helper itself ALSO scopes via the treatment
  // session join. Section text trimmed to 600 chars to keep responses
  // small.
  const getPriorSessionNotes = withAudit(
    'get_prior_session_notes',
    'soap_note',
    true,
    async (input: { patientId: number; limit?: number }) => {
      const patient = await storage.getPatient(input.patientId);
      if (!patient) throw new Error(`Patient ${input.patientId} not found`);
      if ((patient as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: patient belongs to a different practice');
      }
      const limit = typeof input.limit === 'number' ? input.limit : 5;
      const notes = await storage.getRecentSoapNotesForPatient(
        input.patientId, context.practiceId, limit,
      );
      const trim = (s: any) =>
        typeof s === 'string' && s.length > 600 ? `${s.slice(0, 600)}…` : s;
      return {
        patient: { id: patient.id, name: `${patient.firstName} ${patient.lastName}` },
        noteCount: notes.length,
        notes: notes.map((n: any) => ({
          noteId: n.id,
          sessionId: n.sessionId,
          createdAt: n.createdAt,
          signedAt: n.therapistSignedAt,
          signedBy: n.therapistSignedName,
          subjective: trim(n.subjective),
          objective: trim(n.objective),
          assessment: trim(n.assessment),
          plan: trim(n.plan),
          interventions: n.interventions,
          location: n.location,
        })),
      };
    },
  );

  server.tool(
    'get_prior_session_notes',
    'Pre-charting: return the N most recent SOAP notes for a patient so the therapist can reference prior sessions when documenting today\'s. Default limit 5, max 20. Contains PHI.',
    {
      patientId: z.number().describe('Patient ID to fetch prior notes for'),
      limit: z.number().optional().describe('How many notes to return (default 5, max 20)'),
    },
    (input) => getPriorSessionNotes(input, context),
  );

  // ── update_soap_draft ─────────────────────────────────────────────────
  // Auto-save-style update of the therapist's in-progress draft. Mirrors
  // the in-app dispatcher case and the PUT /api/soap-drafts upsert. Keyed
  // on (therapistId, patientId). therapistId is taken from context.userId,
  // never from input — the model cannot override scope.
  const SOAP_DRAFT_FIELDS = new Set([
    'subjective', 'objective', 'assessment', 'plan',
    'interventions', 'progressNotes', 'homeProgram',
    'location', 'sessionType', 'sessionId',
  ]);

  const updateSoapDraft = withAudit(
    'update_soap_draft',
    'soap_note',
    true,
    withMcpMutationGate(async (input: {
      patientId: number;
      subjective?: string;
      objective?: string;
      assessment?: string;
      plan?: string;
      interventions?: string;
      progressNotes?: string;
      homeProgram?: string;
      location?: string;
      sessionType?: string;
      sessionId?: number;
    }) => {
      const patient = await storage.getPatient(input.patientId);
      if (!patient) throw new Error(`Patient ${input.patientId} not found`);
      if ((patient as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: patient belongs to a different practice');
      }
      const draftPayload: Record<string, any> = {
        practiceId: context.practiceId,
        therapistId: context.userId,
        patientId: input.patientId,
      };
      const updatedFields: string[] = [];
      for (const [k, v] of Object.entries(input)) {
        if (k === 'patientId') continue;
        if (!SOAP_DRAFT_FIELDS.has(k)) continue;
        draftPayload[k] = v;
        updatedFields.push(k);
      }
      if (updatedFields.length === 0) {
        throw new Error('No SOAP draft fields supplied');
      }
      const draft = await storage.upsertSoapDraft(draftPayload as any);
      return {
        draft: { id: draft.id, patientId: draft.patientId, lastSavedAt: (draft as any).lastSavedAt },
        updatedFields,
      };
    }),
  );

  server.tool(
    'update_soap_draft',
    'Save changes to the therapist\'s in-progress SOAP note draft for a patient. Drafts are one-per-(therapist, patient) and auto-save as you go. Signed SOAP notes are immutable per HIPAA — for those, an addendum is required (not yet supported). Each section field (subjective/objective/assessment/plan/interventions/etc.) is independent; only supplied fields are updated. Contains PHI.',
    {
      patientId: z.number().describe('Patient the draft belongs to'),
      subjective: z.string().optional().describe('Subjective section text'),
      objective: z.string().optional().describe('Objective section text'),
      assessment: z.string().optional().describe('Assessment section text'),
      plan: z.string().optional().describe('Plan section text'),
      interventions: z.string().optional().describe('Free-form interventions list'),
      progressNotes: z.string().optional().describe('Free-form progress notes'),
      homeProgram: z.string().optional().describe('Home program details'),
      location: z.string().optional().describe('Session location'),
      sessionType: z.string().optional().describe('Session type (individual, group)'),
      sessionId: z.number().optional().describe('Optional treatment session id'),
    },
    (input) => updateSoapDraft(input, context),
  );

  // ── sign_soap_note ────────────────────────────────────────────────────
  // Finalize a SOAP note. After signing, the note is immutable.
  // Tenant guard via the linked treatment session (soap_notes has no
  // practiceId column). Idempotent re-sign.
  const signSoapNote = withAudit(
    'sign_soap_note',
    'soap_note',
    true,
    withMcpMutationGate(async (input: { noteId: number }) => {
      if (!context.userId) {
        throw new Error('Cannot sign a SOAP note without an authenticated therapist');
      }
      const note: any = await storage.getSoapNote(input.noteId);
      if (!note) throw new Error(`SOAP note ${input.noteId} not found`);
      const session = await storage.getTreatmentSession(note.sessionId);
      if (!session || session.practiceId !== context.practiceId) {
        throw new Error('Access denied: SOAP note belongs to a different practice');
      }
      if (note.therapistSignedAt) {
        return {
          alreadySigned: true,
          noteId: input.noteId,
          signedAt: note.therapistSignedAt,
          signedBy: note.therapistSignedName,
        };
      }
      const therapist: any = await storage.getUser(context.userId);
      if (!therapist) throw new Error('Therapist account not found');
      if (!therapist.digitalSignature) {
        throw new Error('No digital signature on file. Go to Settings → Therapist Profile and upload your signature before signing notes.');
      }
      const updated: any = await storage.signSoapNote(input.noteId, {
        therapistId: context.userId,
        therapistSignature: therapist.digitalSignature,
        therapistSignedAt: new Date(),
        therapistSignedName: `${therapist.firstName ?? ''} ${therapist.lastName ?? ''}`.trim() || 'Unknown therapist',
        therapistCredentials: therapist.credentials || '',
        // Marker for the audit trail — distinguishes MCP-driven signing
        // from web-UI signing (which records the request IP).
        signatureIpAddress: 'mcp',
      });
      if (!updated) throw new Error('SOAP note disappeared during signing — please retry');
      return {
        noteId: updated.id,
        signedAt: updated.therapistSignedAt,
        signedBy: updated.therapistSignedName,
      };
    }),
  );

  server.tool(
    'sign_soap_note',
    'Apply the therapist\'s digital signature to a SOAP note, finalizing it. After signing, the note is immutable per HIPAA — further changes require an addendum. The therapist signing IS the authenticated user; you cannot sign on behalf of another therapist. Returns an error pointing to Settings → Therapist Profile if no signature is on file.',
    {
      noteId: z.number().describe('The ID of the SOAP note to sign'),
    },
    (input) => signSoapNote(input, context),
  );
}

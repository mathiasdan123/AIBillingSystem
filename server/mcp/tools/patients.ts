import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerPatientTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  // ── get_patient ───────────────────────────────────────────────────────
  const getPatient = withAudit(
    'get_patient',
    'patient',
    true,
    async (input: { patientId: number }) => {
      const patient = await storage.getPatient(input.patientId);
      if (!patient) {
        throw new Error(`Patient ${input.patientId} not found`);
      }
      if ((patient as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: patient belongs to a different practice');
      }
      return patient;
    },
  );

  server.tool(
    'get_patient',
    'Get a single patient record by ID, including demographics, insurance info, and contact details. Contains PHI.',
    { patientId: z.number().describe('Patient ID') },
    (input) => getPatient(input, context),
  );

  // ── search_patients ───────────────────────────────────────────────────
  const searchPatients = withAudit(
    'search_patients',
    'patient',
    true,
    async (input: { query?: string; limit?: number; offset?: number }) => {
      const patients = await storage.getPatients(context.practiceId);
      const limit = input.limit ?? 20;
      const offset = input.offset ?? 0;

      let results = patients;

      if (input.query) {
        const q = input.query.toLowerCase();
        results = patients.filter((p: any) => {
          const name = `${p.firstName || ''} ${p.lastName || ''}`.toLowerCase();
          const email = (p.email || '').toLowerCase();
          return name.includes(q) || email.includes(q);
        });
      }

      return {
        total: results.length,
        patients: results.slice(offset, offset + limit),
      };
    },
  );

  server.tool(
    'search_patients',
    'Search patients by name or email. Returns paginated results. Contains PHI.',
    {
      query: z.string().optional().describe('Search by name or email'),
      limit: z.number().optional().describe('Max results (default 20)'),
      offset: z.number().optional().describe('Pagination offset (default 0)'),
    },
    (input) => searchPatients(input, context),
  );

  // ── update_patient_insurance ──────────────────────────────────────────
  // Mirrors the in-app Blanche dispatcher case (server/routes/ai-assistant.ts).
  // Same field allowlist + tenant guard + empty-string → null coercion.
  // Kept in lockstep so MCP and web-chat produce identical behavior.
  const INSURANCE_FIELDS = new Set([
    'insuranceProvider', 'insuranceId', 'policyNumber', 'groupNumber',
    'effectiveDate', 'terminationDate',
    'secondaryInsuranceProvider', 'secondaryInsuranceMemberId',
    'secondaryInsurancePolicyNumber', 'secondaryInsuranceGroupNumber',
    'secondaryInsuranceRelationship', 'secondaryInsuranceSubscriberName',
    'secondaryInsuranceSubscriberDob',
  ]);

  const updatePatientInsurance = withAudit(
    'update_patient_insurance',
    'patient',
    true,
    async (input: {
      patientId: number;
      insuranceProvider?: string;
      insuranceId?: string;
      policyNumber?: string;
      groupNumber?: string;
      effectiveDate?: string;
      terminationDate?: string;
      secondaryInsuranceProvider?: string;
      secondaryInsuranceMemberId?: string;
      secondaryInsurancePolicyNumber?: string;
      secondaryInsuranceGroupNumber?: string;
      secondaryInsuranceRelationship?: string;
      secondaryInsuranceSubscriberName?: string;
      secondaryInsuranceSubscriberDob?: string;
    }) => {
      const existing = await storage.getPatient(input.patientId);
      if (!existing) throw new Error(`Patient ${input.patientId} not found`);
      if ((existing as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: patient belongs to a different practice');
      }
      const patch: Record<string, any> = {};
      for (const [k, v] of Object.entries(input)) {
        if (k === 'patientId') continue;
        if (!INSURANCE_FIELDS.has(k)) continue;
        patch[k] = v === '' ? null : v;
      }
      if (Object.keys(patch).length === 0) {
        throw new Error('No insurance fields supplied');
      }
      const updated = await storage.updatePatient(input.patientId, patch as any);
      return {
        patient: { id: updated.id, firstName: updated.firstName, lastName: updated.lastName },
        updatedFields: Object.keys(patch),
      };
    },
  );

  server.tool(
    'update_patient_insurance',
    "Update a patient's insurance information: primary/secondary provider, member ID, policy number, group number, effective/termination dates. Only supplied fields are changed; empty string clears a field. Contains PHI.",
    {
      patientId: z.number().describe('The ID of the patient whose insurance is being updated'),
      insuranceProvider: z.string().optional().describe('Primary insurance company name'),
      insuranceId: z.string().optional().describe('Primary insurance member ID'),
      policyNumber: z.string().optional().describe('Primary insurance policy number'),
      groupNumber: z.string().optional().describe('Primary insurance group number'),
      effectiveDate: z.string().optional().describe('Primary effective date (YYYY-MM-DD)'),
      terminationDate: z.string().optional().describe('Primary termination date (YYYY-MM-DD); empty for open-ended'),
      secondaryInsuranceProvider: z.string().optional().describe('Secondary insurance company name'),
      secondaryInsuranceMemberId: z.string().optional().describe('Secondary insurance member ID'),
      secondaryInsurancePolicyNumber: z.string().optional().describe('Secondary insurance policy number'),
      secondaryInsuranceGroupNumber: z.string().optional().describe('Secondary insurance group number'),
      secondaryInsuranceRelationship: z.string().optional().describe('Secondary subscriber relationship: self, spouse, child, other'),
      secondaryInsuranceSubscriberName: z.string().optional().describe('Secondary insurance subscriber full name'),
      secondaryInsuranceSubscriberDob: z.string().optional().describe('Secondary insurance subscriber DOB (YYYY-MM-DD)'),
    },
    (input) => updatePatientInsurance(input, context),
  );
}

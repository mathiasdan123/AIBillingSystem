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
}

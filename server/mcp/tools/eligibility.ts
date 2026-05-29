import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import * as stediService from '../../services/stediService';
import { runBulkEligibility } from '../../services/bulkEligibilityService';
import { logger } from '../../services/logger';
import { withAudit } from '../audit';
import { withMcpMutationGate } from '../confirmation';
import type { McpPracticeContext } from '../types';

export function registerEligibilityTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const checkEligibility = withAudit(
    'check_eligibility',
    'insurance',
    true,
    async (input: {
      patientId: number;
      payerId?: string;
      serviceTypeCodes?: string[];
      dateOfService?: string;
    }) => {
      const patient = await storage.getPatient(input.patientId);
      if (!patient) throw new Error(`Patient ${input.patientId} not found`);
      if ((patient as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: patient belongs to a different practice');
      }

      const practice = await storage.getPractice(context.practiceId);
      if (!practice) throw new Error('Practice not found');

      const request: stediService.EligibilityRequest = {
        subscriber: {
          memberId: (patient as any).insuranceId || (patient as any).memberId || '',
          firstName: (patient as any).firstName || '',
          lastName: (patient as any).lastName || '',
          dateOfBirth: (patient as any).dateOfBirth || '',
        },
        provider: {
          npi: (practice as any).npi || '',
          organizationName: (practice as any).name || '',
        },
        payer: {
          id: input.payerId || (patient as any).payerId || '',
        },
        ...(input.serviceTypeCodes ? { serviceTypeCodes: input.serviceTypeCodes } : {}),
        dateOfService:
          input.dateOfService || new Date().toISOString().split('T')[0],
      };

      return stediService.checkEligibility(request);
    },
  );

  server.tool(
    'check_eligibility',
    'Check insurance eligibility for a patient via the clearinghouse (Stedi 270/271). Returns coverage status, copays, deductibles, and out-of-pocket maximums.',
    {
      patientId: z.number().describe('Patient ID to check eligibility for'),
      payerId: z
        .string()
        .optional()
        .describe("Payer ID override (defaults to patient's insurance payer)"),
      serviceTypeCodes: z
        .array(z.string())
        .optional()
        .describe("Service type codes (default: ['30'] for health benefit coverage)"),
      dateOfService: z
        .string()
        .optional()
        .describe('Date of service (YYYY-MM-DD, defaults to today)'),
    },
    (input) => checkEligibility(input, context),
  );

  // ── P1.6 eligibility backfill ─────────────────────────────────────────
  // Three actions previously only on the in-app dispatcher
  // (server/routes/ai-assistant.ts) — mirrored on MCP so therapists can run
  // benefits verification + bulk eligibility from any MCP client. Behavior
  // matches the in-app dispatcher exactly (same Stedi calls, same caps,
  // same per-row guards). Mutations because each call hits the
  // clearinghouse and persists an eligibility_check row.

  // ── verify_benefits ──
  const verifyBenefits = withAudit(
    'verify_benefits',
    'insurance',
    true,
    withMcpMutationGate(
      async (
        input: { patientId?: number; patientName?: string },
        ctx: McpPracticeContext,
      ) => {
        let patientId = input.patientId;

        // If name provided, search for patient
        if (!patientId && input.patientName) {
          const patients = await storage.getPatients(ctx.practiceId);
          const match = patients.find((p: any) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes((input.patientName as string).toLowerCase()),
          );
          if (!match) throw new Error(`Patient "${input.patientName}" not found`);
          patientId = match.id;
        }

        if (!patientId) throw new Error('Please provide a patient name or ID');

        const patient: any = await storage.getPatient(patientId);
        if (!patient) throw new Error('Patient not found');
        if (patient.practiceId !== ctx.practiceId) {
          throw new Error('Access denied: patient belongs to a different practice');
        }

        const { getDetailedBenefits } = await import('../../services/stediService');
        const benefits = await getDetailedBenefits(patientId, ctx.practiceId);

        // Build a human-readable summary (matches in-app dispatcher exactly)
        const lines: string[] = [];
        lines.push(`Benefits Verification for ${patient.firstName} ${patient.lastName}`);
        lines.push(`Insurance: ${patient.insuranceProvider || 'Unknown'}`);
        lines.push(`Plan Status: ${benefits.planStatus.toUpperCase()}`);
        if (benefits.planName) lines.push(`Plan: ${benefits.planName}`);
        if (benefits.planType) lines.push(`Plan Type: ${benefits.planType}`);
        if (benefits.effectiveDate) lines.push(`Effective: ${benefits.effectiveDate}`);
        if (benefits.terminationDate) lines.push(`Terminates: ${benefits.terminationDate}`);

        lines.push('');
        lines.push('--- Financial Summary ---');
        if (benefits.copay != null) lines.push(`Copay: $${benefits.copay}`);
        if (benefits.coinsurance != null) lines.push(`Coinsurance: ${benefits.coinsurance}%`);
        if (benefits.deductible?.individual) {
          const met = benefits.deductible.individualMet || 0;
          lines.push(`Individual Deductible: $${met} / $${benefits.deductible.individual} met`);
        }
        if (benefits.deductible?.family) {
          const met = benefits.deductible.familyMet || 0;
          lines.push(`Family Deductible: $${met} / $${benefits.deductible.family} met`);
        }
        if (benefits.outOfPocketMax?.individual) {
          const met = benefits.outOfPocketMax.individualMet || 0;
          lines.push(`Individual OOP Max: $${met} / $${benefits.outOfPocketMax.individual} met`);
        }
        if (benefits.outOfPocketMax?.family) {
          const met = benefits.outOfPocketMax.familyMet || 0;
          lines.push(`Family OOP Max: $${met} / $${benefits.outOfPocketMax.family} met`);
        }

        if (benefits.therapyVisits) {
          lines.push('');
          lines.push('--- Therapy Visit Limits ---');
          const visitTypes: Array<{ key: string; label: string }> = [
            { key: 'ot', label: 'Occupational Therapy (OT)' },
            { key: 'pt', label: 'Physical Therapy (PT)' },
            { key: 'st', label: 'Speech Therapy (ST)' },
            { key: 'mentalHealth', label: 'Mental Health' },
            { key: 'combined', label: 'Combined Therapy' },
          ];
          for (const { key, label } of visitTypes) {
            const visits = (benefits.therapyVisits as any)[key];
            if (visits?.allowed) {
              const used = visits.used || 0;
              const remaining = visits.remaining ?? (visits.allowed - used);
              lines.push(`${label}: ${used} used / ${visits.allowed} allowed (${remaining} remaining)`);
            }
          }
        }

        lines.push('');
        lines.push(`Prior Authorization Required: ${benefits.authRequired ? 'YES' : 'No'}`);
        if (benefits.authNotes) lines.push(`Auth Notes: ${benefits.authNotes}`);

        if (benefits.errors && benefits.errors.length > 0) {
          lines.push('');
          lines.push('Errors: ' + benefits.errors.join('; '));
        }

        // Also store the check (non-fatal on failure)
        try {
          await storage.createEligibilityCheck({
            patientId,
            practiceId: ctx.practiceId,
            insuranceId: null,
            status: benefits.planStatus,
            coverageType: benefits.planType || null,
            effectiveDate: benefits.effectiveDate || null,
            terminationDate: benefits.terminationDate || null,
            copay: benefits.copay?.toString() || null,
            deductible: benefits.deductible?.individual?.toString() || null,
            deductibleMet: benefits.deductible?.individualMet?.toString() || null,
            outOfPocketMax: benefits.outOfPocketMax?.individual?.toString() || null,
            outOfPocketMet: benefits.outOfPocketMax?.individualMet?.toString() || null,
            coinsurance: benefits.coinsurance != null ? Math.round(benefits.coinsurance) : null,
            visitsAllowed: benefits.therapyVisits?.combined?.allowed || benefits.therapyVisits?.ot?.allowed || null,
            visitsUsed: benefits.therapyVisits?.combined?.used || benefits.therapyVisits?.ot?.used || null,
            authRequired: benefits.authRequired,
            rawResponse: benefits,
            benefitsDetail: benefits,
          });
        } catch (storeErr) {
          logger.warn('Failed to store benefits verification result', {
            patientId,
            error: storeErr instanceof Error ? storeErr.message : String(storeErr),
          });
        }

        return {
          summary: lines.join('\n'),
          benefits,
        };
      },
    ),
  );

  server.tool(
    'verify_benefits',
    'Run a comprehensive benefits verification for a patient. Returns detailed coverage information including plan status, plan type (HMO/PPO/EPO), therapy-specific visit limits (OT, PT, ST, Mental Health), prior authorization requirements, copay, coinsurance, deductible progress (individual and family), and out-of-pocket maximum progress. Use this when a user asks to check benefits, verify coverage details, or wants to know visit limits for a patient. Contains PHI.',
    {
      patientId: z.number().optional().describe('Patient ID to verify benefits for'),
      patientName: z.string().optional().describe('Patient name to search for (if ID not known)'),
    },
    (input) => verifyBenefits(input, context),
  );

  // ── batch_eligibility_check ──
  const batchEligibilityCheck = withAudit(
    'batch_eligibility_check',
    'insurance',
    true,
    withMcpMutationGate(
      async (_input: Record<string, never>, ctx: McpPracticeContext) => {
        // Get appointments for the next 7 days
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const upcomingAppts = await storage.getAppointmentsByDateRange(ctx.practiceId, now, sevenDaysFromNow);

        // Unique patient IDs from non-cancelled appointments
        const uniquePatientIds = Array.from(new Set(
          upcomingAppts
            .filter((a: any) => a.status !== 'cancelled' && a.patientId)
            .map((a: any) => a.patientId!),
        )) as number[];

        if (uniquePatientIds.length === 0) {
          return {
            checked: 0,
            eligible: 0,
            ineligible: 0,
            errors: 0,
            results: [],
            message: 'No upcoming appointments found in the next 7 days.',
          };
        }

        const result = await runBulkEligibility(ctx.practiceId, uniquePatientIds);
        if ('error' in result) throw new Error(result.error);
        return {
          ...result,
          message: `Checked ${result.checked} patient(s) with upcoming appointments. ${result.eligible} eligible, ${result.ineligible} ineligible, ${result.errors} error(s)/skipped.`,
        };
      },
    ),
  );

  server.tool(
    'batch_eligibility_check',
    'Check insurance eligibility for all patients with upcoming appointments in the next 7 days. No parameters needed. Returns a summary of how many patients were checked, how many are eligible, ineligible, or had errors, plus per-patient details. Contains PHI.',
    {},
    (input) => batchEligibilityCheck(input as Record<string, never>, context),
  );

  // ── bulk_eligibility_by_filter ──
  const bulkEligibilityByFilter = withAudit(
    'bulk_eligibility_by_filter',
    'insurance',
    true,
    withMcpMutationGate(
      async (
        input: {
          startDate?: string;
          endDate?: string;
          payerName?: string;
          appointmentsOnly?: boolean;
        },
        ctx: McpPracticeContext,
      ) => {
        const startDateStr = typeof input.startDate === 'string' ? input.startDate : null;
        const endDateStr = typeof input.endDate === 'string' ? input.endDate : null;
        const payerNameFilter = typeof input.payerName === 'string' ? input.payerName.trim().toLowerCase() : '';
        const appointmentsOnly = input.appointmentsOnly === undefined ? true : Boolean(input.appointmentsOnly);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = startDateStr ? new Date(startDateStr + 'T00:00:00') : today;
        const defaultEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        const end = endDateStr ? new Date(endDateStr + 'T23:59:59') : defaultEnd;

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          throw new Error('Invalid startDate or endDate. Use YYYY-MM-DD.');
        }
        if (end.getTime() < start.getTime()) {
          throw new Error('endDate must be on or after startDate.');
        }
        const rangeDays = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
        if (rangeDays > 60) {
          throw new Error(`Date range too large (${rangeDays} days). Maximum is 60 days.`);
        }

        let candidatePatientIds: number[] = [];
        let candidateRecords: Map<number, any> | null = null;

        if (appointmentsOnly) {
          const appts = await storage.getAppointmentsByDateRange(ctx.practiceId, start, end);
          candidatePatientIds = Array.from(new Set(
            appts
              .filter((a: any) => a.status !== 'cancelled' && a.patientId)
              .map((a: any) => a.patientId as number),
          ));
        } else {
          const allPatients = await storage.getPatients(ctx.practiceId);
          candidatePatientIds = allPatients.map((p: any) => p.id as number);
          candidateRecords = new Map(allPatients.map((p: any) => [p.id, p]));
        }

        if (candidatePatientIds.length > 200) {
          throw new Error(
            `Too many patients matched (${candidatePatientIds.length}). Maximum is 200 per call. Narrow the date range or payerName filter.`,
          );
        }

        let filteredIds = candidatePatientIds;
        if (payerNameFilter) {
          if (!candidateRecords) {
            candidateRecords = await storage.getPatientsByIds(candidatePatientIds);
          }
          filteredIds = candidatePatientIds.filter((pid: number) => {
            const pat = candidateRecords!.get(pid);
            if (!pat || pat.practiceId !== ctx.practiceId) return false;
            const provider = (pat.insuranceProvider || '').toLowerCase();
            return provider.includes(payerNameFilter);
          });
        }

        if (filteredIds.length === 0) {
          return {
            checked: 0,
            eligible: 0,
            ineligible: 0,
            errors: 0,
            results: [],
            message: `No patients matched the filter (range ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}${payerNameFilter ? `, payer contains "${payerNameFilter}"` : ''}, appointmentsOnly=${appointmentsOnly}).`,
          };
        }

        const result = await runBulkEligibility(ctx.practiceId, filteredIds);
        if ('error' in result) throw new Error(result.error);
        return {
          ...result,
          filters: {
            startDate: start.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10),
            payerName: payerNameFilter || null,
            appointmentsOnly,
          },
          message: `Checked ${result.checked} patient(s). ${result.eligible} eligible, ${result.ineligible} ineligible, ${result.errors} error(s)/skipped.`,
        };
      },
    ),
  );

  server.tool(
    'bulk_eligibility_by_filter',
    'Run insurance eligibility checks for a flexible set of patients filtered by date range and/or payer name. Generalization of batch_eligibility_check. Use when the user asks to check eligibility for a specific date range, a specific payer (e.g. "all my Aetna patients next month"), or all active patients on a payer regardless of appointments. Hard caps: date range max 60 days, max 200 patients per call. Contains PHI.',
    {
      startDate: z.string().optional().describe('Start date for appointment range (YYYY-MM-DD). Defaults to today. Ignored when appointmentsOnly is false.'),
      endDate: z.string().optional().describe('End date for appointment range (YYYY-MM-DD), inclusive. Defaults to today + 7 days. Range may not exceed 60 days.'),
      payerName: z.string().optional().describe('Optional case-insensitive substring to filter by patient insurance carrier name (e.g. "aetna", "blue cross").'),
      appointmentsOnly: z.boolean().optional().describe('If true (default), only check patients with non-cancelled appointments in the date range. If false, check all active patients matching the payerName filter (date range ignored).'),
    },
    (input) => bulkEligibilityByFilter(input, context),
  );
}

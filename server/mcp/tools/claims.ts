import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import * as stediService from '../../services/stediService';
import { withAudit } from '../audit';
import { withMcpMutationGate } from '../confirmation';
import { rejectIfDemoDataMessage } from '../../services/bulkEligibilityService';
import type { McpPracticeContext } from '../types';

export function registerClaimTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  // ── submit_claim ──────────────────────────────────────────────────────
  const submitClaim = withAudit(
    'submit_claim',
    'claim',
    true,
    withMcpMutationGate(async (input: { claimId: number }, ctx: McpPracticeContext) => {
      const claim = await storage.getClaim(input.claimId);
      if (!claim) throw new Error(`Claim ${input.claimId} not found`);
      if ((claim as any).practiceId !== ctx.practiceId) {
        throw new Error('Access denied: claim belongs to a different practice');
      }

      // Idempotency: never re-transmit a claim already sent to the payer. A
      // retried tool call must not file a duplicate 837P.
      const status = String((claim as any).status || '').toLowerCase();
      if (['submitted', 'paid', 'appeal', 'denied'].includes(status)) {
        throw new Error(
          `Claim ${input.claimId} is already '${status}' — it has been submitted and cannot be re-submitted.`,
        );
      }

      const patient = await storage.getPatient((claim as any).patientId);
      if (!patient) throw new Error('Patient not found for claim');

      // Never transmit a real 837P for demo data.
      const demoBlock =
        rejectIfDemoDataMessage(claim as any, 'claim') ||
        rejectIfDemoDataMessage(patient as any, 'patient');
      if (demoBlock) throw new Error(demoBlock);

      const practice = await storage.getPractice(ctx.practiceId);
      if (!practice) throw new Error('Practice not found');
      // The isolated demo practice is a sandbox — never transmit a real 837P
      // for it, even though its seed rows are not individually flagged isDemo.
      if ((practice as any).isDemo) {
        throw new Error('This is the demo practice — claims are not transmitted to a real payer.');
      }

      const lineItems = await storage.getClaimLineItems(input.claimId);
      // Refuse to transmit an empty/malformed claim (no billable service lines).
      if (!lineItems || lineItems.length === 0) {
        throw new Error(
          `Claim ${input.claimId} has no line items — add the billed CPT codes (provider-reviewed) before submitting.`,
        );
      }

      const submission: stediService.ClaimSubmission = {
        claimId: String(claim.id),
        totalAmount: Number((claim as any).totalAmount) || 0,
        placeOfService: (claim as any).placeOfService || '11',
        dateOfService: (claim as any).dateOfService
          ? new Date((claim as any).dateOfService).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        patient: {
          firstName: (patient as any).firstName || '',
          lastName: (patient as any).lastName || '',
          dateOfBirth: (patient as any).dateOfBirth || '',
          gender: ((patient as any).gender || 'U') as 'M' | 'F' | 'U',
          address: {
            line1: (patient as any).address || '',
            city: (patient as any).city || '',
            state: (patient as any).state || '',
            zip: (patient as any).zipCode || '',
          },
          memberId: (patient as any).insuranceId || '',
        },
        provider: {
          npi: (practice as any).npi || '',
          taxId: (practice as any).taxId || '',
          organizationName: (practice as any).name || '',
          address: {
            line1: (practice as any).address || '',
            city: (practice as any).city || '',
            state: (practice as any).state || '',
            zip: (practice as any).zipCode || '',
          },
        },
        payer: {
          id: (claim as any).payerId || '',
          name: (claim as any).payerName || '',
        },
        serviceLines: lineItems.map((li: any) => ({
          procedureCode: li.cptCode || '',
          modifiers: li.modifiers ? li.modifiers.split(',') : [],
          diagnosisCodes: li.diagnosisCodes
            ? li.diagnosisCodes.split(',')
            : [],
          amount: Number(li.amount) || 0,
          units: Number(li.units) || 1,
          dateOfService: (claim as any).dateOfService
            ? new Date((claim as any).dateOfService).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
        })),
        diagnosisCodes: (claim as any).diagnosisCodes
          ? (claim as any).diagnosisCodes.split(',')
          : [],
      };

      // Pass the practice so sandbox mode is honored and a per-practice
      // clearinghouse key is used, exactly as on the HTTP path.
      return stediService.submitClaim(submission, ctx.practiceId);
    }),
  );

  server.tool(
    'submit_claim',
    'Transmit an existing claim to the clearinghouse as a real 837P (an irreversible external action that files with the payer). The claim must already exist with billed CPT line items that the treating provider has reviewed and approved — the provider makes the final coding decision. Already-submitted claims and demo data are refused.',
    { claimId: z.number().describe('Internal claim ID to submit') },
    (input) => submitClaim(input, context),
  );

  // ── get_claim_status ──────────────────────────────────────────────────
  const getClaimStatus = withAudit(
    'get_claim_status',
    'claim',
    true,
    async (input: { claimId: number }) => {
      const claim = await storage.getClaim(input.claimId);
      if (!claim) throw new Error(`Claim ${input.claimId} not found`);
      if ((claim as any).practiceId !== context.practiceId) {
        throw new Error('Access denied: claim belongs to a different practice');
      }

      const patient = await storage.getPatient((claim as any).patientId);
      if (!patient) throw new Error('Patient not found for claim');

      const practice = await storage.getPractice(context.practiceId);
      if (!practice) throw new Error('Practice not found');

      const request: stediService.ClaimStatusRequest = {
        claimId: String(claim.id),
        payer: { id: (claim as any).payerId || '' },
        provider: {
          npi: (practice as any).npi || '',
          taxId: (practice as any).taxId || '',
        },
        subscriber: {
          memberId: (patient as any).insuranceId || '',
          firstName: (patient as any).firstName || '',
          lastName: (patient as any).lastName || '',
          dateOfBirth: (patient as any).dateOfBirth || '',
        },
        dateOfService: (claim as any).dateOfService
          ? new Date((claim as any).dateOfService).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        claimAmount: Number((claim as any).totalAmount) || undefined,
      };

      return stediService.checkClaimStatus(request);
    },
  );

  server.tool(
    'get_claim_status',
    'Check the status of a submitted claim via the clearinghouse (Stedi 276/277).',
    { claimId: z.number().describe('Internal claim ID to check status for') },
    (input) => getClaimStatus(input, context),
  );

  // ── get_overdue_claims ────────────────────────────────────────────────
  const getOverdueClaims = withAudit(
    'get_overdue_claims',
    'claim',
    false,
    async (input: { daysThreshold?: number; limit?: number }) => {
      const claims = await storage.getClaims(context.practiceId);
      const threshold = input.daysThreshold ?? 30;
      const limit = input.limit ?? 50;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - threshold);

      const overdue = claims
        .filter((c: any) => {
          if (c.status !== 'submitted') return false;
          const submitted = c.submittedAt ? new Date(c.submittedAt) : null;
          return submitted && submitted < cutoff;
        })
        .slice(0, limit);

      return { total: overdue.length, claims: overdue };
    },
  );

  server.tool(
    'get_overdue_claims',
    'Get claims that have been submitted but not resolved past a threshold number of days.',
    {
      daysThreshold: z
        .number()
        .optional()
        .describe('Days past submission to consider overdue (default 30)'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of claims to return (default 50)'),
    },
    (input) => getOverdueClaims(input, context),
  );

  // ── list_cpt_codes ────────────────────────────────────────────────────
  // Read-only catalog lookup. Exists so a caller can resolve a CPT string
  // to its database id rather than guessing an integer — a wrong guess
  // passes every downstream check and bills the wrong procedure. The
  // catalog is global, not practice-scoped, so no tenant guard applies.
  const listCptCodes = withAudit(
    'list_cpt_codes',
    'claim',
    false,
    async (input: { search?: string; therapyCategory?: string }) => {
      const search = (input.search || '').trim().toLowerCase();
      const category = (input.therapyCategory || '').trim().toUpperCase();
      const all = await storage.getCptCodes();
      const codes = (all as any[])
        .filter((c) => c.isActive !== false)
        .filter((c) => (category ? String(c.therapyCategory || '').toUpperCase() === category : true))
        .filter((c) =>
          search
            ? String(c.code).toLowerCase().includes(search) ||
              String(c.description || '').toLowerCase().includes(search)
            : true,
        )
        .map((c) => ({
          cptCodeId: c.id,
          code: c.code,
          description: c.description,
          therapyCategory: c.therapyCategory || null,
          baseRate: c.baseRate,
        }));
      return { count: codes.length, codes };
    },
  );

  server.tool(
    'list_cpt_codes',
    "List the CPT codes in the practice's catalog with the numeric id each maps to. Call this BEFORE add_claim_line_item whenever you have a CPT string but not its id — the id is a database key and is NOT derivable from the code. Never guess a cptCodeId. If no code matches, say so rather than substituting a similar code.",
    {
      search: z
        .string()
        .optional()
        .describe('Optional filter matched against the code or description (e.g. "92507", "speech")'),
      therapyCategory: z
        .string()
        .optional()
        .describe('Optional discipline filter: OT, PT, ST, MH, or GENERAL'),
    },
    (input) => listCptCodes(input, context),
  );

  // ── add_claim_line_item ───────────────────────────────────────────────
  // Mirrors the in-app dispatcher case + POST /api/claims/:id/line-items.
  // Status guard: only draft claims accept new line items. Total
  // recomputed from all line items after the add so subsequent queries
  // reflect the new amount.
  const addClaimLineItem = withAudit(
    'add_claim_line_item',
    'claim',
    false,
    withMcpMutationGate(
      async (
        input: {
          claimId: number;
          cptCodeId: number;
          cptCode?: string;
          units?: number;
          icd10CodeId?: number;
          dateOfService?: string;
          modifier?: string;
          notes?: string;
        },
        ctx: McpPracticeContext,
      ) => {
        const claim = await storage.getClaim(input.claimId);
        if (!claim) throw new Error(`Claim ${input.claimId} not found`);
        if ((claim as any).practiceId !== ctx.practiceId) {
          throw new Error('Access denied: claim belongs to a different practice');
        }
        if ((claim as any).status && (claim as any).status !== 'draft') {
          throw new Error(
            `Cannot add line items to a claim in status "${(claim as any).status}". Only draft claims accept new line items. If this claim was denied and needs correction, draft a corrected claim instead.`,
          );
        }
        const cptCodes = await storage.getCptCodes();
        const cptCode: any = cptCodes.find((c: any) => c.id === input.cptCodeId);
        if (!cptCode) throw new Error(`CPT code id ${input.cptCodeId} not found in catalog`);

        // Cross-check: a wrong cptCodeId resolves to a real code and bills a
        // real (wrong) procedure, so nothing downstream can catch it. If the
        // caller stated the code it means to bill, it must match.
        const intendedCode = (input.cptCode || '').trim();
        if (intendedCode && intendedCode !== String(cptCode.code)) {
          throw new Error(
            `Refusing to add: cptCodeId ${input.cptCodeId} is CPT ${cptCode.code} ("${cptCode.description}"), but you said you were billing ${intendedCode}. Call list_cpt_codes to get the correct id — do not guess.`,
          );
        }

        // Price from this practice's fee schedule; the catalog figure is a
        // shared platform suggestion and must never reach a claim.
        const practiceRate = await storage.resolvePracticeCptRate(ctx.practiceId, input.cptCodeId);
        if (practiceRate === null) {
          throw new Error(
            `No charge is set for CPT ${cptCode.code} in this practice's fee schedule, so it cannot be billed. Set it under Insurance Rates → Your Charges.`,
          );
        }

        const rate = parseFloat(practiceRate);
        const lineUnits = input.units || 1;
        const amount = (rate * lineUnits).toFixed(2);
        const lineItem = await storage.createClaimLineItem({
          claimId: input.claimId,
          cptCodeId: input.cptCodeId,
          icd10CodeId: input.icd10CodeId || null,
          units: lineUnits,
          rate: rate.toFixed(2),
          amount,
          dateOfService: input.dateOfService || new Date().toISOString().split('T')[0],
          modifier: input.modifier || null,
          notes: input.notes || null,
        } as any);
        const allLineItems = await storage.getClaimLineItems(input.claimId);
        const newTotal = allLineItems.reduce(
          (sum: number, li: any) => sum + parseFloat(li.amount || '0'),
          0,
        );
        await storage.updateClaim(input.claimId, { totalAmount: newTotal.toFixed(2) } as any);
        return {
          lineItem: {
            id: lineItem.id, cptCode: cptCode.code, units: lineUnits, rate: rate.toFixed(2), amount,
          },
          claim: {
            id: input.claimId, newTotalAmount: newTotal.toFixed(2), lineItemCount: allLineItems.length,
          },
        };
      },
    ),
  );

  server.tool(
    'add_claim_line_item',
    'Append a single CPT line item to an existing DRAFT claim. The claim total auto-recalculates after the add. To CHANGE or REMOVE an existing line use update_claim_line_item / delete_claim_line_item rather than adding a second line. Use when a therapist wants to add a missed CPT code to a claim before submission.',
    {
      claimId: z.number().describe('The ID of the draft claim to add a line item to'),
      cptCodeId: z.number().describe('The CPT code id — get it from list_cpt_codes, never guess it'),
      cptCode: z
        .string()
        .optional()
        .describe('The CPT code string you intend to bill, e.g. "97530". Always pass this — it is cross-checked against cptCodeId and the call is rejected on mismatch.'),
      units: z.number().optional().describe('Billing units (default 1)'),
      icd10CodeId: z.number().optional().describe('Optional ICD-10 code id for this line item'),
      dateOfService: z.string().optional().describe('Date of service YYYY-MM-DD (default today)'),
      modifier: z.string().optional().describe('Optional CPT modifier'),
      notes: z.string().optional().describe('Optional free-text notes'),
    },
    (input) => addClaimLineItem(input, context),
  );

  // ── get_claim_line_items ──────────────────────────────────────────────
  // Read-only. A line item id is a database key and a claim can carry the
  // same CPT on more than one line, so the code alone cannot identify a
  // line. Callers must look the id up rather than guess it.
  const getClaimLineItemsTool = withAudit(
    'get_claim_line_items',
    'claim',
    true,
    async (input: { claimId: number }, ctx: McpPracticeContext) => {
      const claim = await storage.getClaim(input.claimId);
      if (!claim) throw new Error(`Claim ${input.claimId} not found`);
      if ((claim as any).practiceId !== ctx.practiceId) {
        throw new Error('Access denied: claim belongs to a different practice');
      }
      const items = await storage.getClaimLineItems(input.claimId);
      const catalog = await storage.getCptCodes();
      return {
        claimId: input.claimId,
        claimNumber: (claim as any).claimNumber,
        status: (claim as any).status,
        editable: ((claim as any).status || '').toLowerCase() === 'draft',
        totalAmount: (claim as any).totalAmount,
        lineItems: (items || []).map((li: any) => {
          const cpt: any = catalog.find((c: any) => c.id === li.cptCodeId);
          const offSchedule =
            li.standardRate &&
            parseFloat(li.standardRate).toFixed(2) !== parseFloat(li.rate || '0').toFixed(2);
          return {
            lineItemId: li.id,
            cptCode: cpt?.code ?? null,
            description: cpt?.description ?? null,
            units: li.units,
            rate: li.rate,
            amount: li.amount,
            modifier: li.modifier,
            dateOfService: li.dateOfService,
            billedOffFeeSchedule: !!offSchedule,
            standardRate: li.standardRate ?? null,
            rateOverrideReason: li.rateOverrideReason ?? null,
          };
        }),
      };
    },
  );

  server.tool(
    'get_claim_line_items',
    "List the CPT lines on a claim with each line's id, code, units, rate and amount. Call this BEFORE update_claim_line_item or delete_claim_line_item — a line item id is a database key, is NOT derivable from the CPT code, and a claim can carry the same code on more than one line. Never guess a lineItemId.",
    { claimId: z.number().describe('The claim whose line items to list') },
    (input) => getClaimLineItemsTool(input, context),
  );

  // ── update_claim_line_item / delete_claim_line_item ───────────────────
  // Draft claims only: once a claim is submitted the payer holds the version
  // we sent, and amending ours silently would leave the two disagreeing.
  const guardEditableLine = async (
    claimId: number,
    lineItemId: number,
    intendedCode: string | undefined,
    ctx: McpPracticeContext,
  ) => {
    const claim = await storage.getClaim(claimId);
    if (!claim) throw new Error(`Claim ${claimId} not found`);
    if ((claim as any).practiceId !== ctx.practiceId) {
      throw new Error('Access denied: claim belongs to a different practice');
    }
    const status = ((claim as any).status || '').toLowerCase();
    if (status && status !== 'draft') {
      throw new Error(
        `Cannot change line items on a claim in status "${status}". Only draft claims are editable; a submitted claim needs a corrected claim.`,
      );
    }
    const lineItem = await storage.getClaimLineItem(lineItemId);
    if (!lineItem || (lineItem as any).claimId !== claimId) {
      throw new Error(`Line item ${lineItemId} is not on claim ${claimId}`);
    }
    const catalog = await storage.getCptCodes();
    const lineCpt: any = catalog.find((c: any) => c.id === (lineItem as any).cptCodeId);
    const intended = (intendedCode || '').trim();
    if (intended && lineCpt && intended !== String(lineCpt.code)) {
      throw new Error(
        `Refusing: line item ${lineItemId} is CPT ${lineCpt.code}, but you said ${intended}. Call get_claim_line_items to find the right line — do not guess.`,
      );
    }
    return { claim, lineItem, lineCpt };
  };

  const updateClaimLineItemTool = withAudit(
    'update_claim_line_item',
    'claim',
    false,
    withMcpMutationGate(
      async (
        input: {
          claimId: number;
          lineItemId: number;
          cptCode?: string;
          units?: number;
          rate?: number | null;
          rateOverrideReason?: string;
          modifier?: string;
          icd10CodeId?: number;
          dateOfService?: string;
        },
        ctx: McpPracticeContext,
      ) => {
        const { lineItem, lineCpt } = await guardEditableLine(
          input.claimId, input.lineItemId, input.cptCode, ctx,
        );

        const patch: Record<string, any> = {};
        if (input.units !== undefined) {
          if (!Number.isInteger(input.units) || input.units < 1 || input.units > 999) {
            throw new Error('Units must be a whole number between 1 and 999.');
          }
          patch.units = input.units;
        }
        if (input.rate !== undefined) {
          if (input.rate === null) {
            const standard =
              (lineItem as any).standardRate ??
              (await storage.resolvePracticeCptRate(ctx.practiceId, (lineItem as any).cptCodeId));
            if (standard === null) {
              throw new Error('No charge is set for this code, so there is no fee-schedule rate to revert to.');
            }
            patch.rate = standard;
            patch.rateOverrideReason = null;
          } else {
            if (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100000) {
              throw new Error('Rate must be a number between 0 and 100000.');
            }
            patch.rate = input.rate.toFixed(2);
            if (input.rateOverrideReason !== undefined) {
              patch.rateOverrideReason = input.rateOverrideReason || null;
            }
          }
        } else if (input.rateOverrideReason !== undefined) {
          patch.rateOverrideReason = input.rateOverrideReason || null;
        }
        if (input.modifier !== undefined) patch.modifier = input.modifier || null;
        if (input.icd10CodeId !== undefined) patch.icd10CodeId = input.icd10CodeId || null;
        if (input.dateOfService !== undefined) patch.dateOfService = input.dateOfService || null;

        if (Object.keys(patch).length === 0) {
          throw new Error('Nothing to change — specify units, rate, modifier, diagnosis, or date.');
        }

        const updated = await storage.updateClaimLineItem(input.lineItemId, patch);
        const newTotal = await storage.recalculateClaimTotal(input.claimId);
        return {
          lineItem: {
            lineItemId: input.lineItemId,
            cptCode: lineCpt?.code ?? null,
            units: (updated as any)?.units,
            rate: (updated as any)?.rate,
            amount: (updated as any)?.amount,
            modifier: (updated as any)?.modifier,
          },
          claim: { id: input.claimId, newTotalAmount: newTotal },
        };
      },
    ),
  );

  server.tool(
    'update_claim_line_item',
    'Correct an existing CPT line on a DRAFT claim — units, modifier, diagnosis, or the charge itself. Call get_claim_line_items first to get the lineItemId; never guess it. The claim total recalculates automatically. Only draft claims can be changed.',
    {
      claimId: z.number().describe('The claim the line belongs to'),
      lineItemId: z.number().describe('The line item id, from get_claim_line_items'),
      cptCode: z.string().optional().describe('The CPT code you expect on that line. Always pass this — it is cross-checked and the call is rejected on mismatch.'),
      units: z.number().optional().describe('New unit count (whole number, 1-999)'),
      rate: z.number().nullable().optional().describe('A one-off charge differing from the fee schedule. Pass null to clear an override and revert to the schedule.'),
      rateOverrideReason: z.string().optional().describe('Why this line bills off the fee schedule'),
      modifier: z.string().optional().describe('CPT modifier; empty string clears it'),
      icd10CodeId: z.number().optional().describe('New ICD-10 diagnosis code id'),
      dateOfService: z.string().optional().describe('Date of service YYYY-MM-DD'),
    },
    (input) => updateClaimLineItemTool(input, context),
  );

  const deleteClaimLineItemTool = withAudit(
    'delete_claim_line_item',
    'claim',
    false,
    withMcpMutationGate(
      async (
        input: { claimId: number; lineItemId: number; cptCode?: string },
        ctx: McpPracticeContext,
      ) => {
        const { lineItem, lineCpt } = await guardEditableLine(
          input.claimId, input.lineItemId, input.cptCode, ctx,
        );
        await storage.deleteClaimLineItem(input.lineItemId);
        const newTotal = await storage.recalculateClaimTotal(input.claimId);
        return {
          removed: {
            lineItemId: input.lineItemId,
            cptCode: lineCpt?.code ?? null,
            amount: (lineItem as any).amount,
          },
          claim: { id: input.claimId, newTotalAmount: newTotal },
        };
      },
    ),
  );

  server.tool(
    'delete_claim_line_item',
    'Remove a CPT line from a DRAFT claim entirely. Call get_claim_line_items first to get the lineItemId; never guess it. The claim total recalculates automatically. Only draft claims can be changed. To CHANGE a line rather than remove it, use update_claim_line_item — deleting and re-adding loses the line history.',
    {
      claimId: z.number().describe('The claim the line belongs to'),
      lineItemId: z.number().describe('The line item id, from get_claim_line_items'),
      cptCode: z.string().optional().describe('The CPT code you expect on that line. Always pass this — it is cross-checked and the call is rejected on mismatch.'),
    },
    (input) => deleteClaimLineItemTool(input, context),
  );
}

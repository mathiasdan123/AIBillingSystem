/**
 * Claim Precedent Service
 *
 * Phase 0 / Workstream B of the Sheer-Health-style denial-fighting strategy.
 *
 * Mines our own historical claim data to find prior payments by the same
 * payer that establish a precedent for fighting a current denial. The
 * killer appeal sentence this enables:
 *
 *   "Aetna paid claim #20240115-1234 for CPT 97530 with diagnosis F84.0
 *    for this same member on January 15, 2026. The denial of claim
 *    #20260427-5678 on April 27, 2026 is inconsistent with that prior
 *    payment history."
 *
 * Multi-tenant safety: all queries scoped by practiceId. We deliberately
 * DO NOT mine cross-practice data here — exposing one practice's payment
 * history to another would risk PHI leakage. Cross-practice anonymized
 * pattern learning is a separate workstream (the existing aiLearningService).
 */

import { and, eq, gte, desc, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { claims, claimLineItems, cptCodes, icd10Codes } from '@shared/schema';
import logger from './logger';

export interface PrecedentLookupArgs {
  practiceId: number;
  patientId: number;
  /** Optional — when omitted, matches across all payers for the patient. */
  insuranceId?: number;
  /** CPT code string (e.g. "97530"). */
  cptCode: string;
  /** Optional ICD-10 string (e.g. "F84.0"). When provided, narrows to claims
   *  whose line item also referenced the same diagnosis. */
  diagnosisCode?: string;
  /** How far back to look. Default 365 days. */
  daysBack?: number;
  /** Optional: max precedents returned, sorted most-recent first. Default 10. */
  limit?: number;
}

export interface ClaimPrecedent {
  claimId: number;
  claimNumber: string | null;
  insuranceId: number | null;
  insuranceName?: string | null;
  paidAmount: number | null;
  paidAt: Date | null;
  dateOfService: string | null;
  cptCode: string;
  diagnosisCode?: string;
  units: number;
  modifier?: string;
}

/**
 * Find prior PAID claims for the same patient + same CPT (and optional
 * matching ICD-10) within the lookback window. Returns most-recent-first.
 *
 * Filters:
 *   - same practice (multi-tenant)
 *   - same patient
 *   - same insuranceId if specified
 *   - status = 'paid'
 *   - paidAt within daysBack window (or createdAt if paidAt missing)
 *   - has a line item with the requested CPT code
 *   - if diagnosisCode given, that line item also references the same ICD-10
 */
export async function findApprovalPrecedents(
  args: PrecedentLookupArgs,
): Promise<ClaimPrecedent[]> {
  const {
    practiceId,
    patientId,
    insuranceId,
    cptCode,
    diagnosisCode,
    daysBack = 365,
    limit = 10,
  } = args;

  if (!practiceId || !patientId || !cptCode) {
    return [];
  }

  const horizon = new Date();
  horizon.setDate(horizon.getDate() - daysBack);

  try {
    // Resolve CPT → cptCodeId. We do an exact match (CPT codes are short and
    // unambiguous). If the requested code doesn't exist in our cpt_codes
    // table, return empty rather than crash — this is a feature lookup,
    // not a system invariant.
    const [cptRow] = await db
      .select({ id: cptCodes.id })
      .from(cptCodes)
      .where(eq(cptCodes.code, cptCode))
      .limit(1);
    if (!cptRow) return [];

    let icdId: number | null = null;
    if (diagnosisCode) {
      const [icdRow] = await db
        .select({ id: icd10Codes.id })
        .from(icd10Codes)
        .where(eq(icd10Codes.code, diagnosisCode))
        .limit(1);
      if (icdRow) icdId = icdRow.id;
      // If the ICD doesn't exist in our table we silently fall through —
      // we'll just return CPT-only matches. The diagnosis is a soft filter.
    }

    const claimConditions = [
      eq(claims.practiceId, practiceId),
      eq(claims.patientId, patientId),
      eq(claims.status, 'paid'),
      // Paid window: paidAt is the most reliable timestamp; fall back to
      // createdAt when paidAt is null (legacy / partial data).
      sql`COALESCE(${claims.paidAt}, ${claims.createdAt}) >= ${horizon}`,
    ];
    if (insuranceId) {
      claimConditions.push(eq(claims.insuranceId, insuranceId));
    }

    const lineConditions = [eq(claimLineItems.cptCodeId, cptRow.id)];
    if (icdId !== null) {
      lineConditions.push(eq(claimLineItems.icd10CodeId, icdId));
    }

    const rows = await db
      .select({
        claimId: claims.id,
        claimNumber: claims.claimNumber,
        insuranceId: claims.insuranceId,
        paidAmount: claims.paidAmount,
        paidAt: claims.paidAt,
        createdAt: claims.createdAt,
        dateOfService: claimLineItems.dateOfService,
        units: claimLineItems.units,
        modifier: claimLineItems.modifier,
      })
      .from(claims)
      .innerJoin(claimLineItems, eq(claimLineItems.claimId, claims.id))
      .where(and(...claimConditions, ...lineConditions))
      .orderBy(desc(sql`COALESCE(${claims.paidAt}, ${claims.createdAt})`))
      .limit(limit);

    return rows.map((r: any): ClaimPrecedent => ({
      claimId: r.claimId,
      claimNumber: r.claimNumber,
      insuranceId: r.insuranceId,
      paidAmount: r.paidAmount !== null ? Number(r.paidAmount) : null,
      paidAt: r.paidAt,
      dateOfService: r.dateOfService,
      cptCode,
      diagnosisCode,
      units: r.units ?? 1,
      modifier: r.modifier ?? undefined,
    }));
  } catch (err: any) {
    logger.error('findApprovalPrecedents failed', {
      practiceId,
      patientId,
      cptCode,
      error: err?.message,
    });
    return [];
  }
}

/**
 * Convenience wrapper: given a denied claim, find precedents for ALL of its
 * line items. Returns map of cptCode → precedents[]. Useful for the appeal
 * letter generator which wants to cite precedents per line item.
 */
export async function findPrecedentsForDeniedClaim(args: {
  practiceId: number;
  patientId: number;
  insuranceId?: number;
  /** CPT codes from the denied claim's line items. */
  cptCodes: string[];
  /** Optional shared diagnosis code; if you want per-CPT diagnoses, call
   *  findApprovalPrecedents directly per line. */
  diagnosisCode?: string;
  daysBack?: number;
  limitPerCode?: number;
}): Promise<Map<string, ClaimPrecedent[]>> {
  const { practiceId, patientId, insuranceId, cptCodes: codes, diagnosisCode, daysBack, limitPerCode = 5 } = args;
  const result = new Map<string, ClaimPrecedent[]>();
  // Run sequentially to keep DB load predictable. Most denied claims have
  // 1-3 line items so this is fine.
  for (const code of codes) {
    const precedents = await findApprovalPrecedents({
      practiceId,
      patientId,
      insuranceId,
      cptCode: code,
      diagnosisCode,
      daysBack,
      limit: limitPerCode,
    });
    if (precedents.length > 0) result.set(code, precedents);
  }
  return result;
}

/**
 * Format a precedent list as a quotable string for inclusion in an appeal
 * letter. Returned string is empty when there are no precedents — caller
 * can then conditionally include the "prior payment history" paragraph.
 */
export function formatPrecedentsForAppeal(precedents: ClaimPrecedent[]): string {
  if (precedents.length === 0) return '';

  const lines = precedents.slice(0, 5).map((p) => {
    const parts: string[] = [];
    if (p.claimNumber) parts.push(`claim #${p.claimNumber}`);
    parts.push(`CPT ${p.cptCode}`);
    if (p.diagnosisCode) parts.push(`diagnosis ${p.diagnosisCode}`);
    if (p.dateOfService) parts.push(`date of service ${p.dateOfService}`);
    if (p.paidAt) parts.push(`paid ${p.paidAt.toISOString().split('T')[0]}`);
    if (p.paidAmount !== null) parts.push(`amount $${p.paidAmount.toFixed(2)}`);
    return `  - ${parts.join(', ')}`;
  });

  return [
    `The following ${precedents.length} prior claim${precedents.length === 1 ? '' : 's'} for the same member, paid by the same payer, establish${precedents.length === 1 ? 'es' : ''} a payment precedent:`,
    ...lines,
  ].join('\n');
}

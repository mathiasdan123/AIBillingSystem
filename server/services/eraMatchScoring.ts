/**
 * Scoring for matching an ERA (835) remittance line to a claim.
 *
 * This decides which claim a payer's money lands on, so a wrong answer moves
 * real dollars onto a stranger's account and onto their patient statement.
 * Two rules exist because both were violated:
 *
 * 1. **Identity is required, not merely scored.** A service date and a CPT
 *    code that agree do not tell you WHOSE claim this is — plenty of patients
 *    are seen on the same day for the same procedure. Corroborating signals
 *    can raise confidence in a claim already tied to the patient; they can
 *    never establish the tie.
 *
 * 2. **Corroboration is scored with max(), never summed across line items.**
 *    Summing let a claim earn points once per line item, so a multi-line
 *    claim could clear the threshold on volume alone.
 */

export interface ScoredClaimCandidate {
  /** Points from patient identity alone (name). Zero means: not a candidate. */
  identityScore: number;
  /** Identity + corroboration. */
  score: number;
  matchTypes: string[];
}

export interface RemittanceLineForMatch {
  patientName?: string | null;
  serviceDate?: string | null;
  cptCode?: string | null;
  chargedAmount?: string | number | null;
}

export interface ClaimForMatch {
  patientFirstName?: string | null;
  patientLastName?: string | null;
  totalAmount?: string | number | null;
}

export interface ClaimLineForMatch {
  dateOfService?: string | null;
  cptCodeId?: number | null;
}

/** Minimum total score for a line to be auto-matched to a claim. */
export const AUTO_MATCH_THRESHOLD = 40;

export function scoreClaimAgainstRemittanceLine(
  claim: ClaimForMatch,
  claimLines: ClaimLineForMatch[],
  lineItem: RemittanceLineForMatch,
  cptCodeById: Map<number, string>,
): ScoredClaimCandidate {
  let score = 0;
  const matchTypes: string[] = [];

  // ---- Identity ----
  // 835 files commonly render names as "LAST, FIRST" or "LAST^FIRST". Without
  // stripping the separators, "doe," never equals "doe" and a legitimate
  // payment goes unmatched — money that sits unposted rather than landing on
  // the right claim.
  const normalizeName = (v: string) =>
    v.toLowerCase().replace(/[.,^]/g, ' ').replace(/\s+/g, ' ').trim();

  const claimPatientName = normalizeName(
    `${claim.patientFirstName ?? ''} ${claim.patientLastName ?? ''}`,
  );
  const remittancePatientName = normalizeName(lineItem.patientName || '');

  if (claimPatientName && remittancePatientName) {
    if (claimPatientName === remittancePatientName) {
      score += 40;
      matchTypes.push('exact_name');
    } else {
      const claimLast = normalizeName(claim.patientLastName || '');
      const remitParts = remittancePatientName.split(/\s+/);
      const remitLast = remitParts.length > 1 ? remitParts[remitParts.length - 1] : remitParts[0];
      const remitFirst = remitParts.length > 1 ? remitParts[0] : '';

      if (claimLast && (claimLast === remitLast || claimLast === remitParts[0])) {
        score += 25;
        matchTypes.push('last_name');
        const claimFirst = normalizeName(claim.patientFirstName || '');
        if (claimFirst && (claimFirst === remitFirst || claimFirst === remitParts[remitParts.length - 1])) {
          score += 15;
          matchTypes.push('first_name');
        }
      }
    }
  }

  const identityScore = score;

  // ---- Corroboration (max per signal, never summed per line) ----
  let dateScore = 0;
  let cptScore = 0;
  for (const cli of claimLines) {
    if (lineItem.serviceDate && cli.dateOfService) {
      if (lineItem.serviceDate.replace(/-/g, '') === String(cli.dateOfService).replace(/-/g, '')) {
        dateScore = Math.max(dateScore, 20);
      }
    }
    if (lineItem.cptCode && cli.cptCodeId) {
      const claimCpt = cptCodeById.get(cli.cptCodeId);
      if (claimCpt && claimCpt.toUpperCase() === String(lineItem.cptCode).toUpperCase()) {
        cptScore = Math.max(cptScore, 15);
      }
    }
  }
  if (dateScore) matchTypes.push('service_date');
  if (cptScore) matchTypes.push('cpt');
  score += dateScore + cptScore;

  // Amount agreement, tie-breaker only.
  if (lineItem.chargedAmount != null && claim.totalAmount != null) {
    const lineCharged = parseFloat(String(lineItem.chargedAmount));
    const claimAmount = parseFloat(String(claim.totalAmount));
    if (Number.isFinite(lineCharged) && Number.isFinite(claimAmount) && Math.abs(lineCharged - claimAmount) < 0.01) {
      score += 10;
      matchTypes.push('amount');
    }
  }

  return { identityScore, score, matchTypes };
}

/** A line may be auto-matched only with identity evidence AND enough total score. */
export function isAutoMatch(candidate: ScoredClaimCandidate): boolean {
  return candidate.identityScore > 0 && candidate.score >= AUTO_MATCH_THRESHOLD;
}

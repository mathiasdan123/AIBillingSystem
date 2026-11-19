/**
 * Shared loader for the denial predictor's claim input.
 *
 * Three callers run predictDenial (the predict-denial route, the MCP
 * predict_denial_risk tool and the compliance risk service). Each used to
 * assemble the claim input on its own, so two of them still passed no
 * session date after #489 and kept reporting a missing date of service on
 * claims whose lines take their date from the linked session. Every caller
 * now goes through buildPredictDenialClaimInput, so they agree.
 */
import { storage } from '../storage';
import logger from './logger';
import type { ClaimInput } from './aiDenialPredictor';

export interface ClaimForPrediction {
  id: number;
  claimNumber?: string | null;
  totalAmount: string;
  status?: string | null;
  insuranceId?: number | null;
  sessionId?: number | null;
  practiceId?: number | null;
  patientId?: number | null;
}

/**
 * The linked treatment session's date (YYYY-MM-DD), or null. A session is
 * used only when it belongs to the claim's practice and patient; a session
 * that is missing, foreign, or fails to load is logged and treated as no
 * session date. Never throws: a prediction must not fail on this lookup.
 */
export async function loadClaimSessionDate(claim: ClaimForPrediction): Promise<string | null> {
  if (!claim.sessionId) return null;
  try {
    const session = await storage.getTreatmentSession(claim.sessionId);
    if (!session) {
      logger.warn('Denial prediction: linked treatment session not found', { claimId: claim.id, sessionId: claim.sessionId });
      return null;
    }
    const practiceMatches = claim.practiceId == null || session.practiceId === claim.practiceId;
    const patientMatches = claim.patientId == null || session.patientId === claim.patientId;
    if (!practiceMatches || !patientMatches) {
      logger.warn('Denial prediction: linked treatment session does not belong to the claim; ignoring its date', {
        claimId: claim.id,
        sessionId: claim.sessionId,
        claimPracticeId: claim.practiceId,
        sessionPracticeId: session.practiceId,
        claimPatientId: claim.patientId,
        sessionPatientId: session.patientId,
      });
      return null;
    }
    return toCalendarDay(session.sessionDate);
  } catch (error) {
    logger.error('Denial prediction: treatment session lookup failed', {
      claimId: claim.id,
      sessionId: claim.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * A `date` column as YYYY-MM-DD. Drizzle returns it as a string; the pg
 * driver, when it parses one, returns a Date at local midnight, so that case
 * is read with local getters rather than through UTC.
 */
export function toCalendarDay(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}

/** Name of the payer the claim is billed to, from the payer catalog; null when the claim carries none. */
export async function resolveClaimInsuranceName(claim: Pick<ClaimForPrediction, 'id' | 'insuranceId'>): Promise<string | null> {
  if (!claim.insuranceId) return null;
  try {
    const insurance = (await storage.getInsurances()).find((i: any) => i.id === claim.insuranceId);
    return insurance?.name ?? null;
  } catch (error) {
    logger.warn('Denial prediction: payer lookup failed', {
      claimId: claim.id,
      insuranceId: claim.insuranceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** The ClaimInput every predictDenial caller passes: identifiers, the claim's payer and the linked session's date. */
export async function buildPredictDenialClaimInput(claim: ClaimForPrediction): Promise<ClaimInput> {
  const [insuranceName, sessionDate] = await Promise.all([resolveClaimInsuranceName(claim), loadClaimSessionDate(claim)]);
  return {
    id: claim.id,
    claimNumber: claim.claimNumber ?? null,
    totalAmount: claim.totalAmount,
    status: claim.status ?? null,
    insuranceId: claim.insuranceId ?? null,
    insuranceName,
    sessionDate,
    sessionId: claim.sessionId ?? null,
  };
}

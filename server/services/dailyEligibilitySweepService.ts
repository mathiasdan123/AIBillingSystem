/**
 * Daily Eligibility Sweep Service
 *
 * For every patient with an active insurance record AND an appointment in
 * the next N days (default 7), runs a 270/271 eligibility check via Stedi
 * and stages the result in `eligibility_checks`. The practice admin can
 * then review flagged (inactive / unknown / errored) results from the
 * eligibility dashboard before the appointment.
 *
 * Behavior notes:
 * - Per-patient errors are caught + logged; one bad payer does NOT abort the sweep.
 * - Every attempt writes a row to `eligibility_checks`. Coverage status maps
 *   to `status` ('active' | 'inactive' | 'unknown'); per-call success/error
 *   maps to `processingStatus` ('completed' | 'error').
 * - Idempotency: if the same (patient_id, insurance_id) already has a
 *   `completed` row checked today, we skip. The pre-appointment cron
 *   (`preAppointmentEligibilityTask`, every 6h) handles fresher 24h windows.
 * - Writes an `audit_log` row with eventCategory='eligibility_sweep' on
 *   completion so downstream dashboards / a future UI can read the latest
 *   summary without a separate table.
 *
 * Coexistence:
 * - This is the 7-day forward sweep that gives admins lead time. It is
 *   distinct from `preAppointmentEligibilityTask` (6h cadence, ~24h horizon,
 *   creates eligibility alerts) and `eligibilityRefreshTask` (refreshes
 *   stale cached eligibility regardless of appointments).
 */

import { storage } from '../storage';
import logger from './logger';
import {
  checkEligibility,
  stcsForSpecialty,
  extractReturnedStcsFromRawStediResponse,
  isStcDowngrade,
  type EligibilityResponse,
} from './stediService';

export interface SweepOptions {
  practiceId?: number;
  daysAhead?: number;
}

export interface SweepPracticeSummary {
  practiceId: number;
  attempted: number;
  succeeded: number;
  failed: number;
  inactiveFound: number;
  unknownFound: number;
  skipped: number;
  errors: Array<{ patientId: number; payerName?: string | null; error: string }>;
}

export interface SweepRunSummary {
  daysAhead: number;
  startedAt: string;
  finishedAt: string;
  practices: SweepPracticeSummary[];
  totals: {
    attempted: number;
    succeeded: number;
    failed: number;
    inactiveFound: number;
    unknownFound: number;
    skipped: number;
  };
}

// Test seam: lets unit tests swap in a mock checker without mocking the
// network layer of stediService. Production always uses the real export.
export interface SweepDeps {
  checkEligibility: typeof checkEligibility;
  storage: typeof storage;
}

const defaultDeps = (): SweepDeps => ({ checkEligibility, storage });

/**
 * Check whether a (patient, insurance) pair already has a completed
 * eligibility check recorded today. Used to keep the sweep idempotent
 * if it's re-run (cron + manual trigger on the same day).
 */
async function alreadyCheckedToday(
  s: typeof storage,
  patientId: number,
  insuranceId: number | null,
): Promise<boolean> {
  try {
    const recent = await (s as any).getPatientEligibility?.(patientId);
    if (!recent?.checkDate) return false;
    if (recent.processingStatus && recent.processingStatus !== 'completed') return false;
    if (insuranceId != null && recent.insuranceId != null && recent.insuranceId !== insuranceId) {
      return false;
    }
    const checkDate = new Date(recent.checkDate);
    const now = new Date();
    return (
      checkDate.getUTCFullYear() === now.getUTCFullYear() &&
      checkDate.getUTCMonth() === now.getUTCMonth() &&
      checkDate.getUTCDate() === now.getUTCDate()
    );
  } catch {
    return false;
  }
}

async function sweepPractice(
  practiceId: number,
  daysAhead: number,
  deps: SweepDeps,
): Promise<SweepPracticeSummary> {
  const { storage: s } = deps;
  const summary: SweepPracticeSummary = {
    practiceId,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    inactiveFound: 0,
    unknownFound: 0,
    skipped: 0,
    errors: [],
  };

  const practice = await (s as any).getPractice?.(practiceId);
  if (!practice) {
    logger.warn('Daily eligibility sweep: practice not found', { practiceId });
    return summary;
  }

  // Reuse the existing helper — it returns only appointments with an
  // attached patient that itself has an insuranceId set, which IS the
  // "active insurance record" filter the spec calls for.
  const hoursAhead = daysAhead * 24;
  const appointments = await s.getAppointmentsNeedingEligibilityCheck(practiceId, hoursAhead);

  // De-duplicate by patient — one appointment per patient is enough per sweep.
  const seenPatients = new Set<number>();
  const allInsurances: any[] = (await (s as any).getInsurances?.()) || [];

  for (const appointment of appointments) {
    if (!appointment.patientId) continue;
    if (seenPatients.has(appointment.patientId)) continue;
    seenPatients.add(appointment.patientId);

    let patient: any;
    try {
      patient = await s.getPatient(appointment.patientId);
    } catch (err: any) {
      summary.errors.push({ patientId: appointment.patientId, error: err?.message || String(err) });
      summary.failed += 1;
      continue;
    }
    if (!patient || !patient.insuranceId) {
      summary.skipped += 1;
      continue;
    }

    const insurance = patient.insuranceProvider
      ? allInsurances.find(
          (i: any) => i.name?.toLowerCase() === String(patient.insuranceProvider).toLowerCase(),
        )
      : null;

    if (await alreadyCheckedToday(s, patient.id, insurance?.id ?? null)) {
      summary.skipped += 1;
      continue;
    }

    summary.attempted += 1;
    try {
      const sentStcs = stcsForSpecialty(practice.specialty);
      const response: EligibilityResponse = await deps.checkEligibility(
        {
          subscriber: {
            memberId: patient.insuranceId,
            firstName: patient.firstName,
            lastName: patient.lastName,
            dateOfBirth: patient.dateOfBirth || '',
          },
          provider: {
            npi: practice.npi || '',
            organizationName: practice.name,
          },
          payer: {
            id: insurance?.payerCode || patient.insuranceProvider || '',
            name: insurance?.name || patient.insuranceProvider || undefined,
          },
          serviceTypeCodes: sentStcs,
        },
        practiceId,
      );

      const returnedStcs = extractReturnedStcsFromRawStediResponse(response.raw);
      const stcDowngraded = isStcDowngrade(sentStcs, returnedStcs);

      await s.createEligibilityCheck({
        patientId: patient.id,
        practiceId,
        insuranceId: insurance?.id ?? null,
        status: response.status,
        processingStatus: 'completed',
        coverageType: response.planName || null,
        effectiveDate: response.effectiveDate || null,
        terminationDate: response.terminationDate || null,
        copay: response.copay?.primary != null ? String(response.copay.primary) : null,
        deductible:
          response.deductible?.individual != null ? String(response.deductible.individual) : null,
        coinsurance: response.coinsurance ?? null,
        rawResponse: response.raw,
        serviceTypeCodes: sentStcs as any,
        returnedServiceTypeCodes: returnedStcs as any,
        stcDowngraded,
        checkedAt: new Date(),
      } as any);

      summary.succeeded += 1;
      if (response.status === 'inactive') summary.inactiveFound += 1;
      else if (response.status === 'unknown') summary.unknownFound += 1;
    } catch (err: any) {
      const message = err?.message || String(err);
      logger.error('Daily eligibility sweep: per-patient check failed', {
        practiceId,
        patientId: patient.id,
        payer: patient.insuranceProvider,
        error: message,
      });
      summary.failed += 1;
      summary.errors.push({
        patientId: patient.id,
        payerName: patient.insuranceProvider,
        error: message,
      });

      // Record the failure so admins see "we tried, this errored" in the
      // eligibility table — instead of silently dropping the attempt.
      try {
        await s.createEligibilityCheck({
          patientId: patient.id,
          practiceId,
          insuranceId: insurance?.id ?? null,
          status: 'unknown',
          processingStatus: 'error',
          errorMessage: message.slice(0, 1000),
          checkedAt: new Date(),
        } as any);
      } catch (writeErr: any) {
        logger.error('Daily eligibility sweep: failed to record error row', {
          patientId: patient.id,
          error: writeErr?.message || String(writeErr),
        });
      }
    }
  }

  return summary;
}

/**
 * Run the daily eligibility sweep. If `practiceId` is supplied, sweeps only
 * that practice (used by the manual-trigger endpoint). Otherwise iterates
 * every practice (used by the cron).
 */
export async function runDailyEligibilitySweep(
  opts: SweepOptions = {},
  injectedDeps?: Partial<SweepDeps>,
): Promise<SweepRunSummary> {
  const deps: SweepDeps = { ...defaultDeps(), ...(injectedDeps || {}) };
  const daysAhead = opts.daysAhead ?? 7;
  const startedAt = new Date();

  logger.info('Daily eligibility sweep starting', {
    practiceId: opts.practiceId,
    daysAhead,
  });

  let practiceIds: number[];
  if (opts.practiceId != null) {
    practiceIds = [opts.practiceId];
  } else {
    practiceIds = await deps.storage.getAllPracticeIds();
  }

  const practiceSummaries: SweepPracticeSummary[] = [];
  for (const pid of practiceIds) {
    try {
      practiceSummaries.push(await sweepPractice(pid, daysAhead, deps));
    } catch (err: any) {
      logger.error('Daily eligibility sweep: practice-level failure', {
        practiceId: pid,
        error: err?.message || String(err),
      });
      practiceSummaries.push({
        practiceId: pid,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        inactiveFound: 0,
        unknownFound: 0,
        skipped: 0,
        errors: [{ patientId: -1, error: err?.message || String(err) }],
      });
    }
  }

  const totals = practiceSummaries.reduce(
    (acc, p) => {
      acc.attempted += p.attempted;
      acc.succeeded += p.succeeded;
      acc.failed += p.failed;
      acc.inactiveFound += p.inactiveFound;
      acc.unknownFound += p.unknownFound;
      acc.skipped += p.skipped;
      return acc;
    },
    { attempted: 0, succeeded: 0, failed: 0, inactiveFound: 0, unknownFound: 0, skipped: 0 },
  );

  const finishedAt = new Date();
  const result: SweepRunSummary = {
    daysAhead,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    practices: practiceSummaries,
    totals,
  };

  // Stash the summary per-practice so a future dashboard can read "last
  // sweep" without us inventing a new table.
  for (const p of practiceSummaries) {
    try {
      await deps.storage.createAuditLog({
        eventCategory: 'eligibility_sweep',
        eventType: 'sweep_completed',
        resourceType: 'eligibility_sweep',
        resourceId: `practice-${p.practiceId}-${finishedAt.toISOString().slice(0, 10)}`,
        userId: 'system',
        practiceId: p.practiceId,
        details: {
          daysAhead,
          attempted: p.attempted,
          succeeded: p.succeeded,
          failed: p.failed,
          inactiveFound: p.inactiveFound,
          unknownFound: p.unknownFound,
          skipped: p.skipped,
          errorSample: p.errors.slice(0, 5),
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
        },
        success: p.failed === 0,
        ipAddress: '0.0.0.0',
      } as any);
    } catch (auditErr: any) {
      logger.error('Daily eligibility sweep: audit log write failed', {
        practiceId: p.practiceId,
        error: auditErr?.message || String(auditErr),
      });
    }
  }

  logger.info('Daily eligibility sweep completed', {
    daysAhead,
    practicesProcessed: practiceSummaries.length,
    totals,
  });

  return result;
}

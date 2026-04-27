/**
 * Pre-Session Auth Coverage Checker
 *
 * Forward-looking complement to the at-risk-authorizations widget.
 * That widget catches auths LIKELY to lapse soon. This one catches
 * specific upcoming appointments where the patient *currently has no
 * active auth* — or has one but it's already exhausted/expired by the
 * scheduled date. Used by:
 *
 *   - GET /api/appointments/auth-coverage (UI widget + manual checks)
 *   - Daily 7:00 AM cron (preSessionAuthCheck) emailing admins about
 *     tomorrow's appointments needing attention
 *
 * Limitations: appointments don't carry a CPT (CPT is decided at
 * session/claim time), so we only check whether the patient has ANY
 * active auth with units remaining and a date range covering the
 * appointment date. Per-CPT specificity would need richer scheduling
 * data we don't have.
 */

import { db } from '../db';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import {
  appointments,
  patients,
  treatmentAuthorizations,
  type Appointment,
  type TreatmentAuthorization,
} from '@shared/schema';

export type AuthCoverageReason =
  | 'no_active_auth'      // patient has no active auth at all
  | 'expired_by_date'     // auth ends before this appointment
  | 'units_exhausted';    // auth is active but has 0 units left

export interface AppointmentNeedingAuth {
  appointment: {
    id: number;
    patientId: number;
    startTime: Date;
    therapistId: string | null;
    title: string | null;
  };
  patientName: string;
  reason: AuthCoverageReason;
  /** When reason is expired_by_date / units_exhausted, the auth that
   *  almost-but-didn't-quite cover. Null when no_active_auth. */
  nearestAuth?: {
    authorizationNumber: string | null;
    endDate: string | null;
    authorizedUnits: number;
    usedUnits: number;
  } | null;
}

/**
 * Returns appointments in the next `daysAhead` days where the patient
 * does NOT have a usable auth on the scheduled date. Skips cancelled /
 * no-show appointments — they don't need coverage.
 */
export async function getAppointmentsNeedingAuthCoverage(
  practiceId: number,
  daysAhead: number = 7,
): Promise<AppointmentNeedingAuth[]> {
  const now = new Date();
  const horizon = new Date();
  horizon.setDate(now.getDate() + daysAhead);

  // Pull scheduled appointments in the window.
  const upcoming: Appointment[] = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.practiceId, practiceId),
        gte(appointments.startTime, now),
        lte(appointments.startTime, horizon),
      ),
    )
    .orderBy(appointments.startTime);

  // Filter to states that actually need coverage. 'completed' might be
  // stale from a backfill, treat as no-action. 'cancelled'/'no_show' don't
  // need coverage. Anything else (scheduled, confirmed, checked_in) we
  // verify.
  const needsCheck = upcoming.filter((a) => {
    const s = a.status ?? 'scheduled';
    return s !== 'cancelled' && s !== 'no_show' && s !== 'completed';
  });
  if (needsCheck.length === 0) return [];

  const patientIds = Array.from(new Set(needsCheck.map((a) => a.patientId).filter((id): id is number => typeof id === 'number')));
  if (patientIds.length === 0) return [];

  const [patientRows, allAuths] = await Promise.all([
    db
      .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName })
      .from(patients)
      .where(inArray(patients.id, patientIds)),
    db
      .select()
      .from(treatmentAuthorizations)
      .where(
        and(
          eq(treatmentAuthorizations.practiceId, practiceId),
          eq(treatmentAuthorizations.status, 'active'),
          inArray(treatmentAuthorizations.patientId, patientIds),
        ),
      ),
  ]);

  const patientMap = new Map<number, { firstName: string; lastName: string }>(
    patientRows.map((p: any) => [p.id, p]),
  );
  const authsByPatient = new Map<number, TreatmentAuthorization[]>();
  for (const a of allAuths as TreatmentAuthorization[]) {
    if (!authsByPatient.has(a.patientId)) authsByPatient.set(a.patientId, []);
    authsByPatient.get(a.patientId)!.push(a);
  }

  const out: AppointmentNeedingAuth[] = [];
  for (const appt of needsCheck) {
    if (!appt.patientId) continue;
    const patient = patientMap.get(appt.patientId);
    if (!patient) continue;
    const apptDateStr = appt.startTime.toISOString().split('T')[0];
    const auths = authsByPatient.get(appt.patientId) ?? [];

    // Find an auth that covers the appointment's date AND has units left.
    const usable = auths.find((a) => {
      const inRange = (!a.startDate || a.startDate <= apptDateStr) &&
                      (!a.endDate || a.endDate >= apptDateStr);
      const unitsLeft = (a.authorizedUnits ?? 0) > (a.usedUnits ?? 0);
      return inRange && unitsLeft;
    });
    if (usable) continue; // covered, skip

    // Otherwise figure out the most informative reason.
    let reason: AuthCoverageReason;
    let nearestAuth: AppointmentNeedingAuth['nearestAuth'] = null;
    if (auths.length === 0) {
      reason = 'no_active_auth';
    } else {
      // Pick the most recently-ending auth as "nearest". If that one is
      // expired by appointment date → expired_by_date; if not expired but
      // units exhausted → units_exhausted; otherwise (some other reason
      // none matched) call it expired_by_date as the safer label.
      const candidate = auths.reduce((best, a) => {
        const aEnd = a.endDate ?? '';
        const bestEnd = best?.endDate ?? '';
        return aEnd > bestEnd ? a : best;
      }, auths[0]);
      const dateExpired = candidate.endDate && candidate.endDate < apptDateStr;
      const exhausted = (candidate.authorizedUnits ?? 0) <= (candidate.usedUnits ?? 0);
      reason = dateExpired ? 'expired_by_date' : exhausted ? 'units_exhausted' : 'expired_by_date';
      nearestAuth = {
        authorizationNumber: candidate.authorizationNumber ?? null,
        endDate: candidate.endDate ?? null,
        authorizedUnits: candidate.authorizedUnits ?? 0,
        usedUnits: candidate.usedUnits ?? 0,
      };
    }

    out.push({
      appointment: {
        id: appt.id,
        patientId: appt.patientId,
        startTime: appt.startTime,
        therapistId: appt.therapistId ?? null,
        title: appt.title ?? null,
      },
      patientName: `${patient.firstName} ${patient.lastName}`,
      reason,
      nearestAuth,
    });
  }
  return out;
}

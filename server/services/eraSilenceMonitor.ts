/**
 * ERA silence monitor — tells "no remittances yet" apart from "it is broken".
 *
 * This exists because of a specific, repeated failure in this system. The
 * Stedi endpoints in stediService 404'd on every call for months and nothing
 * noticed: the symptom was an absence — no eligibility results, no claim
 * statuses — and an absence looks exactly like "nothing has happened yet".
 * The ERA poller is wide open to the same mistake, and worse, because its
 * envelope shape has never been observed against a live account. If Stedi's
 * response differs from what the client expects, the poller logs and finds
 * nothing, forever, and the practice concludes their payer just hasn't sent
 * anything.
 *
 * So: when a practice is ERA-enrolled with a payer and money is demonstrably
 * moving (claims are being marked paid) but NO remittance has arrived through
 * the poller in SILENCE_DAYS, that is not quiet — that is a fault, and someone
 * is told.
 */
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { claims, payerEnrollments, practices, remittanceAdvice } from '@shared/schema';
import { db } from '../db';
import logger from './logger';

/**
 * How long a practice may be enrolled, paid, and silent before we call it a
 * fault. Long enough that a genuinely quiet week does not page anyone; short
 * enough that a broken integration is caught in days rather than months.
 */
export const SILENCE_DAYS = 10;

export interface SilenceFinding {
  practiceId: number;
  practiceName: string | null;
  enrolledPayers: number;
  claimsPaidInWindow: number;
  daysSinceLastPolledEra: number | null;
}

export interface SilenceReport {
  practicesChecked: number;
  findings: SilenceFinding[];
}

/**
 * Find practices that should be receiving ERAs and are not.
 *
 * The three conditions must hold together. Each alone is unremarkable:
 * enrolment without payments is a new practice; payments without enrolment is
 * the expected pre-enrolment state; silence without either is just quiet.
 */
export async function findSilentEraPractices(now = new Date()): Promise<SilenceReport> {
  const windowStart = new Date(now.getTime() - SILENCE_DAYS * 24 * 60 * 60 * 1000);

  const livePractices = await db
    .select({ id: practices.id, name: practices.name })
    .from(practices)
    .where(eq(practices.sandboxMode, false));

  const findings: SilenceFinding[] = [];

  for (const practice of livePractices) {
    // 1. Enrolled for ERA with at least one payer.
    const [enrolled] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(payerEnrollments)
      .where(
        and(
          eq(payerEnrollments.practiceId, practice.id),
          eq(payerEnrollments.transactionType, 'era'),
          eq(payerEnrollments.status, 'enrolled'),
        ),
      );
    const enrolledPayers = enrolled?.n ?? 0;
    if (enrolledPayers === 0) continue;

    // 2. Money is demonstrably moving.
    const [paid] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(claims)
      .where(
        and(
          eq(claims.practiceId, practice.id),
          eq(claims.status, 'paid'),
          gte(claims.paidAt, windowStart),
        ),
      );
    const claimsPaidInWindow = paid?.n ?? 0;
    if (claimsPaidInWindow === 0) continue;

    // 3. Nothing has arrived through the poller.
    //    stediTransactionId IS NOT NULL is the point: a manual upload does not
    //    prove the automated path works, and the automated path is what is
    //    being monitored.
    const [lastEra] = await db
      .select({ latest: sql<string | null>`MAX(${remittanceAdvice.createdAt})` })
      .from(remittanceAdvice)
      .where(
        and(
          eq(remittanceAdvice.practiceId, practice.id),
          isNotNull(remittanceAdvice.stediTransactionId),
        ),
      );

    const latest = lastEra?.latest ? new Date(lastEra.latest) : null;
    const daysSince = latest
      ? Math.floor((now.getTime() - latest.getTime()) / 86_400_000)
      : null;

    if (latest && latest >= windowStart) continue; // recently received — healthy

    findings.push({
      practiceId: practice.id,
      practiceName: practice.name,
      enrolledPayers,
      claimsPaidInWindow,
      daysSinceLastPolledEra: daysSince,
    });
  }

  return { practicesChecked: livePractices.length, findings };
}

export function describeFinding(f: SilenceFinding): string {
  const never = f.daysSinceLastPolledEra === null;
  return (
    `${f.practiceName ?? `Practice ${f.practiceId}`} is ERA-enrolled with ` +
    `${f.enrolledPayers} payer(s) and had ${f.claimsPaidInWindow} claim(s) paid in the ` +
    `last ${SILENCE_DAYS} days, but ` +
    (never
      ? 'NO remittance has ever arrived through the automated poller.'
      : `the last automated remittance was ${f.daysSinceLastPolledEra} days ago.`) +
    ' Treat this as a broken integration until proven otherwise — check the ERA poll logs ' +
    'for envelope-shape errors rather than assuming the payer has sent nothing.'
  );
}

/** Run the check and log findings as errors. Returns the report. */
export async function runEraSilenceCheck(now = new Date()): Promise<SilenceReport> {
  const report = await findSilentEraPractices(now);

  for (const finding of report.findings) {
    logger.error('ERA silence detected', {
      ...finding,
      summary: describeFinding(finding),
    });
  }

  if (report.findings.length === 0) {
    logger.info('ERA silence check clean', { practicesChecked: report.practicesChecked });
  }

  return report;
}

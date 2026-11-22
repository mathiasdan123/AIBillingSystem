/**
 * The claim population behind the paid rate and the denial rate.
 *
 * The dashboard, the Claims page summary and the Daily Insights 7-day rate all
 * build their figures from this one definition, so the same claims produce the
 * same numbers on every screen.
 *
 * COHORT: "transmitted" claims, meaning claims with evidence that they were
 * sent out at least once:
 *   - the status is one a claim only reaches after it has been sent
 *     (submitted, paid, denied, rejected, appeal), or
 *   - submitted_at or clearinghouse_submitted_at is set.
 * The timestamp test is what keeps a REOPENED claim in the cohort. Reopening a
 * denied or rejected claim returns it to draft for correction, but it keeps the
 * timestamps from when it was first sent, so it does not silently drop out of
 * the denominator while it is being fixed. REJECTED claims are in the cohort
 * too: they were transmitted, and leaving them out would flatter the rates.
 * Claims that never left draft or hold are not in it.
 *
 * RATES are CURRENT-STATUS SNAPSHOTS of that cohort, not outcome histories:
 *   - paid rate   = cohort claims whose status is now "paid"      / cohort
 *   - denial rate = cohort claims whose status is now "denied"    / cohort
 * The data model does not keep a durable record of every past denial (reopening
 * a claim clears its denial reason and moves it back to draft), so a claim that
 * was denied and is now being corrected counts in the denominator but no longer
 * in the denial rate until it is denied again. A rejected claim (front-end
 * rejection that the payer asks to be corrected) is not counted as a denial.
 * Claims still waiting on a payer are in the denominator, so the paid rate is
 * not a final success measure while claims are pending.
 *
 * DEMO ROWS: rows tagged is_demo are excluded everywhere these rates are built
 * (demo data is for navigation practice and must not move a real practice's
 * numbers).
 */
import { eq, sql } from "drizzle-orm";
import { claims } from "@shared/schema";

/** Statuses a claim only reaches after it has been sent. */
export const TRANSMITTED_CLAIM_STATUSES = ['submitted', 'paid', 'denied', 'rejected', 'appeal'] as const;

/** Excludes rows tagged is_demo. */
export const notDemoClaim = () => eq(claims.isDemo, false);

/** True for claims in the transmitted cohort (see the module comment). */
export const transmittedClaim = () =>
  sql`(${claims.status} IN (${sql.join(TRANSMITTED_CLAIM_STATUSES.map((s) => sql`${s}`), sql`, `)}) OR ${claims.submittedAt} IS NOT NULL OR ${claims.clearinghouseSubmittedAt} IS NOT NULL)`;

/**
 * Aggregate columns for the cohort. Each one also excludes is_demo rows itself,
 * so the exclusion holds even in a query that counts every row for other
 * purposes (the Claims page summary); in the dashboard and insights queries it
 * simply repeats the WHERE clause.
 */
export const claimCohortAggregates = () => {
  const inCohort = sql`${claims.isDemo} = false AND ${transmittedClaim()}`;
  return {
    transmitted: sql<number>`COUNT(*) FILTER (WHERE ${inCohort})::int`,
    transmittedPaid: sql<number>`COUNT(*) FILTER (WHERE ${inCohort} AND ${claims.status} = 'paid')::int`,
    transmittedDenied: sql<number>`COUNT(*) FILTER (WHERE ${inCohort} AND ${claims.status} = 'denied')::int`,
  };
};

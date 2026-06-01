/**
 * Biller Cockpit — the "what needs action" worklist, assembled in one query
 * surface so a biller sees every actionable bucket in one screen.
 *
 * Buckets (each: count + a few sample claims to preview):
 *   - held           claims.status = 'held' (failed scrub / auth hold)
 *   - draft          claims.status = 'draft' (not yet submitted)
 *   - atRisk         not-yet-submitted claims the denial predictor flagged high
 *   - deniedNoAppeal claims.status = 'denied' with no appeal row yet
 *   - underpaid      open claim_follow_ups of type 'underpayment'
 *   - aging          submitted claims with no response in 30+ days
 *
 * Read-only aggregation over existing tables — no schema change. Demo claims
 * (is_demo = true) are excluded, consistent with the rest of analytics.
 */

import { claims, appeals, claimFollowUps, patients } from "@shared/schema";
import { db } from "../db";
import { and, eq, sql, desc, lt, isNotNull, notExists } from "drizzle-orm";

export interface CockpitClaimSample {
  id: number;
  claimNumber: string | null;
  patientName: string | null;
  totalAmount: string | null;
  status: string | null;
  createdAt: Date | null;
}

export interface CockpitBucket {
  key: string;
  label: string;
  count: number;
  /** Up to 5 sample claims for preview; full list via drill-down. */
  samples: CockpitClaimSample[];
  /** Where the bucket's "view all" links to. */
  href: string;
}

export interface BillerCockpitResult {
  buckets: CockpitBucket[];
  totalActionable: number;
  generatedAt: string;
}

const NOT_DEMO = eq(claims.isDemo, false);

/** Sample claims for a bucket, newest first, with patient name joined. */
async function sampleClaims(practiceId: number, whereExtra: any, limit = 5): Promise<CockpitClaimSample[]> {
  const rows = await db
    .select({
      id: claims.id,
      claimNumber: claims.claimNumber,
      firstName: patients.firstName,
      lastName: patients.lastName,
      totalAmount: claims.totalAmount,
      status: claims.status,
      createdAt: claims.createdAt,
    })
    .from(claims)
    .leftJoin(patients, eq(claims.patientId, patients.id))
    .where(and(eq(claims.practiceId, practiceId), NOT_DEMO, whereExtra))
    .orderBy(desc(claims.createdAt))
    .limit(limit);
  return rows.map((r: any) => ({
    id: r.id,
    claimNumber: r.claimNumber ?? null,
    patientName: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
    totalAmount: r.totalAmount ?? null,
    status: r.status ?? null,
    createdAt: r.createdAt ?? null,
  }));
}

async function countClaimsWhere(practiceId: number, whereExtra: any): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), NOT_DEMO, whereExtra));
  return Number(row?.n) || 0;
}

export async function getBillerCockpit(practiceId: number): Promise<BillerCockpitResult> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Bucket predicates over the claims table.
  const heldWhere = eq(claims.status, "held");
  const draftWhere = eq(claims.status, "draft");
  const atRiskWhere = and(
    sql`${claims.status} IN ('draft','held')`,
    sql`${claims.denialPrediction}->>'riskLevel' = 'high'`,
  );
  const agingWhere = and(
    eq(claims.status, "submitted"),
    isNotNull(claims.submittedAt),
    lt(claims.submittedAt, thirtyDaysAgo),
  );
  // Denied claims with NO appeal row yet.
  const deniedNoAppealWhere = and(
    eq(claims.status, "denied"),
    notExists(
      db.select({ one: sql`1` }).from(appeals).where(eq(appeals.claimId, claims.id)),
    ),
  );

  // Underpayment bucket comes from claim_follow_ups, not the claims status.
  const [underpaidRow] = await db
    .select({ n: sql<number>`COUNT(DISTINCT ${claimFollowUps.claimId})::int` })
    .from(claimFollowUps)
    .innerJoin(claims, eq(claimFollowUps.claimId, claims.id))
    .where(
      and(
        eq(claimFollowUps.practiceId, practiceId),
        eq(claimFollowUps.followUpType, "underpayment"),
        sql`${claimFollowUps.status} IN ('pending','in_progress')`,
        NOT_DEMO,
      ),
    );
  const underpaidCount = Number(underpaidRow?.n) || 0;

  const [
    heldCount,
    draftCount,
    atRiskCount,
    agingCount,
    deniedNoAppealCount,
    heldSamples,
    atRiskSamples,
    agingSamples,
    deniedSamples,
  ] = await Promise.all([
    countClaimsWhere(practiceId, heldWhere),
    countClaimsWhere(practiceId, draftWhere),
    countClaimsWhere(practiceId, atRiskWhere),
    countClaimsWhere(practiceId, agingWhere),
    countClaimsWhere(practiceId, deniedNoAppealWhere),
    sampleClaims(practiceId, heldWhere),
    sampleClaims(practiceId, atRiskWhere),
    sampleClaims(practiceId, agingWhere),
    sampleClaims(practiceId, deniedNoAppealWhere),
  ]);

  const buckets: CockpitBucket[] = [
    {
      key: "held",
      label: "Held / scrub-failed",
      count: heldCount,
      samples: heldSamples,
      href: "/claims",
    },
    {
      key: "atRisk",
      label: "At compliance risk",
      count: atRiskCount,
      samples: atRiskSamples,
      href: "/claims",
    },
    {
      key: "deniedNoAppeal",
      label: "Denied — needs appeal",
      count: deniedNoAppealCount,
      samples: deniedSamples,
      href: "/appeals",
    },
    {
      key: "underpaid",
      label: "Underpaid — review",
      count: underpaidCount,
      samples: [], // surfaced via the follow-ups queue / appeals drill-down
      href: "/revenue-at-risk",
    },
    {
      key: "aging",
      label: "Aging 30+ days",
      count: agingCount,
      samples: agingSamples,
      href: "/claims",
    },
    {
      key: "draft",
      label: "Draft — needs submission",
      count: draftCount,
      samples: [], // high-volume; drill-down via claims list
      href: "/claims",
    },
  ];

  const totalActionable = buckets.reduce((n, b) => n + b.count, 0);

  return {
    buckets,
    totalActionable,
    generatedAt: now.toISOString(),
  };
}

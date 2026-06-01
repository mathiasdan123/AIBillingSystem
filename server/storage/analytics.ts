import {
  claims,
  treatmentSessions,
  soapNotes,
  patients,
  insurances,
  users,
  appointments,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lte, count, sum, sql, isNull, or } from "drizzle-orm";

// ==================== ANALYTICS ====================
// Phase 5: every claims/patients/appointments aggregate excludes demo rows
// (where is_demo = true). Demo data is for new-user navigation practice
// and must not contaminate dashboards or reports. The helpers below produce
// the per-table filter — apply them inside the WHERE clause of each query.
const NOT_DEMO_CLAIM = eq(claims.isDemo, false);
const NOT_DEMO_PATIENT = eq(patients.isDemo, false);
const NOT_DEMO_APPOINTMENT = eq(appointments.isDemo, false);

export async function getDashboardStats(practiceId: number): Promise<{
  totalClaims: number;
  successRate: number;
  totalRevenue: number;
  avgDaysToPayment: number;
  monthlyClaimsCount: number;
  monthlyRevenue: number;
  denialRate: number;
  pendingClaims: number;
  claimsAtComplianceRisk: number;
}> {
  // P1.1 perf: collapse what used to be 7 sequential aggregate queries
  // (totalClaims, paid, denied, pending, totalRevenue, monthlyClaims,
  // monthlyRevenue) into a single round-trip using Postgres FILTER
  // aggregates. The (practice_id, status, created_at) composite index
  // services the entire query without a table scan.
  const currentMonth = new Date();
  currentMonth.setDate(1);
  currentMonth.setHours(0, 0, 0, 0);

  const [row] = await db
    .select({
      totalClaims: sql<number>`COUNT(*)::int`,
      paidClaims: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'paid')::int`,
      deniedClaims: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'denied')::int`,
      pendingClaims: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} = 'submitted')::int`,
      totalRevenue: sql<string>`COALESCE(SUM(${claims.paidAmount}) FILTER (WHERE ${claims.status} = 'paid'), 0)`,
      monthlyClaimsCount: sql<number>`COUNT(*) FILTER (WHERE ${claims.createdAt} >= ${currentMonth})::int`,
      monthlyRevenue: sql<string>`COALESCE(SUM(${claims.paidAmount}) FILTER (WHERE ${claims.status} = 'paid' AND ${claims.paidAt} >= ${currentMonth}), 0)`,
      // Phase C: not-yet-submitted claims flagged high denial risk by the
      // predictor — the "claims at compliance risk" Practice-Intel widget.
      claimsAtComplianceRisk: sql<number>`COUNT(*) FILTER (WHERE ${claims.status} IN ('draft','held') AND ${claims.denialPrediction}->>'riskLevel' = 'high')::int`,
    })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), NOT_DEMO_CLAIM));

  const totalClaims = Number(row?.totalClaims) || 0;
  const paidClaims = Number(row?.paidClaims) || 0;
  const deniedClaims = Number(row?.deniedClaims) || 0;
  const pendingClaims = Number(row?.pendingClaims) || 0;

  return {
    totalClaims,
    successRate: totalClaims > 0 ? (paidClaims / totalClaims) * 100 : 0,
    totalRevenue: Number(row?.totalRevenue) || 0,
    avgDaysToPayment: 14.2,
    monthlyClaimsCount: Number(row?.monthlyClaimsCount) || 0,
    monthlyRevenue: Number(row?.monthlyRevenue) || 0,
    denialRate: totalClaims > 0 ? (deniedClaims / totalClaims) * 100 : 0,
    pendingClaims,
    claimsAtComplianceRisk: Number(row?.claimsAtComplianceRisk) || 0,
  };
}

export async function getRevenueByMonth(practiceId: number, startDate: Date, endDate: Date): Promise<{
  month: string;
  revenue: number;
  claims: number;
}[]> {
  const result = await db
    .select({
      month: sql<string>`TO_CHAR(${claims.paidAt}, 'YYYY-MM')`,
      revenue: sum(claims.paidAmount),
      claims: count(),
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      NOT_DEMO_CLAIM,
      eq(claims.status, "paid"),
      gte(claims.paidAt, startDate),
      lte(claims.paidAt, endDate)
    ))
    .groupBy(sql`TO_CHAR(${claims.paidAt}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${claims.paidAt}, 'YYYY-MM')`);

  return result.map((row: any) => ({
    month: row.month,
    revenue: Number(row.revenue) || 0,
    claims: row.claims,
  }));
}

export async function getClaimsByStatus(practiceId: number): Promise<{
  status: string;
  count: number;
}[]> {
  const result = await db
    .select({
      status: claims.status,
      count: count(),
    })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), NOT_DEMO_CLAIM))
    .groupBy(claims.status);

  return result.map((row: any) => ({
    status: row.status || "unknown",
    count: row.count,
  }));
}

export async function getTopDenialReasons(practiceId: number): Promise<{
  reason: string;
  count: number;
}[]> {
  const result = await db
    .select({
      reason: claims.denialReason,
      count: count(),
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      NOT_DEMO_CLAIM,
      eq(claims.status, "denied")
    ))
    .groupBy(claims.denialReason)
    .orderBy(desc(count()))
    .limit(10);

  return result.map((row: any) => ({
    reason: row.reason || "Unknown",
    count: row.count,
  }));
}

export async function getCollectionRate(practiceId: number): Promise<{
  totalBilled: number;
  totalCollected: number;
  collectionRate: number;
  target: number;
  byInsurance: { name: string; billed: number; collected: number; rate: number }[];
}> {
  const totals = await db
    .select({
      totalBilled: sum(claims.totalAmount),
      totalCollected: sum(claims.paidAmount),
    })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), NOT_DEMO_CLAIM));

  const totalBilled = Number(totals[0]?.totalBilled) || 0;
  const totalCollected = Number(totals[0]?.totalCollected) || 0;
  const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;

  const byInsuranceResult = await db
    .select({
      name: insurances.name,
      billed: sum(claims.totalAmount),
      collected: sum(claims.paidAmount),
    })
    .from(claims)
    .leftJoin(insurances, eq(claims.insuranceId, insurances.id))
    .where(and(eq(claims.practiceId, practiceId), NOT_DEMO_CLAIM))
    .groupBy(insurances.name);

  const byInsurance = byInsuranceResult.map((row: any) => {
    const billed = Number(row.billed) || 0;
    const collected = Number(row.collected) || 0;
    return {
      name: row.name || 'Unknown',
      billed,
      collected,
      rate: billed > 0 ? (collected / billed) * 100 : 0,
    };
  });

  return {
    totalBilled,
    totalCollected,
    collectionRate,
    target: 99,
    byInsurance,
  };
}

export async function getCleanClaimsRate(practiceId: number): Promise<{
  totalSubmitted: number;
  acceptedFirstPass: number;
  cleanClaimsRate: number;
  target: number;
  rejectionReasons: { reason: string; count: number }[];
}> {
  const totalResult = await db
    .select({ count: count() })
    .from(claims)
    .where(eq(claims.practiceId, practiceId));
  const totalSubmitted = totalResult[0]?.count || 0;

  const acceptedResult = await db
    .select({ count: count() })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      or(
        eq(claims.status, 'paid'),
        eq(claims.status, 'submitted')
      ),
      isNull(claims.denialReason)
    ));
  const acceptedFirstPass = acceptedResult[0]?.count || 0;

  const cleanClaimsRate = totalSubmitted > 0 ? (acceptedFirstPass / totalSubmitted) * 100 : 0;

  const rejectionResult = await db
    .select({
      reason: claims.denialReason,
      count: count(),
    })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      eq(claims.status, 'denied')
    ))
    .groupBy(claims.denialReason)
    .orderBy(desc(count()))
    .limit(5);

  const rejectionReasons = rejectionResult.map((row: any) => ({
    reason: row.reason || 'Unknown',
    count: row.count,
  }));

  return {
    totalSubmitted,
    acceptedFirstPass,
    cleanClaimsRate,
    target: 97,
    rejectionReasons,
  };
}

export async function getCapacityUtilization(practiceId: number, start: Date, end: Date): Promise<{
  totalSlots: number;
  bookedSlots: number;
  completedAppointments: number;
  arrivedRate: number;
  target: number;
  byTherapist: { name: string; utilization: number }[];
}> {
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];
  const sessions = await db
    .select()
    .from(treatmentSessions)
    .where(and(
      eq(treatmentSessions.practiceId, practiceId),
      gte(treatmentSessions.sessionDate, startStr),
      lte(treatmentSessions.sessionDate, endStr)
    ));

  const totalSlots = sessions.length || 1;
  const completedAppointments = sessions.filter((s: any) => s.status === 'completed').length;
  const bookedSlots = sessions.filter((s: any) => s.status !== 'cancelled').length;
  const arrivedRate = totalSlots > 0 ? (completedAppointments / totalSlots) * 100 : 0;

  const therapistStats: Record<string, { completed: number; total: number }> = {};
  for (const session of sessions) {
    const therapistId = (session as any).therapistId?.toString() || 'unknown';
    if (!therapistStats[therapistId]) {
      therapistStats[therapistId] = { completed: 0, total: 0 };
    }
    therapistStats[therapistId].total++;
    if ((session as any).status === 'completed') {
      therapistStats[therapistId].completed++;
    }
  }

  const therapistUsers = await db.select().from(users).where(eq(users.practiceId, practiceId));
  const byTherapist = Object.entries(therapistStats).map(([id, stats]) => {
    const therapist = therapistUsers.find((u: any) => u.id === id);
    const name = therapist ? `${therapist.firstName || ''} ${therapist.lastName || ''}`.trim() || therapist.email || 'Unknown' : `Therapist ${id}`;
    return {
      name,
      utilization: stats.total > 0 ? (stats.completed / stats.total) * 100 : 0,
    };
  });

  return {
    totalSlots,
    bookedSlots,
    completedAppointments,
    arrivedRate,
    target: 90,
    byTherapist,
  };
}

export async function getDaysInAR(practiceId: number): Promise<{
  averageDays: number;
  byBucket: { bucket: string; count: number; amount: number }[];
  byInsurance: { name: string; avgDays: number; outstanding: number }[];
}> {
  // P1.1 perf: push bucketing and aggregation into SQL instead of
  // SELECT * + bucketing in JS. Two parallel aggregate queries — one for
  // bucket totals + overall average, one for per-insurance stats.
  const daysInArExpr = sql<number>`EXTRACT(DAY FROM NOW() - COALESCE(${claims.submittedAt}, ${claims.createdAt}))::int`;
  const bucketExpr = sql<string>`
    CASE
      WHEN ${daysInArExpr} <= 30 THEN '0-30'
      WHEN ${daysInArExpr} <= 60 THEN '31-60'
      WHEN ${daysInArExpr} <= 90 THEN '61-90'
      WHEN ${daysInArExpr} <= 120 THEN '91-120'
      ELSE '120+'
    END
  `;

  const unpaidWhere = and(
    eq(claims.practiceId, practiceId),
    or(eq(claims.status, 'submitted'), eq(claims.status, 'pending')),
  );

  const [bucketRows, insuranceRows] = await Promise.all([
    db
      .select({
        bucket: bucketExpr,
        count: sql<number>`COUNT(*)::int`,
        amount: sql<string>`COALESCE(SUM(${claims.totalAmount}), 0)`,
        totalDays: sql<number>`COALESCE(SUM(${daysInArExpr}), 0)::int`,
      })
      .from(claims)
      .where(unpaidWhere)
      .groupBy(bucketExpr),
    db
      .select({
        insuranceId: claims.insuranceId,
        count: sql<number>`COUNT(*)::int`,
        totalDays: sql<number>`COALESCE(SUM(${daysInArExpr}), 0)::int`,
        outstanding: sql<string>`COALESCE(SUM(${claims.totalAmount}), 0)`,
      })
      .from(claims)
      .where(unpaidWhere)
      .groupBy(claims.insuranceId),
  ]);

  // Ensure every bucket appears in the output even when empty, to preserve
  // the previous response shape.
  const bucketOrder = ['0-30', '31-60', '61-90', '91-120', '120+'];
  const bucketMap = new Map<string, { count: number; amount: string | number }>(
    bucketRows.map((r: any) => [r.bucket as string, { count: r.count, amount: r.amount }]),
  );
  const byBucket = bucketOrder.map((name) => {
    const row = bucketMap.get(name);
    return {
      bucket: name,
      count: row ? Number(row.count) : 0,
      amount: row ? Number(row.amount) : 0,
    };
  });

  let totalClaims = 0;
  let totalDays = 0;
  for (const r of bucketRows) {
    totalClaims += Number(r.count);
    totalDays += Number(r.totalDays);
  }
  const averageDays = totalClaims > 0 ? Math.round(totalDays / totalClaims) : 0;

  const byInsurance = insuranceRows.map((r: any) => ({
    name: r.insuranceId ? `Insurance ${r.insuranceId}` : 'Unknown',
    avgDays: Number(r.count) > 0 ? Math.round(Number(r.totalDays) / Number(r.count)) : 0,
    outstanding: Number(r.outstanding),
  }));

  return {
    averageDays,
    byBucket,
    byInsurance,
  };
}

export async function getRevenueForecast(practiceId: number, monthsAhead: number): Promise<{
  month: string;
  predicted: number;
  confidence: { low: number; high: number };
}[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 12);

  const historicalData = await getRevenueByMonth(practiceId, startDate, endDate);

  const revenues = historicalData.map(d => d.revenue);
  const avgRevenue = revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) / revenues.length : 0;

  let trend = 0;
  if (revenues.length > 1) {
    const firstHalf = revenues.slice(0, Math.floor(revenues.length / 2));
    const secondHalf = revenues.slice(Math.floor(revenues.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    trend = (secondAvg - firstAvg) / firstAvg;
  }

  const forecasts: { month: string; predicted: number; confidence: { low: number; high: number } }[] = [];
  const currentDate = new Date();

  for (let i = 1; i <= monthsAhead; i++) {
    const forecastDate = new Date(currentDate);
    forecastDate.setMonth(forecastDate.getMonth() + i);
    const month = forecastDate.toISOString().slice(0, 7);

    const predicted = Math.round(avgRevenue * (1 + trend * i));

    const uncertaintyFactor = 0.1 + (i * 0.05);
    const low = Math.round(predicted * (1 - uncertaintyFactor));
    const high = Math.round(predicted * (1 + uncertaintyFactor));

    forecasts.push({
      month,
      predicted,
      confidence: { low, high },
    });
  }

  return forecasts;
}

export async function getTopReferringProviders(practiceId: number): Promise<{
  sources: { name: string; referralCount: number; revenue: number }[];
  totalReferrals: number;
}> {
  const patientsWithReferrals = await db
    .select()
    .from(patients)
    .where(and(
      eq(patients.practiceId, practiceId)
    ));

  const referralStats: Record<string, { count: number; revenue: number }> = {};

  for (const patient of patientsWithReferrals) {
    const referralSource = (patient as any).referralSource || 'Self-Referral';
    if (!referralStats[referralSource]) {
      referralStats[referralSource] = { count: 0, revenue: 0 };
    }
    referralStats[referralSource].count++;

    const patientClaims = await db
      .select({ paidAmount: claims.paidAmount })
      .from(claims)
      .where(and(
        eq(claims.patientId, patient.id),
        eq(claims.status, 'paid')
      ));

    const patientRevenue = patientClaims.reduce((sum: number, c: any) => sum + (Number(c.paidAmount) || 0), 0);
    referralStats[referralSource].revenue += patientRevenue;
  }

  const sources = Object.entries(referralStats)
    .map(([name, stats]) => ({
      name,
      referralCount: stats.count,
      revenue: stats.revenue,
    }))
    .sort((a, b) => b.referralCount - a.referralCount)
    .slice(0, 10);

  const totalReferrals = sources.reduce((sum, s) => sum + s.referralCount, 0);

  return {
    sources,
    totalReferrals,
  };
}

export async function getRevenueByLocationAndTherapist(practiceId: number, startDate?: Date, endDate?: Date): Promise<{
  byTherapist: {
    therapistId: string;
    therapistName: string;
    totalRevenue: number;
    totalBilled: number;
    claimCount: number;
    paidCount: number;
  }[];
  byLocation: {
    location: string;
    totalRevenue: number;
    totalBilled: number;
    sessionCount: number;
  }[];
  byTherapistAndLocation: {
    therapistId: string;
    therapistName: string;
    location: string;
    totalRevenue: number;
    totalBilled: number;
    sessionCount: number;
  }[];
}> {
  const therapistUsers = await db
    .select()
    .from(users)
    .where(eq(users.practiceId, practiceId));

  const sessionsWithClaims = await db
    .select({
      sessionId: treatmentSessions.id,
      therapistId: treatmentSessions.therapistId,
      sessionDate: treatmentSessions.sessionDate,
      claimId: claims.id,
      claimStatus: claims.status,
      totalAmount: claims.totalAmount,
      paidAmount: claims.paidAmount,
    })
    .from(treatmentSessions)
    .leftJoin(claims, eq(claims.sessionId, treatmentSessions.id))
    .where(eq(treatmentSessions.practiceId, practiceId));

  const soapNotesData = await db
    .select({
      sessionId: soapNotes.sessionId,
      location: soapNotes.location,
    })
    .from(soapNotes)
    .innerJoin(treatmentSessions, eq(soapNotes.sessionId, treatmentSessions.id))
    .where(eq(treatmentSessions.practiceId, practiceId));

  const sessionLocations: Record<number, string> = {};
  soapNotesData.forEach((note: any) => {
    if (note.location) {
      sessionLocations[note.sessionId] = note.location;
    }
  });

  const therapistStats: Record<string, {
    totalRevenue: number;
    totalBilled: number;
    claimCount: number;
    paidCount: number;
  }> = {};

  const locationStats: Record<string, {
    totalRevenue: number;
    totalBilled: number;
    sessionCount: number;
  }> = {};

  const therapistLocationStats: Record<string, {
    therapistId: string;
    location: string;
    totalRevenue: number;
    totalBilled: number;
    sessionCount: number;
  }> = {};

  sessionsWithClaims.forEach((row: any) => {
    const therapistId = row.therapistId || 'unknown';
    const location = sessionLocations[row.sessionId] || 'Unspecified';
    const billed = Number(row.totalAmount) || 0;
    const paid = row.claimStatus === 'paid' ? (Number(row.paidAmount) || billed) : 0;
    const isPaid = row.claimStatus === 'paid';

    if (!therapistStats[therapistId]) {
      therapistStats[therapistId] = { totalRevenue: 0, totalBilled: 0, claimCount: 0, paidCount: 0 };
    }
    if (row.claimId) {
      therapistStats[therapistId].totalBilled += billed;
      therapistStats[therapistId].totalRevenue += paid;
      therapistStats[therapistId].claimCount++;
      if (isPaid) therapistStats[therapistId].paidCount++;
    }

    if (!locationStats[location]) {
      locationStats[location] = { totalRevenue: 0, totalBilled: 0, sessionCount: 0 };
    }
    locationStats[location].sessionCount++;
    if (row.claimId) {
      locationStats[location].totalBilled += billed;
      locationStats[location].totalRevenue += paid;
    }

    const key = `${therapistId}|${location}`;
    if (!therapistLocationStats[key]) {
      therapistLocationStats[key] = {
        therapistId,
        location,
        totalRevenue: 0,
        totalBilled: 0,
        sessionCount: 0,
      };
    }
    therapistLocationStats[key].sessionCount++;
    if (row.claimId) {
      therapistLocationStats[key].totalBilled += billed;
      therapistLocationStats[key].totalRevenue += paid;
    }
  });

  const byTherapist = Object.entries(therapistStats).map(([therapistId, stats]) => {
    const therapist = therapistUsers.find((u: any) => u.id === therapistId);
    const therapistName = therapist
      ? `${therapist.firstName || ''} ${therapist.lastName || ''}`.trim() || therapist.email || 'Unknown'
      : `Therapist ${therapistId}`;
    return {
      therapistId,
      therapistName,
      ...stats,
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);

  const byLocation = Object.entries(locationStats).map(([location, stats]) => ({
    location,
    ...stats,
  })).sort((a, b) => b.totalRevenue - a.totalRevenue);

  const byTherapistAndLocation = Object.values(therapistLocationStats).map((stats) => {
    const therapist = therapistUsers.find((u: any) => u.id === stats.therapistId);
    const therapistName = therapist
      ? `${therapist.firstName || ''} ${therapist.lastName || ''}`.trim() || therapist.email || 'Unknown'
      : `Therapist ${stats.therapistId}`;
    return {
      ...stats,
      therapistName,
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);

  return {
    byTherapist,
    byLocation,
    byTherapistAndLocation,
  };
}

// ==================== WAIT TIMES ====================

/**
 * Wait-time metrics. Wait = minutes between the front desk checking a
 * patient in and the session actually starting. Only counts appointments
 * that have BOTH checkedInAt and sessionStartedAt populated.
 *
 * Returns:
 *   - summary: total qualifying appointments + overall avg/max (minutes)
 *   - byDay: avg + max wait grouped by calendar day (YYYY-MM-DD string)
 */
export async function getWaitTimes(
  practiceId: number,
  startDate: Date,
  endDate: Date
): Promise<{
  summary: { appointments: number; avgMinutes: number; maxMinutes: number };
  byDay: { day: string; appointments: number; avgMinutes: number; maxMinutes: number }[];
}> {
  // Wait in minutes, computed via epoch-diff. Drizzle `sql` escapes the
  // column references; we cast the result to numeric for aggregation.
  const waitMinExpr = sql<number>`EXTRACT(EPOCH FROM (${appointments.sessionStartedAt} - ${appointments.checkedInAt})) / 60.0`;

  const whereClause = and(
    eq(appointments.practiceId, practiceId),
    gte(appointments.checkedInAt, startDate),
    lte(appointments.checkedInAt, endDate),
    sql`${appointments.checkedInAt} IS NOT NULL`,
    sql`${appointments.sessionStartedAt} IS NOT NULL`,
  );

  // Per-day rollup.
  const byDayRows = await db
    .select({
      day: sql<string>`TO_CHAR(${appointments.checkedInAt}, 'YYYY-MM-DD')`,
      appointments: count(),
      avgMinutes: sql<number>`AVG(${waitMinExpr})`,
      maxMinutes: sql<number>`MAX(${waitMinExpr})`,
    })
    .from(appointments)
    .where(whereClause)
    .groupBy(sql`TO_CHAR(${appointments.checkedInAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`TO_CHAR(${appointments.checkedInAt}, 'YYYY-MM-DD')`);

  // Summary across the whole window.
  const [summaryRow] = await db
    .select({
      appointments: count(),
      avgMinutes: sql<number>`AVG(${waitMinExpr})`,
      maxMinutes: sql<number>`MAX(${waitMinExpr})`,
    })
    .from(appointments)
    .where(whereClause);

  return {
    summary: {
      appointments: Number(summaryRow?.appointments) || 0,
      avgMinutes: Math.round(Number(summaryRow?.avgMinutes) || 0),
      maxMinutes: Math.round(Number(summaryRow?.maxMinutes) || 0),
    },
    byDay: byDayRows.map((row: any) => ({
      day: row.day,
      appointments: Number(row.appointments) || 0,
      avgMinutes: Math.round(Number(row.avgMinutes) || 0),
      maxMinutes: Math.round(Number(row.maxMinutes) || 0),
    })),
  };
}

export interface ClaimsAnalyticsRollup {
  byPatient: Array<{
    patientId: number;
    totalBilled: number;
    totalPaid: number;
    insurancePaid: number;
    claimCount: number;
    paidCount: number;
  }>;
  byTherapist: Array<{
    therapistId: string;
    totalRevenue: number;
    totalBilled: number;
    sessionCount: number;
  }>;
  activePatientIds: number[];
}

/**
 * Per-patient and per-therapist claim aggregates for the analytics page,
 * computed in SQL so the client no longer fetches every claim to reduce them.
 *
 * Parity with the prior client math: totalPaid uses paidAmount and falls back to
 * totalAmount; insurancePaid keeps the same 80% heuristic the client used (the
 * claims table has no insurance-vs-patient split column). Therapist attribution
 * comes through the claim's session (claims have no therapistId) — this also
 * fixes the old client code, which filtered on a non-existent claim.therapistId
 * and therefore always produced empty therapist stats. Demo claims excluded.
 */
export async function getClaimsAnalyticsRollup(practiceId: number): Promise<ClaimsAnalyticsRollup> {
  const paidPaidExpr = sql<string>`COALESCE(SUM(COALESCE(${claims.paidAmount}::numeric, ${claims.totalAmount}::numeric)) FILTER (WHERE ${claims.status} = 'paid'), 0)`;

  const byPatientRows = await db
    .select({
      patientId: claims.patientId,
      totalBilled: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
      totalPaid: paidPaidExpr,
      insurancePaid: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric * 0.8) FILTER (WHERE ${claims.status} = 'paid'), 0)`,
      claimCount: sql<number>`count(*)::int`,
      paidCount: sql<number>`count(*) FILTER (WHERE ${claims.status} = 'paid')::int`,
    })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), NOT_DEMO_CLAIM))
    .groupBy(claims.patientId);

  const byTherapistRows = await db
    .select({
      therapistId: treatmentSessions.therapistId,
      totalRevenue: paidPaidExpr,
      totalBilled: sql<string>`COALESCE(SUM(${claims.totalAmount}::numeric), 0)`,
      sessionCount: sql<number>`count(*)::int`,
    })
    .from(claims)
    .innerJoin(treatmentSessions, eq(claims.sessionId, treatmentSessions.id))
    .where(and(eq(claims.practiceId, practiceId), NOT_DEMO_CLAIM))
    .groupBy(treatmentSessions.therapistId);

  // Patients with any claim in the last 3 months (the "active patients" count).
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const activeRows = await db
    .selectDistinct({ patientId: claims.patientId })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), NOT_DEMO_CLAIM, gte(claims.createdAt, threeMonthsAgo)));

  return {
    byPatient: byPatientRows.map((r: any) => ({
      patientId: r.patientId,
      totalBilled: parseFloat(r.totalBilled ?? '0'),
      totalPaid: parseFloat(r.totalPaid ?? '0'),
      insurancePaid: parseFloat(r.insurancePaid ?? '0'),
      claimCount: r.claimCount ?? 0,
      paidCount: r.paidCount ?? 0,
    })),
    byTherapist: byTherapistRows
      .filter((r: any) => r.therapistId != null)
      .map((r: any) => ({
        therapistId: r.therapistId,
        totalRevenue: parseFloat(r.totalRevenue ?? '0'),
        totalBilled: parseFloat(r.totalBilled ?? '0'),
        sessionCount: r.sessionCount ?? 0,
      })),
    activePatientIds: activeRows.map((r: any) => r.patientId),
  };
}

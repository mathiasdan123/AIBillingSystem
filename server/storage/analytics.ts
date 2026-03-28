import {
  claims,
  treatmentSessions,
  soapNotes,
  patients,
  insurances,
  users,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lte, count, sum, sql, isNull, or } from "drizzle-orm";

// ==================== ANALYTICS ====================

export async function getDashboardStats(practiceId: number): Promise<{
  totalClaims: number;
  successRate: number;
  totalRevenue: number;
  avgDaysToPayment: number;
  monthlyClaimsCount: number;
  monthlyRevenue: number;
  denialRate: number;
  pendingClaims: number;
}> {
  const currentMonth = new Date();
  currentMonth.setDate(1);

  const [totalClaimsResult] = await db
    .select({ count: count() })
    .from(claims)
    .where(eq(claims.practiceId, practiceId));

  const [paidClaimsResult] = await db
    .select({ count: count() })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), eq(claims.status, "paid")));

  const [deniedClaimsResult] = await db
    .select({ count: count() })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), eq(claims.status, "denied")));

  const [pendingClaimsResult] = await db
    .select({ count: count() })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), eq(claims.status, "submitted")));

  const [totalRevenueResult] = await db
    .select({ total: sum(claims.paidAmount) })
    .from(claims)
    .where(and(eq(claims.practiceId, practiceId), eq(claims.status, "paid")));

  const [monthlyClaimsResult] = await db
    .select({ count: count() })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      gte(claims.createdAt, currentMonth)
    ));

  const [monthlyRevenueResult] = await db
    .select({ total: sum(claims.paidAmount) })
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      eq(claims.status, "paid"),
      gte(claims.paidAt, currentMonth)
    ));

  const totalClaims = totalClaimsResult.count;
  const paidClaims = paidClaimsResult.count;
  const deniedClaims = deniedClaimsResult.count;
  const pendingClaims = pendingClaimsResult.count;

  return {
    totalClaims,
    successRate: totalClaims > 0 ? (paidClaims / totalClaims) * 100 : 0,
    totalRevenue: Number(totalRevenueResult.total) || 0,
    avgDaysToPayment: 14.2,
    monthlyClaimsCount: monthlyClaimsResult.count,
    monthlyRevenue: Number(monthlyRevenueResult.total) || 0,
    denialRate: totalClaims > 0 ? (deniedClaims / totalClaims) * 100 : 0,
    pendingClaims,
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
    .where(eq(claims.practiceId, practiceId))
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
    .where(eq(claims.practiceId, practiceId));

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
    .where(eq(claims.practiceId, practiceId))
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
  const now = new Date();

  const unpaidClaims = await db
    .select()
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      or(
        eq(claims.status, 'submitted'),
        eq(claims.status, 'pending')
      )
    ));

  const claimsWithDays = unpaidClaims.map((claim: any) => {
    const submitDate = new Date(claim.submittedAt || claim.createdAt);
    const days = Math.floor((now.getTime() - submitDate.getTime()) / (1000 * 60 * 60 * 24));
    return { ...claim, daysInAR: days };
  });

  const totalDays = claimsWithDays.reduce((sum: number, c: any) => sum + c.daysInAR, 0);
  const averageDays = claimsWithDays.length > 0 ? Math.round(totalDays / claimsWithDays.length) : 0;

  const buckets: Record<string, { count: number; amount: number }> = {
    '0-30': { count: 0, amount: 0 },
    '31-60': { count: 0, amount: 0 },
    '61-90': { count: 0, amount: 0 },
    '91-120': { count: 0, amount: 0 },
    '120+': { count: 0, amount: 0 },
  };

  claimsWithDays.forEach((claim: any) => {
    const amount = Number(claim.totalAmount) || 0;
    if (claim.daysInAR <= 30) {
      buckets['0-30'].count++;
      buckets['0-30'].amount += amount;
    } else if (claim.daysInAR <= 60) {
      buckets['31-60'].count++;
      buckets['31-60'].amount += amount;
    } else if (claim.daysInAR <= 90) {
      buckets['61-90'].count++;
      buckets['61-90'].amount += amount;
    } else if (claim.daysInAR <= 120) {
      buckets['91-120'].count++;
      buckets['91-120'].amount += amount;
    } else {
      buckets['120+'].count++;
      buckets['120+'].amount += amount;
    }
  });

  const byBucket = Object.entries(buckets).map(([bucket, data]) => ({
    bucket,
    count: data.count,
    amount: data.amount,
  }));

  const insuranceStats: Record<string, { totalDays: number; count: number; outstanding: number }> = {};
  claimsWithDays.forEach((claim: any) => {
    const insurance = claim.insuranceId ? `Insurance ${claim.insuranceId}` : 'Unknown';
    if (!insuranceStats[insurance]) {
      insuranceStats[insurance] = { totalDays: 0, count: 0, outstanding: 0 };
    }
    insuranceStats[insurance].totalDays += claim.daysInAR;
    insuranceStats[insurance].count++;
    insuranceStats[insurance].outstanding += Number(claim.totalAmount) || 0;
  });

  const byInsurance = Object.entries(insuranceStats).map(([name, stats]) => ({
    name,
    avgDays: stats.count > 0 ? Math.round(stats.totalDays / stats.count) : 0,
    outstanding: stats.outstanding,
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

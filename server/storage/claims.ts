import {
  claims,
  claimLineItems,
  expenses,
  payments,
  cptCodes,
  icd10Codes,
  insurances,
  cptCodeMappings,
  reimbursementOptimizations,
  insuranceRates,
  cptCodeEquivalencies,
  appeals,
  patients,
  claimOutcomes,
  type Claim,
  type InsertClaim,
  type ClaimLineItem,
  type InsertClaimLineItem,
  type Expense,
  type InsertExpense,
  type Payment,
  type InsertPayment,
  type CptCode,
  type Icd10Code,
  type Insurance,
  type CptCodeMapping,
  type ReimbursementOptimization,
  type InsertReimbursementOptimization,
  type InsuranceRate,
  type InsertInsuranceRate,
  type CptCodeEquivalency,
  type InsertCptCodeEquivalency,
  type Appeal,
  type InsertAppeal,
  type Patient,
  type ClaimOutcome,
  type InsertClaimOutcome,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, or, gte, lte, isNull, inArray, sql, count, sum } from "drizzle-orm";
import { cache, CacheKeys } from "../services/cacheService";

// ==================== CLAIMS ====================

export async function createClaim(claim: InsertClaim): Promise<Claim> {
  const [newClaim] = await db
    .insert(claims)
    .values(claim)
    .returning();
  if (claim.practiceId) {
    await cache.delPattern(CacheKeys.analyticsPattern(claim.practiceId));
  }
  return newClaim;
}

export async function getClaims(practiceId: number, opts?: { limit?: number; offset?: number }): Promise<Claim[]> {
  let query = db
    .select()
    .from(claims)
    .where(eq(claims.practiceId, practiceId))
    .orderBy(desc(claims.createdAt))
    .$dynamic();
  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset) query = query.offset(opts.offset);
  return await query;
}

export async function countClaims(practiceId: number): Promise<number> {
  const [result] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(claims)
    .where(eq(claims.practiceId, practiceId));
  return result?.total ?? 0;
}

export async function getClaim(id: number): Promise<Claim | undefined> {
  const [claim] = await db
    .select()
    .from(claims)
    .where(eq(claims.id, id));
  return claim;
}

export async function getClaimsByIds(ids: number[]): Promise<Map<number, Claim>> {
  const result = new Map<number, Claim>();
  if (ids.length === 0) return result;

  const rows = await db
    .select()
    .from(claims)
    .where(inArray(claims.id, ids));

  for (const row of rows) {
    result.set(row.id, row);
  }

  return result;
}

export async function updateClaim(id: number, claim: Partial<InsertClaim>): Promise<Claim> {
  const [updatedClaim] = await db
    .update(claims)
    .set({ ...claim, updatedAt: new Date() })
    .where(eq(claims.id, id))
    .returning();
  if (updatedClaim.practiceId) {
    await cache.delPattern(CacheKeys.analyticsPattern(updatedClaim.practiceId));
  }
  return updatedClaim;
}

// ==================== CLAIM LINE ITEMS ====================

export async function createClaimLineItem(lineItem: InsertClaimLineItem): Promise<ClaimLineItem> {
  const [newLineItem] = await db
    .insert(claimLineItems)
    .values(lineItem)
    .returning();
  return newLineItem;
}

export async function getClaimLineItems(claimId: number): Promise<ClaimLineItem[]> {
  return await db
    .select()
    .from(claimLineItems)
    .where(eq(claimLineItems.claimId, claimId));
}

export async function deleteClaimLineItems(claimId: number): Promise<void> {
  await db
    .delete(claimLineItems)
    .where(eq(claimLineItems.claimId, claimId));
}

// ==================== EXPENSES ====================

export async function createExpense(expense: InsertExpense): Promise<Expense> {
  const [newExpense] = await db
    .insert(expenses)
    .values(expense)
    .returning();
  return newExpense;
}

export async function getExpenses(practiceId: number): Promise<Expense[]> {
  return await db
    .select()
    .from(expenses)
    .where(eq(expenses.practiceId, practiceId))
    .orderBy(desc(expenses.expenseDate));
}

export async function getExpense(id: number): Promise<Expense | undefined> {
  const [expense] = await db
    .select()
    .from(expenses)
    .where(eq(expenses.id, id));
  return expense;
}

export async function updateExpense(id: number, expense: Partial<InsertExpense>): Promise<Expense> {
  const [updatedExpense] = await db
    .update(expenses)
    .set({ ...expense, updatedAt: new Date() })
    .where(eq(expenses.id, id))
    .returning();
  return updatedExpense;
}

// ==================== PAYMENTS ====================

export async function createPayment(payment: InsertPayment): Promise<Payment> {
  const [newPayment] = await db
    .insert(payments)
    .values(payment)
    .returning();
  return newPayment;
}

export async function getPayments(practiceId: number): Promise<Payment[]> {
  return await db
    .select()
    .from(payments)
    .where(eq(payments.practiceId, practiceId))
    .orderBy(desc(payments.paymentDate));
}

// ==================== CODES ====================

export async function getCptCodes(): Promise<CptCode[]> {
  return await db
    .select()
    .from(cptCodes)
    .where(eq(cptCodes.isActive, true))
    .orderBy(cptCodes.code);
}

export async function getAllCptCodes(): Promise<CptCode[]> {
  return getCptCodes();
}

export async function getIcd10Codes(): Promise<Icd10Code[]> {
  return await db
    .select()
    .from(icd10Codes)
    .where(eq(icd10Codes.isActive, true))
    .orderBy(icd10Codes.code);
}

export async function getInsurances(): Promise<Insurance[]> {
  return await db
    .select()
    .from(insurances)
    .where(eq(insurances.isActive, true))
    .orderBy(insurances.name);
}

export async function getInsurance(id: number): Promise<Insurance | undefined> {
  const [insurance] = await db
    .select()
    .from(insurances)
    .where(eq(insurances.id, id));
  return insurance;
}

export async function getCptCodeMappings(insuranceId?: number): Promise<CptCodeMapping[]> {
  if (insuranceId) {
    return await db.select().from(cptCodeMappings)
      .where(and(eq(cptCodeMappings.insuranceId, insuranceId), eq(cptCodeMappings.isActive, true)));
  }
  return await db.select().from(cptCodeMappings).where(eq(cptCodeMappings.isActive, true));
}

export async function createCptCodeMapping(mapping: any): Promise<CptCodeMapping> {
  const [created] = await db.insert(cptCodeMappings).values(mapping).returning();
  return created;
}

// ==================== APPEALS / OPTIMIZATIONS ====================

export async function createReimbursementOptimization(optimization: InsertReimbursementOptimization): Promise<ReimbursementOptimization> {
  const [created] = await db
    .insert(reimbursementOptimizations)
    .values(optimization)
    .returning();
  return created;
}

export async function getClaimAppeals(claimId: number): Promise<ReimbursementOptimization[]> {
  return await db
    .select()
    .from(reimbursementOptimizations)
    .where(and(
      eq(reimbursementOptimizations.claimId, claimId),
      eq(reimbursementOptimizations.optimizationType, 'appeal')
    ))
    .orderBy(desc(reimbursementOptimizations.createdAt));
}

export async function updateAppealStatus(id: number, status: string, completedAt?: Date): Promise<ReimbursementOptimization | undefined> {
  const [updated] = await db
    .update(reimbursementOptimizations)
    .set({ status, completedAt })
    .where(eq(reimbursementOptimizations.id, id))
    .returning();
  return updated;
}

export async function getDeniedClaimsByDateRange(practiceId: number, startDate: Date, endDate: Date): Promise<Claim[]> {
  return await db
    .select()
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      eq(claims.status, "denied"),
      gte(claims.updatedAt, startDate),
      lte(claims.updatedAt, endDate)
    ))
    .orderBy(desc(claims.updatedAt));
}

export async function getDeniedClaimsWithDetails(practiceId: number, startDate: Date, endDate: Date): Promise<{
  claim: Claim;
  patient: Patient | null;
  appeal: ReimbursementOptimization | null;
}[]> {
  const deniedClaims = await getDeniedClaimsByDateRange(practiceId, startDate, endDate);

  const results = await Promise.all(
    deniedClaims.map(async (claim) => {
      let patient: Patient | null = null;
      if (claim.patientId) {
        const { decryptPatientRecord } = await import("../services/phiEncryptionService");
        const [p] = await db.select().from(patients).where(and(eq(patients.id, claim.patientId), isNull(patients.deletedAt)));
        patient = p ? decryptPatientRecord(p) as Patient : null;
      }

      const appeals_list = await getClaimAppeals(claim.id);
      const appeal = appeals_list.length > 0 ? appeals_list[0] : null;

      return { claim, patient, appeal };
    })
  );

  return results;
}

// ==================== INSURANCE RATES ====================

export async function getInsuranceRates(insuranceProvider?: string): Promise<InsuranceRate[]> {
  if (insuranceProvider) {
    return await db
      .select()
      .from(insuranceRates)
      .where(eq(insuranceRates.insuranceProvider, insuranceProvider))
      .orderBy(insuranceRates.cptCode);
  }
  return await db.select().from(insuranceRates).orderBy(insuranceRates.insuranceProvider, insuranceRates.cptCode);
}

export async function getInsuranceRateByCode(insuranceProvider: string, cptCode: string): Promise<InsuranceRate | undefined> {
  const [rate] = await db
    .select()
    .from(insuranceRates)
    .where(and(
      eq(insuranceRates.insuranceProvider, insuranceProvider),
      eq(insuranceRates.cptCode, cptCode)
    ));
  return rate;
}

export async function createInsuranceRate(rate: InsertInsuranceRate): Promise<InsuranceRate> {
  const [created] = await db.insert(insuranceRates).values(rate).returning();
  return created;
}

export async function updateInsuranceRate(id: number, updates: Partial<InsertInsuranceRate>): Promise<InsuranceRate | undefined> {
  const [updated] = await db
    .update(insuranceRates)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(insuranceRates.id, id))
    .returning();
  return updated;
}

export async function deleteInsuranceRate(id: number): Promise<void> {
  await db.delete(insuranceRates).where(eq(insuranceRates.id, id));
}

export async function upsertInsuranceRate(rate: InsertInsuranceRate): Promise<InsuranceRate> {
  const existing = await getInsuranceRateByCode(rate.insuranceProvider, rate.cptCode);
  if (existing) {
    const [updated] = await db
      .update(insuranceRates)
      .set({ ...rate, updatedAt: new Date() })
      .where(eq(insuranceRates.id, existing.id))
      .returning();
    return updated;
  }
  return createInsuranceRate(rate);
}

export async function getUniqueInsuranceProviders(): Promise<string[]> {
  const result = await db
    .selectDistinct({ provider: insuranceRates.insuranceProvider })
    .from(insuranceRates)
    .orderBy(insuranceRates.insuranceProvider);
  return result.map((r: any) => r.provider);
}

export async function getRatesRankedByReimbursement(insuranceProvider: string): Promise<InsuranceRate[]> {
  return await db
    .select()
    .from(insuranceRates)
    .where(eq(insuranceRates.insuranceProvider, insuranceProvider))
    .orderBy(desc(insuranceRates.inNetworkRate));
}

export async function getBestPayingCode(insuranceProvider: string, cptCodeList: string[]): Promise<InsuranceRate | undefined> {
  if (cptCodeList.length === 0) return undefined;
  const rates = await db
    .select()
    .from(insuranceRates)
    .where(and(
      eq(insuranceRates.insuranceProvider, insuranceProvider),
      inArray(insuranceRates.cptCode, cptCodeList)
    ))
    .orderBy(desc(insuranceRates.inNetworkRate))
    .limit(1);
  return rates[0];
}

// ==================== CPT CODE EQUIVALENCIES ====================

export async function createCptCodeEquivalency(equivalency: InsertCptCodeEquivalency): Promise<CptCodeEquivalency> {
  const [created] = await db.insert(cptCodeEquivalencies).values(equivalency).returning();
  return created;
}

export async function getCptCodeEquivalencies(cptCodeId: number): Promise<CptCodeEquivalency[]> {
  return await db
    .select()
    .from(cptCodeEquivalencies)
    .where(
      and(
        or(
          eq(cptCodeEquivalencies.primaryCodeId, cptCodeId),
          eq(cptCodeEquivalencies.equivalentCodeId, cptCodeId)
        ),
        eq(cptCodeEquivalencies.isActive, true)
      )
    );
}

export async function getEquivalentCodesForIntervention(interventionCategory: string): Promise<CptCodeEquivalency[]> {
  return await db
    .select()
    .from(cptCodeEquivalencies)
    .where(eq(cptCodeEquivalencies.interventionCategory, interventionCategory));
}

export async function getAllCptCodeEquivalencies(): Promise<CptCodeEquivalency[]> {
  return await db.select().from(cptCodeEquivalencies);
}

export async function deleteCptCodeEquivalency(id: number): Promise<void> {
  await db.delete(cptCodeEquivalencies).where(eq(cptCodeEquivalencies.id, id));
}

// ==================== APPEALS MANAGEMENT ====================

export async function createAppeal(data: InsertAppeal): Promise<Appeal> {
  const [created] = await db.insert(appeals).values(data).returning();
  return created;
}

export async function getAppeals(practiceId: number, filters?: {
  status?: string;
  appealLevel?: string;
  deadlineWithinDays?: number;
}): Promise<Appeal[]> {
  const conditions: any[] = [eq(appeals.practiceId, practiceId)];

  if (filters?.status) {
    conditions.push(eq(appeals.status, filters.status));
  }
  if (filters?.appealLevel) {
    conditions.push(eq(appeals.appealLevel, filters.appealLevel));
  }
  if (filters?.deadlineWithinDays) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + filters.deadlineWithinDays);
    conditions.push(lte(appeals.deadlineDate, futureDate.toISOString().split('T')[0]));
  }

  return await db
    .select()
    .from(appeals)
    .where(and(...conditions))
    .orderBy(appeals.deadlineDate);
}

export async function getAppealById(id: number): Promise<Appeal | undefined> {
  const [appeal] = await db.select().from(appeals).where(eq(appeals.id, id));
  return appeal;
}

export async function getAppealsByClaimId(claimId: number): Promise<Appeal[]> {
  return await db
    .select()
    .from(appeals)
    .where(eq(appeals.claimId, claimId))
    .orderBy(desc(appeals.createdAt));
}

export async function updateAppealRecord(id: number, data: Partial<InsertAppeal>): Promise<Appeal> {
  const [updated] = await db
    .update(appeals)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(appeals.id, id))
    .returning();
  return updated;
}

export async function getAppealsDashboard(practiceId: number): Promise<{
  totalDeniedAwaitingAppeal: number;
  appealsPendingSubmission: number;
  appealsPastDeadline: number;
  successRate: number;
  totalRecovered: number;
  last90DaysWon: number;
  last90DaysTotal: number;
}> {
  const now = new Date();
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const allAppeals = await db
    .select()
    .from(appeals)
    .where(eq(appeals.practiceId, practiceId));

  const deniedClaims = await db
    .select()
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      eq(claims.status, 'denied')
    ));

  const appealedClaimIds = new Set(allAppeals.map((a: Appeal) => a.claimId));
  const deniedWithoutAppeal = deniedClaims.filter((c: Claim) => !appealedClaimIds.has(c.id));
  const totalDeniedAwaitingAppeal = deniedWithoutAppeal.reduce(
    (sum: number, c: Claim) => sum + Number(c.totalAmount || 0), 0
  );

  const pendingSubmission = allAppeals.filter((a: Appeal) =>
    a.status === 'draft' || a.status === 'ready'
  ).length;

  const pastDeadline = allAppeals.filter((a: Appeal) =>
    a.deadlineDate && new Date(a.deadlineDate) < now &&
    !['won', 'lost', 'partial'].includes(a.status)
  ).length;

  const recentAppeals = allAppeals.filter((a: Appeal) =>
    a.resolvedDate && new Date(a.resolvedDate) >= ninetyDaysAgo
  );
  const wonAppeals = recentAppeals.filter((a: Appeal) =>
    a.status === 'won' || a.status === 'partial'
  );

  const last90DaysWon = wonAppeals.length;
  const last90DaysTotal = recentAppeals.length;
  const successRate = last90DaysTotal > 0 ? (last90DaysWon / last90DaysTotal) * 100 : 0;

  const totalRecovered = allAppeals
    .filter((a: Appeal) => a.status === 'won' || a.status === 'partial')
    .reduce((sum: number, a: Appeal) => sum + Number(a.recoveredAmount || 0), 0);

  return {
    totalDeniedAwaitingAppeal,
    appealsPendingSubmission: pendingSubmission,
    appealsPastDeadline: pastDeadline,
    successRate: Math.round(successRate * 10) / 10,
    totalRecovered,
    last90DaysWon,
    last90DaysTotal,
  };
}

export async function getUpcomingDeadlines(practiceId: number, days: number): Promise<Appeal[]> {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  return await db
    .select()
    .from(appeals)
    .where(and(
      eq(appeals.practiceId, practiceId),
      lte(appeals.deadlineDate, futureDate.toISOString().split('T')[0]),
      sql`${appeals.status} NOT IN ('won', 'lost', 'partial')`
    ))
    .orderBy(appeals.deadlineDate);
}

export async function getDeniedClaimsForAppeals(practiceId: number): Promise<Claim[]> {
  const deniedClaims = await db
    .select()
    .from(claims)
    .where(and(
      eq(claims.practiceId, practiceId),
      eq(claims.status, 'denied')
    ))
    .orderBy(desc(claims.updatedAt));

  const existingAppeals = await db
    .select({ claimId: appeals.claimId })
    .from(appeals)
    .where(and(
      eq(appeals.practiceId, practiceId),
      sql`${appeals.status} NOT IN ('lost')`
    ));

  const appealedClaimIds = new Set(existingAppeals.map((a: { claimId: number }) => a.claimId));
  return deniedClaims.filter((c: Claim) => !appealedClaimIds.has(c.id));
}

// ==================== CLAIM OUTCOMES ====================

export async function createClaimOutcome(outcome: InsertClaimOutcome): Promise<ClaimOutcome> {
  const [newOutcome] = await db
    .insert(claimOutcomes)
    .values(outcome)
    .returning();
  return newOutcome;
}

export async function getClaimOutcomes(practiceId: number, filters?: {
  insuranceProvider?: string;
  cptCode?: string;
  startDate?: Date;
  endDate?: Date;
  hasOutcome?: boolean;
}): Promise<ClaimOutcome[]> {
  const conditions: any[] = [eq(claimOutcomes.practiceId, practiceId)];

  if (filters?.insuranceProvider) {
    conditions.push(eq(claimOutcomes.insuranceProvider, filters.insuranceProvider));
  }
  if (filters?.cptCode) {
    conditions.push(eq(claimOutcomes.cptCode, filters.cptCode));
  }
  if (filters?.hasOutcome === true) {
    conditions.push(sql`${claimOutcomes.allowedAmount} IS NOT NULL`);
  }
  if (filters?.hasOutcome === false) {
    conditions.push(sql`${claimOutcomes.allowedAmount} IS NULL`);
  }

  return await db
    .select()
    .from(claimOutcomes)
    .where(and(...conditions))
    .orderBy(desc(claimOutcomes.createdAt));
}

export async function updateClaimOutcome(id: number, outcome: Partial<InsertClaimOutcome>): Promise<ClaimOutcome> {
  const [updated] = await db
    .update(claimOutcomes)
    .set({ ...outcome, updatedAt: new Date() })
    .where(eq(claimOutcomes.id, id))
    .returning();
  return updated;
}

export async function getClaimOutcomeById(id: number): Promise<ClaimOutcome | undefined> {
  const [outcome] = await db
    .select()
    .from(claimOutcomes)
    .where(eq(claimOutcomes.id, id));
  return outcome;
}

export async function getClaimOutcomesForTraining(minDataPoints: number = 100): Promise<ClaimOutcome[]> {
  return await db
    .select()
    .from(claimOutcomes)
    .where(and(
      eq(claimOutcomes.isTrainingData, true),
      sql`${claimOutcomes.allowedAmount} IS NOT NULL`,
      sql`${claimOutcomes.paidAmount} IS NOT NULL`
    ))
    .orderBy(desc(claimOutcomes.serviceDate))
    .limit(minDataPoints);
}

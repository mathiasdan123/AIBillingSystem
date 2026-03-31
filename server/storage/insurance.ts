import {
  eligibilityChecks,
  patientInsuranceAuthorizations,
  insuranceDataCache,
  patients,
  type EligibilityCheck,
  type InsertEligibilityCheck,
  type PatientInsuranceAuthorization,
  type InsertPatientInsuranceAuthorization,
  type InsuranceDataCache,
  type InsertInsuranceDataCache,
  type Patient,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";
import { getPatient } from "./patients";

// ==================== ELIGIBILITY CHECKS ====================

export async function createEligibilityCheck(check: InsertEligibilityCheck): Promise<EligibilityCheck> {
  const [created] = await db
    .insert(eligibilityChecks)
    .values(check)
    .returning();
  return created;
}

export async function getPatientEligibility(patientId: number): Promise<EligibilityCheck | undefined> {
  const [check] = await db
    .select()
    .from(eligibilityChecks)
    .where(eq(eligibilityChecks.patientId, patientId))
    .orderBy(desc(eligibilityChecks.checkDate))
    .limit(1);
  return check;
}

export async function getEligibilityHistory(patientId: number): Promise<EligibilityCheck[]> {
  return await db
    .select()
    .from(eligibilityChecks)
    .where(eq(eligibilityChecks.patientId, patientId))
    .orderBy(desc(eligibilityChecks.checkDate));
}

// ==================== PATIENT INSURANCE AUTHORIZATIONS ====================

export async function createPatientInsuranceAuth(auth: InsertPatientInsuranceAuthorization): Promise<PatientInsuranceAuthorization> {
  const [created] = await db.insert(patientInsuranceAuthorizations).values(auth).returning();
  return created;
}

export async function getPatientInsuranceAuth(patientId: number): Promise<PatientInsuranceAuthorization | undefined> {
  const [auth] = await db
    .select()
    .from(patientInsuranceAuthorizations)
    .where(eq(patientInsuranceAuthorizations.patientId, patientId))
    .orderBy(desc(patientInsuranceAuthorizations.createdAt))
    .limit(1);
  return auth;
}

export async function getInsuranceAuthByToken(token: string): Promise<PatientInsuranceAuthorization | undefined> {
  const [auth] = await db
    .select()
    .from(patientInsuranceAuthorizations)
    .where(eq(patientInsuranceAuthorizations.token, token));
  return auth;
}

export async function updateInsuranceAuth(id: number, data: Partial<InsertPatientInsuranceAuthorization>): Promise<PatientInsuranceAuthorization> {
  const [updated] = await db
    .update(patientInsuranceAuthorizations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(patientInsuranceAuthorizations.id, id))
    .returning();
  return updated;
}

export async function getPatientAuthorizations(patientId: number): Promise<PatientInsuranceAuthorization[]> {
  return await db
    .select()
    .from(patientInsuranceAuthorizations)
    .where(eq(patientInsuranceAuthorizations.patientId, patientId))
    .orderBy(desc(patientInsuranceAuthorizations.createdAt));
}

export async function updateAuthorizationStatus(id: number, data: any): Promise<any> {
  const [updated] = await db
    .update(patientInsuranceAuthorizations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(patientInsuranceAuthorizations.id, id))
    .returning();
  return updated;
}

export async function getAuthorizationByToken(token: string): Promise<PatientInsuranceAuthorization | undefined> {
  return getInsuranceAuthByToken(token);
}

export async function getAuthorizationById(id: number): Promise<PatientInsuranceAuthorization | undefined> {
  const [auth] = await db
    .select()
    .from(patientInsuranceAuthorizations)
    .where(eq(patientInsuranceAuthorizations.id, id));
  return auth;
}

export async function createInsuranceAuthorization(data: any): Promise<PatientInsuranceAuthorization> {
  const [created] = await db
    .insert(patientInsuranceAuthorizations)
    .values(data)
    .returning();
  return created;
}

export async function incrementAuthorizationResendCount(id: number): Promise<void> {
  // no-op stub
}

export async function incrementAuthorizationLinkAttempts(id: number): Promise<void> {
  // no-op stub
}

// ==================== INSURANCE DATA CACHE ====================

export async function cacheInsuranceData(data: InsertInsuranceDataCache): Promise<InsuranceDataCache> {
  const [created] = await db.insert(insuranceDataCache).values(data).returning();
  return created;
}

export async function getCachedInsuranceData(patientId: number, dataType?: string): Promise<InsuranceDataCache | undefined> {
  const conditions: any[] = [eq(insuranceDataCache.patientId, patientId)];
  if (dataType) {
    conditions.push(eq(insuranceDataCache.dataType, dataType));
  }
  const [cached] = await db
    .select()
    .from(insuranceDataCache)
    .where(and(...conditions))
    .orderBy(desc(insuranceDataCache.fetchedAt))
    .limit(1);
  return cached;
}

export async function getPatientsWithStaleEligibility(daysOld: number): Promise<Patient[]> {
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - daysOld);

  const authorizedPatientIds = await db
    .select({ patientId: patientInsuranceAuthorizations.patientId })
    .from(patientInsuranceAuthorizations)
    .where(eq(patientInsuranceAuthorizations.status, 'authorized'));

  const ids = authorizedPatientIds.map((r: any) => r.patientId);
  if (ids.length === 0) return [];

  const stalePatients: Patient[] = [];
  for (const patientId of ids) {
    const cached = await getCachedInsuranceData(patientId);
    if (!cached || (cached.fetchedAt && new Date(cached.fetchedAt) < staleDate)) {
      const patient = await getPatient(patientId);
      if (patient) stalePatients.push(patient);
    }
  }
  return stalePatients;
}

export async function markCacheAsStale(patientId: number): Promise<void> {
  await db
    .update(insuranceDataCache)
    .set({ isStale: true, updatedAt: new Date() })
    .where(eq(insuranceDataCache.patientId, patientId));
}

import {
  patients,
  treatmentSessions,
  claims,
  claimLineItems,
  soapNotes,
  appointments,
  eligibilityChecks,
  patientInsuranceAuthorizations,
  insuranceDataCache,
  patientConsents,
  patientProgressNotes,
  patientStatements,
  patientPlanDocuments,
  patientPlanBenefits,
  type Patient,
  type InsertPatient,
  type TreatmentSession,
  type InsertTreatmentSession,
  type PatientConsent,
  type InsertPatientConsent,
  type PatientProgressNote,
  type InsertPatientProgressNote,
  type PatientStatement,
  type InsertPatientStatement,
  type PatientPlanDocument,
  type InsertPatientPlanDocument,
  type PatientPlanBenefits,
  type InsertPatientPlanBenefits,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, isNull, lt, inArray, sql } from "drizzle-orm";
import {
  encryptPatientRecord,
  decryptPatientRecord,
  encryptTreatmentSessionRecord,
  decryptTreatmentSessionRecord,
} from "../services/phiEncryptionService";
import { cache, CacheKeys } from "../services/cacheService";

// ==================== PATIENT OPERATIONS ====================

export async function createPatient(patient: InsertPatient): Promise<Patient> {
  const encrypted = encryptPatientRecord(patient as any);
  const [newPatient] = await db
    .insert(patients)
    .values(encrypted as any)
    .returning();
  if (patient.practiceId) {
    await cache.delPattern(CacheKeys.analyticsPattern(patient.practiceId));
  }
  return decryptPatientRecord(newPatient) as Patient;
}

export async function getPatients(practiceId: number): Promise<Patient[]> {
  const rows = await db
    .select()
    .from(patients)
    .where(and(eq(patients.practiceId, practiceId), isNull(patients.deletedAt)))
    .orderBy(desc(patients.createdAt));
  return rows.map((r: any) => decryptPatientRecord(r) as Patient);
}

export async function getPatient(id: number): Promise<Patient | undefined> {
  const [patient] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.id, id), isNull(patients.deletedAt)));
  return patient ? decryptPatientRecord(patient) as Patient : undefined;
}

export async function getPatientByEmail(email: string): Promise<Patient | undefined> {
  const allPatients = await db
    .select()
    .from(patients)
    .where(isNull(patients.deletedAt));

  for (const patient of allPatients) {
    const decrypted = decryptPatientRecord(patient) as Patient;
    if (decrypted.email?.toLowerCase() === email.toLowerCase()) {
      return decrypted;
    }
  }
  return undefined;
}

export async function updatePatient(id: number, patient: Partial<InsertPatient>): Promise<Patient> {
  const encrypted = encryptPatientRecord(patient as any);
  const [updatedPatient] = await db
    .update(patients)
    .set({ ...encrypted, updatedAt: new Date() })
    .where(eq(patients.id, id))
    .returning();
  if (updatedPatient.practiceId) {
    await cache.delPattern(CacheKeys.analyticsPattern(updatedPatient.practiceId));
  }
  return decryptPatientRecord(updatedPatient) as Patient;
}

export async function softDeletePatient(id: number): Promise<void> {
  await db
    .update(patients)
    .set({
      deletedAt: new Date(),
      firstName: '[DELETED]' as any,
      lastName: '[DELETED]' as any,
      email: null,
      phone: null,
      address: null,
      dateOfBirth: null,
      insuranceId: null,
      policyNumber: null,
      groupNumber: null,
      updatedAt: new Date(),
    })
    .where(eq(patients.id, id));
}

export async function getAllPatients(): Promise<Patient[]> {
  const rows = await db
    .select()
    .from(patients)
    .where(isNull(patients.deletedAt))
    .orderBy(desc(patients.createdAt));
  return rows.map((r: any) => decryptPatientRecord(r) as Patient);
}

export async function getPatientsByIds(ids: number[]): Promise<Map<number, Patient>> {
  const result = new Map<number, Patient>();
  if (ids.length === 0) return result;

  const rows = await db
    .select()
    .from(patients)
    .where(and(inArray(patients.id, ids), isNull(patients.deletedAt)));

  for (const row of rows) {
    const patient = decryptPatientRecord(row) as Patient;
    result.set(patient.id, patient);
  }

  return result;
}

export async function hardDeletePatient(id: number): Promise<void> {
  const patientSessions = await db
    .select({ id: treatmentSessions.id })
    .from(treatmentSessions)
    .where(eq(treatmentSessions.patientId, id));
  for (const session of patientSessions) {
    await db.delete(soapNotes).where(eq(soapNotes.sessionId, session.id));
  }

  const patientClaims = await db
    .select({ id: claims.id })
    .from(claims)
    .where(eq(claims.patientId, id));
  for (const claim of patientClaims) {
    await db.delete(claimLineItems).where(eq(claimLineItems.claimId, claim.id));
  }

  await db.delete(claims).where(eq(claims.patientId, id));
  await db.delete(treatmentSessions).where(eq(treatmentSessions.patientId, id));
  await db.delete(appointments).where(eq(appointments.patientId, id));
  await db.delete(eligibilityChecks).where(eq(eligibilityChecks.patientId, id));
  await db.delete(patientInsuranceAuthorizations).where(eq(patientInsuranceAuthorizations.patientId, id));
  await db.delete(insuranceDataCache).where(eq(insuranceDataCache.patientId, id));
  await db.delete(patients).where(eq(patients.id, id));
}

export async function getExpiredSoftDeletedPatients(retentionDays: number): Promise<Patient[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const rows = await db
    .select()
    .from(patients)
    .where(and(
      sql`${patients.deletedAt} IS NOT NULL`,
      lt(patients.deletedAt, cutoffDate)
    ));
  return rows as Patient[];
}

export async function updatePatientIntakeData(patientId: number, intakeData: any): Promise<Patient> {
  const [updated] = await db
    .update(patients)
    .set({ intakeData, updatedAt: new Date() })
    .where(eq(patients.id, patientId))
    .returning();
  return decryptPatientRecord(updated) as Patient;
}

export async function completePatientIntake(patientId: number, intakeData: any): Promise<Patient> {
  const [updated] = await db
    .update(patients)
    .set({
      intakeData,
      intakeCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(patients.id, patientId))
    .returning();
  return decryptPatientRecord(updated) as Patient;
}

export async function updatePatientStripeCustomerId(patientId: number, stripeCustomerId: string): Promise<void> {
  await db
    .update(patients)
    .set({ stripeCustomerId, updatedAt: new Date() })
    .where(eq(patients.id, patientId));
}

// ==================== TREATMENT SESSIONS ====================

export async function createTreatmentSession(session: InsertTreatmentSession): Promise<TreatmentSession> {
  const encrypted = encryptTreatmentSessionRecord(session as any);
  const [newSession] = await db
    .insert(treatmentSessions)
    .values(encrypted as any)
    .returning();
  return decryptTreatmentSessionRecord(newSession) as TreatmentSession;
}

export async function getTreatmentSessions(practiceId: number): Promise<TreatmentSession[]> {
  const rows = await db
    .select()
    .from(treatmentSessions)
    .where(eq(treatmentSessions.practiceId, practiceId))
    .orderBy(desc(treatmentSessions.sessionDate));
  return rows.map((r: any) => decryptTreatmentSessionRecord(r) as TreatmentSession);
}

export async function getTreatmentSession(id: number): Promise<TreatmentSession | undefined> {
  const [session] = await db
    .select()
    .from(treatmentSessions)
    .where(eq(treatmentSessions.id, id));
  return session ? decryptTreatmentSessionRecord(session) as TreatmentSession : undefined;
}

export async function getAllSessions(): Promise<TreatmentSession[]> {
  const rows = await db
    .select()
    .from(treatmentSessions)
    .orderBy(desc(treatmentSessions.createdAt));
  return rows.map((r: any) => decryptTreatmentSessionRecord(r) as TreatmentSession);
}

export async function createSession(session: InsertTreatmentSession): Promise<TreatmentSession> {
  return createTreatmentSession(session);
}

// ==================== PATIENT CONSENTS ====================

export async function createPatientConsent(consent: InsertPatientConsent): Promise<PatientConsent> {
  const [created] = await db.insert(patientConsents).values(consent).returning();
  return created;
}

export async function getPatientConsents(patientId: number): Promise<PatientConsent[]> {
  return await db
    .select()
    .from(patientConsents)
    .where(eq(patientConsents.patientId, patientId))
    .orderBy(desc(patientConsents.createdAt));
}

export async function getPatientConsentsByType(patientId: number, consentType: string): Promise<PatientConsent[]> {
  return await db
    .select()
    .from(patientConsents)
    .where(and(
      eq(patientConsents.patientId, patientId),
      eq(patientConsents.consentType, consentType)
    ))
    .orderBy(desc(patientConsents.createdAt));
}

export async function getActiveConsent(patientId: number, consentType: string): Promise<PatientConsent | undefined> {
  const consents = await db
    .select()
    .from(patientConsents)
    .where(and(
      eq(patientConsents.patientId, patientId),
      eq(patientConsents.consentType, consentType),
      isNull(patientConsents.revokedDate)
    ))
    .orderBy(desc(patientConsents.createdAt));

  for (const consent of consents) {
    if (!consent.expiresAt || new Date(consent.expiresAt) > new Date()) {
      return consent;
    }
  }
  return undefined;
}

export async function revokeConsent(consentId: number, revokedBy: string, reason?: string): Promise<PatientConsent | undefined> {
  const [updated] = await db
    .update(patientConsents)
    .set({
      isRevoked: true,
      revokedDate: new Date(),
      revokedBy,
      revocationReason: reason,
    })
    .where(eq(patientConsents.id, consentId))
    .returning();
  return updated;
}

export async function getConsentsByPractice(practiceId: number, filters?: { consentType?: string; isRevoked?: boolean }): Promise<PatientConsent[]> {
  const conditions: any[] = [eq(patientConsents.practiceId, practiceId)];

  if (filters?.consentType) {
    conditions.push(eq(patientConsents.consentType, filters.consentType));
  }
  if (filters?.isRevoked === true) {
    conditions.push(sql`${patientConsents.revokedDate} IS NOT NULL`);
  } else if (filters?.isRevoked === false) {
    conditions.push(isNull(patientConsents.revokedDate));
  }

  return await db
    .select()
    .from(patientConsents)
    .where(and(...conditions))
    .orderBy(desc(patientConsents.createdAt));
}

export async function hasActiveConsent(patientId: number, consentType: string): Promise<boolean> {
  const consent = await getActiveConsent(patientId, consentType);
  return !!consent;
}

export async function hasRequiredTreatmentConsents(patientId: number): Promise<{
  hasConsent: boolean;
  hasAllConsents: boolean;
  missingConsents: string[];
  consentStatus: Record<string, boolean>;
}> {
  const requiredConsents = ['treatment', 'privacy', 'telehealth'];
  const consentStatus: Record<string, boolean> = {};
  const missingConsents: string[] = [];

  for (const consentType of requiredConsents) {
    const hasConsent = await hasActiveConsent(patientId, consentType);
    consentStatus[consentType] = hasConsent;
    if (!hasConsent) {
      missingConsents.push(consentType);
    }
  }

  const allPresent = missingConsents.length === 0;
  return {
    hasConsent: allPresent,
    hasAllConsents: allPresent,
    missingConsents,
    consentStatus,
  };
}

export async function batchGetConsentStatus(patientIds: number[]): Promise<Map<number, { hasConsent: boolean; missingConsents: string[] }>> {
  const result = new Map<number, { hasConsent: boolean; missingConsents: string[] }>();
  if (patientIds.length === 0) return result;

  const requiredTypes = ['treatment', 'privacy', 'telehealth'];

  const allConsents = await db
    .select()
    .from(patientConsents)
    .where(and(
      inArray(patientConsents.patientId, patientIds),
      inArray(patientConsents.consentType, requiredTypes),
      isNull(patientConsents.revokedDate)
    ));

  const activeConsentsByPatient = new Map<number, Set<string>>();
  for (const consent of allConsents) {
    if (consent.expiresAt && new Date(consent.expiresAt) <= new Date()) continue;
    if (!activeConsentsByPatient.has(consent.patientId)) {
      activeConsentsByPatient.set(consent.patientId, new Set());
    }
    activeConsentsByPatient.get(consent.patientId)!.add(consent.consentType);
  }

  for (const patientId of patientIds) {
    const activeTypes = activeConsentsByPatient.get(patientId) || new Set();
    const missingConsents = requiredTypes.filter(t => !activeTypes.has(t));
    result.set(patientId, {
      hasConsent: missingConsents.length === 0,
      missingConsents,
    });
  }

  return result;
}

// ==================== PATIENT PROGRESS NOTES ====================

export async function createPatientProgressNote(note: InsertPatientProgressNote): Promise<PatientProgressNote> {
  const [result] = await db
    .insert(patientProgressNotes)
    .values(note)
    .returning();
  return result;
}

export async function getPatientProgressNotes(patientId: number): Promise<PatientProgressNote[]> {
  return await db
    .select()
    .from(patientProgressNotes)
    .where(eq(patientProgressNotes.patientId, patientId))
    .orderBy(desc(patientProgressNotes.sessionDate));
}

export async function getPatientProgressNote(id: number): Promise<PatientProgressNote | undefined> {
  const [result] = await db
    .select()
    .from(patientProgressNotes)
    .where(eq(patientProgressNotes.id, id));
  return result;
}

export async function getSharedPatientProgressNotes(patientId: number): Promise<PatientProgressNote[]> {
  return await db
    .select()
    .from(patientProgressNotes)
    .where(and(
      eq(patientProgressNotes.patientId, patientId),
      sql`${patientProgressNotes.sharedAt} IS NOT NULL`
    ))
    .orderBy(desc(patientProgressNotes.sessionDate));
}

export async function sharePatientProgressNote(id: number, sharedBy: string): Promise<PatientProgressNote | undefined> {
  const [result] = await db
    .update(patientProgressNotes)
    .set({ sharedAt: new Date(), sharedBy })
    .where(eq(patientProgressNotes.id, id))
    .returning();
  return result;
}

export async function unsharePatientProgressNote(id: number): Promise<PatientProgressNote | undefined> {
  const [result] = await db
    .update(patientProgressNotes)
    .set({ sharedAt: null, sharedBy: null })
    .where(eq(patientProgressNotes.id, id))
    .returning();
  return result;
}

// ==================== PATIENT STATEMENTS ====================

export async function createPatientStatement(statement: Omit<InsertPatientStatement, 'statementNumber'>): Promise<PatientStatement> {
  const statementNumber = generateStatementNumber();
  const [result] = await db
    .insert(patientStatements)
    .values({ ...statement, statementNumber })
    .returning();
  return result;
}

export function generateStatementNumber(): string {
  const date = new Date();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `STM-${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}-${random}`;
}

export async function getPatientStatements(patientId: number): Promise<PatientStatement[]> {
  return await db
    .select()
    .from(patientStatements)
    .where(eq(patientStatements.patientId, patientId))
    .orderBy(desc(patientStatements.statementDate));
}

export async function getPatientStatement(id: number): Promise<PatientStatement | undefined> {
  const [result] = await db
    .select()
    .from(patientStatements)
    .where(eq(patientStatements.id, id));
  return result;
}

export async function updatePatientStatement(id: number, updates: Partial<InsertPatientStatement>): Promise<PatientStatement> {
  const [result] = await db
    .update(patientStatements)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(patientStatements.id, id))
    .returning();
  return result;
}

export async function markStatementSent(id: number, method: string): Promise<PatientStatement> {
  const [result] = await db
    .update(patientStatements)
    .set({
      status: 'sent',
      sentAt: new Date(),
      sentMethod: method,
      updatedAt: new Date(),
    })
    .where(eq(patientStatements.id, id))
    .returning();
  return result;
}

export async function markStatementPaid(id: number, paymentInfo: {
  paidAmount: string;
  paidAt: Date;
  paymentMethod?: string;
  paymentReference?: string;
}): Promise<PatientStatement> {
  const [result] = await db
    .update(patientStatements)
    .set({
      status: 'paid',
      paidAmount: paymentInfo.paidAmount,
      paidAt: paymentInfo.paidAt,
      paymentMethod: paymentInfo.paymentMethod,
      paymentReference: paymentInfo.paymentReference,
      updatedAt: new Date(),
    })
    .where(eq(patientStatements.id, id))
    .returning();
  return result;
}

export async function getPracticeStatements(practiceId: number, filters?: {
  status?: string;
  patientId?: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<PatientStatement[]> {
  const conditions: any[] = [eq(patientStatements.practiceId, practiceId)];

  if (filters?.status) {
    conditions.push(eq(patientStatements.status, filters.status));
  }
  if (filters?.patientId) {
    conditions.push(eq(patientStatements.patientId, filters.patientId));
  }

  return await db
    .select()
    .from(patientStatements)
    .where(and(...conditions))
    .orderBy(desc(patientStatements.statementDate));
}

// ==================== PLAN DOCUMENTS & BENEFITS ====================

export async function createPlanDocument(document: InsertPatientPlanDocument): Promise<PatientPlanDocument> {
  const [created] = await db
    .insert(patientPlanDocuments)
    .values(document)
    .returning();
  return created;
}

export async function getPlanDocuments(patientId: number): Promise<PatientPlanDocument[]> {
  return await db
    .select()
    .from(patientPlanDocuments)
    .where(eq(patientPlanDocuments.patientId, patientId))
    .orderBy(desc(patientPlanDocuments.createdAt));
}

export async function getPlanDocument(id: number): Promise<PatientPlanDocument | undefined> {
  const [document] = await db
    .select()
    .from(patientPlanDocuments)
    .where(eq(patientPlanDocuments.id, id));
  return document;
}

export async function updatePlanDocument(id: number, data: Partial<InsertPatientPlanDocument>): Promise<PatientPlanDocument> {
  const [updated] = await db
    .update(patientPlanDocuments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(patientPlanDocuments.id, id))
    .returning();
  return updated;
}

export async function deletePlanDocument(id: number): Promise<void> {
  await db.delete(patientPlanDocuments).where(eq(patientPlanDocuments.id, id));
}

export async function createPlanBenefits(benefits: InsertPatientPlanBenefits): Promise<PatientPlanBenefits> {
  const [created] = await db
    .insert(patientPlanBenefits)
    .values(benefits)
    .returning();
  return created;
}

export async function getPatientPlanBenefits(patientId: number): Promise<PatientPlanBenefits | undefined> {
  const [benefits] = await db
    .select()
    .from(patientPlanBenefits)
    .where(and(
      eq(patientPlanBenefits.patientId, patientId),
      eq(patientPlanBenefits.isActive, true)
    ))
    .orderBy(desc(patientPlanBenefits.createdAt))
    .limit(1);
  return benefits;
}

export async function getAllPatientPlanBenefits(patientId: number): Promise<PatientPlanBenefits[]> {
  return await db
    .select()
    .from(patientPlanBenefits)
    .where(eq(patientPlanBenefits.patientId, patientId))
    .orderBy(desc(patientPlanBenefits.createdAt));
}

export async function updatePlanBenefits(id: number, data: Partial<InsertPatientPlanBenefits>): Promise<PatientPlanBenefits> {
  const [updated] = await db
    .update(patientPlanBenefits)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(patientPlanBenefits.id, id))
    .returning();
  return updated;
}

export async function deactivatePlanBenefits(patientId: number): Promise<void> {
  await db
    .update(patientPlanBenefits)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(patientPlanBenefits.patientId, patientId));
}

export async function verifyPlanBenefits(id: number, verifiedBy: string): Promise<PatientPlanBenefits> {
  const [updated] = await db
    .update(patientPlanBenefits)
    .set({
      verifiedBy,
      verifiedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(patientPlanBenefits.id, id))
    .returning();
  return updated;
}

export async function getPatientArAging(practiceId: number): Promise<{
  totalOutstanding: number;
  buckets: { bucket: string; count: number; amount: number }[];
  byPatient: { patientId: number; patientName: string; totalOwed: number; oldestDays: number }[];
}> {
  const now = new Date();

  const outstandingStatements = await db
    .select()
    .from(patientStatements)
    .where(and(
      eq(patientStatements.practiceId, practiceId),
      inArray(patientStatements.status, ['draft', 'sent', 'overdue', 'collections'])
    ));

  const bucketsMap: Record<string, { count: number; amount: number }> = {
    '0-30': { count: 0, amount: 0 },
    '31-60': { count: 0, amount: 0 },
    '61-90': { count: 0, amount: 0 },
    '90+': { count: 0, amount: 0 },
  };

  let totalOutstanding = 0;
  const patientMap: Record<number, { totalOwed: number; oldestDays: number }> = {};

  for (const stmt of outstandingStatements) {
    const balance = (parseFloat(stmt.patientBalance || '0')) - (parseFloat(stmt.paidAmount || '0'));
    if (balance <= 0) continue;

    const stmtDate = new Date(stmt.statementDate);
    const days = Math.floor((now.getTime() - stmtDate.getTime()) / (1000 * 60 * 60 * 24));

    totalOutstanding += balance;

    if (days <= 30) {
      bucketsMap['0-30'].count++;
      bucketsMap['0-30'].amount += balance;
    } else if (days <= 60) {
      bucketsMap['31-60'].count++;
      bucketsMap['31-60'].amount += balance;
    } else if (days <= 90) {
      bucketsMap['61-90'].count++;
      bucketsMap['61-90'].amount += balance;
    } else {
      bucketsMap['90+'].count++;
      bucketsMap['90+'].amount += balance;
    }

    if (!patientMap[stmt.patientId]) {
      patientMap[stmt.patientId] = { totalOwed: 0, oldestDays: 0 };
    }
    patientMap[stmt.patientId].totalOwed += balance;
    if (days > patientMap[stmt.patientId].oldestDays) {
      patientMap[stmt.patientId].oldestDays = days;
    }
  }

  const buckets = Object.entries(bucketsMap).map(([bucket, data]) => ({
    bucket,
    count: data.count,
    amount: Math.round(data.amount * 100) / 100,
  }));

  const patientIds = Object.keys(patientMap).map(Number);
  const byPatient: { patientId: number; patientName: string; totalOwed: number; oldestDays: number }[] = [];

  if (patientIds.length > 0) {
    const patientRecords = await db
      .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName })
      .from(patients)
      .where(inArray(patients.id, patientIds));

    const nameMap = new Map<number, string>();
    for (const p of patientRecords) {
      nameMap.set(p.id, `${p.firstName} ${p.lastName}`);
    }

    for (const [pidStr, data] of Object.entries(patientMap)) {
      const pid = Number(pidStr);
      byPatient.push({
        patientId: pid,
        patientName: nameMap.get(pid) || 'Unknown',
        totalOwed: Math.round(data.totalOwed * 100) / 100,
        oldestDays: data.oldestDays,
      });
    }

    byPatient.sort((a, b) => b.totalOwed - a.totalOwed);
  }

  return {
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    buckets,
    byPatient,
  };
}

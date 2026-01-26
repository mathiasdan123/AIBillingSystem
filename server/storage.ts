import {
  users,
  practices,
  patients,
  treatmentSessions,
  claims,
  expenses,
  payments,
  cptCodes,
  icd10Codes,
  insurances,
  soapNotes,
  cptCodeMappings,
  patientInsuranceAuthorizations,
  payerIntegrations,
  payerCredentials,
  insuranceDataCache,
  authorizationAuditLog,
  type User,
  type UpsertUser,
  type Practice,
  type Patient,
  type TreatmentSession,
  type Claim,
  type Expense,
  type Payment,
  type CptCode,
  type Icd10Code,
  type Insurance,
  type SoapNote,
  type CptCodeMapping,
  type InsertPractice,
  type InsertPatient,
  type InsertTreatmentSession,
  type InsertClaim,
  type InsertExpense,
  type InsertPayment,
  type InsertSoapNote,
  type PatientInsuranceAuthorization,
  type InsertPatientInsuranceAuthorization,
  type PayerIntegration,
  type InsertPayerIntegration,
  type PayerCredential,
  type InsertPayerCredential,
  type InsuranceDataCache,
  type InsertInsuranceDataCache,
  type AuthorizationAuditLog,
  type InsertAuthorizationAuditLog,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, count, sum, sql, lt } from "drizzle-orm";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Practice operations
  createPractice(practice: InsertPractice): Promise<Practice>;
  getPractice(id: number): Promise<Practice | undefined>;
  updatePractice(id: number, practice: Partial<InsertPractice>): Promise<Practice>;
  
  // Patient operations
  createPatient(patient: InsertPatient): Promise<Patient>;
  getPatients(practiceId: number): Promise<Patient[]>;
  getPatient(id: number): Promise<Patient | undefined>;
  updatePatient(id: number, patient: Partial<InsertPatient>): Promise<Patient>;
  
  // Treatment session operations
  createTreatmentSession(session: InsertTreatmentSession): Promise<TreatmentSession>;
  getTreatmentSessions(practiceId: number): Promise<TreatmentSession[]>;
  getTreatmentSession(id: number): Promise<TreatmentSession | undefined>;
  
  // Claim operations
  createClaim(claim: InsertClaim): Promise<Claim>;
  getClaims(practiceId: number): Promise<Claim[]>;
  getClaim(id: number): Promise<Claim | undefined>;
  updateClaim(id: number, claim: Partial<InsertClaim>): Promise<Claim>;
  
  // Expense operations
  createExpense(expense: InsertExpense): Promise<Expense>;
  getExpenses(practiceId: number): Promise<Expense[]>;
  getExpense(id: number): Promise<Expense | undefined>;
  updateExpense(id: number, expense: Partial<InsertExpense>): Promise<Expense>;
  
  // Payment operations
  createPayment(payment: InsertPayment): Promise<Payment>;
  getPayments(practiceId: number): Promise<Payment[]>;
  
  // Code operations
  getCptCodes(): Promise<CptCode[]>;
  getAllCptCodes(): Promise<CptCode[]>;
  getIcd10Codes(): Promise<Icd10Code[]>;
  getInsurances(): Promise<Insurance[]>;
  
  // Convenience methods for API routes
  getAllPatients(): Promise<Patient[]>;
  getAllSoapNotes(): Promise<SoapNote[]>;
  getAllSessions(): Promise<TreatmentSession[]>;
  createSession(session: InsertTreatmentSession): Promise<TreatmentSession>;
  
  // SOAP Notes operations
  createSoapNote(soapNote: InsertSoapNote): Promise<SoapNote>;
  getSoapNotes(practiceId?: number): Promise<SoapNote[]>;
  getSoapNote(id: number): Promise<SoapNote | undefined>;
  getSoapNoteBySession(sessionId: number): Promise<SoapNote | undefined>;
  
  // CPT Code Mapping operations
  getCptCodeMappings(insuranceId?: number): Promise<CptCodeMapping[]>;
  createCptCodeMapping(mapping: any): Promise<CptCodeMapping>;
  
  // Analytics operations
  getDashboardStats(practiceId: number): Promise<{
    totalClaims: number;
    successRate: number;
    totalRevenue: number;
    avgDaysToPayment: number;
    monthlyClaimsCount: number;
    monthlyRevenue: number;
    denialRate: number;
    pendingClaims: number;
  }>;
  
  getRevenueByMonth(practiceId: number, startDate: Date, endDate: Date): Promise<{
    month: string;
    revenue: number;
    claims: number;
  }[]>;
  
  getClaimsByStatus(practiceId: number): Promise<{
    status: string;
    count: number;
  }[]>;
  
  getTopDenialReasons(practiceId: number): Promise<{
    reason: string;
    count: number;
  }[]>;

  // Insurance Authorization operations
  createInsuranceAuthorization(authorization: InsertPatientInsuranceAuthorization): Promise<PatientInsuranceAuthorization>;
  getAuthorizationByToken(token: string): Promise<PatientInsuranceAuthorization | undefined>;
  getAuthorizationById(id: number): Promise<PatientInsuranceAuthorization | undefined>;
  getPatientAuthorizations(patientId: number): Promise<PatientInsuranceAuthorization[]>;
  getPracticeAuthorizations(practiceId: number): Promise<PatientInsuranceAuthorization[]>;
  updateAuthorizationStatus(id: number, updates: Partial<InsertPatientInsuranceAuthorization>): Promise<PatientInsuranceAuthorization>;
  incrementAuthorizationResendCount(id: number): Promise<PatientInsuranceAuthorization>;
  incrementAuthorizationLinkAttempts(id: number): Promise<PatientInsuranceAuthorization>;
  expireStaleAuthorizations(): Promise<number>;

  // Payer Integration operations
  createPayerIntegration(integration: InsertPayerIntegration): Promise<PayerIntegration>;
  getPayerIntegrations(): Promise<PayerIntegration[]>;
  getPayerIntegrationByCode(payerCode: string): Promise<PayerIntegration | undefined>;
  getPayerIntegrationById(id: number): Promise<PayerIntegration | undefined>;
  updatePayerIntegration(id: number, updates: Partial<InsertPayerIntegration>): Promise<PayerIntegration>;

  // Payer Credentials operations
  createPayerCredential(credential: InsertPayerCredential): Promise<PayerCredential>;
  getPayerCredentials(practiceId: number): Promise<PayerCredential[]>;
  getPayerCredentialForPractice(practiceId: number, payerIntegrationId: number): Promise<PayerCredential | undefined>;
  updatePayerCredential(id: number, updates: Partial<InsertPayerCredential>): Promise<PayerCredential>;

  // Insurance Data Cache operations
  cacheInsuranceData(data: InsertInsuranceDataCache): Promise<InsuranceDataCache>;
  getCachedInsuranceData(patientId: number, dataType: string): Promise<InsuranceDataCache | undefined>;
  getCachedInsuranceDataByAuthorization(authorizationId: number): Promise<InsuranceDataCache[]>;
  updateCachedInsuranceData(id: number, updates: Partial<InsertInsuranceDataCache>): Promise<InsuranceDataCache>;
  markCacheAsStale(patientId: number): Promise<void>;
  deleteExpiredCache(): Promise<number>;

  // Audit Log operations
  createAuditLogEntry(entry: InsertAuthorizationAuditLog): Promise<AuthorizationAuditLog>;
  getAuditLogs(filters: { practiceId?: number; patientId?: number; authorizationId?: number; eventType?: string; startDate?: Date; endDate?: Date }): Promise<AuthorizationAuditLog[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations (required for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Practice operations
  async createPractice(practice: InsertPractice): Promise<Practice> {
    const [newPractice] = await db
      .insert(practices)
      .values(practice)
      .returning();
    return newPractice;
  }

  async getPractice(id: number): Promise<Practice | undefined> {
    const [practice] = await db
      .select()
      .from(practices)
      .where(eq(practices.id, id));
    return practice;
  }

  async updatePractice(id: number, practice: Partial<InsertPractice>): Promise<Practice> {
    const [updatedPractice] = await db
      .update(practices)
      .set({ ...practice, updatedAt: new Date() })
      .where(eq(practices.id, id))
      .returning();
    return updatedPractice;
  }

  // Patient operations
  async createPatient(patient: InsertPatient): Promise<Patient> {
    const [newPatient] = await db
      .insert(patients)
      .values(patient)
      .returning();
    return newPatient;
  }

  async getPatients(practiceId: number): Promise<Patient[]> {
    return await db
      .select()
      .from(patients)
      .where(eq(patients.practiceId, practiceId))
      .orderBy(desc(patients.createdAt));
  }



  async getPatient(id: number): Promise<Patient | undefined> {
    const [patient] = await db
      .select()
      .from(patients)
      .where(eq(patients.id, id));
    return patient;
  }

  async updatePatient(id: number, patient: Partial<InsertPatient>): Promise<Patient> {
    const [updatedPatient] = await db
      .update(patients)
      .set({ ...patient, updatedAt: new Date() })
      .where(eq(patients.id, id))
      .returning();
    return updatedPatient;
  }

  // Treatment session operations
  async createTreatmentSession(session: InsertTreatmentSession): Promise<TreatmentSession> {
    const [newSession] = await db
      .insert(treatmentSessions)
      .values(session)
      .returning();
    return newSession;
  }

  async getTreatmentSessions(practiceId: number): Promise<TreatmentSession[]> {
    return await db
      .select()
      .from(treatmentSessions)
      .where(eq(treatmentSessions.practiceId, practiceId))
      .orderBy(desc(treatmentSessions.sessionDate));
  }

  async getTreatmentSession(id: number): Promise<TreatmentSession | undefined> {
    const [session] = await db
      .select()
      .from(treatmentSessions)
      .where(eq(treatmentSessions.id, id));
    return session;
  }

  // Claim operations
  async createClaim(claim: InsertClaim): Promise<Claim> {
    const [newClaim] = await db
      .insert(claims)
      .values(claim)
      .returning();
    return newClaim;
  }

  async getClaims(practiceId: number): Promise<Claim[]> {
    return await db
      .select()
      .from(claims)
      .where(eq(claims.practiceId, practiceId))
      .orderBy(desc(claims.createdAt));
  }

  async getClaim(id: number): Promise<Claim | undefined> {
    const [claim] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, id));
    return claim;
  }

  async updateClaim(id: number, claim: Partial<InsertClaim>): Promise<Claim> {
    const [updatedClaim] = await db
      .update(claims)
      .set({ ...claim, updatedAt: new Date() })
      .where(eq(claims.id, id))
      .returning();
    return updatedClaim;
  }

  // Expense operations
  async createExpense(expense: InsertExpense): Promise<Expense> {
    const [newExpense] = await db
      .insert(expenses)
      .values(expense)
      .returning();
    return newExpense;
  }

  async getExpenses(practiceId: number): Promise<Expense[]> {
    return await db
      .select()
      .from(expenses)
      .where(eq(expenses.practiceId, practiceId))
      .orderBy(desc(expenses.expenseDate));
  }

  async getExpense(id: number): Promise<Expense | undefined> {
    const [expense] = await db
      .select()
      .from(expenses)
      .where(eq(expenses.id, id));
    return expense;
  }

  async updateExpense(id: number, expense: Partial<InsertExpense>): Promise<Expense> {
    const [updatedExpense] = await db
      .update(expenses)
      .set({ ...expense, updatedAt: new Date() })
      .where(eq(expenses.id, id))
      .returning();
    return updatedExpense;
  }

  // Payment operations
  async createPayment(payment: InsertPayment): Promise<Payment> {
    const [newPayment] = await db
      .insert(payments)
      .values(payment)
      .returning();
    return newPayment;
  }

  async getPayments(practiceId: number): Promise<Payment[]> {
    return await db
      .select()
      .from(payments)
      .where(eq(payments.practiceId, practiceId))
      .orderBy(desc(payments.paymentDate));
  }

  // Code operations
  async getCptCodes(): Promise<CptCode[]> {
    return await db
      .select()
      .from(cptCodes)
      .where(eq(cptCodes.isActive, true))
      .orderBy(cptCodes.code);
  }

  async getAllCptCodes(): Promise<CptCode[]> {
    return await db
      .select()
      .from(cptCodes)
      .where(eq(cptCodes.isActive, true))
      .orderBy(cptCodes.code);
  }

  async getIcd10Codes(): Promise<Icd10Code[]> {
    return await db
      .select()
      .from(icd10Codes)
      .where(eq(icd10Codes.isActive, true))
      .orderBy(icd10Codes.code);
  }

  async getInsurances(): Promise<Insurance[]> {
    return await db
      .select()
      .from(insurances)
      .where(eq(insurances.isActive, true))
      .orderBy(insurances.name);
  }

  // SOAP Notes operations
  async createSoapNote(soapNote: InsertSoapNote): Promise<SoapNote> {
    const [created] = await db.insert(soapNotes).values(soapNote).returning();
    return created;
  }



  async getSoapNotes(practiceId?: number): Promise<SoapNote[]> {
    if (practiceId) {
      const results = await db
        .select({
          id: soapNotes.id,
          sessionId: soapNotes.sessionId,
          subjective: soapNotes.subjective,
          objective: soapNotes.objective,
          assessment: soapNotes.assessment,
          plan: soapNotes.plan,
          location: soapNotes.location,
          sessionType: soapNotes.sessionType,
          interventions: soapNotes.interventions,
          progressNotes: soapNotes.progressNotes,
          homeProgram: soapNotes.homeProgram,
          aiSuggestedCptCodes: soapNotes.aiSuggestedCptCodes,
          originalCptCode: soapNotes.originalCptCode,
          optimizedCptCode: soapNotes.optimizedCptCode,
          cptOptimizationReason: soapNotes.cptOptimizationReason,
          dataSource: soapNotes.dataSource,
          createdAt: soapNotes.createdAt,
          updatedAt: soapNotes.updatedAt,
        })
        .from(soapNotes)
        .innerJoin(treatmentSessions, eq(soapNotes.sessionId, treatmentSessions.id))
        .where(eq(treatmentSessions.practiceId, practiceId))
        .orderBy(desc(soapNotes.createdAt));
      return results;
    }
    return await db.select().from(soapNotes).orderBy(desc(soapNotes.createdAt));
  }

  async getSoapNote(id: number): Promise<SoapNote | undefined> {
    const [soapNote] = await db.select().from(soapNotes).where(eq(soapNotes.id, id));
    return soapNote;
  }

  async getSoapNoteBySession(sessionId: number): Promise<SoapNote | undefined> {
    const [soapNote] = await db.select().from(soapNotes).where(eq(soapNotes.sessionId, sessionId));
    return soapNote;
  }

  // Convenience methods for API routes
  async getAllPatients(): Promise<Patient[]> {
    return await db
      .select()
      .from(patients)
      .orderBy(desc(patients.createdAt));
  }

  async getAllSoapNotes(): Promise<SoapNote[]> {
    return await db
      .select()
      .from(soapNotes)
      .orderBy(desc(soapNotes.createdAt));
  }

  async getAllSessions(): Promise<TreatmentSession[]> {
    return await db
      .select()
      .from(treatmentSessions)
      .orderBy(desc(treatmentSessions.createdAt));
  }

  async createSession(session: InsertTreatmentSession): Promise<TreatmentSession> {
    const [created] = await db
      .insert(treatmentSessions)
      .values(session)
      .returning();
    return created;
  }

  // CPT Code Mapping operations
  async getCptCodeMappings(insuranceId?: number): Promise<CptCodeMapping[]> {
    if (insuranceId) {
      return await db.select().from(cptCodeMappings)
        .where(and(eq(cptCodeMappings.insuranceId, insuranceId), eq(cptCodeMappings.isActive, true)));
    }
    return await db.select().from(cptCodeMappings).where(eq(cptCodeMappings.isActive, true));
  }

  async createCptCodeMapping(mapping: any): Promise<CptCodeMapping> {
    const [created] = await db.insert(cptCodeMappings).values(mapping).returning();
    return created;
  }

  // Analytics operations
  async getDashboardStats(practiceId: number): Promise<{
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
      avgDaysToPayment: 14.2, // Mock calculation for now
      monthlyClaimsCount: monthlyClaimsResult.count,
      monthlyRevenue: Number(monthlyRevenueResult.total) || 0,
      denialRate: totalClaims > 0 ? (deniedClaims / totalClaims) * 100 : 0,
      pendingClaims,
    };
  }

  async getRevenueByMonth(practiceId: number, startDate: Date, endDate: Date): Promise<{
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

    return result.map(row => ({
      month: row.month,
      revenue: Number(row.revenue) || 0,
      claims: row.claims,
    }));
  }

  async getClaimsByStatus(practiceId: number): Promise<{
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

    return result.map(row => ({
      status: row.status || "unknown",
      count: row.count,
    }));
  }

  async getTopDenialReasons(practiceId: number): Promise<{
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

    return result.map(row => ({
      reason: row.reason || "Unknown",
      count: row.count,
    }));
  }

  // Insurance Authorization operations
  async createInsuranceAuthorization(authorization: InsertPatientInsuranceAuthorization): Promise<PatientInsuranceAuthorization> {
    const [created] = await db
      .insert(patientInsuranceAuthorizations)
      .values(authorization)
      .returning();
    return created;
  }

  async getAuthorizationByToken(token: string): Promise<PatientInsuranceAuthorization | undefined> {
    const [auth] = await db
      .select()
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.token, token));
    return auth;
  }

  async getAuthorizationById(id: number): Promise<PatientInsuranceAuthorization | undefined> {
    const [auth] = await db
      .select()
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.id, id));
    return auth;
  }

  async getPatientAuthorizations(patientId: number): Promise<PatientInsuranceAuthorization[]> {
    return await db
      .select()
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.patientId, patientId))
      .orderBy(desc(patientInsuranceAuthorizations.createdAt));
  }

  async getPracticeAuthorizations(practiceId: number): Promise<PatientInsuranceAuthorization[]> {
    return await db
      .select()
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.practiceId, practiceId))
      .orderBy(desc(patientInsuranceAuthorizations.createdAt));
  }

  async updateAuthorizationStatus(id: number, updates: Partial<InsertPatientInsuranceAuthorization>): Promise<PatientInsuranceAuthorization> {
    const [updated] = await db
      .update(patientInsuranceAuthorizations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(patientInsuranceAuthorizations.id, id))
      .returning();
    return updated;
  }

  async incrementAuthorizationResendCount(id: number): Promise<PatientInsuranceAuthorization> {
    const [auth] = await db
      .select()
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.id, id));

    const [updated] = await db
      .update(patientInsuranceAuthorizations)
      .set({
        resendCount: (auth.resendCount || 0) + 1,
        lastResendAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(patientInsuranceAuthorizations.id, id))
      .returning();
    return updated;
  }

  async incrementAuthorizationLinkAttempts(id: number): Promise<PatientInsuranceAuthorization> {
    const [auth] = await db
      .select()
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.id, id));

    const [updated] = await db
      .update(patientInsuranceAuthorizations)
      .set({
        linkAttemptCount: (auth.linkAttemptCount || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(patientInsuranceAuthorizations.id, id))
      .returning();
    return updated;
  }

  async expireStaleAuthorizations(): Promise<number> {
    const result = await db
      .update(patientInsuranceAuthorizations)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          eq(patientInsuranceAuthorizations.status, 'pending'),
          lt(patientInsuranceAuthorizations.tokenExpiresAt, new Date())
        )
      )
      .returning();
    return result.length;
  }

  // Payer Integration operations
  async createPayerIntegration(integration: InsertPayerIntegration): Promise<PayerIntegration> {
    const [created] = await db
      .insert(payerIntegrations)
      .values(integration)
      .returning();
    return created;
  }

  async getPayerIntegrations(): Promise<PayerIntegration[]> {
    return await db
      .select()
      .from(payerIntegrations)
      .where(eq(payerIntegrations.isActive, true))
      .orderBy(payerIntegrations.payerName);
  }

  async getPayerIntegrationByCode(payerCode: string): Promise<PayerIntegration | undefined> {
    const [integration] = await db
      .select()
      .from(payerIntegrations)
      .where(eq(payerIntegrations.payerCode, payerCode));
    return integration;
  }

  async getPayerIntegrationById(id: number): Promise<PayerIntegration | undefined> {
    const [integration] = await db
      .select()
      .from(payerIntegrations)
      .where(eq(payerIntegrations.id, id));
    return integration;
  }

  async updatePayerIntegration(id: number, updates: Partial<InsertPayerIntegration>): Promise<PayerIntegration> {
    const [updated] = await db
      .update(payerIntegrations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(payerIntegrations.id, id))
      .returning();
    return updated;
  }

  // Payer Credentials operations
  async createPayerCredential(credential: InsertPayerCredential): Promise<PayerCredential> {
    const [created] = await db
      .insert(payerCredentials)
      .values(credential)
      .returning();
    return created;
  }

  async getPayerCredentials(practiceId: number): Promise<PayerCredential[]> {
    return await db
      .select()
      .from(payerCredentials)
      .where(
        and(
          eq(payerCredentials.practiceId, practiceId),
          eq(payerCredentials.isActive, true)
        )
      );
  }

  async getPayerCredentialForPractice(practiceId: number, payerIntegrationId: number): Promise<PayerCredential | undefined> {
    const [credential] = await db
      .select()
      .from(payerCredentials)
      .where(
        and(
          eq(payerCredentials.practiceId, practiceId),
          eq(payerCredentials.payerIntegrationId, payerIntegrationId),
          eq(payerCredentials.isActive, true)
        )
      );
    return credential;
  }

  async updatePayerCredential(id: number, updates: Partial<InsertPayerCredential>): Promise<PayerCredential> {
    const [updated] = await db
      .update(payerCredentials)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(payerCredentials.id, id))
      .returning();
    return updated;
  }

  // Insurance Data Cache operations
  async cacheInsuranceData(data: InsertInsuranceDataCache): Promise<InsuranceDataCache> {
    const [created] = await db
      .insert(insuranceDataCache)
      .values(data)
      .returning();
    return created;
  }

  async getCachedInsuranceData(patientId: number, dataType: string): Promise<InsuranceDataCache | undefined> {
    const [cached] = await db
      .select()
      .from(insuranceDataCache)
      .where(
        and(
          eq(insuranceDataCache.patientId, patientId),
          eq(insuranceDataCache.dataType, dataType),
          eq(insuranceDataCache.isStale, false)
        )
      )
      .orderBy(desc(insuranceDataCache.fetchedAt))
      .limit(1);
    return cached;
  }

  async getCachedInsuranceDataByAuthorization(authorizationId: number): Promise<InsuranceDataCache[]> {
    return await db
      .select()
      .from(insuranceDataCache)
      .where(eq(insuranceDataCache.authorizationId, authorizationId))
      .orderBy(desc(insuranceDataCache.fetchedAt));
  }

  async updateCachedInsuranceData(id: number, updates: Partial<InsertInsuranceDataCache>): Promise<InsuranceDataCache> {
    const [updated] = await db
      .update(insuranceDataCache)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(insuranceDataCache.id, id))
      .returning();
    return updated;
  }

  async markCacheAsStale(patientId: number): Promise<void> {
    await db
      .update(insuranceDataCache)
      .set({ isStale: true, updatedAt: new Date() })
      .where(eq(insuranceDataCache.patientId, patientId));
  }

  async deleteExpiredCache(): Promise<number> {
    const result = await db
      .delete(insuranceDataCache)
      .where(lt(insuranceDataCache.expiresAt, new Date()))
      .returning();
    return result.length;
  }

  // Audit Log operations
  async createAuditLogEntry(entry: InsertAuthorizationAuditLog): Promise<AuthorizationAuditLog> {
    const [created] = await db
      .insert(authorizationAuditLog)
      .values(entry)
      .returning();
    return created;
  }

  async getAuditLogs(filters: {
    practiceId?: number;
    patientId?: number;
    authorizationId?: number;
    eventType?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<AuthorizationAuditLog[]> {
    const conditions = [];

    if (filters.practiceId) {
      conditions.push(eq(authorizationAuditLog.practiceId, filters.practiceId));
    }
    if (filters.patientId) {
      conditions.push(eq(authorizationAuditLog.patientId, filters.patientId));
    }
    if (filters.authorizationId) {
      conditions.push(eq(authorizationAuditLog.authorizationId, filters.authorizationId));
    }
    if (filters.eventType) {
      conditions.push(eq(authorizationAuditLog.eventType, filters.eventType));
    }
    if (filters.startDate) {
      conditions.push(gte(authorizationAuditLog.createdAt, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(authorizationAuditLog.createdAt, filters.endDate));
    }

    if (conditions.length === 0) {
      return await db
        .select()
        .from(authorizationAuditLog)
        .orderBy(desc(authorizationAuditLog.createdAt))
        .limit(1000);
    }

    return await db
      .select()
      .from(authorizationAuditLog)
      .where(and(...conditions))
      .orderBy(desc(authorizationAuditLog.createdAt))
      .limit(1000);
  }
}

export const storage = new DatabaseStorage();

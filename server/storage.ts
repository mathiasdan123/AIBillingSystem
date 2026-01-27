import {
  users,
  practices,
  patients,
  treatmentSessions,
  claims,
  claimLineItems,
  expenses,
  payments,
  cptCodes,
  icd10Codes,
  insurances,
  soapNotes,
  cptCodeMappings,
  invites,
  eligibilityChecks,
  reimbursementOptimizations,
  auditLog,
  baaRecords,
  patientInsuranceAuthorizations,
  insuranceDataCache,
  payerIntegrationCredentials,
  type User,
  type UpsertUser,
  type Practice,
  type Patient,
  type TreatmentSession,
  type Claim,
  type ClaimLineItem,
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
  type InsertClaimLineItem,
  type InsertExpense,
  type InsertPayment,
  type InsertSoapNote,
  type Invite,
  type InsertInvite,
  type EligibilityCheck,
  type InsertEligibilityCheck,
  type ReimbursementOptimization,
  type InsertReimbursementOptimization,
  type AuditLog,
  type InsertAuditLog,
  type BaaRecord,
  type InsertBaaRecord,
  type PatientInsuranceAuthorization,
  type InsertPatientInsuranceAuthorization,
  type InsuranceDataCache,
  type InsertInsuranceDataCache,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, count, sum, sql, isNull, lt } from "drizzle-orm";
import {
  encryptPatientRecord,
  decryptPatientRecord,
  encryptSoapNoteRecord,
  decryptSoapNoteRecord,
  encryptTreatmentSessionRecord,
  decryptTreatmentSessionRecord,
} from "./services/phiEncryptionService";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;

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

  // Claim Line Items operations
  createClaimLineItem(lineItem: InsertClaimLineItem): Promise<ClaimLineItem>;
  getClaimLineItems(claimId: number): Promise<ClaimLineItem[]>;
  deleteClaimLineItems(claimId: number): Promise<void>;

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

  // Invite operations
  createInvite(invite: InsertInvite): Promise<Invite>;
  getInvitesByPractice(practiceId: number): Promise<Invite[]>;
  getInviteByToken(token: string): Promise<Invite | undefined>;
  getInviteByEmail(email: string): Promise<Invite | undefined>;
  updateInviteStatus(id: number, status: string, acceptedAt?: Date): Promise<Invite | undefined>;

  // Eligibility operations
  createEligibilityCheck(check: InsertEligibilityCheck): Promise<EligibilityCheck>;
  getPatientEligibility(patientId: number): Promise<EligibilityCheck | undefined>;
  getEligibilityHistory(patientId: number): Promise<EligibilityCheck[]>;

  // Appeal/Optimization operations
  createReimbursementOptimization(optimization: InsertReimbursementOptimization): Promise<ReimbursementOptimization>;
  getClaimAppeals(claimId: number): Promise<ReimbursementOptimization[]>;
  updateAppealStatus(id: number, status: string, completedAt?: Date): Promise<ReimbursementOptimization | undefined>;

  // Denied Claims Report operations
  getDeniedClaimsByDateRange(practiceId: number, startDate: Date, endDate: Date): Promise<Claim[]>;
  getDeniedClaimsWithDetails(practiceId: number, startDate: Date, endDate: Date): Promise<{
    claim: Claim;
    patient: Patient | null;
    appeal: ReimbursementOptimization | null;
  }[]>;
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

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
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

  // Patient operations (with PHI encryption)
  async createPatient(patient: InsertPatient): Promise<Patient> {
    const encrypted = encryptPatientRecord(patient as any);
    const [newPatient] = await db
      .insert(patients)
      .values(encrypted as any)
      .returning();
    return decryptPatientRecord(newPatient) as Patient;
  }

  async getPatients(practiceId: number): Promise<Patient[]> {
    const rows = await db
      .select()
      .from(patients)
      .where(and(eq(patients.practiceId, practiceId), isNull(patients.deletedAt)))
      .orderBy(desc(patients.createdAt));
    return rows.map((r: any) => decryptPatientRecord(r) as Patient);
  }

  async getPatient(id: number): Promise<Patient | undefined> {
    const [patient] = await db
      .select()
      .from(patients)
      .where(and(eq(patients.id, id), isNull(patients.deletedAt)));
    return patient ? decryptPatientRecord(patient) as Patient : undefined;
  }

  async updatePatient(id: number, patient: Partial<InsertPatient>): Promise<Patient> {
    const encrypted = encryptPatientRecord(patient as any);
    const [updatedPatient] = await db
      .update(patients)
      .set({ ...encrypted, updatedAt: new Date() })
      .where(eq(patients.id, id))
      .returning();
    return decryptPatientRecord(updatedPatient) as Patient;
  }

  async softDeletePatient(id: number): Promise<void> {
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

  // Treatment session operations (with PHI encryption)
  async createTreatmentSession(session: InsertTreatmentSession): Promise<TreatmentSession> {
    const encrypted = encryptTreatmentSessionRecord(session as any);
    const [newSession] = await db
      .insert(treatmentSessions)
      .values(encrypted as any)
      .returning();
    return decryptTreatmentSessionRecord(newSession) as TreatmentSession;
  }

  async getTreatmentSessions(practiceId: number): Promise<TreatmentSession[]> {
    const rows = await db
      .select()
      .from(treatmentSessions)
      .where(eq(treatmentSessions.practiceId, practiceId))
      .orderBy(desc(treatmentSessions.sessionDate));
    return rows.map((r: any) => decryptTreatmentSessionRecord(r) as TreatmentSession);
  }

  async getTreatmentSession(id: number): Promise<TreatmentSession | undefined> {
    const [session] = await db
      .select()
      .from(treatmentSessions)
      .where(eq(treatmentSessions.id, id));
    return session ? decryptTreatmentSessionRecord(session) as TreatmentSession : undefined;
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

  // Claim Line Items operations
  async createClaimLineItem(lineItem: InsertClaimLineItem): Promise<ClaimLineItem> {
    const [newLineItem] = await db
      .insert(claimLineItems)
      .values(lineItem)
      .returning();
    return newLineItem;
  }

  async getClaimLineItems(claimId: number): Promise<ClaimLineItem[]> {
    return await db
      .select()
      .from(claimLineItems)
      .where(eq(claimLineItems.claimId, claimId));
  }

  async deleteClaimLineItems(claimId: number): Promise<void> {
    await db
      .delete(claimLineItems)
      .where(eq(claimLineItems.claimId, claimId));
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

  // SOAP Notes operations (with PHI encryption)
  async createSoapNote(soapNote: InsertSoapNote): Promise<SoapNote> {
    const encrypted = encryptSoapNoteRecord(soapNote as any);
    const [created] = await db.insert(soapNotes).values(encrypted as any).returning();
    return decryptSoapNoteRecord(created) as SoapNote;
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
      return results.map((r: any) => decryptSoapNoteRecord(r) as SoapNote);
    }
    const rows = await db.select().from(soapNotes).orderBy(desc(soapNotes.createdAt));
    return rows.map((r: any) => decryptSoapNoteRecord(r) as SoapNote);
  }

  async getSoapNote(id: number): Promise<SoapNote | undefined> {
    const [soapNote] = await db.select().from(soapNotes).where(eq(soapNotes.id, id));
    return soapNote ? decryptSoapNoteRecord(soapNote) as SoapNote : undefined;
  }

  async getSoapNoteBySession(sessionId: number): Promise<SoapNote | undefined> {
    const [soapNote] = await db.select().from(soapNotes).where(eq(soapNotes.sessionId, sessionId));
    return soapNote ? decryptSoapNoteRecord(soapNote) as SoapNote : undefined;
  }

  // Convenience methods for API routes
  async getAllPatients(): Promise<Patient[]> {
    const rows = await db
      .select()
      .from(patients)
      .where(isNull(patients.deletedAt))
      .orderBy(desc(patients.createdAt));
    return rows.map((r: any) => decryptPatientRecord(r) as Patient);
  }

  async getAllSoapNotes(): Promise<SoapNote[]> {
    const rows = await db
      .select()
      .from(soapNotes)
      .orderBy(desc(soapNotes.createdAt));
    return rows.map((r: any) => decryptSoapNoteRecord(r) as SoapNote);
  }

  async getAllSessions(): Promise<TreatmentSession[]> {
    const rows = await db
      .select()
      .from(treatmentSessions)
      .orderBy(desc(treatmentSessions.createdAt));
    return rows.map((r: any) => decryptTreatmentSessionRecord(r) as TreatmentSession);
  }

  async createSession(session: InsertTreatmentSession): Promise<TreatmentSession> {
    const encrypted = encryptTreatmentSessionRecord(session as any);
    const [created] = await db
      .insert(treatmentSessions)
      .values(encrypted as any)
      .returning();
    return decryptTreatmentSessionRecord(created) as TreatmentSession;
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

    return result.map((row: any) => ({
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

    return result.map((row: any) => ({
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

    return result.map((row: any) => ({
      reason: row.reason || "Unknown",
      count: row.count,
    }));
  }

  // Invite operations
  async createInvite(invite: InsertInvite): Promise<Invite> {
    const [created] = await db.insert(invites).values(invite).returning();
    return created;
  }

  async getInvitesByPractice(practiceId: number): Promise<Invite[]> {
    return await db
      .select()
      .from(invites)
      .where(eq(invites.practiceId, practiceId))
      .orderBy(desc(invites.createdAt));
  }

  async getInviteByToken(token: string): Promise<Invite | undefined> {
    const [invite] = await db
      .select()
      .from(invites)
      .where(eq(invites.token, token));
    return invite;
  }

  async getInviteByEmail(email: string): Promise<Invite | undefined> {
    const [invite] = await db
      .select()
      .from(invites)
      .where(and(eq(invites.email, email), eq(invites.status, "pending")));
    return invite;
  }

  async updateInviteStatus(id: number, status: string, acceptedAt?: Date): Promise<Invite | undefined> {
    const [updated] = await db
      .update(invites)
      .set({ status, acceptedAt })
      .where(eq(invites.id, id))
      .returning();
    return updated;
  }

  // Eligibility operations
  async createEligibilityCheck(check: InsertEligibilityCheck): Promise<EligibilityCheck> {
    const [created] = await db
      .insert(eligibilityChecks)
      .values(check)
      .returning();
    return created;
  }

  async getPatientEligibility(patientId: number): Promise<EligibilityCheck | undefined> {
    const [check] = await db
      .select()
      .from(eligibilityChecks)
      .where(eq(eligibilityChecks.patientId, patientId))
      .orderBy(desc(eligibilityChecks.checkDate))
      .limit(1);
    return check;
  }

  async getEligibilityHistory(patientId: number): Promise<EligibilityCheck[]> {
    return await db
      .select()
      .from(eligibilityChecks)
      .where(eq(eligibilityChecks.patientId, patientId))
      .orderBy(desc(eligibilityChecks.checkDate));
  }

  // Appeal/Optimization operations
  async createReimbursementOptimization(optimization: InsertReimbursementOptimization): Promise<ReimbursementOptimization> {
    const [created] = await db
      .insert(reimbursementOptimizations)
      .values(optimization)
      .returning();
    return created;
  }

  async getClaimAppeals(claimId: number): Promise<ReimbursementOptimization[]> {
    return await db
      .select()
      .from(reimbursementOptimizations)
      .where(and(
        eq(reimbursementOptimizations.claimId, claimId),
        eq(reimbursementOptimizations.optimizationType, 'appeal')
      ))
      .orderBy(desc(reimbursementOptimizations.createdAt));
  }

  async updateAppealStatus(id: number, status: string, completedAt?: Date): Promise<ReimbursementOptimization | undefined> {
    const [updated] = await db
      .update(reimbursementOptimizations)
      .set({ status, completedAt })
      .where(eq(reimbursementOptimizations.id, id))
      .returning();
    return updated;
  }

  // Denied Claims Report operations
  async getDeniedClaimsByDateRange(practiceId: number, startDate: Date, endDate: Date): Promise<Claim[]> {
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

  async getDeniedClaimsWithDetails(practiceId: number, startDate: Date, endDate: Date): Promise<{
    claim: Claim;
    patient: Patient | null;
    appeal: ReimbursementOptimization | null;
  }[]> {
    const deniedClaims = await this.getDeniedClaimsByDateRange(practiceId, startDate, endDate);

    const results = await Promise.all(
      deniedClaims.map(async (claim) => {
        const patient = claim.patientId ? await this.getPatient(claim.patientId) : null;
        const appeals = await this.getClaimAppeals(claim.id);
        const appeal = appeals.length > 0 ? appeals[0] : null;

        return {
          claim,
          patient: patient || null,
          appeal,
        };
      })
    );

    return results;
  }

  // ==================== HIPAA COMPLIANCE METHODS ====================

  // Audit Log
  async createAuditLog(entry: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLog).values(entry).returning();
    return created;
  }

  async getAuditLogsForResource(resourceType: string, resourceId: string): Promise<AuditLog[]> {
    return await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.resourceType, resourceType), eq(auditLog.resourceId, resourceId)))
      .orderBy(desc(auditLog.createdAt));
  }

  // BAA Records
  async createBaaRecord(record: InsertBaaRecord): Promise<BaaRecord> {
    const [created] = await db.insert(baaRecords).values(record).returning();
    return created;
  }

  async getBaaRecords(practiceId: number): Promise<BaaRecord[]> {
    return await db
      .select()
      .from(baaRecords)
      .where(eq(baaRecords.practiceId, practiceId))
      .orderBy(desc(baaRecords.createdAt));
  }

  async updateBaaRecord(id: number, record: Partial<InsertBaaRecord>): Promise<BaaRecord> {
    const [updated] = await db
      .update(baaRecords)
      .set({ ...record, updatedAt: new Date() })
      .where(eq(baaRecords.id, id))
      .returning();
    return updated;
  }

  async deleteBaaRecord(id: number): Promise<void> {
    await db.delete(baaRecords).where(eq(baaRecords.id, id));
  }

  async getExpiringBaaRecords(daysAhead: number): Promise<BaaRecord[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);
    return await db
      .select()
      .from(baaRecords)
      .where(and(
        eq(baaRecords.status, 'active'),
        lte(baaRecords.expirationDate, futureDate.toISOString().split('T')[0]),
      ));
  }

  // Patient Insurance Authorization
  async createPatientInsuranceAuth(auth: InsertPatientInsuranceAuthorization): Promise<PatientInsuranceAuthorization> {
    const [created] = await db.insert(patientInsuranceAuthorizations).values(auth).returning();
    return created;
  }

  async getPatientInsuranceAuth(patientId: number): Promise<PatientInsuranceAuthorization | undefined> {
    const [auth] = await db
      .select()
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.patientId, patientId))
      .orderBy(desc(patientInsuranceAuthorizations.createdAt))
      .limit(1);
    return auth;
  }

  async getInsuranceAuthByToken(token: string): Promise<PatientInsuranceAuthorization | undefined> {
    const [auth] = await db
      .select()
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.token, token));
    return auth;
  }

  async updateInsuranceAuth(id: number, data: Partial<InsertPatientInsuranceAuthorization>): Promise<PatientInsuranceAuthorization> {
    const [updated] = await db
      .update(patientInsuranceAuthorizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(patientInsuranceAuthorizations.id, id))
      .returning();
    return updated;
  }

  // Insurance Data Cache
  async cacheInsuranceData(data: InsertInsuranceDataCache): Promise<InsuranceDataCache> {
    const [created] = await db.insert(insuranceDataCache).values(data).returning();
    return created;
  }

  async getCachedInsuranceData(patientId: number): Promise<InsuranceDataCache | undefined> {
    const [cached] = await db
      .select()
      .from(insuranceDataCache)
      .where(and(eq(insuranceDataCache.patientId, patientId), eq(insuranceDataCache.status, 'valid')))
      .orderBy(desc(insuranceDataCache.verifiedAt))
      .limit(1);
    return cached;
  }

  async getPatientsWithStaleEligibility(daysOld: number): Promise<Patient[]> {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - daysOld);

    // Get patients with authorized insurance verification whose latest cache is stale
    const authorizedPatientIds = await db
      .select({ patientId: patientInsuranceAuthorizations.patientId })
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.status, 'authorized'));

    const ids = authorizedPatientIds.map((r: any) => r.patientId);
    if (ids.length === 0) return [];

    const stalePatients: Patient[] = [];
    for (const patientId of ids) {
      const cached = await this.getCachedInsuranceData(patientId);
      if (!cached || (cached.verifiedAt && new Date(cached.verifiedAt) < staleDate)) {
        const patient = await this.getPatient(patientId);
        if (patient) stalePatients.push(patient);
      }
    }
    return stalePatients;
  }

  // Payer Integration Credentials
  async getPayerCredentials(practiceId: number, payerName: string): Promise<any | undefined> {
    const [cred] = await db
      .select()
      .from(payerIntegrationCredentials)
      .where(and(
        eq(payerIntegrationCredentials.practiceId, practiceId),
        eq(payerIntegrationCredentials.payerName, payerName),
        eq(payerIntegrationCredentials.isActive, true),
      ));
    return cred;
  }

  async upsertPayerCredentials(practiceId: number, payerName: string, apiKey: any, config?: any): Promise<void> {
    const existing = await this.getPayerCredentials(practiceId, payerName);
    if (existing) {
      await db
        .update(payerIntegrationCredentials)
        .set({ apiKey, additionalConfig: config, updatedAt: new Date() })
        .where(eq(payerIntegrationCredentials.id, existing.id));
    } else {
      await db.insert(payerIntegrationCredentials).values({
        practiceId,
        payerName,
        apiKey,
        additionalConfig: config,
      });
    }
  }

  async getAllPayerCredentials(practiceId: number): Promise<any[]> {
    return await db
      .select()
      .from(payerIntegrationCredentials)
      .where(eq(payerIntegrationCredentials.practiceId, practiceId));
  }

  async updatePayerHealthStatus(id: number, status: string): Promise<void> {
    await db
      .update(payerIntegrationCredentials)
      .set({ healthStatus: status, lastHealthCheck: new Date(), updatedAt: new Date() })
      .where(eq(payerIntegrationCredentials.id, id));
  }

  // MFA helpers
  async updateUserMfa(userId: string, data: { mfaEnabled?: boolean; mfaSecret?: any; mfaBackupCodes?: any }): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();

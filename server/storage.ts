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
  payerCredentials,
  payerIntegrations,
  authorizationAuditLog,
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
  type Appointment,
  type InsertAppointment,
  appointments,
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

  // ==================== APPOINTMENT METHODS ====================

  async createAppointment(data: InsertAppointment): Promise<Appointment> {
    const [created] = await db.insert(appointments).values(data).returning();
    return created;
  }

  async getAppointments(practiceId: number): Promise<Appointment[]> {
    return await db
      .select()
      .from(appointments)
      .where(eq(appointments.practiceId, practiceId))
      .orderBy(desc(appointments.startTime));
  }

  async getAppointmentsByDateRange(practiceId: number, start: Date, end: Date): Promise<Appointment[]> {
    return await db
      .select()
      .from(appointments)
      .where(and(
        eq(appointments.practiceId, practiceId),
        gte(appointments.startTime, start),
        lte(appointments.startTime, end)
      ))
      .orderBy(appointments.startTime);
  }

  async getAppointment(id: number): Promise<Appointment | undefined> {
    const [appt] = await db.select().from(appointments).where(eq(appointments.id, id));
    return appt;
  }

  async updateAppointment(id: number, data: Partial<InsertAppointment>): Promise<Appointment> {
    const [updated] = await db
      .update(appointments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(appointments.id, id))
      .returning();
    return updated;
  }

  async cancelAppointment(id: number, reason: string, notes?: string): Promise<Appointment> {
    const [updated] = await db
      .update(appointments)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: reason,
        cancellationNotes: notes || null,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, id))
      .returning();
    return updated;
  }

  // ==================== CANCELLATION ANALYTICS ====================

  async getCancellationStats(practiceId: number, start: Date, end: Date): Promise<{
    totalScheduled: number;
    totalCancelled: number;
    totalNoShow: number;
    cancellationRate: number;
    noShowRate: number;
    lateCancellations: number;
    avgLeadTimeHours: number;
  }> {
    const allAppts = await db
      .select()
      .from(appointments)
      .where(and(
        eq(appointments.practiceId, practiceId),
        gte(appointments.startTime, start),
        lte(appointments.startTime, end)
      ));

    const totalScheduled = allAppts.length;
    const cancelled = allAppts.filter((a: Appointment) => a.status === "cancelled");
    const totalCancelled = cancelled.length;
    const totalNoShow = allAppts.filter((a: Appointment) => a.status === "no_show" || a.cancellationReason === "no_show").length;

    // Late cancellations: cancelled within 24h of startTime
    const lateCancellations = cancelled.filter((a: Appointment) => {
      if (!a.cancelledAt || !a.startTime) return false;
      const leadMs = new Date(a.startTime).getTime() - new Date(a.cancelledAt).getTime();
      return leadMs >= 0 && leadMs < 24 * 60 * 60 * 1000;
    }).length;

    // Average lead time in hours
    const leadTimes = cancelled
      .filter((a: Appointment) => a.cancelledAt && a.startTime)
      .map((a: Appointment) => {
        const leadMs = new Date(a.startTime).getTime() - new Date(a.cancelledAt!).getTime();
        return Math.max(0, leadMs / (1000 * 60 * 60));
      });
    const avgLeadTimeHours = leadTimes.length > 0
      ? leadTimes.reduce((s: number, v: number) => s + v, 0) / leadTimes.length
      : 0;

    return {
      totalScheduled,
      totalCancelled,
      totalNoShow,
      cancellationRate: totalScheduled > 0 ? (totalCancelled / totalScheduled) * 100 : 0,
      noShowRate: totalScheduled > 0 ? (totalNoShow / totalScheduled) * 100 : 0,
      lateCancellations,
      avgLeadTimeHours: Math.round(avgLeadTimeHours * 10) / 10,
    };
  }

  async getCancellationsByPatient(practiceId: number, start: Date, end: Date): Promise<{
    patientId: number;
    patientName: string;
    totalAppointments: number;
    cancellations: number;
    noShows: number;
    lateCancellations: number;
  }[]> {
    const allAppts = await db
      .select()
      .from(appointments)
      .where(and(
        eq(appointments.practiceId, practiceId),
        gte(appointments.startTime, start),
        lte(appointments.startTime, end)
      ));

    // Group by patientId
    const byPatient: Record<number, Appointment[]> = {};
    for (const a of allAppts) {
      if (!a.patientId) continue;
      if (!byPatient[a.patientId]) byPatient[a.patientId] = [];
      byPatient[a.patientId].push(a);
    }

    const results = [];
    for (const patientIdStr of Object.keys(byPatient)) {
      const patientId = Number(patientIdStr);
      const appts = byPatient[patientId];
      const patient = await this.getPatient(patientId);
      const cancelled = appts.filter((a: Appointment) => a.status === "cancelled");
      const noShows = appts.filter((a: Appointment) => a.status === "no_show" || a.cancellationReason === "no_show").length;
      const lateCancellations = cancelled.filter((a: Appointment) => {
        if (!a.cancelledAt || !a.startTime) return false;
        const leadMs = new Date(a.startTime).getTime() - new Date(a.cancelledAt).getTime();
        return leadMs >= 0 && leadMs < 24 * 60 * 60 * 1000;
      }).length;

      results.push({
        patientId,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
        totalAppointments: appts.length,
        cancellations: cancelled.length,
        noShows,
        lateCancellations,
      });
    }

    return results.sort((a, b) => b.cancellations - a.cancellations);
  }

  async getCancellationTrend(practiceId: number, start: Date, end: Date): Promise<{
    month: string;
    scheduled: number;
    cancelled: number;
    noShows: number;
    rate: number;
  }[]> {
    const allAppts = await db
      .select()
      .from(appointments)
      .where(and(
        eq(appointments.practiceId, practiceId),
        gte(appointments.startTime, start),
        lte(appointments.startTime, end)
      ));

    const byMonth: Record<string, Appointment[]> = {};
    for (const a of allAppts) {
      const month = new Date(a.startTime).toISOString().slice(0, 7); // YYYY-MM
      if (!byMonth[month]) byMonth[month] = [];
      byMonth[month].push(a);
    }

    const result = [];
    for (const month of Object.keys(byMonth).sort()) {
      const appts = byMonth[month];
      const scheduled = appts.length;
      const cancelled = appts.filter((a: Appointment) => a.status === "cancelled").length;
      const noShows = appts.filter((a: Appointment) => a.status === "no_show" || a.cancellationReason === "no_show").length;
      result.push({
        month,
        scheduled,
        cancelled,
        noShows,
        rate: scheduled > 0 ? Math.round((cancelled / scheduled) * 1000) / 10 : 0,
      });
    }

    return result;
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

  async getCachedInsuranceData(patientId: number, dataType?: string): Promise<InsuranceDataCache | undefined> {
    const conditions = [eq(insuranceDataCache.patientId, patientId)];
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
      if (!cached || (cached.fetchedAt && new Date(cached.fetchedAt) < staleDate)) {
        const patient = await this.getPatient(patientId);
        if (patient) stalePatients.push(patient);
      }
    }
    return stalePatients;
  }

  // Payer Integration Credentials
  async getPayerCredentials(practiceId: number, payerName?: string): Promise<any | undefined> {
    const [cred] = await db
      .select()
      .from(payerCredentials)
      .where(and(
        eq(payerCredentials.practiceId, practiceId),
        eq(payerCredentials.isActive, true),
      ));
    return cred;
  }

  async upsertPayerCredentials(practiceId: number, data: any): Promise<void> {
    const existing = await this.getPayerCredentials(practiceId);
    if (existing) {
      await db
        .update(payerCredentials)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(payerCredentials.id, existing.id));
    } else {
      await db.insert(payerCredentials).values({
        practiceId,
        ...data,
      } as any);
    }
  }

  async getAllPayerCredentials(practiceId: number): Promise<any[]> {
    return await db
      .select()
      .from(payerCredentials)
      .where(eq(payerCredentials.practiceId, practiceId));
  }

  async updatePayerHealthStatus(id: number, status: string): Promise<void> {
    await db
      .update(payerCredentials)
      .set({ updatedAt: new Date() } as any)
      .where(eq(payerCredentials.id, id));
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

  // ==================== MISSING METHOD ALIASES/STUBS ====================

  async createAuditLogEntry(entry: any): Promise<any> {
    return this.createAuditLog(entry);
  }

  async getPatientAuthorizations(patientId: number): Promise<PatientInsuranceAuthorization[]> {
    return await db
      .select()
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.patientId, patientId))
      .orderBy(desc(patientInsuranceAuthorizations.createdAt));
  }

  async getPayerCredentialForPractice(practiceId: number, payerIntegrationId: number): Promise<any | undefined> {
    const [cred] = await db
      .select()
      .from(payerCredentials)
      .where(and(
        eq(payerCredentials.practiceId, practiceId),
        eq(payerCredentials.payerIntegrationId, payerIntegrationId),
        eq(payerCredentials.isActive, true),
      ));
    return cred;
  }

  async updatePayerCredential(id: number, data: any): Promise<any> {
    const [updated] = await db
      .update(payerCredentials)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(payerCredentials.id, id))
      .returning();
    return updated;
  }

  async createPayerCredential(data: any): Promise<any> {
    const [created] = await db
      .insert(payerCredentials)
      .values(data)
      .returning();
    return created;
  }

  async getPayerIntegrationByCode(code: string): Promise<any | undefined> {
    const [integration] = await db
      .select()
      .from(payerIntegrations)
      .where(eq(payerIntegrations.payerCode, code));
    return integration;
  }

  async getPayerIntegrations(): Promise<any[]> {
    return await db.select().from(payerIntegrations);
  }

  async getAuditLogs(filters: any): Promise<any[]> {
    // Basic query - filters can be extended as needed
    return await db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(100);
  }

  async updateAuthorizationStatus(id: number, data: any): Promise<any> {
    const [updated] = await db
      .update(patientInsuranceAuthorizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(patientInsuranceAuthorizations.id, id))
      .returning();
    return updated;
  }

  async getAuthorizationByToken(token: string): Promise<PatientInsuranceAuthorization | undefined> {
    return this.getInsuranceAuthByToken(token);
  }

  async getAuthorizationById(id: number): Promise<PatientInsuranceAuthorization | undefined> {
    const [auth] = await db
      .select()
      .from(patientInsuranceAuthorizations)
      .where(eq(patientInsuranceAuthorizations.id, id));
    return auth;
  }

  async createInsuranceAuthorization(data: any): Promise<PatientInsuranceAuthorization> {
    const [created] = await db
      .insert(patientInsuranceAuthorizations)
      .values(data)
      .returning();
    return created;
  }

  async incrementAuthorizationResendCount(id: number): Promise<void> {
    // no-op stub
  }

  async incrementAuthorizationLinkAttempts(id: number): Promise<void> {
    // no-op stub
  }

  async markCacheAsStale(patientId: number): Promise<void> {
    await db
      .update(insuranceDataCache)
      .set({ isStale: true, updatedAt: new Date() })
      .where(eq(insuranceDataCache.patientId, patientId));
  }

  async updatePayerIntegration(id: number, data: any): Promise<any> {
    const [updated] = await db
      .update(payerIntegrations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(payerIntegrations.id, id))
      .returning();
    return updated;
  }

  async getAllPayerCredentialsList(practiceId?: number): Promise<any[]> {
    if (practiceId) {
      return this.getAllPayerCredentials(practiceId);
    }
    return await db.select().from(payerCredentials);
  }
}

export const storage = new DatabaseStorage();

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
  appeals,
  waitlist,
  reviewRequests,
  googleReviews,
  appointmentTypes,
  therapistAvailability,
  therapistTimeOff,
  bookingSettings,
  onlineBookings,
  telehealthSessions,
  telehealthSettings,
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
  breachIncidents,
  amendmentRequests,
  type BreachIncident,
  type InsertBreachIncident,
  type AmendmentRequest,
  type InsertAmendmentRequest,
  type Appeal,
  type InsertAppeal,
  type WaitlistEntry,
  type InsertWaitlistEntry,
  type ReviewRequest,
  type InsertReviewRequest,
  type GoogleReview,
  type InsertGoogleReview,
  type AppointmentType,
  type InsertAppointmentType,
  type TherapistAvailability,
  type InsertTherapistAvailability,
  type TherapistTimeOff,
  type InsertTherapistTimeOff,
  type BookingSettings,
  type InsertBookingSettings,
  type OnlineBooking,
  type InsertOnlineBooking,
  type TelehealthSession,
  type InsertTelehealthSession,
  type TelehealthSettings,
  type InsertTelehealthSettings,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, count, sum, sql, isNull, lt, ne, inArray } from "drizzle-orm";
import { createHash } from "crypto";
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

  async getTherapistsByPractice(practiceId: number): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(and(
        eq(users.practiceId, practiceId),
        eq(users.role, 'therapist')
      ));
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

  async cancelAppointment(id: number, reason: string, notes?: string, cancelledBy?: string): Promise<Appointment> {
    const [updated] = await db
      .update(appointments)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: cancelledBy || null,
        cancellationReason: reason,
        cancellationNotes: notes || null,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, id))
      .returning();
    return updated;
  }

  async getAppointmentsForReminder(
    practiceId: number,
    windowStart: Date,
    windowEnd: Date
  ): Promise<Appointment[]> {
    return await db
      .select()
      .from(appointments)
      .where(and(
        eq(appointments.practiceId, practiceId),
        eq(appointments.status, 'scheduled'),
        eq(appointments.reminderSent, false),
        gte(appointments.startTime, windowStart),
        lte(appointments.startTime, windowEnd)
      ))
      .orderBy(appointments.startTime);
  }

  async getUpcomingAppointments(practiceId: number, hoursAhead: number = 48): Promise<Appointment[]> {
    const now = new Date();
    const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    return await db
      .select()
      .from(appointments)
      .where(and(
        eq(appointments.practiceId, practiceId),
        eq(appointments.status, 'scheduled'),
        gte(appointments.startTime, now),
        lte(appointments.startTime, future)
      ))
      .orderBy(appointments.startTime);
  }

  // ==================== WAITLIST MANAGEMENT ====================

  async createWaitlistEntry(entry: InsertWaitlistEntry): Promise<WaitlistEntry> {
    const [result] = await db.insert(waitlist).values(entry).returning();
    return result;
  }

  async getWaitlist(practiceId: number, filters?: {
    status?: string;
    therapistId?: string;
    patientId?: number;
    priority?: number;
  }): Promise<WaitlistEntry[]> {
    const conditions = [eq(waitlist.practiceId, practiceId)];

    if (filters?.status) {
      conditions.push(eq(waitlist.status, filters.status));
    }
    if (filters?.therapistId) {
      conditions.push(eq(waitlist.therapistId, filters.therapistId));
    }
    if (filters?.patientId) {
      conditions.push(eq(waitlist.patientId, filters.patientId));
    }
    if (filters?.priority) {
      conditions.push(eq(waitlist.priority, filters.priority));
    }

    return await db
      .select()
      .from(waitlist)
      .where(and(...conditions))
      .orderBy(desc(waitlist.priority), waitlist.createdAt);
  }

  async getWaitlistEntry(id: number): Promise<WaitlistEntry | undefined> {
    const [result] = await db
      .select()
      .from(waitlist)
      .where(eq(waitlist.id, id));
    return result;
  }

  async updateWaitlistEntry(id: number, updates: Partial<InsertWaitlistEntry>): Promise<WaitlistEntry> {
    const [result] = await db
      .update(waitlist)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(waitlist.id, id))
      .returning();
    return result;
  }

  async deleteWaitlistEntry(id: number): Promise<void> {
    await db.delete(waitlist).where(eq(waitlist.id, id));
  }

  async getWaitlistForSlot(
    practiceId: number,
    therapistId: string | null,
    slotDate: Date,
    slotTimeStart: string
  ): Promise<WaitlistEntry[]> {
    // Get waiting entries that match the slot
    const dayOfWeek = slotDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    const entries = await db
      .select()
      .from(waitlist)
      .where(and(
        eq(waitlist.practiceId, practiceId),
        eq(waitlist.status, 'waiting')
      ))
      .orderBy(desc(waitlist.priority), waitlist.createdAt);

    // Filter by preferred days and times
    return entries.filter((entry: WaitlistEntry) => {
      // Check if therapist matches (if preferred)
      if (entry.therapistId && therapistId && entry.therapistId !== therapistId) {
        return false;
      }

      // Check preferred days
      const preferredDays = entry.preferredDays as string[] | null;
      if (preferredDays && preferredDays.length > 0) {
        if (!preferredDays.includes(dayOfWeek)) {
          return false;
        }
      }

      // Check preferred time range
      if (entry.preferredTimeStart && entry.preferredTimeEnd) {
        if (slotTimeStart < entry.preferredTimeStart || slotTimeStart > entry.preferredTimeEnd) {
          return false;
        }
      }

      // Check expiration
      if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
        return false;
      }

      return true;
    });
  }

  async markWaitlistNotified(id: number, slot: { date: string; time: string; therapistId?: string }): Promise<WaitlistEntry> {
    const [result] = await db
      .update(waitlist)
      .set({
        status: 'notified',
        notifiedAt: new Date(),
        notifiedSlot: slot,
        updatedAt: new Date(),
      })
      .where(eq(waitlist.id, id))
      .returning();
    return result;
  }

  async markWaitlistScheduled(id: number, appointmentId: number): Promise<WaitlistEntry> {
    const [result] = await db
      .update(waitlist)
      .set({
        status: 'scheduled',
        scheduledAppointmentId: appointmentId,
        updatedAt: new Date(),
      })
      .where(eq(waitlist.id, id))
      .returning();
    return result;
  }

  async getWaitlistStats(practiceId: number): Promise<{
    totalWaiting: number;
    notified: number;
    scheduled: number;
    expired: number;
    highPriority: number;
    averageWaitDays: number;
  }> {
    const entries = await db
      .select()
      .from(waitlist)
      .where(eq(waitlist.practiceId, practiceId));

    const now = new Date();
    let totalWaitMs = 0;
    let waitingCount = 0;

    const stats = entries.reduce((acc: { totalWaiting: number; notified: number; scheduled: number; expired: number; highPriority: number }, entry: WaitlistEntry) => {
      if (entry.status === 'waiting') {
        acc.totalWaiting++;
        if (entry.priority && entry.priority >= 2) acc.highPriority++;
        if (entry.createdAt) {
          totalWaitMs += now.getTime() - new Date(entry.createdAt).getTime();
          waitingCount++;
        }
      } else if (entry.status === 'notified') {
        acc.notified++;
      } else if (entry.status === 'scheduled') {
        acc.scheduled++;
      } else if (entry.status === 'expired') {
        acc.expired++;
      }
      return acc;
    }, { totalWaiting: 0, notified: 0, scheduled: 0, expired: 0, highPriority: 0 });

    const averageWaitDays = waitingCount > 0
      ? Math.round((totalWaitMs / waitingCount) / (1000 * 60 * 60 * 24))
      : 0;

    return { ...stats, averageWaitDays };
  }

  async expireOldWaitlistEntries(practiceId: number): Promise<number> {
    const now = new Date();
    const result = await db
      .update(waitlist)
      .set({ status: 'expired', updatedAt: now })
      .where(and(
        eq(waitlist.practiceId, practiceId),
        eq(waitlist.status, 'waiting'),
        lt(waitlist.expiresAt, now)
      ))
      .returning();
    return result.length;
  }

  // ==================== REVIEW MANAGEMENT ====================

  async createReviewRequest(request: InsertReviewRequest): Promise<ReviewRequest> {
    const [result] = await db.insert(reviewRequests).values(request).returning();
    return result;
  }

  async getReviewRequests(practiceId: number, filters?: {
    status?: string;
    patientId?: number;
    startDate?: Date;
    endDate?: Date;
  }): Promise<ReviewRequest[]> {
    const conditions = [eq(reviewRequests.practiceId, practiceId)];

    if (filters?.status) {
      conditions.push(eq(reviewRequests.status, filters.status));
    }
    if (filters?.patientId) {
      conditions.push(eq(reviewRequests.patientId, filters.patientId));
    }
    if (filters?.startDate) {
      conditions.push(gte(reviewRequests.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(reviewRequests.createdAt, filters.endDate));
    }

    return await db
      .select()
      .from(reviewRequests)
      .where(and(...conditions))
      .orderBy(desc(reviewRequests.createdAt));
  }

  async getReviewRequest(id: number): Promise<ReviewRequest | undefined> {
    const [result] = await db
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.id, id));
    return result;
  }

  async updateReviewRequest(id: number, updates: Partial<InsertReviewRequest>): Promise<ReviewRequest> {
    const [result] = await db
      .update(reviewRequests)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(reviewRequests.id, id))
      .returning();
    return result;
  }

  async getReviewRequestStats(practiceId: number): Promise<{
    totalSent: number;
    pending: number;
    clicked: number;
    reviewed: number;
    declined: number;
    clickRate: number;
    reviewRate: number;
  }> {
    const requests = await db
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.practiceId, practiceId));

    const stats = requests.reduce((acc: { totalSent: number; pending: number; clicked: number; reviewed: number; declined: number }, req: ReviewRequest) => {
      if (req.status === 'sent') acc.totalSent++;
      if (req.status === 'pending') acc.pending++;
      if (req.status === 'clicked') acc.clicked++;
      if (req.status === 'reviewed') acc.reviewed++;
      if (req.status === 'declined') acc.declined++;
      return acc;
    }, { totalSent: 0, pending: 0, clicked: 0, reviewed: 0, declined: 0 });

    const sentCount = stats.totalSent + stats.clicked + stats.reviewed;
    const clickRate = sentCount > 0 ? Math.round((stats.clicked + stats.reviewed) / sentCount * 100) : 0;
    const reviewRate = sentCount > 0 ? Math.round(stats.reviewed / sentCount * 100) : 0;

    return { ...stats, clickRate, reviewRate };
  }

  async getPatientsEligibleForReview(practiceId: number, daysSinceAppointment: number = 1): Promise<{
    patientId: number;
    appointmentId: number;
    appointmentDate: Date;
  }[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysSinceAppointment);
    const cutoffEnd = new Date(cutoffDate);
    cutoffEnd.setDate(cutoffEnd.getDate() - 1);

    // Get completed appointments from the target day that haven't had review requests
    const eligibleAppointments = await db
      .select({
        patientId: appointments.patientId,
        appointmentId: appointments.id,
        appointmentDate: appointments.startTime,
      })
      .from(appointments)
      .leftJoin(reviewRequests, eq(appointments.id, reviewRequests.appointmentId))
      .where(and(
        eq(appointments.practiceId, practiceId),
        eq(appointments.status, 'completed'),
        lte(appointments.startTime, cutoffDate),
        gte(appointments.startTime, cutoffEnd),
        isNull(reviewRequests.id)
      ));

    return eligibleAppointments.filter((a: { patientId: number | null; appointmentId: number; appointmentDate: Date }) => a.patientId !== null) as {
      patientId: number;
      appointmentId: number;
      appointmentDate: Date;
    }[];
  }

  // Google Reviews CRUD
  async createGoogleReview(review: InsertGoogleReview): Promise<GoogleReview> {
    const [result] = await db.insert(googleReviews).values(review).returning();
    return result;
  }

  async getGoogleReviews(practiceId: number, filters?: {
    responseStatus?: string;
    sentiment?: string;
    minRating?: number;
    maxRating?: number;
  }): Promise<GoogleReview[]> {
    const conditions = [eq(googleReviews.practiceId, practiceId)];

    if (filters?.responseStatus) {
      conditions.push(eq(googleReviews.responseStatus, filters.responseStatus));
    }
    if (filters?.sentiment) {
      conditions.push(eq(googleReviews.sentiment, filters.sentiment));
    }
    if (filters?.minRating) {
      conditions.push(gte(googleReviews.rating, filters.minRating));
    }
    if (filters?.maxRating) {
      conditions.push(lte(googleReviews.rating, filters.maxRating));
    }

    return await db
      .select()
      .from(googleReviews)
      .where(and(...conditions))
      .orderBy(desc(googleReviews.reviewDate));
  }

  async getGoogleReview(id: number): Promise<GoogleReview | undefined> {
    const [result] = await db
      .select()
      .from(googleReviews)
      .where(eq(googleReviews.id, id));
    return result;
  }

  async updateGoogleReview(id: number, updates: Partial<InsertGoogleReview>): Promise<GoogleReview> {
    const [result] = await db
      .update(googleReviews)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(googleReviews.id, id))
      .returning();
    return result;
  }

  async getReviewStats(practiceId: number): Promise<{
    totalReviews: number;
    averageRating: number;
    pendingResponses: number;
    positiveCount: number;
    neutralCount: number;
    negativeCount: number;
    ratingDistribution: Record<number, number>;
  }> {
    const reviews = await db
      .select()
      .from(googleReviews)
      .where(eq(googleReviews.practiceId, practiceId));

    const stats = {
      totalReviews: reviews.length,
      averageRating: 0,
      pendingResponses: 0,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>,
    };

    if (reviews.length === 0) return stats;

    let totalRating = 0;
    for (const review of reviews) {
      if (review.rating) {
        totalRating += review.rating;
        stats.ratingDistribution[review.rating] = (stats.ratingDistribution[review.rating] || 0) + 1;
      }
      if (review.responseStatus === 'pending') stats.pendingResponses++;
      if (review.sentiment === 'positive') stats.positiveCount++;
      if (review.sentiment === 'neutral') stats.neutralCount++;
      if (review.sentiment === 'negative') stats.negativeCount++;
    }

    stats.averageRating = Math.round((totalRating / reviews.length) * 10) / 10;
    return stats;
  }

  // ==================== ONLINE BOOKING ====================

  // Appointment Types
  async createAppointmentType(type: InsertAppointmentType): Promise<AppointmentType> {
    const [result] = await db.insert(appointmentTypes).values(type).returning();
    return result;
  }

  async getAppointmentTypes(practiceId: number, activeOnly: boolean = false): Promise<AppointmentType[]> {
    const conditions = [eq(appointmentTypes.practiceId, practiceId)];
    if (activeOnly) {
      conditions.push(eq(appointmentTypes.isActive, true));
    }
    return await db.select().from(appointmentTypes).where(and(...conditions));
  }

  async getAppointmentType(id: number): Promise<AppointmentType | undefined> {
    const [result] = await db.select().from(appointmentTypes).where(eq(appointmentTypes.id, id));
    return result;
  }

  async updateAppointmentType(id: number, updates: Partial<InsertAppointmentType>): Promise<AppointmentType> {
    const [result] = await db
      .update(appointmentTypes)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(appointmentTypes.id, id))
      .returning();
    return result;
  }

  async deleteAppointmentType(id: number): Promise<void> {
    await db.delete(appointmentTypes).where(eq(appointmentTypes.id, id));
  }

  // Therapist Availability
  async setTherapistAvailability(availability: InsertTherapistAvailability): Promise<TherapistAvailability> {
    // Upsert - update if exists for same therapist/day, insert otherwise
    const existing = await db
      .select()
      .from(therapistAvailability)
      .where(and(
        eq(therapistAvailability.therapistId, availability.therapistId),
        eq(therapistAvailability.dayOfWeek, availability.dayOfWeek)
      ));

    if (existing.length > 0) {
      const [result] = await db
        .update(therapistAvailability)
        .set({ ...availability, updatedAt: new Date() })
        .where(eq(therapistAvailability.id, existing[0].id))
        .returning();
      return result;
    }

    const [result] = await db.insert(therapistAvailability).values(availability).returning();
    return result;
  }

  async getTherapistAvailability(therapistId: string): Promise<TherapistAvailability[]> {
    return await db
      .select()
      .from(therapistAvailability)
      .where(eq(therapistAvailability.therapistId, therapistId))
      .orderBy(therapistAvailability.dayOfWeek);
  }

  async getPracticeAvailability(practiceId: number): Promise<TherapistAvailability[]> {
    return await db
      .select()
      .from(therapistAvailability)
      .where(eq(therapistAvailability.practiceId, practiceId))
      .orderBy(therapistAvailability.therapistId, therapistAvailability.dayOfWeek);
  }

  async deleteTherapistAvailability(id: number): Promise<void> {
    await db.delete(therapistAvailability).where(eq(therapistAvailability.id, id));
  }

  // Therapist Time Off
  async addTherapistTimeOff(timeOff: InsertTherapistTimeOff): Promise<TherapistTimeOff> {
    const [result] = await db.insert(therapistTimeOff).values(timeOff).returning();
    return result;
  }

  async getTherapistTimeOff(therapistId: string, startDate?: Date, endDate?: Date): Promise<TherapistTimeOff[]> {
    const conditions = [eq(therapistTimeOff.therapistId, therapistId)];
    if (startDate) {
      conditions.push(gte(therapistTimeOff.endDate, startDate.toISOString().split('T')[0]));
    }
    if (endDate) {
      conditions.push(lte(therapistTimeOff.startDate, endDate.toISOString().split('T')[0]));
    }
    return await db.select().from(therapistTimeOff).where(and(...conditions));
  }

  async deleteTherapistTimeOff(id: number): Promise<void> {
    await db.delete(therapistTimeOff).where(eq(therapistTimeOff.id, id));
  }

  // Booking Settings
  async getBookingSettings(practiceId: number): Promise<BookingSettings | undefined> {
    const [result] = await db
      .select()
      .from(bookingSettings)
      .where(eq(bookingSettings.practiceId, practiceId));
    return result;
  }

  async getBookingSettingsBySlug(slug: string): Promise<BookingSettings | undefined> {
    const [result] = await db
      .select()
      .from(bookingSettings)
      .where(eq(bookingSettings.bookingPageSlug, slug));
    return result;
  }

  async upsertBookingSettings(settings: InsertBookingSettings): Promise<BookingSettings> {
    const existing = await this.getBookingSettings(settings.practiceId);
    if (existing) {
      const [result] = await db
        .update(bookingSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(bookingSettings.id, existing.id))
        .returning();
      return result;
    }
    const [result] = await db.insert(bookingSettings).values(settings).returning();
    return result;
  }

  // Online Bookings
  async createOnlineBooking(booking: InsertOnlineBooking): Promise<OnlineBooking> {
    // Generate confirmation code
    const confirmationCode = `BK${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const [result] = await db
      .insert(onlineBookings)
      .values({ ...booking, confirmationCode })
      .returning();
    return result;
  }

  async getOnlineBookings(practiceId: number, filters?: {
    status?: string;
    therapistId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<OnlineBooking[]> {
    const conditions = [eq(onlineBookings.practiceId, practiceId)];
    if (filters?.status) {
      conditions.push(eq(onlineBookings.status, filters.status));
    }
    if (filters?.therapistId) {
      conditions.push(eq(onlineBookings.therapistId, filters.therapistId));
    }
    if (filters?.startDate) {
      conditions.push(gte(onlineBookings.requestedDate, filters.startDate.toISOString().split('T')[0]));
    }
    if (filters?.endDate) {
      conditions.push(lte(onlineBookings.requestedDate, filters.endDate.toISOString().split('T')[0]));
    }
    return await db
      .select()
      .from(onlineBookings)
      .where(and(...conditions))
      .orderBy(desc(onlineBookings.createdAt));
  }

  async getOnlineBooking(id: number): Promise<OnlineBooking | undefined> {
    const [result] = await db.select().from(onlineBookings).where(eq(onlineBookings.id, id));
    return result;
  }

  async getOnlineBookingByCode(code: string): Promise<OnlineBooking | undefined> {
    const [result] = await db
      .select()
      .from(onlineBookings)
      .where(eq(onlineBookings.confirmationCode, code));
    return result;
  }

  async updateOnlineBooking(id: number, updates: Partial<InsertOnlineBooking>): Promise<OnlineBooking> {
    const [result] = await db
      .update(onlineBookings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(onlineBookings.id, id))
      .returning();
    return result;
  }

  async confirmOnlineBooking(id: number, appointmentId: number): Promise<OnlineBooking> {
    const [result] = await db
      .update(onlineBookings)
      .set({
        status: 'confirmed',
        appointmentId,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(onlineBookings.id, id))
      .returning();
    return result;
  }

  async cancelOnlineBooking(id: number, reason?: string): Promise<OnlineBooking> {
    const [result] = await db
      .update(onlineBookings)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(onlineBookings.id, id))
      .returning();
    return result;
  }

  async getAvailableSlots(
    practiceId: number,
    therapistId: string | null,
    appointmentTypeId: number,
    date: Date
  ): Promise<string[]> {
    // Get the appointment type for duration
    const appointmentType = await this.getAppointmentType(appointmentTypeId);
    if (!appointmentType) return [];

    const dayOfWeek = date.getDay();
    const dateStr = date.toISOString().split('T')[0];

    // Get therapist availability for this day
    let availabilities: TherapistAvailability[];
    if (therapistId) {
      availabilities = await db
        .select()
        .from(therapistAvailability)
        .where(and(
          eq(therapistAvailability.practiceId, practiceId),
          eq(therapistAvailability.therapistId, therapistId),
          eq(therapistAvailability.dayOfWeek, dayOfWeek),
          eq(therapistAvailability.isAvailable, true)
        ));
    } else {
      availabilities = await db
        .select()
        .from(therapistAvailability)
        .where(and(
          eq(therapistAvailability.practiceId, practiceId),
          eq(therapistAvailability.dayOfWeek, dayOfWeek),
          eq(therapistAvailability.isAvailable, true)
        ));
    }

    if (availabilities.length === 0) return [];

    // Get existing appointments for this date
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const existingAppointments = await db
      .select()
      .from(appointments)
      .where(and(
        eq(appointments.practiceId, practiceId),
        gte(appointments.startTime, startOfDay),
        lte(appointments.startTime, endOfDay),
        ne(appointments.status, 'cancelled')
      ));

    // Check time off
    const timeOffs = therapistId
      ? await this.getTherapistTimeOff(therapistId, date, date)
      : [];

    if (timeOffs.length > 0) return [];

    // Generate available slots
    const slots: string[] = [];
    const duration = appointmentType.duration;
    const bufferBefore = appointmentType.bufferBefore || 0;
    const bufferAfter = appointmentType.bufferAfter || 0;
    const totalDuration = duration + bufferBefore + bufferAfter;

    for (const avail of availabilities) {
      const [startHour, startMin] = avail.startTime.split(':').map(Number);
      const [endHour, endMin] = avail.endTime.split(':').map(Number);

      let currentTime = startHour * 60 + startMin;
      const endTime = endHour * 60 + endMin;

      while (currentTime + duration <= endTime) {
        const slotHour = Math.floor(currentTime / 60);
        const slotMin = currentTime % 60;
        const slotTime = `${slotHour.toString().padStart(2, '0')}:${slotMin.toString().padStart(2, '0')}`;

        // Check if slot conflicts with existing appointments
        const slotStart = new Date(date);
        slotStart.setHours(slotHour, slotMin, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + duration * 60000);

        const hasConflict = existingAppointments.some((apt: { startTime: Date; endTime: Date }) => {
          const aptStart = new Date(apt.startTime);
          const aptEnd = new Date(apt.endTime);
          return (slotStart < aptEnd && slotEnd > aptStart);
        });

        if (!hasConflict) {
          slots.push(slotTime);
        }

        currentTime += 30; // 30 minute intervals
      }
    }

    return Array.from(new Set(slots)).sort();
  }

  // ==================== TELEHEALTH ====================

  // Telehealth Sessions
  async createTelehealthSession(session: InsertTelehealthSession): Promise<TelehealthSession> {
    const [result] = await db.insert(telehealthSessions).values(session).returning();
    return result;
  }

  async getTelehealthSessions(practiceId: number, filters?: {
    status?: string;
    therapistId?: string;
    patientId?: number;
    startDate?: Date;
    endDate?: Date;
  }): Promise<TelehealthSession[]> {
    const conditions = [eq(telehealthSessions.practiceId, practiceId)];

    if (filters?.status) {
      conditions.push(eq(telehealthSessions.status, filters.status));
    }
    if (filters?.therapistId) {
      conditions.push(eq(telehealthSessions.therapistId, filters.therapistId));
    }
    if (filters?.patientId) {
      conditions.push(eq(telehealthSessions.patientId, filters.patientId));
    }
    if (filters?.startDate) {
      conditions.push(gte(telehealthSessions.scheduledStart, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(telehealthSessions.scheduledStart, filters.endDate));
    }

    return await db
      .select()
      .from(telehealthSessions)
      .where(and(...conditions))
      .orderBy(desc(telehealthSessions.scheduledStart));
  }

  async getTelehealthSession(id: number): Promise<TelehealthSession | undefined> {
    const [result] = await db
      .select()
      .from(telehealthSessions)
      .where(eq(telehealthSessions.id, id));
    return result;
  }

  async getTelehealthSessionByRoom(roomName: string): Promise<TelehealthSession | undefined> {
    const [result] = await db
      .select()
      .from(telehealthSessions)
      .where(eq(telehealthSessions.roomName, roomName));
    return result;
  }

  async getTelehealthSessionByAppointment(appointmentId: number): Promise<TelehealthSession | undefined> {
    const [result] = await db
      .select()
      .from(telehealthSessions)
      .where(eq(telehealthSessions.appointmentId, appointmentId));
    return result;
  }

  async getTelehealthSessionByAccessCode(code: string): Promise<TelehealthSession | undefined> {
    const [result] = await db
      .select()
      .from(telehealthSessions)
      .where(eq(telehealthSessions.patientAccessCode, code));
    return result;
  }

  async updateTelehealthSession(id: number, updates: Partial<InsertTelehealthSession>): Promise<TelehealthSession> {
    const [result] = await db
      .update(telehealthSessions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(telehealthSessions.id, id))
      .returning();
    return result;
  }

  async startTelehealthSession(id: number, isTherapist: boolean): Promise<TelehealthSession> {
    const session = await this.getTelehealthSession(id);
    if (!session) throw new Error('Session not found');

    const updates: Record<string, unknown> = {};

    if (isTherapist) {
      updates.therapistJoinedAt = new Date();
      if (session.status === 'waiting' || session.status === 'scheduled') {
        updates.status = 'in_progress';
        updates.actualStart = new Date();
      }
    } else {
      updates.patientJoinedAt = new Date();
      if (session.status === 'scheduled') {
        updates.status = 'waiting';
      }
    }

    const [result] = await db
      .update(telehealthSessions)
      .set(updates)
      .where(eq(telehealthSessions.id, id))
      .returning();
    return result;
  }

  async endTelehealthSession(id: number): Promise<TelehealthSession> {
    const session = await this.getTelehealthSession(id);
    if (!session) throw new Error('Session not found');

    const actualEnd = new Date();
    const actualStart = session.actualStart ? new Date(session.actualStart) : actualEnd;
    const duration = Math.round((actualEnd.getTime() - actualStart.getTime()) / 60000);

    const [result] = await db
      .update(telehealthSessions)
      .set({
        status: 'completed',
        actualEnd,
        duration,
        updatedAt: new Date(),
      })
      .where(eq(telehealthSessions.id, id))
      .returning();
    return result;
  }

  async getUpcomingTelehealthSessions(practiceId: number, hoursAhead: number = 24): Promise<TelehealthSession[]> {
    const now = new Date();
    const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    return await db
      .select()
      .from(telehealthSessions)
      .where(and(
        eq(telehealthSessions.practiceId, practiceId),
        eq(telehealthSessions.status, 'scheduled'),
        gte(telehealthSessions.scheduledStart, now),
        lte(telehealthSessions.scheduledStart, future)
      ))
      .orderBy(telehealthSessions.scheduledStart);
  }

  async getTodaysTelehealthSessions(practiceId: number, therapistId?: string): Promise<TelehealthSession[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const conditions = [
      eq(telehealthSessions.practiceId, practiceId),
      gte(telehealthSessions.scheduledStart, today),
      lt(telehealthSessions.scheduledStart, tomorrow),
    ];

    if (therapistId) {
      conditions.push(eq(telehealthSessions.therapistId, therapistId));
    }

    return await db
      .select()
      .from(telehealthSessions)
      .where(and(...conditions))
      .orderBy(telehealthSessions.scheduledStart);
  }

  // Telehealth Settings
  async getTelehealthSettings(practiceId: number): Promise<TelehealthSettings | undefined> {
    const [result] = await db
      .select()
      .from(telehealthSettings)
      .where(eq(telehealthSettings.practiceId, practiceId));
    return result;
  }

  async upsertTelehealthSettings(settings: InsertTelehealthSettings): Promise<TelehealthSettings> {
    const existing = await this.getTelehealthSettings(settings.practiceId);
    if (existing) {
      const [result] = await db
        .update(telehealthSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(telehealthSettings.id, existing.id))
        .returning();
      return result;
    }
    const [result] = await db.insert(telehealthSettings).values(settings).returning();
    return result;
  }

  // Generate unique room name
  generateTelehealthRoomName(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `session-${timestamp}-${random}`;
  }

  // Generate patient access code (6 characters, easy to type)
  generatePatientAccessCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // removed confusing chars
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
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

  // Audit Log (with integrity hash chain)
  async createAuditLog(entry: InsertAuditLog): Promise<AuditLog> {
    // Get the last entry's integrity hash to chain
    const [lastEntry] = await db
      .select({ integrityHash: auditLog.integrityHash })
      .from(auditLog)
      .orderBy(desc(auditLog.id))
      .limit(1);

    const previousHash = lastEntry?.integrityHash || "GENESIS";
    const entryData = JSON.stringify(entry);
    const hash = createHash("sha256")
      .update(previousHash + entryData)
      .digest("hex");

    const [created] = await db
      .insert(auditLog)
      .values({ ...entry, integrityHash: hash })
      .returning();
    return created;
  }

  async verifyAuditLogIntegrity(limit?: number): Promise<{ valid: boolean; checkedCount: number; brokenAtId?: number }> {
    const entries = await db
      .select()
      .from(auditLog)
      .orderBy(auditLog.id)
      .limit(limit || 1000);

    let previousHash = "GENESIS";
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.integrityHash) {
        // Skip entries created before hash chain was introduced
        continue;
      }
      const { integrityHash, id, createdAt, ...entryFields } = entry;
      const entryData = JSON.stringify(entryFields);
      const expectedHash = createHash("sha256")
        .update(previousHash + entryData)
        .digest("hex");

      if (integrityHash !== expectedHash) {
        return { valid: false, checkedCount: i + 1, brokenAtId: entry.id };
      }
      previousHash = integrityHash;
    }
    return { valid: true, checkedCount: entries.length };
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

  // Get admin users for a practice (for email alerts)
  async getAdminsByPractice(practiceId: number): Promise<{ id: string; email: string }[]> {
    const admins = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.practiceId, practiceId)));
    return admins.filter((a: any): a is { id: string; email: string } => !!a.email);
  }

  // Hard delete a patient and all related records
  async hardDeletePatient(id: number): Promise<void> {
    // Delete related records first (order matters for FK constraints)
    // 1. SOAP notes via sessions
    const patientSessions = await db
      .select({ id: treatmentSessions.id })
      .from(treatmentSessions)
      .where(eq(treatmentSessions.patientId, id));
    for (const session of patientSessions) {
      await db.delete(soapNotes).where(eq(soapNotes.sessionId, session.id));
    }

    // 2. Claim line items via claims
    const patientClaims = await db
      .select({ id: claims.id })
      .from(claims)
      .where(eq(claims.patientId, id));
    for (const claim of patientClaims) {
      await db.delete(claimLineItems).where(eq(claimLineItems.claimId, claim.id));
    }

    // 3. Claims
    await db.delete(claims).where(eq(claims.patientId, id));

    // 4. Treatment sessions
    await db.delete(treatmentSessions).where(eq(treatmentSessions.patientId, id));

    // 5. Appointments
    await db.delete(appointments).where(eq(appointments.patientId, id));

    // 6. Eligibility checks
    await db.delete(eligibilityChecks).where(eq(eligibilityChecks.patientId, id));

    // 7. Insurance authorizations
    await db.delete(patientInsuranceAuthorizations).where(eq(patientInsuranceAuthorizations.patientId, id));

    // 8. Insurance data cache
    await db.delete(insuranceDataCache).where(eq(insuranceDataCache.patientId, id));

    // 9. Finally, the patient record itself
    await db.delete(patients).where(eq(patients.id, id));
  }

  // Get soft-deleted patients whose retention period has expired
  async getExpiredSoftDeletedPatients(retentionDays: number): Promise<Patient[]> {
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

  async getAllPayerCredentialsList(practiceId?: number): Promise<any[]> {
    if (practiceId) {
      return this.getAllPayerCredentials(practiceId);
    }
    return await db.select().from(payerCredentials);
  }

  // ==================== BREACH INCIDENT METHODS ====================

  async createBreachIncident(data: InsertBreachIncident): Promise<BreachIncident> {
    const [created] = await db.insert(breachIncidents).values(data).returning();
    return created;
  }

  async getBreachIncident(id: number): Promise<BreachIncident | undefined> {
    const [incident] = await db.select().from(breachIncidents).where(eq(breachIncidents.id, id));
    return incident;
  }

  async updateBreachIncident(id: number, data: Partial<InsertBreachIncident>): Promise<BreachIncident> {
    const [updated] = await db
      .update(breachIncidents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(breachIncidents.id, id))
      .returning();
    return updated;
  }

  async getBreachIncidentsByPractice(practiceId: number): Promise<BreachIncident[]> {
    return await db
      .select()
      .from(breachIncidents)
      .where(eq(breachIncidents.practiceId, practiceId))
      .orderBy(desc(breachIncidents.createdAt));
  }

  async getBreachesRequiringNotification(): Promise<BreachIncident[]> {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    return await db
      .select()
      .from(breachIncidents)
      .where(
        and(
          ne(breachIncidents.notificationStatus, "complete"),
          ne(breachIncidents.status, "closed"),
          gte(breachIncidents.discoveredAt, sixtyDaysAgo)
        )
      )
      .orderBy(breachIncidents.discoveredAt);
  }

  // ==================== AMENDMENT REQUEST METHODS ====================

  async createAmendmentRequest(data: InsertAmendmentRequest): Promise<AmendmentRequest> {
    const [created] = await db.insert(amendmentRequests).values(data).returning();
    return created;
  }

  async getAmendmentRequest(id: number): Promise<AmendmentRequest | undefined> {
    const [request] = await db.select().from(amendmentRequests).where(eq(amendmentRequests.id, id));
    return request;
  }

  async updateAmendmentRequest(id: number, data: Partial<InsertAmendmentRequest>): Promise<AmendmentRequest> {
    const [updated] = await db
      .update(amendmentRequests)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(amendmentRequests.id, id))
      .returning();
    return updated;
  }

  async getAmendmentRequestsByPatient(patientId: number): Promise<AmendmentRequest[]> {
    return await db
      .select()
      .from(amendmentRequests)
      .where(eq(amendmentRequests.patientId, patientId))
      .orderBy(desc(amendmentRequests.createdAt));
  }

  async getPendingAmendmentRequests(practiceId: number): Promise<AmendmentRequest[]> {
    return await db
      .select()
      .from(amendmentRequests)
      .where(
        and(
          eq(amendmentRequests.practiceId, practiceId),
          inArray(amendmentRequests.status, ["pending", "extended"])
        )
      )
      .orderBy(amendmentRequests.responseDeadline);
  }

  // ==================== APPEALS MANAGEMENT METHODS ====================

  async createAppeal(data: InsertAppeal): Promise<Appeal> {
    const [created] = await db.insert(appeals).values(data).returning();
    return created;
  }

  async getAppeals(practiceId: number, filters?: {
    status?: string;
    appealLevel?: string;
    deadlineWithinDays?: number;
  }): Promise<Appeal[]> {
    const conditions = [eq(appeals.practiceId, practiceId)];

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

  async getAppealById(id: number): Promise<Appeal | undefined> {
    const [appeal] = await db.select().from(appeals).where(eq(appeals.id, id));
    return appeal;
  }

  async getAppealsByClaimId(claimId: number): Promise<Appeal[]> {
    return await db
      .select()
      .from(appeals)
      .where(eq(appeals.claimId, claimId))
      .orderBy(desc(appeals.createdAt));
  }

  async updateAppealRecord(id: number, data: Partial<InsertAppeal>): Promise<Appeal> {
    const [updated] = await db
      .update(appeals)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(appeals.id, id))
      .returning();
    return updated;
  }

  async getAppealsDashboard(practiceId: number): Promise<{
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

    // Get all appeals for practice
    const allAppeals = await db
      .select()
      .from(appeals)
      .where(eq(appeals.practiceId, practiceId));

    // Get denied claims without appeals
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

    // Appeals pending submission (draft or ready status)
    const pendingSubmission = allAppeals.filter((a: Appeal) =>
      a.status === 'draft' || a.status === 'ready'
    ).length;

    // Appeals past deadline
    const pastDeadline = allAppeals.filter((a: Appeal) =>
      a.deadlineDate && new Date(a.deadlineDate) < now &&
      !['won', 'lost', 'partial'].includes(a.status)
    ).length;

    // Success rate and recovered amount (last 90 days)
    const recentAppeals = allAppeals.filter((a: Appeal) =>
      a.resolvedDate && new Date(a.resolvedDate) >= ninetyDaysAgo
    );
    const wonAppeals = recentAppeals.filter((a: Appeal) =>
      a.status === 'won' || a.status === 'partial'
    );

    const last90DaysWon = wonAppeals.length;
    const last90DaysTotal = recentAppeals.length;
    const successRate = last90DaysTotal > 0 ? (last90DaysWon / last90DaysTotal) * 100 : 0;

    // Total recovered amount
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

  async getUpcomingDeadlines(practiceId: number, days: number): Promise<Appeal[]> {
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

  async getDeniedClaimsForAppeals(practiceId: number): Promise<Claim[]> {
    // Get claims that are denied and don't have an active appeal
    const deniedClaims = await db
      .select()
      .from(claims)
      .where(and(
        eq(claims.practiceId, practiceId),
        eq(claims.status, 'denied')
      ))
      .orderBy(desc(claims.updatedAt));

    // Filter out claims that already have an active appeal
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
}

export const storage = new DatabaseStorage();

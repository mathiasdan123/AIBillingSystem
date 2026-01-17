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
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, count, sum, sql } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();

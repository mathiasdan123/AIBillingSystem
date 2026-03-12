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
  insuranceRates,
  cptCodeEquivalencies,
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
  patientConsents,
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
  type InsuranceRate,
  type CptCodeEquivalency,
  type InsertCptCodeEquivalency,
  type InsertInsuranceRate,
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
  patientFeedback,
  type PatientFeedback,
  type InsertPatientFeedback,
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
  type PatientConsent,
  type InsertPatientConsent,
  conversations,
  messages,
  messageNotifications,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type MessageNotification,
  type InsertMessageNotification,
  patientPortalAccess,
  patientDocuments,
  patientStatements,
  type PatientPortalAccess,
  type InsertPatientPortalAccess,
  type PatientDocument,
  type InsertPatientDocument,
  type PatientStatement,
  type InsertPatientStatement,
  eligibilityAlerts,
  type EligibilityAlert,
  type InsertEligibilityAlert,
  treatmentPlans,
  treatmentGoals,
  treatmentObjectives,
  treatmentInterventions,
  goalProgressNotes,
  type TreatmentPlan,
  type InsertTreatmentPlan,
  type TreatmentGoal,
  type InsertTreatmentGoal,
  type TreatmentObjective,
  type InsertTreatmentObjective,
  type TreatmentIntervention,
  type InsertTreatmentIntervention,
  type GoalProgressNote,
  type InsertGoalProgressNote,
  outcomeMeasureTemplates,
  patientAssessments,
  assessmentSchedules,
  type OutcomeMeasureTemplate,
  type InsertOutcomeMeasureTemplate,
  type PatientAssessment,
  type InsertPatientAssessment,
  type AssessmentSchedule,
  type InsertAssessmentSchedule,
  referralSources,
  referrals,
  referralCommunications,
  type ReferralSource,
  type InsertReferralSource,
  type Referral,
  type InsertReferral,
  type ReferralCommunication,
  type InsertReferralCommunication,
  patientPaymentMethods,
  paymentTransactions,
  paymentPlans,
  paymentPlanInstallments,
  practicePaymentSettings,
  type PatientPaymentMethod,
  type InsertPatientPaymentMethod,
  type PaymentTransaction,
  type InsertPaymentTransaction,
  type PaymentPlan,
  type InsertPaymentPlan,
  type PaymentPlanInstallment,
  type InsertPaymentPlanInstallment,
  type PracticePaymentSettings,
  type InsertPracticePaymentSettings,
  therapyBank,
  type TherapyBank,
  type InsertTherapyBank,
  exerciseBank,
  type ExerciseBank,
  type InsertExerciseBank,
  appointmentRequests,
  type AppointmentRequest,
  type InsertAppointmentRequest,
  claimOutcomes,
  type ClaimOutcome,
  type InsertClaimOutcome,
  patientPlanDocuments,
  type PatientPlanDocument,
  type InsertPatientPlanDocument,
  patientPlanBenefits,
  type PatientPlanBenefits,
  type InsertPatientPlanBenefits,
  webhookEvents,
  type WebhookEvent,
  patientPayments,
  type PatientPayment,
  type InsertPatientPayment,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, count, sum, sql, isNull, lt, ne, inArray, or } from "drizzle-orm";
import { createHash } from "crypto";
import {
  encryptPatientRecord,
  decryptPatientRecord,
  encryptSoapNoteRecord,
  decryptSoapNoteRecord,
  encryptTreatmentSessionRecord,
  decryptTreatmentSessionRecord,
  encryptTelehealthSessionRecord,
  decryptTelehealthSessionRecord,
  encryptTelehealthSettingsRecord,
  decryptTelehealthSettingsRecord,
  encryptUserRecord,
  decryptUserRecord,
  encryptPracticeRecord,
  decryptPracticeRecord,
  encryptDataCaptureEventRecord,
  decryptDataCaptureEventRecord,
  encryptPracticePaymentSettingsRecord,
  decryptPracticePaymentSettingsRecord,
} from "./services/phiEncryptionService";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;

  // Password authentication operations
  getUserByEmail(email: string): Promise<User | undefined>;
  createUserWithPassword(userData: {
    email: string;
    passwordHash: string;
    firstName?: string;
    lastName?: string;
    practiceId?: number;
    role?: string;
  }): Promise<User>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  setPasswordResetToken(userId: string, token: string, expires: Date): Promise<void>;
  clearPasswordResetToken(userId: string): Promise<void>;
  getUserByPasswordResetToken(token: string): Promise<User | undefined>;
  incrementFailedLoginAttempts(userId: string): Promise<number>;
  resetFailedLoginAttempts(userId: string): Promise<void>;
  setLockout(userId: string, lockoutUntil: Date): Promise<void>;
  setEmailVerificationToken(userId: string, token: string, expires: Date): Promise<void>;
  getUserByEmailVerificationToken(token: string): Promise<User | undefined>;
  verifyEmail(userId: string): Promise<void>;
  updateLastLoginAt(userId: string): Promise<void>;
  clearAllUserSessions(userId: string): Promise<void>;

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
  updateSoapNoteCosignStatus(id: number, data: {
    cosignedBy?: string;
    cosignedAt?: Date;
    cosignStatus: string;
    cosignRejectionReason?: string;
  }): Promise<SoapNote | undefined>;
  getPendingCosignNotes(supervisorId: string): Promise<SoapNote[]>;

  // User supervision operations
  getSupervisees(supervisorId: string): Promise<User[]>;
  updateUserSupervision(userId: string, supervisorId: string | null, requiresCosign: boolean): Promise<User | undefined>;

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

  // Enhanced Analytics operations
  getCollectionRate(practiceId: number): Promise<{
    totalBilled: number;
    totalCollected: number;
    collectionRate: number;
    target: number;
    byInsurance: { name: string; billed: number; collected: number; rate: number }[];
  }>;

  getCleanClaimsRate(practiceId: number): Promise<{
    totalSubmitted: number;
    acceptedFirstPass: number;
    cleanClaimsRate: number;
    target: number;
    rejectionReasons: { reason: string; count: number }[];
  }>;

  getCapacityUtilization(practiceId: number, start: Date, end: Date): Promise<{
    totalSlots: number;
    bookedSlots: number;
    completedAppointments: number;
    arrivedRate: number;
    target: number;
    byTherapist: { name: string; utilization: number }[];
  }>;

  getDaysInAR(practiceId: number): Promise<{
    averageDays: number;
    byBucket: { bucket: string; count: number; amount: number }[];
    byInsurance: { name: string; avgDays: number; outstanding: number }[];
  }>;

  getRevenueForecast(practiceId: number, monthsAhead: number): Promise<{
    month: string;
    predicted: number;
    confidence: { low: number; high: number };
  }[]>;

  getTopReferringProviders(practiceId: number): Promise<{
    sources: { name: string; referralCount: number; revenue: number }[];
    totalReferrals: number;
  }>;

  getRevenueByLocationAndTherapist(practiceId: number, startDate?: Date, endDate?: Date): Promise<{
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
  }>;

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

  // Therapy Bank operations
  getTherapyBank(practiceId: number): Promise<TherapyBank[]>;
  createTherapyBankEntry(entry: InsertTherapyBank): Promise<TherapyBank>;
  deleteTherapyBankEntry(id: number): Promise<void>;

  // Exercise Bank operations
  getExerciseBank(practiceId: number, category?: string): Promise<ExerciseBank[]>;
  createExerciseBankEntry(entry: InsertExerciseBank): Promise<ExerciseBank>;
  deleteExerciseBankEntry(id: number): Promise<void>;

  // Webhook event idempotency operations
  getWebhookEvent(eventId: string): Promise<WebhookEvent | undefined>;
  createWebhookEvent(eventId: string, eventType: string, status: string, metadata?: any): Promise<WebhookEvent>;
  updateWebhookEventStatus(eventId: string, status: string): Promise<void>;

  // Patient Payments operations
  createPatientPayment(payment: InsertPatientPayment): Promise<PatientPayment>;
  getPatientPayments(patientId: number): Promise<PatientPayment[]>;
  getPatientPaymentsByPractice(practiceId: number): Promise<PatientPayment[]>;

  // Patient Billing AR Aging (statement-based)
  getPatientArAging(practiceId: number): Promise<{
    totalOutstanding: number;
    buckets: { bucket: string; count: number; amount: number }[];
    byPatient: { patientId: number; patientName: string; totalOwed: number; oldestDays: number }[];
  }>;
}

export class DatabaseStorage implements IStorage {
  // User operations (required for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user ? decryptUserRecord(user) as User : undefined;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const encrypted = encryptUserRecord(userData as any);
    const [user] = await db
      .insert(users)
      .values(encrypted as any)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...encrypted,
          updatedAt: new Date(),
        },
      })
      .returning();
    return decryptUserRecord(user) as User;
  }

  async getAllUsers(): Promise<User[]> {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    return rows.map((r: any) => decryptUserRecord(r) as User);
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user ? decryptUserRecord(user) as User : undefined;
  }

  // Password authentication operations
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user ? decryptUserRecord(user) as User : undefined;
  }

  async createUserWithPassword(userData: {
    email: string;
    passwordHash: string;
    firstName?: string;
    lastName?: string;
    practiceId?: number;
    role?: string;
  }): Promise<User> {
    const { nanoid } = await import('nanoid');
    const userId = nanoid();
    const record = {
      id: userId,
      email: userData.email,
      passwordHash: userData.passwordHash,
      firstName: userData.firstName,
      lastName: userData.lastName,
      practiceId: userData.practiceId,
      role: userData.role || 'therapist',
      emailVerified: false,
      failedLoginAttempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const encrypted = encryptUserRecord(record as any);
    const [user] = await db
      .insert(users)
      .values(encrypted as any)
      .returning();
    return decryptUserRecord(user) as User;
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async setPasswordResetToken(userId: string, token: string, expires: Date): Promise<void> {
    await db
      .update(users)
      .set({
        passwordResetToken: token,
        passwordResetExpires: expires,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async clearPasswordResetToken(userId: string): Promise<void> {
    await db
      .update(users)
      .set({
        passwordResetToken: null,
        passwordResetExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async getUserByPasswordResetToken(token: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.passwordResetToken, token));
    return user ? decryptUserRecord(user) as User : undefined;
  }

  async incrementFailedLoginAttempts(userId: string): Promise<number> {
    const [user] = await db
      .update(users)
      .set({
        failedLoginAttempts: sql`COALESCE(${users.failedLoginAttempts}, 0) + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({ failedLoginAttempts: users.failedLoginAttempts });
    return user?.failedLoginAttempts || 1;
  }

  async resetFailedLoginAttempts(userId: string): Promise<void> {
    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockoutUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async setLockout(userId: string, lockoutUntil: Date): Promise<void> {
    await db
      .update(users)
      .set({
        lockoutUntil,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async setEmailVerificationToken(userId: string, token: string, expires: Date): Promise<void> {
    await db
      .update(users)
      .set({
        emailVerificationToken: token,
        emailVerificationExpires: expires,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async getUserByEmailVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailVerificationToken, token));
    return user ? decryptUserRecord(user) as User : undefined;
  }

  async verifyEmail(userId: string): Promise<void> {
    await db
      .update(users)
      .set({
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async updateLastLoginAt(userId: string): Promise<void> {
    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async clearAllUserSessions(userId: string): Promise<void> {
    // Clear all sessions for this user by deleting session records
    // Sessions are stored with the user ID in the sess JSON column
    await db.execute(sql`
      DELETE FROM sessions
      WHERE sess::text LIKE ${`%"sub":"${userId}"%`}
    `);
  }

  async getTherapistsByPractice(practiceId: number): Promise<User[]> {
    const rows = await db
      .select()
      .from(users)
      .where(and(
        eq(users.practiceId, practiceId),
        eq(users.role, 'therapist')
      ));
    return rows.map((r: any) => decryptUserRecord(r) as User);
  }

  async updateUser(id: string, updates: Partial<{
    firstName: string;
    lastName: string;
    email: string;
    credentials: string;
    licenseNumber: string;
    npiNumber: string;
    digitalSignature: string;
    signatureUploadedAt: Date;
    practiceId: number;
    role: string;
  }>): Promise<User | undefined> {
    const encrypted = encryptUserRecord(updates as any);
    const [user] = await db
      .update(users)
      .set({ ...encrypted, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user ? decryptUserRecord(user) as User : undefined;
  }

  // Practice operations (with PHI encryption for tax IDs, API keys, sensitive contact info)
  async createPractice(practice: InsertPractice): Promise<Practice> {
    const encrypted = encryptPracticeRecord(practice as any);
    const [newPractice] = await db
      .insert(practices)
      .values(encrypted as any)
      .returning();
    return decryptPracticeRecord(newPractice) as Practice;
  }

  async getPractice(id: number): Promise<Practice | undefined> {
    const [practice] = await db
      .select()
      .from(practices)
      .where(eq(practices.id, id));
    return practice ? decryptPracticeRecord(practice) as Practice : undefined;
  }

  async getAllPracticeIds(): Promise<number[]> {
    const result = await db
      .select({ id: practices.id })
      .from(practices);
    return result.map((p: { id: number }) => p.id);
  }

  async updatePractice(id: number, practice: Partial<InsertPractice>): Promise<Practice> {
    const encrypted = encryptPracticeRecord(practice as any);
    const [updatedPractice] = await db
      .update(practices)
      .set({ ...encrypted, updatedAt: new Date() })
      .where(eq(practices.id, id))
      .returning();
    return decryptPracticeRecord(updatedPractice) as Practice;
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

  async getPatientByEmail(email: string): Promise<Patient | undefined> {
    // Search across all practices for patient portal login
    const allPatients = await db
      .select()
      .from(patients)
      .where(isNull(patients.deletedAt));

    // Decrypt and find matching email (email is encrypted)
    for (const patient of allPatients) {
      const decrypted = decryptPatientRecord(patient) as Patient;
      if (decrypted.email?.toLowerCase() === email.toLowerCase()) {
        return decrypted;
      }
    }
    return undefined;
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

  /**
   * Batch fetch claims by IDs in a single query.
   */
  async getClaimsByIds(ids: number[]): Promise<Map<number, Claim>> {
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

  async getInsurance(id: number): Promise<Insurance | undefined> {
    const [insurance] = await db
      .select()
      .from(insurances)
      .where(eq(insurances.id, id));
    return insurance;
  }

  // SOAP Notes operations (with PHI encryption)
  async createSoapNote(soapNote: InsertSoapNote): Promise<SoapNote> {
    // Check if the therapist requires co-signing
    let cosignStatus = 'not_required';
    if (soapNote.therapistId) {
      const therapist = await this.getUser(soapNote.therapistId);
      if (therapist?.requiresCosign) {
        cosignStatus = 'pending';
      }
    }

    const noteWithCosignStatus = {
      ...soapNote,
      cosignStatus,
    };

    const encrypted = encryptSoapNoteRecord(noteWithCosignStatus as any);
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

  async signSoapNote(id: number, signatureData: {
    therapistId: string;
    therapistSignature: string;
    therapistSignedAt: Date;
    therapistSignedName: string;
    therapistCredentials: string;
    signatureIpAddress: string;
  }): Promise<SoapNote | undefined> {
    const [updated] = await db
      .update(soapNotes)
      .set({
        therapistId: signatureData.therapistId,
        therapistSignature: signatureData.therapistSignature,
        therapistSignedAt: signatureData.therapistSignedAt,
        therapistSignedName: signatureData.therapistSignedName,
        therapistCredentials: signatureData.therapistCredentials,
        signatureIpAddress: signatureData.signatureIpAddress,
        updatedAt: new Date()
      })
      .where(eq(soapNotes.id, id))
      .returning();
    return updated ? decryptSoapNoteRecord(updated) as SoapNote : undefined;
  }

  // Co-signing workflow methods
  async updateSoapNoteCosignStatus(id: number, data: {
    cosignedBy?: string;
    cosignedAt?: Date;
    cosignStatus: string;
    cosignRejectionReason?: string;
  }): Promise<SoapNote | undefined> {
    const [updated] = await db
      .update(soapNotes)
      .set({
        cosignedBy: data.cosignedBy,
        cosignedAt: data.cosignedAt,
        cosignStatus: data.cosignStatus,
        cosignRejectionReason: data.cosignRejectionReason,
        updatedAt: new Date()
      })
      .where(eq(soapNotes.id, id))
      .returning();
    return updated ? decryptSoapNoteRecord(updated) as SoapNote : undefined;
  }

  async getPendingCosignNotes(supervisorId: string): Promise<SoapNote[]> {
    // Get all supervisees of this supervisor
    const superviseeIds = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.supervisorId, supervisorId));

    if (superviseeIds.length === 0) {
      return [];
    }

    // Get all pending SOAP notes from those supervisees
    const ids = superviseeIds.map((s: { id: string }) => s.id);
    const rows = await db
      .select()
      .from(soapNotes)
      .where(
        and(
          eq(soapNotes.cosignStatus, 'pending'),
          inArray(soapNotes.therapistId, ids)
        )
      )
      .orderBy(desc(soapNotes.createdAt));

    return rows.map((r: any) => decryptSoapNoteRecord(r) as SoapNote);
  }

  // User supervision methods
  async getSupervisees(supervisorId: string): Promise<User[]> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.supervisorId, supervisorId))
      .orderBy(users.lastName, users.firstName);
    return rows.map((r: any) => decryptUserRecord(r) as User);
  }

  async updateUserSupervision(userId: string, supervisorId: string | null, requiresCosign: boolean): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        supervisorId: supervisorId,
        requiresCosign: requiresCosign,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    return updated ? decryptUserRecord(updated) as User : undefined;
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

  // Enhanced Analytics operations
  async getCollectionRate(practiceId: number): Promise<{
    totalBilled: number;
    totalCollected: number;
    collectionRate: number;
    target: number;
    byInsurance: { name: string; billed: number; collected: number; rate: number }[];
  }> {
    // Get total billed and collected
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

    // Get by insurance (join with insurances table)
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

  async getCleanClaimsRate(practiceId: number): Promise<{
    totalSubmitted: number;
    acceptedFirstPass: number;
    cleanClaimsRate: number;
    target: number;
    rejectionReasons: { reason: string; count: number }[];
  }> {
    // Count total submitted claims
    const totalResult = await db
      .select({ count: count() })
      .from(claims)
      .where(eq(claims.practiceId, practiceId));
    const totalSubmitted = totalResult[0]?.count || 0;

    // Count claims that were paid or accepted without denial
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

    // Get rejection reasons
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

  async getCapacityUtilization(practiceId: number, start: Date, end: Date): Promise<{
    totalSlots: number;
    bookedSlots: number;
    completedAppointments: number;
    arrivedRate: number;
    target: number;
    byTherapist: { name: string; utilization: number }[];
  }> {
    // Get appointments in date range
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

    const totalSlots = sessions.length || 1; // Avoid division by zero
    const completedAppointments = sessions.filter((s: any) => s.status === 'completed').length;
    const bookedSlots = sessions.filter((s: any) => s.status !== 'cancelled').length;
    const arrivedRate = totalSlots > 0 ? (completedAppointments / totalSlots) * 100 : 0;

    // Get utilization by therapist
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

  async getDaysInAR(practiceId: number): Promise<{
    averageDays: number;
    byBucket: { bucket: string; count: number; amount: number }[];
    byInsurance: { name: string; avgDays: number; outstanding: number }[];
  }> {
    const now = new Date();

    // Get unpaid claims
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

    // Calculate days in AR for each claim
    const claimsWithDays = unpaidClaims.map((claim: any) => {
      const submitDate = new Date(claim.submittedAt || claim.createdAt);
      const days = Math.floor((now.getTime() - submitDate.getTime()) / (1000 * 60 * 60 * 24));
      return { ...claim, daysInAR: days };
    });

    // Calculate average days
    const totalDays = claimsWithDays.reduce((sum: number, c: any) => sum + c.daysInAR, 0);
    const averageDays = claimsWithDays.length > 0 ? Math.round(totalDays / claimsWithDays.length) : 0;

    // Group by buckets
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

    // Group by insurance (using insuranceId for now)
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

  async getRevenueForecast(practiceId: number, monthsAhead: number): Promise<{
    month: string;
    predicted: number;
    confidence: { low: number; high: number };
  }[]> {
    // Get historical revenue data for the past 12 months
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 12);

    const historicalData = await this.getRevenueByMonth(practiceId, startDate, endDate);

    // Calculate average monthly revenue and growth trend
    const revenues = historicalData.map(d => d.revenue);
    const avgRevenue = revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) / revenues.length : 0;

    // Calculate simple trend (linear regression slope approximation)
    let trend = 0;
    if (revenues.length > 1) {
      const firstHalf = revenues.slice(0, Math.floor(revenues.length / 2));
      const secondHalf = revenues.slice(Math.floor(revenues.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      trend = (secondAvg - firstAvg) / firstAvg;
    }

    // Generate forecasts
    const forecasts: { month: string; predicted: number; confidence: { low: number; high: number } }[] = [];
    const currentDate = new Date();

    for (let i = 1; i <= monthsAhead; i++) {
      const forecastDate = new Date(currentDate);
      forecastDate.setMonth(forecastDate.getMonth() + i);
      const month = forecastDate.toISOString().slice(0, 7);

      // Apply trend growth
      const predicted = Math.round(avgRevenue * (1 + trend * i));

      // Confidence interval widens with time
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

  async getTopReferringProviders(practiceId: number): Promise<{
    sources: { name: string; referralCount: number; revenue: number }[];
    totalReferrals: number;
  }> {
    // Get patients with referral source
    const patientsWithReferrals = await db
      .select()
      .from(patients)
      .where(and(
        eq(patients.practiceId, practiceId)
      ));

    // Count referrals by source and calculate revenue
    const referralStats: Record<string, { count: number; revenue: number }> = {};

    for (const patient of patientsWithReferrals) {
      const referralSource = (patient as any).referralSource || 'Self-Referral';
      if (!referralStats[referralSource]) {
        referralStats[referralSource] = { count: 0, revenue: 0 };
      }
      referralStats[referralSource].count++;

      // Get revenue from this patient's claims
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

  async getRevenueByLocationAndTherapist(practiceId: number, startDate?: Date, endDate?: Date): Promise<{
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
    // Get all therapists for this practice
    const therapistUsers = await db
      .select()
      .from(users)
      .where(eq(users.practiceId, practiceId));

    // Get sessions with claims data
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

    // Get SOAP notes for location data
    const soapNotesData = await db
      .select({
        sessionId: soapNotes.sessionId,
        location: soapNotes.location,
      })
      .from(soapNotes)
      .innerJoin(treatmentSessions, eq(soapNotes.sessionId, treatmentSessions.id))
      .where(eq(treatmentSessions.practiceId, practiceId));

    // Create lookup for session locations
    const sessionLocations: Record<number, string> = {};
    soapNotesData.forEach((note: any) => {
      if (note.location) {
        sessionLocations[note.sessionId] = note.location;
      }
    });

    // Aggregate by therapist
    const therapistStats: Record<string, {
      totalRevenue: number;
      totalBilled: number;
      claimCount: number;
      paidCount: number;
    }> = {};

    // Aggregate by location
    const locationStats: Record<string, {
      totalRevenue: number;
      totalBilled: number;
      sessionCount: number;
    }> = {};

    // Aggregate by therapist + location
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

      // By therapist
      if (!therapistStats[therapistId]) {
        therapistStats[therapistId] = { totalRevenue: 0, totalBilled: 0, claimCount: 0, paidCount: 0 };
      }
      if (row.claimId) {
        therapistStats[therapistId].totalBilled += billed;
        therapistStats[therapistId].totalRevenue += paid;
        therapistStats[therapistId].claimCount++;
        if (isPaid) therapistStats[therapistId].paidCount++;
      }

      // By location
      if (!locationStats[location]) {
        locationStats[location] = { totalRevenue: 0, totalBilled: 0, sessionCount: 0 };
      }
      locationStats[location].sessionCount++;
      if (row.claimId) {
        locationStats[location].totalBilled += billed;
        locationStats[location].totalRevenue += paid;
      }

      // By therapist + location
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

    // Format results
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

  async getUpcomingAppointmentsForReminders(hoursAhead: number): Promise<Appointment[]> {
    const now = new Date();
    const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    return await db
      .select()
      .from(appointments)
      .where(and(
        eq(appointments.status, 'scheduled'),
        eq(appointments.reminderSent, false),
        gte(appointments.startTime, now),
        lte(appointments.startTime, future)
      ))
      .orderBy(appointments.startTime);
  }

  async markReminderSent(appointmentId: number): Promise<void> {
    await db
      .update(appointments)
      .set({ reminderSent: true, reminderSentAt: new Date(), updatedAt: new Date() })
      .where(eq(appointments.id, appointmentId));
  }

  // ==================== RECURRING APPOINTMENTS ====================

  /**
   * Create a recurring appointment series
   * @param parentAppointment - The parent appointment with recurrence rule
   * @param instanceDates - Array of dates for appointment instances
   * @returns The parent appointment and all created instances
   */
  async createRecurringAppointmentSeries(
    parentAppointment: InsertAppointment,
    instanceDates: Date[]
  ): Promise<{ parent: Appointment; instances: Appointment[] }> {
    const { nanoid } = await import('nanoid');
    const seriesId = nanoid();

    // Create the parent appointment first
    const [parent] = await db.insert(appointments).values({
      ...parentAppointment,
      isRecurringInstance: false,
      isRecurring: true,
      seriesId,
    }).returning();

    // Create all instances linked to the parent
    const instances: Appointment[] = [];
    const durationMs = new Date(parentAppointment.endTime).getTime() - new Date(parentAppointment.startTime).getTime();

    for (const startDate of instanceDates) {
      // Skip the first occurrence if it's the same as the parent
      if (startDate.getTime() === new Date(parentAppointment.startTime).getTime()) {
        continue;
      }

      const endDate = new Date(startDate.getTime() + durationMs);
      const [instance] = await db.insert(appointments).values({
        ...parentAppointment,
        startTime: startDate,
        endTime: endDate,
        recurrenceParentId: parent.id,
        recurrenceRule: null, // Only parent has the rule
        isRecurringInstance: true,
        isRecurring: true,
        seriesId,
        recurrenceEndDate: parentAppointment.recurrenceEndDate || null,
      }).returning();
      instances.push(instance);
    }

    return { parent, instances };
  }

  /**
   * Get all appointments in a recurring series by parent ID
   */
  async getRecurringSeries(parentId: number): Promise<Appointment[]> {
    // Get the parent appointment
    const [parent] = await db.select().from(appointments).where(eq(appointments.id, parentId));
    if (!parent) return [];

    // Get all instances
    const instances = await db
      .select()
      .from(appointments)
      .where(eq(appointments.recurrenceParentId, parentId))
      .orderBy(appointments.startTime);

    return [parent, ...instances];
  }

  /**
   * Delete an entire recurring series
   * @param parentId - The ID of the parent appointment
   * @param includeCompleted - Whether to include completed appointments in deletion
   */
  async deleteRecurringSeries(parentId: number, includeCompleted: boolean = false): Promise<number> {
    let deletedCount = 0;

    // First delete all instances
    if (includeCompleted) {
      const result = await db
        .delete(appointments)
        .where(eq(appointments.recurrenceParentId, parentId))
        .returning();
      deletedCount += result.length;
    } else {
      const result = await db
        .delete(appointments)
        .where(and(
          eq(appointments.recurrenceParentId, parentId),
          ne(appointments.status, 'completed')
        ))
        .returning();
      deletedCount += result.length;
    }

    // Then delete the parent if it's not completed (or if includeCompleted is true)
    const [parent] = await db.select().from(appointments).where(eq(appointments.id, parentId));
    if (parent && (includeCompleted || parent.status !== 'completed')) {
      await db.delete(appointments).where(eq(appointments.id, parentId));
      deletedCount += 1;
    }

    return deletedCount;
  }

  /**
   * Update an entire recurring series (future appointments only)
   * @param parentId - The ID of the parent appointment
   * @param updates - The updates to apply
   * @param fromDate - Only update appointments on or after this date (defaults to now)
   */
  async updateRecurringSeries(
    parentId: number,
    updates: Partial<InsertAppointment>,
    fromDate?: Date
  ): Promise<Appointment[]> {
    const effectiveFromDate = fromDate || new Date();
    const updatedAppointments: Appointment[] = [];

    // Get all appointments in the series
    const series = await this.getRecurringSeries(parentId);

    for (const apt of series) {
      // Only update future/scheduled appointments
      if (new Date(apt.startTime) >= effectiveFromDate && apt.status === 'scheduled') {
        const [updated] = await db
          .update(appointments)
          .set({
            ...updates,
            updatedAt: new Date(),
            // Don't update these fields
            id: undefined,
            recurrenceParentId: undefined,
            recurrenceRule: undefined,
            isRecurringInstance: undefined,
            createdAt: undefined,
          })
          .where(eq(appointments.id, apt.id))
          .returning();
        updatedAppointments.push(updated);
      }
    }

    return updatedAppointments;
  }

  /**
   * Cancel all future appointments in a recurring series
   */
  async cancelRecurringSeries(
    parentId: number,
    reason: string,
    notes?: string,
    cancelledBy?: string
  ): Promise<Appointment[]> {
    const now = new Date();
    const cancelledAppointments: Appointment[] = [];

    // Get all appointments in the series
    const series = await this.getRecurringSeries(parentId);

    for (const apt of series) {
      // Only cancel future/scheduled appointments
      if (new Date(apt.startTime) >= now && apt.status === 'scheduled') {
        const [cancelled] = await db
          .update(appointments)
          .set({
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelledBy: cancelledBy || null,
            cancellationReason: reason,
            cancellationNotes: notes || null,
            updatedAt: new Date(),
          })
          .where(eq(appointments.id, apt.id))
          .returning();
        cancelledAppointments.push(cancelled);
      }
    }

    return cancelledAppointments;
  }

  /**
   * Get parent appointment for a recurring instance
   */
  async getRecurrenceParent(appointmentId: number): Promise<Appointment | undefined> {
    const [apt] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
    if (!apt || !apt.recurrenceParentId) return undefined;

    const [parent] = await db.select().from(appointments).where(eq(appointments.id, apt.recurrenceParentId));
    return parent;
  }

  /**
   * Get all appointments in a series by seriesId
   */
  async getAppointmentsBySeriesId(seriesId: string): Promise<Appointment[]> {
    return db
      .select()
      .from(appointments)
      .where(eq(appointments.seriesId, seriesId))
      .orderBy(appointments.startTime);
  }

  /**
   * Update future appointments in a series by seriesId
   */
  async updateSeriesBySeriesId(
    seriesId: string,
    updates: Partial<InsertAppointment>,
    fromDate?: Date
  ): Promise<Appointment[]> {
    const effectiveFromDate = fromDate || new Date();
    const series = await this.getAppointmentsBySeriesId(seriesId);
    const updatedAppointments: Appointment[] = [];

    for (const apt of series) {
      if (new Date(apt.startTime) >= effectiveFromDate && apt.status === 'scheduled') {
        const [updated] = await db
          .update(appointments)
          .set({
            ...updates,
            updatedAt: new Date(),
            id: undefined,
            recurrenceParentId: undefined,
            recurrenceRule: undefined,
            isRecurringInstance: undefined,
            seriesId: undefined,
            createdAt: undefined,
          })
          .where(eq(appointments.id, apt.id))
          .returning();
        updatedAppointments.push(updated);
      }
    }

    return updatedAppointments;
  }

  /**
   * Delete future appointments in a series by seriesId
   */
  async deleteSeriesBySeriesId(seriesId: string, includeCompleted: boolean = false): Promise<number> {
    if (includeCompleted) {
      const result = await db
        .delete(appointments)
        .where(eq(appointments.seriesId, seriesId))
        .returning();
      return result.length;
    }

    const result = await db
      .delete(appointments)
      .where(and(
        eq(appointments.seriesId, seriesId),
        ne(appointments.status, 'completed')
      ))
      .returning();
    return result.length;
  }

  /**
   * Cancel future appointments in a series by seriesId
   */
  async cancelSeriesBySeriesId(
    seriesId: string,
    reason: string,
    notes?: string,
    cancelledBy?: string
  ): Promise<Appointment[]> {
    const now = new Date();
    const series = await this.getAppointmentsBySeriesId(seriesId);
    const cancelledAppointments: Appointment[] = [];

    for (const apt of series) {
      if (new Date(apt.startTime) >= now && apt.status === 'scheduled') {
        const [cancelled] = await db
          .update(appointments)
          .set({
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelledBy: cancelledBy || null,
            cancellationReason: reason,
            cancellationNotes: notes || null,
            updatedAt: new Date(),
          })
          .where(eq(appointments.id, apt.id))
          .returning();
        cancelledAppointments.push(cancelled);
      }
    }

    return cancelledAppointments;
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

  // Patient Feedback CRUD (private feedback before Google)
  async createPatientFeedback(feedback: InsertPatientFeedback): Promise<PatientFeedback> {
    const [result] = await db.insert(patientFeedback).values(feedback).returning();
    return result;
  }

  async getPatientFeedback(practiceId: number, filters?: {
    sentiment?: string;
    isAddressed?: boolean;
    googlePostRequested?: boolean;
    startDate?: Date;
    endDate?: Date;
  }): Promise<PatientFeedback[]> {
    const conditions = [eq(patientFeedback.practiceId, practiceId)];

    if (filters?.sentiment) {
      conditions.push(eq(patientFeedback.sentiment, filters.sentiment));
    }
    if (filters?.isAddressed !== undefined) {
      conditions.push(eq(patientFeedback.isAddressed, filters.isAddressed));
    }
    if (filters?.googlePostRequested !== undefined) {
      conditions.push(eq(patientFeedback.googlePostRequested, filters.googlePostRequested));
    }
    if (filters?.startDate) {
      conditions.push(gte(patientFeedback.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(patientFeedback.createdAt, filters.endDate));
    }

    return await db
      .select()
      .from(patientFeedback)
      .where(and(...conditions))
      .orderBy(desc(patientFeedback.createdAt));
  }

  async getPatientFeedbackById(id: number): Promise<PatientFeedback | undefined> {
    const [result] = await db
      .select()
      .from(patientFeedback)
      .where(eq(patientFeedback.id, id));
    return result;
  }

  async getPatientFeedbackByReviewRequest(reviewRequestId: number): Promise<PatientFeedback | undefined> {
    const [result] = await db
      .select()
      .from(patientFeedback)
      .where(eq(patientFeedback.reviewRequestId, reviewRequestId));
    return result;
  }

  async updatePatientFeedback(id: number, updates: Partial<InsertPatientFeedback>): Promise<PatientFeedback> {
    const [result] = await db
      .update(patientFeedback)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(patientFeedback.id, id))
      .returning();
    return result;
  }

  async getPatientFeedbackStats(practiceId: number): Promise<{
    totalFeedback: number;
    positiveCount: number;
    neutralCount: number;
    negativeCount: number;
    unaddressedNegative: number;
    googlePostsPending: number;
    googlePostsCompleted: number;
    averageRating: number;
  }> {
    const feedbackList = await db
      .select()
      .from(patientFeedback)
      .where(eq(patientFeedback.practiceId, practiceId));

    const stats = {
      totalFeedback: feedbackList.length,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      unaddressedNegative: 0,
      googlePostsPending: 0,
      googlePostsCompleted: 0,
      averageRating: 0,
    };

    if (feedbackList.length === 0) return stats;

    let totalRating = 0;
    for (const feedback of feedbackList) {
      totalRating += feedback.rating;
      if (feedback.sentiment === 'positive') stats.positiveCount++;
      if (feedback.sentiment === 'neutral') stats.neutralCount++;
      if (feedback.sentiment === 'negative') {
        stats.negativeCount++;
        if (!feedback.isAddressed) stats.unaddressedNegative++;
      }
      if (feedback.googlePostRequested && !feedback.postedToGoogle) stats.googlePostsPending++;
      if (feedback.postedToGoogle) stats.googlePostsCompleted++;
    }

    stats.averageRating = Math.round((totalRating / feedbackList.length) * 10) / 10;
    return stats;
  }

  async getReviewRequestByToken(token: string): Promise<ReviewRequest | undefined> {
    const [result] = await db
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.feedbackToken, token));
    return result;
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
  // Telehealth session operations (with PHI encryption for recording URLs, notes)
  async createTelehealthSession(session: InsertTelehealthSession): Promise<TelehealthSession> {
    const encrypted = encryptTelehealthSessionRecord(session as any);
    const [result] = await db.insert(telehealthSessions).values(encrypted as any).returning();
    return decryptTelehealthSessionRecord(result) as TelehealthSession;
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

    const rows = await db
      .select()
      .from(telehealthSessions)
      .where(and(...conditions))
      .orderBy(desc(telehealthSessions.scheduledStart));
    return rows.map((r: any) => decryptTelehealthSessionRecord(r) as TelehealthSession);
  }

  async getTelehealthSession(id: number): Promise<TelehealthSession | undefined> {
    const [result] = await db
      .select()
      .from(telehealthSessions)
      .where(eq(telehealthSessions.id, id));
    return result ? decryptTelehealthSessionRecord(result) as TelehealthSession : undefined;
  }

  async getTelehealthSessionByRoom(roomName: string): Promise<TelehealthSession | undefined> {
    const [result] = await db
      .select()
      .from(telehealthSessions)
      .where(eq(telehealthSessions.roomName, roomName));
    return result ? decryptTelehealthSessionRecord(result) as TelehealthSession : undefined;
  }

  async getTelehealthSessionByAppointment(appointmentId: number): Promise<TelehealthSession | undefined> {
    const [result] = await db
      .select()
      .from(telehealthSessions)
      .where(eq(telehealthSessions.appointmentId, appointmentId));
    return result ? decryptTelehealthSessionRecord(result) as TelehealthSession : undefined;
  }

  async getTelehealthSessionByAccessCode(code: string): Promise<TelehealthSession | undefined> {
    const [result] = await db
      .select()
      .from(telehealthSessions)
      .where(eq(telehealthSessions.patientAccessCode, code));
    return result ? decryptTelehealthSessionRecord(result) as TelehealthSession : undefined;
  }

  async updateTelehealthSession(id: number, updates: Partial<InsertTelehealthSession>): Promise<TelehealthSession> {
    const encrypted = encryptTelehealthSessionRecord(updates as any);
    const [result] = await db
      .update(telehealthSessions)
      .set({ ...encrypted, updatedAt: new Date() })
      .where(eq(telehealthSessions.id, id))
      .returning();
    return decryptTelehealthSessionRecord(result) as TelehealthSession;
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
    return decryptTelehealthSessionRecord(result) as TelehealthSession;
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
    return decryptTelehealthSessionRecord(result) as TelehealthSession;
  }

  async getUpcomingTelehealthSessions(practiceId: number, hoursAhead: number = 24): Promise<TelehealthSession[]> {
    const now = new Date();
    const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    const rows = await db
      .select()
      .from(telehealthSessions)
      .where(and(
        eq(telehealthSessions.practiceId, practiceId),
        eq(telehealthSessions.status, 'scheduled'),
        gte(telehealthSessions.scheduledStart, now),
        lte(telehealthSessions.scheduledStart, future)
      ))
      .orderBy(telehealthSessions.scheduledStart);
    return rows.map((r: any) => decryptTelehealthSessionRecord(r) as TelehealthSession);
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

    const rows = await db
      .select()
      .from(telehealthSessions)
      .where(and(...conditions))
      .orderBy(telehealthSessions.scheduledStart);
    return rows.map((r: any) => decryptTelehealthSessionRecord(r) as TelehealthSession);
  }

  // Telehealth Settings (with API key encryption)
  async getTelehealthSettings(practiceId: number): Promise<TelehealthSettings | undefined> {
    const [result] = await db
      .select()
      .from(telehealthSettings)
      .where(eq(telehealthSettings.practiceId, practiceId));
    return result ? decryptTelehealthSettingsRecord(result) as TelehealthSettings : undefined;
  }

  async upsertTelehealthSettings(settings: InsertTelehealthSettings): Promise<TelehealthSettings> {
    const encrypted = encryptTelehealthSettingsRecord(settings as any);
    const existing = await this.getTelehealthSettings(settings.practiceId);
    if (existing) {
      const [result] = await db
        .update(telehealthSettings)
        .set({ ...encrypted, updatedAt: new Date() })
        .where(eq(telehealthSettings.id, existing.id))
        .returning();
      return decryptTelehealthSettingsRecord(result) as TelehealthSettings;
    }
    const [result] = await db.insert(telehealthSettings).values(encrypted as any).returning();
    return decryptTelehealthSettingsRecord(result) as TelehealthSettings;
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
    return updated ? decryptUserRecord(updated) as User : undefined;
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

  // ==================== SECURE MESSAGING ====================

  // Generate a secure access token for patient portal
  generatePatientAccessToken(): string {
    return createHash('sha256')
      .update(Math.random().toString() + Date.now().toString())
      .digest('hex')
      .substring(0, 64);
  }

  // Conversations
  async createConversation(conversation: InsertConversation): Promise<Conversation> {
    const patientAccessToken = this.generatePatientAccessToken();
    const tokenExpiry = new Date();
    tokenExpiry.setDate(tokenExpiry.getDate() + 30); // Token valid for 30 days

    const [result] = await db.insert(conversations).values({
      ...conversation,
      patientAccessToken,
      patientTokenExpiresAt: tokenExpiry,
    }).returning();
    return result;
  }

  async getConversation(id: number): Promise<Conversation | undefined> {
    const [result] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    return result;
  }

  async getConversationByToken(token: string): Promise<Conversation | undefined> {
    const [result] = await db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.patientAccessToken, token),
        gte(conversations.patientTokenExpiresAt, new Date())
      ));
    return result;
  }

  async getConversations(practiceId: number, filters?: {
    therapistId?: string;
    patientId?: number;
    status?: string;
  }): Promise<(Conversation & { patient: Patient | null })[]> {
    let query = db
      .select({
        conversation: conversations,
        patient: patients,
      })
      .from(conversations)
      .leftJoin(patients, eq(conversations.patientId, patients.id))
      .where(eq(conversations.practiceId, practiceId))
      .$dynamic();

    const conditions: any[] = [eq(conversations.practiceId, practiceId)];

    if (filters?.therapistId) {
      conditions.push(eq(conversations.therapistId, filters.therapistId));
    }
    if (filters?.patientId) {
      conditions.push(eq(conversations.patientId, filters.patientId));
    }
    if (filters?.status) {
      conditions.push(eq(conversations.status, filters.status));
    }

    const results = await db
      .select({
        conversation: conversations,
        patient: patients,
      })
      .from(conversations)
      .leftJoin(patients, eq(conversations.patientId, patients.id))
      .where(and(...conditions))
      .orderBy(desc(conversations.lastMessageAt));

    return results.map((r: { conversation: Conversation; patient: Patient | null }) => ({
      ...r.conversation,
      patient: r.patient,
    }));
  }

  async getPatientConversations(patientId: number): Promise<Conversation[]> {
    return await db
      .select()
      .from(conversations)
      .where(eq(conversations.patientId, patientId))
      .orderBy(desc(conversations.lastMessageAt));
  }

  async updateConversation(id: number, updates: Partial<InsertConversation>): Promise<Conversation> {
    const [result] = await db
      .update(conversations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return result;
  }

  async archiveConversation(id: number): Promise<Conversation> {
    return this.updateConversation(id, { status: 'archived' });
  }

  // Messages
  async createMessage(message: InsertMessage): Promise<Message> {
    const [result] = await db.insert(messages).values({
      ...message,
      deliveredAt: new Date(),
    }).returning();

    // Update conversation's last message time and unread count
    const conversation = await this.getConversation(message.conversationId);
    if (conversation) {
      const updates: Record<string, unknown> = {
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      };

      if (message.senderType === 'therapist') {
        updates.unreadByPatient = (conversation.unreadByPatient || 0) + 1;
      } else {
        updates.unreadByTherapist = (conversation.unreadByTherapist || 0) + 1;
      }

      await db
        .update(conversations)
        .set(updates)
        .where(eq(conversations.id, message.conversationId));
    }

    return result;
  }

  async getMessage(id: number): Promise<Message | undefined> {
    const [result] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, id));
    return result;
  }

  async getMessages(conversationId: number, limit: number = 50, offset: number = 0): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(and(
        eq(messages.conversationId, conversationId),
        isNull(messages.deletedAt)
      ))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async markMessageRead(id: number): Promise<Message> {
    const [result] = await db
      .update(messages)
      .set({
        readAt: new Date(),
        readByRecipient: true,
      })
      .where(eq(messages.id, id))
      .returning();
    return result;
  }

  async markConversationReadByTherapist(conversationId: number): Promise<void> {
    // Mark all unread messages from patient as read
    await db
      .update(messages)
      .set({
        readAt: new Date(),
        readByRecipient: true,
      })
      .where(and(
        eq(messages.conversationId, conversationId),
        eq(messages.senderType, 'patient'),
        isNull(messages.readAt)
      ));

    // Reset unread count
    await db
      .update(conversations)
      .set({ unreadByTherapist: 0, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  async markConversationReadByPatient(conversationId: number): Promise<void> {
    // Mark all unread messages from therapist as read
    await db
      .update(messages)
      .set({
        readAt: new Date(),
        readByRecipient: true,
      })
      .where(and(
        eq(messages.conversationId, conversationId),
        eq(messages.senderType, 'therapist'),
        isNull(messages.readAt)
      ));

    // Reset unread count
    await db
      .update(conversations)
      .set({ unreadByPatient: 0, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  async softDeleteMessage(id: number, deletedBy: string): Promise<Message> {
    const [result] = await db
      .update(messages)
      .set({
        deletedAt: new Date(),
        deletedBy,
      })
      .where(eq(messages.id, id))
      .returning();
    return result;
  }

  async getUnreadCount(practiceId: number, therapistId?: string): Promise<number> {
    const conditions = [eq(conversations.practiceId, practiceId)];
    if (therapistId) {
      conditions.push(eq(conversations.therapistId, therapistId));
    }

    const [result] = await db
      .select({ total: sum(conversations.unreadByTherapist) })
      .from(conversations)
      .where(and(...conditions));

    return Number(result?.total || 0);
  }

  async getPatientUnreadCount(patientId: number): Promise<number> {
    const [result] = await db
      .select({ total: sum(conversations.unreadByPatient) })
      .from(conversations)
      .where(eq(conversations.patientId, patientId));

    return Number(result?.total || 0);
  }

  // Message notifications
  async createMessageNotification(notification: InsertMessageNotification): Promise<MessageNotification> {
    const [result] = await db.insert(messageNotifications).values(notification).returning();
    return result;
  }

  async updateMessageNotification(id: number, updates: Partial<InsertMessageNotification>): Promise<MessageNotification> {
    const [result] = await db
      .update(messageNotifications)
      .set(updates)
      .where(eq(messageNotifications.id, id))
      .returning();
    return result;
  }

  async getPendingNotifications(): Promise<MessageNotification[]> {
    return await db
      .select()
      .from(messageNotifications)
      .where(eq(messageNotifications.status, 'pending'))
      .orderBy(messageNotifications.createdAt);
  }

  // Refresh patient access token
  async refreshPatientAccessToken(conversationId: number): Promise<Conversation> {
    const newToken = this.generatePatientAccessToken();
    const tokenExpiry = new Date();
    tokenExpiry.setDate(tokenExpiry.getDate() + 30);

    const [result] = await db
      .update(conversations)
      .set({
        patientAccessToken: newToken,
        patientTokenExpiresAt: tokenExpiry,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId))
      .returning();
    return result;
  }

  // Get conversation with messages for a specific conversation
  async getConversationWithMessages(id: number): Promise<{
    conversation: Conversation;
    messages: Message[];
    patient: Patient | null;
  } | null> {
    const conversation = await this.getConversation(id);
    if (!conversation) return null;

    const msgs = await this.getMessages(id, 100);
    const patient = conversation.patientId
      ? await this.getPatient(conversation.patientId)
      : null;

    return {
      conversation,
      messages: msgs.reverse(), // Return in chronological order
      patient: patient || null,
    };
  }

  // ==================== PATIENT PORTAL ====================

  // Generate secure tokens
  generatePortalToken(): string {
    return createHash('sha256')
      .update(Math.random().toString() + Date.now().toString() + 'portal')
      .digest('hex')
      .substring(0, 64);
  }

  generateMagicLinkToken(): string {
    return createHash('sha256')
      .update(Math.random().toString() + Date.now().toString() + 'magic')
      .digest('hex')
      .substring(0, 64);
  }

  generateStatementNumber(): string {
    const date = new Date();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `STM-${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}-${random}`;
  }

  // Patient Portal Access
  async createPatientPortalAccess(data: InsertPatientPortalAccess): Promise<PatientPortalAccess>;
  async createPatientPortalAccess(patientId: number, practiceId: number): Promise<PatientPortalAccess>;
  async createPatientPortalAccess(dataOrPatientId: InsertPatientPortalAccess | number, practiceId?: number): Promise<PatientPortalAccess> {
    if (typeof dataOrPatientId === 'object') {
      // Full object provided
      const [result] = await db.insert(patientPortalAccess).values(dataOrPatientId).returning();
      return result;
    }

    // Legacy: patientId and practiceId provided
    const portalToken = this.generatePortalToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90); // 90 days

    const [result] = await db.insert(patientPortalAccess).values({
      patientId: dataOrPatientId,
      practiceId: practiceId!,
      portalToken,
      portalTokenExpiresAt: expiresAt,
    }).returning();
    return result;
  }

  async updatePatientPortalMagicLink(id: number, magicLinkToken: string, magicLinkExpiresAt: Date): Promise<PatientPortalAccess> {
    const [result] = await db
      .update(patientPortalAccess)
      .set({
        magicLinkToken,
        magicLinkExpiresAt,
        magicLinkUsedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(patientPortalAccess.id, id))
      .returning();
    return result;
  }

  async getPatientPortalAccess(patientId: number): Promise<PatientPortalAccess | undefined> {
    const [result] = await db
      .select()
      .from(patientPortalAccess)
      .where(and(
        eq(patientPortalAccess.patientId, patientId),
        eq(patientPortalAccess.isActive, true)
      ));
    return result;
  }

  async getPatientPortalByToken(token: string): Promise<PatientPortalAccess | undefined> {
    const [result] = await db
      .select()
      .from(patientPortalAccess)
      .where(and(
        eq(patientPortalAccess.portalToken, token),
        eq(patientPortalAccess.isActive, true),
        gte(patientPortalAccess.portalTokenExpiresAt, new Date())
      ));
    return result;
  }

  async getPatientPortalByMagicLink(token: string): Promise<PatientPortalAccess | undefined> {
    const [result] = await db
      .select()
      .from(patientPortalAccess)
      .where(and(
        eq(patientPortalAccess.magicLinkToken, token),
        eq(patientPortalAccess.isActive, true),
        gte(patientPortalAccess.magicLinkExpiresAt, new Date()),
        isNull(patientPortalAccess.magicLinkUsedAt)
      ));
    return result;
  }

  async createMagicLink(patientId: number): Promise<{ token: string; expiresAt: Date }> {
    const token = this.generateMagicLinkToken();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15 minutes

    await db
      .update(patientPortalAccess)
      .set({
        magicLinkToken: token,
        magicLinkExpiresAt: expiresAt,
        magicLinkUsedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(patientPortalAccess.patientId, patientId));

    return { token, expiresAt };
  }

  async useMagicLink(token: string): Promise<PatientPortalAccess | null> {
    const access = await this.getPatientPortalByMagicLink(token);
    if (!access) return null;

    // Mark magic link as used and update last accessed
    const [result] = await db
      .update(patientPortalAccess)
      .set({
        magicLinkUsedAt: new Date(),
        lastAccessedAt: new Date(),
        accessCount: (access.accessCount || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(patientPortalAccess.id, access.id))
      .returning();

    return result;
  }

  async updatePortalAccess(patientId: number): Promise<void> {
    await db
      .update(patientPortalAccess)
      .set({
        lastAccessedAt: new Date(),
        accessCount: sql`${patientPortalAccess.accessCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(patientPortalAccess.patientId, patientId));
  }

  async refreshPortalToken(patientId: number): Promise<PatientPortalAccess> {
    const newToken = this.generatePortalToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    const [result] = await db
      .update(patientPortalAccess)
      .set({
        portalToken: newToken,
        portalTokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(patientPortalAccess.patientId, patientId))
      .returning();

    return result;
  }

  // Patient Documents
  async createPatientDocument(document: InsertPatientDocument): Promise<PatientDocument> {
    const [result] = await db.insert(patientDocuments).values(document).returning();
    return result;
  }

  async getPatientDocuments(patientId: number, visibleToPatient?: boolean): Promise<PatientDocument[]> {
    const conditions = [eq(patientDocuments.patientId, patientId)];
    if (visibleToPatient !== undefined) {
      conditions.push(eq(patientDocuments.visibleToPatient, visibleToPatient));
    }

    return await db
      .select()
      .from(patientDocuments)
      .where(and(...conditions))
      .orderBy(desc(patientDocuments.createdAt));
  }

  async getPatientDocument(id: number): Promise<PatientDocument | undefined> {
    const [result] = await db
      .select()
      .from(patientDocuments)
      .where(eq(patientDocuments.id, id));
    return result;
  }

  async updatePatientDocument(id: number, updates: Partial<InsertPatientDocument>): Promise<PatientDocument> {
    const [result] = await db
      .update(patientDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(patientDocuments.id, id))
      .returning();
    return result;
  }

  async markDocumentViewed(id: number): Promise<PatientDocument> {
    const [result] = await db
      .update(patientDocuments)
      .set({ viewedAt: new Date(), updatedAt: new Date() })
      .where(eq(patientDocuments.id, id))
      .returning();
    return result;
  }

  async markDocumentDownloaded(id: number): Promise<PatientDocument> {
    const [result] = await db
      .update(patientDocuments)
      .set({ downloadedAt: new Date(), updatedAt: new Date() })
      .where(eq(patientDocuments.id, id))
      .returning();
    return result;
  }

  async signDocument(id: number, signatureData: string): Promise<PatientDocument> {
    const [result] = await db
      .update(patientDocuments)
      .set({
        signedAt: new Date(),
        signatureData,
        updatedAt: new Date(),
      })
      .where(eq(patientDocuments.id, id))
      .returning();
    return result;
  }

  // Patient Statements
  async createPatientStatement(statement: Omit<InsertPatientStatement, 'statementNumber'>): Promise<PatientStatement> {
    const statementNumber = this.generateStatementNumber();
    const [result] = await db.insert(patientStatements).values({
      ...statement,
      statementNumber,
    }).returning();
    return result;
  }

  async getPatientStatements(patientId: number): Promise<PatientStatement[]> {
    return await db
      .select()
      .from(patientStatements)
      .where(eq(patientStatements.patientId, patientId))
      .orderBy(desc(patientStatements.statementDate));
  }

  async getPatientStatement(id: number): Promise<PatientStatement | undefined> {
    const [result] = await db
      .select()
      .from(patientStatements)
      .where(eq(patientStatements.id, id));
    return result;
  }

  async updatePatientStatement(id: number, updates: Partial<InsertPatientStatement>): Promise<PatientStatement> {
    const [result] = await db
      .update(patientStatements)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(patientStatements.id, id))
      .returning();
    return result;
  }

  async markStatementViewed(id: number): Promise<PatientStatement> {
    const [result] = await db
      .update(patientStatements)
      .set({
        viewedAt: new Date(),
        status: 'viewed',
        updatedAt: new Date(),
      })
      .where(eq(patientStatements.id, id))
      .returning();
    return result;
  }

  async markStatementPaid(id: number, paymentInfo: {
    paymentMethod: string;
    paymentReference?: string;
    amount: string;
  }): Promise<PatientStatement> {
    const statement = await this.getPatientStatement(id);
    if (!statement) throw new Error('Statement not found');

    const newPaidAmount = (parseFloat(statement.paidAmount || '0') + parseFloat(paymentInfo.amount)).toFixed(2);
    const newBalance = (parseFloat(statement.totalAmount) - parseFloat(newPaidAmount)).toFixed(2);
    const isPaid = parseFloat(newBalance) <= 0;

    const [result] = await db
      .update(patientStatements)
      .set({
        paidAmount: newPaidAmount,
        balanceDue: newBalance,
        status: isPaid ? 'paid' : 'pending',
        paymentMethod: paymentInfo.paymentMethod,
        paymentReference: paymentInfo.paymentReference,
        paymentDate: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(patientStatements.id, id))
      .returning();

    return result;
  }

  async getPracticeStatements(practiceId: number, filters?: {
    status?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<PatientStatement[]> {
    const conditions = [eq(patientStatements.practiceId, practiceId)];

    if (filters?.status) {
      conditions.push(eq(patientStatements.status, filters.status));
    }
    if (filters?.startDate) {
      conditions.push(gte(patientStatements.statementDate, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(patientStatements.statementDate, filters.endDate));
    }

    return await db
      .select()
      .from(patientStatements)
      .where(and(...conditions))
      .orderBy(desc(patientStatements.statementDate));
  }

  // ==================== APPOINTMENT REQUESTS ====================

  async createAppointmentRequest(request: InsertAppointmentRequest): Promise<AppointmentRequest> {
    const [result] = await db.insert(appointmentRequests).values(request).returning();
    return result;
  }

  async getAppointmentRequest(id: number): Promise<AppointmentRequest | undefined> {
    const [result] = await db
      .select()
      .from(appointmentRequests)
      .where(eq(appointmentRequests.id, id));
    return result;
  }

  async getPatientAppointmentRequests(patientId: number, status?: string): Promise<any[]> {
    const conditions = [eq(appointmentRequests.patientId, patientId)];
    if (status) {
      conditions.push(eq(appointmentRequests.status, status));
    }

    const results = await db
      .select()
      .from(appointmentRequests)
      .where(and(...conditions))
      .orderBy(desc(appointmentRequests.createdAt));

    // Enrich with appointment type name
    const enrichedResults = await Promise.all(results.map(async (request: AppointmentRequest) => {
      let appointmentTypeName = null;
      let therapistName = null;

      if (request.appointmentTypeId) {
        const appointmentType = await this.getAppointmentType(request.appointmentTypeId);
        appointmentTypeName = appointmentType?.name;
      }

      if (request.therapistId) {
        const therapist = await this.getUser(request.therapistId);
        if (therapist) {
          therapistName = `${therapist.firstName} ${therapist.lastName}`;
        }
      }

      return {
        ...request,
        appointmentTypeName,
        therapistName,
      };
    }));

    return enrichedResults;
  }

  async getPracticeAppointmentRequests(practiceId: number, status?: string): Promise<AppointmentRequest[]> {
    const conditions = [eq(appointmentRequests.practiceId, practiceId)];
    if (status) {
      conditions.push(eq(appointmentRequests.status, status));
    }

    return await db
      .select()
      .from(appointmentRequests)
      .where(and(...conditions))
      .orderBy(desc(appointmentRequests.createdAt));
  }

  async updateAppointmentRequest(id: number, updates: Partial<InsertAppointmentRequest> & { processedAt?: Date; processedById?: string; appointmentId?: number }): Promise<AppointmentRequest> {
    const [result] = await db
      .update(appointmentRequests)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(appointmentRequests.id, id))
      .returning();
    return result;
  }

  async getPendingAppointmentRequestsCount(practiceId: number): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(appointmentRequests)
      .where(and(
        eq(appointmentRequests.practiceId, practiceId),
        eq(appointmentRequests.status, 'pending_approval')
      ));
    return result[0]?.count || 0;
  }

  // Get patient portal dashboard data
  async getPatientPortalDashboard(patientId: number): Promise<{
    patient: Patient | null;
    upcomingAppointments: Appointment[];
    recentStatements: PatientStatement[];
    unreadMessages: number;
    documents: PatientDocument[];
  }> {
    const patient = await this.getPatient(patientId);

    // Get upcoming appointments
    const now = new Date();
    const allAppointments = patient?.practiceId
      ? await this.getAppointments(patient.practiceId)
      : [];
    const upcomingAppointments = allAppointments
      .filter((apt: Appointment) => apt.patientId === patientId && new Date(apt.startTime) >= now && apt.status !== 'cancelled')
      .sort((a: Appointment, b: Appointment) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 5);

    // Get recent statements
    const statements = await this.getPatientStatements(patientId);
    const recentStatements = statements.slice(0, 5);

    // Get unread message count
    const unreadMessages = await this.getPatientUnreadCount(patientId);

    // Get visible documents
    const documents = await this.getPatientDocuments(patientId, true);

    return {
      patient: patient || null,
      upcomingAppointments,
      recentStatements,
      unreadMessages,
      documents,
    };
  }

  // ==================== Eligibility Alerts ====================

  async createEligibilityAlert(alert: InsertEligibilityAlert): Promise<EligibilityAlert> {
    const [newAlert] = await db.insert(eligibilityAlerts).values(alert).returning();
    return newAlert;
  }

  async getEligibilityAlerts(practiceId: number, filters?: {
    status?: string;
    severity?: string;
    alertType?: string;
    patientId?: number;
    limit?: number;
  }): Promise<EligibilityAlert[]> {
    const conditions = [eq(eligibilityAlerts.practiceId, practiceId)];

    if (filters?.status) {
      conditions.push(eq(eligibilityAlerts.status, filters.status));
    }
    if (filters?.severity) {
      conditions.push(eq(eligibilityAlerts.severity, filters.severity));
    }
    if (filters?.alertType) {
      conditions.push(eq(eligibilityAlerts.alertType, filters.alertType));
    }
    if (filters?.patientId) {
      conditions.push(eq(eligibilityAlerts.patientId, filters.patientId));
    }

    let query = db.select()
      .from(eligibilityAlerts)
      .where(and(...conditions))
      .orderBy(desc(eligibilityAlerts.createdAt));

    if (filters?.limit) {
      query = query.limit(filters.limit) as typeof query;
    }

    return query;
  }

  async getEligibilityAlert(id: number): Promise<EligibilityAlert | undefined> {
    const [alert] = await db.select()
      .from(eligibilityAlerts)
      .where(eq(eligibilityAlerts.id, id));
    return alert;
  }

  async updateEligibilityAlert(id: number, updates: Partial<InsertEligibilityAlert> & {
    status?: string;
    acknowledgedAt?: Date;
    acknowledgedBy?: string;
    resolvedAt?: Date;
    resolvedBy?: string;
    resolutionNotes?: string;
  }): Promise<EligibilityAlert | undefined> {
    const [updated] = await db.update(eligibilityAlerts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(eligibilityAlerts.id, id))
      .returning();
    return updated;
  }

  async acknowledgeEligibilityAlert(id: number, userId: string): Promise<EligibilityAlert | undefined> {
    return this.updateEligibilityAlert(id, {
      status: 'acknowledged',
      acknowledgedAt: new Date(),
      acknowledgedBy: userId,
    });
  }

  async resolveEligibilityAlert(id: number, userId: string, notes?: string): Promise<EligibilityAlert | undefined> {
    return this.updateEligibilityAlert(id, {
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedBy: userId,
      resolutionNotes: notes,
    });
  }

  async dismissEligibilityAlert(id: number, userId: string, notes?: string): Promise<EligibilityAlert | undefined> {
    return this.updateEligibilityAlert(id, {
      status: 'dismissed',
      resolvedAt: new Date(),
      resolvedBy: userId,
      resolutionNotes: notes,
    });
  }

  async getOpenAlertsForAppointment(appointmentId: number): Promise<EligibilityAlert[]> {
    return db.select()
      .from(eligibilityAlerts)
      .where(and(
        eq(eligibilityAlerts.appointmentId, appointmentId),
        eq(eligibilityAlerts.status, 'open')
      ));
  }

  async getEligibilityAlertStats(practiceId: number): Promise<{
    totalOpen: number;
    bySeverity: { severity: string; count: number }[];
    byType: { alertType: string; count: number }[];
    resolvedLast30Days: number;
  }> {
    // Get total open alerts
    const [{ totalOpen }] = await db.select({ totalOpen: count() })
      .from(eligibilityAlerts)
      .where(and(
        eq(eligibilityAlerts.practiceId, practiceId),
        eq(eligibilityAlerts.status, 'open')
      ));

    // Get by severity
    const bySeverity = await db.select({
      severity: eligibilityAlerts.severity,
      count: count(),
    })
      .from(eligibilityAlerts)
      .where(and(
        eq(eligibilityAlerts.practiceId, practiceId),
        eq(eligibilityAlerts.status, 'open')
      ))
      .groupBy(eligibilityAlerts.severity);

    // Get by type
    const byType = await db.select({
      alertType: eligibilityAlerts.alertType,
      count: count(),
    })
      .from(eligibilityAlerts)
      .where(and(
        eq(eligibilityAlerts.practiceId, practiceId),
        eq(eligibilityAlerts.status, 'open')
      ))
      .groupBy(eligibilityAlerts.alertType);

    // Get resolved in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [{ resolvedLast30Days }] = await db.select({ resolvedLast30Days: count() })
      .from(eligibilityAlerts)
      .where(and(
        eq(eligibilityAlerts.practiceId, practiceId),
        eq(eligibilityAlerts.status, 'resolved'),
        gte(eligibilityAlerts.resolvedAt, thirtyDaysAgo)
      ));

    return {
      totalOpen: totalOpen || 0,
      bySeverity: bySeverity.map((s: { severity: string | null; count: number }) => ({ severity: s.severity || 'unknown', count: Number(s.count) })),
      byType: byType.map((t: { alertType: string; count: number }) => ({ alertType: t.alertType, count: Number(t.count) })),
      resolvedLast30Days: resolvedLast30Days || 0,
    };
  }

  // Get upcoming appointments that need eligibility verification
  async getAppointmentsNeedingEligibilityCheck(practiceId: number, hoursAhead: number = 24): Promise<Appointment[]> {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + hoursAhead);

    // Get all upcoming appointments within the time window
    const upcomingAppointments = await db.select()
      .from(appointments)
      .where(and(
        eq(appointments.practiceId, practiceId),
        gte(appointments.startTime, now),
        lte(appointments.startTime, futureDate),
        ne(appointments.status, 'cancelled')
      ));

    // Filter to only those with patients who have insurance
    const appointmentsWithInsurance: Appointment[] = [];
    for (const apt of upcomingAppointments) {
      if (apt.patientId) {
        const patient = await this.getPatient(apt.patientId);
        if (patient?.insuranceId) {
          appointmentsWithInsurance.push(apt);
        }
      }
    }

    return appointmentsWithInsurance;
  }

  // Batch create eligibility alerts
  async createEligibilityAlertsBatch(alerts: InsertEligibilityAlert[]): Promise<EligibilityAlert[]> {
    if (alerts.length === 0) return [];
    return db.insert(eligibilityAlerts).values(alerts).returning();
  }

  // ==================== Treatment Plans ====================

  async createTreatmentPlan(plan: InsertTreatmentPlan): Promise<TreatmentPlan> {
    const [newPlan] = await db.insert(treatmentPlans).values(plan).returning();
    return newPlan;
  }

  async getTreatmentPlans(practiceId: number, filters?: {
    patientId?: number;
    therapistId?: string;
    status?: string;
  }): Promise<TreatmentPlan[]> {
    const conditions = [eq(treatmentPlans.practiceId, practiceId)];

    if (filters?.patientId) {
      conditions.push(eq(treatmentPlans.patientId, filters.patientId));
    }
    if (filters?.therapistId) {
      conditions.push(eq(treatmentPlans.therapistId, filters.therapistId));
    }
    if (filters?.status) {
      conditions.push(eq(treatmentPlans.status, filters.status));
    }

    return db.select()
      .from(treatmentPlans)
      .where(and(...conditions))
      .orderBy(desc(treatmentPlans.createdAt));
  }

  async getTreatmentPlan(id: number): Promise<TreatmentPlan | undefined> {
    const [plan] = await db.select()
      .from(treatmentPlans)
      .where(eq(treatmentPlans.id, id));
    return plan;
  }

  async updateTreatmentPlan(id: number, updates: Partial<InsertTreatmentPlan>): Promise<TreatmentPlan | undefined> {
    const [updated] = await db.update(treatmentPlans)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(treatmentPlans.id, id))
      .returning();
    return updated;
  }

  async getTreatmentPlanWithDetails(id: number): Promise<{
    plan: TreatmentPlan;
    goals: (TreatmentGoal & { objectives: TreatmentObjective[] })[];
    interventions: TreatmentIntervention[];
  } | null> {
    const plan = await this.getTreatmentPlan(id);
    if (!plan) return null;

    const goals = await this.getTreatmentGoals(id);
    const goalsWithObjectives = await Promise.all(
      goals.map(async (goal) => ({
        ...goal,
        objectives: await this.getTreatmentObjectives(goal.id),
      }))
    );

    const interventions = await this.getTreatmentInterventions(id);

    return { plan, goals: goalsWithObjectives, interventions };
  }

  async getPatientTreatmentPlans(patientId: number): Promise<TreatmentPlan[]> {
    return db.select()
      .from(treatmentPlans)
      .where(eq(treatmentPlans.patientId, patientId))
      .orderBy(desc(treatmentPlans.createdAt));
  }

  async getActiveTreatmentPlan(patientId: number): Promise<TreatmentPlan | undefined> {
    const [plan] = await db.select()
      .from(treatmentPlans)
      .where(and(
        eq(treatmentPlans.patientId, patientId),
        eq(treatmentPlans.status, 'active')
      ))
      .orderBy(desc(treatmentPlans.createdAt))
      .limit(1);
    return plan;
  }

  // ==================== Treatment Goals ====================

  async createTreatmentGoal(goal: InsertTreatmentGoal): Promise<TreatmentGoal> {
    const [newGoal] = await db.insert(treatmentGoals).values(goal).returning();
    return newGoal;
  }

  async getTreatmentGoals(treatmentPlanId: number): Promise<TreatmentGoal[]> {
    return db.select()
      .from(treatmentGoals)
      .where(eq(treatmentGoals.treatmentPlanId, treatmentPlanId))
      .orderBy(treatmentGoals.goalNumber);
  }

  async getTreatmentGoal(id: number): Promise<TreatmentGoal | undefined> {
    const [goal] = await db.select()
      .from(treatmentGoals)
      .where(eq(treatmentGoals.id, id));
    return goal;
  }

  async updateTreatmentGoal(id: number, updates: Partial<InsertTreatmentGoal> & {
    achievedAt?: Date;
  }): Promise<TreatmentGoal | undefined> {
    const [updated] = await db.update(treatmentGoals)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(treatmentGoals.id, id))
      .returning();
    return updated;
  }

  async deleteTreatmentGoal(id: number): Promise<void> {
    // Delete objectives first
    await db.delete(treatmentObjectives).where(eq(treatmentObjectives.goalId, id));
    // Delete progress notes
    await db.delete(goalProgressNotes).where(eq(goalProgressNotes.goalId, id));
    // Delete the goal
    await db.delete(treatmentGoals).where(eq(treatmentGoals.id, id));
  }

  // ==================== Treatment Objectives ====================

  async createTreatmentObjective(objective: InsertTreatmentObjective): Promise<TreatmentObjective> {
    const [newObjective] = await db.insert(treatmentObjectives).values(objective).returning();
    return newObjective;
  }

  async getTreatmentObjectives(goalId: number): Promise<TreatmentObjective[]> {
    return db.select()
      .from(treatmentObjectives)
      .where(eq(treatmentObjectives.goalId, goalId))
      .orderBy(treatmentObjectives.objectiveNumber);
  }

  async getTreatmentObjective(id: number): Promise<TreatmentObjective | undefined> {
    const [objective] = await db.select()
      .from(treatmentObjectives)
      .where(eq(treatmentObjectives.id, id));
    return objective;
  }

  async updateTreatmentObjective(id: number, updates: Partial<InsertTreatmentObjective> & {
    achievedAt?: Date;
  }): Promise<TreatmentObjective | undefined> {
    const [updated] = await db.update(treatmentObjectives)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(treatmentObjectives.id, id))
      .returning();
    return updated;
  }

  async deleteTreatmentObjective(id: number): Promise<void> {
    await db.delete(treatmentObjectives).where(eq(treatmentObjectives.id, id));
  }

  // ==================== Treatment Interventions ====================

  async createTreatmentIntervention(intervention: InsertTreatmentIntervention): Promise<TreatmentIntervention> {
    const [newIntervention] = await db.insert(treatmentInterventions).values(intervention).returning();
    return newIntervention;
  }

  async getTreatmentInterventions(treatmentPlanId: number): Promise<TreatmentIntervention[]> {
    return db.select()
      .from(treatmentInterventions)
      .where(eq(treatmentInterventions.treatmentPlanId, treatmentPlanId))
      .orderBy(treatmentInterventions.name);
  }

  async updateTreatmentIntervention(id: number, updates: Partial<InsertTreatmentIntervention>): Promise<TreatmentIntervention | undefined> {
    const [updated] = await db.update(treatmentInterventions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(treatmentInterventions.id, id))
      .returning();
    return updated;
  }

  async deleteTreatmentIntervention(id: number): Promise<void> {
    await db.delete(treatmentInterventions).where(eq(treatmentInterventions.id, id));
  }

  // ==================== Goal Progress Notes ====================

  async createGoalProgressNote(note: InsertGoalProgressNote): Promise<GoalProgressNote> {
    const [newNote] = await db.insert(goalProgressNotes).values(note).returning();

    // Update goal progress if rating provided
    if (note.progressRating && note.goalId) {
      await this.updateTreatmentGoal(note.goalId, {
        progressPercentage: note.progressRating * 20, // Convert 1-5 to percentage
      });
    }

    return newNote;
  }

  async getGoalProgressNotes(goalId: number): Promise<GoalProgressNote[]> {
    return db.select()
      .from(goalProgressNotes)
      .where(eq(goalProgressNotes.goalId, goalId))
      .orderBy(desc(goalProgressNotes.createdAt));
  }

  async getSessionProgressNotes(sessionId: number): Promise<GoalProgressNote[]> {
    return db.select()
      .from(goalProgressNotes)
      .where(eq(goalProgressNotes.sessionId, sessionId));
  }

  // ==================== Treatment Plan Analytics ====================

  async getTreatmentPlanStats(practiceId: number): Promise<{
    totalPlans: number;
    activePlans: number;
    completedPlans: number;
    averageGoalsPerPlan: number;
    goalCompletionRate: number;
  }> {
    const plans = await this.getTreatmentPlans(practiceId);
    const activePlans = plans.filter((p) => p.status === 'active').length;
    const completedPlans = plans.filter((p) => p.status === 'completed').length;

    // Get all goals for this practice
    const allGoals = await db.select()
      .from(treatmentGoals)
      .where(eq(treatmentGoals.practiceId, practiceId));

    const totalGoals = allGoals.length;
    const achievedGoals = allGoals.filter((g: TreatmentGoal) => g.status === 'achieved').length;

    return {
      totalPlans: plans.length,
      activePlans,
      completedPlans,
      averageGoalsPerPlan: plans.length > 0 ? totalGoals / plans.length : 0,
      goalCompletionRate: totalGoals > 0 ? (achievedGoals / totalGoals) * 100 : 0,
    };
  }

  async getPlansNeedingReview(practiceId: number, daysAhead: number = 7): Promise<TreatmentPlan[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return db.select()
      .from(treatmentPlans)
      .where(and(
        eq(treatmentPlans.practiceId, practiceId),
        eq(treatmentPlans.status, 'active'),
        lte(treatmentPlans.nextReviewDate, futureDate.toISOString().split('T')[0])
      ))
      .orderBy(treatmentPlans.nextReviewDate);
  }

  // ==================== Outcome Measure Templates ====================

  async createOutcomeMeasureTemplate(template: InsertOutcomeMeasureTemplate): Promise<OutcomeMeasureTemplate> {
    const [newTemplate] = await db.insert(outcomeMeasureTemplates).values(template).returning();
    return newTemplate;
  }

  async getOutcomeMeasureTemplates(practiceId?: number): Promise<OutcomeMeasureTemplate[]> {
    // Get system templates and practice-specific templates
    if (practiceId) {
      return db.select()
        .from(outcomeMeasureTemplates)
        .where(and(
          eq(outcomeMeasureTemplates.isActive, true),
          sql`(${outcomeMeasureTemplates.practiceId} = ${practiceId} OR ${outcomeMeasureTemplates.isSystemTemplate} = true)`
        ))
        .orderBy(outcomeMeasureTemplates.name);
    }
    return db.select()
      .from(outcomeMeasureTemplates)
      .where(eq(outcomeMeasureTemplates.isActive, true))
      .orderBy(outcomeMeasureTemplates.name);
  }

  async getOutcomeMeasureTemplate(id: number): Promise<OutcomeMeasureTemplate | undefined> {
    const [template] = await db.select()
      .from(outcomeMeasureTemplates)
      .where(eq(outcomeMeasureTemplates.id, id));
    return template;
  }

  async updateOutcomeMeasureTemplate(id: number, updates: Partial<InsertOutcomeMeasureTemplate>): Promise<OutcomeMeasureTemplate | undefined> {
    const [updated] = await db.update(outcomeMeasureTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(outcomeMeasureTemplates.id, id))
      .returning();
    return updated;
  }

  async getTemplatesByCategory(category: string, practiceId?: number): Promise<OutcomeMeasureTemplate[]> {
    const conditions = [
      eq(outcomeMeasureTemplates.category, category),
      eq(outcomeMeasureTemplates.isActive, true),
    ];

    if (practiceId) {
      return db.select()
        .from(outcomeMeasureTemplates)
        .where(and(
          ...conditions,
          sql`(${outcomeMeasureTemplates.practiceId} = ${practiceId} OR ${outcomeMeasureTemplates.isSystemTemplate} = true)`
        ))
        .orderBy(outcomeMeasureTemplates.name);
    }

    return db.select()
      .from(outcomeMeasureTemplates)
      .where(and(...conditions))
      .orderBy(outcomeMeasureTemplates.name);
  }

  // ==================== Patient Assessments ====================

  async createPatientAssessment(assessment: InsertPatientAssessment): Promise<PatientAssessment> {
    // Calculate comparison to previous assessment
    const previous = await this.getLatestPatientAssessment(assessment.patientId, assessment.templateId);

    const assessmentWithComparison: InsertPatientAssessment = {
      ...assessment,
      previousScore: previous?.totalScore ?? undefined,
      scoreChange: previous?.totalScore && assessment.totalScore
        ? assessment.totalScore - previous.totalScore
        : undefined,
    };

    // Check for reliable change if template has RCI
    if (assessmentWithComparison.scoreChange !== undefined && assessmentWithComparison.scoreChange !== null) {
      const template = await this.getOutcomeMeasureTemplate(assessment.templateId);
      if (template?.reliableChangeIndex) {
        const rci = parseFloat(template.reliableChangeIndex);
        assessmentWithComparison.isReliableChange = Math.abs(assessmentWithComparison.scoreChange) >= rci;
      }
      if (template?.clinicalCutoff && assessment.totalScore !== undefined && assessment.totalScore !== null) {
        const prevAboveCutoff = previous?.totalScore !== undefined && previous.totalScore !== null && previous.totalScore >= template.clinicalCutoff;
        const currentAboveCutoff = assessment.totalScore >= template.clinicalCutoff;
        assessmentWithComparison.isClinicallySignificant = prevAboveCutoff !== currentAboveCutoff;
      }
    }

    const [newAssessment] = await db.insert(patientAssessments).values(assessmentWithComparison).returning();
    return newAssessment;
  }

  async getPatientAssessments(patientId: number, templateId?: number): Promise<PatientAssessment[]> {
    const conditions = [eq(patientAssessments.patientId, patientId)];

    if (templateId) {
      conditions.push(eq(patientAssessments.templateId, templateId));
    }

    return db.select()
      .from(patientAssessments)
      .where(and(...conditions))
      .orderBy(desc(patientAssessments.administeredAt));
  }

  async getPatientAssessment(id: number): Promise<PatientAssessment | undefined> {
    const [assessment] = await db.select()
      .from(patientAssessments)
      .where(eq(patientAssessments.id, id));
    return assessment;
  }

  async getLatestPatientAssessment(patientId: number, templateId: number): Promise<PatientAssessment | undefined> {
    const [assessment] = await db.select()
      .from(patientAssessments)
      .where(and(
        eq(patientAssessments.patientId, patientId),
        eq(patientAssessments.templateId, templateId),
        eq(patientAssessments.status, 'completed')
      ))
      .orderBy(desc(patientAssessments.administeredAt))
      .limit(1);
    return assessment;
  }

  async updatePatientAssessment(id: number, updates: Partial<InsertPatientAssessment>): Promise<PatientAssessment | undefined> {
    const [updated] = await db.update(patientAssessments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(patientAssessments.id, id))
      .returning();
    return updated;
  }

  async getPracticeAssessments(practiceId: number, filters?: {
    templateId?: number;
    startDate?: Date;
    endDate?: Date;
    assessmentType?: string;
  }): Promise<PatientAssessment[]> {
    const conditions = [eq(patientAssessments.practiceId, practiceId)];

    if (filters?.templateId) {
      conditions.push(eq(patientAssessments.templateId, filters.templateId));
    }
    if (filters?.startDate) {
      conditions.push(gte(patientAssessments.administeredAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(patientAssessments.administeredAt, filters.endDate));
    }
    if (filters?.assessmentType) {
      conditions.push(eq(patientAssessments.assessmentType, filters.assessmentType));
    }

    return db.select()
      .from(patientAssessments)
      .where(and(...conditions))
      .orderBy(desc(patientAssessments.administeredAt));
  }

  async getPatientAssessmentHistory(patientId: number, templateId: number): Promise<{
    assessments: PatientAssessment[];
    trend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
    averageChange: number | null;
  }> {
    const assessments = await this.getPatientAssessments(patientId, templateId);

    if (assessments.length < 2) {
      return { assessments, trend: 'insufficient_data', averageChange: null };
    }

    // Calculate trend based on recent assessments
    const recentAssessments = assessments.slice(0, 5);
    let totalChange = 0;
    let changeCount = 0;

    for (let i = 0; i < recentAssessments.length - 1; i++) {
      const current = recentAssessments[i].totalScore;
      const previous = recentAssessments[i + 1].totalScore;
      if (current !== null && previous !== null) {
        totalChange += current - previous;
        changeCount++;
      }
    }

    const averageChange = changeCount > 0 ? totalChange / changeCount : null;

    let trend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
    if (averageChange === null) {
      trend = 'insufficient_data';
    } else if (averageChange < -2) {
      trend = 'improving'; // Lower scores typically mean improvement
    } else if (averageChange > 2) {
      trend = 'declining';
    } else {
      trend = 'stable';
    }

    return { assessments, trend, averageChange };
  }

  // ==================== Assessment Schedules ====================

  async createAssessmentSchedule(schedule: InsertAssessmentSchedule): Promise<AssessmentSchedule> {
    const [newSchedule] = await db.insert(assessmentSchedules).values(schedule).returning();
    return newSchedule;
  }

  async getPatientAssessmentSchedules(patientId: number): Promise<AssessmentSchedule[]> {
    return db.select()
      .from(assessmentSchedules)
      .where(and(
        eq(assessmentSchedules.patientId, patientId),
        eq(assessmentSchedules.isActive, true)
      ));
  }

  async getAssessmentSchedule(id: number): Promise<AssessmentSchedule | undefined> {
    const [schedule] = await db.select()
      .from(assessmentSchedules)
      .where(eq(assessmentSchedules.id, id));
    return schedule;
  }

  async updateAssessmentSchedule(id: number, updates: Partial<InsertAssessmentSchedule>): Promise<AssessmentSchedule | undefined> {
    const [updated] = await db.update(assessmentSchedules)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(assessmentSchedules.id, id))
      .returning();
    return updated;
  }

  async deleteAssessmentSchedule(id: number): Promise<void> {
    await db.update(assessmentSchedules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(assessmentSchedules.id, id));
  }

  async getDueAssessments(practiceId: number): Promise<AssessmentSchedule[]> {
    const now = new Date();
    return db.select()
      .from(assessmentSchedules)
      .where(and(
        eq(assessmentSchedules.practiceId, practiceId),
        eq(assessmentSchedules.isActive, true),
        lte(assessmentSchedules.nextDueAt, now)
      ));
  }

  // ==================== Outcome Measure Analytics ====================

  async getOutcomeMeasureStats(practiceId: number, templateId?: number): Promise<{
    totalAssessments: number;
    averageScore: number | null;
    improvementRate: number;
    bySeverity: { severity: string; count: number }[];
  }> {
    const conditions = [eq(patientAssessments.practiceId, practiceId)];
    if (templateId) {
      conditions.push(eq(patientAssessments.templateId, templateId));
    }

    const assessments = await db.select()
      .from(patientAssessments)
      .where(and(...conditions));

    const totalAssessments = assessments.length;

    // Calculate average score
    const scoresWithValues = assessments.filter((a: PatientAssessment) => a.totalScore !== null);
    const averageScore = scoresWithValues.length > 0
      ? scoresWithValues.reduce((sum: number, a: PatientAssessment) => sum + (a.totalScore || 0), 0) / scoresWithValues.length
      : null;

    // Calculate improvement rate (assessments showing negative score change)
    const assessmentsWithChange = assessments.filter((a: PatientAssessment) => a.scoreChange !== null);
    const improved = assessmentsWithChange.filter((a: PatientAssessment) => (a.scoreChange || 0) < 0).length;
    const improvementRate = assessmentsWithChange.length > 0
      ? (improved / assessmentsWithChange.length) * 100
      : 0;

    // Group by severity
    const severityCounts: Record<string, number> = {};
    for (const a of assessments) {
      const severity = a.severity || 'unknown';
      severityCounts[severity] = (severityCounts[severity] || 0) + 1;
    }
    const bySeverity = Object.entries(severityCounts)
      .map(([severity, count]) => ({ severity, count }))
      .sort((a, b) => b.count - a.count);

    return { totalAssessments, averageScore, improvementRate, bySeverity };
  }

  // ==================== Referral Sources ====================

  async createReferralSource(source: InsertReferralSource): Promise<ReferralSource> {
    const [newSource] = await db.insert(referralSources).values(source).returning();
    return newSource;
  }

  async getReferralSources(practiceId: number, filters?: {
    type?: string;
    isActive?: boolean;
  }): Promise<ReferralSource[]> {
    const conditions = [eq(referralSources.practiceId, practiceId)];

    if (filters?.type) {
      conditions.push(eq(referralSources.type, filters.type));
    }
    if (filters?.isActive !== undefined) {
      conditions.push(eq(referralSources.isActive, filters.isActive));
    }

    return db.select()
      .from(referralSources)
      .where(and(...conditions))
      .orderBy(referralSources.name);
  }

  async getReferralSource(id: number): Promise<ReferralSource | undefined> {
    const [source] = await db.select()
      .from(referralSources)
      .where(eq(referralSources.id, id));
    return source;
  }

  async updateReferralSource(id: number, updates: Partial<InsertReferralSource>): Promise<ReferralSource | undefined> {
    const [updated] = await db.update(referralSources)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(referralSources.id, id))
      .returning();
    return updated;
  }

  async deleteReferralSource(id: number): Promise<void> {
    await db.update(referralSources)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(referralSources.id, id));
  }

  // ==================== Referrals ====================

  async createReferral(referral: InsertReferral): Promise<Referral> {
    const [newReferral] = await db.insert(referrals).values(referral).returning();
    return newReferral;
  }

  async getReferrals(practiceId: number, filters?: {
    direction?: string;
    status?: string;
    patientId?: number;
    referralSourceId?: number;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Referral[]> {
    const conditions = [eq(referrals.practiceId, practiceId)];

    if (filters?.direction) {
      conditions.push(eq(referrals.direction, filters.direction));
    }
    if (filters?.status) {
      conditions.push(eq(referrals.status, filters.status));
    }
    if (filters?.patientId) {
      conditions.push(eq(referrals.patientId, filters.patientId));
    }
    if (filters?.referralSourceId) {
      conditions.push(eq(referrals.referralSourceId, filters.referralSourceId));
    }
    if (filters?.startDate) {
      conditions.push(gte(referrals.referralDate, filters.startDate.toISOString().split('T')[0]));
    }
    if (filters?.endDate) {
      conditions.push(lte(referrals.referralDate, filters.endDate.toISOString().split('T')[0]));
    }

    return db.select()
      .from(referrals)
      .where(and(...conditions))
      .orderBy(desc(referrals.referralDate));
  }

  async getReferral(id: number): Promise<Referral | undefined> {
    const [referral] = await db.select()
      .from(referrals)
      .where(eq(referrals.id, id));
    return referral;
  }

  async updateReferral(id: number, updates: Partial<InsertReferral> & {
    statusUpdatedAt?: Date;
    statusUpdatedBy?: string;
  }): Promise<Referral | undefined> {
    const [updated] = await db.update(referrals)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(referrals.id, id))
      .returning();
    return updated;
  }

  async updateReferralStatus(id: number, status: string, userId: string): Promise<Referral | undefined> {
    return this.updateReferral(id, {
      status,
      statusUpdatedAt: new Date(),
      statusUpdatedBy: userId,
    });
  }

  async getPatientReferrals(patientId: number): Promise<Referral[]> {
    return db.select()
      .from(referrals)
      .where(eq(referrals.patientId, patientId))
      .orderBy(desc(referrals.referralDate));
  }

  async getPendingReferrals(practiceId: number): Promise<Referral[]> {
    return db.select()
      .from(referrals)
      .where(and(
        eq(referrals.practiceId, practiceId),
        eq(referrals.status, 'pending')
      ))
      .orderBy(referrals.referralDate);
  }

  async getReferralsNeedingFollowUp(practiceId: number): Promise<Referral[]> {
    const today = new Date().toISOString().split('T')[0];
    return db.select()
      .from(referrals)
      .where(and(
        eq(referrals.practiceId, practiceId),
        eq(referrals.followUpRequired, true),
        eq(referrals.followUpCompleted, false),
        lte(referrals.followUpDate, today)
      ))
      .orderBy(referrals.followUpDate);
  }

  // ==================== Referral Communications ====================

  async createReferralCommunication(communication: InsertReferralCommunication): Promise<ReferralCommunication> {
    const [newComm] = await db.insert(referralCommunications).values(communication).returning();
    return newComm;
  }

  async getReferralCommunications(referralId: number): Promise<ReferralCommunication[]> {
    return db.select()
      .from(referralCommunications)
      .where(eq(referralCommunications.referralId, referralId))
      .orderBy(desc(referralCommunications.createdAt));
  }

  // ==================== Referral Analytics ====================

  async getReferralStats(practiceId: number, startDate?: Date, endDate?: Date): Promise<{
    totalIncoming: number;
    totalOutgoing: number;
    pendingIncoming: number;
    conversionRate: number;
    topSources: { sourceId: number; sourceName: string; count: number }[];
    byStatus: { status: string; count: number }[];
  }> {
    const conditions = [eq(referrals.practiceId, practiceId)];
    if (startDate) {
      conditions.push(gte(referrals.referralDate, startDate.toISOString().split('T')[0]));
    }
    if (endDate) {
      conditions.push(lte(referrals.referralDate, endDate.toISOString().split('T')[0]));
    }

    const allReferrals = await db.select()
      .from(referrals)
      .where(and(...conditions));

    const totalIncoming = allReferrals.filter((r: Referral) => r.direction === 'incoming').length;
    const totalOutgoing = allReferrals.filter((r: Referral) => r.direction === 'outgoing').length;
    const pendingIncoming = allReferrals.filter((r: Referral) => r.direction === 'incoming' && r.status === 'pending').length;

    // Conversion rate: incoming referrals that became scheduled/completed
    const incomingReferrals = allReferrals.filter((r: Referral) => r.direction === 'incoming');
    const convertedReferrals = incomingReferrals.filter((r: Referral) =>
      r.status === 'scheduled' || r.status === 'completed'
    ).length;
    const conversionRate = incomingReferrals.length > 0
      ? (convertedReferrals / incomingReferrals.length) * 100
      : 0;

    // Top referral sources
    const sourceCounts: Record<number, number> = {};
    for (const r of allReferrals) {
      if (r.referralSourceId) {
        sourceCounts[r.referralSourceId] = (sourceCounts[r.referralSourceId] || 0) + 1;
      }
    }

    const sources = await this.getReferralSources(practiceId);
    const topSources = Object.entries(sourceCounts)
      .map(([sourceId, count]) => {
        const source = sources.find((s: ReferralSource) => s.id === parseInt(sourceId));
        return {
          sourceId: parseInt(sourceId),
          sourceName: source?.name || 'Unknown',
          count,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // By status
    const statusCounts: Record<string, number> = {};
    for (const r of allReferrals) {
      const status = r.status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
    const byStatus = Object.entries(statusCounts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalIncoming,
      totalOutgoing,
      pendingIncoming,
      conversionRate,
      topSources,
      byStatus,
    };
  }

  async getReferralWithDetails(id: number): Promise<{
    referral: Referral;
    source: ReferralSource | null;
    patient: Patient | null;
    communications: ReferralCommunication[];
  } | null> {
    const referral = await this.getReferral(id);
    if (!referral) return null;

    const source = referral.referralSourceId
      ? await this.getReferralSource(referral.referralSourceId)
      : null;

    const patient = referral.patientId
      ? await this.getPatient(referral.patientId)
      : null;

    const communications = await this.getReferralCommunications(id);

    return {
      referral,
      source: source || null,
      patient: patient || null,
      communications,
    };
  }

  // ==================== Patient Payment Methods ====================

  async createPatientPaymentMethod(method: InsertPatientPaymentMethod): Promise<PatientPaymentMethod> {
    // If this is marked as default, unset other defaults first
    if (method.isDefault) {
      await db.update(patientPaymentMethods)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(
          eq(patientPaymentMethods.patientId, method.patientId),
          eq(patientPaymentMethods.isActive, true)
        ));
    }
    const [newMethod] = await db.insert(patientPaymentMethods).values(method).returning();
    return newMethod;
  }

  async getPatientPaymentMethods(patientId: number): Promise<PatientPaymentMethod[]> {
    return db.select()
      .from(patientPaymentMethods)
      .where(and(
        eq(patientPaymentMethods.patientId, patientId),
        eq(patientPaymentMethods.isActive, true)
      ))
      .orderBy(desc(patientPaymentMethods.isDefault), patientPaymentMethods.createdAt);
  }

  async getPatientPaymentMethod(id: number): Promise<PatientPaymentMethod | undefined> {
    const [method] = await db.select()
      .from(patientPaymentMethods)
      .where(eq(patientPaymentMethods.id, id));
    return method;
  }

  async getDefaultPaymentMethod(patientId: number): Promise<PatientPaymentMethod | undefined> {
    const [method] = await db.select()
      .from(patientPaymentMethods)
      .where(and(
        eq(patientPaymentMethods.patientId, patientId),
        eq(patientPaymentMethods.isDefault, true),
        eq(patientPaymentMethods.isActive, true)
      ));
    return method;
  }

  async updatePatientPaymentMethod(id: number, updates: Partial<InsertPatientPaymentMethod>): Promise<PatientPaymentMethod | undefined> {
    const [updated] = await db.update(patientPaymentMethods)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(patientPaymentMethods.id, id))
      .returning();
    return updated;
  }

  async setDefaultPaymentMethod(id: number, patientId: number): Promise<PatientPaymentMethod | undefined> {
    // Unset other defaults
    await db.update(patientPaymentMethods)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(
        eq(patientPaymentMethods.patientId, patientId),
        eq(patientPaymentMethods.isActive, true)
      ));

    // Set new default
    return this.updatePatientPaymentMethod(id, { isDefault: true });
  }

  async deletePatientPaymentMethod(id: number): Promise<void> {
    await db.update(patientPaymentMethods)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(patientPaymentMethods.id, id));
  }

  // ==================== Payment Transactions ====================

  async createPaymentTransaction(transaction: InsertPaymentTransaction): Promise<PaymentTransaction> {
    const [newTransaction] = await db.insert(paymentTransactions).values(transaction).returning();
    return newTransaction;
  }

  async getPaymentTransactions(practiceId: number, filters?: {
    patientId?: number;
    status?: string;
    type?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<PaymentTransaction[]> {
    const conditions = [eq(paymentTransactions.practiceId, practiceId)];

    if (filters?.patientId) {
      conditions.push(eq(paymentTransactions.patientId, filters.patientId));
    }
    if (filters?.status) {
      conditions.push(eq(paymentTransactions.status, filters.status));
    }
    if (filters?.type) {
      conditions.push(eq(paymentTransactions.type, filters.type));
    }
    if (filters?.startDate) {
      conditions.push(gte(paymentTransactions.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(paymentTransactions.createdAt, filters.endDate));
    }

    let query = db.select()
      .from(paymentTransactions)
      .where(and(...conditions))
      .orderBy(desc(paymentTransactions.createdAt));

    if (filters?.limit) {
      query = query.limit(filters.limit) as typeof query;
    }

    return query;
  }

  async getPaymentTransaction(id: number): Promise<PaymentTransaction | undefined> {
    const [transaction] = await db.select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, id));
    return transaction;
  }

  async updatePaymentTransaction(id: number, updates: Partial<InsertPaymentTransaction>): Promise<PaymentTransaction | undefined> {
    const [updated] = await db.update(paymentTransactions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(paymentTransactions.id, id))
      .returning();
    return updated;
  }

  async getPatientPaymentHistory(patientId: number): Promise<PaymentTransaction[]> {
    return db.select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.patientId, patientId))
      .orderBy(desc(paymentTransactions.createdAt));
  }

  // ==================== Payment Plans ====================

  async createPaymentPlan(plan: InsertPaymentPlan): Promise<PaymentPlan> {
    const [newPlan] = await db.insert(paymentPlans).values(plan).returning();
    return newPlan;
  }

  async getPaymentPlans(practiceId: number, filters?: {
    patientId?: number;
    status?: string;
  }): Promise<PaymentPlan[]> {
    const conditions = [eq(paymentPlans.practiceId, practiceId)];

    if (filters?.patientId) {
      conditions.push(eq(paymentPlans.patientId, filters.patientId));
    }
    if (filters?.status) {
      conditions.push(eq(paymentPlans.status, filters.status));
    }

    return db.select()
      .from(paymentPlans)
      .where(and(...conditions))
      .orderBy(desc(paymentPlans.createdAt));
  }

  async getPaymentPlan(id: number): Promise<PaymentPlan | undefined> {
    const [plan] = await db.select()
      .from(paymentPlans)
      .where(eq(paymentPlans.id, id));
    return plan;
  }

  async updatePaymentPlan(id: number, updates: Partial<InsertPaymentPlan>): Promise<PaymentPlan | undefined> {
    const [updated] = await db.update(paymentPlans)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(paymentPlans.id, id))
      .returning();
    return updated;
  }

  async getPatientPaymentPlans(patientId: number): Promise<PaymentPlan[]> {
    return db.select()
      .from(paymentPlans)
      .where(eq(paymentPlans.patientId, patientId))
      .orderBy(desc(paymentPlans.createdAt));
  }

  async getActivePaymentPlans(practiceId: number): Promise<PaymentPlan[]> {
    return db.select()
      .from(paymentPlans)
      .where(and(
        eq(paymentPlans.practiceId, practiceId),
        eq(paymentPlans.status, 'active')
      ))
      .orderBy(paymentPlans.nextPaymentDate);
  }

  // ==================== Payment Plan Installments ====================

  async createPaymentPlanInstallment(installment: InsertPaymentPlanInstallment): Promise<PaymentPlanInstallment> {
    const [newInstallment] = await db.insert(paymentPlanInstallments).values(installment).returning();
    return newInstallment;
  }

  async getPaymentPlanInstallments(planId: number): Promise<PaymentPlanInstallment[]> {
    return db.select()
      .from(paymentPlanInstallments)
      .where(eq(paymentPlanInstallments.paymentPlanId, planId))
      .orderBy(paymentPlanInstallments.installmentNumber);
  }

  async updatePaymentPlanInstallment(id: number, updates: Partial<InsertPaymentPlanInstallment>): Promise<PaymentPlanInstallment | undefined> {
    const [updated] = await db.update(paymentPlanInstallments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(paymentPlanInstallments.id, id))
      .returning();
    return updated;
  }

  async getDueInstallments(practiceId: number): Promise<PaymentPlanInstallment[]> {
    const today = new Date().toISOString().split('T')[0];
    const activePlans = await this.getActivePaymentPlans(practiceId);
    const planIds = activePlans.map((p: PaymentPlan) => p.id);

    if (planIds.length === 0) return [];

    return db.select()
      .from(paymentPlanInstallments)
      .where(and(
        inArray(paymentPlanInstallments.paymentPlanId, planIds),
        eq(paymentPlanInstallments.status, 'scheduled'),
        lte(paymentPlanInstallments.dueDate, today)
      ))
      .orderBy(paymentPlanInstallments.dueDate);
  }

  // ==================== Practice Payment Settings ====================

  async getPracticePaymentSettings(practiceId: number): Promise<PracticePaymentSettings | undefined> {
    const [settings] = await db.select()
      .from(practicePaymentSettings)
      .where(eq(practicePaymentSettings.practiceId, practiceId));
    return settings ? decryptPracticePaymentSettingsRecord(settings) as PracticePaymentSettings : undefined;
  }

  async upsertPracticePaymentSettings(settings: InsertPracticePaymentSettings): Promise<PracticePaymentSettings> {
    const encrypted = encryptPracticePaymentSettingsRecord(settings as any);
    const existing = await this.getPracticePaymentSettings(settings.practiceId);

    if (existing) {
      const [updated] = await db.update(practicePaymentSettings)
        .set({ ...encrypted, updatedAt: new Date() })
        .where(eq(practicePaymentSettings.practiceId, settings.practiceId))
        .returning();
      return decryptPracticePaymentSettingsRecord(updated) as PracticePaymentSettings;
    }

    const [created] = await db.insert(practicePaymentSettings).values(encrypted as any).returning();
    return decryptPracticePaymentSettingsRecord(created) as PracticePaymentSettings;
  }

  // ==================== Payment Analytics ====================

  async getPaymentStats(practiceId: number, startDate?: Date, endDate?: Date): Promise<{
    totalCollected: number;
    totalPending: number;
    totalRefunded: number;
    transactionCount: number;
    averagePayment: number;
    byCategory: { category: string; amount: number; count: number }[];
    byMethod: { type: string; amount: number; count: number }[];
  }> {
    const conditions = [eq(paymentTransactions.practiceId, practiceId)];
    if (startDate) {
      conditions.push(gte(paymentTransactions.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(paymentTransactions.createdAt, endDate));
    }

    const transactions = await db.select()
      .from(paymentTransactions)
      .where(and(...conditions));

    const completed = transactions.filter((t: PaymentTransaction) => t.status === 'completed' && t.type === 'payment');
    const pending = transactions.filter((t: PaymentTransaction) => t.status === 'pending');
    const refunded = transactions.filter((t: PaymentTransaction) => t.type === 'refund' && t.status === 'completed');

    const totalCollected = completed.reduce((sum: number, t: PaymentTransaction) => sum + parseFloat(t.amount || '0'), 0);
    const totalPending = pending.reduce((sum: number, t: PaymentTransaction) => sum + parseFloat(t.amount || '0'), 0);
    const totalRefunded = refunded.reduce((sum: number, t: PaymentTransaction) => sum + parseFloat(t.amount || '0'), 0);

    const transactionCount = completed.length;
    const averagePayment = transactionCount > 0 ? totalCollected / transactionCount : 0;

    // By category
    const categoryTotals: Record<string, { amount: number; count: number }> = {};
    for (const t of completed) {
      const cat = t.category || 'other';
      if (!categoryTotals[cat]) categoryTotals[cat] = { amount: 0, count: 0 };
      categoryTotals[cat].amount += parseFloat(t.amount || '0');
      categoryTotals[cat].count++;
    }
    const byCategory = Object.entries(categoryTotals)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.amount - a.amount);

    // By payment method type
    const methodTotals: Record<string, { amount: number; count: number }> = {};
    for (const t of completed) {
      const method = t.processor || 'unknown';
      if (!methodTotals[method]) methodTotals[method] = { amount: 0, count: 0 };
      methodTotals[method].amount += parseFloat(t.amount || '0');
      methodTotals[method].count++;
    }
    const byMethod = Object.entries(methodTotals)
      .map(([type, data]) => ({ type, ...data }))
      .sort((a, b) => b.amount - a.amount);

    return {
      totalCollected,
      totalPending,
      totalRefunded,
      transactionCount,
      averagePayment,
      byCategory,
      byMethod,
    };
  }

  async getPatientBalance(patientId: number): Promise<{
    totalCharges: number;
    totalPayments: number;
    totalAdjustments: number;
    currentBalance: number;
  }> {
    const transactions = await this.getPatientPaymentHistory(patientId);

    let totalCharges = 0;
    let totalPayments = 0;
    let totalAdjustments = 0;

    for (const t of transactions) {
      if (t.status !== 'completed') continue;
      const amount = parseFloat(t.amount || '0');

      if (t.type === 'payment') {
        totalPayments += amount;
      } else if (t.type === 'refund') {
        totalPayments -= amount;
      } else if (t.type === 'adjustment' || t.type === 'write_off') {
        totalAdjustments += amount;
      }
    }

    // Get charges from statements
    const statements = await this.getPatientStatements(patientId);
    for (const s of statements) {
      totalCharges += parseFloat(s.totalAmount || '0');
    }

    const currentBalance = totalCharges - totalPayments - totalAdjustments;

    return { totalCharges, totalPayments, totalAdjustments, currentBalance };
  }

  // Get payment plan with installments
  async getPaymentPlanWithInstallments(planId: number): Promise<{
    plan: PaymentPlan;
    installments: PaymentPlanInstallment[];
  } | null> {
    const plan = await this.getPaymentPlan(planId);
    if (!plan) return null;

    const installments = await this.getPaymentPlanInstallments(planId);
    return { plan, installments };
  }

  // Get single installment
  async getPaymentPlanInstallment(id: number): Promise<PaymentPlanInstallment | undefined> {
    const [installment] = await db.select()
      .from(paymentPlanInstallments)
      .where(eq(paymentPlanInstallments.id, id));
    return installment;
  }

  // Get upcoming installments (within N days)
  async getUpcomingInstallments(practiceId: number, days: number = 7): Promise<PaymentPlanInstallment[]> {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + days);

    const activePlans = await this.getActivePaymentPlans(practiceId);
    const planIds = activePlans.map((p: PaymentPlan) => p.id);

    if (planIds.length === 0) return [];

    return db.select()
      .from(paymentPlanInstallments)
      .where(and(
        inArray(paymentPlanInstallments.paymentPlanId, planIds),
        eq(paymentPlanInstallments.status, 'scheduled'),
        gte(paymentPlanInstallments.dueDate, today.toISOString().split('T')[0]),
        lte(paymentPlanInstallments.dueDate, futureDate.toISOString().split('T')[0])
      ))
      .orderBy(paymentPlanInstallments.dueDate);
  }

  // Get overdue installments
  async getOverdueInstallments(practiceId: number): Promise<PaymentPlanInstallment[]> {
    const today = new Date().toISOString().split('T')[0];
    const activePlans = await this.getActivePaymentPlans(practiceId);
    const planIds = activePlans.map((p: PaymentPlan) => p.id);

    if (planIds.length === 0) return [];

    return db.select()
      .from(paymentPlanInstallments)
      .where(and(
        inArray(paymentPlanInstallments.paymentPlanId, planIds),
        eq(paymentPlanInstallments.status, 'scheduled'),
        lt(paymentPlanInstallments.dueDate, today)
      ))
      .orderBy(paymentPlanInstallments.dueDate);
  }

  // ==================== INSURANCE RATE / FEE SCHEDULE METHODS ====================

  async getInsuranceRates(insuranceProvider?: string): Promise<InsuranceRate[]> {
    if (insuranceProvider) {
      return db.select()
        .from(insuranceRates)
        .where(eq(insuranceRates.insuranceProvider, insuranceProvider))
        .orderBy(insuranceRates.cptCode);
    }
    return db.select()
      .from(insuranceRates)
      .orderBy(insuranceRates.insuranceProvider, insuranceRates.cptCode);
  }

  async getInsuranceRateByCode(insuranceProvider: string, cptCode: string): Promise<InsuranceRate | undefined> {
    const [rate] = await db.select()
      .from(insuranceRates)
      .where(and(
        eq(insuranceRates.insuranceProvider, insuranceProvider),
        eq(insuranceRates.cptCode, cptCode)
      ))
      .limit(1);
    return rate;
  }

  async createInsuranceRate(rate: InsertInsuranceRate): Promise<InsuranceRate> {
    const [created] = await db.insert(insuranceRates).values(rate).returning();
    return created;
  }

  async updateInsuranceRate(id: number, updates: Partial<InsertInsuranceRate>): Promise<InsuranceRate | undefined> {
    const [updated] = await db.update(insuranceRates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(insuranceRates.id, id))
      .returning();
    return updated;
  }

  async deleteInsuranceRate(id: number): Promise<void> {
    await db.delete(insuranceRates).where(eq(insuranceRates.id, id));
  }

  async upsertInsuranceRate(rate: InsertInsuranceRate): Promise<InsuranceRate> {
    // Check if exists
    const existing = await this.getInsuranceRateByCode(rate.insuranceProvider, rate.cptCode);
    if (existing) {
      return (await this.updateInsuranceRate(existing.id, rate))!;
    }
    return this.createInsuranceRate(rate);
  }

  async getUniqueInsuranceProviders(): Promise<string[]> {
    const results = await db.selectDistinct({ provider: insuranceRates.insuranceProvider })
      .from(insuranceRates)
      .orderBy(insuranceRates.insuranceProvider);
    return results.map((r: { provider: string }) => r.provider);
  }

  // Get rates ranked by reimbursement for a payer (highest paying first)
  async getRatesRankedByReimbursement(insuranceProvider: string): Promise<InsuranceRate[]> {
    return db.select()
      .from(insuranceRates)
      .where(eq(insuranceRates.insuranceProvider, insuranceProvider))
      .orderBy(desc(insuranceRates.inNetworkRate));
  }

  // Get the best-paying code among a set of equivalent codes for a payer
  async getBestPayingCode(insuranceProvider: string, cptCodeList: string[]): Promise<InsuranceRate | undefined> {
    const [best] = await db.select()
      .from(insuranceRates)
      .where(
        and(
          eq(insuranceRates.insuranceProvider, insuranceProvider),
          inArray(insuranceRates.cptCode, cptCodeList)
        )
      )
      .orderBy(desc(insuranceRates.inNetworkRate))
      .limit(1);
    return best;
  }

  // ==================== CPT CODE EQUIVALENCIES ====================

  async createCptCodeEquivalency(equivalency: InsertCptCodeEquivalency): Promise<CptCodeEquivalency> {
    const [created] = await db.insert(cptCodeEquivalencies).values(equivalency).returning();
    return created;
  }

  async getCptCodeEquivalencies(cptCodeId: number): Promise<CptCodeEquivalency[]> {
    return db.select()
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

  async getEquivalentCodesForIntervention(interventionCategory: string): Promise<CptCodeEquivalency[]> {
    return db.select()
      .from(cptCodeEquivalencies)
      .where(
        and(
          eq(cptCodeEquivalencies.interventionCategory, interventionCategory),
          eq(cptCodeEquivalencies.isActive, true)
        )
      );
  }

  async getAllCptCodeEquivalencies(): Promise<CptCodeEquivalency[]> {
    return db.select()
      .from(cptCodeEquivalencies)
      .where(eq(cptCodeEquivalencies.isActive, true));
  }

  async deleteCptCodeEquivalency(id: number): Promise<void> {
    await db.update(cptCodeEquivalencies)
      .set({ isActive: false })
      .where(eq(cptCodeEquivalencies.id, id));
  }

  // ==================== PATIENT CONSENTS ====================

  async createPatientConsent(consent: InsertPatientConsent): Promise<PatientConsent> {
    const [created] = await db.insert(patientConsents).values(consent).returning();
    return created;
  }

  async getPatientConsents(patientId: number): Promise<PatientConsent[]> {
    return db.select()
      .from(patientConsents)
      .where(eq(patientConsents.patientId, patientId))
      .orderBy(desc(patientConsents.createdAt));
  }

  async getPatientConsentsByType(patientId: number, consentType: string): Promise<PatientConsent[]> {
    return db.select()
      .from(patientConsents)
      .where(
        and(
          eq(patientConsents.patientId, patientId),
          eq(patientConsents.consentType, consentType),
          eq(patientConsents.isRevoked, false)
        )
      )
      .orderBy(desc(patientConsents.createdAt));
  }

  async getActiveConsent(patientId: number, consentType: string): Promise<PatientConsent | undefined> {
    const [consent] = await db.select()
      .from(patientConsents)
      .where(
        and(
          eq(patientConsents.patientId, patientId),
          eq(patientConsents.consentType, consentType),
          eq(patientConsents.isRevoked, false)
        )
      )
      .orderBy(desc(patientConsents.createdAt))
      .limit(1);
    return consent;
  }

  async revokeConsent(consentId: number, revokedBy: string, reason?: string): Promise<PatientConsent | undefined> {
    const [updated] = await db.update(patientConsents)
      .set({
        isRevoked: true,
        revokedDate: new Date(),
        revokedBy,
        revocationReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(patientConsents.id, consentId))
      .returning();
    return updated;
  }

  async getConsentsByPractice(practiceId: number, filters?: { consentType?: string; isRevoked?: boolean }): Promise<PatientConsent[]> {
    let query = db.select()
      .from(patientConsents)
      .where(eq(patientConsents.practiceId, practiceId));

    if (filters?.consentType) {
      query = query.where(eq(patientConsents.consentType, filters.consentType)) as any;
    }
    if (filters?.isRevoked !== undefined) {
      query = query.where(eq(patientConsents.isRevoked, filters.isRevoked)) as any;
    }

    return query.orderBy(desc(patientConsents.createdAt));
  }

  /**
   * HIPAA Compliance: Verify patient has required consents for PHI access
   * Returns true if patient has active (non-revoked, non-expired) consent of required type
   */
  async hasActiveConsent(patientId: number, consentType: string): Promise<boolean> {
    const consent = await this.getActiveConsent(patientId, consentType);
    if (!consent) return false;

    // Check if consent has expired
    if (consent.expirationDate && new Date(consent.expirationDate) < new Date()) {
      return false;
    }

    return true;
  }

  /**
   * HIPAA Compliance: Check if patient has all required consents for treatment
   * Required consents: 'hipaa_release', 'treatment'
   */
  async hasRequiredTreatmentConsents(patientId: number): Promise<{
    hasConsent: boolean;
    missingConsents: string[];
  }> {
    const requiredConsents = ['hipaa_release', 'treatment'];
    const missingConsents: string[] = [];

    for (const consentType of requiredConsents) {
      const hasConsent = await this.hasActiveConsent(patientId, consentType);
      if (!hasConsent) {
        missingConsents.push(consentType);
      }
    }

    return {
      hasConsent: missingConsents.length === 0,
      missingConsents,
    };
  }

  /**
   * Batch consent check: single query for multiple patients.
   * Returns a Map from patientId to { hasConsent, missingConsents }.
   */
  async batchGetConsentStatus(patientIds: number[]): Promise<Map<number, { hasConsent: boolean; missingConsents: string[] }>> {
    const result = new Map<number, { hasConsent: boolean; missingConsents: string[] }>();
    const requiredConsents = ['hipaa_release', 'treatment'];

    if (patientIds.length === 0) return result;

    // Single query: get all active (non-revoked) consents of required types for all patient IDs
    const allConsents = await db
      .select()
      .from(patientConsents)
      .where(
        and(
          inArray(patientConsents.patientId, patientIds),
          inArray(patientConsents.consentType, requiredConsents),
          eq(patientConsents.isRevoked, false)
        )
      );

    // Build a set of active consent types per patient
    const activeConsentsMap = new Map<number, Set<string>>();
    for (const consent of allConsents) {
      // Check expiration (same logic as hasActiveConsent)
      if (consent.expirationDate && new Date(consent.expirationDate) < new Date()) {
        continue;
      }
      if (!activeConsentsMap.has(consent.patientId)) {
        activeConsentsMap.set(consent.patientId, new Set());
      }
      activeConsentsMap.get(consent.patientId)!.add(consent.consentType);
    }

    // Compute status for each patient
    for (const patientId of patientIds) {
      const activeTypes = activeConsentsMap.get(patientId) || new Set();
      const missingConsents = requiredConsents.filter(type => !activeTypes.has(type));
      result.set(patientId, {
        hasConsent: missingConsents.length === 0,
        missingConsents,
      });
    }

    return result;
  }

  /**
   * Batch fetch patients by IDs in a single query.
   */
  async getPatientsByIds(ids: number[]): Promise<Map<number, Patient>> {
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

  // Therapy Bank operations
  async getTherapyBank(practiceId: number): Promise<TherapyBank[]> {
    return await db
      .select()
      .from(therapyBank)
      .where(eq(therapyBank.practiceId, practiceId))
      .orderBy(desc(therapyBank.createdAt));
  }

  async createTherapyBankEntry(entry: InsertTherapyBank): Promise<TherapyBank> {
    const [newEntry] = await db
      .insert(therapyBank)
      .values(entry)
      .returning();
    return newEntry;
  }

  async deleteTherapyBankEntry(id: number): Promise<void> {
    await db
      .delete(therapyBank)
      .where(eq(therapyBank.id, id));
  }

  // Exercise Bank operations
  async getExerciseBank(practiceId: number, category?: string): Promise<ExerciseBank[]> {
    let query = db
      .select()
      .from(exerciseBank)
      .where(eq(exerciseBank.practiceId, practiceId));

    if (category) {
      query = query.where(and(
        eq(exerciseBank.practiceId, practiceId),
        eq(exerciseBank.category, category)
      )) as any;
    }

    return await query.orderBy(exerciseBank.category, exerciseBank.exerciseName);
  }

  async createExerciseBankEntry(entry: InsertExerciseBank): Promise<ExerciseBank> {
    const [newEntry] = await db
      .insert(exerciseBank)
      .values(entry)
      .returning();
    return newEntry;
  }

  async deleteExerciseBankEntry(id: number): Promise<void> {
    await db
      .delete(exerciseBank)
      .where(eq(exerciseBank.id, id));
  }

  // Claim Outcomes operations (for OON reimbursement ML training)
  async createClaimOutcome(outcome: InsertClaimOutcome): Promise<ClaimOutcome> {
    const [newOutcome] = await db
      .insert(claimOutcomes)
      .values(outcome)
      .returning();
    return newOutcome;
  }

  async getClaimOutcomes(practiceId: number, filters?: {
    insuranceProvider?: string;
    cptCode?: string;
    startDate?: Date;
    endDate?: Date;
    hasOutcome?: boolean;
  }): Promise<ClaimOutcome[]> {
    let conditions = [eq(claimOutcomes.practiceId, practiceId)];

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

  async updateClaimOutcome(id: number, outcome: Partial<InsertClaimOutcome>): Promise<ClaimOutcome> {
    const [updated] = await db
      .update(claimOutcomes)
      .set({ ...outcome, updatedAt: new Date() })
      .where(eq(claimOutcomes.id, id))
      .returning();
    return updated;
  }

  async getClaimOutcomeById(id: number): Promise<ClaimOutcome | undefined> {
    const [outcome] = await db
      .select()
      .from(claimOutcomes)
      .where(eq(claimOutcomes.id, id));
    return outcome;
  }

  // Get training data for ML model
  async getClaimOutcomesForTraining(minDataPoints: number = 100): Promise<ClaimOutcome[]> {
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

  // ============================================
  // Patient Plan Documents & Benefits
  // ============================================

  async createPlanDocument(document: InsertPatientPlanDocument): Promise<PatientPlanDocument> {
    const [created] = await db
      .insert(patientPlanDocuments)
      .values(document)
      .returning();
    return created;
  }

  async getPlanDocuments(patientId: number): Promise<PatientPlanDocument[]> {
    return await db
      .select()
      .from(patientPlanDocuments)
      .where(eq(patientPlanDocuments.patientId, patientId))
      .orderBy(desc(patientPlanDocuments.createdAt));
  }

  async getPlanDocument(id: number): Promise<PatientPlanDocument | undefined> {
    const [document] = await db
      .select()
      .from(patientPlanDocuments)
      .where(eq(patientPlanDocuments.id, id));
    return document;
  }

  async updatePlanDocument(id: number, data: Partial<InsertPatientPlanDocument>): Promise<PatientPlanDocument> {
    const [updated] = await db
      .update(patientPlanDocuments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(patientPlanDocuments.id, id))
      .returning();
    return updated;
  }

  async deletePlanDocument(id: number): Promise<void> {
    await db.delete(patientPlanDocuments).where(eq(patientPlanDocuments.id, id));
  }

  async createPlanBenefits(benefits: InsertPatientPlanBenefits): Promise<PatientPlanBenefits> {
    const [created] = await db
      .insert(patientPlanBenefits)
      .values(benefits)
      .returning();
    return created;
  }

  async getPatientPlanBenefits(patientId: number): Promise<PatientPlanBenefits | undefined> {
    // Get the most recent active benefits for a patient
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

  async getAllPatientPlanBenefits(patientId: number): Promise<PatientPlanBenefits[]> {
    return await db
      .select()
      .from(patientPlanBenefits)
      .where(eq(patientPlanBenefits.patientId, patientId))
      .orderBy(desc(patientPlanBenefits.createdAt));
  }

  async updatePlanBenefits(id: number, data: Partial<InsertPatientPlanBenefits>): Promise<PatientPlanBenefits> {
    const [updated] = await db
      .update(patientPlanBenefits)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(patientPlanBenefits.id, id))
      .returning();
    return updated;
  }

  async deactivatePlanBenefits(patientId: number): Promise<void> {
    // Deactivate all existing benefits for a patient (when new ones are added)
    await db
      .update(patientPlanBenefits)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(patientPlanBenefits.patientId, patientId));
  }

  async verifyPlanBenefits(id: number, verifiedBy: string): Promise<PatientPlanBenefits> {
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

  // Webhook event idempotency operations
  async getWebhookEvent(eventId: string): Promise<WebhookEvent | undefined> {
    const [event] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, eventId))
      .limit(1);
    return event;
  }

  async createWebhookEvent(eventId: string, eventType: string, status: string, metadata?: any): Promise<WebhookEvent> {
    const [event] = await db
      .insert(webhookEvents)
      .values({ eventId, eventType, status, metadata: metadata ?? null })
      .returning();
    return event;
  }

  async updateWebhookEventStatus(eventId: string, status: string): Promise<void> {
    await db
      .update(webhookEvents)
      .set({ status })
      .where(eq(webhookEvents.eventId, eventId));
  }

  // ==================== Patient Payments ====================

  async createPatientPayment(payment: InsertPatientPayment): Promise<PatientPayment> {
    const [result] = await db.insert(patientPayments).values(payment).returning();
    return result;
  }

  async getPatientPayments(patientId: number): Promise<PatientPayment[]> {
    return db
      .select()
      .from(patientPayments)
      .where(eq(patientPayments.patientId, patientId))
      .orderBy(desc(patientPayments.paymentDate));
  }

  async getPatientPaymentsByPractice(practiceId: number): Promise<PatientPayment[]> {
    return db
      .select()
      .from(patientPayments)
      .where(eq(patientPayments.practiceId, practiceId))
      .orderBy(desc(patientPayments.paymentDate));
  }

  // ==================== Patient Billing AR Aging ====================

  async getPatientArAging(practiceId: number): Promise<{
    totalOutstanding: number;
    buckets: { bucket: string; count: number; amount: number }[];
    byPatient: { patientId: number; patientName: string; totalOwed: number; oldestDays: number }[];
  }> {
    const now = new Date();

    // Get all outstanding (non-paid, non-cancelled) statements for the practice
    const outstandingStatements = await db
      .select()
      .from(patientStatements)
      .where(and(
        eq(patientStatements.practiceId, practiceId),
        or(
          eq(patientStatements.status, 'pending'),
          eq(patientStatements.status, 'sent'),
          eq(patientStatements.status, 'viewed'),
          eq(patientStatements.status, 'overdue')
        )
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
      const balance = parseFloat(stmt.balanceDue || '0');
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

      // Aggregate by patient
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

    // Get patient names
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

      // Sort by totalOwed descending
      byPatient.sort((a, b) => b.totalOwed - a.totalOwed);
    }

    return {
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      buckets,
      byPatient,
    };
  }
}

export const storage = new DatabaseStorage();

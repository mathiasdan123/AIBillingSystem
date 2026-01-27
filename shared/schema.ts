import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  serial,
  decimal,
  integer,
  boolean,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table (required for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  practiceId: integer("practice_id").references(() => practices.id),
  role: varchar("role").default("therapist"), // therapist, admin, billing
  mfaEnabled: boolean("mfa_enabled").default(false),
  mfaSecret: jsonb("mfa_secret"), // encrypted with PHI encryption
  mfaBackupCodes: jsonb("mfa_backup_codes"), // encrypted, array of hashed codes
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Practice/Clinic information
export const practices = pgTable("practices", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  npi: varchar("npi").unique(),
  taxId: varchar("tax_id"),
  address: text("address"),
  phone: varchar("phone"),
  email: varchar("email"),
  // Additional practice fields
  monthlyClaimsVolume: integer("monthly_claims_volume"),
  professionalLicense: varchar("professional_license"),
  licenseExpiration: date("license_expiration"),
  businessLicense: varchar("business_license"),
  caqhProfileId: varchar("caqh_profile_id"),
  insuranceCertificateStatus: varchar("insurance_certificate_status"),
  w9FormStatus: varchar("w9_form_status"),
  itContactName: varchar("it_contact_name"),
  itContactEmail: varchar("it_contact_email"),
  itContactPhone: varchar("it_contact_phone"),
  billingContactName: varchar("billing_contact_name"),
  billingContactEmail: varchar("billing_contact_email"),
  billingContactPhone: varchar("billing_contact_phone"),
  ediEnrollmentStatus: varchar("edi_enrollment_status"),
  optumSubmitterId: varchar("optum_submitter_id"),
  optumReceiverId: varchar("optum_receiver_id"),
  lastEnrollmentCheck: timestamp("last_enrollment_check"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Patients
export const patients = pgTable("patients", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  firstName: varchar("first_name").notNull(),
  lastName: varchar("last_name").notNull(),
  dateOfBirth: date("date_of_birth"),
  email: varchar("email"),
  phone: varchar("phone"),
  address: text("address"),
  insuranceProvider: varchar("insurance_provider"),
  insuranceId: varchar("insurance_id"),
  policyNumber: varchar("policy_number"),
  groupNumber: varchar("group_number"),
  deletedAt: timestamp("deleted_at"), // soft delete for HIPAA patient rights
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insurance information
export const insurances = pgTable("insurances", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  payerCode: varchar("payer_code").unique(),
  eligibilityApiConfig: jsonb("eligibility_api_config"),
  claimSubmissionConfig: jsonb("claim_submission_config"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// CPT Codes for OT services
export const cptCodes = pgTable("cpt_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code").unique().notNull(),
  description: text("description").notNull(),
  category: varchar("category"), // evaluation, treatment, etc.
  baseRate: decimal("base_rate", { precision: 10, scale: 2 }),
  cashRate: decimal("cash_rate", { precision: 10, scale: 2 }),
  billingUnits: integer("billing_units").default(1), // 15-minute units
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ICD-10 Codes
export const icd10Codes = pgTable("icd10_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code").unique().notNull(),
  description: text("description").notNull(),
  category: varchar("category"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Treatment sessions
export const treatmentSessions = pgTable("treatment_sessions", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  therapistId: varchar("therapist_id").references(() => users.id).notNull(),
  sessionDate: date("session_date").notNull(),
  duration: integer("duration"), // in minutes
  cptCodeId: integer("cpt_code_id").references(() => cptCodes.id).notNull(),
  icd10CodeId: integer("icd10_code_id").references(() => icd10Codes.id),
  units: integer("units").default(1),
  notes: text("notes"),
  status: varchar("status").default("completed"), // completed, cancelled, no_show
  dataSource: varchar("data_source").default("manual"), // manual, voice, upload, ehr_sync, calendar_sync
  voiceTranscriptionUrl: text("voice_transcription_url"),
  uploadedDocumentUrl: text("uploaded_document_url"),
  originalDocumentText: text("original_document_text"),
  aiExtractedData: jsonb("ai_extracted_data"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// SOAP Notes for treatment sessions
export const soapNotes = pgTable("soap_notes", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => treatmentSessions.id).notNull(),
  subjective: text("subjective").notNull(), // Patient reports, parent feedback
  objective: text("objective").notNull(), // Therapist observations, activities performed
  assessment: text("assessment").notNull(), // Clinical reasoning, progress analysis
  plan: text("plan").notNull(), // Future treatment plans, goals
  location: varchar("location"), // Sensory gym, clinic room, etc.
  sessionType: varchar("session_type").default("individual"), // individual, group
  interventions: jsonb("interventions"), // Structured list of activities/interventions
  progressNotes: text("progress_notes"), // Additional progress observations
  homeProgram: text("home_program"), // Home exercise program updates
  aiSuggestedCptCodes: jsonb("ai_suggested_cpt_codes"), // AI recommendations with reasoning
  originalCptCode: integer("original_cpt_code_id").references(() => cptCodes.id),
  optimizedCptCode: integer("optimized_cpt_code_id").references(() => cptCodes.id),
  cptOptimizationReason: text("cpt_optimization_reason"), // Why AI suggested the change
  dataSource: varchar("data_source").default("manual"), // manual, voice, ai_extracted
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CPT Code optimization mappings by insurance
export const cptCodeMappings = pgTable("cpt_code_mappings", {
  id: serial("id").primaryKey(),
  insuranceId: integer("insurance_id").references(() => insurances.id).notNull(),
  originalCptCodeId: integer("original_cpt_code_id").references(() => cptCodes.id).notNull(),
  optimizedCptCodeId: integer("optimized_cpt_code_id").references(() => cptCodes.id).notNull(),
  optimizationReason: text("optimization_reason"), // Why this mapping works better
  successRate: decimal("success_rate", { precision: 5, scale: 2 }), // Historical success rate
  averageReimbursement: decimal("average_reimbursement", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Claims
export const claims = pgTable("claims", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  sessionId: integer("session_id").references(() => treatmentSessions.id),
  claimNumber: varchar("claim_number").unique(),
  insuranceId: integer("insurance_id").references(() => insurances.id),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  submittedAmount: decimal("submitted_amount", { precision: 10, scale: 2 }),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }),
  expectedAmount: decimal("expected_amount", { precision: 10, scale: 2 }), // benchmarked amount
  optimizedAmount: decimal("optimized_amount", { precision: 10, scale: 2 }), // what we got through optimization
  status: varchar("status").default("draft"), // draft, submitted, paid, denied, appeal, optimized
  submittedAt: timestamp("submitted_at"),
  paidAt: timestamp("paid_at"),
  denialReason: text("denial_reason"),
  aiReviewScore: decimal("ai_review_score", { precision: 3, scale: 2 }),
  aiReviewNotes: text("ai_review_notes"),
  reimbursementOptimizationId: integer("reimbursement_optimization_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Claim Line Items (multiple CPT codes per claim/superbill)
export const claimLineItems = pgTable("claim_line_items", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").references(() => claims.id).notNull(),
  cptCodeId: integer("cpt_code_id").references(() => cptCodes.id).notNull(),
  icd10CodeId: integer("icd10_code_id").references(() => icd10Codes.id),
  units: integer("units").default(1).notNull(),
  rate: decimal("rate", { precision: 10, scale: 2 }).notNull(), // rate at time of billing
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(), // units × rate
  dateOfService: date("date_of_service"),
  modifier: varchar("modifier"), // CPT modifier (e.g., 59, GP)
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Expenses
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  category: varchar("category"), // rent, supplies, equipment, etc.
  expenseDate: date("expense_date").notNull(),
  receiptUrl: varchar("receipt_url"),
  isDeductible: boolean("is_deductible").default(true),
  aiCategory: varchar("ai_category"), // AI-suggested category
  aiConfidence: decimal("ai_confidence", { precision: 3, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Reimbursement optimization tracking
export const reimbursementOptimizations = pgTable("reimbursement_optimizations", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  claimId: integer("claim_id"),
  originalAmount: decimal("original_amount", { precision: 10, scale: 2 }).notNull(),
  optimizedAmount: decimal("optimized_amount", { precision: 10, scale: 2 }).notNull(),
  improvementAmount: decimal("improvement_amount", { precision: 10, scale: 2 }).notNull(),
  ourShareAmount: decimal("our_share_amount", { precision: 10, scale: 2 }).notNull(), // 50% of improvement
  optimizationType: varchar("optimization_type"), // appeal, negotiation, coding_improvement, rate_optimization
  optimizationNotes: text("optimization_notes"),
  status: varchar("status").default("pending"), // pending, completed, failed
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Reimbursement benchmarks
export const reimbursementBenchmarks = pgTable("reimbursement_benchmarks", {
  id: serial("id").primaryKey(),
  cptCodeId: integer("cpt_code_id").references(() => cptCodes.id).notNull(),
  insuranceId: integer("insurance_id").references(() => insurances.id).notNull(),
  averageReimbursement: decimal("average_reimbursement", { precision: 10, scale: 2 }).notNull(),
  maxReimbursement: decimal("max_reimbursement", { precision: 10, scale: 2 }).notNull(),
  minReimbursement: decimal("min_reimbursement", { precision: 10, scale: 2 }).notNull(),
  sampleSize: integer("sample_size").notNull(),
  lastUpdated: timestamp("last_updated").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Automated data capture logs
export const dataCaptureEvents = pgTable("data_capture_events", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  sessionId: integer("session_id").references(() => treatmentSessions.id),
  eventType: varchar("event_type").notNull(), // voice_upload, document_upload, ehr_sync, calendar_sync
  originalData: text("original_data"),
  extractedData: jsonb("extracted_data"),
  aiConfidence: decimal("ai_confidence", { precision: 3, scale: 2 }),
  processingStatus: varchar("processing_status").default("pending"), // pending, completed, failed, needs_review
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

// SOAP Note Templates
export const soapNoteTemplates = pgTable("soap_note_templates", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id),
  title: varchar("title"),
  section: varchar("section"),
  content: text("content"),
  category: varchar("category"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// SOAP Note Drafts
export const soapNoteDrafts = pgTable("soap_note_drafts", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id),
  therapistId: varchar("therapist_id"), // No FK constraint - may have placeholder values
  draftName: varchar("draft_name"),
  formData: jsonb("form_data"),
  caregiverDropdownState: jsonb("caregiver_dropdown_state"),
  otInterventions: jsonb("ot_interventions"),
  aiOptimization: jsonb("ai_optimization"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Appointments / Calendar
export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id),
  patientId: integer("patient_id").references(() => patients.id),
  therapistId: varchar("therapist_id").references(() => users.id),
  title: varchar("title"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  status: varchar("status").default("scheduled"), // scheduled, completed, cancelled, no_show
  notes: text("notes"),
  reminderSent: boolean("reminder_sent").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Invoices
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id),
  patientId: integer("patient_id").references(() => patients.id),
  invoiceNumber: varchar("invoice_number").unique(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status").default("draft"), // draft, sent, paid, overdue
  dueDate: date("due_date"),
  paidDate: date("paid_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Invites for adding users to practices
export const invites = pgTable("invites", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  email: varchar("email").notNull(),
  role: varchar("role").default("therapist"), // therapist, billing, admin
  token: varchar("token").unique().notNull(),
  invitedById: varchar("invited_by_id").references(() => users.id).notNull(),
  status: varchar("status").default("pending"), // pending, accepted, expired
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Payment records
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id),
  claimId: integer("claim_id"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method"), // insurance, patient, cash
  paymentType: varchar("payment_type"), // copay, coinsurance, deductible, full
  paymentDate: date("payment_date").notNull(),
  transactionId: varchar("transaction_id"),
  referenceNumber: varchar("reference_number"),
  notes: text("notes"),
  status: varchar("status").default("completed"), // completed, pending, failed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Eligibility Checks - stores results from eligibility verification
export const eligibilityChecks = pgTable("eligibility_checks", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  insuranceId: integer("insurance_id").references(() => insurances.id),
  checkDate: timestamp("check_date").defaultNow(),
  status: varchar("status").notNull(), // "active", "inactive", "unknown"
  coverageType: varchar("coverage_type"), // "HMO", "PPO", "Medicare", etc.
  effectiveDate: date("effective_date"),
  terminationDate: date("termination_date"),
  copay: decimal("copay", { precision: 10, scale: 2 }),
  deductible: decimal("deductible", { precision: 10, scale: 2 }),
  deductibleMet: decimal("deductible_met", { precision: 10, scale: 2 }),
  outOfPocketMax: decimal("out_of_pocket_max", { precision: 10, scale: 2 }),
  outOfPocketMet: decimal("out_of_pocket_met", { precision: 10, scale: 2 }),
  coinsurance: integer("coinsurance"), // percentage (e.g., 20 for 20%)
  visitsAllowed: integer("visits_allowed"), // total visits per year
  visitsUsed: integer("visits_used"),
  authRequired: boolean("auth_required"),
  rawResponse: jsonb("raw_response"), // store full API response for debugging
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ one }) => ({
  practice: one(practices, {
    fields: [users.practiceId],
    references: [practices.id],
  }),
}));

export const practicesRelations = relations(practices, ({ many }) => ({
  users: many(users),
  patients: many(patients),
  treatmentSessions: many(treatmentSessions),
  claims: many(claims),
  expenses: many(expenses),
  payments: many(payments),
}));

export const patientsRelations = relations(patients, ({ one, many }) => ({
  practice: one(practices, {
    fields: [patients.practiceId],
    references: [practices.id],
  }),
  treatmentSessions: many(treatmentSessions),
  claims: many(claims),
  payments: many(payments),
}));

export const treatmentSessionsRelations = relations(treatmentSessions, ({ one }) => ({
  practice: one(practices, {
    fields: [treatmentSessions.practiceId],
    references: [practices.id],
  }),
  patient: one(patients, {
    fields: [treatmentSessions.patientId],
    references: [patients.id],
  }),
  therapist: one(users, {
    fields: [treatmentSessions.therapistId],
    references: [users.id],
  }),
  cptCode: one(cptCodes, {
    fields: [treatmentSessions.cptCodeId],
    references: [cptCodes.id],
  }),
  icd10Code: one(icd10Codes, {
    fields: [treatmentSessions.icd10CodeId],
    references: [icd10Codes.id],
  }),
}));

export const claimsRelations = relations(claims, ({ one, many }) => ({
  practice: one(practices, {
    fields: [claims.practiceId],
    references: [practices.id],
  }),
  patient: one(patients, {
    fields: [claims.patientId],
    references: [patients.id],
  }),
  session: one(treatmentSessions, {
    fields: [claims.sessionId],
    references: [treatmentSessions.id],
  }),
  insurance: one(insurances, {
    fields: [claims.insuranceId],
    references: [insurances.id],
  }),
  lineItems: many(claimLineItems),
}));

export const claimLineItemsRelations = relations(claimLineItems, ({ one }) => ({
  claim: one(claims, {
    fields: [claimLineItems.claimId],
    references: [claims.id],
  }),
  cptCode: one(cptCodes, {
    fields: [claimLineItems.cptCodeId],
    references: [cptCodes.id],
  }),
  icd10Code: one(icd10Codes, {
    fields: [claimLineItems.icd10CodeId],
    references: [icd10Codes.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPracticeSchema = createInsertSchema(practices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPatientSchema = createInsertSchema(patients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTreatmentSessionSchema = createInsertSchema(treatmentSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertClaimSchema = createInsertSchema(claims).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertClaimLineItemSchema = createInsertSchema(claimLineItems).omit({
  id: true,
  createdAt: true,
});

export const insertExpenseSchema = createInsertSchema(expenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
});

export const insertSoapNoteSchema = createInsertSchema(soapNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCptCodeMappingSchema = createInsertSchema(cptCodeMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Insurance reimbursement rates table
export const insuranceRates = pgTable("insurance_rates", {
  id: serial("id").primaryKey(),
  insuranceProvider: varchar("insurance_provider", { length: 100 }).notNull(),
  cptCode: varchar("cpt_code", { length: 10 }).notNull(),
  inNetworkRate: decimal("in_network_rate", { precision: 8, scale: 2 }),
  outOfNetworkRate: decimal("out_of_network_rate", { precision: 8, scale: 2 }),
  deductibleApplies: boolean("deductible_applies").default(true),
  coinsurancePercent: decimal("coinsurance_percent", { precision: 5, scale: 2 }).default("20.00"),
  copayAmount: decimal("copay_amount", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type InsuranceRate = typeof insuranceRates.$inferSelect;
export type InsertInsuranceRate = typeof insuranceRates.$inferInsert;
export type Practice = typeof practices.$inferSelect;
export type InsertSoapNote = z.infer<typeof insertSoapNoteSchema>;
export type SoapNote = typeof soapNotes.$inferSelect;
export type CptCodeMapping = typeof cptCodeMappings.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type TreatmentSession = typeof treatmentSessions.$inferSelect;
export type Claim = typeof claims.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type CptCode = typeof cptCodes.$inferSelect;
export type Icd10Code = typeof icd10Codes.$inferSelect;
export type Insurance = typeof insurances.$inferSelect;

export type InsertPractice = z.infer<typeof insertPracticeSchema>;
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type InsertTreatmentSession = z.infer<typeof insertTreatmentSessionSchema>;
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type ClaimLineItem = typeof claimLineItems.$inferSelect;
export type InsertClaimLineItem = z.infer<typeof insertClaimLineItemSchema>;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

export const insertInviteSchema = createInsertSchema(invites).omit({
  id: true,
  createdAt: true,
});
export type Invite = typeof invites.$inferSelect;
export type InsertInvite = z.infer<typeof insertInviteSchema>;

export const insertEligibilityCheckSchema = createInsertSchema(eligibilityChecks).omit({
  id: true,
  createdAt: true,
});
export type EligibilityCheck = typeof eligibilityChecks.$inferSelect;
export type InsertEligibilityCheck = z.infer<typeof insertEligibilityCheckSchema>;

export const insertReimbursementOptimizationSchema = createInsertSchema(reimbursementOptimizations).omit({
  id: true,
  createdAt: true,
});
export type ReimbursementOptimization = typeof reimbursementOptimizations.$inferSelect;
export type InsertReimbursementOptimization = z.infer<typeof insertReimbursementOptimizationSchema>;

// ==================== HIPAA COMPLIANCE TABLES ====================

// Audit Log - tracks all PHI access and system events
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  eventCategory: varchar("event_category").notNull(), // auth, phi_access, admin, data_export, data_delete
  eventType: varchar("event_type").notNull(), // login, logout, view, create, update, delete, export
  resourceType: varchar("resource_type"), // patient, soap_note, claim, treatment_session, user
  resourceId: varchar("resource_id"), // ID of the accessed resource
  userId: varchar("user_id").references(() => users.id),
  practiceId: integer("practice_id").references(() => practices.id),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  details: jsonb("details"), // Additional context (non-PHI)
  success: boolean("success").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({
  id: true,
  createdAt: true,
});
export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// BAA Records - Business Associate Agreement tracking
export const baaRecords = pgTable("baa_records", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  vendorName: varchar("vendor_name").notNull(),
  vendorType: varchar("vendor_type"), // cloud_hosting, ehr, clearinghouse, billing_service, etc.
  signedDate: date("signed_date"),
  expirationDate: date("expiration_date"),
  status: varchar("status").default("active"), // active, expired, pending, terminated
  documentUrl: text("document_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBaaRecordSchema = createInsertSchema(baaRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type BaaRecord = typeof baaRecords.$inferSelect;
export type InsertBaaRecord = z.infer<typeof insertBaaRecordSchema>;

// Patient Insurance Authorization - consent for eligibility checks
export const patientInsuranceAuthorizations = pgTable("patient_insurance_authorizations", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  status: varchar("status").default("pending"), // pending, authorized, revoked, expired
  authorizationMethod: varchar("authorization_method"), // intake_form, email, sms, in_person
  authorizedAt: timestamp("authorized_at"),
  revokedAt: timestamp("revoked_at"),
  token: varchar("token").unique(), // for email/SMS based authorization
  tokenExpiresAt: timestamp("token_expires_at"),
  ipAddress: varchar("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPatientInsuranceAuthorizationSchema = createInsertSchema(patientInsuranceAuthorizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type PatientInsuranceAuthorization = typeof patientInsuranceAuthorizations.$inferSelect;
export type InsertPatientInsuranceAuthorization = z.infer<typeof insertPatientInsuranceAuthorizationSchema>;

// Insurance Data Cache - stores Stedi/payer verification results
export const insuranceDataCache = pgTable("insurance_data_cache", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  payerName: varchar("payer_name"),
  payerId: varchar("payer_id"),
  tradingPartnerServiceId: varchar("trading_partner_service_id"),
  eligibilityData: jsonb("eligibility_data"), // NormalizedEligibility
  benefitsData: jsonb("benefits_data"), // NormalizedBenefits
  rawRequest: jsonb("raw_request"),
  rawResponse: jsonb("raw_response"),
  verifiedAt: timestamp("verified_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  status: varchar("status").default("valid"), // valid, stale, error
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInsuranceDataCacheSchema = createInsertSchema(insuranceDataCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsuranceDataCache = typeof insuranceDataCache.$inferSelect;
export type InsertInsuranceDataCache = z.infer<typeof insertInsuranceDataCacheSchema>;

// Payer Integration Credentials
export const payerIntegrationCredentials = pgTable("payer_integration_credentials", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  payerName: varchar("payer_name").notNull(), // stedi, availity, etc.
  apiKey: jsonb("api_key"), // encrypted
  additionalConfig: jsonb("additional_config"), // encrypted
  isActive: boolean("is_active").default(true),
  lastHealthCheck: timestamp("last_health_check"),
  healthStatus: varchar("health_status").default("unknown"), // healthy, degraded, down, unknown
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type PayerIntegrationCredential = typeof payerIntegrationCredentials.$inferSelect;

// ==================== STEDI / INSURANCE VERIFICATION TYPES ====================

export interface NormalizedEligibility {
  status: 'active' | 'inactive' | 'unknown';
  subscriberName: string;
  memberId: string;
  groupNumber: string;
  payerName: string;
  planName: string;
  coverageType: string; // HMO, PPO, etc.
  effectiveDate: string;
  terminationDate: string | null;
  dependentStatus: string | null;
}

export interface NormalizedBenefits {
  copay: number | null;
  coinsurance: number | null; // percentage
  deductible: number | null;
  deductibleMet: number | null;
  outOfPocketMax: number | null;
  outOfPocketMet: number | null;
  visitsAllowed: number | null;
  visitsUsed: number | null;
  authRequired: boolean;
  priorAuthStatus: string | null;
  serviceTypes: string[];
  inNetwork: boolean;
}

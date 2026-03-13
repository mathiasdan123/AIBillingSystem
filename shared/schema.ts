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
  // Therapist-specific fields
  credentials: varchar("credentials"), // e.g., "OTR/L", "PT, DPT", "MS, CCC-SLP"
  licenseNumber: varchar("license_number"),
  npiNumber: varchar("npi_number"),
  digitalSignature: text("digital_signature"), // Base64 encoded signature image
  signatureUploadedAt: timestamp("signature_uploaded_at"),
  // Supervision fields (for supervised therapist co-signing workflow)
  supervisorId: varchar("supervisor_id"), // References users.id - supervisor who co-signs notes
  requiresCosign: boolean("requires_cosign").default(false), // Whether this therapist needs co-signatures
  // MFA fields
  mfaEnabled: boolean("mfa_enabled").default(false),
  mfaSecret: jsonb("mfa_secret"), // encrypted with PHI encryption
  mfaBackupCodes: jsonb("mfa_backup_codes"), // encrypted, array of hashed codes
  // Password authentication fields
  passwordHash: varchar("password_hash"),
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: varchar("email_verification_token"),
  emailVerificationExpires: timestamp("email_verification_expires"),
  failedLoginAttempts: integer("failed_login_attempts").default(0),
  lockoutUntil: timestamp("lockout_until"),
  lastLoginAt: timestamp("last_login_at"),
  passwordResetToken: varchar("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires"),
  // SSO fields
  ssoProvider: varchar("sso_provider"), // okta, azure-ad, google, custom
  ssoExternalId: varchar("sso_external_id"), // external identity from SSO provider
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
  // White-label branding fields
  brandLogoUrl: varchar("brand_logo_url"),
  brandPrimaryColor: varchar("brand_primary_color").default("#2563eb"), // Blue
  brandSecondaryColor: varchar("brand_secondary_color").default("#1e40af"),
  brandEmailFromName: varchar("brand_email_from_name"),
  brandEmailReplyTo: varchar("brand_email_reply_to"),
  brandWebsiteUrl: varchar("brand_website_url"),
  brandPrivacyPolicyUrl: varchar("brand_privacy_policy_url"),
  // Review collection settings
  googleReviewUrl: varchar("google_review_url"), // URL for Google Business Profile reviews
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
  // Stripe billing fields
  stripeCustomerId: varchar("stripe_customer_id"),
  stripePaymentMethodId: varchar("stripe_payment_method_id"),
  billingPlan: varchar("billing_plan").default("growing"), // solo, growing, enterprise
  billingPercentage: decimal("billing_percentage", { precision: 5, scale: 2 }).default("4.5"),
  trialEndsAt: timestamp("trial_ends_at"),
  // Stedi clearinghouse fields
  stediApiKey: varchar("stedi_api_key"),
  stediPartnerId: varchar("stedi_partner_id"),
  // Onboarding fields
  onboardingCompleted: boolean("onboarding_completed").default(false),
  onboardingStep: integer("onboarding_step").default(0),
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
  // Secondary insurance fields
  secondaryInsuranceProvider: varchar("secondary_insurance_provider"),
  secondaryInsurancePolicyNumber: varchar("secondary_insurance_policy_number"),
  secondaryInsuranceMemberId: varchar("secondary_insurance_member_id"),
  secondaryInsuranceGroupNumber: varchar("secondary_insurance_group_number"),
  secondaryInsuranceRelationship: varchar("secondary_insurance_relationship"), // self, spouse, child, other
  secondaryInsuranceSubscriberName: varchar("secondary_insurance_subscriber_name"),
  secondaryInsuranceSubscriberDob: date("secondary_insurance_subscriber_dob"),
  // Contact preferences
  phoneType: varchar("phone_type").default("mobile"), // mobile, landline, work
  preferredContactMethod: varchar("preferred_contact_method").default("email"), // email, sms, both
  smsConsentGiven: boolean("sms_consent_given").default(false),
  smsConsentDate: timestamp("sms_consent_date"),
  // Comprehensive intake form data (HIPAA, medical history, developmental, sensory, consents)
  intakeData: jsonb("intake_data"),
  intakeCompletedAt: timestamp("intake_completed_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_patients_practice_deleted").on(table.practiceId, table.deletedAt),
]);

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

// Insurance Billing Rules - stores payer-specific billing constraints
export const insuranceBillingRules = pgTable("insurance_billing_rules", {
  id: serial("id").primaryKey(),
  insuranceId: integer("insurance_id").references(() => insurances.id).notNull(),
  cptCodeId: integer("cpt_code_id").references(() => cptCodes.id),
  maxUnitsPerVisit: integer("max_units_per_visit"), // e.g., 1 unit per code per visit
  maxUnitsPerDay: integer("max_units_per_day"),
  maxUnitsPerWeek: integer("max_units_per_week"),
  requiresModifier: varchar("requires_modifier"), // e.g., "59", "GP"
  cannotBillWith: jsonb("cannot_bill_with"), // array of CPT code IDs that can't be billed together
  requiresPriorAuth: boolean("requires_prior_auth").default(false),
  requiresMedicalNecessity: boolean("requires_medical_necessity").default(true),
  requiresDifferentCodesPerUnit: boolean("requires_different_codes_per_unit").default(false), // some payers require different codes for each 15-min block
  notes: text("notes"), // additional billing guidance
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insurance general billing preferences
export const insuranceBillingPreferences = pgTable("insurance_billing_preferences", {
  id: serial("id").primaryKey(),
  insuranceId: integer("insurance_id").references(() => insurances.id).notNull().unique(),
  maxTotalUnitsPerVisit: integer("max_total_units_per_visit"), // e.g., 4 units total
  preferredCodeCombinations: jsonb("preferred_code_combinations"), // suggested code pairings
  avoidCodeCombinations: jsonb("avoid_code_combinations"), // codes to avoid billing together
  billingGuidelines: text("billing_guidelines"), // free-text guidelines for AI
  reimbursementTier: varchar("reimbursement_tier"), // high, medium, low
  averageReimbursementRate: decimal("average_reimbursement_rate", { precision: 5, scale: 2 }), // percentage of billed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
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

// CPT Code Equivalencies - tracks which codes can represent similar interventions
// This allows AI to choose optimal code when multiple codes could accurately describe the service
export const cptCodeEquivalencies = pgTable("cpt_code_equivalencies", {
  id: serial("id").primaryKey(),
  primaryCodeId: integer("primary_code_id").references(() => cptCodes.id).notNull(),
  equivalentCodeId: integer("equivalent_code_id").references(() => cptCodes.id).notNull(),
  interventionCategory: varchar("intervention_category").notNull(), // e.g., "strengthening", "fine_motor", "adl_training"
  clinicalContext: text("clinical_context"), // when it's appropriate to use either code
  notes: text("notes"),
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
}, (table) => [
  index("idx_treatment_sessions_practice_date").on(table.practiceId, table.sessionDate),
  index("idx_treatment_sessions_patient_id").on(table.patientId),
]);

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
  // Therapist signature
  therapistId: varchar("therapist_id").references(() => users.id),
  therapistSignature: text("therapist_signature"), // Base64 signature at time of signing
  therapistSignedAt: timestamp("therapist_signed_at"),
  therapistSignedName: varchar("therapist_signed_name"), // Legal name at signing
  therapistCredentials: varchar("therapist_credentials"), // Credentials at signing (OTR/L, etc.)
  signatureIpAddress: varchar("signature_ip_address"), // For audit trail
  // Co-signing fields (for supervised therapist workflow)
  cosignedBy: varchar("cosigned_by").references(() => users.id), // Supervisor who co-signed
  cosignedAt: timestamp("cosigned_at"), // When supervisor co-signed
  cosignStatus: varchar("cosign_status").default("not_required"), // not_required, pending, approved, rejected
  cosignRejectionReason: text("cosign_rejection_reason"), // Reason if rejected
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_soap_notes_session_created").on(table.sessionId, table.createdAt),
]);

// Co-sign status enum values (for reference)
export const COSIGN_STATUS = {
  NOT_REQUIRED: 'not_required',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;
export type CosignStatus = typeof COSIGN_STATUS[keyof typeof COSIGN_STATUS];

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
  // Clearinghouse tracking
  clearinghouseClaimId: varchar("clearinghouse_claim_id"), // Stedi claim ID
  clearinghouseStatus: varchar("clearinghouse_status"), // accepted, rejected, pending
  clearinghouseResponse: jsonb("clearinghouse_response"), // Raw response from clearinghouse
  clearinghouseSubmittedAt: timestamp("clearinghouse_submitted_at"),
  // Secondary insurance billing
  billingOrder: varchar("billing_order").default("primary"), // primary, secondary
  primaryClaimId: integer("primary_claim_id"), // links secondary claim to its primary claim
  primaryPaidAmount: decimal("primary_paid_amount", { precision: 10, scale: 2 }), // what primary insurance paid
  primaryAdjustmentAmount: decimal("primary_adjustment_amount", { precision: 10, scale: 2 }), // primary adjustments
  cobData: jsonb("cob_data"), // Coordination of Benefits data
  // AI denial prediction
  denialPrediction: jsonb("denial_prediction"), // { riskScore, riskLevel, issues, overallRecommendation }
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_claims_practice_status_created").on(table.practiceId, table.status, table.createdAt),
  index("idx_claims_patient_id").on(table.patientId),
]);

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
  createdBy: varchar("created_by"), // User ID who created the expense
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
  reminderSentAt: timestamp("reminder_sent_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: varchar("cancelled_by"), // patient, therapist, admin
  cancellationReason: varchar("cancellation_reason"), // patient_request, sick, schedule_conflict, weather, no_show, other
  cancellationNotes: text("cancellation_notes"),
  // Recurring appointment fields
  recurrenceRule: varchar("recurrence_rule"), // iCal RRULE format (e.g., "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO")
  recurrenceParentId: integer("recurrence_parent_id"), // Links to parent recurring appointment (self-reference)
  isRecurringInstance: boolean("is_recurring_instance").default(false), // True for instances generated from a recurring parent
  isRecurring: boolean("is_recurring").default(false), // True for any appointment that is part of a recurring series
  seriesId: varchar("series_id"), // Groups all appointments in a recurring series (nanoid)
  recurrenceEndDate: timestamp("recurrence_end_date"), // When the recurrence series ends
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_appointments_practice_start").on(table.practiceId, table.startTime),
]);

// Waitlist - for patients wanting earlier/different appointment times
export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  therapistId: varchar("therapist_id").references(() => users.id), // preferred therapist (optional)
  preferredDays: jsonb("preferred_days"), // ['monday', 'wednesday', 'friday']
  preferredTimeStart: varchar("preferred_time_start"), // '09:00'
  preferredTimeEnd: varchar("preferred_time_end"), // '17:00'
  appointmentType: text("appointment_type"), // type of appointment requested
  priority: integer("priority").default(0), // higher = more urgent
  status: varchar("status").default("waiting"), // waiting, offered, scheduled, cancelled
  reason: text("reason"), // why they need an earlier appointment
  notes: text("notes"),
  offeredAt: timestamp("offered_at"), // when they were offered a slot
  offeredSlot: jsonb("offered_slot"), // {date, startTime, endTime} - the slot offered
  respondBy: timestamp("respond_by"), // deadline to respond to offered slot
  notifiedAt: timestamp("notified_at"), // when they were notified of an opening
  notifiedSlot: jsonb("notified_slot"), // {date, time, therapist} - the slot they were notified about
  scheduledAppointmentId: integer("scheduled_appointment_id").references(() => appointments.id), // if scheduled
  expiresAt: timestamp("expires_at"), // optional expiration date for the waitlist request
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Review Requests - track requests sent to patients for Google reviews
export const reviewRequests = pgTable("review_requests", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  feedbackToken: varchar("feedback_token").unique(), // unique token for feedback link
  status: varchar("status").default("pending"), // pending, sent, clicked, feedback_received, google_requested, reviewed, declined
  sentVia: varchar("sent_via"), // email, sms, both
  emailSent: boolean("email_sent").default(false),
  smsSent: boolean("sms_sent").default(false),
  sentAt: timestamp("sent_at"),
  clickedAt: timestamp("clicked_at"), // when they clicked the review link
  feedbackReceivedAt: timestamp("feedback_received_at"), // when they submitted private feedback
  googleRequestSentAt: timestamp("google_request_sent_at"), // when we asked them to post to Google
  reviewedAt: timestamp("reviewed_at"), // when we detected they left a review
  declinedAt: timestamp("declined_at"),
  declineReason: varchar("decline_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Patient Feedback - private feedback before Google review
export const patientFeedback = pgTable("patient_feedback", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  reviewRequestId: integer("review_request_id").references(() => reviewRequests.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  rating: integer("rating").notNull(), // 1-5 stars
  feedbackText: text("feedback_text"),
  // Categorized feedback
  serviceRating: integer("service_rating"), // 1-5
  staffRating: integer("staff_rating"), // 1-5
  facilityRating: integer("facility_rating"), // 1-5
  wouldRecommend: boolean("would_recommend"),
  // Processing
  sentiment: varchar("sentiment"), // positive, neutral, negative (auto-calculated from rating)
  isAddressed: boolean("is_addressed").default(false), // for negative feedback
  addressedAt: timestamp("addressed_at"),
  addressedBy: varchar("addressed_by").references(() => users.id),
  addressNotes: text("address_notes"),
  // Google posting
  googlePostRequested: boolean("google_post_requested").default(false),
  googlePostRequestedAt: timestamp("google_post_requested_at"),
  postedToGoogle: boolean("posted_to_google").default(false),
  postedToGoogleAt: timestamp("posted_to_google_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Google Reviews - store reviews for response management
export const googleReviews = pgTable("google_reviews", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  googleReviewId: varchar("google_review_id"), // ID from Google if available
  reviewerName: varchar("reviewer_name"),
  rating: integer("rating"), // 1-5 stars
  reviewText: text("review_text"),
  reviewDate: timestamp("review_date"),
  responseStatus: varchar("response_status").default("pending"), // pending, draft, published, skipped
  aiDraftResponse: text("ai_draft_response"),
  finalResponse: text("final_response"),
  respondedAt: timestamp("responded_at"),
  respondedBy: varchar("responded_by").references(() => users.id),
  sentiment: varchar("sentiment"), // positive, neutral, negative
  tags: jsonb("tags"), // ['service', 'staff', 'wait_time', etc.]
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Appointment Types - configurable session types for online booking
export const appointmentTypes = pgTable("appointment_types", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  name: varchar("name").notNull(), // "Initial Consultation", "Follow-up Session"
  description: text("description"),
  duration: integer("duration").notNull(), // in minutes
  price: decimal("price", { precision: 10, scale: 2 }),
  color: varchar("color"), // for calendar display
  isActive: boolean("is_active").default(true),
  allowOnlineBooking: boolean("allow_online_booking").default(true),
  requiresApproval: boolean("requires_approval").default(false), // admin approval needed
  bufferBefore: integer("buffer_before").default(0), // minutes before appointment
  bufferAfter: integer("buffer_after").default(0), // minutes after appointment
  maxAdvanceBooking: integer("max_advance_booking").default(60), // days in advance
  minAdvanceBooking: integer("min_advance_booking").default(1), // minimum hours before
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Therapist Availability - weekly schedule for each therapist
export const therapistAvailability = pgTable("therapist_availability", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  therapistId: varchar("therapist_id").references(() => users.id).notNull(),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sunday, 1=Monday, etc.
  startTime: varchar("start_time").notNull(), // "09:00"
  endTime: varchar("end_time").notNull(), // "17:00"
  isAvailable: boolean("is_available").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Therapist Time Off - specific dates when therapist is unavailable
export const therapistTimeOff = pgTable("therapist_time_off", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  therapistId: varchar("therapist_id").references(() => users.id).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: varchar("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Booking Settings - practice-level configuration
export const bookingSettings = pgTable("booking_settings", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull().unique(),
  isOnlineBookingEnabled: boolean("is_online_booking_enabled").default(true),
  bookingPageSlug: varchar("booking_page_slug").unique(), // for URL: /book/slug
  welcomeMessage: text("welcome_message"),
  confirmationMessage: text("confirmation_message"),
  requirePhoneNumber: boolean("require_phone_number").default(true),
  requireInsuranceInfo: boolean("require_insurance_info").default(false),
  allowNewPatients: boolean("allow_new_patients").default(true),
  newPatientMessage: text("new_patient_message"),
  cancellationPolicy: text("cancellation_policy"),
  defaultTimezone: varchar("default_timezone").default("America/New_York"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Online Bookings - track bookings made through online portal
export const onlineBookings = pgTable("online_bookings", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  appointmentTypeId: integer("appointment_type_id").references(() => appointmentTypes.id),
  therapistId: varchar("therapist_id").references(() => users.id),
  patientId: integer("patient_id").references(() => patients.id),
  // For new patients who don't have a patient record yet
  guestFirstName: varchar("guest_first_name"),
  guestLastName: varchar("guest_last_name"),
  guestEmail: varchar("guest_email"),
  guestPhone: varchar("guest_phone"),
  requestedDate: date("requested_date").notNull(),
  requestedTime: varchar("requested_time").notNull(),
  status: varchar("status").default("pending"), // pending, confirmed, cancelled, completed
  isNewPatient: boolean("is_new_patient").default(false),
  notes: text("notes"),
  confirmationCode: varchar("confirmation_code").unique(),
  confirmedAt: timestamp("confirmed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancellationReason: text("cancellation_reason"),
  reminderSent: boolean("reminder_sent").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Telehealth Sessions - video call sessions for appointments
export const telehealthSessions = pgTable("telehealth_sessions", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  appointmentId: integer("appointment_id").references(() => appointments.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id),
  therapistId: varchar("therapist_id").references(() => users.id),
  roomName: varchar("room_name").unique().notNull(), // unique room identifier
  roomUrl: varchar("room_url"), // full URL to join
  hostUrl: varchar("host_url"), // URL for therapist (may have extra controls)
  patientAccessCode: varchar("patient_access_code"), // simple code for patient to join
  status: varchar("status").default("scheduled"), // scheduled, waiting, in_progress, completed, cancelled, no_show
  scheduledStart: timestamp("scheduled_start").notNull(),
  scheduledEnd: timestamp("scheduled_end").notNull(),
  actualStart: timestamp("actual_start"),
  actualEnd: timestamp("actual_end"),
  patientJoinedAt: timestamp("patient_joined_at"),
  therapistJoinedAt: timestamp("therapist_joined_at"),
  duration: integer("duration"), // actual duration in minutes
  recordingEnabled: boolean("recording_enabled").default(false),
  recordingUrl: varchar("recording_url"),
  recordingConsent: boolean("recording_consent").default(false),
  waitingRoomEnabled: boolean("waiting_room_enabled").default(true),
  notes: text("notes"),
  technicalIssues: text("technical_issues"), // log any issues
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Telehealth Settings - practice-level configuration
export const telehealthSettings = pgTable("telehealth_settings", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull().unique(),
  isEnabled: boolean("is_enabled").default(true),
  provider: varchar("provider").default("built_in"), // built_in, daily, zoom, twilio
  providerApiKey: varchar("provider_api_key"),
  providerApiSecret: varchar("provider_api_secret"),
  defaultWaitingRoomEnabled: boolean("default_waiting_room_enabled").default(true),
  defaultRecordingEnabled: boolean("default_recording_enabled").default(false),
  requireRecordingConsent: boolean("require_recording_consent").default(true),
  autoCreateRooms: boolean("auto_create_rooms").default(true), // auto-create room when appointment scheduled
  sendJoinReminder: boolean("send_join_reminder").default(true), // send reminder before session
  joinReminderMinutes: integer("join_reminder_minutes").default(15),
  maxSessionDuration: integer("max_session_duration").default(120), // minutes
  welcomeMessage: text("welcome_message"),
  waitingRoomMessage: text("waiting_room_message"),
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

// Patient Consents - HIPAA-compliant consent tracking
export const patientConsents = pgTable("patient_consents", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),

  // Consent type and scope
  consentType: varchar("consent_type").notNull(), // 'insurance_verification', 'treatment', 'billing', 'hipaa_release', 'assignment_of_benefits'

  // HIPAA-required fields
  purposeOfDisclosure: text("purpose_of_disclosure").notNull(), // Why info is being shared
  informationToBeDisclosed: text("information_to_be_disclosed").notNull(), // What info will be shared
  recipientOfInformation: text("recipient_of_information").notNull(), // Who receives the info

  // Consent validity
  effectiveDate: date("effective_date").notNull(),
  expirationDate: date("expiration_date"), // null = until revoked

  // Signature information
  signatureType: varchar("signature_type").default("electronic"), // electronic, wet_ink, verbal
  signatureName: varchar("signature_name").notNull(), // Full legal name
  signatureDate: timestamp("signature_date").notNull(),
  signatureIpAddress: varchar("signature_ip_address"), // For audit trail

  // For minors/guardians
  signerRelationship: varchar("signer_relationship"), // 'self', 'parent', 'guardian', 'legal_representative'
  signerName: varchar("signer_name"), // If different from patient

  // Revocation tracking
  isRevoked: boolean("is_revoked").default(false),
  revokedDate: timestamp("revoked_date"),
  revokedBy: varchar("revoked_by"),
  revocationReason: text("revocation_reason"),

  // Audit fields
  consentVersion: varchar("consent_version").default("1.0"), // Track form version changes
  witnessName: varchar("witness_name"),
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPatientConsentSchema = createInsertSchema(patientConsents);
export type InsertPatientConsent = z.infer<typeof insertPatientConsentSchema>;
export type PatientConsent = typeof patientConsents.$inferSelect;

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
export const usersRelations = relations(users, ({ one, many }) => ({
  practice: one(practices, {
    fields: [users.practiceId],
    references: [practices.id],
  }),
  // Supervision relationship - who supervises this user
  supervisor: one(users, {
    fields: [users.supervisorId],
    references: [users.id],
    relationName: 'supervisor',
  }),
  // Inverse - users this person supervises
  supervisees: many(users, {
    relationName: 'supervisor',
  }),
}));

export const practicesRelations = relations(practices, ({ many }) => ({
  users: many(users),
  patients: many(patients),
  treatmentSessions: many(treatmentSessions),
  claims: many(claims),
  expenses: many(expenses),
  payments: many(payments),
  locations: many(practiceLocations),
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

export const soapNotesRelations = relations(soapNotes, ({ one }) => ({
  session: one(treatmentSessions, {
    fields: [soapNotes.sessionId],
    references: [treatmentSessions.id],
  }),
  therapist: one(users, {
    fields: [soapNotes.therapistId],
    references: [users.id],
    relationName: 'therapist',
  }),
  cosigner: one(users, {
    fields: [soapNotes.cosignedBy],
    references: [users.id],
    relationName: 'cosigner',
  }),
}));

// AI Learning Data - tracks claim outcomes for continuous AI improvement
export const aiLearningData = pgTable("ai_learning_data", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  claimId: integer("claim_id").references(() => claims.id),
  cptCode: varchar("cpt_code"),
  icd10Code: varchar("icd10_code"),
  payerName: varchar("payer_name"),
  submittedAmount: decimal("submitted_amount", { precision: 10, scale: 2 }),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }),
  outcome: varchar("outcome").notNull(), // paid, denied, partial
  denialReason: text("denial_reason"),
  modifier: varchar("modifier"),
  aiScoreAtSubmission: integer("ai_score_at_submission"),
  aiRecommendationsFollowed: jsonb("ai_recommendations_followed"),
  processingDays: integer("processing_days"), // days from submission to resolution
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ai_learning_data_practice").on(table.practiceId),
  index("idx_ai_learning_data_payer_cpt").on(table.payerName, table.cptCode),
  index("idx_ai_learning_data_outcome").on(table.outcome),
]);

// AI Model Insights - generated patterns and recommendations from learning data
export const aiModelInsights = pgTable("ai_model_insights", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  insightType: varchar("insight_type").notNull(), // denial_pattern, underpayment_pattern, optimization_tip, payer_trend
  payerName: varchar("payer_name"),
  cptCode: varchar("cpt_code"),
  title: varchar("title").notNull(),
  description: text("description").notNull(),
  confidence: decimal("confidence", { precision: 3, scale: 2 }).notNull(), // 0.00 - 1.00
  dataPoints: integer("data_points").notNull(), // how many claims support this insight
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_ai_model_insights_practice_active").on(table.practiceId, table.isActive),
  index("idx_ai_model_insights_type").on(table.insightType),
]);

// Insert schemas for AI Learning
export const insertAiLearningDataSchema = createInsertSchema(aiLearningData).omit({
  id: true,
  createdAt: true,
});

export const insertAiModelInsightSchema = createInsertSchema(aiModelInsights).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types for AI Learning
export type AiLearningData = typeof aiLearningData.$inferSelect;
export type InsertAiLearningData = z.infer<typeof insertAiLearningDataSchema>;
export type AiModelInsight = typeof aiModelInsights.$inferSelect;
export type InsertAiModelInsight = z.infer<typeof insertAiModelInsightSchema>;

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

// Patient Insurance Authorization Requests (Consent tracking)
export const patientInsuranceAuthorizations = pgTable("patient_insurance_authorizations", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  requestedById: varchar("requested_by_id").references(() => users.id).notNull(),
  // Token for secure link
  token: varchar("token", { length: 64 }).unique().notNull(),
  tokenExpiresAt: timestamp("token_expires_at").notNull(),
  tokenUsedAt: timestamp("token_used_at"),
  // Authorization status
  status: varchar("status").default("pending").notNull(), // pending, authorized, denied, expired, revoked
  // Scopes (what data types the patient authorized)
  scopes: jsonb("scopes").default(['eligibility']).notNull(), // ['eligibility', 'benefits', 'claims_history', 'prior_auth']
  // Delivery method
  deliveryMethod: varchar("delivery_method").default("email").notNull(), // email, sms, both
  deliveryEmail: varchar("delivery_email"),
  deliveryPhone: varchar("delivery_phone"),
  // Consent capture
  consentGivenAt: timestamp("consent_given_at"),
  consentIpAddress: varchar("consent_ip_address"),
  consentUserAgent: text("consent_user_agent"),
  consentSignature: text("consent_signature"), // Digital signature or checkbox acknowledgment
  // Rate limiting
  resendCount: integer("resend_count").default(0),
  lastResendAt: timestamp("last_resend_at"),
  linkAttemptCount: integer("link_attempt_count").default(0),
  // Timestamps
  expiresAt: timestamp("expires_at"), // Overall authorization expiry (e.g., 1 year)
  revokedAt: timestamp("revoked_at"),
  revokedReason: text("revoked_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Payer Integrations (API configurations for each payer)
export const payerIntegrations = pgTable("payer_integrations", {
  id: serial("id").primaryKey(),
  payerName: varchar("payer_name").notNull(),
  payerCode: varchar("payer_code").unique().notNull(), // e.g., MEDICARE, UHC, AETNA
  // API Type
  apiType: varchar("api_type").notNull(), // edi_270, fhir_r4, proprietary
  apiVersion: varchar("api_version"),
  // Endpoints
  baseUrl: varchar("base_url").notNull(),
  authEndpoint: varchar("auth_endpoint"),
  eligibilityEndpoint: varchar("eligibility_endpoint"),
  benefitsEndpoint: varchar("benefits_endpoint"),
  claimsHistoryEndpoint: varchar("claims_history_endpoint"),
  priorAuthEndpoint: varchar("prior_auth_endpoint"),
  // Auth method
  authMethod: varchar("auth_method").notNull(), // oauth2, api_key, basic, x509
  authConfig: jsonb("auth_config"), // Additional auth config (scopes, token endpoint, etc.)
  // Capabilities
  supportsEligibility: boolean("supports_eligibility").default(true),
  supportsBenefits: boolean("supports_benefits").default(false),
  supportsClaimsHistory: boolean("supports_claims_history").default(false),
  supportsPriorAuth: boolean("supports_prior_auth").default(false),
  supportsRealtime: boolean("supports_realtime").default(false),
  // Rate limits
  rateLimitPerMinute: integer("rate_limit_per_minute").default(60),
  rateLimitPerDay: integer("rate_limit_per_day").default(1000),
  // Status
  isActive: boolean("is_active").default(true),
  lastHealthCheck: timestamp("last_health_check"),
  healthStatus: varchar("health_status").default("unknown"), // healthy, degraded, down, unknown
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Payer Credentials (Practice-specific encrypted credentials)
export const payerCredentials = pgTable("payer_credentials", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  payerIntegrationId: integer("payer_integration_id").references(() => payerIntegrations.id).notNull(),
  // Encrypted credentials (AES-256-GCM)
  encryptedCredentials: text("encrypted_credentials").notNull(),
  credentialsIv: varchar("credentials_iv", { length: 32 }).notNull(), // Initialization vector
  credentialsTag: varchar("credentials_tag", { length: 32 }).notNull(), // Auth tag
  // Credential metadata (not encrypted)
  credentialType: varchar("credential_type").notNull(), // oauth_client, api_key, username_password, certificate
  lastRotated: timestamp("last_rotated"),
  expiresAt: timestamp("expires_at"),
  // Status
  isActive: boolean("is_active").default(true),
  lastUsed: timestamp("last_used"),
  lastError: text("last_error"),
  errorCount: integer("error_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insurance Data Cache (Retrieved insurance data)
export const insuranceDataCache = pgTable("insurance_data_cache", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  authorizationId: integer("authorization_id").references(() => patientInsuranceAuthorizations.id).notNull(),
  payerIntegrationId: integer("payer_integration_id").references(() => payerIntegrations.id),
  // Data type
  dataType: varchar("data_type").notNull(), // eligibility, benefits, claims_history, prior_auth
  // Raw and normalized data
  rawResponse: jsonb("raw_response"),
  normalizedData: jsonb("normalized_data"),
  // Status
  status: varchar("status").default("pending").notNull(), // pending, success, error, expired
  errorMessage: text("error_message"),
  errorCode: varchar("error_code"),
  // Cache management
  fetchedAt: timestamp("fetched_at"),
  expiresAt: timestamp("expires_at"),
  isStale: boolean("is_stale").default(false),
  refreshAttempts: integer("refresh_attempts").default(0),
  lastRefreshAttempt: timestamp("last_refresh_attempt"),
  // Request tracking
  requestId: varchar("request_id"), // External request ID for debugging
  responseTimeMs: integer("response_time_ms"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Authorization Audit Log (HIPAA-compliant audit trail)
export const authorizationAuditLog = pgTable("authorization_audit_log", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id),
  authorizationId: integer("authorization_id").references(() => patientInsuranceAuthorizations.id),
  // Actor information
  actorType: varchar("actor_type").notNull(), // user, patient, system
  actorId: varchar("actor_id"), // User ID or patient identifier
  actorEmail: varchar("actor_email"),
  actorIpAddress: varchar("actor_ip_address"),
  actorUserAgent: text("actor_user_agent"),
  // Event details
  eventType: varchar("event_type").notNull(), // authorization_requested, authorization_sent, link_clicked, consent_given, consent_denied, data_accessed, data_refreshed, authorization_revoked, authorization_expired
  eventDetails: jsonb("event_details"), // Additional context
  // Data access specifics (when eventType is data_accessed)
  dataType: varchar("data_type"), // eligibility, benefits, claims_history, prior_auth
  dataScope: jsonb("data_scope"), // What specific data was accessed
  // Result
  success: boolean("success").default(true),
  errorMessage: text("error_message"),
  // Timestamp (immutable audit trail)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_practice_patient").on(table.practiceId, table.patientId),
  index("idx_audit_authorization").on(table.authorizationId),
  index("idx_audit_event_type").on(table.eventType),
  index("idx_audit_created_at").on(table.createdAt),
]);

// Insurance authorization relations
export const patientInsuranceAuthorizationsRelations = relations(patientInsuranceAuthorizations, ({ one, many }) => ({
  practice: one(practices, {
    fields: [patientInsuranceAuthorizations.practiceId],
    references: [practices.id],
  }),
  patient: one(patients, {
    fields: [patientInsuranceAuthorizations.patientId],
    references: [patients.id],
  }),
  requestedBy: one(users, {
    fields: [patientInsuranceAuthorizations.requestedById],
    references: [users.id],
  }),
  cachedData: many(insuranceDataCache),
  auditLogs: many(authorizationAuditLog),
}));

export const payerIntegrationsRelations = relations(payerIntegrations, ({ many }) => ({
  credentials: many(payerCredentials),
  cachedData: many(insuranceDataCache),
}));

export const payerCredentialsRelations = relations(payerCredentials, ({ one }) => ({
  practice: one(practices, {
    fields: [payerCredentials.practiceId],
    references: [practices.id],
  }),
  payerIntegration: one(payerIntegrations, {
    fields: [payerCredentials.payerIntegrationId],
    references: [payerIntegrations.id],
  }),
}));

export const insuranceDataCacheRelations = relations(insuranceDataCache, ({ one }) => ({
  practice: one(practices, {
    fields: [insuranceDataCache.practiceId],
    references: [practices.id],
  }),
  patient: one(patients, {
    fields: [insuranceDataCache.patientId],
    references: [patients.id],
  }),
  authorization: one(patientInsuranceAuthorizations, {
    fields: [insuranceDataCache.authorizationId],
    references: [patientInsuranceAuthorizations.id],
  }),
  payerIntegration: one(payerIntegrations, {
    fields: [insuranceDataCache.payerIntegrationId],
    references: [payerIntegrations.id],
  }),
}));

export const authorizationAuditLogRelations = relations(authorizationAuditLog, ({ one }) => ({
  practice: one(practices, {
    fields: [authorizationAuditLog.practiceId],
    references: [practices.id],
  }),
  patient: one(patients, {
    fields: [authorizationAuditLog.patientId],
    references: [patients.id],
  }),
  authorization: one(patientInsuranceAuthorizations, {
    fields: [authorizationAuditLog.authorizationId],
    references: [patientInsuranceAuthorizations.id],
  }),
}));

// Appeals tracking table
export const appeals = pgTable("appeals", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").references(() => claims.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  appealLevel: varchar("appeal_level").default("initial").notNull(), // initial, first_appeal, second_appeal, external_review
  status: varchar("status").default("draft").notNull(), // draft, ready, submitted, in_review, won, lost, partial
  denialCategory: varchar("denial_category"), // medical_necessity, authorization, coding, timely_filing, etc.
  deadlineDate: date("deadline_date"), // Filing deadline (usually 60-180 days from denial)
  submittedDate: timestamp("submitted_date"),
  resolvedDate: timestamp("resolved_date"),
  appealedAmount: decimal("appealed_amount", { precision: 10, scale: 2 }),
  recoveredAmount: decimal("recovered_amount", { precision: 10, scale: 2 }),
  appealLetter: text("appeal_letter"),
  supportingDocs: jsonb("supporting_docs"), // [{name, url, type}]
  insurerResponse: text("insurer_response"),
  notes: text("notes"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const appealsRelations = relations(appeals, ({ one }) => ({
  claim: one(claims, {
    fields: [appeals.claimId],
    references: [claims.id],
  }),
  practice: one(practices, {
    fields: [appeals.practiceId],
    references: [practices.id],
  }),
  assignedUser: one(users, {
    fields: [appeals.assignedTo],
    references: [users.id],
  }),
}));

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
  reimbursementRank: integer("reimbursement_rank"), // 1 = highest reimbursement for this payer, useful for code selection
  effectiveDate: date("effective_date"), // when this rate became effective
  terminationDate: date("termination_date"), // when this rate expires
  sourceDocument: varchar("source_document"), // reference to parsed contract/fee schedule
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type InsuranceRate = typeof insuranceRates.$inferSelect;
export type InsertInsuranceRate = typeof insuranceRates.$inferInsert;
export type CptCodeEquivalency = typeof cptCodeEquivalencies.$inferSelect;
export type InsertCptCodeEquivalency = typeof cptCodeEquivalencies.$inferInsert;
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

export const insertAppointmentSchema = createInsertSchema(appointments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;

// Waitlist insert schema
export const insertWaitlistSchema = createInsertSchema(waitlist).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type WaitlistEntry = typeof waitlist.$inferSelect;
export type InsertWaitlistEntry = z.infer<typeof insertWaitlistSchema>;

// Review Request insert schema
export const insertReviewRequestSchema = createInsertSchema(reviewRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ReviewRequest = typeof reviewRequests.$inferSelect;
export type InsertReviewRequest = z.infer<typeof insertReviewRequestSchema>;

// Google Review insert schema
export const insertGoogleReviewSchema = createInsertSchema(googleReviews).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type GoogleReview = typeof googleReviews.$inferSelect;
export type InsertGoogleReview = z.infer<typeof insertGoogleReviewSchema>;

// Patient Feedback insert schema
export const insertPatientFeedbackSchema = createInsertSchema(patientFeedback).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type PatientFeedback = typeof patientFeedback.$inferSelect;
export type InsertPatientFeedback = z.infer<typeof insertPatientFeedbackSchema>;

// Appointment Type insert schema
export const insertAppointmentTypeSchema = createInsertSchema(appointmentTypes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type AppointmentType = typeof appointmentTypes.$inferSelect;
export type InsertAppointmentType = z.infer<typeof insertAppointmentTypeSchema>;

// Therapist Availability insert schema
export const insertTherapistAvailabilitySchema = createInsertSchema(therapistAvailability).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type TherapistAvailability = typeof therapistAvailability.$inferSelect;
export type InsertTherapistAvailability = z.infer<typeof insertTherapistAvailabilitySchema>;

// Therapist Time Off insert schema
export const insertTherapistTimeOffSchema = createInsertSchema(therapistTimeOff).omit({
  id: true,
  createdAt: true,
});
export type TherapistTimeOff = typeof therapistTimeOff.$inferSelect;
export type InsertTherapistTimeOff = z.infer<typeof insertTherapistTimeOffSchema>;

// Booking Settings insert schema
export const insertBookingSettingsSchema = createInsertSchema(bookingSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type BookingSettings = typeof bookingSettings.$inferSelect;
export type InsertBookingSettings = z.infer<typeof insertBookingSettingsSchema>;

// Online Booking insert schema
export const insertOnlineBookingSchema = createInsertSchema(onlineBookings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type OnlineBooking = typeof onlineBookings.$inferSelect;
export type InsertOnlineBooking = z.infer<typeof insertOnlineBookingSchema>;

// Telehealth Session insert schema
export const insertTelehealthSessionSchema = createInsertSchema(telehealthSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type TelehealthSession = typeof telehealthSessions.$inferSelect;
export type InsertTelehealthSession = z.infer<typeof insertTelehealthSessionSchema>;

// Telehealth Settings insert schema
export const insertTelehealthSettingsSchema = createInsertSchema(telehealthSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type TelehealthSettings = typeof telehealthSettings.$inferSelect;
export type InsertTelehealthSettings = z.infer<typeof insertTelehealthSettingsSchema>;

// Insurance Authorization insert schemas
export const insertPatientInsuranceAuthorizationSchema = createInsertSchema(patientInsuranceAuthorizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPayerIntegrationSchema = createInsertSchema(payerIntegrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPayerCredentialSchema = createInsertSchema(payerCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInsuranceDataCacheSchema = createInsertSchema(insuranceDataCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAuthorizationAuditLogSchema = createInsertSchema(authorizationAuditLog).omit({
  id: true,
  createdAt: true,
});

// Insurance Authorization types
export type PatientInsuranceAuthorization = typeof patientInsuranceAuthorizations.$inferSelect;
export type InsertPatientInsuranceAuthorization = z.infer<typeof insertPatientInsuranceAuthorizationSchema>;

export type PayerIntegration = typeof payerIntegrations.$inferSelect;
export type InsertPayerIntegration = z.infer<typeof insertPayerIntegrationSchema>;

export type PayerCredential = typeof payerCredentials.$inferSelect;
export type InsertPayerCredential = z.infer<typeof insertPayerCredentialSchema>;

export type InsuranceDataCache = typeof insuranceDataCache.$inferSelect;
export type InsertInsuranceDataCache = z.infer<typeof insertInsuranceDataCacheSchema>;

export type AuthorizationAuditLog = typeof authorizationAuditLog.$inferSelect;
export type InsertAuthorizationAuditLog = z.infer<typeof insertAuthorizationAuditLogSchema>;

// Normalized insurance data types for frontend consumption
export type NormalizedEligibility = {
  isEligible: boolean;
  effectiveDate: string;
  terminationDate?: string;
  planName: string;
  planType: string;
  memberId: string;
  groupNumber?: string;
  coverageLevel: string; // individual, family
  networkStatus: string; // in_network, out_of_network
};

export type NormalizedBenefits = {
  deductible: {
    individual: number;
    family: number;
    individualMet: number;
    familyMet: number;
  };
  outOfPocketMax: {
    individual: number;
    family: number;
    individualMet: number;
    familyMet: number;
  };
  copay: number;
  coinsurance: number;
  visitsAllowed?: number;
  visitsUsed?: number;
  priorAuthRequired: boolean;
  referralRequired: boolean;
  serviceLimitations?: string[];
};

export type NormalizedClaimsHistory = {
  claims: Array<{
    claimNumber: string;
    dateOfService: string;
    provider: string;
    serviceType: string;
    billedAmount: number;
    allowedAmount: number;
    paidAmount: number;
    patientResponsibility: number;
    status: string;
  }>;
  totalClaims: number;
  totalPaid: number;
};

export type NormalizedPriorAuth = {
  required: boolean;
  authNumber?: string;
  status?: string;
  validFrom?: string;
  validTo?: string;
  approvedUnits?: number;
  usedUnits?: number;
  remainingUnits?: number;
};

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

export const insertAppealSchema = createInsertSchema(appeals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Appeal = typeof appeals.$inferSelect;
export type InsertAppeal = z.infer<typeof insertAppealSchema>;

// HIPAA Audit Log
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  eventCategory: varchar("event_category").notNull(), // auth, phi_access, admin, data_export, breach
  eventType: varchar("event_type").notNull(), // read, write, delete, login, logout
  resourceType: varchar("resource_type"), // patient, claim, soap_note, etc.
  resourceId: varchar("resource_id"),
  userId: varchar("user_id"),
  practiceId: integer("practice_id"),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  details: jsonb("details"),
  success: boolean("success").default(true),
  integrityHash: varchar("integrity_hash"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_audit_log_user_practice_category").on(table.userId, table.practiceId, table.eventCategory),
]);

// Breach Incidents (45 CFR §§ 164.400-414)
export const breachIncidents = pgTable("breach_incidents", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  discoveredAt: timestamp("discovered_at").notNull(),
  description: text("description").notNull(),
  affectedIndividualsCount: integer("affected_individuals_count").default(0),
  breachType: varchar("breach_type").notNull(), // unauthorized_access, theft, loss, improper_disposal, hacking, other
  phiInvolved: text("phi_involved"),
  riskAssessment: varchar("risk_assessment").default("low"), // low, medium, high
  notificationStatus: varchar("notification_status").default("pending"), // pending, individuals_notified, hhs_notified, complete
  notifiedIndividualsAt: timestamp("notified_individuals_at"),
  notifiedHhsAt: timestamp("notified_hhs_at"),
  notifiedMediaAt: timestamp("notified_media_at"),
  remediationSteps: text("remediation_steps"),
  status: varchar("status").default("open"), // open, under_review, closed
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Amendment Requests (Right to Amendment)
export const amendmentRequests = pgTable("amendment_requests", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  requestedBy: varchar("requested_by").references(() => users.id),
  requestDate: timestamp("request_date").defaultNow().notNull(),
  fieldToAmend: varchar("field_to_amend").notNull(),
  currentValue: text("current_value"),
  requestedValue: text("requested_value").notNull(),
  reason: text("reason"),
  status: varchar("status").default("pending"), // pending, approved, denied, extended
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewDate: timestamp("review_date"),
  denialReason: text("denial_reason"),
  responseDeadline: timestamp("response_deadline").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true, createdAt: true });
export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// BAA Records
export const baaRecords = pgTable("baa_records", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  vendorName: varchar("vendor_name").notNull(),
  vendorType: varchar("vendor_type").notNull(), // cloud_provider, clearinghouse, ehr, billing_service, other
  signedDate: varchar("signed_date").notNull(),
  expirationDate: varchar("expiration_date").notNull(),
  status: varchar("status").default("active"), // active, expired, terminated
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBaaRecordSchema = createInsertSchema(baaRecords).omit({ id: true, createdAt: true, updatedAt: true });
export type BaaRecord = typeof baaRecords.$inferSelect;
export type InsertBaaRecord = z.infer<typeof insertBaaRecordSchema>;

// Breach Incident insert schema + types
export const insertBreachIncidentSchema = createInsertSchema(breachIncidents).omit({ id: true, createdAt: true, updatedAt: true });
export type BreachIncident = typeof breachIncidents.$inferSelect;
export type InsertBreachIncident = z.infer<typeof insertBreachIncidentSchema>;

// Amendment Request insert schema + types
export const insertAmendmentRequestSchema = createInsertSchema(amendmentRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type AmendmentRequest = typeof amendmentRequests.$inferSelect;
export type InsertAmendmentRequest = z.infer<typeof insertAmendmentRequestSchema>;

// ==================== SECURE MESSAGING ====================

// Conversations (message threads between therapist and patient)
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  therapistId: varchar("therapist_id").references(() => users.id),
  subject: varchar("subject", { length: 255 }),
  status: varchar("status").default("active"), // active, archived, closed
  // For patient portal access
  patientAccessToken: varchar("patient_access_token", { length: 64 }).unique(),
  patientTokenExpiresAt: timestamp("patient_token_expires_at"),
  // Tracking
  lastMessageAt: timestamp("last_message_at"),
  unreadByTherapist: integer("unread_by_therapist").default(0),
  unreadByPatient: integer("unread_by_patient").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Messages
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id).notNull(),
  senderId: varchar("sender_id"), // user ID for therapist, null for patient
  senderType: varchar("sender_type").notNull(), // 'therapist' | 'patient'
  senderName: varchar("sender_name"), // display name
  content: text("content").notNull(),
  // Attachments stored as JSON array [{name, url, type, size}]
  attachments: jsonb("attachments").default([]),
  // Read tracking
  readAt: timestamp("read_at"),
  readByRecipient: boolean("read_by_recipient").default(false),
  // Delivery tracking
  deliveredAt: timestamp("delivered_at"),
  // For HIPAA compliance - track if message contains PHI
  containsPhi: boolean("contains_phi").default(true),
  // Soft delete
  deletedAt: timestamp("deleted_at"),
  deletedBy: varchar("deleted_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Message notifications (for email/SMS alerts)
export const messageNotifications = pgTable("message_notifications", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").references(() => messages.id).notNull(),
  recipientType: varchar("recipient_type").notNull(), // 'therapist' | 'patient'
  recipientId: varchar("recipient_id"), // user ID or patient ID as string
  notificationType: varchar("notification_type").notNull(), // 'email' | 'sms' | 'push'
  status: varchar("status").default("pending"), // pending, sent, failed, delivered
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, updatedAt: true });
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export const insertMessageNotificationSchema = createInsertSchema(messageNotifications).omit({ id: true, createdAt: true });
export type MessageNotification = typeof messageNotifications.$inferSelect;
export type InsertMessageNotification = z.infer<typeof insertMessageNotificationSchema>;

// ==================== PATIENT PORTAL ====================

// Patient Portal Access (magic link authentication)
export const patientPortalAccess = pgTable("patient_portal_access", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  // Portal access token (long-lived, 90 days)
  portalToken: varchar("portal_token", { length: 64 }).unique().notNull(),
  portalTokenExpiresAt: timestamp("portal_token_expires_at").notNull(),
  // Magic link token (short-lived, 15 minutes)
  magicLinkToken: varchar("magic_link_token", { length: 64 }).unique(),
  magicLinkExpiresAt: timestamp("magic_link_expires_at"),
  magicLinkUsedAt: timestamp("magic_link_used_at"),
  // Access settings
  isActive: boolean("is_active").default(true),
  lastAccessedAt: timestamp("last_accessed_at"),
  accessCount: integer("access_count").default(0),
  // Permissions
  canViewAppointments: boolean("can_view_appointments").default(true),
  canViewStatements: boolean("can_view_statements").default(true),
  canViewDocuments: boolean("can_view_documents").default(true),
  canSendMessages: boolean("can_send_messages").default(true),
  canUpdateProfile: boolean("can_update_profile").default(true),
  canCompleteIntake: boolean("can_complete_intake").default(true),
  // Payment info
  hasPaymentMethod: boolean("has_payment_method").default(false),
  stripeCustomerId: varchar("stripe_customer_id"),
  stripePaymentMethodId: varchar("stripe_payment_method_id"),
  // Intake completion
  intakeCompletedAt: timestamp("intake_completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Patient Documents (files shared with patients)
export const patientDocuments = pgTable("patient_documents", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  uploadedBy: varchar("uploaded_by").references(() => users.id).notNull(),
  // Document details
  fileName: varchar("file_name").notNull(),
  fileType: varchar("file_type").notNull(), // insurance_card, referral, consent_form, lab_results, other
  fileSize: integer("file_size").notNull(), // bytes
  mimeType: varchar("mime_type").notNull(),
  storagePath: text("storage_path").notNull(),
  notes: text("notes"),
  // Visibility
  visibleToPatient: boolean("visible_to_patient").default(true),
  requiresSignature: boolean("requires_signature").default(false),
  signedAt: timestamp("signed_at"),
  signatureData: text("signature_data"), // base64 signature image or JSON
  // Tracking
  viewedAt: timestamp("viewed_at"),
  downloadedAt: timestamp("downloaded_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_patient_documents_patient").on(table.patientId),
  index("idx_patient_documents_practice").on(table.practiceId),
  index("idx_patient_documents_type").on(table.fileType),
]);

// Patient Statements (invoices/superbills)
export const patientStatements = pgTable("patient_statements", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  // Statement details
  statementNumber: varchar("statement_number").unique().notNull(),
  statementDate: timestamp("statement_date").defaultNow().notNull(),
  dueDate: timestamp("due_date"),
  // Amounts
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }).default("0"),
  balanceDue: decimal("balance_due", { precision: 10, scale: 2 }).notNull(),
  // Line items stored as JSON
  lineItems: jsonb("line_items").default([]), // [{date, description, cptCode, amount, insurance, patientResponsibility}]
  // Status
  status: varchar("status").default("pending"), // pending, sent, viewed, paid, overdue, cancelled
  // Delivery tracking
  sentVia: varchar("sent_via"), // email, mail, portal
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  // Payment info
  paymentMethod: varchar("payment_method"), // card, check, cash, insurance
  paymentDate: timestamp("payment_date"),
  paymentReference: varchar("payment_reference"),
  // PDF generation
  pdfUrl: varchar("pdf_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPatientPortalAccessSchema = createInsertSchema(patientPortalAccess).omit({ id: true, createdAt: true, updatedAt: true });
export type PatientPortalAccess = typeof patientPortalAccess.$inferSelect;
export type InsertPatientPortalAccess = z.infer<typeof insertPatientPortalAccessSchema>;

export const insertPatientDocumentSchema = createInsertSchema(patientDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type PatientDocument = typeof patientDocuments.$inferSelect;
export type InsertPatientDocument = z.infer<typeof insertPatientDocumentSchema>;

export const insertPatientStatementSchema = createInsertSchema(patientStatements).omit({ id: true, createdAt: true, updatedAt: true });
export type PatientStatement = typeof patientStatements.$inferSelect;
export type InsertPatientStatement = z.infer<typeof insertPatientStatementSchema>;

// ==================== APPOINTMENT REQUESTS ====================

// Appointment Requests (patient-initiated, pending admin approval)
export const appointmentRequests = pgTable("appointment_requests", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  appointmentTypeId: integer("appointment_type_id").references(() => appointmentTypes.id),
  therapistId: varchar("therapist_id").references(() => users.id),
  // Request details
  requestedDate: varchar("requested_date").notNull(), // YYYY-MM-DD
  requestedTime: varchar("requested_time").notNull(), // HH:MM
  notes: text("notes"),
  // Status
  status: varchar("status").default("pending_approval").notNull(), // pending_approval, approved, rejected, cancelled
  rejectionReason: text("rejection_reason"),
  // If approved, link to created appointment
  appointmentId: integer("appointment_id").references(() => appointments.id),
  // Processing
  processedAt: timestamp("processed_at"),
  processedById: varchar("processed_by_id").references(() => users.id),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAppointmentRequestSchema = createInsertSchema(appointmentRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type AppointmentRequest = typeof appointmentRequests.$inferSelect;
export type InsertAppointmentRequest = z.infer<typeof insertAppointmentRequestSchema>;

// ==================== ELIGIBILITY ALERTS ====================

// Eligibility Alerts (coverage issues that need attention)
export const eligibilityAlerts = pgTable("eligibility_alerts", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  // Alert details
  alertType: varchar("alert_type").notNull(), // coverage_inactive, coverage_changed, benefits_exhausted, auth_required, deductible_not_met, high_copay
  severity: varchar("severity").default("warning"), // info, warning, critical
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  // Previous vs current status
  previousStatus: jsonb("previous_status"),
  currentStatus: jsonb("current_status"),
  // Resolution
  status: varchar("status").default("open"), // open, acknowledged, resolved, dismissed
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: varchar("acknowledged_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  resolutionNotes: text("resolution_notes"),
  // Tracking
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEligibilityAlertSchema = createInsertSchema(eligibilityAlerts).omit({ id: true, createdAt: true, updatedAt: true });
export type EligibilityAlert = typeof eligibilityAlerts.$inferSelect;
export type InsertEligibilityAlert = z.infer<typeof insertEligibilityAlertSchema>;

// Treatment Plans
export const treatmentPlans = pgTable("treatment_plans", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  therapistId: varchar("therapist_id").references(() => users.id),
  // Plan details
  title: varchar("title", { length: 255 }).notNull(),
  diagnosis: text("diagnosis"), // Primary diagnosis/presenting problem
  diagnosisCodes: jsonb("diagnosis_codes"), // ICD-10 codes [{code, description}]
  clinicalSummary: text("clinical_summary"), // Current clinical presentation
  // Treatment approach
  treatmentModality: varchar("treatment_modality"), // CBT, DBT, EMDR, psychodynamic, etc.
  frequency: varchar("frequency"), // weekly, bi-weekly, monthly
  estimatedDuration: varchar("estimated_duration"), // 3 months, 6 months, ongoing
  // Status tracking
  status: varchar("status").default("active"), // draft, active, completed, discontinued
  startDate: date("start_date"),
  targetEndDate: date("target_end_date"),
  actualEndDate: date("actual_end_date"),
  // Review schedule
  nextReviewDate: date("next_review_date"),
  lastReviewedAt: timestamp("last_reviewed_at"),
  lastReviewedBy: varchar("last_reviewed_by").references(() => users.id),
  // Signatures
  patientSignature: text("patient_signature"), // Base64 or signature data
  patientSignedAt: timestamp("patient_signed_at"),
  therapistSignature: text("therapist_signature"),
  therapistSignedAt: timestamp("therapist_signed_at"),
  // Notes
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTreatmentPlanSchema = createInsertSchema(treatmentPlans).omit({ id: true, createdAt: true, updatedAt: true });
export type TreatmentPlan = typeof treatmentPlans.$inferSelect;
export type InsertTreatmentPlan = z.infer<typeof insertTreatmentPlanSchema>;

// Treatment Goals
export const treatmentGoals = pgTable("treatment_goals", {
  id: serial("id").primaryKey(),
  treatmentPlanId: integer("treatment_plan_id").references(() => treatmentPlans.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  // Goal details
  goalNumber: integer("goal_number").notNull(), // Order within the plan
  category: varchar("category"), // symptom_reduction, skill_building, behavioral, relational, etc.
  description: text("description").notNull(), // Long-term goal description
  targetDate: date("target_date"),
  // Progress tracking
  status: varchar("status").default("in_progress"), // not_started, in_progress, achieved, modified, discontinued
  progressPercentage: integer("progress_percentage").default(0), // 0-100
  // Measurable criteria
  baselineMeasure: text("baseline_measure"), // Starting point
  targetMeasure: text("target_measure"), // Goal criteria for achievement
  currentMeasure: text("current_measure"), // Current status
  // Timestamps
  achievedAt: timestamp("achieved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTreatmentGoalSchema = createInsertSchema(treatmentGoals).omit({ id: true, createdAt: true, updatedAt: true });
export type TreatmentGoal = typeof treatmentGoals.$inferSelect;
export type InsertTreatmentGoal = z.infer<typeof insertTreatmentGoalSchema>;

// Treatment Objectives (SMART objectives under goals)
export const treatmentObjectives = pgTable("treatment_objectives", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").references(() => treatmentGoals.id).notNull(),
  treatmentPlanId: integer("treatment_plan_id").references(() => treatmentPlans.id).notNull(),
  // Objective details (SMART: Specific, Measurable, Achievable, Relevant, Time-bound)
  objectiveNumber: integer("objective_number").notNull(), // Order within the goal
  description: text("description").notNull(),
  measurementMethod: text("measurement_method"), // How progress is measured
  targetDate: date("target_date"),
  // Progress
  status: varchar("status").default("in_progress"), // not_started, in_progress, achieved, modified, discontinued
  progressNotes: text("progress_notes"),
  achievedAt: timestamp("achieved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTreatmentObjectiveSchema = createInsertSchema(treatmentObjectives).omit({ id: true, createdAt: true, updatedAt: true });
export type TreatmentObjective = typeof treatmentObjectives.$inferSelect;
export type InsertTreatmentObjective = z.infer<typeof insertTreatmentObjectiveSchema>;

// Treatment Interventions (therapeutic techniques used)
export const treatmentInterventions = pgTable("treatment_interventions", {
  id: serial("id").primaryKey(),
  treatmentPlanId: integer("treatment_plan_id").references(() => treatmentPlans.id).notNull(),
  goalId: integer("goal_id").references(() => treatmentGoals.id), // Optional link to specific goal
  // Intervention details
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  frequency: varchar("frequency"), // per session, weekly, as needed
  // Tracking
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTreatmentInterventionSchema = createInsertSchema(treatmentInterventions).omit({ id: true, createdAt: true, updatedAt: true });
export type TreatmentIntervention = typeof treatmentInterventions.$inferSelect;
export type InsertTreatmentIntervention = z.infer<typeof insertTreatmentInterventionSchema>;

// Goal Progress Notes (session-by-session progress updates)
export const goalProgressNotes = pgTable("goal_progress_notes", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").references(() => treatmentGoals.id).notNull(),
  sessionId: integer("session_id").references(() => treatmentSessions.id),
  therapistId: varchar("therapist_id").references(() => users.id),
  // Progress update
  progressRating: integer("progress_rating"), // 1-5 scale or percentage
  notes: text("notes").notNull(),
  interventionsUsed: jsonb("interventions_used"), // [{id, name, effective: boolean}]
  // Next steps
  homeworkAssigned: text("homework_assigned"),
  nextSessionFocus: text("next_session_focus"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertGoalProgressNoteSchema = createInsertSchema(goalProgressNotes).omit({ id: true, createdAt: true });
export type GoalProgressNote = typeof goalProgressNotes.$inferSelect;
export type InsertGoalProgressNote = z.infer<typeof insertGoalProgressNoteSchema>;

// SOAP Note Goal Progress (links SOAP notes to treatment goals for progress tracking)
export const soapNoteGoalProgress = pgTable("soap_note_goal_progress", {
  id: serial("id").primaryKey(),
  soapNoteId: integer("soap_note_id").references(() => soapNotes.id).notNull(),
  goalId: integer("goal_id").references(() => treatmentGoals.id).notNull(),
  progressNote: text("progress_note"),
  progressPercentage: integer("progress_percentage"), // 0-100
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_soap_note_goal_progress_soap").on(table.soapNoteId),
  index("idx_soap_note_goal_progress_goal").on(table.goalId),
]);

export const insertSoapNoteGoalProgressSchema = createInsertSchema(soapNoteGoalProgress).omit({ id: true, createdAt: true });
export type SoapNoteGoalProgress = typeof soapNoteGoalProgress.$inferSelect;
export type InsertSoapNoteGoalProgress = z.infer<typeof insertSoapNoteGoalProgressSchema>;

// Outcome Measure Templates (standardized assessments)
export const outcomeMeasureTemplates = pgTable("outcome_measure_templates", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id), // null = system-wide template
  // Template info
  name: varchar("name", { length: 255 }).notNull(), // PHQ-9, GAD-7, PCL-5, etc.
  shortName: varchar("short_name", { length: 50 }), // Abbreviated name
  description: text("description"),
  category: varchar("category"), // depression, anxiety, trauma, substance_use, general, etc.
  // Assessment structure
  questions: jsonb("questions").notNull(), // [{id, text, options: [{value, label}], required}]
  scoringMethod: varchar("scoring_method"), // sum, average, weighted, custom
  scoringRanges: jsonb("scoring_ranges"), // [{min, max, severity, interpretation}]
  maxScore: integer("max_score"),
  // Clinical info
  clinicalCutoff: integer("clinical_cutoff"), // Score indicating clinical significance
  reliableChangeIndex: decimal("reliable_change_index", { precision: 5, scale: 2 }), // For measuring meaningful change
  minimumClinicallyImportantDifference: integer("mcid"), // Minimum change considered meaningful
  // Frequency
  recommendedFrequency: varchar("recommended_frequency"), // intake, weekly, monthly, discharge
  // Status
  isActive: boolean("is_active").default(true),
  isSystemTemplate: boolean("is_system_template").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOutcomeMeasureTemplateSchema = createInsertSchema(outcomeMeasureTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type OutcomeMeasureTemplate = typeof outcomeMeasureTemplates.$inferSelect;
export type InsertOutcomeMeasureTemplate = z.infer<typeof insertOutcomeMeasureTemplateSchema>;

// Patient Assessments (completed outcome measures)
export const patientAssessments = pgTable("patient_assessments", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  templateId: integer("template_id").references(() => outcomeMeasureTemplates.id).notNull(),
  sessionId: integer("session_id").references(() => treatmentSessions.id), // Optional link to session
  treatmentPlanId: integer("treatment_plan_id").references(() => treatmentPlans.id), // Optional link to plan
  // Assessment context
  assessmentType: varchar("assessment_type").default("routine"), // intake, routine, discharge, crisis
  administeredBy: varchar("administered_by").references(() => users.id),
  administeredAt: timestamp("administered_at").defaultNow(),
  // Responses and scoring
  responses: jsonb("responses").notNull(), // [{questionId, value, text?}]
  totalScore: integer("total_score"),
  subscaleScores: jsonb("subscale_scores"), // {subscaleName: score}
  severity: varchar("severity"), // minimal, mild, moderate, moderately_severe, severe
  interpretation: text("interpretation"), // Clinical interpretation text
  // Comparison to previous
  previousScore: integer("previous_score"),
  scoreChange: integer("score_change"),
  isReliableChange: boolean("is_reliable_change"), // Based on RCI
  isClinicallySignificant: boolean("is_clinically_significant"),
  // Clinical notes
  clinicianNotes: text("clinician_notes"),
  patientFeedback: text("patient_feedback"),
  // Status
  status: varchar("status").default("completed"), // pending, in_progress, completed, invalidated
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPatientAssessmentSchema = createInsertSchema(patientAssessments).omit({ id: true, createdAt: true, updatedAt: true });
export type PatientAssessment = typeof patientAssessments.$inferSelect;
export type InsertPatientAssessment = z.infer<typeof insertPatientAssessmentSchema>;

// Assessment Schedules (automated assessment assignments)
export const assessmentSchedules = pgTable("assessment_schedules", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  templateId: integer("template_id").references(() => outcomeMeasureTemplates.id).notNull(),
  // Schedule settings
  frequency: varchar("frequency").notNull(), // weekly, bi-weekly, monthly, session
  dayOfWeek: integer("day_of_week"), // 0-6 for weekly schedules
  dayOfMonth: integer("day_of_month"), // 1-31 for monthly schedules
  // Tracking
  lastSentAt: timestamp("last_sent_at"),
  nextDueAt: timestamp("next_due_at"),
  // Status
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAssessmentScheduleSchema = createInsertSchema(assessmentSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type AssessmentSchedule = typeof assessmentSchedules.$inferSelect;
export type InsertAssessmentSchedule = z.infer<typeof insertAssessmentScheduleSchema>;

// Referral Sources (providers, organizations that refer patients)
export const referralSources = pgTable("referral_sources", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  // Source details
  type: varchar("type").notNull(), // provider, organization, self, insurance, other
  name: varchar("name", { length: 255 }).notNull(),
  organization: varchar("organization", { length: 255 }),
  specialty: varchar("specialty", { length: 100 }),
  // Contact info
  email: varchar("email"),
  phone: varchar("phone"),
  fax: varchar("fax"),
  address: text("address"),
  // Provider details (if applicable)
  npi: varchar("npi", { length: 10 }),
  credentials: varchar("credentials", { length: 50 }), // MD, PhD, LCSW, etc.
  // Relationship
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertReferralSourceSchema = createInsertSchema(referralSources).omit({ id: true, createdAt: true, updatedAt: true });
export type ReferralSource = typeof referralSources.$inferSelect;
export type InsertReferralSource = z.infer<typeof insertReferralSourceSchema>;

// Referrals (incoming and outgoing)
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id),
  // Referral direction
  direction: varchar("direction").notNull(), // incoming, outgoing
  // Source/Destination
  referralSourceId: integer("referral_source_id").references(() => referralSources.id),
  externalProviderName: varchar("external_provider_name", { length: 255 }), // For quick entry without creating source
  externalProviderOrg: varchar("external_provider_org", { length: 255 }),
  externalProviderPhone: varchar("external_provider_phone"),
  externalProviderFax: varchar("external_provider_fax"),
  externalProviderEmail: varchar("external_provider_email"),
  // Referral details
  referralDate: date("referral_date").notNull(),
  receivedDate: date("received_date"), // When we received the referral
  reason: text("reason").notNull(), // Reason for referral
  diagnosisCodes: jsonb("diagnosis_codes"), // [{code, description}]
  urgency: varchar("urgency").default("routine"), // urgent, routine, emergency
  // Status tracking
  status: varchar("status").default("pending"), // pending, contacted, scheduled, completed, declined, no_show
  statusUpdatedAt: timestamp("status_updated_at"),
  statusUpdatedBy: varchar("status_updated_by").references(() => users.id),
  // Outgoing referral specific
  referredToSpecialty: varchar("referred_to_specialty"),
  referralLetterSent: boolean("referral_letter_sent").default(false),
  referralLetterSentAt: timestamp("referral_letter_sent_at"),
  // Incoming referral specific
  firstContactDate: date("first_contact_date"),
  firstAppointmentDate: date("first_appointment_date"),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  // Authorization
  authorizationRequired: boolean("authorization_required").default(false),
  authorizationNumber: varchar("authorization_number"),
  authorizationStatus: varchar("authorization_status"), // pending, approved, denied
  // Follow-up
  followUpRequired: boolean("follow_up_required").default(false),
  followUpDate: date("follow_up_date"),
  followUpCompleted: boolean("follow_up_completed").default(false),
  followUpNotes: text("follow_up_notes"),
  // Communication
  notes: text("notes"),
  internalNotes: text("internal_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertReferralSchema = createInsertSchema(referrals).omit({ id: true, createdAt: true, updatedAt: true });
export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = z.infer<typeof insertReferralSchema>;

// Referral Communications (tracking correspondence)
export const referralCommunications = pgTable("referral_communications", {
  id: serial("id").primaryKey(),
  referralId: integer("referral_id").references(() => referrals.id).notNull(),
  // Communication details
  type: varchar("type").notNull(), // phone, email, fax, letter, portal
  direction: varchar("direction").notNull(), // inbound, outbound
  subject: varchar("subject", { length: 255 }),
  content: text("content"),
  // Tracking
  sentAt: timestamp("sent_at"),
  receivedAt: timestamp("received_at"),
  sentBy: varchar("sent_by").references(() => users.id),
  // Attachments
  attachments: jsonb("attachments"), // [{name, url, type}]
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertReferralCommunicationSchema = createInsertSchema(referralCommunications).omit({ id: true, createdAt: true });
export type ReferralCommunication = typeof referralCommunications.$inferSelect;
export type InsertReferralCommunication = z.infer<typeof insertReferralCommunicationSchema>;

// Patient Payment Methods (stored payment info)
export const patientPaymentMethods = pgTable("patient_payment_methods", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  // Payment method details
  type: varchar("type").notNull(), // card, bank_account, hsa, fsa
  // Card details (tokenized)
  stripePaymentMethodId: varchar("stripe_payment_method_id"), // Stripe PM ID
  cardBrand: varchar("card_brand"), // visa, mastercard, amex, discover
  cardLast4: varchar("card_last4", { length: 4 }),
  cardExpMonth: integer("card_exp_month"),
  cardExpYear: integer("card_exp_year"),
  // Bank account details (tokenized)
  bankName: varchar("bank_name"),
  bankLast4: varchar("bank_last4", { length: 4 }),
  bankAccountType: varchar("bank_account_type"), // checking, savings
  // Billing address
  billingName: varchar("billing_name", { length: 255 }),
  billingAddress: text("billing_address"),
  billingCity: varchar("billing_city"),
  billingState: varchar("billing_state"),
  billingZip: varchar("billing_zip"),
  // Settings
  isDefault: boolean("is_default").default(false),
  isActive: boolean("is_active").default(true),
  // Verification
  isVerified: boolean("is_verified").default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPatientPaymentMethodSchema = createInsertSchema(patientPaymentMethods).omit({ id: true, createdAt: true, updatedAt: true });
export type PatientPaymentMethod = typeof patientPaymentMethods.$inferSelect;
export type InsertPatientPaymentMethod = z.infer<typeof insertPatientPaymentMethodSchema>;

// Payment Transactions
export const paymentTransactions = pgTable("payment_transactions", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  paymentMethodId: integer("payment_method_id").references(() => patientPaymentMethods.id),
  // Related records
  claimId: integer("claim_id").references(() => claims.id),
  statementId: integer("statement_id").references(() => patientStatements.id),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  // Transaction details
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD"),
  type: varchar("type").notNull(), // payment, refund, adjustment, write_off
  category: varchar("category"), // copay, deductible, coinsurance, self_pay, balance
  description: text("description"),
  // Payment processor
  processor: varchar("processor"), // stripe, square, manual, cash, check
  processorTransactionId: varchar("processor_transaction_id"),
  processorFee: decimal("processor_fee", { precision: 10, scale: 2 }),
  // Status
  status: varchar("status").default("pending"), // pending, processing, completed, failed, refunded, disputed
  failureReason: text("failure_reason"),
  // Timing
  processedAt: timestamp("processed_at"),
  settledAt: timestamp("settled_at"),
  // Manual payment details
  checkNumber: varchar("check_number"),
  referenceNumber: varchar("reference_number"),
  // Receipt
  receiptSent: boolean("receipt_sent").default(false),
  receiptSentAt: timestamp("receipt_sent_at"),
  receiptEmail: varchar("receipt_email"),
  // Audit
  createdBy: varchar("created_by").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPaymentTransactionSchema = createInsertSchema(paymentTransactions).omit({ id: true, createdAt: true, updatedAt: true });
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = z.infer<typeof insertPaymentTransactionSchema>;

// Payment Plans (recurring/installment payments)
export const paymentPlans = pgTable("payment_plans", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  paymentMethodId: integer("payment_method_id").references(() => patientPaymentMethods.id),
  // Plan details
  name: varchar("name", { length: 255 }),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  remainingAmount: decimal("remaining_amount", { precision: 10, scale: 2 }).notNull(),
  installmentAmount: decimal("installment_amount", { precision: 10, scale: 2 }).notNull(),
  numberOfInstallments: integer("number_of_installments").notNull(),
  completedInstallments: integer("completed_installments").default(0),
  // Schedule
  frequency: varchar("frequency").notNull(), // weekly, bi-weekly, monthly
  startDate: date("start_date").notNull(),
  nextPaymentDate: date("next_payment_date"),
  endDate: date("end_date"),
  // Auto-pay settings
  autoPayEnabled: boolean("auto_pay_enabled").default(true),
  autoPayDayOfMonth: integer("auto_pay_day_of_month"),
  // Status
  status: varchar("status").default("active"), // active, paused, completed, cancelled, defaulted
  pausedAt: timestamp("paused_at"),
  pauseReason: text("pause_reason"),
  // Terms
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }).default("0"),
  lateFee: decimal("late_fee", { precision: 10, scale: 2 }),
  // Agreement
  agreementSignedAt: timestamp("agreement_signed_at"),
  agreementSignature: text("agreement_signature"),
  terms: text("terms"),
  // Tracking
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPaymentPlanSchema = createInsertSchema(paymentPlans).omit({ id: true, createdAt: true, updatedAt: true });
export type PaymentPlan = typeof paymentPlans.$inferSelect;
export type InsertPaymentPlan = z.infer<typeof insertPaymentPlanSchema>;

// Payment Plan Installments (scheduled payments)
export const paymentPlanInstallments = pgTable("payment_plan_installments", {
  id: serial("id").primaryKey(),
  paymentPlanId: integer("payment_plan_id").references(() => paymentPlans.id).notNull(),
  transactionId: integer("transaction_id").references(() => paymentTransactions.id),
  // Installment details
  installmentNumber: integer("installment_number").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  dueDate: date("due_date").notNull(),
  // Status
  status: varchar("status").default("scheduled"), // scheduled, processing, paid, failed, skipped
  paidAt: timestamp("paid_at"),
  failedAt: timestamp("failed_at"),
  failureReason: text("failure_reason"),
  retryCount: integer("retry_count").default(0),
  nextRetryAt: timestamp("next_retry_at"),
  // Reminders
  reminderSentAt: timestamp("reminder_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPaymentPlanInstallmentSchema = createInsertSchema(paymentPlanInstallments).omit({ id: true, createdAt: true, updatedAt: true });
export type PaymentPlanInstallment = typeof paymentPlanInstallments.$inferSelect;
export type InsertPaymentPlanInstallment = z.infer<typeof insertPaymentPlanInstallmentSchema>;

// Practice Payment Settings
export const practicePaymentSettings = pgTable("practice_payment_settings", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull().unique(),
  // Stripe configuration
  stripeAccountId: varchar("stripe_account_id"),
  stripePublishableKey: varchar("stripe_publishable_key"),
  stripeSecretKeyEncrypted: text("stripe_secret_key_encrypted"),
  stripeWebhookSecret: text("stripe_webhook_secret"),
  // Payment options
  acceptCards: boolean("accept_cards").default(true),
  acceptBankTransfers: boolean("accept_bank_transfers").default(false),
  acceptHsa: boolean("accept_hsa").default(true),
  acceptCash: boolean("accept_cash").default(true),
  acceptChecks: boolean("accept_checks").default(true),
  // Auto-collection settings
  autoCollectCopay: boolean("auto_collect_copay").default(false),
  autoCollectBalance: boolean("auto_collect_balance").default(false),
  autoCollectDaysAfterService: integer("auto_collect_days_after_service").default(30),
  // Payment plan settings
  allowPaymentPlans: boolean("allow_payment_plans").default(true),
  minPaymentPlanAmount: decimal("min_payment_plan_amount", { precision: 10, scale: 2 }).default("100"),
  maxPaymentPlanMonths: integer("max_payment_plan_months").default(12),
  // Receipts
  autoSendReceipts: boolean("auto_send_receipts").default(true),
  receiptEmailTemplate: text("receipt_email_template"),
  // Display settings
  displayPricesOnPortal: boolean("display_prices_on_portal").default(true),
  requirePaymentAtBooking: boolean("require_payment_at_booking").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPracticePaymentSettingsSchema = createInsertSchema(practicePaymentSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type PracticePaymentSettings = typeof practicePaymentSettings.$inferSelect;
export type InsertPracticePaymentSettings = z.infer<typeof insertPracticePaymentSettingsSchema>;

// Therapy Bank - practice-wide bank of therapies that can be selected in SOAP notes
export const therapyBank = pgTable("therapy_bank", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  therapyName: varchar("therapy_name").notNull(),
  category: varchar("category"), // optional category for organizing therapies
  createdBy: varchar("created_by").references(() => users.id), // therapist who created it
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTherapyBankSchema = createInsertSchema(therapyBank).omit({ id: true, createdAt: true, updatedAt: true });
export type TherapyBank = typeof therapyBank.$inferSelect;
export type InsertTherapyBank = z.infer<typeof insertTherapyBankSchema>;

// Exercise Bank - practice-wide bank of exercises organized by activity category
export const exerciseBank = pgTable("exercise_bank", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  exerciseName: varchar("exercise_name").notNull(),
  category: varchar("category").notNull(), // "Strengthening Activities", "Balance & Motor Planning", etc.
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertExerciseBankSchema = createInsertSchema(exerciseBank).omit({ id: true, createdAt: true, updatedAt: true });
export type ExerciseBank = typeof exerciseBank.$inferSelect;
export type InsertExerciseBank = z.infer<typeof insertExerciseBankSchema>;

// Claim Outcomes - tracks actual reimbursements for ML model training
// Used to improve OON reimbursement predictions over time
export const claimOutcomes = pgTable("claim_outcomes", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),

  // Link to existing claim if available
  claimId: integer("claim_id").references(() => claims.id),

  // Input features for prediction model
  cptCode: varchar("cpt_code").notNull(),
  insuranceProvider: varchar("insurance_provider").notNull(),
  insurancePlanType: varchar("insurance_plan_type"), // PPO, HMO, EPO, POS, HDHP
  zipCode: varchar("zip_code"),
  billedAmount: decimal("billed_amount", { precision: 10, scale: 2 }).notNull(),
  providerCredential: varchar("provider_credential"), // PhD, LCSW, LMFT, etc.
  serviceDate: date("service_date").notNull(),
  networkStatus: varchar("network_status").default("out_of_network"), // in_network, out_of_network

  // Outcome data (filled when EOB/ERA received)
  allowedAmount: decimal("allowed_amount", { precision: 10, scale: 2 }),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }),
  patientResponsibility: decimal("patient_responsibility", { precision: 10, scale: 2 }),
  coinsuranceApplied: decimal("coinsurance_applied", { precision: 5, scale: 2 }), // percentage
  deductibleApplied: decimal("deductible_applied", { precision: 10, scale: 2 }),
  denialReason: text("denial_reason"),
  adjustmentReasonCode: varchar("adjustment_reason_code"), // CARC/RARC codes

  // Timing metadata
  daysToPayment: integer("days_to_payment"),
  submissionDate: timestamp("submission_date"),
  paymentDate: timestamp("payment_date"),

  // For model training
  isTrainingData: boolean("is_training_data").default(true),
  predictionAccuracy: decimal("prediction_accuracy", { precision: 5, scale: 4 }), // How close was our prediction

  // Our prediction at time of service (for accuracy tracking)
  predictedAllowedAmount: decimal("predicted_allowed_amount", { precision: 10, scale: 2 }),
  predictedReimbursement: decimal("predicted_reimbursement", { precision: 10, scale: 2 }),
  predictionConfidence: varchar("prediction_confidence"), // high, medium, low

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertClaimOutcomeSchema = createInsertSchema(claimOutcomes).omit({ id: true, createdAt: true, updatedAt: true });
export type ClaimOutcome = typeof claimOutcomes.$inferSelect;
export type InsertClaimOutcome = z.infer<typeof insertClaimOutcomeSchema>;

// Patient Plan Documents - stores uploaded insurance plan documents for parsing
export const patientPlanDocuments = pgTable("patient_plan_documents", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),

  // Document metadata
  documentType: varchar("document_type").notNull(), // 'sbc', 'eob', 'plan_contract', 'insurance_card', 'other'
  fileName: varchar("file_name").notNull(),
  fileUrl: varchar("file_url").notNull(), // S3/storage URL
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type"),

  // Processing status
  status: varchar("status").default("pending"), // 'pending', 'processing', 'completed', 'failed'
  parsedAt: timestamp("parsed_at"),
  parseError: text("parse_error"),

  // Consent tracking
  patientConsentGiven: boolean("patient_consent_given").default(false),
  consentDate: timestamp("consent_date"),
  consentMethod: varchar("consent_method"), // 'portal', 'email', 'in_person'

  // Audit
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPatientPlanDocumentSchema = createInsertSchema(patientPlanDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type PatientPlanDocument = typeof patientPlanDocuments.$inferSelect;
export type InsertPatientPlanDocument = z.infer<typeof insertPatientPlanDocumentSchema>;

// Patient Plan Benefits - stores parsed benefit data from insurance documents
export const patientPlanBenefits = pgTable("patient_plan_benefits", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  documentId: integer("document_id").references(() => patientPlanDocuments.id),

  // Plan identification
  planName: varchar("plan_name"),
  planType: varchar("plan_type"), // 'PPO', 'HMO', 'EPO', 'POS', 'HDHP', 'Indemnity'
  insuranceProvider: varchar("insurance_provider"),
  groupNumber: varchar("group_number"),
  policyNumber: varchar("policy_number"),
  effectiveDate: date("effective_date"),
  terminationDate: date("termination_date"),

  // OON Benefit Details (the key data we need!)
  oonDeductibleIndividual: decimal("oon_deductible_individual", { precision: 10, scale: 2 }),
  oonDeductibleFamily: decimal("oon_deductible_family", { precision: 10, scale: 2 }),
  oonDeductibleMet: decimal("oon_deductible_met", { precision: 10, scale: 2 }),
  oonCoinsurancePercent: decimal("oon_coinsurance_percent", { precision: 5, scale: 2 }), // What patient pays (e.g., 40%)
  oonOutOfPocketMax: decimal("oon_out_of_pocket_max", { precision: 10, scale: 2 }),
  oonOutOfPocketMet: decimal("oon_out_of_pocket_met", { precision: 10, scale: 2 }),

  // Allowed Amount Methodology (critical for predictions)
  allowedAmountMethod: varchar("allowed_amount_method"), // 'ucr', 'medicare_percent', 'fair_health', 'plan_schedule', 'unknown'
  allowedAmountPercent: decimal("allowed_amount_percent", { precision: 5, scale: 2 }), // e.g., 150% of Medicare
  allowedAmountSource: varchar("allowed_amount_source"), // e.g., 'Fair Health', 'HIAA', 'Medicare'

  // Mental Health Specific
  mentalHealthParity: boolean("mental_health_parity"), // Is MH covered same as medical?
  mentalHealthVisitLimit: integer("mental_health_visit_limit"), // Annual visit cap
  mentalHealthVisitsUsed: integer("mental_health_visits_used"),
  mentalHealthPriorAuthRequired: boolean("mental_health_prior_auth_required"),
  mentalHealthCopay: decimal("mental_health_copay", { precision: 10, scale: 2 }),

  // In-Network comparison (useful context)
  innDeductibleIndividual: decimal("inn_deductible_individual", { precision: 10, scale: 2 }),
  innCoinsurancePercent: decimal("inn_coinsurance_percent", { precision: 5, scale: 2 }),
  innOutOfPocketMax: decimal("inn_out_of_pocket_max", { precision: 10, scale: 2 }),

  // Coverage specifics
  teleHealthCovered: boolean("telehealth_covered"),
  teleHealthOonSameAsInPerson: boolean("telehealth_oon_same_as_in_person"),

  // Raw extracted data (for debugging/reprocessing)
  rawExtractedData: jsonb("raw_extracted_data"),
  extractionConfidence: decimal("extraction_confidence", { precision: 3, scale: 2 }), // 0-1 confidence score

  // Status
  isActive: boolean("is_active").default(true),
  verifiedBy: varchar("verified_by").references(() => users.id), // Admin who verified accuracy
  verifiedAt: timestamp("verified_at"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPatientPlanBenefitsSchema = createInsertSchema(patientPlanBenefits).omit({ id: true, createdAt: true, updatedAt: true });
export type PatientPlanBenefits = typeof patientPlanBenefits.$inferSelect;
export type InsertPatientPlanBenefits = z.infer<typeof insertPatientPlanBenefitsSchema>;

// Payer Contracts - stores negotiated contracts with insurance payers
export const payerContracts = pgTable("payer_contracts", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  payerName: varchar("payer_name").notNull(),
  payerId: varchar("payer_id"), // External payer identifier
  contractName: varchar("contract_name").notNull(),
  effectiveDate: date("effective_date").notNull(),
  terminationDate: date("termination_date"),
  status: varchar("status").default("active").notNull(), // active, expired, pending
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_payer_contracts_practice").on(table.practiceId),
  index("idx_payer_contracts_status").on(table.status),
]);

export const insertPayerContractSchema = createInsertSchema(payerContracts).omit({ id: true, createdAt: true, updatedAt: true });
export type PayerContract = typeof payerContracts.$inferSelect;
export type InsertPayerContract = z.infer<typeof insertPayerContractSchema>;

// Payer Rates - per-CPT contracted rates within a payer contract
export const payerRates = pgTable("payer_rates", {
  id: serial("id").primaryKey(),
  contractId: integer("contract_id").references(() => payerContracts.id).notNull(),
  cptCode: varchar("cpt_code").notNull(),
  description: text("description"),
  contractedRate: decimal("contracted_rate", { precision: 10, scale: 2 }).notNull(),
  medicareRate: decimal("medicare_rate", { precision: 10, scale: 2 }), // For comparison
  effectiveDate: date("effective_date"),
  terminationDate: date("termination_date"),
  modifiers: jsonb("modifiers"), // e.g., telehealth modifier rates
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_payer_rates_contract").on(table.contractId),
  index("idx_payer_rates_cpt").on(table.cptCode),
]);

export const insertPayerRateSchema = createInsertSchema(payerRates).omit({ id: true, createdAt: true });
export type PayerRate = typeof payerRates.$inferSelect;
export type InsertPayerRate = z.infer<typeof insertPayerRateSchema>;

// Webhook Events - idempotency tracking for Stripe webhooks
export const webhookEvents = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(), // Stripe event ID
  eventType: text("event_type").notNull(), // e.g. 'payment_intent.succeeded'
  processedAt: timestamp("processed_at").defaultNow(),
  status: text("status").notNull(), // 'processed' or 'failed'
  metadata: jsonb("metadata"), // store event summary
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type InsertWebhookEvent = typeof webhookEvents.$inferInsert;

// ==================== Patient Payments (Patient-side billing) ====================

// Patient Payments - tracks payments made by patients toward statements/balances
export const patientPayments = pgTable("patient_payments", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  statementId: integer("statement_id").references(() => patientStatements.id),
  // Payment details
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method").notNull(), // cash, check, card, ach
  paymentDate: timestamp("payment_date").defaultNow().notNull(),
  referenceNumber: varchar("reference_number"),
  // Status
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_patient_payments_patient").on(table.patientId),
  index("idx_patient_payments_practice").on(table.practiceId),
  index("idx_patient_payments_statement").on(table.statementId),
]);

export const insertPatientPaymentSchema = createInsertSchema(patientPayments).omit({ id: true, createdAt: true });
export type PatientPayment = typeof patientPayments.$inferSelect;
export type InsertPatientPayment = z.infer<typeof insertPatientPaymentSchema>;

// ==================== 835 Remittance Advice ====================

// Remittance Advice (ERA/835) - payment explanation from insurance
export const remittanceAdvice = pgTable("remittance_advice", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  receivedDate: date("received_date").notNull(),
  payerName: varchar("payer_name").notNull(),
  payerId: varchar("payer_id"),
  checkNumber: varchar("check_number"),
  checkDate: date("check_date"),
  totalPaymentAmount: decimal("total_payment_amount", { precision: 10, scale: 2 }).notNull(),
  rawData: jsonb("raw_data"), // Full 835 parsed data
  processedAt: timestamp("processed_at"),
  status: varchar("status").default("pending").notNull(), // pending, processed, error
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_remittance_advice_practice_status").on(table.practiceId, table.status),
  index("idx_remittance_advice_practice_date").on(table.practiceId, table.receivedDate),
]);

// Remittance Line Items - individual claim-level payment details
export const remittanceLineItems = pgTable("remittance_line_items", {
  id: serial("id").primaryKey(),
  remittanceId: integer("remittance_id").references(() => remittanceAdvice.id).notNull(),
  claimId: integer("claim_id").references(() => claims.id), // nullable - linked after matching
  patientName: varchar("patient_name").notNull(),
  memberId: varchar("member_id"),
  serviceDate: date("service_date"),
  cptCode: varchar("cpt_code"),
  chargedAmount: decimal("charged_amount", { precision: 10, scale: 2 }),
  allowedAmount: decimal("allowed_amount", { precision: 10, scale: 2 }),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }),
  adjustmentAmount: decimal("adjustment_amount", { precision: 10, scale: 2 }),
  adjustmentReasonCodes: jsonb("adjustment_reason_codes"), // e.g. [{ code: "CO-45", description: "..." }]
  remarkCodes: jsonb("remark_codes"), // e.g. [{ code: "N130", description: "..." }]
  status: varchar("status").default("unmatched").notNull(), // matched, unmatched, partial
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_remittance_line_items_remittance").on(table.remittanceId),
  index("idx_remittance_line_items_claim").on(table.claimId),
  index("idx_remittance_line_items_status").on(table.status),
]);

// Relations for remittance tables
export const remittanceAdviceRelations = relations(remittanceAdvice, ({ one, many }) => ({
  practice: one(practices, {
    fields: [remittanceAdvice.practiceId],
    references: [practices.id],
  }),
  lineItems: many(remittanceLineItems),
}));

export const remittanceLineItemsRelations = relations(remittanceLineItems, ({ one }) => ({
  remittance: one(remittanceAdvice, {
    fields: [remittanceLineItems.remittanceId],
    references: [remittanceAdvice.id],
  }),
  claim: one(claims, {
    fields: [remittanceLineItems.claimId],
    references: [claims.id],
  }),
}));

// Insert schemas for remittance
export const insertRemittanceAdviceSchema = createInsertSchema(remittanceAdvice).omit({
  id: true,
  createdAt: true,
});

export const insertRemittanceLineItemSchema = createInsertSchema(remittanceLineItems).omit({
  id: true,
  createdAt: true,
});

// Types for remittance
export type RemittanceAdvice = typeof remittanceAdvice.$inferSelect;
export type InsertRemittanceAdvice = z.infer<typeof insertRemittanceAdviceSchema>;
export type RemittanceLineItem = typeof remittanceLineItems.$inferSelect;
export type InsertRemittanceLineItem = z.infer<typeof insertRemittanceLineItemSchema>;

// HIPAA Compliance Self-Assessment Checks
export const complianceChecks = pgTable("compliance_checks", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  checkType: varchar("check_type").notNull(), // mfa_enforcement, encryption_enabled, baa_signed, audit_logging, data_retention, access_controls, breach_notification_plan, risk_assessment, training_completed, backup_verified
  status: varchar("status").notNull().default("not_checked"), // pass, fail, warning, not_checked
  lastCheckedAt: timestamp("last_checked_at").defaultNow(),
  details: jsonb("details"), // structured results from automated check
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertComplianceCheckSchema = createInsertSchema(complianceChecks).omit({ id: true, createdAt: true });
export type ComplianceCheck = typeof complianceChecks.$inferSelect;
export type InsertComplianceCheck = z.infer<typeof insertComplianceCheckSchema>;

// SSO Configurations for enterprise customers
export const ssoConfigurations = pgTable("sso_configurations", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  provider: varchar("provider").notNull(), // okta, azure-ad, google, custom
  protocol: varchar("protocol").notNull(), // saml, oidc
  clientId: varchar("client_id"),
  clientSecret: jsonb("client_secret"), // encrypted via PHI encryption service
  issuerUrl: varchar("issuer_url"),
  callbackUrl: varchar("callback_url"),
  metadataUrl: varchar("metadata_url"), // for SAML metadata
  enabled: boolean("enabled").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_sso_config_practice").on(table.practiceId),
]);

// SSO Configuration relations
export const ssoConfigurationsRelations = relations(ssoConfigurations, ({ one }) => ({
  practice: one(practices, {
    fields: [ssoConfigurations.practiceId],
    references: [practices.id],
  }),
}));

// Insert schema for SSO configurations
export const insertSsoConfigurationSchema = createInsertSchema(ssoConfigurations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types for SSO configurations
export type SsoConfiguration = typeof ssoConfigurations.$inferSelect;
export type InsertSsoConfiguration = z.infer<typeof insertSsoConfigurationSchema>;

// Practice Locations - multi-location workspace management
export const practiceLocations = pgTable("practice_locations", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  name: varchar("name").notNull(),
  address: text("address"),
  city: varchar("city"),
  state: varchar("state"),
  zipCode: varchar("zip_code"),
  phone: varchar("phone"),
  fax: varchar("fax"),
  isMainLocation: boolean("is_main_location").default(false),
  isActive: boolean("is_active").default(true),
  operatingHours: jsonb("operating_hours"), // {monday: {open, close}, tuesday: ...}
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_practice_locations_practice").on(table.practiceId),
]);

// User-Location assignments - links therapists/staff to locations
export const userLocations = pgTable("user_locations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  locationId: integer("location_id").references(() => practiceLocations.id).notNull(),
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_user_locations_user").on(table.userId),
  index("idx_user_locations_location").on(table.locationId),
]);

// Practice Locations relations
export const practiceLocationsRelations = relations(practiceLocations, ({ one, many }) => ({
  practice: one(practices, {
    fields: [practiceLocations.practiceId],
    references: [practices.id],
  }),
  userLocations: many(userLocations),
}));

// User Locations relations
export const userLocationsRelations = relations(userLocations, ({ one }) => ({
  user: one(users, {
    fields: [userLocations.userId],
    references: [users.id],
  }),
  location: one(practiceLocations, {
    fields: [userLocations.locationId],
    references: [practiceLocations.id],
  }),
}));

// Insert schemas for locations
export const insertPracticeLocationSchema = createInsertSchema(practiceLocations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserLocationSchema = createInsertSchema(userLocations).omit({
  id: true,
  createdAt: true,
});

// Types for locations
export type PracticeLocation = typeof practiceLocations.$inferSelect;
export type InsertPracticeLocation = z.infer<typeof insertPracticeLocationSchema>;
export type UserLocation = typeof userLocations.$inferSelect;
export type InsertUserLocation = z.infer<typeof insertUserLocationSchema>;

// Saved Reports - custom report builder configurations
export const savedReports = pgTable("saved_reports", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  name: varchar("name").notNull(),
  description: text("description"),
  reportType: varchar("report_type").notNull(), // claims, revenue, patients, appointments, payer_performance
  filters: jsonb("filters"), // { dateRange: { start, end }, status, payer, therapist, cptCode }
  groupBy: text("group_by"), // month, payer, therapist, cpt_code, status
  columns: jsonb("columns"), // array of selected column names
  chartType: varchar("chart_type").default("bar"), // bar, line, pie, table, none
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_saved_reports_practice").on(table.practiceId),
  index("idx_saved_reports_created_by").on(table.createdBy),
]);

export const savedReportsRelations = relations(savedReports, ({ one }) => ({
  practice: one(practices, {
    fields: [savedReports.practiceId],
    references: [practices.id],
  }),
  creator: one(users, {
    fields: [savedReports.createdBy],
    references: [users.id],
  }),
}));

export const insertSavedReportSchema = createInsertSchema(savedReports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SavedReport = typeof savedReports.$inferSelect;
export type InsertSavedReport = z.infer<typeof insertSavedReportSchema>;

// Patient Progress Notes (patient-facing, separate from SOAP notes)
// Therapists control what patients see — this is intentionally separate from SOAP notes
export const patientProgressNotes = pgTable("patient_progress_notes", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  sessionId: integer("session_id").references(() => treatmentSessions.id),
  sessionDate: date("session_date").notNull(),
  therapistName: varchar("therapist_name").notNull(),
  summary: text("summary").notNull(), // Patient-friendly summary, NOT the full SOAP note
  goalsDiscussed: jsonb("goals_discussed"), // Array of strings
  homework: text("homework"),
  nextSessionFocus: text("next_session_focus"),
  sharedAt: timestamp("shared_at"), // When therapist approved sharing with patient
  sharedBy: varchar("shared_by").references(() => users.id), // userId who approved sharing
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_patient_progress_notes_patient").on(table.patientId),
  index("idx_patient_progress_notes_practice").on(table.practiceId),
  index("idx_patient_progress_notes_session").on(table.sessionId),
]);

// Patient Progress Notes relations
export const patientProgressNotesRelations = relations(patientProgressNotes, ({ one }) => ({
  patient: one(patients, {
    fields: [patientProgressNotes.patientId],
    references: [patients.id],
  }),
  practice: one(practices, {
    fields: [patientProgressNotes.practiceId],
    references: [practices.id],
  }),
  session: one(treatmentSessions, {
    fields: [patientProgressNotes.sessionId],
    references: [treatmentSessions.id],
  }),
}));

// Insert schema for patient progress notes
export const insertPatientProgressNoteSchema = createInsertSchema(patientProgressNotes).omit({
  id: true,
  createdAt: true,
});

// Types for patient progress notes
export type PatientProgressNote = typeof patientProgressNotes.$inferSelect;
export type InsertPatientProgressNote = z.infer<typeof insertPatientProgressNoteSchema>;

// ==================== Patient Outcome Surveys ====================

// Survey Templates - standardized (PHQ-9, GAD-7, PCL-5) and custom surveys
export const surveyTemplates = pgTable("survey_templates", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id),
  name: varchar("name").notNull(),
  description: text("description"),
  type: varchar("type").notNull(), // phq9, gad7, pcl5, custom, satisfaction
  questions: jsonb("questions").notNull(), // Array of {id, text, type: "scale"|"text"|"multiple_choice", options?: string[], required: boolean}
  isActive: boolean("is_active").default(true),
  isBuiltIn: boolean("is_built_in").default(false), // true for PHQ-9, GAD-7, etc.
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_survey_templates_practice").on(table.practiceId),
  index("idx_survey_templates_type").on(table.type),
]);

export const surveyTemplatesRelations = relations(surveyTemplates, ({ one, many }) => ({
  practice: one(practices, {
    fields: [surveyTemplates.practiceId],
    references: [practices.id],
  }),
  assignments: many(surveyAssignments),
  responses: many(surveyResponses),
}));

export const insertSurveyTemplateSchema = createInsertSchema(surveyTemplates).omit({
  id: true,
  createdAt: true,
});
export type SurveyTemplate = typeof surveyTemplates.$inferSelect;
export type InsertSurveyTemplate = z.infer<typeof insertSurveyTemplateSchema>;

// Survey Assignments - tracks which surveys are assigned to which patients
export const surveyAssignments = pgTable("survey_assignments", {
  id: serial("id").primaryKey(),
  surveyTemplateId: integer("survey_template_id").references(() => surveyTemplates.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  assignedBy: varchar("assigned_by").references(() => users.id).notNull(),
  dueDate: timestamp("due_date"),
  status: varchar("status").default("pending").notNull(), // pending, completed, expired
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_survey_assignments_patient").on(table.patientId),
  index("idx_survey_assignments_practice").on(table.practiceId),
  index("idx_survey_assignments_status").on(table.status),
]);

export const surveyAssignmentsRelations = relations(surveyAssignments, ({ one }) => ({
  template: one(surveyTemplates, {
    fields: [surveyAssignments.surveyTemplateId],
    references: [surveyTemplates.id],
  }),
  patient: one(patients, {
    fields: [surveyAssignments.patientId],
    references: [patients.id],
  }),
  practice: one(practices, {
    fields: [surveyAssignments.practiceId],
    references: [practices.id],
  }),
}));

export const insertSurveyAssignmentSchema = createInsertSchema(surveyAssignments).omit({
  id: true,
  createdAt: true,
});
export type SurveyAssignment = typeof surveyAssignments.$inferSelect;
export type InsertSurveyAssignment = z.infer<typeof insertSurveyAssignmentSchema>;

// Survey Responses - patient-submitted answers
export const surveyResponses = pgTable("survey_responses", {
  id: serial("id").primaryKey(),
  surveyTemplateId: integer("survey_template_id").references(() => surveyTemplates.id).notNull(),
  assignmentId: integer("assignment_id").references(() => surveyAssignments.id),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  assignedBy: varchar("assigned_by").references(() => users.id),
  responses: jsonb("responses").notNull(), // Array of {questionId, answer}
  totalScore: integer("total_score"), // For standardized assessments (PHQ-9: 0-27, GAD-7: 0-21)
  severity: varchar("severity"), // minimal, mild, moderate, moderately_severe, severe
  completedAt: timestamp("completed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_survey_responses_patient").on(table.patientId),
  index("idx_survey_responses_practice").on(table.practiceId),
  index("idx_survey_responses_template").on(table.surveyTemplateId),
]);

export const surveyResponsesRelations = relations(surveyResponses, ({ one }) => ({
  template: one(surveyTemplates, {
    fields: [surveyResponses.surveyTemplateId],
    references: [surveyTemplates.id],
  }),
  assignment: one(surveyAssignments, {
    fields: [surveyResponses.assignmentId],
    references: [surveyAssignments.id],
  }),
  patient: one(patients, {
    fields: [surveyResponses.patientId],
    references: [patients.id],
  }),
  practice: one(practices, {
    fields: [surveyResponses.practiceId],
    references: [practices.id],
  }),
}));

export const insertSurveyResponseSchema = createInsertSchema(surveyResponses).omit({
  id: true,
  createdAt: true,
});
export type SurveyResponse = typeof surveyResponses.$inferSelect;
export type InsertSurveyResponse = z.infer<typeof insertSurveyResponseSchema>;

// Notification Preferences - controls how patients and staff receive notifications
export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id), // nullable — for staff
  patientId: integer("patient_id").references(() => patients.id), // nullable — for patients
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  emailEnabled: boolean("email_enabled").default(true).notNull(),
  smsEnabled: boolean("sms_enabled").default(true).notNull(),
  portalEnabled: boolean("portal_enabled").default(true).notNull(),
  appointmentReminders: boolean("appointment_reminders").default(true).notNull(),
  billingNotifications: boolean("billing_notifications").default(true).notNull(),
  claimUpdates: boolean("claim_updates").default(true).notNull(),
  surveyReminders: boolean("survey_reminders").default(true).notNull(),
  marketingEmails: boolean("marketing_emails").default(false).notNull(),
  quietHoursStart: text("quiet_hours_start"), // e.g. "22:00"
  quietHoursEnd: text("quiet_hours_end"), // e.g. "08:00"
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_notification_prefs_user").on(table.userId),
  index("idx_notification_prefs_patient").on(table.patientId),
  index("idx_notification_prefs_practice").on(table.practiceId),
]);

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.userId],
    references: [users.id],
  }),
  patient: one(patients, {
    fields: [notificationPreferences.patientId],
    references: [patients.id],
  }),
  practice: one(practices, {
    fields: [notificationPreferences.practiceId],
    references: [practices.id],
  }),
}));

export const insertNotificationPreferencesSchema = createInsertSchema(notificationPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NotificationPreferences = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreferences = z.infer<typeof insertNotificationPreferencesSchema>;

// ==================== Webhook Endpoints ====================

// Webhook Endpoints - allows practices to receive callbacks for important events
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(), // Used for HMAC-SHA256 signing
  events: text("events").array().notNull(), // Array of event type strings
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_webhook_endpoints_practice").on(table.practiceId),
  index("idx_webhook_endpoints_active").on(table.isActive),
]);

export const webhookEndpointsRelations = relations(webhookEndpoints, ({ one }) => ({
  practice: one(practices, {
    fields: [webhookEndpoints.practiceId],
    references: [practices.id],
  }),
}));

export const insertWebhookEndpointSchema = createInsertSchema(webhookEndpoints).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type InsertWebhookEndpoint = z.infer<typeof insertWebhookEndpointSchema>;

// ==================== Patient Document File Types ====================

// Patient document file types
export const DOCUMENT_FILE_TYPES = [
  'insurance_card',
  'referral',
  'consent_form',
  'lab_results',
  'other',
] as const;
export type DocumentFileType = typeof DOCUMENT_FILE_TYPES[number];

// Relations for patientDocuments (table defined above near line 1823)
export const patientDocumentsRelations = relations(patientDocuments, ({ one }) => ({
  patient: one(patients, {
    fields: [patientDocuments.patientId],
    references: [patients.id],
  }),
  practice: one(practices, {
    fields: [patientDocuments.practiceId],
    references: [practices.id],
  }),
  uploader: one(users, {
    fields: [patientDocuments.uploadedBy],
    references: [users.id],
  }),
}));

// ==================== Claim Follow-Ups ====================

// Automated claim follow-up tracking for aging and denied claims
export const claimFollowUps = pgTable("claim_follow_ups", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").references(() => claims.id).notNull(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  followUpType: varchar("follow_up_type").notNull(), // aging_30, aging_60, aging_90, denial_appeal, missing_info
  status: varchar("status").default("pending").notNull(), // pending, in_progress, completed, dismissed
  priority: varchar("priority").default("medium").notNull(), // low, medium, high, urgent
  notes: text("notes"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_claim_follow_ups_practice_status").on(table.practiceId, table.status),
  index("idx_claim_follow_ups_claim").on(table.claimId),
  index("idx_claim_follow_ups_priority").on(table.priority),
  index("idx_claim_follow_ups_assigned").on(table.assignedTo),
]);

export const claimFollowUpsRelations = relations(claimFollowUps, ({ one }) => ({
  claim: one(claims, {
    fields: [claimFollowUps.claimId],
    references: [claims.id],
  }),
  practice: one(practices, {
    fields: [claimFollowUps.practiceId],
    references: [practices.id],
  }),
  assignedUser: one(users, {
    fields: [claimFollowUps.assignedTo],
    references: [users.id],
  }),
}));

export const insertClaimFollowUpSchema = createInsertSchema(claimFollowUps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ClaimFollowUp = typeof claimFollowUps.$inferSelect;
export type InsertClaimFollowUp = z.infer<typeof insertClaimFollowUpSchema>;

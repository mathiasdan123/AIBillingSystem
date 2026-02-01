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
  // White-label branding fields
  brandLogoUrl: varchar("brand_logo_url"),
  brandPrimaryColor: varchar("brand_primary_color").default("#2563eb"), // Blue
  brandSecondaryColor: varchar("brand_secondary_color").default("#1e40af"),
  brandEmailFromName: varchar("brand_email_from_name"),
  brandEmailReplyTo: varchar("brand_email_reply_to"),
  brandWebsiteUrl: varchar("brand_website_url"),
  brandPrivacyPolicyUrl: varchar("brand_privacy_policy_url"),
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
  // Contact preferences
  phoneType: varchar("phone_type").default("mobile"), // mobile, landline, work
  preferredContactMethod: varchar("preferred_contact_method").default("email"), // email, sms, both
  smsConsentGiven: boolean("sms_consent_given").default(false),
  smsConsentDate: timestamp("sms_consent_date"),
  deletedAt: timestamp("deleted_at"),
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
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: varchar("cancelled_by"), // patient, therapist, admin
  cancellationReason: varchar("cancellation_reason"), // patient_request, sick, schedule_conflict, weather, no_show, other
  cancellationNotes: text("cancellation_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Waitlist - for patients wanting earlier/different appointment times
export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  practiceId: integer("practice_id").references(() => practices.id).notNull(),
  patientId: integer("patient_id").references(() => patients.id).notNull(),
  therapistId: varchar("therapist_id").references(() => users.id), // preferred therapist (optional)
  preferredDays: jsonb("preferred_days"), // ['monday', 'wednesday', 'friday']
  preferredTimeStart: varchar("preferred_time_start"), // '09:00'
  preferredTimeEnd: varchar("preferred_time_end"), // '17:00'
  priority: integer("priority").default(1), // 1 = normal, 2 = high, 3 = urgent
  status: varchar("status").default("waiting"), // waiting, notified, scheduled, expired, cancelled
  reason: text("reason"), // why they need an earlier appointment
  notes: text("notes"),
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
  status: varchar("status").default("pending"), // pending, sent, clicked, reviewed, declined
  sentVia: varchar("sent_via"), // email, sms, both
  emailSent: boolean("email_sent").default(false),
  smsSent: boolean("sms_sent").default(false),
  sentAt: timestamp("sent_at"),
  clickedAt: timestamp("clicked_at"), // when they clicked the review link
  reviewedAt: timestamp("reviewed_at"), // when we detected they left a review
  declinedAt: timestamp("declined_at"),
  declineReason: varchar("decline_reason"),
  notes: text("notes"),
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
});

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


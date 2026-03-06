CREATE TABLE "amendment_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"requested_by" varchar,
	"request_date" timestamp DEFAULT now() NOT NULL,
	"field_to_amend" varchar NOT NULL,
	"current_value" text,
	"requested_value" text NOT NULL,
	"reason" text,
	"status" varchar DEFAULT 'pending',
	"reviewed_by" varchar,
	"review_date" timestamp,
	"denial_reason" text,
	"response_deadline" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "appeals" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"appeal_level" varchar DEFAULT 'initial' NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"denial_category" varchar,
	"deadline_date" date,
	"submitted_date" timestamp,
	"resolved_date" timestamp,
	"appealed_amount" numeric(10, 2),
	"recovered_amount" numeric(10, 2),
	"appeal_letter" text,
	"supporting_docs" jsonb,
	"insurer_response" text,
	"notes" text,
	"assigned_to" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "appointment_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"appointment_type_id" integer,
	"therapist_id" varchar,
	"requested_date" varchar NOT NULL,
	"requested_time" varchar NOT NULL,
	"notes" text,
	"status" varchar DEFAULT 'pending_approval' NOT NULL,
	"rejection_reason" text,
	"appointment_id" integer,
	"processed_at" timestamp,
	"processed_by_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "appointment_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"name" varchar NOT NULL,
	"description" text,
	"duration" integer NOT NULL,
	"price" numeric(10, 2),
	"color" varchar,
	"is_active" boolean DEFAULT true,
	"allow_online_booking" boolean DEFAULT true,
	"requires_approval" boolean DEFAULT false,
	"buffer_before" integer DEFAULT 0,
	"buffer_after" integer DEFAULT 0,
	"max_advance_booking" integer DEFAULT 60,
	"min_advance_booking" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer,
	"patient_id" integer,
	"therapist_id" varchar,
	"title" varchar,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"status" varchar DEFAULT 'scheduled',
	"notes" text,
	"reminder_sent" boolean DEFAULT false,
	"cancelled_at" timestamp,
	"cancelled_by" varchar,
	"cancellation_reason" varchar,
	"cancellation_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "assessment_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"frequency" varchar NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"last_sent_at" timestamp,
	"next_due_at" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_category" varchar NOT NULL,
	"event_type" varchar NOT NULL,
	"resource_type" varchar,
	"resource_id" varchar,
	"user_id" varchar,
	"practice_id" integer,
	"ip_address" varchar,
	"user_agent" text,
	"details" jsonb,
	"success" boolean DEFAULT true,
	"integrity_hash" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "authorization_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer,
	"authorization_id" integer,
	"actor_type" varchar NOT NULL,
	"actor_id" varchar,
	"actor_email" varchar,
	"actor_ip_address" varchar,
	"actor_user_agent" text,
	"event_type" varchar NOT NULL,
	"event_details" jsonb,
	"data_type" varchar,
	"data_scope" jsonb,
	"success" boolean DEFAULT true,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baa_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"vendor_name" varchar NOT NULL,
	"vendor_type" varchar NOT NULL,
	"signed_date" varchar NOT NULL,
	"expiration_date" varchar NOT NULL,
	"status" varchar DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "booking_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"is_online_booking_enabled" boolean DEFAULT true,
	"booking_page_slug" varchar,
	"welcome_message" text,
	"confirmation_message" text,
	"require_phone_number" boolean DEFAULT true,
	"require_insurance_info" boolean DEFAULT false,
	"allow_new_patients" boolean DEFAULT true,
	"new_patient_message" text,
	"cancellation_policy" text,
	"default_timezone" varchar DEFAULT 'America/New_York',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "booking_settings_practice_id_unique" UNIQUE("practice_id"),
	CONSTRAINT "booking_settings_booking_page_slug_unique" UNIQUE("booking_page_slug")
);
--> statement-breakpoint
CREATE TABLE "breach_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"discovered_at" timestamp NOT NULL,
	"description" text NOT NULL,
	"affected_individuals_count" integer DEFAULT 0,
	"breach_type" varchar NOT NULL,
	"phi_involved" text,
	"risk_assessment" varchar DEFAULT 'low',
	"notification_status" varchar DEFAULT 'pending',
	"notified_individuals_at" timestamp,
	"notified_hhs_at" timestamp,
	"notified_media_at" timestamp,
	"remediation_steps" text,
	"status" varchar DEFAULT 'open',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "claim_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"cpt_code_id" integer NOT NULL,
	"icd10_code_id" integer,
	"units" integer DEFAULT 1 NOT NULL,
	"rate" numeric(10, 2) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"date_of_service" date,
	"modifier" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "claim_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"claim_id" integer,
	"cpt_code" varchar NOT NULL,
	"insurance_provider" varchar NOT NULL,
	"insurance_plan_type" varchar,
	"zip_code" varchar,
	"billed_amount" numeric(10, 2) NOT NULL,
	"provider_credential" varchar,
	"service_date" date NOT NULL,
	"network_status" varchar DEFAULT 'out_of_network',
	"allowed_amount" numeric(10, 2),
	"paid_amount" numeric(10, 2),
	"patient_responsibility" numeric(10, 2),
	"coinsurance_applied" numeric(5, 2),
	"deductible_applied" numeric(10, 2),
	"denial_reason" text,
	"adjustment_reason_code" varchar,
	"days_to_payment" integer,
	"submission_date" timestamp,
	"payment_date" timestamp,
	"is_training_data" boolean DEFAULT true,
	"prediction_accuracy" numeric(5, 4),
	"predicted_allowed_amount" numeric(10, 2),
	"predicted_reimbursement" numeric(10, 2),
	"prediction_confidence" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"session_id" integer,
	"claim_number" varchar,
	"insurance_id" integer,
	"total_amount" numeric(10, 2) NOT NULL,
	"submitted_amount" numeric(10, 2),
	"paid_amount" numeric(10, 2),
	"expected_amount" numeric(10, 2),
	"optimized_amount" numeric(10, 2),
	"status" varchar DEFAULT 'draft',
	"submitted_at" timestamp,
	"paid_at" timestamp,
	"denial_reason" text,
	"ai_review_score" numeric(3, 2),
	"ai_review_notes" text,
	"reimbursement_optimization_id" integer,
	"clearinghouse_claim_id" varchar,
	"clearinghouse_status" varchar,
	"clearinghouse_response" jsonb,
	"clearinghouse_submitted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "claims_claim_number_unique" UNIQUE("claim_number")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"therapist_id" varchar,
	"subject" varchar(255),
	"status" varchar DEFAULT 'active',
	"patient_access_token" varchar(64),
	"patient_token_expires_at" timestamp,
	"last_message_at" timestamp,
	"unread_by_therapist" integer DEFAULT 0,
	"unread_by_patient" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "conversations_patient_access_token_unique" UNIQUE("patient_access_token")
);
--> statement-breakpoint
CREATE TABLE "cpt_code_equivalencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"primary_code_id" integer NOT NULL,
	"equivalent_code_id" integer NOT NULL,
	"intervention_category" varchar NOT NULL,
	"clinical_context" text,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cpt_code_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurance_id" integer NOT NULL,
	"original_cpt_code_id" integer NOT NULL,
	"optimized_cpt_code_id" integer NOT NULL,
	"optimization_reason" text,
	"success_rate" numeric(5, 2),
	"average_reimbursement" numeric(10, 2),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cpt_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar NOT NULL,
	"description" text NOT NULL,
	"category" varchar,
	"base_rate" numeric(10, 2),
	"cash_rate" numeric(10, 2),
	"billing_units" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "cpt_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "data_capture_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"session_id" integer,
	"event_type" varchar NOT NULL,
	"original_data" text,
	"extracted_data" jsonb,
	"ai_confidence" numeric(3, 2),
	"processing_status" varchar DEFAULT 'pending',
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "eligibility_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"appointment_id" integer,
	"alert_type" varchar NOT NULL,
	"severity" varchar DEFAULT 'warning',
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"previous_status" jsonb,
	"current_status" jsonb,
	"status" varchar DEFAULT 'open',
	"acknowledged_at" timestamp,
	"acknowledged_by" varchar,
	"resolved_at" timestamp,
	"resolved_by" varchar,
	"resolution_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "eligibility_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"insurance_id" integer,
	"check_date" timestamp DEFAULT now(),
	"status" varchar NOT NULL,
	"coverage_type" varchar,
	"effective_date" date,
	"termination_date" date,
	"copay" numeric(10, 2),
	"deductible" numeric(10, 2),
	"deductible_met" numeric(10, 2),
	"out_of_pocket_max" numeric(10, 2),
	"out_of_pocket_met" numeric(10, 2),
	"coinsurance" integer,
	"visits_allowed" integer,
	"visits_used" integer,
	"auth_required" boolean,
	"raw_response" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exercise_bank" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"exercise_name" varchar NOT NULL,
	"category" varchar NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"created_by" varchar,
	"description" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"category" varchar,
	"expense_date" date NOT NULL,
	"receipt_url" varchar,
	"is_deductible" boolean DEFAULT true,
	"ai_category" varchar,
	"ai_confidence" numeric(3, 2),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "goal_progress_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"session_id" integer,
	"therapist_id" varchar,
	"progress_rating" integer,
	"notes" text NOT NULL,
	"interventions_used" jsonb,
	"homework_assigned" text,
	"next_session_focus" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "google_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"google_review_id" varchar,
	"reviewer_name" varchar,
	"rating" integer,
	"review_text" text,
	"review_date" timestamp,
	"response_status" varchar DEFAULT 'pending',
	"ai_draft_response" text,
	"final_response" text,
	"responded_at" timestamp,
	"responded_by" varchar,
	"sentiment" varchar,
	"tags" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "icd10_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar NOT NULL,
	"description" text NOT NULL,
	"category" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "icd10_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "insurance_billing_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurance_id" integer NOT NULL,
	"max_total_units_per_visit" integer,
	"preferred_code_combinations" jsonb,
	"avoid_code_combinations" jsonb,
	"billing_guidelines" text,
	"reimbursement_tier" varchar,
	"average_reimbursement_rate" numeric(5, 2),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "insurance_billing_preferences_insurance_id_unique" UNIQUE("insurance_id")
);
--> statement-breakpoint
CREATE TABLE "insurance_billing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurance_id" integer NOT NULL,
	"cpt_code_id" integer,
	"max_units_per_visit" integer,
	"max_units_per_day" integer,
	"max_units_per_week" integer,
	"requires_modifier" varchar,
	"cannot_bill_with" jsonb,
	"requires_prior_auth" boolean DEFAULT false,
	"requires_medical_necessity" boolean DEFAULT true,
	"requires_different_codes_per_unit" boolean DEFAULT false,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "insurance_data_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"authorization_id" integer NOT NULL,
	"payer_integration_id" integer,
	"data_type" varchar NOT NULL,
	"raw_response" jsonb,
	"normalized_data" jsonb,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"error_code" varchar,
	"fetched_at" timestamp,
	"expires_at" timestamp,
	"is_stale" boolean DEFAULT false,
	"refresh_attempts" integer DEFAULT 0,
	"last_refresh_attempt" timestamp,
	"request_id" varchar,
	"response_time_ms" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "insurance_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurance_provider" varchar(100) NOT NULL,
	"cpt_code" varchar(10) NOT NULL,
	"in_network_rate" numeric(8, 2),
	"out_of_network_rate" numeric(8, 2),
	"deductible_applies" boolean DEFAULT true,
	"coinsurance_percent" numeric(5, 2) DEFAULT '20.00',
	"copay_amount" numeric(6, 2),
	"reimbursement_rank" integer,
	"effective_date" date,
	"termination_date" date,
	"source_document" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "insurances" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"payer_code" varchar,
	"eligibility_api_config" jsonb,
	"claim_submission_config" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "insurances_payer_code_unique" UNIQUE("payer_code")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"email" varchar NOT NULL,
	"role" varchar DEFAULT 'therapist',
	"token" varchar NOT NULL,
	"invited_by_id" varchar NOT NULL,
	"status" varchar DEFAULT 'pending',
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer,
	"patient_id" integer,
	"invoice_number" varchar,
	"amount" numeric(10, 2) NOT NULL,
	"status" varchar DEFAULT 'draft',
	"due_date" date,
	"paid_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "message_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"recipient_type" varchar NOT NULL,
	"recipient_id" varchar,
	"notification_type" varchar NOT NULL,
	"status" varchar DEFAULT 'pending',
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"sender_id" varchar,
	"sender_type" varchar NOT NULL,
	"sender_name" varchar,
	"content" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"read_at" timestamp,
	"read_by_recipient" boolean DEFAULT false,
	"delivered_at" timestamp,
	"contains_phi" boolean DEFAULT true,
	"deleted_at" timestamp,
	"deleted_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "online_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"appointment_id" integer,
	"appointment_type_id" integer,
	"therapist_id" varchar,
	"patient_id" integer,
	"guest_first_name" varchar,
	"guest_last_name" varchar,
	"guest_email" varchar,
	"guest_phone" varchar,
	"requested_date" date NOT NULL,
	"requested_time" varchar NOT NULL,
	"status" varchar DEFAULT 'pending',
	"is_new_patient" boolean DEFAULT false,
	"notes" text,
	"confirmation_code" varchar,
	"confirmed_at" timestamp,
	"cancelled_at" timestamp,
	"cancellation_reason" text,
	"reminder_sent" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "online_bookings_confirmation_code_unique" UNIQUE("confirmation_code")
);
--> statement-breakpoint
CREATE TABLE "outcome_measure_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer,
	"name" varchar(255) NOT NULL,
	"short_name" varchar(50),
	"description" text,
	"category" varchar,
	"questions" jsonb NOT NULL,
	"scoring_method" varchar,
	"scoring_ranges" jsonb,
	"max_score" integer,
	"clinical_cutoff" integer,
	"reliable_change_index" numeric(5, 2),
	"mcid" integer,
	"recommended_frequency" varchar,
	"is_active" boolean DEFAULT true,
	"is_system_template" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "patient_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"session_id" integer,
	"treatment_plan_id" integer,
	"assessment_type" varchar DEFAULT 'routine',
	"administered_by" varchar,
	"administered_at" timestamp DEFAULT now(),
	"responses" jsonb NOT NULL,
	"total_score" integer,
	"subscale_scores" jsonb,
	"severity" varchar,
	"interpretation" text,
	"previous_score" integer,
	"score_change" integer,
	"is_reliable_change" boolean,
	"is_clinically_significant" boolean,
	"clinician_notes" text,
	"patient_feedback" text,
	"status" varchar DEFAULT 'completed',
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "patient_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"consent_type" varchar NOT NULL,
	"purpose_of_disclosure" text NOT NULL,
	"information_to_be_disclosed" text NOT NULL,
	"recipient_of_information" text NOT NULL,
	"effective_date" date NOT NULL,
	"expiration_date" date,
	"signature_type" varchar DEFAULT 'electronic',
	"signature_name" varchar NOT NULL,
	"signature_date" timestamp NOT NULL,
	"signature_ip_address" varchar,
	"signer_relationship" varchar,
	"signer_name" varchar,
	"is_revoked" boolean DEFAULT false,
	"revoked_date" timestamp,
	"revoked_by" varchar,
	"revocation_reason" text,
	"consent_version" varchar DEFAULT '1.0',
	"witness_name" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "patient_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"uploaded_by_id" varchar,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar DEFAULT 'general',
	"file_url" varchar NOT NULL,
	"file_type" varchar,
	"file_size" integer,
	"visible_to_patient" boolean DEFAULT true,
	"requires_signature" boolean DEFAULT false,
	"signed_at" timestamp,
	"signature_data" text,
	"viewed_at" timestamp,
	"downloaded_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "patient_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"review_request_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"feedback_text" text,
	"service_rating" integer,
	"staff_rating" integer,
	"facility_rating" integer,
	"would_recommend" boolean,
	"sentiment" varchar,
	"is_addressed" boolean DEFAULT false,
	"addressed_at" timestamp,
	"addressed_by" varchar,
	"address_notes" text,
	"google_post_requested" boolean DEFAULT false,
	"google_post_requested_at" timestamp,
	"posted_to_google" boolean DEFAULT false,
	"posted_to_google_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "patient_insurance_authorizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"requested_by_id" varchar NOT NULL,
	"token" varchar(64) NOT NULL,
	"token_expires_at" timestamp NOT NULL,
	"token_used_at" timestamp,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"scopes" jsonb DEFAULT '["eligibility"]'::jsonb NOT NULL,
	"delivery_method" varchar DEFAULT 'email' NOT NULL,
	"delivery_email" varchar,
	"delivery_phone" varchar,
	"consent_given_at" timestamp,
	"consent_ip_address" varchar,
	"consent_user_agent" text,
	"consent_signature" text,
	"resend_count" integer DEFAULT 0,
	"last_resend_at" timestamp,
	"link_attempt_count" integer DEFAULT 0,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"revoked_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "patient_insurance_authorizations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "patient_payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"type" varchar NOT NULL,
	"stripe_payment_method_id" varchar,
	"card_brand" varchar,
	"card_last4" varchar(4),
	"card_exp_month" integer,
	"card_exp_year" integer,
	"bank_name" varchar,
	"bank_last4" varchar(4),
	"bank_account_type" varchar,
	"billing_name" varchar(255),
	"billing_address" text,
	"billing_city" varchar,
	"billing_state" varchar,
	"billing_zip" varchar,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"is_verified" boolean DEFAULT false,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "patient_plan_benefits" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"document_id" integer,
	"plan_name" varchar,
	"plan_type" varchar,
	"insurance_provider" varchar,
	"group_number" varchar,
	"policy_number" varchar,
	"effective_date" date,
	"termination_date" date,
	"oon_deductible_individual" numeric(10, 2),
	"oon_deductible_family" numeric(10, 2),
	"oon_deductible_met" numeric(10, 2),
	"oon_coinsurance_percent" numeric(5, 2),
	"oon_out_of_pocket_max" numeric(10, 2),
	"oon_out_of_pocket_met" numeric(10, 2),
	"allowed_amount_method" varchar,
	"allowed_amount_percent" numeric(5, 2),
	"allowed_amount_source" varchar,
	"mental_health_parity" boolean,
	"mental_health_visit_limit" integer,
	"mental_health_visits_used" integer,
	"mental_health_prior_auth_required" boolean,
	"mental_health_copay" numeric(10, 2),
	"inn_deductible_individual" numeric(10, 2),
	"inn_coinsurance_percent" numeric(5, 2),
	"inn_out_of_pocket_max" numeric(10, 2),
	"telehealth_covered" boolean,
	"telehealth_oon_same_as_in_person" boolean,
	"raw_extracted_data" jsonb,
	"extraction_confidence" numeric(3, 2),
	"is_active" boolean DEFAULT true,
	"verified_by" varchar,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "patient_plan_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"document_type" varchar NOT NULL,
	"file_name" varchar NOT NULL,
	"file_url" varchar NOT NULL,
	"file_size" integer,
	"mime_type" varchar,
	"status" varchar DEFAULT 'pending',
	"parsed_at" timestamp,
	"parse_error" text,
	"patient_consent_given" boolean DEFAULT false,
	"consent_date" timestamp,
	"consent_method" varchar,
	"uploaded_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "patient_portal_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"portal_token" varchar(64) NOT NULL,
	"portal_token_expires_at" timestamp NOT NULL,
	"magic_link_token" varchar(64),
	"magic_link_expires_at" timestamp,
	"magic_link_used_at" timestamp,
	"is_active" boolean DEFAULT true,
	"last_accessed_at" timestamp,
	"access_count" integer DEFAULT 0,
	"can_view_appointments" boolean DEFAULT true,
	"can_view_statements" boolean DEFAULT true,
	"can_view_documents" boolean DEFAULT true,
	"can_send_messages" boolean DEFAULT true,
	"can_update_profile" boolean DEFAULT true,
	"can_complete_intake" boolean DEFAULT true,
	"has_payment_method" boolean DEFAULT false,
	"stripe_customer_id" varchar,
	"stripe_payment_method_id" varchar,
	"intake_completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "patient_portal_access_portal_token_unique" UNIQUE("portal_token"),
	CONSTRAINT "patient_portal_access_magic_link_token_unique" UNIQUE("magic_link_token")
);
--> statement-breakpoint
CREATE TABLE "patient_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"statement_number" varchar NOT NULL,
	"statement_date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp,
	"total_amount" numeric(10, 2) NOT NULL,
	"paid_amount" numeric(10, 2) DEFAULT '0',
	"balance_due" numeric(10, 2) NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb,
	"status" varchar DEFAULT 'pending',
	"sent_via" varchar,
	"sent_at" timestamp,
	"viewed_at" timestamp,
	"payment_method" varchar,
	"payment_date" timestamp,
	"payment_reference" varchar,
	"pdf_url" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "patient_statements_statement_number_unique" UNIQUE("statement_number")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"first_name" varchar NOT NULL,
	"last_name" varchar NOT NULL,
	"date_of_birth" date,
	"email" varchar,
	"phone" varchar,
	"address" text,
	"insurance_provider" varchar,
	"insurance_id" varchar,
	"policy_number" varchar,
	"group_number" varchar,
	"phone_type" varchar DEFAULT 'mobile',
	"preferred_contact_method" varchar DEFAULT 'email',
	"sms_consent_given" boolean DEFAULT false,
	"sms_consent_date" timestamp,
	"intake_data" jsonb,
	"intake_completed_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payer_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"payer_integration_id" integer NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"credentials_iv" varchar(32) NOT NULL,
	"credentials_tag" varchar(32) NOT NULL,
	"credential_type" varchar NOT NULL,
	"last_rotated" timestamp,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true,
	"last_used" timestamp,
	"last_error" text,
	"error_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payer_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"payer_name" varchar NOT NULL,
	"payer_code" varchar NOT NULL,
	"api_type" varchar NOT NULL,
	"api_version" varchar,
	"base_url" varchar NOT NULL,
	"auth_endpoint" varchar,
	"eligibility_endpoint" varchar,
	"benefits_endpoint" varchar,
	"claims_history_endpoint" varchar,
	"prior_auth_endpoint" varchar,
	"auth_method" varchar NOT NULL,
	"auth_config" jsonb,
	"supports_eligibility" boolean DEFAULT true,
	"supports_benefits" boolean DEFAULT false,
	"supports_claims_history" boolean DEFAULT false,
	"supports_prior_auth" boolean DEFAULT false,
	"supports_realtime" boolean DEFAULT false,
	"rate_limit_per_minute" integer DEFAULT 60,
	"rate_limit_per_day" integer DEFAULT 1000,
	"is_active" boolean DEFAULT true,
	"last_health_check" timestamp,
	"health_status" varchar DEFAULT 'unknown',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "payer_integrations_payer_code_unique" UNIQUE("payer_code")
);
--> statement-breakpoint
CREATE TABLE "payment_plan_installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_plan_id" integer NOT NULL,
	"transaction_id" integer,
	"installment_number" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"due_date" date NOT NULL,
	"status" varchar DEFAULT 'scheduled',
	"paid_at" timestamp,
	"failed_at" timestamp,
	"failure_reason" text,
	"retry_count" integer DEFAULT 0,
	"next_retry_at" timestamp,
	"reminder_sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"payment_method_id" integer,
	"name" varchar(255),
	"total_amount" numeric(10, 2) NOT NULL,
	"remaining_amount" numeric(10, 2) NOT NULL,
	"installment_amount" numeric(10, 2) NOT NULL,
	"number_of_installments" integer NOT NULL,
	"completed_installments" integer DEFAULT 0,
	"frequency" varchar NOT NULL,
	"start_date" date NOT NULL,
	"next_payment_date" date,
	"end_date" date,
	"auto_pay_enabled" boolean DEFAULT true,
	"auto_pay_day_of_month" integer,
	"status" varchar DEFAULT 'active',
	"paused_at" timestamp,
	"pause_reason" text,
	"interest_rate" numeric(5, 2) DEFAULT '0',
	"late_fee" numeric(10, 2),
	"agreement_signed_at" timestamp,
	"agreement_signature" text,
	"terms" text,
	"notes" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"payment_method_id" integer,
	"claim_id" integer,
	"statement_id" integer,
	"appointment_id" integer,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD',
	"type" varchar NOT NULL,
	"category" varchar,
	"description" text,
	"processor" varchar,
	"processor_transaction_id" varchar,
	"processor_fee" numeric(10, 2),
	"status" varchar DEFAULT 'pending',
	"failure_reason" text,
	"processed_at" timestamp,
	"settled_at" timestamp,
	"check_number" varchar,
	"reference_number" varchar,
	"receipt_sent" boolean DEFAULT false,
	"receipt_sent_at" timestamp,
	"receipt_email" varchar,
	"created_by" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer,
	"claim_id" integer,
	"amount" numeric(10, 2) NOT NULL,
	"payment_method" varchar,
	"payment_type" varchar,
	"payment_date" date NOT NULL,
	"transaction_id" varchar,
	"reference_number" varchar,
	"notes" text,
	"status" varchar DEFAULT 'completed',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "practice_payment_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"stripe_account_id" varchar,
	"stripe_publishable_key" varchar,
	"stripe_secret_key_encrypted" text,
	"stripe_webhook_secret" text,
	"accept_cards" boolean DEFAULT true,
	"accept_bank_transfers" boolean DEFAULT false,
	"accept_hsa" boolean DEFAULT true,
	"accept_cash" boolean DEFAULT true,
	"accept_checks" boolean DEFAULT true,
	"auto_collect_copay" boolean DEFAULT false,
	"auto_collect_balance" boolean DEFAULT false,
	"auto_collect_days_after_service" integer DEFAULT 30,
	"allow_payment_plans" boolean DEFAULT true,
	"min_payment_plan_amount" numeric(10, 2) DEFAULT '100',
	"max_payment_plan_months" integer DEFAULT 12,
	"auto_send_receipts" boolean DEFAULT true,
	"receipt_email_template" text,
	"display_prices_on_portal" boolean DEFAULT true,
	"require_payment_at_booking" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "practice_payment_settings_practice_id_unique" UNIQUE("practice_id")
);
--> statement-breakpoint
CREATE TABLE "practices" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"npi" varchar,
	"tax_id" varchar,
	"address" text,
	"phone" varchar,
	"email" varchar,
	"brand_logo_url" varchar,
	"brand_primary_color" varchar DEFAULT '#2563eb',
	"brand_secondary_color" varchar DEFAULT '#1e40af',
	"brand_email_from_name" varchar,
	"brand_email_reply_to" varchar,
	"brand_website_url" varchar,
	"brand_privacy_policy_url" varchar,
	"google_review_url" varchar,
	"monthly_claims_volume" integer,
	"professional_license" varchar,
	"license_expiration" date,
	"business_license" varchar,
	"caqh_profile_id" varchar,
	"insurance_certificate_status" varchar,
	"w9_form_status" varchar,
	"it_contact_name" varchar,
	"it_contact_email" varchar,
	"it_contact_phone" varchar,
	"billing_contact_name" varchar,
	"billing_contact_email" varchar,
	"billing_contact_phone" varchar,
	"edi_enrollment_status" varchar,
	"optum_submitter_id" varchar,
	"optum_receiver_id" varchar,
	"last_enrollment_check" timestamp,
	"stripe_customer_id" varchar,
	"stripe_payment_method_id" varchar,
	"billing_plan" varchar DEFAULT 'growing',
	"billing_percentage" numeric(5, 2) DEFAULT '4.5',
	"trial_ends_at" timestamp,
	"stedi_api_key" varchar,
	"stedi_partner_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "practices_npi_unique" UNIQUE("npi")
);
--> statement-breakpoint
CREATE TABLE "referral_communications" (
	"id" serial PRIMARY KEY NOT NULL,
	"referral_id" integer NOT NULL,
	"type" varchar NOT NULL,
	"direction" varchar NOT NULL,
	"subject" varchar(255),
	"content" text,
	"sent_at" timestamp,
	"received_at" timestamp,
	"sent_by" varchar,
	"attachments" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "referral_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"type" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"organization" varchar(255),
	"specialty" varchar(100),
	"email" varchar,
	"phone" varchar,
	"fax" varchar,
	"address" text,
	"npi" varchar(10),
	"credentials" varchar(50),
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer,
	"direction" varchar NOT NULL,
	"referral_source_id" integer,
	"external_provider_name" varchar(255),
	"external_provider_org" varchar(255),
	"external_provider_phone" varchar,
	"external_provider_fax" varchar,
	"external_provider_email" varchar,
	"referral_date" date NOT NULL,
	"received_date" date,
	"reason" text NOT NULL,
	"diagnosis_codes" jsonb,
	"urgency" varchar DEFAULT 'routine',
	"status" varchar DEFAULT 'pending',
	"status_updated_at" timestamp,
	"status_updated_by" varchar,
	"referred_to_specialty" varchar,
	"referral_letter_sent" boolean DEFAULT false,
	"referral_letter_sent_at" timestamp,
	"first_contact_date" date,
	"first_appointment_date" date,
	"appointment_id" integer,
	"authorization_required" boolean DEFAULT false,
	"authorization_number" varchar,
	"authorization_status" varchar,
	"follow_up_required" boolean DEFAULT false,
	"follow_up_date" date,
	"follow_up_completed" boolean DEFAULT false,
	"follow_up_notes" text,
	"notes" text,
	"internal_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reimbursement_benchmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"cpt_code_id" integer NOT NULL,
	"insurance_id" integer NOT NULL,
	"average_reimbursement" numeric(10, 2) NOT NULL,
	"max_reimbursement" numeric(10, 2) NOT NULL,
	"min_reimbursement" numeric(10, 2) NOT NULL,
	"sample_size" integer NOT NULL,
	"last_updated" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reimbursement_optimizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"claim_id" integer,
	"original_amount" numeric(10, 2) NOT NULL,
	"optimized_amount" numeric(10, 2) NOT NULL,
	"improvement_amount" numeric(10, 2) NOT NULL,
	"our_share_amount" numeric(10, 2) NOT NULL,
	"optimization_type" varchar,
	"optimization_notes" text,
	"status" varchar DEFAULT 'pending',
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"appointment_id" integer,
	"feedback_token" varchar,
	"status" varchar DEFAULT 'pending',
	"sent_via" varchar,
	"email_sent" boolean DEFAULT false,
	"sms_sent" boolean DEFAULT false,
	"sent_at" timestamp,
	"clicked_at" timestamp,
	"feedback_received_at" timestamp,
	"google_request_sent_at" timestamp,
	"reviewed_at" timestamp,
	"declined_at" timestamp,
	"decline_reason" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "review_requests_feedback_token_unique" UNIQUE("feedback_token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soap_note_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer,
	"therapist_id" varchar,
	"draft_name" varchar,
	"form_data" jsonb,
	"caregiver_dropdown_state" jsonb,
	"ot_interventions" jsonb,
	"ai_optimization" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "soap_note_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer,
	"title" varchar,
	"section" varchar,
	"content" text,
	"category" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "soap_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"subjective" text NOT NULL,
	"objective" text NOT NULL,
	"assessment" text NOT NULL,
	"plan" text NOT NULL,
	"location" varchar,
	"session_type" varchar DEFAULT 'individual',
	"interventions" jsonb,
	"progress_notes" text,
	"home_program" text,
	"ai_suggested_cpt_codes" jsonb,
	"original_cpt_code_id" integer,
	"optimized_cpt_code_id" integer,
	"cpt_optimization_reason" text,
	"data_source" varchar DEFAULT 'manual',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "telehealth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"appointment_id" integer NOT NULL,
	"patient_id" integer,
	"therapist_id" varchar,
	"room_name" varchar NOT NULL,
	"room_url" varchar,
	"host_url" varchar,
	"patient_access_code" varchar,
	"status" varchar DEFAULT 'scheduled',
	"scheduled_start" timestamp NOT NULL,
	"scheduled_end" timestamp NOT NULL,
	"actual_start" timestamp,
	"actual_end" timestamp,
	"patient_joined_at" timestamp,
	"therapist_joined_at" timestamp,
	"duration" integer,
	"recording_enabled" boolean DEFAULT false,
	"recording_url" varchar,
	"recording_consent" boolean DEFAULT false,
	"waiting_room_enabled" boolean DEFAULT true,
	"notes" text,
	"technical_issues" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "telehealth_sessions_room_name_unique" UNIQUE("room_name")
);
--> statement-breakpoint
CREATE TABLE "telehealth_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"is_enabled" boolean DEFAULT true,
	"provider" varchar DEFAULT 'built_in',
	"provider_api_key" varchar,
	"provider_api_secret" varchar,
	"default_waiting_room_enabled" boolean DEFAULT true,
	"default_recording_enabled" boolean DEFAULT false,
	"require_recording_consent" boolean DEFAULT true,
	"auto_create_rooms" boolean DEFAULT true,
	"send_join_reminder" boolean DEFAULT true,
	"join_reminder_minutes" integer DEFAULT 15,
	"max_session_duration" integer DEFAULT 120,
	"welcome_message" text,
	"waiting_room_message" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "telehealth_settings_practice_id_unique" UNIQUE("practice_id")
);
--> statement-breakpoint
CREATE TABLE "therapist_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"therapist_id" varchar NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" varchar NOT NULL,
	"end_time" varchar NOT NULL,
	"is_available" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "therapist_time_off" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"therapist_id" varchar NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "therapy_bank" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"therapy_name" varchar NOT NULL,
	"category" varchar,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "treatment_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"treatment_plan_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"goal_number" integer NOT NULL,
	"category" varchar,
	"description" text NOT NULL,
	"target_date" date,
	"status" varchar DEFAULT 'in_progress',
	"progress_percentage" integer DEFAULT 0,
	"baseline_measure" text,
	"target_measure" text,
	"current_measure" text,
	"achieved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "treatment_interventions" (
	"id" serial PRIMARY KEY NOT NULL,
	"treatment_plan_id" integer NOT NULL,
	"goal_id" integer,
	"name" varchar(255) NOT NULL,
	"description" text,
	"frequency" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "treatment_objectives" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"treatment_plan_id" integer NOT NULL,
	"objective_number" integer NOT NULL,
	"description" text NOT NULL,
	"measurement_method" text,
	"target_date" date,
	"status" varchar DEFAULT 'in_progress',
	"progress_notes" text,
	"achieved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"practice_id" integer NOT NULL,
	"therapist_id" varchar,
	"title" varchar(255) NOT NULL,
	"diagnosis" text,
	"diagnosis_codes" jsonb,
	"clinical_summary" text,
	"treatment_modality" varchar,
	"frequency" varchar,
	"estimated_duration" varchar,
	"status" varchar DEFAULT 'active',
	"start_date" date,
	"target_end_date" date,
	"actual_end_date" date,
	"next_review_date" date,
	"last_reviewed_at" timestamp,
	"last_reviewed_by" varchar,
	"patient_signature" text,
	"patient_signed_at" timestamp,
	"therapist_signature" text,
	"therapist_signed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "treatment_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"therapist_id" varchar NOT NULL,
	"session_date" date NOT NULL,
	"duration" integer,
	"cpt_code_id" integer NOT NULL,
	"icd10_code_id" integer,
	"units" integer DEFAULT 1,
	"notes" text,
	"status" varchar DEFAULT 'completed',
	"data_source" varchar DEFAULT 'manual',
	"voice_transcription_url" text,
	"uploaded_document_url" text,
	"original_document_text" text,
	"ai_extracted_data" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"practice_id" integer,
	"role" varchar DEFAULT 'therapist',
	"mfa_enabled" boolean DEFAULT false,
	"mfa_secret" jsonb,
	"mfa_backup_codes" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"therapist_id" varchar,
	"preferred_days" jsonb,
	"preferred_time_start" varchar,
	"preferred_time_end" varchar,
	"priority" integer DEFAULT 1,
	"status" varchar DEFAULT 'waiting',
	"reason" text,
	"notes" text,
	"notified_at" timestamp,
	"notified_slot" jsonb,
	"scheduled_appointment_id" integer,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "amendment_requests" ADD CONSTRAINT "amendment_requests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_requests" ADD CONSTRAINT "amendment_requests_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_requests" ADD CONSTRAINT "amendment_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_requests" ADD CONSTRAINT "amendment_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_appointment_type_id_appointment_types_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_processed_by_id_users_id_fk" FOREIGN KEY ("processed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_schedules" ADD CONSTRAINT "assessment_schedules_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_schedules" ADD CONSTRAINT "assessment_schedules_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_schedules" ADD CONSTRAINT "assessment_schedules_template_id_outcome_measure_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."outcome_measure_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_audit_log" ADD CONSTRAINT "authorization_audit_log_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_audit_log" ADD CONSTRAINT "authorization_audit_log_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_audit_log" ADD CONSTRAINT "authorization_audit_log_authorization_id_patient_insurance_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."patient_insurance_authorizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baa_records" ADD CONSTRAINT "baa_records_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_incidents" ADD CONSTRAINT "breach_incidents_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_incidents" ADD CONSTRAINT "breach_incidents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_line_items" ADD CONSTRAINT "claim_line_items_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_line_items" ADD CONSTRAINT "claim_line_items_cpt_code_id_cpt_codes_id_fk" FOREIGN KEY ("cpt_code_id") REFERENCES "public"."cpt_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_line_items" ADD CONSTRAINT "claim_line_items_icd10_code_id_icd10_codes_id_fk" FOREIGN KEY ("icd10_code_id") REFERENCES "public"."icd10_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_session_id_treatment_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."treatment_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_insurance_id_insurances_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpt_code_equivalencies" ADD CONSTRAINT "cpt_code_equivalencies_primary_code_id_cpt_codes_id_fk" FOREIGN KEY ("primary_code_id") REFERENCES "public"."cpt_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpt_code_equivalencies" ADD CONSTRAINT "cpt_code_equivalencies_equivalent_code_id_cpt_codes_id_fk" FOREIGN KEY ("equivalent_code_id") REFERENCES "public"."cpt_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpt_code_mappings" ADD CONSTRAINT "cpt_code_mappings_insurance_id_insurances_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpt_code_mappings" ADD CONSTRAINT "cpt_code_mappings_original_cpt_code_id_cpt_codes_id_fk" FOREIGN KEY ("original_cpt_code_id") REFERENCES "public"."cpt_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpt_code_mappings" ADD CONSTRAINT "cpt_code_mappings_optimized_cpt_code_id_cpt_codes_id_fk" FOREIGN KEY ("optimized_cpt_code_id") REFERENCES "public"."cpt_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_capture_events" ADD CONSTRAINT "data_capture_events_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_capture_events" ADD CONSTRAINT "data_capture_events_session_id_treatment_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."treatment_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_alerts" ADD CONSTRAINT "eligibility_alerts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_alerts" ADD CONSTRAINT "eligibility_alerts_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_alerts" ADD CONSTRAINT "eligibility_alerts_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_alerts" ADD CONSTRAINT "eligibility_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_alerts" ADD CONSTRAINT "eligibility_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_checks" ADD CONSTRAINT "eligibility_checks_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_checks" ADD CONSTRAINT "eligibility_checks_insurance_id_insurances_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_bank" ADD CONSTRAINT "exercise_bank_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_bank" ADD CONSTRAINT "exercise_bank_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_progress_notes" ADD CONSTRAINT "goal_progress_notes_goal_id_treatment_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."treatment_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_progress_notes" ADD CONSTRAINT "goal_progress_notes_session_id_treatment_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."treatment_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_progress_notes" ADD CONSTRAINT "goal_progress_notes_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_reviews" ADD CONSTRAINT "google_reviews_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_reviews" ADD CONSTRAINT "google_reviews_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_billing_preferences" ADD CONSTRAINT "insurance_billing_preferences_insurance_id_insurances_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_billing_rules" ADD CONSTRAINT "insurance_billing_rules_insurance_id_insurances_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_billing_rules" ADD CONSTRAINT "insurance_billing_rules_cpt_code_id_cpt_codes_id_fk" FOREIGN KEY ("cpt_code_id") REFERENCES "public"."cpt_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_data_cache" ADD CONSTRAINT "insurance_data_cache_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_data_cache" ADD CONSTRAINT "insurance_data_cache_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_data_cache" ADD CONSTRAINT "insurance_data_cache_authorization_id_patient_insurance_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."patient_insurance_authorizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_data_cache" ADD CONSTRAINT "insurance_data_cache_payer_integration_id_payer_integrations_id_fk" FOREIGN KEY ("payer_integration_id") REFERENCES "public"."payer_integrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_notifications" ADD CONSTRAINT "message_notifications_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD CONSTRAINT "online_bookings_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD CONSTRAINT "online_bookings_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD CONSTRAINT "online_bookings_appointment_type_id_appointment_types_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD CONSTRAINT "online_bookings_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD CONSTRAINT "online_bookings_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_measure_templates" ADD CONSTRAINT "outcome_measure_templates_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_assessments" ADD CONSTRAINT "patient_assessments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_assessments" ADD CONSTRAINT "patient_assessments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_assessments" ADD CONSTRAINT "patient_assessments_template_id_outcome_measure_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."outcome_measure_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_assessments" ADD CONSTRAINT "patient_assessments_session_id_treatment_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."treatment_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_assessments" ADD CONSTRAINT "patient_assessments_treatment_plan_id_treatment_plans_id_fk" FOREIGN KEY ("treatment_plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_assessments" ADD CONSTRAINT "patient_assessments_administered_by_users_id_fk" FOREIGN KEY ("administered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_feedback" ADD CONSTRAINT "patient_feedback_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_feedback" ADD CONSTRAINT "patient_feedback_review_request_id_review_requests_id_fk" FOREIGN KEY ("review_request_id") REFERENCES "public"."review_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_feedback" ADD CONSTRAINT "patient_feedback_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_feedback" ADD CONSTRAINT "patient_feedback_addressed_by_users_id_fk" FOREIGN KEY ("addressed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_insurance_authorizations" ADD CONSTRAINT "patient_insurance_authorizations_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_insurance_authorizations" ADD CONSTRAINT "patient_insurance_authorizations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_insurance_authorizations" ADD CONSTRAINT "patient_insurance_authorizations_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_payment_methods" ADD CONSTRAINT "patient_payment_methods_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_payment_methods" ADD CONSTRAINT "patient_payment_methods_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_plan_benefits" ADD CONSTRAINT "patient_plan_benefits_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_plan_benefits" ADD CONSTRAINT "patient_plan_benefits_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_plan_benefits" ADD CONSTRAINT "patient_plan_benefits_document_id_patient_plan_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."patient_plan_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_plan_benefits" ADD CONSTRAINT "patient_plan_benefits_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_plan_documents" ADD CONSTRAINT "patient_plan_documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_plan_documents" ADD CONSTRAINT "patient_plan_documents_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_plan_documents" ADD CONSTRAINT "patient_plan_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_portal_access" ADD CONSTRAINT "patient_portal_access_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_portal_access" ADD CONSTRAINT "patient_portal_access_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_statements" ADD CONSTRAINT "patient_statements_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_statements" ADD CONSTRAINT "patient_statements_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_credentials" ADD CONSTRAINT "payer_credentials_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_credentials" ADD CONSTRAINT "payer_credentials_payer_integration_id_payer_integrations_id_fk" FOREIGN KEY ("payer_integration_id") REFERENCES "public"."payer_integrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_installments" ADD CONSTRAINT "payment_plan_installments_payment_plan_id_payment_plans_id_fk" FOREIGN KEY ("payment_plan_id") REFERENCES "public"."payment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_installments" ADD CONSTRAINT "payment_plan_installments_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_payment_method_id_patient_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."patient_payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_method_id_patient_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."patient_payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_statement_id_patient_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."patient_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_payment_settings" ADD CONSTRAINT "practice_payment_settings_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_communications" ADD CONSTRAINT "referral_communications_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_communications" ADD CONSTRAINT "referral_communications_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_sources" ADD CONSTRAINT "referral_sources_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referral_source_id_referral_sources_id_fk" FOREIGN KEY ("referral_source_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_status_updated_by_users_id_fk" FOREIGN KEY ("status_updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_benchmarks" ADD CONSTRAINT "reimbursement_benchmarks_cpt_code_id_cpt_codes_id_fk" FOREIGN KEY ("cpt_code_id") REFERENCES "public"."cpt_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_benchmarks" ADD CONSTRAINT "reimbursement_benchmarks_insurance_id_insurances_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_optimizations" ADD CONSTRAINT "reimbursement_optimizations_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_note_drafts" ADD CONSTRAINT "soap_note_drafts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_note_templates" ADD CONSTRAINT "soap_note_templates_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD CONSTRAINT "soap_notes_session_id_treatment_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."treatment_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD CONSTRAINT "soap_notes_original_cpt_code_id_cpt_codes_id_fk" FOREIGN KEY ("original_cpt_code_id") REFERENCES "public"."cpt_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD CONSTRAINT "soap_notes_optimized_cpt_code_id_cpt_codes_id_fk" FOREIGN KEY ("optimized_cpt_code_id") REFERENCES "public"."cpt_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telehealth_settings" ADD CONSTRAINT "telehealth_settings_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "therapist_availability" ADD CONSTRAINT "therapist_availability_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "therapist_availability" ADD CONSTRAINT "therapist_availability_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "therapist_time_off" ADD CONSTRAINT "therapist_time_off_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "therapist_time_off" ADD CONSTRAINT "therapist_time_off_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "therapy_bank" ADD CONSTRAINT "therapy_bank_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "therapy_bank" ADD CONSTRAINT "therapy_bank_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_goals" ADD CONSTRAINT "treatment_goals_treatment_plan_id_treatment_plans_id_fk" FOREIGN KEY ("treatment_plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_goals" ADD CONSTRAINT "treatment_goals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_goals" ADD CONSTRAINT "treatment_goals_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_interventions" ADD CONSTRAINT "treatment_interventions_treatment_plan_id_treatment_plans_id_fk" FOREIGN KEY ("treatment_plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_interventions" ADD CONSTRAINT "treatment_interventions_goal_id_treatment_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."treatment_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_objectives" ADD CONSTRAINT "treatment_objectives_goal_id_treatment_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."treatment_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_objectives" ADD CONSTRAINT "treatment_objectives_treatment_plan_id_treatment_plans_id_fk" FOREIGN KEY ("treatment_plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_last_reviewed_by_users_id_fk" FOREIGN KEY ("last_reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_sessions" ADD CONSTRAINT "treatment_sessions_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_sessions" ADD CONSTRAINT "treatment_sessions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_sessions" ADD CONSTRAINT "treatment_sessions_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_sessions" ADD CONSTRAINT "treatment_sessions_cpt_code_id_cpt_codes_id_fk" FOREIGN KEY ("cpt_code_id") REFERENCES "public"."cpt_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_sessions" ADD CONSTRAINT "treatment_sessions_icd10_code_id_icd10_codes_id_fk" FOREIGN KEY ("icd10_code_id") REFERENCES "public"."icd10_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_scheduled_appointment_id_appointments_id_fk" FOREIGN KEY ("scheduled_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_practice_patient" ON "authorization_audit_log" USING btree ("practice_id","patient_id");--> statement-breakpoint
CREATE INDEX "idx_audit_authorization" ON "authorization_audit_log" USING btree ("authorization_id");--> statement-breakpoint
CREATE INDEX "idx_audit_event_type" ON "authorization_audit_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_audit_created_at" ON "authorization_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");
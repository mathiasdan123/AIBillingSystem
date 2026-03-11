ALTER TABLE "appointments" ADD COLUMN "recurrence_rule" varchar;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "recurrence_parent_id" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "is_recurring_instance" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD COLUMN "therapist_id" varchar;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD COLUMN "therapist_signature" text;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD COLUMN "therapist_signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD COLUMN "therapist_signed_name" varchar;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD COLUMN "therapist_credentials" varchar;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD COLUMN "signature_ip_address" varchar;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD COLUMN "cosigned_by" varchar;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD COLUMN "cosigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD COLUMN "cosign_status" varchar DEFAULT 'not_required';--> statement-breakpoint
ALTER TABLE "soap_notes" ADD COLUMN "cosign_rejection_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credentials" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "license_number" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "npi_number" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digital_signature" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signature_uploaded_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "supervisor_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "requires_cosign" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_token" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_expires" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lockout_until" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_token" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_expires" timestamp;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD CONSTRAINT "soap_notes_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD CONSTRAINT "soap_notes_cosigned_by_users_id_fk" FOREIGN KEY ("cosigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
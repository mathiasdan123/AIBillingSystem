import { getDb } from "./db";
import { practices, cptCodes, icd10Codes, insurances, patients, users } from "@shared/schema";
import { sql } from "drizzle-orm";
import { hashPassword } from "./services/passwordService";

export async function seedDatabase() {
  try {
    // Wait for database to be ready
    const db = await getDb();

    // Run schema migrations for new columns (safe to run multiple times)
    console.log("Running schema migrations...");

    // Patient table migrations
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_provider VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_id VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS policy_number VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS group_number VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_provider VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_policy_number VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_member_id VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_group_number VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_relationship VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_subscriber_name VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_subscriber_dob DATE`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS phone_type VARCHAR DEFAULT 'mobile'`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS preferred_contact_method VARCHAR DEFAULT 'email'`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS sms_consent_given BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS sms_consent_date TIMESTAMP`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_data JSONB`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);

    // User table migrations
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS credentials VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS license_number VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS npi_number VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS digital_signature TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_uploaded_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_id VARCHAR`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_signature TEXT`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_signed_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_signed_name VARCHAR`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_credentials VARCHAR`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS signature_ip_address VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_provider VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_external_id VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret JSONB`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes JSONB`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS supervisor_id VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS requires_cosign BOOLEAN DEFAULT FALSE`);
    console.log("Schema migrations complete");

    // Always ensure demo user exists
    const existingDemo = await db.execute(sql`SELECT id FROM users WHERE email = 'demo@therapybill.com'`);
    if (!existingDemo.rows || existingDemo.rows.length === 0) {
      console.log("Creating demo user...");
      const practiceResult = await db.execute(sql`SELECT id FROM practices LIMIT 1`);
      if (practiceResult.rows && practiceResult.rows.length > 0) {
        const demoHash = await hashPassword("demo1234");
        await db.insert(users).values({
          id: "demo-user-001",
          email: "demo@therapybill.com",
          firstName: "Demo",
          lastName: "Admin",
          practiceId: parseInt(practiceResult.rows[0].id as string, 10),
          role: "admin",
          passwordHash: demoHash,
          emailVerified: true,
        }).onConflictDoNothing();
        console.log("Demo user created: demo@therapybill.com / demo1234");
      }
    } else {
      // Ensure demo user has admin role
      await db.execute(sql`UPDATE users SET role = 'admin' WHERE email = 'demo@therapybill.com' AND role != 'admin'`);
      console.log("Demo user already exists");
    }

    // Always ensure reviewer user exists
    const existingReviewer = await db.execute(sql`SELECT id FROM users WHERE email = 'reviewer1@demo.com'`);
    if (!existingReviewer.rows || existingReviewer.rows.length === 0) {
      console.log("Creating reviewer user...");
      const practiceResult2 = await db.execute(sql`SELECT id FROM practices LIMIT 1`);
      if (practiceResult2.rows && practiceResult2.rows.length > 0) {
        const reviewerHash = await hashPassword("TherapyDemo2024#");
        await db.insert(users).values({
          id: "reviewer-user-001",
          email: "reviewer1@demo.com",
          firstName: "Reviewer",
          lastName: "Demo",
          practiceId: parseInt(practiceResult2.rows[0].id as string, 10),
          role: "admin",
          passwordHash: reviewerHash,
          emailVerified: true,
        }).onConflictDoNothing();
        console.log("Reviewer user created: reviewer1@demo.com / TherapyDemo2024#");
      }
    } else {
      // Ensure reviewer has admin role and correct practice
      await db.execute(sql`UPDATE users SET role = 'admin' WHERE email = 'reviewer1@demo.com' AND role != 'admin'`);
      const practiceForReviewer = await db.execute(sql`SELECT id FROM practices LIMIT 1`);
      if (practiceForReviewer.rows && practiceForReviewer.rows.length > 0) {
        const pId = parseInt(practiceForReviewer.rows[0].id as string, 10);
        await db.execute(sql`UPDATE users SET practice_id = ${pId} WHERE email = 'reviewer1@demo.com' AND practice_id IS NULL`);
      }
      console.log("Reviewer user already exists - ensured admin role");
    }

    // Ensure reviewer2 has admin role
    await db.execute(sql`UPDATE users SET role = 'admin' WHERE email = 'reviewer2@demo.com' AND role != 'admin'`);
    const practiceForR2 = await db.execute(sql`SELECT id FROM practices LIMIT 1`);
    if (practiceForR2.rows && practiceForR2.rows.length > 0) {
      const pId2 = parseInt(practiceForR2.rows[0].id as string, 10);
      await db.execute(sql`UPDATE users SET practice_id = ${pId2} WHERE email = 'reviewer2@demo.com' AND practice_id IS NULL`);
    }

    // Check if data already exists
    const result = await db.execute(sql`SELECT COUNT(*) as count FROM practices`);
    const count = parseInt(result.rows[0]?.count || '0', 10);
    if (count > 0) {
      console.log("Database already seeded");
      return;
    }

    // Create sample practice
    const [practice] = await db.insert(practices).values({
      name: "Healing Hands Occupational Therapy",
      npi: "1234567890",
      taxId: "12-3456789",
      address: "123 Therapy Lane, Wellness City, WC 12345",
      phone: "(555) 123-4567",
      email: "admin@healinghands.com",
    }).returning();

    // Seed Common OT CPT Codes - Standard rate $289 per session
    await db.insert(cptCodes).values([
      {
        code: "97110",
        description: "Therapeutic exercises - strength, ROM, flexibility (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97112",
        description: "Neuromuscular reeducation - balance, coordination, posture (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97140",
        description: "Manual therapy - mobilization, manipulation (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97530",
        description: "Therapeutic activities - functional performance (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97535",
        description: "Self-care/ADL training - daily living activities (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97542",
        description: "Wheelchair management training (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97545",
        description: "Work hardening/conditioning (2 hours)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97003",
        description: "Occupational therapy evaluation",
        category: "evaluation",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97004",
        description: "Occupational therapy re-evaluation",
        category: "evaluation",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97165",
        description: "OT evaluation - low complexity",
        category: "evaluation",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97166",
        description: "OT evaluation - moderate complexity",
        category: "evaluation",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97167",
        description: "OT evaluation - high complexity",
        category: "evaluation",
        baseRate: "289.00",
        billingUnits: 1,
      },
    ]);

    // Seed Common ICD-10 Codes for OT
    await db.insert(icd10Codes).values([
      {
        code: "Z51.89",
        description: "Encounter for other specified aftercare",
        category: "aftercare",
      },
      {
        code: "M25.561",
        description: "Pain in right knee",
        category: "musculoskeletal",
      },
      {
        code: "M25.562",
        description: "Pain in left knee",
        category: "musculoskeletal",
      },
      {
        code: "M25.511",
        description: "Pain in right shoulder",
        category: "musculoskeletal",
      },
      {
        code: "M25.512",
        description: "Pain in left shoulder",
        category: "musculoskeletal",
      },
      {
        code: "M79.3",
        description: "Panniculitis, unspecified",
        category: "musculoskeletal",
      },
      {
        code: "G93.1",
        description: "Anoxic brain damage, not elsewhere classified",
        category: "neurological",
      },
      {
        code: "I69.351",
        description: "Hemiplegia and hemiparesis following cerebral infarction affecting right dominant side",
        category: "neurological",
      },
      {
        code: "I69.352",
        description: "Hemiplegia and hemiparesis following cerebral infarction affecting left dominant side",
        category: "neurological",
      },
      {
        code: "S72.001A",
        description: "Fracture of unspecified part of neck of right femur, initial encounter for closed fracture",
        category: "injury",
      },
      {
        code: "S72.002A",
        description: "Fracture of unspecified part of neck of left femur, initial encounter for closed fracture",
        category: "injury",
      },
      {
        code: "F84.0",
        description: "Autistic disorder",
        category: "developmental",
      },
      {
        code: "F82",
        description: "Specific developmental disorder of motor function",
        category: "developmental",
      },
    ]);

    // Seed Insurance Companies
    await db.insert(insurances).values([
      {
        name: "Medicare",
        payerCode: "00100",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Medicaid",
        payerCode: "00200",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Blue Cross Blue Shield",
        payerCode: "00300",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Aetna",
        payerCode: "00400",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Cigna",
        payerCode: "00500",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "UnitedHealth",
        payerCode: "00600",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Humana",
        payerCode: "00700",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
    ]);

    // Seed Sample Patients
    await db.insert(patients).values([
      {
        practiceId: practice.id,
        firstName: "John",
        lastName: "Smith",
        dateOfBirth: "1978-03-15",
        email: "john.smith@email.com",
        phone: "(555) 234-5678",
        address: "456 Oak Street, Wellness City, WC 12345",
        insuranceProvider: "Blue Cross Blue Shield",
        insuranceId: "BCBS123456789",
        policyNumber: "POL-2024-001",
        groupNumber: "GRP-100",
        smsConsentGiven: true,
      },
      {
        practiceId: practice.id,
        firstName: "Sarah",
        lastName: "Johnson",
        dateOfBirth: "1985-07-22",
        email: "sarah.johnson@email.com",
        phone: "(555) 345-6789",
        address: "789 Maple Avenue, Wellness City, WC 12346",
        insuranceProvider: "Aetna",
        insuranceId: "AET987654321",
        policyNumber: "POL-2024-002",
        groupNumber: "GRP-200",
        smsConsentGiven: true,
      },
      {
        practiceId: practice.id,
        firstName: "Michael",
        lastName: "Brown",
        dateOfBirth: "1992-11-08",
        email: "michael.brown@email.com",
        phone: "(555) 456-7890",
        address: "321 Pine Road, Wellness City, WC 12347",
        insuranceProvider: "UnitedHealth",
        insuranceId: "UHC456789123",
        policyNumber: "POL-2024-003",
        groupNumber: "GRP-300",
        smsConsentGiven: false,
      },
      {
        practiceId: practice.id,
        firstName: "Emily",
        lastName: "Davis",
        dateOfBirth: "1990-05-30",
        email: "emily.davis@email.com",
        phone: "(555) 567-8901",
        address: "654 Elm Court, Wellness City, WC 12348",
        insuranceProvider: "Cigna",
        insuranceId: "CIG789123456",
        policyNumber: "POL-2024-004",
        groupNumber: "GRP-400",
        smsConsentGiven: true,
      },
    ]);

    // Seed Demo User
    const demoPasswordHash = await hashPassword("demo1234");
    await db.insert(users).values({
      id: "demo-user-001",
      email: "demo@therapybill.com",
      firstName: "Demo",
      lastName: "Admin",
      practiceId: practice.id,
      role: "admin",
      passwordHash: demoPasswordHash,
      emailVerified: true,
    }).onConflictDoNothing();

    // Seed Reviewer User
    const reviewerPasswordHash = await hashPassword("TherapyDemo2024#");
    await db.insert(users).values({
      id: "reviewer-user-001",
      email: "reviewer1@demo.com",
      firstName: "Reviewer",
      lastName: "Demo",
      practiceId: practice.id,
      role: "admin",
      passwordHash: reviewerPasswordHash,
      emailVerified: true,
    }).onConflictDoNothing();

    console.log("Database seeded successfully with:", {
      practices: 1,
      cptCodes: 10,
      icd10Codes: 13,
      insurances: 7,
      patients: 4,
      demoUser: "demo@therapybill.com / demo1234",
      reviewerUser: "reviewer1@demo.com / TherapyDemo2024#",
    });
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
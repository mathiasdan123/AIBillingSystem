import { getDb } from "./db";
import { practices, cptCodes, icd10Codes, insurances, users } from "@shared/schema";
import { sql } from "drizzle-orm";
import { hashPassword } from "./services/passwordService";

export async function seedDatabase(options?: { force?: boolean }) {
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    // Wait for database to be ready
    const db = await getDb();

    // Run schema migrations for new columns (safe to run multiple times)
    console.log("Running schema migrations...");

    // Patient table migrations - ensure varchar columns for encrypted PHI storage
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_provider VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_id VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS policy_number VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS group_number VARCHAR`);
    // Fix column types: fields need text type to hold encrypted JSON or string member IDs
    // Drop any FK constraints on insurance_id first (old schema had integer FK to insurances table)
    try {
      await db.execute(sql`ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_insurance_id_insurances_id_fk`);
      await db.execute(sql`ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_insurance_id_fkey`);
    } catch (e) { /* constraint may not exist */ }

    // Test patient cleanup completed — ids 1-12 have been removed

    const columnsToText = [
      'first_name', 'last_name', 'email', 'phone', 'address',
      'insurance_provider', 'insurance_id', 'policy_number', 'group_number',
      'secondary_insurance_provider', 'secondary_insurance_member_id',
      'secondary_insurance_policy_number', 'secondary_insurance_group_number',
    ];
    for (const col of columnsToText) {
      try {
        await db.execute(sql.raw(`ALTER TABLE patients ALTER COLUMN ${col} TYPE text USING ${col}::text`));
      } catch (e) {
        // Column may not exist yet or already be text
      }
    }
    console.log("Column type migrations complete");
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

    // Ensure a practice exists FIRST — everything else depends on having a practice ID
    let practiceId: number;
    const existingPractice = await db.execute(sql`SELECT id FROM practices LIMIT 1`);
    if (existingPractice.rows && existingPractice.rows.length > 0) {
      practiceId = parseInt(existingPractice.rows[0].id as string, 10);
      console.log(`Using existing practice (id: ${practiceId})`);
    } else {
      const [practice] = await db.insert(practices).values({
        name: "Healing Hands Occupational Therapy",
        npi: "1234567890",
        taxId: "12-3456789",
        address: "123 Therapy Lane, Wellness City, WC 12345",
        phone: "(555) 123-4567",
        email: "admin@healinghands.com",
      }).returning();
      practiceId = practice.id;
      console.log(`Created sample practice (id: ${practiceId})`);
    }

    if (!isProduction) {
      const demoAdminPassword = process.env.DEMO_ADMIN_PASSWORD || 'demo1234';
      const demoReviewerPassword = process.env.DEMO_REVIEWER_PASSWORD || 'TherapyDemo2024#';

      const existingDemo = await db.execute(sql`SELECT id FROM users WHERE email = 'demo@therapybill.com'`);
      if (!existingDemo.rows || existingDemo.rows.length === 0) {
        console.log("Creating demo user...");
        const demoHash = await hashPassword(demoAdminPassword);
        await db.insert(users).values({
          id: "demo-user-001",
          email: "demo@therapybill.com",
          firstName: "Demo",
          lastName: "Admin",
          practiceId: practiceId,
          role: "admin",
          passwordHash: demoHash,
          emailVerified: true,
        }).onConflictDoNothing();
        console.log("Demo user created: demo@therapybill.com");
      } else {
        await db.execute(sql`UPDATE users SET role = 'admin', practice_id = ${practiceId} WHERE email = 'demo@therapybill.com' AND (role != 'admin' OR practice_id IS NULL)`);
        console.log("Demo user already exists");
      }

      const existingReviewer = await db.execute(sql`SELECT id FROM users WHERE email = 'reviewer1@demo.com'`);
      if (!existingReviewer.rows || existingReviewer.rows.length === 0) {
        console.log("Creating reviewer user...");
        const reviewerHash = await hashPassword(demoReviewerPassword);
        await db.insert(users).values({
          id: "reviewer-user-001",
          email: "reviewer1@demo.com",
          firstName: "Reviewer",
          lastName: "Demo",
          practiceId: practiceId,
          role: "admin",
          passwordHash: reviewerHash,
          emailVerified: true,
        }).onConflictDoNothing();
        console.log("Reviewer user created: reviewer1@demo.com");
      } else {
        await db.execute(sql`UPDATE users SET role = 'admin', practice_id = ${practiceId} WHERE email = 'reviewer1@demo.com' AND (role != 'admin' OR practice_id IS NULL)`);
        console.log("Reviewer user already exists - ensured admin role");
      }

      await db.execute(sql`UPDATE users SET role = 'admin', practice_id = ${practiceId} WHERE email = 'reviewer2@demo.com' AND (role != 'admin' OR practice_id IS NULL)`);
    } else {
      console.log("Production environment — skipping demo user seeding");
    }

    // Seed demo patients only if none exist
    const existingPatientCount = await db.execute(sql`SELECT COUNT(*) as count FROM patients WHERE deleted_at IS NULL`);
    const activePatients = parseInt(existingPatientCount.rows[0]?.count || '0', 10);
    if ((options?.force || !isProduction) && activePatients === 0) {
      console.log("No patients found — seeding demo patients...");
      const demoPatients = [
        { fn: 'Liam', ln: 'Martinez', dob: '2019-06-12', email: 'rosa.martinez@email.com', phone: '5552345678', addr: '456 Oak Street, Wellness City, WC 12345', ins: 'Blue Cross Blue Shield', insId: 'BCBS123456789', pol: 'POL-2024-001', grp: 'GRP-100' },
        { fn: 'Olivia', ln: 'Thompson', dob: '2020-03-08', email: 'karen.thompson@email.com', phone: '5553456789', addr: '789 Maple Avenue, Wellness City, WC 12346', ins: 'Aetna', insId: 'AET987654321', pol: 'POL-2024-002', grp: 'GRP-200' },
        { fn: 'Ethan', ln: 'Williams', dob: '2018-11-22', email: 'james.williams@email.com', phone: '5554567890', addr: '321 Pine Road, Wellness City, WC 12347', ins: 'UnitedHealth', insId: 'UHC456789123', pol: 'POL-2024-003', grp: 'GRP-300' },
        { fn: 'Sophia', ln: 'Chen', dob: '2021-01-15', email: 'mei.chen@email.com', phone: '5555678901', addr: '654 Elm Court, Wellness City, WC 12348', ins: 'Cigna', insId: 'CIG789123456', pol: 'POL-2024-004', grp: 'GRP-400' },
        { fn: 'Noah', ln: 'Patel', dob: '2017-08-30', email: 'priya.patel@email.com', phone: '5556789012', addr: '987 Birch Lane, Wellness City, WC 12349', ins: 'Medicare', insId: 'MED321654987', pol: 'POL-2024-005', grp: 'GRP-500' },
        { fn: 'Ava', ln: 'Robinson', dob: '2020-09-17', email: 'tanya.robinson@email.com', phone: '5557890123', addr: '246 Cedar Drive, Wellness City, WC 12350', ins: 'Humana', insId: 'HUM654987321', pol: 'POL-2024-006', grp: 'GRP-600' },
      ];
      for (const p of demoPatients) {
        try {
          await db.execute(sql`
            INSERT INTO patients (practice_id, first_name, last_name, date_of_birth, email, phone, address, insurance_provider, insurance_id, policy_number, group_number, created_at, updated_at)
            VALUES (${practiceId}, ${p.fn}, ${p.ln}, ${p.dob}, ${p.email}, ${p.phone}, ${p.addr}, ${p.ins}, ${p.insId}, ${p.pol}, ${p.grp}, NOW(), NOW())
          `);
        } catch (e) {
          console.error(`Failed to seed patient ${p.fn} ${p.ln}:`, e instanceof Error ? e.message : e);
        }
      }
      console.log("Sample patients seeded: 6 pediatric patients");
    } else if (!isProduction) {
      console.log(`${activePatients} patients already exist — skipping seed`);
    }

    // Check if reference data already exists (CPT codes, ICD-10, insurances)
    const cptCount = await db.execute(sql`SELECT COUNT(*) as count FROM cpt_codes`);
    if (parseInt(cptCount.rows[0]?.count || '0', 10) > 0) {
      console.log("Database already seeded with reference data");
      return;
    }

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

    console.log("Reference data seeded successfully (CPT codes, ICD-10 codes, insurances)");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
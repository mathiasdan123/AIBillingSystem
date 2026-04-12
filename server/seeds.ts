import { getDb } from "./db";
import { practices, cptCodes, icd10Codes, insurances, users } from "@shared/schema";
import { sql } from "drizzle-orm";
import { hashPassword } from "./services/passwordService";

/**
 * Seed realistic practice history: appointments, claims, sessions, SOAP notes, payments.
 * Uses relative dates (NOW() - INTERVAL) so data stays fresh.
 */
async function seedDemoPracticeHistory(db: any, practiceId: number) {
  console.log("Seeding demo practice history...");

  // Get patient IDs
  const patientRows = await db.execute(sql`SELECT id, first_name, last_name FROM patients WHERE practice_id = ${practiceId} AND deleted_at IS NULL ORDER BY id LIMIT 6`);
  const patients = patientRows.rows;
  if (patients.length === 0) return;

  // Seed appointments (8 past completed, 1 cancelled, 3 future scheduled)
  const apptData = [
    { idx: 0, offset: '28 days', title: 'OT Evaluation', status: 'completed' },
    { idx: 1, offset: '25 days', title: 'Therapy Session', status: 'completed' },
    { idx: 2, offset: '21 days', title: 'Therapy Session', status: 'completed' },
    { idx: 0, offset: '18 days', title: 'Therapy Session', status: 'completed' },
    { idx: 3, offset: '14 days', title: 'OT Evaluation', status: 'completed' },
    { idx: 1, offset: '10 days', title: 'Therapy Session', status: 'completed' },
    { idx: 4, offset: '7 days', title: 'Therapy Session', status: 'completed' },
    { idx: 2, offset: '3 days', title: 'Therapy Session', status: 'completed' },
    { idx: 5, offset: '5 days', title: 'Therapy Session', status: 'cancelled' },
    { idx: 0, offset: '-2 days', title: 'Therapy Session', status: 'scheduled' },
    { idx: 3, offset: '-4 days', title: 'Therapy Session', status: 'scheduled' },
    { idx: 1, offset: '-6 days', title: 'Therapy Session', status: 'scheduled' },
  ];

  for (const a of apptData) {
    const pid = patients[a.idx % patients.length].id;
    const sign = a.offset.startsWith('-') ? '+' : '-';
    const interval = a.offset.replace('-', '');
    try {
      await db.execute(sql.raw(`
        INSERT INTO appointments (practice_id, patient_id, start_time, end_time, title, status, created_at)
        VALUES (${practiceId}, ${pid}, NOW() ${sign} INTERVAL '${interval}' + INTERVAL '10 hours', NOW() ${sign} INTERVAL '${interval}' + INTERVAL '11 hours', '${a.title}', '${a.status}', NOW())
      `));
    } catch (e: any) { console.error(`Seed appt error: ${e.message}`); }
  }
  console.log("  Seeded 12 appointments");

  // Seed treatment sessions (linked to completed appointments)
  const sessions = [
    { idx: 0, offset: '28 days', duration: 60, type: 'OT Evaluation', notes: 'Initial evaluation completed. Fine motor delays noted. Grip strength below age expectations.' },
    { idx: 1, offset: '25 days', duration: 45, type: 'Therapy Session', notes: 'Worked on bilateral coordination. Patient showed improvement in bead stringing task.' },
    { idx: 2, offset: '21 days', duration: 45, type: 'Therapy Session', notes: 'Sensory integration activities. Patient tolerated textured materials better than previous session.' },
    { idx: 0, offset: '18 days', duration: 45, type: 'Therapy Session', notes: 'Fine motor strengthening exercises. Handwriting practice with adaptive grip.' },
    { idx: 3, offset: '14 days', duration: 60, type: 'OT Evaluation', notes: 'Initial evaluation. Visual motor integration deficits identified. Recommended 2x weekly.' },
    { idx: 1, offset: '10 days', duration: 45, type: 'Therapy Session', notes: 'Continued bilateral coordination. Introduced scissor skills activities.' },
    { idx: 4, offset: '7 days', duration: 45, type: 'Therapy Session', notes: 'Self-care skills training. Patient practiced buttoning and zipping with moderate assist.' },
    { idx: 2, offset: '3 days', duration: 45, type: 'Therapy Session', notes: 'Sensory diet review and modification. Introduced weighted vest during tabletop activities.' },
  ];

  for (const s of sessions) {
    const pid = patients[s.idx % patients.length].id;
    try {
      await db.execute(sql.raw(`
        INSERT INTO treatment_sessions (practice_id, patient_id, session_date, duration, session_type, status, notes, created_at)
        VALUES (${practiceId}, ${pid}, (NOW() - INTERVAL '${s.offset}')::date, ${s.duration}, '${s.type}', 'completed', '${s.notes.replace(/'/g, "''")}', NOW())
      `));
    } catch (e: any) { console.error(`Seed session error: ${e.message}`); }
  }
  console.log("  Seeded 8 treatment sessions");

  // Seed SOAP notes
  const soapNotes = [
    { idx: 0, offset: '28 days', subjective: 'Parent reports child struggles with holding pencils and self-feeding. Difficulty with buttons and zippers.', objective: 'Grip strength 2/5 bilateral. Tripod grasp inconsistent. In-hand manipulation below age expectations. VMI standard score 72.', assessment: 'Fine motor delays impacting school performance and self-care independence. Patient demonstrates difficulty with precision grasp patterns.', plan: 'Continue OT 2x/week. Focus on grip strengthening, in-hand manipulation, and adaptive strategies for classroom.' },
    { idx: 1, offset: '25 days', subjective: 'Child excited to play games. Parent notes improved bead stringing at home.', objective: 'Bilateral coordination improved. Completed 10-bead string in 3 min (prev 5 min). Midline crossing present for 7/10 trials.', assessment: 'Good progress in bilateral coordination. Continued difficulty with asymmetrical bilateral tasks.', plan: 'Progress to more complex bilateral tasks. Introduce scissor skills next session.' },
    { idx: 2, offset: '21 days', subjective: 'Parent reports child covers ears at school assemblies. Avoids messy play at home.', objective: 'Tolerated theraputty for 8 min (prev 3 min). Accepted finger painting briefly. Vestibular input calming.', assessment: 'Sensory over-responsivity improving with graded exposure. Tactile defensiveness remains significant.', plan: 'Continue sensory diet. Introduce brushing protocol. Provide home program for sensory regulation.' },
    { idx: 0, offset: '18 days', subjective: 'Teacher reports improved handwriting legibility. Parent happy with progress.', objective: 'Handwriting sample shows improved letter formation 6/10 letters (prev 3/10). Adaptive pencil grip used independently.', assessment: 'Fine motor gains evident in functional handwriting tasks. Grip endurance still limited.', plan: 'Continue strengthening exercises. Begin timed handwriting activities. Fade adaptive grip.' },
    { idx: 3, offset: '14 days', subjective: 'Parent concerned about clumsiness and difficulty with playground equipment. Falls frequently.', objective: 'BOT-2 body coordination composite: 25th percentile. Balance: single leg stand 4 sec (age expectation 8 sec). Motor planning: 3-step sequences completed with verbal cues.', assessment: 'Motor planning and balance deficits consistent with developmental coordination disorder. Impacts participation in age-appropriate play.', plan: 'OT 2x/week focusing on motor planning, balance, and body awareness. Provide obstacle course home program.' },
    { idx: 4, offset: '7 days', subjective: 'Child says dressing is hard. Parent helps with most fasteners.', objective: 'Completed buttoning 4/6 buttons with moderate assist. Zipper management with hand-over-hand. Shoe tying not yet attempted.', assessment: 'Self-care deficits consistent with fine motor delays. Motivated to improve independence.', plan: 'Continue self-care skills training. Grade fastener difficulty. Introduce backward chaining for shoe tying.' },
  ];

  for (const s of soapNotes) {
    const pid = patients[s.idx % patients.length].id;
    try {
      await db.execute(sql.raw(`
        INSERT INTO soap_notes (practice_id, patient_id, session_date, subjective, objective, assessment, plan, cpt_codes, therapist_name, status, data_source, created_at)
        VALUES (${practiceId}, ${pid}, (NOW() - INTERVAL '${s.offset}')::date, '${s.subjective.replace(/'/g, "''")}', '${s.objective.replace(/'/g, "''")}', '${s.assessment.replace(/'/g, "''")}', '${s.plan.replace(/'/g, "''")}', '["97530","97110"]'::jsonb, 'Demo Therapist', 'completed', 'manual', NOW())
      `));
    } catch (e: any) { console.error(`Seed SOAP error: ${e.message}`); }
  }
  console.log("  Seeded 6 SOAP notes");

  // Seed claims (mix of statuses) + line items
  const claimData = [
    { idx: 0, offset: '28 days', status: 'paid', amount: 289, paidAmount: 245, cpt: '97530', icd: 'F82', claimNum: 'CLM-DEMO-001' },
    { idx: 1, offset: '25 days', status: 'paid', amount: 216, paidAmount: 183, cpt: '97110', icd: 'F82', claimNum: 'CLM-DEMO-002' },
    { idx: 2, offset: '21 days', status: 'paid', amount: 289, paidAmount: 252, cpt: '97530', icd: 'F80.9', claimNum: 'CLM-DEMO-003' },
    { idx: 0, offset: '18 days', status: 'submitted', amount: 216, paidAmount: 0, cpt: '97110', icd: 'F82', claimNum: 'CLM-DEMO-004' },
    { idx: 3, offset: '14 days', status: 'submitted', amount: 289, paidAmount: 0, cpt: '97530', icd: 'F82', claimNum: 'CLM-DEMO-005' },
    { idx: 1, offset: '10 days', status: 'denied', amount: 216, paidAmount: 0, cpt: '97110', icd: 'F82', claimNum: 'CLM-DEMO-006' },
    { idx: 4, offset: '7 days', status: 'submitted', amount: 289, paidAmount: 0, cpt: '97530', icd: 'F82', claimNum: 'CLM-DEMO-007' },
    { idx: 2, offset: '3 days', status: 'draft', amount: 216, paidAmount: 0, cpt: '97110', icd: 'F80.9', claimNum: 'CLM-DEMO-008' },
    { idx: 0, offset: '1 day', status: 'draft', amount: 289, paidAmount: 0, cpt: '97530', icd: 'F82', claimNum: 'CLM-DEMO-009' },
  ];

  for (const c of claimData) {
    const pid = patients[c.idx % patients.length].id;
    const denialReason = c.status === 'denied' ? "'Prior authorization required'" : 'NULL';
    const submittedAt = ['submitted', 'paid', 'denied'].includes(c.status) ? `NOW() - INTERVAL '${c.offset}'` : 'NULL';
    const paidAt = c.status === 'paid' ? `NOW() - INTERVAL '${c.offset}' + INTERVAL '12 days'` : 'NULL';
    try {
      const claimResult = await db.execute(sql.raw(`
        INSERT INTO claims (practice_id, patient_id, claim_number, status, total_amount, paid_amount, denial_reason, submitted_at, paid_at, created_at)
        VALUES (${practiceId}, ${pid}, '${c.claimNum}', '${c.status}', ${c.amount}, ${c.paidAmount}, ${denialReason}, ${submittedAt}, ${paidAt}, NOW())
        RETURNING id
      `));
      const claimId = claimResult.rows[0]?.id;
      if (claimId) {
        // Add claim line item with CPT code
        await db.execute(sql.raw(`
          INSERT INTO claim_line_items (claim_id, cpt_code_id, units, rate, amount, date_of_service, created_at)
          VALUES (${claimId}, (SELECT id FROM cpt_codes WHERE code = '${c.cpt}' LIMIT 1), 4, ${c.amount / 4}, ${c.amount}, (NOW() - INTERVAL '${c.offset}')::date, NOW())
        `));
      }
    } catch (e: any) { console.error(`Seed claim error: ${e.message}`); }
  }
  console.log("  Seeded 9 claims with line items");

  // Seed payments for paid claims
  const payments = [
    { idx: 0, offset: '16 days', amount: 245, type: 'insurance', ref: 'ERA-2026-001' },
    { idx: 1, offset: '13 days', amount: 183, type: 'insurance', ref: 'ERA-2026-002' },
    { idx: 2, offset: '9 days', amount: 252, type: 'insurance', ref: 'ERA-2026-003' },
    { idx: 0, offset: '15 days', amount: 25, type: 'patient', ref: 'COPAY-001' },
    { idx: 1, offset: '12 days', amount: 30, type: 'patient', ref: 'COPAY-002' },
  ];

  for (const p of payments) {
    const pid = patients[p.idx % patients.length].id;
    try {
      await db.execute(sql.raw(`
        INSERT INTO payments (practice_id, patient_id, amount, payment_type, payment_date, reference_number, status, created_at)
        VALUES (${practiceId}, ${pid}, ${p.amount}, '${p.type}', (NOW() - INTERVAL '${p.offset}')::date, '${p.ref}', 'completed', NOW())
      `));
    } catch (e: any) { console.error(`Seed payment error: ${e.message}`); }
  }
  console.log("  Seeded 5 payments");
  console.log("Demo practice history seeded successfully!");
}

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
        { fn: 'Mason', ln: 'Hartwell', dob: '2019-06-12', email: 'diana.hartwell@example.net', phone: '(555) 814-2937', addr: '1204 Sycamore Blvd, Brookfield, IL 60513', ins: 'Blue Cross Blue Shield', insId: 'BCBS7741928035', pol: 'GHP-88201-A', grp: 'BX-4410' },
        { fn: 'Clara', ln: 'Nguyen', dob: '2020-03-08', email: 'tran.nguyen@example.net', phone: '(555) 623-8104', addr: '387 Willowbrook Dr, Oakdale, MN 55128', ins: 'Aetna', insId: 'AET3390217864', pol: 'GHP-55032-B', grp: 'AT-7720' },
        { fn: 'Declan', ln: 'Okafor', dob: '2018-11-22', email: 'grace.okafor@example.net', phone: '(555) 471-5928', addr: '92 Ridgewood Terrace, Cary, NC 27513', ins: 'UnitedHealthcare', insId: 'UHC8856034172', pol: 'GHP-67210-C', grp: 'UH-3305' },
        { fn: 'Isla', ln: 'Brennan', dob: '2021-01-15', email: 'kevin.brennan@example.net', phone: '(555) 309-6741', addr: '5510 Hawthorn Ct, Plano, TX 75024', ins: 'Cigna', insId: 'CIG2104897563', pol: 'GHP-43018-D', grp: 'CI-9180' },
        { fn: 'Felix', ln: 'Sandoval', dob: '2017-08-30', email: 'maria.sandoval@example.net', phone: '(555) 182-4503', addr: '741 Birchwood Ave, Eugene, OR 97401', ins: 'Medicare', insId: 'MCA6627183049', pol: 'GHP-91405-E', grp: 'MC-5560' },
        { fn: 'Zara', ln: 'Lindqvist', dob: '2020-09-17', email: 'anna.lindqvist@example.net', phone: '(555) 547-3286', addr: '2038 Cedarwood Ln, Madison, WI 53711', ins: 'Humana', insId: 'HUM4415928370', pol: 'GHP-72604-F', grp: 'HU-2245' },
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

      // Seed practice history (appointments, claims, sessions, SOAP notes, payments)
      await seedDemoPracticeHistory(db, practiceId);
    } else if (options?.force) {
      // Force re-seed: check if practice history is missing
      const claimCount = await db.execute(sql`SELECT COUNT(*) as count FROM claims WHERE practice_id = ${practiceId}`);
      if (parseInt(claimCount.rows[0]?.count || '0', 10) === 0) {
        await seedDemoPracticeHistory(db, practiceId);
      }
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
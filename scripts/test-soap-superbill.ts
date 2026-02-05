import { getDb } from '../server/db.js';
import { treatmentSessions, patients, cptCodes, users } from '../shared/schema.js';
import { eq } from 'drizzle-orm';

async function createTestSession() {
  const db = await getDb();

  // Get a patient and CPT code
  const patientList = await db.select().from(patients).limit(1);
  const patient = patientList[0];
  const cptList = await db.select().from(cptCodes).limit(1);
  const cpt = cptList[0];

  // Ensure we have a user for therapist
  const userList = await db.select().from(users).limit(1);
  const user = userList[0];

  if (!patient || !cpt || !user) {
    console.log('Missing data:', { patient: !!patient, cpt: !!cpt, user: !!user });
    process.exit(1);
  }

  // Update patient with insurance for testing
  await db.update(patients).set({
    insuranceProvider: 'Blue Cross Blue Shield'
  }).where(eq(patients.id, patient.id));

  // Create a session with longer duration to test multi-code billing
  const [session] = await db.insert(treatmentSessions).values({
    practiceId: 1,
    patientId: patient.id,
    therapistId: user.id,
    sessionDate: new Date().toISOString().split('T')[0],
    duration: 60, // 60 minutes = 4 billable units
    cptCodeId: cpt.id,
    units: 4,
    status: 'completed',
  }).returning();

  console.log('=== TEST: AI BILLING OPTIMIZATION ===');
  console.log('');
  console.log('Session created:', session.id);
  console.log('Patient:', patient.firstName, patient.lastName);
  console.log('Insurance: Blue Cross Blue Shield');
  console.log('Duration: 60 minutes (4 billable units)');
  console.log('');
  console.log('Creating SOAP note with detailed content...');
  console.log('');

  // Create SOAP note with detailed content that warrants multiple codes
  const response = await fetch('http://localhost:5000/api/soap-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id,
      subjective: 'Patient reports difficulty with daily tasks. Pain level 5/10 in right shoulder. Having trouble reaching overhead and dressing independently.',
      objective: 'Performed therapeutic exercises for shoulder strengthening (15 min). Manual therapy including soft tissue mobilization and joint mobilization to improve ROM (15 min). Neuromuscular re-education for proper movement patterns (15 min). Therapeutic activities simulating functional tasks like reaching and lifting (15 min). Active ROM: shoulder flexion improved from 130 to 145 degrees. Strength improved to 4/5.',
      assessment: 'Patient making good progress. Demonstrates improved functional mobility and decreased pain with movement. Compensatory patterns decreasing with neuromuscular re-education.',
      plan: 'Continue current treatment plan 2x/week. Progress strengthening exercises. Add ADL training next session.',
      interventions: ['therapeutic exercises', 'manual therapy', 'neuromuscular re-education', 'therapeutic activities'],
    }),
  });

  const result = await response.json();
  console.log('SOAP Note created:', result.id ? 'Yes' : 'No');
  console.log('');

  if (result.generatedClaim) {
    console.log('========================================');
    console.log('   AI-OPTIMIZED SUPERBILL GENERATED');
    console.log('========================================');
    console.log('');
    console.log('Claim #:', result.generatedClaim.claimNumber);
    console.log('Total Amount: $' + result.generatedClaim.totalAmount);
    console.log('');

    if (result.generatedClaim.optimization) {
      console.log('Compliance Score:', result.generatedClaim.optimization.complianceScore + '%');
      console.log('Total Units:', result.generatedClaim.optimization.totalUnits);
      console.log('');
      console.log('AI Notes:', result.generatedClaim.optimization.notes);
      console.log('');
    }

    if (result.generatedClaim.lineItems) {
      console.log('LINE ITEMS:');
      console.log('-------------------------------------------');
      result.generatedClaim.lineItems.forEach((item: any, i: number) => {
        console.log(`${i + 1}. ${item.cptCode} - ${item.description || 'N/A'}`);
        console.log(`   Units: ${item.units} | Amount: $${item.amount}`);
        if (item.reasoning) {
          console.log(`   Reason: ${item.reasoning}`);
        }
        console.log('');
      });
    }
    console.log('========================================');
  } else {
    console.log('No claim auto-generated (check server logs)');
    console.log('Response:', JSON.stringify(result, null, 2));
  }

  process.exit(0);
}

createTestSession().catch(e => { console.error(e); process.exit(1); });

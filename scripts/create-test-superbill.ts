import { getDb } from '../server/db.js';
import { claims, claimLineItems, patients, cptCodes, icd10Codes } from '../shared/schema.js';

async function createTestSuperbill() {
  const db = await getDb();

  // Get a patient
  const [patient] = await db.select().from(patients).limit(1);
  if (!patient) {
    console.log('No patients found');
    process.exit(1);
  }

  // Get some CPT codes
  const cpts = await db.select().from(cptCodes).limit(4);
  if (cpts.length === 0) {
    console.log('No CPT codes found');
    process.exit(1);
  }

  // Get an ICD-10 code
  const [icd10] = await db.select().from(icd10Codes).limit(1);

  // Calculate total
  const lineItemsData = [
    { cpt: cpts[0], units: 1 },
    { cpt: cpts[1] || cpts[0], units: 2 },
    { cpt: cpts[2] || cpts[0], units: 1 },
  ];

  const total = lineItemsData.reduce((sum, item) => {
    return sum + (parseFloat(item.cpt.baseRate || '100') * item.units);
  }, 0);

  // Create the claim
  const [claim] = await db.insert(claims).values({
    practiceId: 1,
    patientId: patient.id,
    claimNumber: 'SB-2024-' + Date.now().toString().slice(-6),
    status: 'draft',
    totalAmount: total.toFixed(2),
    serviceDate: new Date(),
  }).returning();

  console.log('Created claim:', claim.claimNumber, '- Total: $' + total.toFixed(2));

  // Create line items
  for (const item of lineItemsData) {
    const rate = parseFloat(item.cpt.baseRate || '100');
    const amount = rate * item.units;
    await db.insert(claimLineItems).values({
      claimId: claim.id,
      cptCodeId: item.cpt.id,
      icd10CodeId: icd10?.id || null,
      units: item.units,
      rate: rate.toFixed(2),
      amount: amount.toFixed(2),
      dateOfService: new Date().toISOString().split('T')[0],
    });
    console.log('  - Added:', item.cpt.code, '-', item.cpt.description, '| Units:', item.units, '| $' + amount.toFixed(2));
  }

  console.log('\nDone! Go to Claims page and click View Details on claim', claim.claimNumber);
  process.exit(0);
}

createTestSuperbill().catch(e => { console.error(e); process.exit(1); });

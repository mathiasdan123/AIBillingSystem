/**
 * One-time PHI encryption backfill.
 *
 * Encrypts patient PHI columns that were stored in plaintext before they were
 * added to the encryption set (secondary insurance + employer fields, and any
 * legacy pre-encryption primary fields), and normalizes any double-encrypted
 * practices.taxId rows to a single layer.
 *
 * SAFE TO RUN ONLINE & IDEMPOTENT:
 *  - The app reads via decryptField, which tolerates legacy plaintext, so mixed
 *    plaintext/ciphertext rows work correctly during the run.
 *  - This script encrypts ONLY fields that are currently plaintext (it detects
 *    already-encrypted EncryptedField blobs and skips them), so a re-run is a
 *    no-op — it does not churn already-correct rows with fresh IVs.
 *
 * Usage:
 *   # Dry run (counts what WOULD change, writes nothing):
 *   tsx scripts/backfill-patient-encryption.ts --dry-run
 *
 *   # Apply patient backfill:
 *   tsx scripts/backfill-patient-encryption.ts
 *
 *   # Normalize double-encrypted practice taxIds:
 *   tsx scripts/backfill-patient-encryption.ts --taxid
 *
 * Pre-flight: take an RDS snapshot, confirm PHI_ENCRYPTION_KEY is the real prod
 * key, and dry-run on a snapshot restore first. See docs/phi-encryption-backfill.md.
 */
import { gt, eq } from 'drizzle-orm';
import { getDb } from '../server/db.js';
import { patients, practices, remittanceLineItems } from '../shared/schema.js';
import { encryptField, decryptField } from '../server/services/phiEncryptionService.js';

// Mirrors PATIENT_PHI_STRING_FIELDS + PATIENT_INSURANCE_EXTRA_FIELDS in
// phiEncryptionService, minus dateOfBirth (a `date` column that can't be
// string-encrypted without a schema migration). Keep in sync with that file.
const PATIENT_STRING_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'address',
  'insuranceId', 'policyNumber', 'groupNumber',
  'insuranceProvider', 'insuranceEmployerName',
  'secondaryInsuranceProvider', 'secondaryInsurancePolicyNumber',
  'secondaryInsuranceMemberId', 'secondaryInsuranceGroupNumber',
  'secondaryInsuranceSubscriberName',
] as const;

// Date-typed PHI columns → their encrypted text counterpart (expand→contract).
const PATIENT_DATE_ENC_MAP: Record<string, string> = {
  dateOfBirth: 'dateOfBirthEnc',
  secondaryInsuranceSubscriberDob: 'secondaryInsuranceSubscriberDobEnc',
};

const REMITTANCE_FIELDS = ['patientName', 'memberId'] as const;

const BATCH = 200;
const DRY_RUN = process.argv.includes('--dry-run');
const TAXID_MODE = process.argv.includes('--taxid');
const REMITTANCE_MODE = process.argv.includes('--remittance');

/** True if a stored value is already an EncryptedField JSON blob (ciphertext+iv+tag). */
function looksEncrypted(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const p = JSON.parse(value);
    return !!(p && p.ciphertext && p.iv && p.tag);
  } catch {
    return false;
  }
}

async function backfillPatients() {
  const db = await getDb();
  let lastId = 0;
  let scanned = 0;
  let changed = 0;
  const fieldCounts: Record<string, number> = {};

  for (;;) {
    const rows: any[] = await db
      .select()
      .from(patients)
      .where(gt(patients.id, lastId))
      .orderBy(patients.id)
      .limit(BATCH);
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      lastId = row.id;
      const patch: Record<string, any> = {};
      for (const field of PATIENT_STRING_FIELDS) {
        const val = row[field];
        if (val === null || val === undefined || val === '') continue;
        if (looksEncrypted(val)) continue; // already encrypted — skip
        const enc = encryptField(String(val));
        if (enc) {
          patch[field] = JSON.stringify(enc);
          fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
        }
      }
      // Date columns: encrypt the plaintext date into its `*_enc` text column if
      // not already populated. Leaves the plaintext date column intact (dropped
      // in a later contract migration).
      for (const [plain, encCol] of Object.entries(PATIENT_DATE_ENC_MAP)) {
        const val = row[plain];
        if (val === null || val === undefined || val === '') continue;
        if (looksEncrypted(row[encCol])) continue; // already backfilled
        const enc = encryptField(String(val));
        if (enc) {
          patch[encCol] = JSON.stringify(enc);
          fieldCounts[encCol] = (fieldCounts[encCol] ?? 0) + 1;
        }
      }
      if (Object.keys(patch).length > 0) {
        changed++;
        if (!DRY_RUN) {
          await db.update(patients).set(patch).where(eq(patients.id, row.id));
        }
      }
    }
    console.log(`  …scanned ${scanned} (through id ${lastId}), ${changed} need${DRY_RUN ? '' : 'ed'} update`);
  }

  console.log(`\nPatients: scanned ${scanned}, ${DRY_RUN ? 'would update' : 'updated'} ${changed}.`);
  console.log('Per-field plaintext→encrypted counts:', fieldCounts);
}

async function backfillRemittanceLineItems() {
  const db = await getDb();
  let lastId = 0;
  let scanned = 0;
  let changed = 0;
  const fieldCounts: Record<string, number> = {};

  for (;;) {
    const rows: any[] = await db
      .select()
      .from(remittanceLineItems)
      .where(gt(remittanceLineItems.id, lastId))
      .orderBy(remittanceLineItems.id)
      .limit(BATCH);
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      lastId = row.id;
      const patch: Record<string, any> = {};
      for (const field of REMITTANCE_FIELDS) {
        const val = row[field];
        if (val === null || val === undefined || val === '') continue;
        if (looksEncrypted(val)) continue;
        const enc = encryptField(String(val));
        if (enc) {
          patch[field] = JSON.stringify(enc);
          fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
        }
      }
      if (Object.keys(patch).length > 0) {
        changed++;
        if (!DRY_RUN) {
          await db.update(remittanceLineItems).set(patch).where(eq(remittanceLineItems.id, row.id));
        }
      }
    }
    console.log(`  …scanned ${scanned} (through id ${lastId}), ${changed} need${DRY_RUN ? '' : 'ed'} update`);
  }

  console.log(`\nRemittance line items: scanned ${scanned}, ${DRY_RUN ? 'would update' : 'updated'} ${changed}.`);
  console.log('Per-field plaintext→encrypted counts:', fieldCounts);
}

async function normalizeTaxIds() {
  const db = await getDb();
  const rows: any[] = await db.select().from(practices);
  let fixed = 0;
  for (const row of rows) {
    const original = row.taxId;
    if (!original || !looksEncrypted(original)) continue; // plaintext or empty — leave as-is

    // Peel one layer. If still encrypted, it was (at least) double-encrypted.
    const once = decryptField(original);
    if (!looksEncrypted(once)) continue; // already single-encrypted — skip (true no-op)

    // Fully decrypt nested layers, then re-encrypt once.
    let plain: string | null = once;
    let guard = 0;
    while (looksEncrypted(plain) && guard++ < 10) {
      plain = decryptField(plain);
    }
    if (plain === null) {
      console.warn(`  practice ${row.id}: taxId failed to decrypt — SKIPPING (investigate key/corruption)`);
      continue;
    }
    const single = encryptField(plain);
    if (!single) continue;
    fixed++;
    if (!DRY_RUN) {
      await db.update(practices).set({ taxId: JSON.stringify(single) }).where(eq(practices.id, row.id));
    }
  }
  console.log(`\nPractices: ${DRY_RUN ? 'would normalize' : 'normalized'} ${fixed} double-encrypted taxId row(s).`);
}

async function main() {
  if (!process.env.PHI_ENCRYPTION_KEY) {
    console.error('FATAL: PHI_ENCRYPTION_KEY is not set. Refusing to run.');
    process.exit(1);
  }
  const mode = TAXID_MODE ? 'taxId normalization' : REMITTANCE_MODE ? 'remittance line-item backfill' : 'patient backfill';
  console.log(`Mode: ${mode}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}\n`);
  if (TAXID_MODE) {
    await normalizeTaxIds();
  } else if (REMITTANCE_MODE) {
    await backfillRemittanceLineItems();
  } else {
    await backfillPatients();
  }
  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

# PHI Encryption Backfill Plan

This branch widened the patient PHI encryption set (secondary insurance + employer
fields) and surfaced GCM integrity failures instead of silently nulling them. New
writes encrypt automatically; **existing rows stay plaintext until re-saved**, because
`decryptField` tolerates legacy plaintext (returns it as-is). This doc covers the
one-time backfill to normalize existing data, plus the related `taxId` normalization.

> Encryption is AES-256-GCM via `server/services/phiEncryptionService.ts`. Patient
> reads/writes already route through `encryptPatientRecord` / `decryptPatientRecord`
> (`server/storage/patients.ts`), so a backfill is just "read each row, write it back."

## Scope

| Table.column(s) | Status after this PR | Needs backfill |
|---|---|---|
| `patients.insuranceProvider`, `secondaryInsuranceProvider`, `secondaryInsurancePolicyNumber`, `secondaryInsuranceMemberId`, `secondaryInsuranceGroupNumber`, `secondaryInsuranceSubscriberName`, `insuranceEmployerName` | encrypted on write | **Yes** — legacy rows still plaintext |
| `patients.firstName/lastName/email/phone/address/insuranceId/policyNumber/groupNumber` | already encrypted pre-PR | only rows created before encryption was first added |
| `patients.dateOfBirth`, `secondaryInsuranceSubscriberDob` | encrypted into sibling `*_enc` text columns (dual-write, item 3) | **Yes** — covered by the default patient backfill; CONTRACT (drop plaintext date cols) is a follow-up migration after one release |
| `practices.taxId` | encrypted; double-encryption guard in place | **Normalize** legacy double-encrypted rows, then drop the heuristic |
| `remittanceLineItems.patientName/memberId` | encrypted on write (item 4) | **Yes** — `--remittance` mode; legacy rows plaintext until backfilled |

## Why it's safe to run online

- `decryptField` returns legacy plaintext unchanged, so the app works correctly
  **before, during, and after** the backfill (mixed plaintext/ciphertext rows are fine).
- The backfill is idempotent: re-encrypting an already-encrypted field is prevented by
  the same "looks-like-an-EncryptedField" check used for `taxId`. Re-running is a no-op
  for rows already converted.
- No downtime, no schema change for the patient fields (they are already `varchar`/`text`).

## Pre-flight

1. **Snapshot the DB.** Take an RDS snapshot immediately before running (instant rollback).
2. **Confirm the key.** Verify `PHI_ENCRYPTION_KEY` in the target env is the real 64-hex
   prod key (the same key the app uses), not a demo key. A wrong key here would write
   ciphertext the app can't decrypt.
3. **Run on a copy first.** Restore the snapshot to a scratch instance and dry-run there.
4. **Off-peak window.** Low write volume reduces the chance of racing a concurrent edit.

## Backfill script

Implemented at **`scripts/backfill-patient-encryption.ts`** — run as a one-off ECS task
(or locally against a snapshot restore) with `tsx`. It detects already-encrypted fields
and skips them, so it's a true no-op on re-run.

```bash
# Dry run — counts what WOULD change, writes nothing:
tsx scripts/backfill-patient-encryption.ts --dry-run

# Apply the patient backfill:
tsx scripts/backfill-patient-encryption.ts

# Normalize double-encrypted practice taxIds (separate mode):
tsx scripts/backfill-patient-encryption.ts --taxid

# Backfill remittance line-item PHI (patientName, memberId):
tsx scripts/backfill-patient-encryption.ts --remittance
```

It refuses to run without `PHI_ENCRYPTION_KEY`, batches by id (200/page), and only
writes the fields that were plaintext. Reference implementation outline:

```ts
import { db } from '../server/db';
import { patients } from '../shared/schema';
import { encryptPatientRecord, decryptPatientRecord } from '../server/services/phiEncryptionService';
import { eq } from 'drizzle-orm';

const FIELDS = [
  'insuranceProvider','secondaryInsuranceProvider','secondaryInsurancePolicyNumber',
  'secondaryInsuranceMemberId','secondaryInsuranceGroupNumber','secondaryInsuranceSubscriberName',
  'insuranceEmployerName',
];

// Process in batches by id to avoid loading the whole table.
let lastId = 0;
const BATCH = 200;
for (;;) {
  const rows = await db.select().from(patients).where(/* id > lastId */).orderBy(patients.id).limit(BATCH);
  if (rows.length === 0) break;
  for (const row of rows) {
    // decryptPatientRecord normalizes ciphertext OR legacy plaintext to plaintext...
    const plain = decryptPatientRecord(row);
    // ...and encryptPatientRecord re-encrypts; idempotent for already-encrypted fields.
    const enc = encryptPatientRecord(plain);
    const patch: Record<string, any> = {};
    for (const f of FIELDS) if (enc[f] !== row[f]) patch[f] = enc[f];
    if (Object.keys(patch).length) {
      await db.update(patients).set(patch).where(eq(patients.id, row.id));
    }
    lastId = row.id;
  }
  console.log(`processed up to id ${lastId}`);
}
```

Notes:
- **Use `db.update` directly, not `storage.updatePatient`** — the storage helper now runs
  `stripImmutable` and re-encrypts the *whole* record; writing only the changed fields via
  a raw update is narrower and avoids re-touching already-correct columns. (If you do use
  `storage.updatePatient`, it still works and stays idempotent — just heavier.)
- Compare `enc[f] !== row[f]` so already-encrypted rows produce an empty patch (no write).
- Keep batches small (200) and let it run; it's I/O bound, not urgent.

## Verification (after run)

1. **No plaintext remains.** For a sample of rows, confirm each target column parses as
   an `EncryptedField` JSON blob (has `ciphertext`/`iv`/`tag`), not bare text.
2. **App round-trips.** Hit `GET /api/patients/:id` for a few backfilled patients via the
   app (which decrypts) and confirm the values render correctly.
3. **Watch for the new integrity alert.** This PR makes `decryptField` log
   `CRITICAL: PHI decryption integrity failure` on an auth-tag mismatch. After the backfill,
   grep CloudWatch for that string — **zero occurrences** is the success signal. Any hit
   means a row was encrypted with a different key (investigate before declaring done).

## `taxId` normalization (separate, small)

Legacy double-encrypted `practices.taxId` rows may still exist (the PR's guard prevents
*new* double-encryption but doesn't fix old rows). One-off:

1. For each practice, `decryptField` until the result is no longer an `EncryptedField`
   (peel nested layers), then `encryptField` once and write back.
2. After confirming all rows are single-encrypted, remove the heuristic double-encrypt
   guard in `server/routes/provider-profile.ts` so the code path is simple again.

## DOB date-columns — CONTRACT phase (separate follow-up release)

Item 3 added `date_of_birth_enc` / `secondary_insurance_subscriber_dob_enc` text columns and
dual-writes them alongside the plaintext `date` columns. The plaintext columns still hold the
DOB, so the at-rest protection is only fully realized once they're dropped. Sequence:

1. **Deploy + backfill** (this release): `*_enc` populated for all rows (default patient backfill
   covers them). `decryptPatientRecord` already prefers `*_enc`, falling back to the plaintext col.
2. **Audit readers AND writers** before contracting. Known raw `dateOfBirth` selectors that
   bypass `decryptPatientRecord` and will read NULL once the plaintext column is dropped — route
   each through the decrypt path (or select `*_enc`) first:
   - `server/services/automatedClaimStatusService.ts` (~152, ~377) and
     `server/services/claimStatusReaperService.ts` (~168) — DOB into 837/276 transactions.
   - `server/routes/reports.ts` (~614) — patient report.

   Known writers that must dual-write `*_enc` (or route through `encryptPatientRecord`) before the
   contract, else their rows lose DOB at drop:
   - `server/routes/data-import.ts` — **fixed** (now uses `storage.createPatient`).
   - `server/seeds.ts` (~980) — dev/demo seed (writes `is_demo` patients); update before any
     contract that could run against an env with seeded data.

   Re-run the backfill after the last bulk import so every row has `*_enc` populated.
3. **Contract migration** (next release): stop writing the plaintext columns, then
   `ALTER TABLE patients DROP COLUMN date_of_birth, DROP COLUMN secondary_insurance_subscriber_dob`.
   This is a `DROP COLUMN` — `scripts/lint-migrations.sh` will flag it; ship it only after step 2,
   with the expand→contract reasoning, using the documented `-- migration-lint: ignore` override.

## Rollback

If anything looks wrong mid-run: stop the task. Mixed plaintext/ciphertext is a valid
state (the app handles both), so there's no corruption from a partial run. To fully revert,
restore the pre-run RDS snapshot.

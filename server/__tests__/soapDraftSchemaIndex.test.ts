import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { soapNoteDrafts } from '../../shared/schema';

/**
 * Regression for therapybill-qa #3.
 *
 * storage.upsertSoapDraft runs INSERT ... ON CONFLICT (therapist_id, patient_id)
 * DO UPDATE. Postgres only accepts that when a unique index covers exactly
 * those columns. The index used to live only in a hand-written SQL file
 * (migrations/add_soap_draft_columns.sql) that the deploy pipeline never
 * runs — production applies shared/schema.ts via `drizzle-kit push`, so a
 * schema without the index means a prod table without it, and every draft
 * autosave fails with "no unique or exclusion constraint matching the ON
 * CONFLICT specification". This pins the index to the schema itself.
 */
describe('soap_note_drafts schema', () => {
  const { indexes, name } = getTableConfig(soapNoteDrafts);

  const describeIndex = (ix: (typeof indexes)[number]) => ({
    name: ix.config.name,
    unique: ix.config.unique,
    columns: ix.config.columns.map((c: any) => c.name),
  });

  it('is the soap_note_drafts table', () => {
    expect(name).toBe('soap_note_drafts');
  });

  it('declares the unique (therapist_id, patient_id) index the upsert ON CONFLICT target needs', () => {
    const unique = indexes.map(describeIndex).find(
      (ix) => ix.unique && ix.columns.join(',') === 'therapist_id,patient_id',
    );
    expect(unique, `expected a unique index on (therapist_id, patient_id); got ${JSON.stringify(indexes.map(describeIndex))}`).toBeDefined();
    // Same name the legacy migration used, so drizzle-kit push sees one
    // index to keep rather than one to drop and another to create.
    expect(unique!.name).toBe('idx_soap_draft_therapist_patient');
  });

  it('keeps the practice lookup index from the legacy migration', () => {
    const practice = indexes.map(describeIndex).find((ix) => ix.columns.join(',') === 'practice_id');
    expect(practice?.name).toBe('idx_soap_draft_practice');
    expect(practice?.unique).toBeFalsy();
  });
});

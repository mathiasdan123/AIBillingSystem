/**
 * Mass-assignment guard for update paths.
 *
 * Many update handlers spread `req.body` straight into a Drizzle `.set({...})`.
 * Drizzle ignores unknown keys, but ownership/identity/audit columns ARE real
 * columns — so a caller could re-parent a record to another practice/patient or
 * forge audit fields by including them in the body. stripImmutable() removes
 * those columns before the write. Use it at any `.set({ ...userSuppliedUpdates })`
 * sink; pass `extra` to protect additional table-specific columns.
 */
const ALWAYS_IMMUTABLE = [
  'id',
  'practiceId',
  'practice_id',
  'patientId',
  'patient_id',
  'userId',
  'user_id',
  'createdAt',
  'created_at',
  'createdBy',
  'created_by',
  'updatedAt',
  'updated_at',
  'deletedAt',
  'deleted_at',
  'integrityHash',
  'integrity_hash',
] as const;

export function stripImmutable<T extends Record<string, any>>(
  updates: T,
  extra: string[] = [],
): Partial<T> {
  if (!updates || typeof updates !== 'object') return {} as Partial<T>;
  const blocked = new Set<string>([...ALWAYS_IMMUTABLE, ...extra]);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.has(k)) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

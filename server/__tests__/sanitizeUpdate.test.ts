import { describe, it, expect } from 'vitest';
import { stripImmutable } from '../utils/sanitizeUpdate';

describe('stripImmutable', () => {
  it('removes identity/ownership/audit columns (camel + snake)', () => {
    const out = stripImmutable({
      id: 9, practiceId: 2, practice_id: 2, patientId: 5, patient_id: 5,
      userId: 'u', createdAt: 't', updatedAt: 't', deletedAt: 't', integrityHash: 'h',
      status: 'active', notes: 'keep me',
    });
    expect(out).toEqual({ status: 'active', notes: 'keep me' });
  });

  it('blocks extra columns when requested', () => {
    expect(stripImmutable({ therapistId: 'x', plan: 'p' }, ['therapistId'])).toEqual({ plan: 'p' });
  });

  it('is null/garbage safe', () => {
    expect(stripImmutable(null as any)).toEqual({});
    expect(stripImmutable(undefined as any)).toEqual({});
  });

  it('does not block a normal re-parent attempt from sneaking through', () => {
    const out = stripImmutable({ practiceId: 999, foo: 1 });
    expect(out).not.toHaveProperty('practiceId');
  });
});

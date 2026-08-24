/**
 * ERA match scoring decides which claim a payer's money lands on. A wrong
 * answer posts real dollars onto a stranger's account and onto their patient
 * statement — and since ERA matching now writes payment_postings, that money
 * also feeds A/R and the collections figure TherapyBill invoices 6% of.
 *
 * Two defects these pin (money-path sweep, 2026-08-24):
 *
 * 1. The "CPT match" was `lineItem.cptCode && cli.cptCodeId`. cptCodeId is a
 *    NOT NULL column, so it was always true: every claim was awarded 15
 *    points for merely HAVING a CPT, never for matching one.
 *
 * 2. Date and CPT points were summed PER LINE ITEM. A 3-line claim collected
 *    45 points of phantom CPT credit and cleared the 40-point auto-match
 *    threshold with no patient identity match at all.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreClaimAgainstRemittanceLine,
  isAutoMatch,
  AUTO_MATCH_THRESHOLD,
} from '../services/eraMatchScoring';

const cptCodeById = new Map<number, string>([
  [10, '97110'],
  [11, '97530'],
  [12, '90837'],
]);

const strangersClaim = {
  patientFirstName: 'Michael',
  patientLastName: 'Okonkwo',
  totalAmount: '300.00',
};

const janesClaim = {
  patientFirstName: 'Jane',
  patientLastName: 'Doe',
  totalAmount: '200.00',
};

const janesEraLine = {
  patientName: 'Jane Doe',
  serviceDate: '2026-08-01',
  cptCode: '97110',
  chargedAmount: '200.00',
};

describe('identity is required, not merely scored', () => {
  it('refuses to match a stranger, even with a perfect date and CPT agreement', () => {
    // Same day, same procedure — routine in a busy clinic, and not evidence
    // of who the patient is.
    const claimLines = [{ dateOfService: '2026-08-01', cptCodeId: 10 }];

    const candidate = scoreClaimAgainstRemittanceLine(
      strangersClaim,
      claimLines,
      janesEraLine,
      cptCodeById,
    );

    expect(candidate.identityScore).toBe(0);
    expect(isAutoMatch(candidate)).toBe(false);
  });

  it('does not let a multi-line claim reach the threshold on volume alone', () => {
    // The old scoring added 20 + 15 PER LINE. Five lines = 175 points with
    // nobody's name matching.
    const manyLines = Array.from({ length: 5 }, () => ({
      dateOfService: '2026-08-01',
      cptCodeId: 10,
    }));

    const candidate = scoreClaimAgainstRemittanceLine(
      strangersClaim,
      manyLines,
      janesEraLine,
      cptCodeById,
    );

    expect(candidate.identityScore).toBe(0);
    // Corroboration is capped at one date + one CPT, not five of each.
    expect(candidate.score).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(isAutoMatch(candidate)).toBe(false);
  });

  it('matches the right patient', () => {
    const candidate = scoreClaimAgainstRemittanceLine(
      janesClaim,
      [{ dateOfService: '2026-08-01', cptCodeId: 10 }],
      janesEraLine,
      cptCodeById,
    );

    expect(candidate.identityScore).toBe(40);
    expect(candidate.matchTypes).toContain('exact_name');
    expect(isAutoMatch(candidate)).toBe(true);
  });
});

describe('CPT scoring compares actual codes', () => {
  it('awards nothing when the codes differ', () => {
    const candidate = scoreClaimAgainstRemittanceLine(
      janesClaim,
      [{ dateOfService: '2020-01-01', cptCodeId: 12 }], // 90837, ERA says 97110
      { ...janesEraLine, chargedAmount: '999.00' },
      cptCodeById,
    );

    expect(candidate.matchTypes).not.toContain('cpt');
    // Identity still stands on its own.
    expect(candidate.score).toBe(40);
  });

  it('awards the CPT signal only once even when several lines carry the code', () => {
    const candidate = scoreClaimAgainstRemittanceLine(
      janesClaim,
      [
        { dateOfService: '2020-01-01', cptCodeId: 10 },
        { dateOfService: '2020-01-01', cptCodeId: 10 },
        { dateOfService: '2020-01-01', cptCodeId: 10 },
      ],
      { ...janesEraLine, chargedAmount: '999.00' },
      cptCodeById,
    );

    // 40 identity + 15 CPT (once), no date match, no amount match.
    expect(candidate.score).toBe(55);
  });

  it('awards nothing for an unknown cpt id rather than assuming a match', () => {
    const candidate = scoreClaimAgainstRemittanceLine(
      janesClaim,
      [{ dateOfService: '2020-01-01', cptCodeId: 999 }],
      { ...janesEraLine, chargedAmount: '999.00' },
      cptCodeById,
    );

    expect(candidate.matchTypes).not.toContain('cpt');
    expect(candidate.score).toBe(40);
  });
});

describe('partial identity still counts', () => {
  it('accepts a last-name + first-name match', () => {
    const candidate = scoreClaimAgainstRemittanceLine(
      { patientFirstName: 'Jane', patientLastName: 'Doe', totalAmount: '200.00' },
      [{ dateOfService: '2026-08-01', cptCodeId: 10 }],
      { ...janesEraLine, patientName: 'Doe, Jane' },
      cptCodeById,
    );

    expect(candidate.identityScore).toBeGreaterThan(0);
    expect(isAutoMatch(candidate)).toBe(true);
  });

  it('does not treat an empty claim name as matching an empty ERA name', () => {
    const candidate = scoreClaimAgainstRemittanceLine(
      { patientFirstName: '', patientLastName: '', totalAmount: '200.00' },
      [{ dateOfService: '2026-08-01', cptCodeId: 10 }],
      { ...janesEraLine, patientName: '' },
      cptCodeById,
    );

    expect(candidate.identityScore).toBe(0);
    expect(isAutoMatch(candidate)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { isValidNpi, parseNppesResponse } from '../services/npiValidation';
import {
  mapTransactionTypeToStedi,
  mapStediEnrollmentStatus,
} from '../services/stediEnrollmentService';
import {
  mapStediTransactionKey,
  normalizeStediResponse,
  mapStediStatus,
} from '../services/stediEnrollmentMappers';
import { computeReadiness } from '../services/enrollmentReadiness';

describe('isValidNpi', () => {
  it('accepts known-valid NPIs (correct Luhn check digit)', () => {
    expect(isValidNpi('1234567893')).toBe(true); // canonical valid test NPI
    expect(isValidNpi('1245319599')).toBe(true);
  });

  it('rejects the universal dummy NPI 1234567890', () => {
    expect(isValidNpi('1234567890')).toBe(false);
  });

  it('rejects wrong length / non-numeric / empty', () => {
    expect(isValidNpi('123456789')).toBe(false);
    expect(isValidNpi('12345678901')).toBe(false);
    expect(isValidNpi('abcdefghij')).toBe(false);
    expect(isValidNpi('')).toBe(false);
    expect(isValidNpi(null)).toBe(false);
    expect(isValidNpi(undefined)).toBe(false);
  });

  it('tolerates formatting characters', () => {
    expect(isValidNpi('1234567893')).toBe(isValidNpi(' 123-456-7893 '));
  });
});

describe('parseNppesResponse', () => {
  it('parses an organization (NPI-2) result', () => {
    const data = {
      result_count: 1,
      results: [
        {
          enumeration_type: 'NPI-2',
          basic: { organization_name: 'Healing Hands OT LLC' },
          addresses: [
            { address_purpose: 'LOCATION', address_1: '500 Main St', city: 'Newark', state: 'NJ', postal_code: '071021234' },
            { address_purpose: 'MAILING', address_1: 'PO Box 1' },
          ],
          taxonomies: [{ code: '225X00000X', desc: 'Occupational Therapist', primary: true }],
        },
      ],
    };
    const r = parseNppesResponse('1234567893', data);
    expect(r.found).toBe(true);
    expect(r.enumerationType).toBe('NPI-2');
    expect(r.name).toBe('Healing Hands OT LLC');
    expect(r.address?.city).toBe('Newark');
    expect(r.address?.state).toBe('NJ');
    expect(r.address?.zip).toBe('07102');
    expect(r.taxonomyCode).toBe('225X00000X');
  });

  it('parses an individual (NPI-1) result', () => {
    const data = {
      result_count: 1,
      results: [
        {
          enumeration_type: 'NPI-1',
          basic: { first_name: 'Jane', last_name: 'Doe' },
          addresses: [{ address_purpose: 'LOCATION', city: 'Albany', state: 'NY', postal_code: '12207' }],
          taxonomies: [{ code: '101YM0800X', desc: 'Counselor', primary: true }],
        },
      ],
    };
    const r = parseNppesResponse('1245319599', data);
    expect(r.found).toBe(true);
    expect(r.name).toBe('Jane Doe');
  });

  it('returns not_registered for empty results', () => {
    expect(parseNppesResponse('1234567893', { result_count: 0, results: [] }).found).toBe(false);
  });
});

describe('mapTransactionTypeToStedi', () => {
  it('maps local types to Stedi transaction values', () => {
    expect(mapTransactionTypeToStedi('eligibility')).toBe('eligibilityCheck');
    expect(mapTransactionTypeToStedi('claims')).toBe('professionalClaimSubmission');
    expect(mapTransactionTypeToStedi('era')).toBe('claimPayment');
  });
});

describe('mapStediEnrollmentStatus', () => {
  it('maps the 6-state lifecycle to our enum', () => {
    expect(mapStediEnrollmentStatus('LIVE')).toBe('enrolled');
    expect(mapStediEnrollmentStatus('REJECTED')).toBe('rejected');
    expect(mapStediEnrollmentStatus('DRAFT')).toBe('pending');
    expect(mapStediEnrollmentStatus('STEDI_ACTION_REQUIRED')).toBe('pending');
    expect(mapStediEnrollmentStatus('PROVIDER_ACTION_REQUIRED')).toBe('pending');
    expect(mapStediEnrollmentStatus('PROVISIONING')).toBe('pending');
    expect(mapStediEnrollmentStatus(null)).toBe('not_enrolled');
    expect(mapStediEnrollmentStatus('WITHDRAWN')).toBe('not_enrolled');
  });

  it('sync mapStediStatus delegates to the same map', () => {
    expect(mapStediStatus('LIVE')).toBe('enrolled');
    expect(mapStediStatus('PROVISIONING')).toBe('pending');
  });
});

describe('mapStediTransactionKey', () => {
  it('maps claimPayment to era (not claims)', () => {
    expect(mapStediTransactionKey('claimPayment')).toBe('era');
  });
  it('maps claim submission/status to claims', () => {
    expect(mapStediTransactionKey('professionalClaimSubmission')).toBe('claims');
    expect(mapStediTransactionKey('institutionalClaimSubmission')).toBe('claims');
    expect(mapStediTransactionKey('claimStatus')).toBe('claims');
  });
  it('maps eligibilityCheck to eligibility', () => {
    expect(mapStediTransactionKey('eligibilityCheck')).toBe('eligibility');
  });
  it('returns null for unknown keys', () => {
    expect(mapStediTransactionKey('somethingElse')).toBeNull();
  });
});

describe('normalizeStediResponse', () => {
  it('expands a transactions-object enrollment into per-transaction rows', () => {
    const data = {
      items: [
        {
          id: 'enr_1',
          payer: { name: 'Aetna', stediId: '60054' },
          transactions: {
            eligibilityCheck: { status: 'LIVE' },
            claimPayment: { status: 'PROVISIONING' },
          },
        },
      ],
    };
    const rows = normalizeStediResponse(data);
    expect(rows).toHaveLength(2);
    const era = rows.find((r) => r.transactionType === 'era');
    const elig = rows.find((r) => r.transactionType === 'eligibility');
    expect(era?.status).toBe('pending');
    expect(era?.payerName).toBe('Aetna');
    expect(era?.payerId).toBe('60054');
    expect(elig?.status).toBe('enrolled');
  });

  it('handles transactions as an array of names using item status', () => {
    const data = [
      { payerName: 'Cigna', payerId: '62308', status: 'LIVE', transactions: ['claimPayment'] },
    ];
    const rows = normalizeStediResponse(data);
    expect(rows).toHaveLength(1);
    expect(rows[0].transactionType).toBe('era');
    expect(rows[0].status).toBe('enrolled');
  });

  it('still handles the legacy flat shape', () => {
    const data = {
      enrollments: [
        { payerName: 'UHC', payerId: '87726', transactionType: 'eligibility', status: 'APPROVED' },
      ],
    };
    const rows = normalizeStediResponse(data);
    expect(rows).toHaveLength(1);
    expect(rows[0].transactionType).toBe('eligibility');
    expect(rows[0].status).toBe('enrolled');
  });

  it('returns empty for unrecognized payload', () => {
    expect(normalizeStediResponse({})).toEqual([]);
    expect(normalizeStediResponse(null)).toEqual([]);
  });
});

describe('computeReadiness', () => {
  const complete = {
    name: 'Real Practice LLC',
    npi: '1234567893',
    npiType: 'organization',
    taxId: '{"ciphertext":"x","iv":"y","tag":"z"}',
    addressStreet: '500 Main St',
    addressCity: 'Newark',
    addressState: 'NJ',
    addressZip: '07102',
    billingContactName: 'Jane Doe',
    billingContactEmail: 'jane@practice.com',
    taxonomyCode: '225X00000X',
    enrollmentAuthorizedAt: new Date(),
    stediProviderId: 'prov_123',
  };

  it('reports complete when all required fields present', () => {
    const r = computeReadiness(complete);
    expect(r.complete).toBe(true);
    expect(r.npiValid).toBe(true);
    expect(r.authorized).toBe(true);
    expect(r.hasStediProvider).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it('flags the placeholder NPI as invalid', () => {
    const r = computeReadiness({ ...complete, npi: '1234567890' });
    expect(r.npiValid).toBe(false);
    expect(r.complete).toBe(false);
    expect(r.missing.some((m) => m.startsWith('npi'))).toBe(true);
  });

  it('accepts legacy single-line address as a fallback', () => {
    const { addressStreet, addressCity, addressState, addressZip, ...rest } = complete;
    const r = computeReadiness({ ...rest, address: '123 Therapy Lane, City, NJ 07000' });
    expect(r.missing).not.toContain('billing address');
  });

  it('lists missing fields for an empty practice', () => {
    const r = computeReadiness({});
    expect(r.complete).toBe(false);
    expect(r.missing).toContain('name');
    expect(r.missing).toContain('taxId');
    expect(r.missing).toContain('enrollment authorization');
  });
});

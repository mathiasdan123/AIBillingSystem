/**
 * Claim dry run — rehearsing an 837P without filing it.
 *
 * `usageIndicator` did not appear anywhere in this codebase. Stedi's rule is
 * that "all API claim submissions are sent as production claims unless you
 * explicitly designate them as test data", so every submission this system
 * could make was a real claim to a real payer. There was no way to rehearse
 * one — which mattered enormously, because the claims code path had never once
 * succeeded against Stedi (the endpoint 404'd silently until it was
 * corrected) and the first claim a practice ever filed was also the first test
 * of that fix.
 *
 * 'T' routes the claim to Stedi's test clearinghouse, which returns a 277CA
 * and never forwards to the payer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchMock, mockStorage } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  mockStorage: { getPractice: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/phiEncryptionService', () => ({
  decryptField: (v: any) => v,
  encryptField: (v: any) => v,
}));

import { build837P, submitClaim, parseOneLineAddress, isCompleteAddress, toStediPhone, describeIncompleteAddress, normalizeZip } from '../services/stediService';

// Shaped to the real ClaimSubmission interface, so build837P exercises the
// same code path a genuine submission takes.
const CLAIM: any = {
  claimId: 'CLM-1',
  totalAmount: 250,
  placeOfService: '11',
  dateOfService: '2026-08-12',
  patient: {
    firstName: 'Eliyahu',
    lastName: 'Stein',
    dateOfBirth: '2015-04-02',
    gender: 'M',
    address: { line1: '1 Main St', city: 'Lakewood', state: 'NJ', zip: '08701' },
    memberId: 'M1',
  },
  provider: {
    npi: '1234567890',
    taxId: '12-3456789',
    organizationName: 'Wonderkids',
    address: { line1: '2 Clinic Way', city: 'Lakewood', state: 'NJ', zip: '08701' },
  },
  payer: { id: '22099', name: 'Horizon BCBS NJ' },
  serviceLines: [
    {
      procedureCode: '97153',
      diagnosisCodes: ['F80.2'],
      amount: 250,
      units: 1,
      dateOfService: '2026-08-12',
    },
  ],
  diagnosisCodes: ['F80.2'],
};

const bodyOf = (call: any) => JSON.parse(call[1].body);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STEDI_API_KEY = 'GLOBAL_KEY';
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ claimReference: {} }) });
  mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: false, stediApiKey: 'K' });
});

describe('build837P usageIndicator', () => {
  it("is always 'P' — the production key refuses 'T' outright", () => {
    // Learned live: Stedi answered usageIndicator 'T' on the production key
    // with TA1 error 33, "The Production API Key is not permitted to submit
    // test transactions". Rehearsal safety is the VALIDATION endpoint, not
    // this flag.
    expect(build837P(CLAIM).usageIndicator).toBe('P');
    expect(build837P(CLAIM, true).usageIndicator).toBe('P');
  });
});

describe('submitClaim test mode', () => {
  it('POSTs a dry run to the VALIDATION endpoint — the path that cannot transmit', async () => {
    await submitClaim(CLAIM, 1, { testMode: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/professionalclaims/v3/validation');
    expect(fetchMock.mock.calls[0][0]).not.toContain('/submission');
  });

  it('POSTs a real submission to the SUBMISSION endpoint', async () => {
    await submitClaim(CLAIM, 1);

    expect(fetchMock.mock.calls[0][0]).toContain('/professionalclaims/v3/submission');
    expect(bodyOf(fetchMock.mock.calls[0]).usageIndicator).toBe('P');
  });

  it('lets a SANDBOX practice run a dry run', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: true });

    const result = await submitClaim(CLAIM, 1, { testMode: true });

    // A test claim never reaches the payer, so refusing it would leave sandbox
    // mode with no way to test anything — the opposite of its purpose. What
    // matters is that the SANDBOX GUARD did not block it: the request went out
    // and was marked test data. Whether the (mocked) clearinghouse then
    // accepted the body is a different question and not what this pins.
    expect(result.errors?.join(' ') ?? '').not.toMatch(/sandbox mode/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Sandbox rehearsals go to validation too — that endpoint cannot transmit.
    expect(fetchMock.mock.calls[0][0]).toContain('/validation');
  });

  it('still refuses a REAL submission from a sandbox practice', async () => {
    mockStorage.getPractice.mockResolvedValue({ id: 1, sandboxMode: true });

    const result = await submitClaim(CLAIM, 1);

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toMatch(/sandbox mode/i);
    // Nothing may go over the wire.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a real submission with no practice context', async () => {
    const result = await submitClaim(CLAIM, undefined);

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('837P payload matches the documented schema', () => {
  /**
   * Stedi's parser is strict — an unknown field is a hard rejection naming
   * it. The first dry runs ever executed rejected one guessed field per run:
   *   Subscriber.address.line1  -> address1/postalCode (fixed first)
   *   Billing.taxId             -> employerId
   * and the builder contained four more the parser had not reached yet: the
   * dependent block was named "patient", releaseOfInformationCode is spelled
   * releaseInformationCode, diagnoses go in healthCareCodeInformation, and
   * service lines live INSIDE claimInformation with a professionalService
   * block. Each of those would have cost a full deploy cycle to discover.
   * This suite pins the whole shape at once.
   */
  const KNOWN_BAD_FIELDS = [
    '"line1"', '"zip"', '"taxId"', '"releaseOfInformationCode"',
    '"diagnosisCodes"', '"patient"', '"chargeAmount"', '"unitCount"',
  ];

  it('never emits a field name the parser has rejected or would reject', () => {
    const serialized = JSON.stringify(build837P({
      ...CLAIM,
      subscriber: {
        firstName: 'Parent', lastName: 'Stein', dateOfBirth: '1985-01-01',
        memberId: 'M1', relationshipToPatient: 'child',
      },
    }));

    for (const bad of KNOWN_BAD_FIELDS) {
      expect(serialized).not.toContain(bad);
    }
  });

  it('expresses the tax id as employerId, digits only', () => {
    const payload = build837P(CLAIM);
    // "12-3456789" is display formatting; the schema wants the EIN digits.
    expect(payload.billing.employerId).toBe('123456789');
    expect('taxId' in payload.billing).toBe(false);
  });

  it('names the dependent block "dependent" and dates as CCYYMMDD', () => {
    const payload = build837P({
      ...CLAIM,
      subscriber: {
        firstName: 'Parent', lastName: 'Stein', dateOfBirth: '1985-01-01',
        memberId: 'M1', relationshipToPatient: 'child',
      },
    });

    expect(payload.dependent.firstName).toBe('Eliyahu');
    expect(payload.dependent.dateOfBirth).toBe('20150402');
    expect(payload.subscriber.dateOfBirth).toBe('19850101');
    // The parent's gender is unknown — 'U' is honest; copying the child's is not.
    expect(payload.subscriber.gender).toBe('U');
  });

  it('puts service lines inside claimInformation with a professionalService block', () => {
    const payload = build837P(CLAIM);

    expect(payload.serviceLines).toBeUndefined();
    const [line] = payload.claimInformation.serviceLines;
    expect(line.serviceDate).toBe('20260812');
    expect(line.professionalService.procedureCode).toBe('97153');
    expect(line.professionalService.lineItemChargeAmount).toBe('250');
    expect(line.professionalService.serviceUnitCount).toBe('1');
    expect(line.professionalService.compositeDiagnosisCodePointers.diagnosisCodePointers).toEqual(['1']);
  });

  it('emits no bare integer anywhere — this schema wants strings', () => {
    // The parser rejected diagnosisCodePointers: [1] with "invalid type:
    // integer, expected a string". Rather than pin that one field, assert the
    // whole payload: every numeric value is emitted as a string.
    const serialized = JSON.stringify(build837P(CLAIM));
    expect(serialized).not.toMatch(/:\s*\d+[,}\]]/);
    expect(serialized).not.toMatch(/\[\d+[,\]]/);
  });

  it('carries diagnoses as healthCareCodeInformation without the dot', () => {
    const payload = build837P(CLAIM);

    expect(payload.claimInformation.healthCareCodeInformation).toEqual([
      { diagnosisTypeCode: 'ABK', diagnosisCode: 'F802' },
    ]);
    expect(payload.claimInformation.releaseInformationCode).toBe('Y');
    expect(payload.claimInformation.claimFilingCode).toBe('CI');
    expect(payload.claimInformation.benefitsAssignmentCertificationIndicator).toBe('Y');
  });
});

describe('837P address field names', () => {
  /**
   * Stedi rejected the first-ever dry run with:
   *   Subscriber.address.line1: unknown field 'line1', expected one of
   *   'address1', 'address2', 'city', 'state', 'postalCode', ...
   *
   * Internal addresses are { line1, zip }; Stedi wants { address1, postalCode }.
   * The payload passed our objects through verbatim, so every submission
   * carrying an address — meaning every submission — would have been rejected.
   * This is the concrete proof the claims path had never once succeeded.
   */
  it('emits address1/postalCode, never line1/zip, on every address block', () => {
    const payload = build837P({
      ...CLAIM,
      subscriber: {
        firstName: 'Parent',
        lastName: 'Stein',
        dateOfBirth: '1985-01-01',
        memberId: 'M1',
        relationshipToPatient: 'child',
      },
    });

    const serialized = JSON.stringify(payload);
    // The exact fields Stedi rejected.
    expect(serialized).not.toContain('"line1"');
    expect(serialized).not.toContain('"zip"');

    expect(payload.subscriber.address).toEqual({
      address1: '1 Main St',
      city: 'Lakewood',
      state: 'NJ',
      postalCode: '08701',
    });
    // Dependent block and billing block get the same mapping.
    expect(payload.dependent.address.address1).toBe('1 Main St');
    expect(payload.billing.address.address1).toBe('2 Clinic Way');
    expect(payload.billing.address.postalCode).toBe('08701');
  });

  it('omits address2 rather than sending an empty field', () => {
    const payload = build837P(CLAIM);
    expect('address2' in payload.subscriber.address).toBe(false);
  });
});

describe('one-line address parsing and phone normalization', () => {
  /**
   * The fifth dry run reached the clearinghouse's CONTENT edits and rejected
   * on data: "Missing Country Code / Invalid State" for subscriber and
   * billing, and "Invalid Telephone number 0000000000" for the submitter.
   *
   * Root causes: the route's parser split addresses on commas only, so a
   * comma-less address produced empty city/state/zip that went on the wire;
   * and the submitter phone was a hardcoded placeholder the clearinghouse
   * rejects by rule (must not start 0 or 1).
   */
  it("parses the comma-less address that failed live", () => {
    // As stored on the real patient record.
    expect(parseOneLineAddress('70 VAN VALKENBURG AVE ATLANTA GA 30305')).toEqual({
      line1: '70 VAN VALKENBURG AVE ATLANTA',
      city: '',
      state: 'GA',
      zip: '30305',
    });
    // Comma-less: state+zip recovered; street/city split needs the comma, so
    // completeness validation still (correctly) demands the comma form.
  });

  it('parses the guided "Street, City, ST 12345" form completely', () => {
    expect(parseOneLineAddress('70 Van Valkenburg Ave, Lakewood, NJ 08701')).toEqual({
      line1: '70 Van Valkenburg Ave',
      city: 'Lakewood',
      state: 'NJ',
      zip: '08701',
    });
  });

  it('handles a ZIP+4 and stray commas', () => {
    expect(parseOneLineAddress('1 Main St, Springfield, MA, 01103-2200')).toEqual({
      line1: '1 Main St',
      city: 'Springfield',
      state: 'MA',
      zip: '01103',
    });
  });

  it('isCompleteAddress refuses what the clearinghouse would refuse', () => {
    // Empty city/state/zip — exactly what went on the wire live.
    expect(isCompleteAddress(parseOneLineAddress('70 VAN VALKENBURG AVE'))).toBe(false);
    expect(isCompleteAddress(parseOneLineAddress('70 Van Valkenburg Ave, Lakewood, NJ 08701'))).toBe(true);
  });

  /**
   * The submit route used to return the patient-address, practice-address and
   * submitter-phone blockers as three sequential early-returns, so a practice
   * missing all three learned about them one test run at a time. The error now
   * names the specific parts, and the route reports every blocker at once.
   */
  it('names the parts an address is actually missing, not all four', () => {
    expect(describeIncompleteAddress({ line1: '1 Main St', city: '', state: 'NJ', zip: '08701' }))
      .toBe('city');
    expect(describeIncompleteAddress({ line1: '1 Main St', city: '', state: '', zip: '08701' }))
      .toBe('city and state');
    expect(describeIncompleteAddress({ line1: '', city: '', state: '', zip: '' }))
      .toBe('street, city, state and ZIP');
    expect(describeIncompleteAddress(parseOneLineAddress('70 Van Valkenburg Ave, Lakewood, NJ 08701')))
      .toBe('');
  });

  it('quotes a present-but-malformed value instead of calling it missing', () => {
    // "missing ZIP" when you just typed a ZIP sends you back to stare at a
    // filled-in box. Name the value that was rejected.
    expect(describeIncompleteAddress({ line1: '1 Main St', city: 'Lakewood', state: 'NJ', zip: '087' }))
      .toBe('ZIP ("087" is not a 5-digit or ZIP+4 code)');
    expect(describeIncompleteAddress({ line1: '1 Main St', city: 'Lakewood', state: 'New Jersey', zip: '08701' }))
      .toBe('state ("New Jersey" is not a 2-letter code)');
    // Genuinely blank still reads as missing, not as a quoted empty string.
    expect(describeIncompleteAddress({ line1: '1 Main St', city: 'Lakewood', state: 'NJ', zip: '' }))
      .toBe('ZIP');
  });

  /**
   * The column is varchar(10) — sized for "12345-6789" — but the check was
   * /^\d{5}$/, so a typed ZIP+4 was reported to the user as a MISSING ZIP.
   */
  it('accepts ZIP+4, which the form has always invited', () => {
    expect(normalizeZip('08701')).toBe('08701');
    expect(normalizeZip('08701-1234')).toBe('087011234');
    expect(normalizeZip('08701 1234')).toBe('087011234');
    // Not a ZIP: too short (a spreadsheet eating the leading zero), too long.
    expect(normalizeZip('8701')).toBeNull();
    expect(normalizeZip('0870112345')).toBeNull();
    expect(normalizeZip('')).toBeNull();
    expect(normalizeZip(null)).toBeNull();

    const zipPlus4 = { line1: '1 Main St', city: 'Lakewood', state: 'NJ', zip: '08701-1234' };
    expect(isCompleteAddress(zipPlus4)).toBe(true);
    expect(describeIncompleteAddress(zipPlus4)).toBe('');
  });

  it('sends the postal code as digits — a hyphen must not reach the payer', () => {
    const claim = {
      ...CLAIM,
      provider: {
        ...CLAIM.provider,
        address: { line1: '2 Clinic Way', city: 'Lakewood', state: 'NJ', zip: '08701-1234' },
      },
    };
    const json = JSON.stringify(build837P(claim));
    expect(json).not.toContain('08701-1234');
    expect(json).toContain('087011234');
  });

  it('normalizes phones and refuses the placeholder the clearinghouse named', () => {
    expect(toStediPhone('(555) 123-4567')).toBe('5551234567');
    expect(toStediPhone('1-555-123-4567')).toBe('5551234567');
    // "Area codes and phone numbers must not begin with 0 or 1."
    expect(toStediPhone('0000000000')).toBeNull();
    expect(toStediPhone('1234567890')).toBeNull();
    expect(toStediPhone('')).toBeNull();
    expect(toStediPhone(null)).toBeNull();
  });
});

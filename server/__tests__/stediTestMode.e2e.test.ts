/**
 * End-to-end claims lifecycle against Stedi TEST MODE (real network).
 *
 * Runs ONLY when STEDI_TEST_API_KEY is set to a Stedi test key ("test_"
 * prefix) — otherwise every test here is skipped, so `npm test` stays
 * offline. In CI the key comes from the STEDI_TEST_API_KEY secret.
 *
 * Why this exists: the ERA poller discarded real remittances for months
 * because nothing ever exercised our Stedi parsing against Stedi's actual
 * output (see fix/era-poller-835-detection). Test mode closes that gap —
 * submitting to the Stedi Test Payer (payer id "STEDI") produces a real
 * test 277CA and test 835 within minutes.
 *
 * Fast path (always, with key): submit a claim, assert acceptance.
 * Full path (STEDI_E2E_FULL=1): poll until the test 835 lands, fetch the
 * report, and run it through our normalizer — the exact pipeline production
 * uses for money data.
 */
import { describe, expect, it } from 'vitest';
import { fetch835Report, is835, pollTransactions } from '../services/stediEraService';
import { normalizeStedi835 } from '../services/stedi835Normalizer';

const TEST_KEY = process.env.STEDI_TEST_API_KEY ?? '';
const FULL = process.env.STEDI_E2E_FULL === '1';
const BASE = process.env.STEDI_HEALTHCARE_BASE || 'https://healthcare.us.stedi.com/2024-04-01';
const SUBMIT_PATH = '/change/medicalnetwork/professionalclaims/v3/submission';

const hasTestKey = TEST_KEY.startsWith('test_');

function controlNumber(): string {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}

/** Minimal valid 837P mirroring stediService's schema quirks (CCYYMMDD dates,
 * digits-only employerId, string diagnosis pointers, serviceLines nested in
 * claimInformation). Fictional data throughout. */
function testClaimPayload(patientControlNumber: string) {
  return {
    controlNumber: controlNumber(),
    usageIndicator: 'T',
    tradingPartnerServiceId: 'STEDI',
    submitter: {
      organizationName: 'Wonder Kids Therapy Center LLC',
      contactInformation: { name: 'Wonder Kids Therapy Center LLC', phoneNumber: '2015550100' },
    },
    receiver: { organizationName: 'Stedi Test Payer' },
    subscriber: {
      memberId: 'STEDITEST01',
      paymentResponsibilityLevelCode: 'P',
      firstName: 'Testparent',
      lastName: 'Example',
      dateOfBirth: '19900101',
      gender: 'U',
      address: { address1: '1 Test Way', city: 'Bergenfield', state: 'NJ', postalCode: '07621' },
    },
    billing: {
      providerType: 'BillingProvider',
      npi: '1023896321',
      employerId: '863309083',
      taxonomyCode: '225X00000X',
      organizationName: 'Wonder Kids Therapy Center LLC',
      address: { address1: '1 Test Way', city: 'Bergenfield', state: 'NJ', postalCode: '07621' },
      contactInformation: { name: 'Wonder Kids Therapy Center LLC', phoneNumber: '2015550100' },
    },
    rendering: {
      providerType: 'RenderingProvider',
      npi: '1023896321',
      taxonomyCode: '225X00000X',
      organizationName: 'Wonder Kids Therapy Center LLC',
    },
    claimInformation: {
      claimFilingCode: 'CI',
      patientControlNumber,
      claimChargeAmount: '175.00',
      placeOfServiceCode: '11',
      claimFrequencyCode: '1',
      signatureIndicator: 'Y',
      planParticipationCode: 'A',
      releaseInformationCode: 'Y',
      benefitsAssignmentCertificationIndicator: 'Y',
      healthCareCodeInformation: [{ diagnosisTypeCode: 'ABK', diagnosisCode: 'F840' }],
      serviceLines: [
        {
          serviceDate: '20260901',
          professionalService: {
            procedureIdentifier: 'HC',
            procedureCode: '97530',
            lineItemChargeAmount: '175.00',
            measurementUnit: 'UN',
            serviceUnitCount: '1',
            compositeDiagnosisCodePointers: { diagnosisCodePointers: ['1'] },
          },
        },
      ],
    },
  };
}

describe.skipIf(!hasTestKey)('Stedi end-to-end test mode', () => {
  const patientControlNumber = `E2E-${Date.now()}`;
  const submittedAt = new Date();

  it('submits a professional claim to the Stedi Test Payer and is accepted', async () => {
    const res = await fetch(`${BASE}${SUBMIT_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Key ${TEST_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(testClaimPayload(patientControlNumber)),
    });
    const body: any = await res.json();
    expect(res.ok, `submission failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`).toBe(true);
    // A usable acceptance carries a claim reference and no rejection errors.
    expect(body.claimReference ?? body.controlNumber).toBeTruthy();
    const errors = body.errors ?? body.failure ?? null;
    expect(errors, `claim rejected: ${JSON.stringify(errors).slice(0, 400)}`).toBeFalsy();
  }, 60_000);

  it.skipIf(!FULL)(
    'produces a test 835 that our poller detects and our normalizer parses',
    async () => {
      // Poll the same code path production uses until the simulated ERA lands.
      const deadline = Date.now() + 270_000;
      let eraTransactionId: string | null = null;
      while (Date.now() < deadline && !eraTransactionId) {
        const page = await pollTransactions({
          apiKey: TEST_KEY,
          startDateTime: submittedAt.toISOString(),
        });
        const era = page.transactions.find(is835);
        if (era) eraTransactionId = era.transactionId;
        else await new Promise((r) => setTimeout(r, 10_000));
      }
      expect(eraTransactionId, 'no test 835 appeared within the polling window').toBeTruthy();

      const report = await fetch835Report({ apiKey: TEST_KEY, transactionId: eraTransactionId! });
      const normalized = normalizeStedi835(report);
      expect(normalized.payerName).toBeTruthy();
      expect(Number(normalized.totalPaymentAmount)).not.toBeNaN();
      expect(normalized.lineItems.length).toBeGreaterThan(0);
    },
    300_000,
  );
});

describe.skipIf(hasTestKey)('Stedi end-to-end test mode (skipped)', () => {
  it('is skipped because STEDI_TEST_API_KEY is not configured', () => {
    expect(hasTestKey).toBe(false);
  });
});

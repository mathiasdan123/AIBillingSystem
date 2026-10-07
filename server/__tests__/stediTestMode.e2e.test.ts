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
 * Full path (STEDI_E2E_FULL=1): submit three claims — paid, partially paid,
 * and denied, selected via Stedi's member-id prefixes (STEDI_PAID_,
 * STEDI_PARTIALLY_PAID_, STEDI_DENIED_; changelog 2026-10) — poll until each
 * test 835 lands, and run every one through our normalizer: the exact
 * pipeline production uses for money data. Before this, test ERAs were
 * always paid-in-full, so denial and partial-payment handling had no
 * end-to-end coverage.
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
function testClaimPayload(patientControlNumber: string, memberId = 'STEDI_PAID_E2E01') {
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
      memberId,
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

async function submitTestClaim(patientControlNumber: string, memberId?: string): Promise<void> {
  const res = await fetch(`${BASE}${SUBMIT_PATH}`, {
    method: 'POST',
    headers: { Authorization: `Key ${TEST_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(testClaimPayload(patientControlNumber, memberId)),
  });
  const body: any = await res.json();
  expect(res.ok, `submission failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`).toBe(true);
  // A usable acceptance carries a claim reference and no rejection errors.
  expect(body.claimReference ?? body.controlNumber).toBeTruthy();
  const errors = body.errors ?? body.failure ?? null;
  expect(errors, `claim rejected: ${JSON.stringify(errors).slice(0, 400)}`).toBeFalsy();
}

describe.skipIf(!hasTestKey)('Stedi end-to-end test mode', () => {
  const runId = Date.now();
  const submittedAt = new Date();

  it('submits a professional claim to the Stedi Test Payer and is accepted', async () => {
    await submitTestClaim(`E2E-${runId}`);
  }, 60_000);

  it.skipIf(!FULL)(
    'paid, partially paid, and denied test 835s all flow through our normalizer correctly',
    async () => {
      // One claim per outcome, selected by Stedi's member-id prefix. Each
      // gets a distinct patient control number, which the payer echoes back
      // as CLP01 (lineItems[].claimReference) — the same key eraAutoMatchService
      // matches on in production.
      const scenarios = [
        { name: 'paid', pcn: `E2E-PAID-${runId}`, memberId: 'STEDI_PAID_E2E01' },
        { name: 'partial', pcn: `E2E-PART-${runId}`, memberId: 'STEDI_PARTIALLY_PAID_E2E01' },
        { name: 'denied', pcn: `E2E-DENY-${runId}`, memberId: 'STEDI_DENIED_E2E01' },
      ] as const;
      for (const s of scenarios) {
        await submitTestClaim(s.pcn, s.memberId);
      }

      // Poll the same code path production uses until every scenario's 835
      // has landed (they arrive independently), normalizing each report once.
      const deadline = Date.now() + 500_000;
      const seenTransactions = new Set<string>();
      const lineByPcn = new Map<string, import('../services/stedi835Normalizer').NormalizedLineItem>();
      while (Date.now() < deadline && lineByPcn.size < scenarios.length) {
        const page = await pollTransactions({
          apiKey: TEST_KEY,
          startDateTime: submittedAt.toISOString(),
        });
        for (const txn of page.transactions.filter(is835)) {
          if (seenTransactions.has(txn.transactionId)) continue;
          seenTransactions.add(txn.transactionId);
          const report = await fetch835Report({ apiKey: TEST_KEY, transactionId: txn.transactionId });
          const normalized = normalizeStedi835(report);
          expect(normalized.payerName).toBeTruthy();
          for (const line of normalized.lineItems) {
            if (line.claimReference && line.claimReference.includes(String(runId))) {
              lineByPcn.set(line.claimReference, line);
            }
          }
        }
        if (lineByPcn.size < scenarios.length) await new Promise((r) => setTimeout(r, 10_000));
      }
      expect(
        [...lineByPcn.keys()].sort(),
        'not every scenario produced a test 835 within the polling window'
      ).toEqual(scenarios.map((s) => s.pcn).sort());

      const paid = lineByPcn.get(`E2E-PAID-${runId}`)!;
      expect(paid.chargedAmount).toBe(175);
      expect(paid.paidAmount).toBe(paid.chargedAmount);

      const partial = lineByPcn.get(`E2E-PART-${runId}`)!;
      expect(partial.paidAmount).toBeGreaterThan(0);
      expect(partial.paidAmount).toBeLessThan(partial.chargedAmount);
      // The shortfall must be visible as structured data, not silently lost:
      // adjustments and/or patient responsibility account for the gap.
      const partialAccounted =
        partial.adjustmentAmount + (partial.patientResponsibility ?? 0) +
        (partial.contractualAdjustment ?? 0);
      expect(partialAccounted, 'partial payment shortfall carries no adjustment data').toBeGreaterThan(0);

      const denied = lineByPcn.get(`E2E-DENY-${runId}`)!;
      expect(denied.paidAmount).toBe(0);
      expect(
        denied.adjustmentReasonCodes.length,
        'denial carries no CAS reason codes — the denial pipeline would show an unexplained $0'
      ).toBeGreaterThan(0);
    },
    540_000,
  );
});

describe.skipIf(hasTestKey)('Stedi end-to-end test mode (skipped)', () => {
  it('is skipped because STEDI_TEST_API_KEY is not configured', () => {
    expect(hasTestKey).toBe(false);
  });
});

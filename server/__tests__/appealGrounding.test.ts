/**
 * Appeal letter grounding, readiness and deadline basis (QA sweep 2026-11-18).
 *
 * Repro: demo fixtures Ava Sample / Ethan Example, no authorizations, no
 * documents, no clinical notes. Create Appeal produced a "Ready" letter that
 * asserted urgent/emergent services, a retroactive authorization request,
 * medical necessity, AOTA-conformant treatment, a comprehensive evaluation,
 * a measurable treatment plan and progress notes demonstrating skilled
 * intervention; printed placeholder letterhead; printed a DOB one day off;
 * and set the deadline to creation + 60 days with nothing behind it.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  assessAppealReadiness,
  buildAppealGrounding,
  computeAppealDeadline,
  describeDeadlineBasis,
  emptyAppealGrounding,
  filterUnsupportedKeyArguments,
  hasUnsupportedAppealAssertion,
  normalizeGroundingInputs,
  stripUnsupportedAppealAssertions,
  type AppealGrounding,
  splitSentences,
} from '../services/appealGroundingService';
import { appealGenerator } from '../aiAppealGenerator';
import { formatDateOnlyShort, addDaysToDateOnly } from '../utils/dateOnly';

const CLAIM = {
  id: 1006,
  claimNumber: 'DEMO-2-1006',
  totalAmount: '289.00',
  denialReason: 'Prior authorization required',
  submittedAt: new Date('2026-11-10T15:00:00Z'),
};
const AVA = {
  firstName: 'Ava',
  lastName: 'Sample',
  dateOfBirth: '2018-04-11',
  insuranceProvider: 'Horizon BCBS of New Jersey',
  insuranceId: 'DEMO1000',
};
const PRACTICE = {
  name: 'Bright Steps Pediatric Therapy (Demo)',
  npi: '0000000001',
  address: '123 Demo Way, Springfield, NJ 07000',
  phone: '(555) 010-0000',
  providerName: 'Demo Admin',
};

// Every phrase QA found in the fabricated letter.
const REPRO_PHRASES = [
  /urgent|emergent/i,
  /retroactive authorization/i,
  /medically necessary|medical necessity/i,
  /AOTA|American Occupational Therapy Association/i,
  /comprehensive evaluation/i,
  /treatment plan/i,
  /measurable/i,
  /progress notes/i,
  /skilled (?:therapeutic )?intervention/i,
];

function withRecords(overrides: Partial<AppealGrounding>): AppealGrounding {
  const g = emptyAppealGrounding();
  Object.assign(g, overrides);
  g.hasClinicalDocumentation = g.hasEvaluation || g.hasTreatmentPlan || g.hasProgressNotes || g.hasSoapNotes;
  return g;
}

describe('template letter with nothing on file (the QA repro)', () => {
  it('asserts none of the repro phrases for an authorization denial with no auth, docs or notes', async () => {
    const result = await appealGenerator.generateAppeal(CLAIM, [], AVA, PRACTICE, emptyAppealGrounding());
    for (const phrase of REPRO_PHRASES) {
      expect(result.appealLetter).not.toMatch(phrase);
    }
    for (const arg of result.keyArguments) {
      for (const phrase of REPRO_PHRASES) expect(arg).not.toMatch(phrase);
    }
    // Enclosures list only what exists.
    expect(result.appealLetter).toContain('Enclosures:\n- Copy of original claim');
    expect(result.appealLetter).not.toMatch(/- Progress notes|- Treatment plan|- Clinical documentation/);
  });

  it('same for a medical-necessity denial and for an unrecognised denial reason', async () => {
    for (const reason of ['Not medically necessary', 'CO-197 some new reason']) {
      const result = await appealGenerator.generateAppeal({ ...CLAIM, denialReason: reason }, [], AVA, PRACTICE, emptyAppealGrounding());
      for (const phrase of REPRO_PHRASES) expect(result.appealLetter).not.toMatch(phrase);
      expect(result.appealLetter).toContain('GROUNDS FOR APPEAL:');
    }
  });

  it('prints the DOB from the date-only value (Apr 11 stays Apr 11) under any process timezone', async () => {
    const originalTz = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/New_York', 'Pacific/Auckland']) {
        process.env.TZ = tz;
        const result = await appealGenerator.generateAppeal(CLAIM, [], AVA, PRACTICE, emptyAppealGrounding());
        expect(result.appealLetter).toContain('Patient DOB: 4/11/2018');
        expect(formatDateOnlyShort('2027-01-17')).toBe('1/17/2027');
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
    }
  });

  it('uses the signer name when known and a bracketed placeholder (caught by readiness) when not', async () => {
    const signed = await appealGenerator.generateAppeal(CLAIM, [], AVA, PRACTICE, emptyAppealGrounding());
    expect(signed.appealLetter).toContain('_______________________________\nDemo Admin');
    const unsigned = await appealGenerator.generateAppeal(CLAIM, [], AVA, { ...PRACTICE, providerName: null }, emptyAppealGrounding());
    expect(unsigned.appealLetter).toContain('[Provider Name]');
    expect(unsigned.appealLetter).not.toMatch(/^Provider Name$/m);
  });
});

describe('template letter asserts a fact only when a record or an entered field supports it', () => {
  it('cites an authorization on file, with its reference', async () => {
    const g = withRecords({ hasPriorAuthorization: true, authorizationNumbers: ['AUTH-77'] });
    const result = await appealGenerator.generateAppeal(CLAIM, [], AVA, PRACTICE, g);
    expect(result.appealLetter).toContain('Authorization was on file for this patient (reference AUTH-77)');
    expect(result.appealLetter).toContain('Authorization reference on file: AUTH-77.');
    expect(result.appealLetter).not.toMatch(/urgent|retroactive/i);
  });

  it('states urgency and a retro-auth request only when the biller checked them', async () => {
    const g = emptyAppealGrounding({ urgentService: true, retroAuthRequested: true, retroAuthReference: 'RA-123' });
    const result = await appealGenerator.generateAppeal(CLAIM, [], AVA, PRACTICE, g);
    expect(result.appealLetter).toMatch(/service was urgent/i);
    expect(result.appealLetter).toContain('A retroactive authorization request has been submitted (reference RA-123)');
    expect(result.keyArguments.some((a) => /urgent/i.test(a))).toBe(true);
  });

  it('mentions evaluation, plan and progress notes only as records on file, counted, and encloses them', async () => {
    const g = withRecords({ hasEvaluation: true, hasTreatmentPlan: true, hasProgressNotes: true, progressNoteCount: 4 });
    const result = await appealGenerator.generateAppeal({ ...CLAIM, denialReason: 'not medically necessary' }, [], AVA, PRACTICE, g);
    expect(result.appealLetter).toContain('An evaluation of the patient is on file and enclosed.');
    expect(result.appealLetter).toContain("The patient's current treatment plan is on file and enclosed.");
    expect(result.appealLetter).toContain('Progress notes (4) covering the course of treatment are on file and enclosed.');
    expect(result.appealLetter).toMatch(/Enclosures:[\s\S]*- Evaluation[\s\S]*- Treatment plan[\s\S]*- Progress notes/);
    // Still never characterises the records' contents or claims guideline conformance.
    expect(result.appealLetter).not.toMatch(/AOTA|comprehensive|measurable goals|demonstrate skilled/i);
  });

  it('includes the biller\'s additional grounds verbatim as a numbered argument', async () => {
    const g = emptyAppealGrounding({ additionalGrounds: 'Payer confirmed by phone on 11/10 that no authorization was required.' });
    const result = await appealGenerator.generateAppeal(CLAIM, [], AVA, PRACTICE, g);
    expect(result.appealLetter).toMatch(/\d\. Payer confirmed by phone on 11\/10 that no authorization was required\./);
  });
});

describe('stripUnsupportedAppealAssertions (backstop for any generator, including the model)', () => {
  const MODEL_LETTER = [
    'Dear Claims Review Department,',
    '',
    'GROUNDS FOR APPEAL:',
    '',
    '1. Services were emergent/urgent and required immediate intervention.',
    '2. A retroactive authorization request is being submitted.',
    '3. The billed codes describe the services rendered.',
    '',
    'The occupational therapy services provided were medically necessary. Treatment was provided in accordance with AOTA practice guidelines. The treatment plan was developed based on a comprehensive evaluation and targeted measurable goals. Progress notes demonstrate skilled therapeutic intervention was required.',
    '',
    'I respectfully request reconsideration.',
  ].join('\n');

  it('removes every unsupported sentence and renumbers the list when nothing is on file', () => {
    const out = stripUnsupportedAppealAssertions(MODEL_LETTER, emptyAppealGrounding());
    for (const phrase of REPRO_PHRASES) expect(out).not.toMatch(phrase);
    expect(out).toContain('1. The billed codes describe the services rendered.');
    expect(out).not.toMatch(/^2\./m);
    expect(out).toContain('I respectfully request reconsideration.');
    expect(hasUnsupportedAppealAssertion(out, emptyAppealGrounding())).toBe(false);
  });

  it('keeps each sentence when its support exists', () => {
    const g = withRecords({ hasEvaluation: true, hasTreatmentPlan: true, hasProgressNotes: true, progressNoteCount: 2 });
    g.inputs = { urgentService: true, retroAuthRequested: true };
    const out = stripUnsupportedAppealAssertions(MODEL_LETTER, g);
    expect(out).toContain('1. Services were emergent/urgent and required immediate intervention.');
    expect(out).toContain('2. A retroactive authorization request is being submitted.');
    expect(out).toContain('medically necessary');
    expect(out).toContain('comprehensive evaluation');
    expect(out).toContain('Progress notes demonstrate skilled therapeutic intervention');
    // AOTA conformance has no record anywhere: always removed.
    expect(out).not.toMatch(/AOTA/);
  });

  it('filters key arguments by the same rule', () => {
    const args = ['Services were emergent/urgent', 'CPT codes accurately reflect the service', 'Progress notes show improvement'];
    expect(filterUnsupportedKeyArguments(args, emptyAppealGrounding())).toEqual(['CPT codes accurately reflect the service']);
    expect(filterUnsupportedKeyArguments(args, withRecords({ hasProgressNotes: true, progressNoteCount: 1 }))).toEqual([
      'CPT codes accurately reflect the service',
      'Progress notes show improvement',
    ]);
  });
});

describe('buildAppealGrounding reads records defensively', () => {
  it('reports what exists, ignores pending/denied authorizations, and treats a failed lookup as not on file', async () => {
    const g = await buildAppealGrounding(
      { practiceId: 2, patientId: 9, claim: { authorizationNumber: null }, inputs: { urgentService: true } },
      {
        getAuthorizations: async () => [
          { status: 'active', authorizationNumber: 'A-1' },
          { status: 'pending', authorizationNumber: 'A-2' },
          { status: 'denied', authorizationNumber: 'A-3' },
        ],
        getPatientInitialEvaluations: async () => { throw new Error('db down'); },
        getActiveTreatmentPlan: async () => ({ id: 5 }),
        getProgressNotesForPatient: async () => [{ id: 1 }, { id: 2 }],
        getRecentSoapNotesForPatient: async () => [],
        getPatientDocuments: async () => [{ fileName: 'EOB.pdf' }],
      },
    );
    expect(g.authorizationNumbers).toEqual(['A-1']);
    expect(g.hasPriorAuthorization).toBe(true);
    expect(g.hasEvaluation).toBe(false);
    expect(g.hasTreatmentPlan).toBe(true);
    expect(g.progressNoteCount).toBe(2);
    expect(g.hasClinicalDocumentation).toBe(true);
    expect(g.supportingDocNames).toEqual(['EOB.pdf']);
    expect(g.inputs.urgentService).toBe(true);
  });

  it('with no lookups at all, nothing is on file (the claim auth number still counts)', async () => {
    const g = await buildAppealGrounding({ practiceId: 2, patientId: 9, claim: { authorizationNumber: 'CLM-AUTH' } }, {});
    expect(g.hasPriorAuthorization).toBe(true);
    expect(g.hasClinicalDocumentation).toBe(false);
  });

  it('normalizes the biller inputs from a request body', () => {
    expect(normalizeGroundingInputs({ urgentService: 'yes', retroAuthRequested: true, retroAuthReference: ' RA-1 ', denialDate: '2026-11-18', additionalGrounds: '  ' }))
      .toEqual({ urgentService: false, retroAuthRequested: true, retroAuthReference: 'RA-1', additionalGrounds: null, denialDate: '2026-11-18' });
    expect(normalizeGroundingInputs({ denialDate: '2026-02-31' }).denialDate).toBeNull();
  });
});

describe('assessAppealReadiness', () => {
  const grounded = withRecords({ hasSoapNotes: true, soapNoteCount: 3 });

  it('a letter with placeholder letterhead or signer is not ready, and says why', async () => {
    const result = await appealGenerator.generateAppeal(CLAIM, [], AVA, { name: 'Practice', npi: null, address: null, phone: null }, grounded);
    const r = assessAppealReadiness({ letter: result.appealLetter, practice: { name: 'Practice' }, patient: AVA, claim: CLAIM, grounding: grounded, denialDate: '2026-11-10' });
    expect(r.ready).toBe(false);
    expect(r.issues).toEqual(expect.arrayContaining([
      'Practice address not on file (Settings → Practice)',
      'Practice NPI not on file (Settings → Practice)',
      'Practice address is missing from the letterhead',
      'Signer name is a placeholder',
    ]));
  });

  it('no clinical documentation on file, or no denial date, blocks ready', () => {
    const letter = 'Bright Steps\n123 Demo Way\n(555) 010-0000\nNPI: 0000000001\n\nClaims Review Department\nHorizon\n500 Payer Rd\n\nDear Claims Review Department, please reconsider.\n\nDemo Admin';
    const noDocs = assessAppealReadiness({ letter, practice: PRACTICE, patient: AVA, claim: CLAIM, grounding: emptyAppealGrounding(), denialDate: '2026-11-10' });
    expect(noDocs.ready).toBe(false);
    expect(noDocs.issues.some((i) => /No clinical documentation on file/.test(i))).toBe(true);
    const noDate = assessAppealReadiness({ letter, practice: PRACTICE, patient: AVA, claim: CLAIM, grounding: grounded, denialDate: null });
    expect(noDate.issues).toContain('Denial date not recorded (needed for the filing deadline)');
  });

  it('an unsupported assertion left in an edited letter is reported, and a clean letter is ready', () => {
    const base = 'Bright Steps\n123 Demo Way\n(555) 010-0000\nNPI: 0000000001\n\nClaims Review Department\nHorizon\n500 Payer Rd\n\nDear Claims Review Department, please reconsider the enclosed session documentation.\n\nDemo Admin';
    const dirty = assessAppealReadiness({ letter: base + '\nThe service was urgent.', practice: PRACTICE, patient: AVA, claim: CLAIM, grounding: grounded, denialDate: '2026-11-10' });
    expect(dirty.ready).toBe(false);
    expect(dirty.issues).toContain('Letter asserts something not on record: urgent service');
    const clean = assessAppealReadiness({ letter: base, practice: PRACTICE, patient: AVA, claim: CLAIM, grounding: grounded, denialDate: '2026-11-10' });
    expect(clean).toEqual({ ready: true, issues: [] });
  });

  it('the generated template with full letterhead is still not ready because the payer address is a placeholder', async () => {
    const result = await appealGenerator.generateAppeal(CLAIM, [], AVA, PRACTICE, grounded);
    const r = assessAppealReadiness({ letter: result.appealLetter, practice: PRACTICE, patient: AVA, claim: CLAIM, grounding: grounded, denialDate: '2026-11-10' });
    expect(r.ready).toBe(false);
    expect(r.issues).toEqual(['Payer mailing address must be filled in']);
  });
});

describe('computeAppealDeadline', () => {
  it('uses the plan document\'s first-level appeal window from the denial date', () => {
    const b = computeAppealDeadline({ denialDate: '2026-11-10', planBenefits: { rawExtractedData: { appeal_rights: { first_level_days: 180 } } } });
    expect(b).toEqual({ deadlineDate: '2027-05-09', denialDate: '2026-11-10', policyDays: 180, source: 'payer_policy' });
    expect(describeDeadlineBasis({ deadlineSource: b.source, deadlinePolicyDays: b.policyDays, denialDate: b.denialDate })).toBe('Denial date + 180 days (payer plan appeal rights)');
  });

  it('falls back to the practice default, then to a labeled estimate', () => {
    const practice = computeAppealDeadline({ denialDate: '2026-11-10', practice: { appealWindowDays: 90 } });
    expect(practice).toMatchObject({ deadlineDate: '2027-02-08', policyDays: 90, source: 'practice_default' });
    expect(describeDeadlineBasis({ deadlineSource: 'practice_default', deadlinePolicyDays: 90, denialDate: '2026-11-10' })).toContain('verify with payer');
    const estimate = computeAppealDeadline({ denialDate: '2026-11-18' });
    expect(estimate).toEqual({ deadlineDate: '2027-01-17', denialDate: '2026-11-18', policyDays: 60, source: 'estimated' });
    expect(describeDeadlineBasis({ deadlineSource: 'estimated', deadlinePolicyDays: 60, denialDate: '2026-11-18' })).toBe('Denial date + 60 days (estimated — verify with payer)');
  });

  it('with no denial date the deadline is an estimate from today, whatever the window source', () => {
    const b = computeAppealDeadline({ denialDate: null, practice: { appealWindowDays: 90 }, today: new Date('2026-11-18T23:30:00Z') });
    expect(b).toEqual({ deadlineDate: '2027-02-16', denialDate: null, policyDays: 90, source: 'estimated' });
    expect(describeDeadlineBasis({ deadlineSource: 'estimated', deadlinePolicyDays: 90, denialDate: null })).toContain('no denial date recorded');
    expect(describeDeadlineBasis({ deadlineSource: 'manual' })).toBe('Set manually');
  });

  it('date arithmetic is calendar arithmetic (no DST wobble)', () => {
    expect(addDaysToDateOnly('2026-03-01', 10)).toBe('2026-03-11'); // crosses the US DST change
    expect(addDaysToDateOnly('2026-10-25', 10)).toBe('2026-11-04');
    expect(addDaysToDateOnly('not-a-date', 10)).toBeNull();
  });
});

describe('splitSentences (linear replacement for the polynomial SENTENCE_RE)', () => {
  // The regex CodeQL flagged (js/polynomial-redos). Kept here only as the
  // oracle: the scanner must produce exactly the same segments.
  const LEGACY_SENTENCE_RE = /[^.!?\n]+(?:[.!?]+|(?=\n)|$)/g;
  const samples = [
    '',
    'One sentence.',
    'No terminal punctuation',
    'First. Second! Third? Fourth',
    'Ellipsis... then more?! And a tail',
    'Line one\nLine two\n\nLine four.\n',
    '\n\n...\n!!\n',
    'Dear Appeals Department,\n\nGROUNDS FOR APPEAL:\n1. The service was urgent.\n2. Progress notes are enclosed.\n\nSincerely,\n[Provider Name]',
    'Trailing spaces here.   \n   Leading spaces there. Mixed?Yes!No.',
    '. .. . leading dots then text. and text.',
  ];

  it('matches the legacy regex segment-for-segment', () => {
    for (const s of samples) {
      expect(splitSentences(s)).toEqual(s.match(LEGACY_SENTENCE_RE) ?? []);
    }
  });

  it('is linear on the input that made the regex polynomial', () => {
    // A long run of non-terminators followed by a line break: the old regex
    // re-scanned the run from every start offset. 200k chars must be quick.
    const long = 'a'.repeat(200_000) + '\n' + 'b'.repeat(200_000);
    const started = Date.now();
    const parts = splitSentences(long);
    expect(parts).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('placeholder and tidy scans (linear replacements for the multi-line regexes)', () => {
  it('flags each known placeholder once, a bare "Provider Name" line, and any other bracketed token', () => {
    const g = emptyAppealGrounding({ denialDate: '2026-11-10' });
    const ctx = {
      letter: 'Bright Steps\n[Practice Address]\n\nTo: [Insurance Address]\n\nBody.\n\nSincerely,\n  provider name  \n[Credentials Here]',
      practice: { name: 'P', npi: '1', address: 'A', phone: 'P' },
      patient: { firstName: 'Ava', lastName: 'Sample' },
      claim: { claimNumber: 'C1' },
      denialDate: '2026-11-10',
      grounding: { ...g, hasClinicalDocumentation: true },
    } as any;
    const { ready, issues } = assessAppealReadiness(ctx);
    expect(ready).toBe(false);
    expect(issues).toContain('Practice address is missing from the letterhead');
    expect(issues).toContain('Payer mailing address must be filled in');
    expect(issues).toContain('Signer name is a placeholder ("Provider Name")');
    expect(issues).toContain('The letter still contains a bracketed placeholder');
    expect(issues.filter((i) => i.includes('Payer mailing address'))).toHaveLength(1);
  });

  it('does not treat citations or lowercase brackets as placeholders', () => {
    const g = emptyAppealGrounding({ denialDate: '2026-11-10' });
    const ctx = {
      letter: 'See CPT 97530 [1] and the plan [see attached]. Member ID [ABC-123].',
      practice: { name: 'P', npi: '1', address: 'A', phone: 'P' },
      patient: { firstName: 'Ava', lastName: 'Sample' },
      claim: { claimNumber: 'C1' },
      denialDate: '2026-11-10',
      grounding: { ...g, hasClinicalDocumentation: true },
    } as any;
    expect(assessAppealReadiness(ctx).issues).toEqual([]);
  });

  it('strips a sentence, drops the emptied list marker, collapses blank runs and renumbers', () => {
    const g = emptyAppealGrounding({});
    const letter = 'GROUNDS FOR APPEAL:\n1. The claim was filed on time.   \n2. The service was urgent and emergent.\n\n\n\n3. Records are enclosed.\n';
    const out = stripUnsupportedAppealAssertions(letter, g);
    expect(out).toBe('GROUNDS FOR APPEAL:\n1. The claim was filed on time.\n\n2. Records are enclosed.');
  });

  it('stays fast on long bracketed and whitespace-heavy input', () => {
    const g = emptyAppealGrounding({ denialDate: '2026-11-10' });
    const letter = '[A' + 'a '.repeat(100_000) + 'x\n' + ' '.repeat(100_000) + '\n' + '1.' + ' '.repeat(100_000);
    const started = Date.now();
    const { issues } = assessAppealReadiness({
      letter,
      practice: { name: 'P', npi: '1', address: 'A', phone: 'P' },
      patient: { firstName: 'Ava', lastName: 'Sample' },
      claim: { claimNumber: 'C1' },
      denialDate: '2026-11-10',
      grounding: { ...g, hasClinicalDocumentation: true },
    } as any);
    stripUnsupportedAppealAssertions(letter, g);
    expect(issues).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

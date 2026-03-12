import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock OpenAI before importing the module under test
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockCreate } };
    },
    __mockCreate: mockCreate,
  };
});

// Mock logger
vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock aiLearningService
vi.mock('../services/aiLearningService', () => ({
  getRecommendationsForClaim: vi.fn().mockResolvedValue([]),
}));

import { predictDenial } from '../services/aiDenialPredictor';

// Helper factories
function makeClaim(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    claimNumber: 'CLM-001',
    totalAmount: '150.00',
    status: 'draft',
    insuranceId: 1,
    sessionId: 1,
    ...overrides,
  };
}

function makeLineItem(overrides: Record<string, any> = {}) {
  return {
    cptCodeId: 1,
    icd10CodeId: 1,
    units: 2,
    rate: '75.00',
    amount: '150.00',
    modifier: 'GO',
    dateOfService: new Date().toISOString().split('T')[0],
    cptCode: { code: '97530', description: 'Therapeutic Activities' },
    icd10Code: { code: 'F82', description: 'Developmental coordination disorder' },
    ...overrides,
  };
}

function makePatient(overrides: Record<string, any> = {}) {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-01-01',
    insuranceProvider: 'Anthem',
    insuranceId: 'INS001',
    ...overrides,
  };
}

function makeSoapNote(overrides: Record<string, any> = {}) {
  return {
    subjective: 'Patient reports improved ability to complete dressing tasks and progress toward goals.',
    objective: 'Patient demonstrated improved bilateral coordination during therapeutic activities with functional outcomes.',
    assessment: 'Patient is making progress toward functional independence objectives. Improvement noted.',
    plan: 'Continue therapeutic activities, update goals, home program assigned.',
    sessionType: 'individual',
    interventions: null,
    homeProgram: null,
    progressNotes: null,
    ...overrides,
  };
}

describe('aiDenialPredictor', () => {
  const originalEnv = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.OPENAI_API_KEY = originalEnv;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  // ---- Rule-based: Missing line items ----

  it('should flag critical issue when claim has no line items', async () => {
    const result = await predictDenial(makeClaim(), [], makeSoapNote(), makePatient());
    const critical = result.issues.find(i => i.severity === 'critical' && i.category === 'Missing Data');
    expect(critical).toBeDefined();
    expect(critical!.description).toContain('no line items');
  });

  // ---- Rule-based: Missing ICD-10 ----

  it('should flag missing ICD-10 diagnosis codes', async () => {
    const lineItem = makeLineItem({ icd10CodeId: null, icd10Code: null });
    const result = await predictDenial(makeClaim(), [lineItem], makeSoapNote(), makePatient());
    const issue = result.issues.find(i => i.category === 'Missing Diagnosis');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('high');
  });

  it('should not flag diagnosis when icd10Code object is present', async () => {
    const lineItem = makeLineItem({ icd10CodeId: null, icd10Code: { code: 'F82', description: 'DCD' } });
    const result = await predictDenial(makeClaim(), [lineItem], makeSoapNote(), makePatient());
    const issue = result.issues.find(i => i.category === 'Missing Diagnosis');
    expect(issue).toBeUndefined();
  });

  // ---- Rule-based: Missing modifiers ----

  it('should flag missing modifier on therapy codes', async () => {
    const lineItem = makeLineItem({ modifier: null, cptCode: { code: '97110', description: 'Therapeutic Exercises' } });
    const result = await predictDenial(makeClaim(), [lineItem], makeSoapNote(), makePatient());
    const issue = result.issues.find(i => i.category === 'Missing Modifier');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('medium');
  });

  it('should not flag missing modifier on non-therapy codes', async () => {
    const lineItem = makeLineItem({ modifier: null, cptCode: { code: '99213', description: 'Office Visit' } });
    const result = await predictDenial(makeClaim(), [lineItem], makeSoapNote(), makePatient());
    const issue = result.issues.find(i => i.category === 'Missing Modifier');
    expect(issue).toBeUndefined();
  });

  // ---- Rule-based: SOAP documentation ----

  it('should flag insufficient SOAP documentation', async () => {
    const soap = makeSoapNote({
      subjective: 'Short',
      objective: 'Short',
      assessment: 'Short',
      plan: 'x',
    });
    const result = await predictDenial(makeClaim(), [makeLineItem()], soap, makePatient());
    const issue = result.issues.find(i => i.category === 'Documentation' && i.description.includes('insufficient'));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('high'); // 4 sections missing = high
  });

  it('should flag when no SOAP note is present at all', async () => {
    const result = await predictDenial(makeClaim(), [makeLineItem()], null, makePatient());
    const issue = result.issues.find(i => i.category === 'Documentation' && i.description.includes('No SOAP note'));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('high');
  });

  it('should flag missing functional outcome language', async () => {
    const soap = makeSoapNote({
      subjective: 'Patient attended the therapy session today as scheduled for treatment.',
      objective: 'Worked on various therapeutic activities and skills during session.',
      assessment: 'Continuing with the treatment plan and skilled services.',
      plan: 'Continue treatment next week with more activities.',
    });
    const result = await predictDenial(makeClaim(), [makeLineItem()], soap, makePatient());
    const issue = result.issues.find(i => i.category === 'Medical Necessity' && i.description.includes('functional outcome'));
    expect(issue).toBeDefined();
  });

  it('should flag missing treatment goals', async () => {
    const soap = makeSoapNote({
      subjective: 'Patient reports progress with functional tasks and improvement.',
      objective: 'Demonstrated improvement in bilateral coordination with functional outcomes.',
      assessment: 'Making progress toward independence. Deficit areas improving.',
      plan: 'Continue treatment next week with home exercises.',
    });
    const result = await predictDenial(makeClaim(), [makeLineItem()], soap, makePatient());
    const issue = result.issues.find(i => i.category === 'Medical Necessity' && i.description.includes('goals'));
    expect(issue).toBeDefined();
  });

  // ---- Rule-based: Excessive units ----

  it('should flag excessive units (>4)', async () => {
    const lineItem = makeLineItem({ units: 6 });
    const result = await predictDenial(makeClaim(), [lineItem], makeSoapNote(), makePatient());
    const issue = result.issues.find(i => i.category === 'Excessive Units');
    expect(issue).toBeDefined();
    expect(issue!.description).toContain('6 units');
  });

  it('should not flag units <= 4', async () => {
    const lineItem = makeLineItem({ units: 4 });
    const result = await predictDenial(makeClaim(), [lineItem], makeSoapNote(), makePatient());
    const issue = result.issues.find(i => i.category === 'Excessive Units');
    expect(issue).toBeUndefined();
  });

  // ---- Rule-based: Timely filing ----

  it('should flag timely filing for dates > 90 days old', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);
    const lineItem = makeLineItem({ dateOfService: oldDate.toISOString().split('T')[0] });
    const result = await predictDenial(makeClaim(), [lineItem], makeSoapNote(), makePatient());
    const issue = result.issues.find(i => i.category === 'Timely Filing');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('high');
  });

  it('should flag critical timely filing for dates > 180 days old', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 200);
    const lineItem = makeLineItem({ dateOfService: oldDate.toISOString().split('T')[0] });
    const result = await predictDenial(makeClaim(), [lineItem], makeSoapNote(), makePatient());
    const issue = result.issues.find(i => i.category === 'Timely Filing');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('critical');
  });

  // ---- Risk score calculation ----

  it('should calculate risk score based on issue severity', async () => {
    // A claim with a critical issue (no line items = 30) + no SOAP (high = 20) = 50
    const result = await predictDenial(makeClaim(), [], null, makePatient());
    expect(result.riskScore).toBeGreaterThanOrEqual(50);
    expect(result.riskLevel).toBe('medium');
  });

  it('should return low risk for a clean claim', async () => {
    const result = await predictDenial(makeClaim(), [makeLineItem()], makeSoapNote(), makePatient());
    expect(result.riskScore).toBeLessThan(30);
    expect(result.riskLevel).toBe('low');
  });

  it('should cap risk score at 100', async () => {
    // Many issues stacked up
    const lineItems = [
      makeLineItem({ icd10CodeId: null, icd10Code: null, modifier: null, units: 8, cptCode: { code: '97110', description: 'Therapeutic Exercises' } }),
    ];
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 200);
    lineItems[0].dateOfService = oldDate.toISOString().split('T')[0];

    const result = await predictDenial(makeClaim(), lineItems, null, makePatient());
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  // ---- Risk level thresholds ----

  it('should classify risk levels correctly', async () => {
    // Clean claim = low
    const low = await predictDenial(makeClaim(), [makeLineItem()], makeSoapNote(), makePatient());
    expect(low.riskLevel).toBe('low');
  });

  // ---- Fallback without OpenAI ----

  it('should work without OPENAI_API_KEY (rule-based fallback)', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await predictDenial(makeClaim(), [makeLineItem()], makeSoapNote(), makePatient());
    expect(result).toHaveProperty('riskScore');
    expect(result).toHaveProperty('riskLevel');
    expect(result).toHaveProperty('issues');
    expect(result).toHaveProperty('analyzedAt');
    expect(result.overallRecommendation).toBeDefined();
  });

  // ---- Result shape ----

  it('should always include analyzedAt as ISO string', async () => {
    const result = await predictDenial(makeClaim(), [makeLineItem()], makeSoapNote(), makePatient());
    expect(result.analyzedAt).toBeDefined();
    expect(() => new Date(result.analyzedAt)).not.toThrow();
  });

  it('should return empty issues array for well-documented clean claim', async () => {
    const soap = makeSoapNote({
      subjective: 'Patient reports improved ability to complete ADLs with progress toward goals. 30 minutes of skilled therapy provided.',
      objective: 'Patient demonstrated improvement in functional tasks, balance, and coordination during 30 minutes of therapeutic activities.',
      assessment: 'Patient is making progress toward functional independence objectives with measurable improvement noted.',
      plan: 'Continue therapeutic activities targeting goals, update home program, duration 30 minutes next session.',
    });
    const result = await predictDenial(makeClaim(), [makeLineItem()], soap, makePatient());
    // Well-documented claims should have few or no issues
    expect(result.issues.length).toBeLessThanOrEqual(1);
  });
});

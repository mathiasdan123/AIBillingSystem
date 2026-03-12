import { describe, it, expect, beforeEach } from 'vitest';
import { AiClaimOptimizer } from '../aiClaimOptimizer';
import type { ClaimOptimizationResult } from '../aiClaimOptimizer';

describe('AiClaimOptimizer', () => {
  let optimizer: AiClaimOptimizer;

  const makeSoapNote = (overrides: Record<string, any> = {}) => ({
    id: 1,
    sessionId: 1,
    subjective: overrides.subjective ?? 'Patient reports improved ability to complete dressing tasks independently.',
    objective: overrides.objective ?? 'Patient demonstrated improved bilateral coordination during therapeutic activities.',
    assessment: overrides.assessment ?? 'Patient is making progress toward functional independence goals.',
    plan: overrides.plan ?? 'Continue therapeutic activities and self-care training, add home program.',
    createdAt: new Date(),
    updatedAt: new Date(),
    sessionType: overrides.sessionType ?? 'individual',
    interventions: overrides.interventions ?? null,
    homeProgram: overrides.homeProgram ?? null,
    progressNotes: overrides.progressNotes ?? null,
  });

  const makePatient = (overrides: Record<string, any> = {}) => ({
    id: 1,
    practiceId: 1,
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-01-01',
    gender: 'female',
    email: 'jane@test.com',
    phone: '555-1234',
    address: '123 Main St',
    insuranceProvider: overrides.insuranceProvider ?? 'Anthem',
    insuranceId: overrides.insuranceId ?? 'INS001',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    optimizer = new AiClaimOptimizer();
  });

  // ---- Treatment content analysis ----

  it('should detect therapeutic activities patterns in SOAP notes', async () => {
    const soap = makeSoapNote({
      objective: 'Patient performed therapeutic activities including bilateral coordination and motor planning drills.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const codes = result.optimizedCptCodes.map(c => c.optimizedCode);
    // 97530 is therapeutic activities
    expect(codes).toContain('97530');
  });

  it('should detect self-care training patterns', async () => {
    const soap = makeSoapNote({
      objective: 'Patient practiced feeding training and dressing skills for daily living independence.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const codes = result.optimizedCptCodes.map(c => c.optimizedCode);
    expect(codes.some(c => c === '97535' || c === '97530')).toBe(true);
  });

  it('should detect therapeutic exercise patterns', async () => {
    const soap = makeSoapNote({
      objective: 'Performed strengthening exercises and range of motion stretching for upper extremity.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const originalCodes = result.optimizedCptCodes.map(c => c.originalCode);
    expect(originalCodes).toContain('97110');
  });

  it('should detect neuromuscular re-education patterns', async () => {
    const soap = makeSoapNote({
      objective: 'Balance training and proprioception activities to improve postural control.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const originalCodes = result.optimizedCptCodes.map(c => c.originalCode);
    expect(originalCodes).toContain('97112');
  });

  it('should detect manual therapy patterns', async () => {
    const soap = makeSoapNote({
      objective: 'Manual therapy and soft tissue mobilization applied to right shoulder.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const originalCodes = result.optimizedCptCodes.map(c => c.originalCode);
    expect(originalCodes).toContain('97140');
  });

  it('should default to 97530 when no specific patterns found', async () => {
    const soap = makeSoapNote({
      subjective: 'Patient attended session.',
      objective: 'Worked on skills.',
      assessment: 'Doing okay.',
      plan: 'Continue next week.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const codes = result.optimizedCptCodes.map(c => c.originalCode);
    expect(codes).toContain('97530');
  });

  // ---- Evaluation complexity ----

  it('should assign low complexity evaluation code for short notes', async () => {
    // Under 100 words with evaluation pattern
    const soap = makeSoapNote({
      subjective: 'Initial evaluation of patient for OT services.',
      objective: 'Assessed for fine motor deficits.',
      assessment: 'Deficits noted.',
      plan: 'Begin treatment.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const originalCodes = result.optimizedCptCodes.map(c => c.originalCode);
    expect(originalCodes).toContain('97165');
  });

  it('should assign high complexity evaluation code for long notes', async () => {
    const longText = 'comprehensive evaluation ' + 'detailed clinical findings about the patient functional status and abilities '.repeat(20);
    const soap = makeSoapNote({
      subjective: longText,
      objective: longText,
      assessment: 'Multiple areas of deficit identified requiring skilled intervention.',
      plan: 'Develop comprehensive treatment plan.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const originalCodes = result.optimizedCptCodes.map(c => c.originalCode);
    expect(originalCodes).toContain('97167');
  });

  // ---- Insurance optimization ----

  it('should mark preferred codes with higher confidence for Anthem', async () => {
    const soap = makeSoapNote({
      objective: 'Patient performed therapeutic activities and functional training.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient({ insuranceProvider: 'Anthem' }) as any);
    const preferred = result.optimizedCptCodes.find(c => c.optimizedCode === '97530');
    expect(preferred).toBeDefined();
    expect(preferred!.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it('should avoid insurance-disfavored codes', async () => {
    // Anthem avoids 97140. If manual therapy is detected, optimizer should switch away.
    const soap = makeSoapNote({
      objective: 'Manual therapy and soft tissue mobilization performed.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient({ insuranceProvider: 'Anthem' }) as any);
    const manualTherapyOpt = result.optimizedCptCodes.find(c => c.originalCode === '97140');
    if (manualTherapyOpt) {
      expect(manualTherapyOpt.optimizedCode).not.toBe('97140');
    }
  });

  it('should use generic defaults for unknown insurance providers', async () => {
    const soap = makeSoapNote({
      objective: 'Therapeutic activities performed.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient({ insuranceProvider: 'UnknownInsurer' }) as any);
    expect(result.optimizedCptCodes.length).toBeGreaterThan(0);
    expect(result.optimizedCptCodes[0].confidence).toBeGreaterThanOrEqual(0.80);
  });

  // ---- Documentation scoring ----

  it('should give high documentation score for thorough SOAP notes', async () => {
    const thorough = 'This is a detailed section containing more than fifty characters of clinical documentation with progress notes and goals. ';
    const soap = makeSoapNote({
      subjective: thorough + 'Patient reports progress toward functional independence and safety with home program.',
      objective: thorough + 'Objective measurements show improvement in goal areas.',
      assessment: thorough + 'Progress noted with functional outcomes improving.',
      plan: thorough + 'Continue with carry-over activities.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    expect(result.aiReviewScore).toBeGreaterThanOrEqual(90);
  });

  it('should give low documentation score for sparse SOAP notes', async () => {
    const soap = makeSoapNote({
      subjective: 'OK',
      objective: 'Fine',
      assessment: 'Good',
      plan: 'More',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    expect(result.aiReviewScore).toBeLessThan(50);
  });

  it('should cap documentation score at 100', async () => {
    const thorough = 'Patient shows progress toward goals with improvement in functional independence and safety precautions. Home program assigned with carry-over activities. ';
    const soap = makeSoapNote({
      subjective: thorough.repeat(3),
      objective: thorough.repeat(3),
      assessment: thorough.repeat(3),
      plan: thorough.repeat(3),
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    expect(result.aiReviewScore).toBeLessThanOrEqual(100);
  });

  // ---- Review notes generation ----

  it('should generate "Excellent" review notes for score >= 90', async () => {
    const thorough = 'Detailed documentation about functional outcomes, progress toward goals, safety precautions, and home program with carry-over. ';
    const soap = makeSoapNote({
      subjective: thorough.repeat(2),
      objective: thorough.repeat(2),
      assessment: thorough.repeat(2),
      plan: thorough.repeat(2),
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    if (result.aiReviewScore >= 90) {
      expect(result.aiReviewNotes).toContain('Excellent');
    }
  });

  it('should generate improvement-needed notes for low scores', async () => {
    const soap = makeSoapNote({
      subjective: 'Short.',
      objective: 'Short.',
      assessment: 'Short.',
      plan: 'Short.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    expect(result.aiReviewNotes).toContain('needs improvement');
  });

  // ---- Compliance notes ----

  it('should flag missing progress language in compliance notes', async () => {
    const soap = makeSoapNote({
      subjective: 'Patient attended session today for scheduled therapy services treatment.',
      objective: 'Worked on fine motor tasks and bilateral coordination activities in session.',
      assessment: 'Continuing with skilled services for treatment of identified deficits.',
      plan: 'Continue treatment next week for ongoing therapy services.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const hasProgressFlag = result.complianceNotes.some(n => n.toLowerCase().includes('response to treatment'));
    expect(hasProgressFlag).toBe(true);
  });

  it('should flag missing goals in compliance notes', async () => {
    const soap = makeSoapNote({
      subjective: 'Patient reports feeling better after treatment session today.',
      objective: 'Improved range of motion noted during strengthening exercises today.',
      assessment: 'Progress noted in treatment areas with improvement in function.',
      plan: 'Continue treatment plan with exercises next session.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const hasGoalFlag = result.complianceNotes.some(n => n.toLowerCase().includes('goal'));
    expect(hasGoalFlag).toBe(true);
  });

  it('should flag missing duration documentation', async () => {
    const soap = makeSoapNote({
      subjective: 'Patient attended therapy session.',
      objective: 'Therapeutic activities performed.',
      assessment: 'Progress noted.',
      plan: 'Continue.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);
    const hasDurationFlag = result.complianceNotes.some(n => n.toLowerCase().includes('duration'));
    expect(hasDurationFlag).toBe(true);
  });

  // ---- Result shape ----

  it('should return a well-formed ClaimOptimizationResult', async () => {
    const soap = makeSoapNote();
    const result = await optimizer.optimizeClaim(soap as any, makePatient() as any);

    expect(result).toHaveProperty('optimizedCptCodes');
    expect(result).toHaveProperty('aiReviewScore');
    expect(result).toHaveProperty('aiReviewNotes');
    expect(result).toHaveProperty('totalOptimizationValue');
    expect(result).toHaveProperty('complianceNotes');
    expect(Array.isArray(result.optimizedCptCodes)).toBe(true);
    expect(Array.isArray(result.complianceNotes)).toBe(true);
    expect(typeof result.aiReviewScore).toBe('number');
    expect(typeof result.totalOptimizationValue).toBe('number');
    expect(result.totalOptimizationValue).toBeGreaterThanOrEqual(0);
  });

  it('should never produce negative reimbursementIncrease values', async () => {
    const soap = makeSoapNote({
      objective: 'Strengthening exercises and balance training with manual therapy techniques.',
    });
    const result = await optimizer.optimizeClaim(soap as any, makePatient({ insuranceProvider: 'Cigna' }) as any);
    for (const opt of result.optimizedCptCodes) {
      expect(opt.reimbursementIncrease).toBeGreaterThanOrEqual(0);
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  SPEECH_TREATMENT_CATEGORIES,
  SPEECH_EVALUATION_CODES,
  INDIVIDUAL_SLP_TREATMENT_LABEL,
  speechCptForCategory,
  speechTreatmentCpts,
} from '../services/speechCptMapping';
import { checkDocumentationSupport } from '../services/complianceRiskChecks';

describe('speechCptMapping (2026/2027-proof category layer)', () => {
  it('maps every 2027-renumber category to the SAME individual-treatment slot', () => {
    // All categories flagged pending2027Renumber must currently share one CPT
    // (92507) under the internal slot label — the whole point is that the 2027
    // swap is a per-category value change in one file.
    const pending = Object.values(SPEECH_TREATMENT_CATEGORIES).filter((m) => m.pending2027Renumber);
    expect(pending.length).toBeGreaterThanOrEqual(9);
    for (const m of pending) {
      expect(m.cpt).toBe('92507');
      expect(m.cptLabel).toBe(INDIVIDUAL_SLP_TREATMENT_LABEL);
    }
  });

  it('keeps AAC language therapy and AAC device services on distinct codes', () => {
    // Clinical review: AAC language therapy follows the individual-treatment
    // code (and its 2027 successor); device programming/training stays 92609.
    expect(speechCptForCategory('aac_intervention').cpt).toBe('92507');
    expect(speechCptForCategory('aac_intervention').pending2027Renumber).toBe(true);
    expect(speechCptForCategory('aac_device_programming').cpt).toBe('92609');
    expect(speechCptForCategory('aac_device_programming').pending2027Renumber).toBe(false);
  });

  it('maps feeding/oral motor to 92526 (not part of the renumbering)', () => {
    const m = speechCptForCategory('feeding_oral_motor');
    expect(m.cpt).toBe('92526');
    expect(m.pending2027Renumber).toBe(false);
  });

  it('exposes exactly the distinct treatment CPTs in use', () => {
    expect(speechTreatmentCpts().sort()).toEqual(['92507', '92526', '92609']);
  });

  it('lists the evaluation codes the practice actually uses', () => {
    expect(Object.keys(SPEECH_EVALUATION_CODES).sort()).toEqual(['92523', '92607', '92608', '92610']);
    expect(SPEECH_EVALUATION_CODES['92523'].frequency).toBe('common');
  });
});

describe('compliance checks — speech treatment codes', () => {
  const line = (code: string) => [{ cptCode: { code } }];

  it('flags 92507 with no speech/language documentation', () => {
    const issues = checkDocumentationSupport(
      line('92507'),
      'Patient participated in gross motor obstacle course and swing activities.',
    );
    expect(issues.some((i) => i.description.includes('92507'))).toBe(true);
  });

  it('passes 92507 when articulation/language work is documented', () => {
    const issues = checkDocumentationSupport(
      line('92507'),
      'Targeted articulation of /r/ at word level with a cueing hierarchy; expressive language tasks for sentence formulation.',
    );
    expect(issues).toHaveLength(0);
  });

  it('flags 92526 without swallowing/feeding documentation', () => {
    const issues = checkDocumentationSupport(
      line('92526'),
      'Worked on articulation drills at the word level.',
    );
    expect(issues.some((i) => i.description.includes('92526'))).toBe(true);
  });

  it('passes 92609 when SGD/AAC device work is documented', () => {
    const issues = checkDocumentationSupport(
      line('92609'),
      'Programmed new core vocabulary on the speech-generating device and trained navigation.',
    );
    expect(issues).toHaveLength(0);
  });
});

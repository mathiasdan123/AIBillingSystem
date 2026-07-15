/**
 * Speech-language treatment categories → CPT mapping (2026/2027-proof).
 *
 * Per clinical review (Blanche, 2026-07): CPT 92507 is expected to be DELETED
 * effective 2027-01-01 and replaced with ~10 new time-based speech-language
 * treatment codes (CMS proposed 2027 fee schedule; ASHA reviewing; final
 * descriptors expected later in 2026). Documentation and billing logic must
 * therefore be built around TREATMENT CATEGORIES, not hard-coded CPT numbers —
 * when the 2027 codes are finalized, update the mapping values in THIS file
 * and every consumer follows.
 *
 * Do NOT import '92507' as a literal anywhere in documentation/billing logic.
 * Import speechCptForCategory()/SPEECH_TREATMENT_CATEGORIES instead.
 * (Plan-document/rate parsers that read payer fee schedules are exempt — they
 * legitimately handle whatever literal codes appear in source documents.)
 *
 * AAC nuance (clinical review): AAC *language therapy* maps to the individual
 * speech-language treatment code (92507 today; its 2027 successor later).
 * Programming/modifying/training on a speech-generating device is a DISTINCT
 * service and stays on the AAC-specific codes (92609).
 */

/** Internal label for the 92507 slot, per clinical review. */
export const INDIVIDUAL_SLP_TREATMENT_LABEL =
  'Individual Speech-Language Treatment (2026/2027 mapping)';

export type SpeechTreatmentCategory =
  | 'speech_sound_articulation'
  | 'expressive_language'
  | 'receptive_language'
  | 'mixed_language'
  | 'pragmatic_social_communication'
  | 'aac_intervention'
  | 'aac_device_programming'
  | 'feeding_oral_motor'
  | 'fluency'
  | 'voice_resonance'
  | 'cognitive_communication'
  | 'executive_functioning_language_organization'
  | 'caregiver_training';

export interface SpeechCategoryMapping {
  /** Human-readable category name for UI/documentation. */
  label: string;
  /** Current treatment CPT for this category (the value to swap in 2027). */
  cpt: string;
  /** How the CPT slot is labeled internally (survives the 2027 renumbering). */
  cptLabel: string;
  /**
   * True for the categories whose CPT is the individual speech-language
   * treatment code slated for replacement on 2027-01-01. When the final 2027
   * time-based codes publish, these entries get per-category successor codes.
   */
  pending2027Renumber: boolean;
}

/**
 * Category → current CPT. Single source of truth for speech treatment coding.
 * Categories per the practicing SLP/OT reviewer's list.
 */
export const SPEECH_TREATMENT_CATEGORIES: Record<SpeechTreatmentCategory, SpeechCategoryMapping> = {
  speech_sound_articulation: {
    label: 'Speech sound / articulation / phonology',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
  expressive_language: {
    label: 'Expressive language',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
  receptive_language: {
    label: 'Receptive language',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
  mixed_language: {
    label: 'Mixed receptive-expressive language',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
  pragmatic_social_communication: {
    label: 'Pragmatic / social communication',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
  aac_intervention: {
    // AAC LANGUAGE THERAPY — maps to the individual treatment code (and its
    // 2027 successor), NOT to the device codes.
    label: 'AAC intervention (language therapy)',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
  aac_device_programming: {
    // Distinct service: programming/modifying/training on a speech-generating
    // device. Stays on the AAC-specific code through the 2027 renumbering.
    label: 'AAC device programming / modification / training',
    cpt: '92609', cptLabel: 'Therapeutic services for SGD use', pending2027Renumber: false,
  },
  feeding_oral_motor: {
    label: 'Feeding / swallowing / oral motor',
    cpt: '92526', cptLabel: 'Treatment of swallowing dysfunction / oral function', pending2027Renumber: false,
  },
  fluency: {
    label: 'Fluency',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
  voice_resonance: {
    label: 'Voice / resonance',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
  cognitive_communication: {
    label: 'Cognitive-communication',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
  executive_functioning_language_organization: {
    label: 'Executive functioning / language organization',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
  caregiver_training: {
    label: 'Caregiver training / education',
    cpt: '92507', cptLabel: INDIVIDUAL_SLP_TREATMENT_LABEL, pending2027Renumber: true,
  },
};

/**
 * Evaluation codes, for reference/scrubbing. Evaluations are NOT part of the
 * 2027 treatment-code renumbering and are listed here only so consumers have
 * one speech-code source of truth. Frequency notes per the practicing SLP.
 */
export const SPEECH_EVALUATION_CODES: Record<string, { label: string; frequency: 'common' | 'occasional' | 'rare' }> = {
  '92523': { label: 'Speech sound production + language comprehension/expression evaluation', frequency: 'common' },
  '92610': { label: 'Clinical evaluation of swallowing function', frequency: 'occasional' },
  '92607': { label: 'AAC/SGD evaluation, first hour', frequency: 'rare' },
  '92608': { label: 'AAC/SGD evaluation, each additional 30 min', frequency: 'rare' },
};

/** Resolve the current treatment CPT for a category. */
export function speechCptForCategory(category: SpeechTreatmentCategory): SpeechCategoryMapping {
  return SPEECH_TREATMENT_CATEGORIES[category];
}

/** All distinct treatment CPTs currently in the mapping (for scrubber lists). */
export function speechTreatmentCpts(): string[] {
  return Array.from(new Set(Object.values(SPEECH_TREATMENT_CATEGORIES).map((m) => m.cpt)));
}

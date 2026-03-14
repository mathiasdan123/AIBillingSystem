/**
 * Validation Schemas for Patient Intake Form
 *
 * Zod schemas for all sections of the intake questionnaire.
 */

import { z } from 'zod';

// ==================== SENSORY PROCESSING OPTIONS ====================

export const sensoryResponseOptions = [
  'never',
  'rarely',
  'sometimes',
  'often',
  'always',
] as const;

export type SensoryResponse = typeof sensoryResponseOptions[number];

export const sensoryResponseLabels: Record<SensoryResponse, string> = {
  never: 'Never',
  rarely: 'Rarely',
  sometimes: 'Sometimes',
  often: 'Often',
  always: 'Always',
};

// ==================== SECTION SCHEMAS ====================

// Patient Information Section
export const patientInfoSchema = z.object({
  nickname: z.string().optional(),
  preferredPronouns: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  school: z.string().optional(),
  grade: z.string().optional(),
  teacher: z.string().optional(),
  primaryLanguage: z.string().default('English'),
  otherLanguages: z.string().optional(),
  livesWithBothParents: z.boolean().optional(),
  custodyArrangement: z.string().optional(),
});

// Parent/Guardian 1 Section
export const parent1Schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  relationship: z.string().min(1, 'Relationship is required'),
  phone: z.string().min(1, 'Phone number is required'),
  email: z.string().email('Valid email is required'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  employer: z.string().optional(),
  occupation: z.string().optional(),
  workPhone: z.string().optional(),
});

// Parent/Guardian 2 Section (optional)
export const parent2Schema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  relationship: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  employer: z.string().optional(),
  occupation: z.string().optional(),
  workPhone: z.string().optional(),
  sameAddressAsParent1: z.boolean().default(false),
});

// Emergency Contact Section
export const emergencyContactSchema = z.object({
  name: z.string().min(1, 'Emergency contact name is required'),
  relationship: z.string().min(1, 'Relationship is required'),
  phone: z.string().min(1, 'Phone number is required'),
  alternatePhone: z.string().optional(),
  authorizedToPickUp: z.boolean().default(true),
});

// Birth History Section
export const birthHistorySchema = z.object({
  birthWeight: z.string().optional(),
  gestationalAge: z.string().optional(),
  deliveryType: z.enum(['vaginal', 'cesarean', 'unknown']).optional(),
  birthComplications: z.boolean().optional(),
  birthComplicationsDetails: z.string().optional(),
  nicuStay: z.boolean().optional(),
  nicuDuration: z.string().optional(),
  nicuReason: z.string().optional(),
  pregnancyComplications: z.boolean().optional(),
  pregnancyComplicationsDetails: z.string().optional(),
  prenatalCare: z.boolean().default(true),
  motherSubstanceUse: z.boolean().optional(),
  motherSubstanceDetails: z.string().optional(),
});

// Medical History Section
export const medicalHistorySchema = z.object({
  // Diagnoses
  diagnoses: z.array(z.object({
    condition: z.string(),
    diagnosedDate: z.string().optional(),
    diagnosedBy: z.string().optional(),
  })).default([]),
  primaryDiagnosis: z.string().optional(),

  // Current Medications
  medications: z.array(z.object({
    name: z.string(),
    dosage: z.string().optional(),
    frequency: z.string().optional(),
    prescribedFor: z.string().optional(),
  })).default([]),

  // Allergies
  allergies: z.array(z.object({
    allergen: z.string(),
    reaction: z.string().optional(),
    severity: z.enum(['mild', 'moderate', 'severe']).optional(),
  })).default([]),

  // Surgeries/Hospitalizations
  surgeries: z.array(z.object({
    procedure: z.string(),
    date: z.string().optional(),
    reason: z.string().optional(),
  })).default([]),

  // Hearing/Vision
  hearingScreened: z.boolean().optional(),
  hearingScreenDate: z.string().optional(),
  hearingResults: z.enum(['normal', 'abnormal', 'unknown']).optional(),
  hearingConcerns: z.string().optional(),
  usesHearingAids: z.boolean().optional(),

  visionScreened: z.boolean().optional(),
  visionScreenDate: z.string().optional(),
  visionResults: z.enum(['normal', 'abnormal', 'unknown']).optional(),
  visionConcerns: z.string().optional(),
  wearsGlasses: z.boolean().optional(),

  // Seizures
  historyOfSeizures: z.boolean().optional(),
  seizureType: z.string().optional(),
  lastSeizure: z.string().optional(),
  seizureMedications: z.string().optional(),

  // Primary Care
  primaryCarePhysician: z.string().optional(),
  physicianPhone: z.string().optional(),
  lastCheckup: z.string().optional(),
});

// Nutrition History Section
export const nutritionHistorySchema = z.object({
  feedingDifficultiesInfancy: z.boolean().optional(),
  feedingDifficultiesDetails: z.string().optional(),
  currentFeedingConcerns: z.boolean().optional(),
  feedingConcernsDetails: z.string().optional(),
  dietaryRestrictions: z.string().optional(),
  foodAllergies: z.string().optional(),
  textureAversions: z.boolean().optional(),
  textureAversionsDetails: z.string().optional(),
  limitedDiet: z.boolean().optional(),
  limitedDietDetails: z.string().optional(),
  usesFeedingTherapy: z.boolean().optional(),
  feedingTherapyDetails: z.string().optional(),
});

// Treatment History Section
export const treatmentHistorySchema = z.object({
  previousOT: z.boolean().optional(),
  otDetails: z.object({
    provider: z.string().optional(),
    dates: z.string().optional(),
    frequency: z.string().optional(),
    reason: z.string().optional(),
    discharge: z.string().optional(),
  }).optional(),

  previousPT: z.boolean().optional(),
  ptDetails: z.object({
    provider: z.string().optional(),
    dates: z.string().optional(),
    frequency: z.string().optional(),
    reason: z.string().optional(),
    discharge: z.string().optional(),
  }).optional(),

  previousSpeech: z.boolean().optional(),
  speechDetails: z.object({
    provider: z.string().optional(),
    dates: z.string().optional(),
    frequency: z.string().optional(),
    reason: z.string().optional(),
    discharge: z.string().optional(),
  }).optional(),

  previousABA: z.boolean().optional(),
  abaDetails: z.object({
    provider: z.string().optional(),
    dates: z.string().optional(),
    frequency: z.string().optional(),
    reason: z.string().optional(),
    discharge: z.string().optional(),
  }).optional(),

  previousPsychology: z.boolean().optional(),
  psychologyDetails: z.object({
    provider: z.string().optional(),
    dates: z.string().optional(),
    frequency: z.string().optional(),
    reason: z.string().optional(),
    discharge: z.string().optional(),
  }).optional(),

  currentTherapies: z.string().optional(),
  otherInterventions: z.string().optional(),
});

// Social History Section
export const socialHistorySchema = z.object({
  siblings: z.array(z.object({
    name: z.string().optional(),
    age: z.string().optional(),
    relationship: z.string().optional(),
    livesInHome: z.boolean().optional(),
  })).default([]),

  familyStructure: z.string().optional(),
  custodyDetails: z.string().optional(),
  recentFamilyChanges: z.string().optional(),

  familyMedicalHistory: z.object({
    developmentalDelays: z.boolean().optional(),
    learningDisabilities: z.boolean().optional(),
    autism: z.boolean().optional(),
    adhd: z.boolean().optional(),
    mentalHealthConditions: z.boolean().optional(),
    geneticConditions: z.boolean().optional(),
    details: z.string().optional(),
  }).optional(),

  childcareArrangements: z.string().optional(),
  extracurricularActivities: z.string().optional(),
});

// Developmental Milestones Section
export const developmentalMilestonesSchema = z.object({
  // Gross Motor
  satIndependently: z.string().optional(), // age in months
  crawled: z.string().optional(),
  walkedIndependently: z.string().optional(),
  ranFluidly: z.string().optional(),
  climbedStairs: z.string().optional(),
  jumpedBothFeet: z.string().optional(),
  rodeTricycle: z.string().optional(),

  // Fine Motor
  reachedForObjects: z.string().optional(),
  transferredObjects: z.string().optional(),
  usedPincerGrasp: z.string().optional(),
  scribbled: z.string().optional(),
  usedUtensils: z.string().optional(),
  buttoned: z.string().optional(),
  usedScissors: z.string().optional(),

  // Language
  firstWords: z.string().optional(),
  combinedWords: z.string().optional(),
  usedSentences: z.string().optional(),
  followedDirections: z.string().optional(),

  // Self-Care
  toiletTrainedDay: z.string().optional(),
  toiletTrainedNight: z.string().optional(),
  dressedIndependently: z.string().optional(),
  brushedTeeth: z.string().optional(),

  // Concerns
  delaysConcerns: z.boolean().optional(),
  delayDetails: z.string().optional(),
  regressionHistory: z.boolean().optional(),
  regressionDetails: z.string().optional(),
});

// Visual Motor Skills Section
export const visualMotorSkillsSchema = z.object({
  handDominance: z.enum(['left', 'right', 'not_established', 'both']).optional(),
  handDominanceAge: z.string().optional(),

  graspPattern: z.enum(['tripod', 'quadrupod', 'lateral', 'other', 'unknown']).optional(),
  graspPatternDetails: z.string().optional(),

  drawingAbility: z.enum(['scribbles', 'circles', 'crosses', 'squares', 'triangles', 'letters', 'numbers', 'complex']).optional(),

  writingConcerns: z.boolean().optional(),
  writingConcernsDetails: z.string().optional(),

  scissorSkills: z.enum(['not_yet', 'snips', 'lines', 'curves', 'shapes']).optional(),

  puzzleSkills: z.string().optional(),
  constructionSkills: z.string().optional(),

  eyeHandCoordinationConcerns: z.boolean().optional(),
  eyeHandDetails: z.string().optional(),
});

// Social Emotional Skills Section
export const socialEmotionalSkillsSchema = z.object({
  // Emotional Regulation
  frustratedEasily: z.boolean().optional(),
  tantrumFrequency: z.enum(['never', 'rarely', 'sometimes', 'often', 'always']).optional(),
  tantrumDuration: z.string().optional(),
  tantrumTriggers: z.string().optional(),
  calmingStrategies: z.string().optional(),

  // Transitions
  transitionDifficulty: z.boolean().optional(),
  transitionDetails: z.string().optional(),

  // Social Skills
  playsWithPeers: z.boolean().optional(),
  playType: z.enum(['solitary', 'parallel', 'associative', 'cooperative']).optional(),
  friendships: z.string().optional(),
  socialConcerns: z.string().optional(),

  // Emotional Awareness
  identifiesEmotions: z.boolean().optional(),
  expressesEmotions: z.boolean().optional(),
  emotionalConcerns: z.string().optional(),

  // Behavior
  behaviorConcerns: z.boolean().optional(),
  behaviorDetails: z.string().optional(),
  attentionConcerns: z.boolean().optional(),
  attentionDetails: z.string().optional(),
  impulsivityConcerns: z.boolean().optional(),
  impulsivityDetails: z.string().optional(),

  // Anxiety
  anxietyConcerns: z.boolean().optional(),
  anxietyTriggers: z.string().optional(),
  anxietyManagement: z.string().optional(),
});

// Sensory Processing Section
export const sensoryProcessingSchema = z.object({
  // Tactile - Core Questions (Required)
  toleratesBeingTouched: z.enum(sensoryResponseOptions),
  sensitiveToPainTemperature: z.enum(sensoryResponseOptions),
  sensitiveToClothingTextures: z.enum(sensoryResponseOptions),

  // Tactile - Detailed (Optional)
  avoidsMessyPlay: z.enum(sensoryResponseOptions).optional(),
  seeksTouchInput: z.enum(sensoryResponseOptions).optional(),
  underResponsiveToTouch: z.enum(sensoryResponseOptions).optional(),
  difficultyWithGrooming: z.enum(sensoryResponseOptions).optional(),

  // Auditory - Core Questions (Required)
  reactsToLoudSounds: z.enum(sensoryResponseOptions),
  distressedByUnexpectedSounds: z.enum(sensoryResponseOptions),
  difficultyInNoisyEnvironments: z.enum(sensoryResponseOptions),

  // Auditory - Detailed (Optional)
  coversEars: z.enum(sensoryResponseOptions).optional(),
  seeksSounds: z.enum(sensoryResponseOptions).optional(),
  difficultyFollowingVerbalInstructions: z.enum(sensoryResponseOptions).optional(),

  // Visual - Core Questions (Required)
  sensitiveToLighting: z.enum(sensoryResponseOptions),
  difficultyWithVisualClutter: z.enum(sensoryResponseOptions),

  // Visual - Detailed (Optional)
  avoidsEyeContact: z.enum(sensoryResponseOptions).optional(),
  fascinatedByVisualStimuli: z.enum(sensoryResponseOptions).optional(),
  difficultyFindingObjectsInBusyBackground: z.enum(sensoryResponseOptions).optional(),

  // Vestibular/Proprioceptive - Core Questions (Required)
  seeksMovementAndJumping: z.enum(sensoryResponseOptions),
  avoidsMovementActivities: z.enum(sensoryResponseOptions),
  poorBalance: z.enum(sensoryResponseOptions),

  // Vestibular/Proprioceptive - Detailed (Optional)
  fearOfFalling: z.enum(sensoryResponseOptions).optional(),
  crashesBumpsIntoThings: z.enum(sensoryResponseOptions).optional(),
  needsToMoveConstantly: z.enum(sensoryResponseOptions).optional(),
  unsafeClimbing: z.enum(sensoryResponseOptions).optional(),
  poorBodyAwareness: z.enum(sensoryResponseOptions).optional(),

  // Oral - Core (Required)
  pickyEater: z.enum(sensoryResponseOptions),
  mouthsObjects: z.enum(sensoryResponseOptions),

  // Oral - Detailed (Optional)
  gagsOnTextures: z.enum(sensoryResponseOptions).optional(),
  cravesCrunchyFoods: z.enum(sensoryResponseOptions).optional(),
  drools: z.enum(sensoryResponseOptions).optional(),

  // Olfactory (Optional)
  sensitiveToSmells: z.enum(sensoryResponseOptions).optional(),
  seeksSmells: z.enum(sensoryResponseOptions).optional(),

  // Self-Regulation (Optional)
  difficultyCalming: z.enum(sensoryResponseOptions).optional(),
  difficultyWithSleep: z.enum(sensoryResponseOptions).optional(),
  needsSpecificRoutines: z.enum(sensoryResponseOptions).optional(),

  // Additional Notes
  sensoryNotes: z.string().optional(),
  sensoryStrategiesThatWork: z.string().optional(),
});

// ==================== CONSENT SCHEMAS ====================

export const hipaaConsentSchema = z.object({
  hasReadNotice: z.boolean().refine(val => val === true, {
    message: 'You must acknowledge that you have read the notice',
  }),
  signatureName: z.string().min(1, 'Legal name is required'),
  signatureRelationship: z.enum(['self', 'parent', 'guardian', 'legal_representative']),
  signatureDate: z.string(),
});

export const waiverConsentSchema = z.object({
  hasReadWaiver: z.boolean().refine(val => val === true, {
    message: 'You must acknowledge that you have read the waiver',
  }),
  signatureName: z.string().min(1, 'Legal name is required'),
  signatureRelationship: z.enum(['self', 'parent', 'guardian', 'legal_representative']),
  signatureDate: z.string(),
  photoReleaseConsent: z.boolean().optional(),
});

export const cardAuthorizationSchema = z.object({
  hasReadTerms: z.boolean().refine(val => val === true, {
    message: 'You must agree to the terms',
  }),
  signatureName: z.string().min(1, 'Legal name is required'),
  billingName: z.string().min(1, 'Billing name is required'),
  billingAddress: z.string().min(1, 'Billing address is required'),
  billingCity: z.string().min(1, 'City is required'),
  billingState: z.string().min(1, 'State is required'),
  billingZip: z.string().min(1, 'ZIP code is required'),
});

// ==================== COMBINED SCHEMAS ====================

export const parentQuestionnaireSchema = z.object({
  patientInfo: patientInfoSchema,
  parent1: parent1Schema,
  parent2: parent2Schema.optional(),
  emergencyContact: emergencyContactSchema,
  birthHistory: birthHistorySchema,
  medicalHistory: medicalHistorySchema,
  nutritionHistory: nutritionHistorySchema,
  treatmentHistory: treatmentHistorySchema,
  socialHistory: socialHistorySchema,
  developmentalMilestones: developmentalMilestonesSchema,
  visualMotorSkills: visualMotorSkillsSchema,
  socialEmotionalSkills: socialEmotionalSkillsSchema,
  sensoryProcessing: sensoryProcessingSchema,
});

export const fullIntakeSchema = z.object({
  hipaaConsent: hipaaConsentSchema,
  questionnaire: parentQuestionnaireSchema,
  waiverConsent: waiverConsentSchema,
  cardAuthorization: cardAuthorizationSchema.optional(),
});

// ==================== TYPE EXPORTS ====================

export type PatientInfo = z.infer<typeof patientInfoSchema>;
export type Parent1Info = z.infer<typeof parent1Schema>;
export type Parent2Info = z.infer<typeof parent2Schema>;
export type EmergencyContact = z.infer<typeof emergencyContactSchema>;
export type BirthHistory = z.infer<typeof birthHistorySchema>;
export type MedicalHistory = z.infer<typeof medicalHistorySchema>;
export type NutritionHistory = z.infer<typeof nutritionHistorySchema>;
export type TreatmentHistory = z.infer<typeof treatmentHistorySchema>;
export type SocialHistory = z.infer<typeof socialHistorySchema>;
export type DevelopmentalMilestones = z.infer<typeof developmentalMilestonesSchema>;
export type VisualMotorSkills = z.infer<typeof visualMotorSkillsSchema>;
export type SocialEmotionalSkills = z.infer<typeof socialEmotionalSkillsSchema>;
export type SensoryProcessing = z.infer<typeof sensoryProcessingSchema>;
export type HipaaConsent = z.infer<typeof hipaaConsentSchema>;
export type WaiverConsent = z.infer<typeof waiverConsentSchema>;
export type CardAuthorization = z.infer<typeof cardAuthorizationSchema>;
export type ParentQuestionnaire = z.infer<typeof parentQuestionnaireSchema>;
export type FullIntake = z.infer<typeof fullIntakeSchema>;

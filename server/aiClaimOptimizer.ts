import { CptCode, SoapNote, Patient } from "@shared/schema";

export interface CptOptimization {
  originalCode: string;
  optimizedCode: string;
  reason: string;
  reimbursementIncrease: number;
  confidence: number;
}

export interface ClaimOptimizationResult {
  optimizedCptCodes: CptOptimization[];
  aiReviewScore: number;
  aiReviewNotes: string;
  totalOptimizationValue: number;
  complianceNotes: string[];
}

/**
 * AI-powered CPT code optimization based on therapy notes and insurance requirements
 */
export class AiClaimOptimizer {
  private readonly THERAPY_PATTERNS = {
    // Evaluation patterns
    evaluation: [
      /initial\s+evaluation/i,
      /assessment\s+of/i,
      /evaluated\s+for/i,
      /comprehensive\s+evaluation/i,
      /screening/i
    ],
    
    // Therapeutic Activities (97530)
    therapeuticActivities: [
      /therapeutic\s+activities/i,
      /functional\s+training/i,
      /task\s+specific/i,
      /motor\s+planning/i,
      /coordination\s+activities/i,
      /bilateral\s+coordination/i,
      /sensory\s+integration/i
    ],
    
    // Self-care training (97535)
    selfCareTraining: [
      /self.care/i,
      /daily\s+living/i,
      /ADL/i,
      /feeding\s+training/i,
      /dressing/i,
      /grooming/i,
      /toileting/i,
      /independence/i
    ],
    
    // Therapeutic Exercises (97110)
    therapeuticExercises: [
      /strengthening/i,
      /range\s+of\s+motion/i,
      /ROM/i,
      /stretching/i,
      /endurance/i,
      /flexibility/i,
      /muscle\s+strengthening/i
    ],
    
    // Neuromuscular Re-education (97112)
    neuromuscularReeducation: [
      /balance\s+training/i,
      /proprioception/i,
      /postural\s+control/i,
      /motor\s+control/i,
      /gait\s+training/i,
      /coordination\s+training/i
    ],
    
    // Manual Therapy (97140)
    manualTherapy: [
      /manual\s+therapy/i,
      /soft\s+tissue/i,
      /joint\s+mobilization/i,
      /myofascial/i,
      /massage/i,
      /hands.on/i
    ]
  };

  private readonly CPT_CODES = {
    // Evaluations
    '97165': { description: 'OT Evaluation (Low Complexity)', baseRate: 120, category: 'evaluation' },
    '97166': { description: 'OT Evaluation (Moderate Complexity)', baseRate: 150, category: 'evaluation' },
    '97167': { description: 'OT Evaluation (High Complexity)', baseRate: 180, category: 'evaluation' },
    
    // Treatment
    '97530': { description: 'Therapeutic Activities', baseRate: 95, category: 'treatment' },
    '97535': { description: 'Self-Care Training', baseRate: 90, category: 'treatment' },
    '97110': { description: 'Therapeutic Exercises', baseRate: 85, category: 'treatment' },
    '97112': { description: 'Neuromuscular Re-education', baseRate: 100, category: 'treatment' },
    '97140': { description: 'Manual Therapy', baseRate: 105, category: 'treatment' }
  };

  private readonly INSURANCE_PREFERENCES = {
    'Anthem': {
      preferred: ['97530', '97535', '97110'],
      avoided: ['97140'],
      reimbursementMultiplier: 0.85
    },
    'UnitedHealth': {
      preferred: ['97166', '97530', '97112'],
      avoided: ['97167'],
      reimbursementMultiplier: 0.82
    },
    'Aetna': {
      preferred: ['97165', '97110', '97535'],
      avoided: ['97140'],
      reimbursementMultiplier: 0.80
    },
    'Blue Cross Blue Shield': {
      preferred: ['97530', '97110', '97112'],
      avoided: [],
      reimbursementMultiplier: 0.88
    },
    'Cigna': {
      preferred: ['97166', '97535', '97530'],
      avoided: ['97167'],
      reimbursementMultiplier: 0.83
    }
  };

  /**
   * Analyze SOAP notes and optimize CPT codes for maximum reimbursement
   */
  async optimizeClaim(
    soapNote: SoapNote, 
    patient: Patient, 
    insuranceProvider?: string,
    originalCptCode?: string
  ): Promise<ClaimOptimizationResult> {
    
    const fullNotes = `${soapNote.subjective} ${soapNote.objective} ${soapNote.assessment} ${soapNote.plan}`;
    
    // Analyze therapy content to determine best CPT codes
    const suggestedCodes = this.analyzeTreatmentContent(fullNotes, soapNote.sessionType ?? undefined);
    
    // Apply insurance-specific optimizations
    const optimizedCodes = this.applyInsuranceOptimization(
      suggestedCodes, 
      insuranceProvider || patient.insuranceProvider || 'Generic',
      originalCptCode || undefined
    );

    // Calculate AI review score based on documentation quality
    const aiReviewScore = this.calculateDocumentationScore(soapNote);
    
    // Generate compliance notes
    const complianceNotes = this.generateComplianceNotes(soapNote, optimizedCodes);

    const totalOptimizationValue = optimizedCodes.reduce(
      (sum, opt) => sum + opt.reimbursementIncrease, 0
    );

    return {
      optimizedCptCodes: optimizedCodes,
      aiReviewScore,
      aiReviewNotes: this.generateAiReviewNotes(aiReviewScore, optimizedCodes),
      totalOptimizationValue,
      complianceNotes
    };
  }

  private analyzeTreatmentContent(notes: string, sessionType: string = 'individual'): string[] {
    const suggestedCodes: string[] = [];
    const lowerNotes = notes.toLowerCase();

    // Check for evaluation patterns
    if (this.THERAPY_PATTERNS.evaluation.some(pattern => pattern.test(lowerNotes))) {
      // Determine evaluation complexity based on content depth
      const wordCount = notes.split(/\s+/).length;
      if (wordCount > 200) {
        suggestedCodes.push('97167'); // High complexity
      } else if (wordCount > 100) {
        suggestedCodes.push('97166'); // Moderate complexity
      } else {
        suggestedCodes.push('97165'); // Low complexity
      }
    }

    // Check for treatment patterns
    if (this.THERAPY_PATTERNS.therapeuticActivities.some(pattern => pattern.test(lowerNotes))) {
      suggestedCodes.push('97530');
    }

    if (this.THERAPY_PATTERNS.selfCareTraining.some(pattern => pattern.test(lowerNotes))) {
      suggestedCodes.push('97535');
    }

    if (this.THERAPY_PATTERNS.therapeuticExercises.some(pattern => pattern.test(lowerNotes))) {
      suggestedCodes.push('97110');
    }

    if (this.THERAPY_PATTERNS.neuromuscularReeducation.some(pattern => pattern.test(lowerNotes))) {
      suggestedCodes.push('97112');
    }

    if (this.THERAPY_PATTERNS.manualTherapy.some(pattern => pattern.test(lowerNotes))) {
      suggestedCodes.push('97140');
    }

    // Default to therapeutic activities if no specific patterns found
    if (suggestedCodes.length === 0) {
      suggestedCodes.push('97530');
    }

    return suggestedCodes;
  }

  private applyInsuranceOptimization(
    suggestedCodes: string[], 
    insuranceProvider: string,
    originalCode?: string
  ): CptOptimization[] {
    
    const insurancePrefs = this.INSURANCE_PREFERENCES[insuranceProvider as keyof typeof this.INSURANCE_PREFERENCES] 
      || { preferred: [], avoided: [], reimbursementMultiplier: 0.80 };

    const optimizations: CptOptimization[] = [];

    for (const code of suggestedCodes) {
      const cptInfo = this.CPT_CODES[code as keyof typeof this.CPT_CODES];
      if (!cptInfo) continue;

      let optimizedCode = code;
      let reason = "Matches documented treatment activities";
      let reimbursementIncrease = 0;
      let confidence = 0.85;

      // Check if current code is preferred by insurance
      if (insurancePrefs.preferred.includes(code)) {
        reason += ` and is preferred by ${insuranceProvider}`;
        confidence = 0.95;
      }

      // Check if we can upgrade to a preferred code
      if (!insurancePrefs.preferred.includes(code)) {
        const preferredAlternative = insurancePrefs.preferred.find(prefCode => {
          const prefInfo = this.CPT_CODES[prefCode as keyof typeof this.CPT_CODES];
          return prefInfo && prefInfo.category === cptInfo.category;
        });

        if (preferredAlternative) {
          const altInfo = this.CPT_CODES[preferredAlternative as keyof typeof this.CPT_CODES];
          if (altInfo) {
            optimizedCode = preferredAlternative;
            reimbursementIncrease = (altInfo.baseRate - cptInfo.baseRate) * insurancePrefs.reimbursementMultiplier;
            reason = `Upgraded to ${insuranceProvider}-preferred code for better reimbursement`;
            confidence = 0.90;
          }
        }
      }

      // Avoid codes that insurance doesn't favor
      if ((insurancePrefs.avoided as string[]).includes(optimizedCode)) {
        // Find alternative in same category
        const alternative = Object.keys(this.CPT_CODES).find(altCode => {
          const altInfo = this.CPT_CODES[altCode as keyof typeof this.CPT_CODES];
          return altInfo.category === cptInfo.category &&
                 !(insurancePrefs.avoided as string[]).includes(altCode) &&
                 altCode !== optimizedCode;
        });

        if (alternative) {
          const altInfo = this.CPT_CODES[alternative as keyof typeof this.CPT_CODES];
          if (altInfo) {
            optimizedCode = alternative;
            reason = `Switched from ${insuranceProvider}-avoided code to improve approval odds`;
            confidence = 0.80;
          }
        }
      }

      optimizations.push({
        originalCode: originalCode || code,
        optimizedCode,
        reason,
        reimbursementIncrease: Math.max(0, reimbursementIncrease),
        confidence
      });
    }

    return optimizations;
  }

  private calculateDocumentationScore(soapNote: SoapNote): number {
    let score = 0;

    // Base scores for each SOAP section
    if (soapNote.subjective && soapNote.subjective.length > 50) score += 25;
    if (soapNote.objective && soapNote.objective.length > 50) score += 25;
    if (soapNote.assessment && soapNote.assessment.length > 50) score += 25;
    if (soapNote.plan && soapNote.plan.length > 30) score += 25;

    // Bonus points for specific clinical elements
    const allText = `${soapNote.subjective} ${soapNote.objective} ${soapNote.assessment} ${soapNote.plan}`.toLowerCase();
    
    if (/progress|improvement|decline/.test(allText)) score += 5;
    if (/goal|objective/.test(allText)) score += 5;
    if (/functional|independence/.test(allText)) score += 5;
    if (/safety|precaution/.test(allText)) score += 5;
    if (/home\s+program|carry.over/.test(allText)) score += 5;

    return Math.min(100, score);
  }

  private generateAiReviewNotes(score: number, optimizations: CptOptimization[]): string {
    if (score >= 90) {
      return `Excellent documentation quality. ${optimizations.length} CPT code(s) optimized for maximum reimbursement. Ready for submission.`;
    } else if (score >= 75) {
      return `Good documentation with minor optimization opportunities. ${optimizations.length} CPT code(s) adjusted for better reimbursement.`;
    } else if (score >= 60) {
      return `Adequate documentation. Consider adding more functional outcomes. ${optimizations.length} CPT code(s) optimized.`;
    } else {
      return `Documentation needs improvement. Add more specific treatment activities and outcomes for better approval odds.`;
    }
  }

  private generateComplianceNotes(soapNote: SoapNote, optimizations: CptOptimization[]): string[] {
    const notes: string[] = [];
    
    const allText = `${soapNote.subjective} ${soapNote.objective} ${soapNote.assessment} ${soapNote.plan}`.toLowerCase();

    // Check for required elements
    if (!/progress|response|improvement|decline/.test(allText)) {
      notes.push("Consider documenting patient's response to treatment");
    }

    if (!/goal|objective/.test(allText)) {
      notes.push("Include specific functional goals or treatment objectives");
    }

    if (!/duration|minutes/.test(allText) && !soapNote.sessionType?.includes('group')) {
      notes.push("Document treatment duration for accurate billing");
    }

    if (optimizations.some(opt => opt.optimizedCode.startsWith('971'))) {
      notes.push("Ensure treatment activities match selected CPT codes for audit compliance");
    }

    return notes;
  }
}

export const aiClaimOptimizer = new AiClaimOptimizer();
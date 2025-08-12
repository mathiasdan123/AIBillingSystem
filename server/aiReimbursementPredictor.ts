interface ReimbursementRecord {
  insuranceProvider: string;
  cptCode: string;
  practiceCharge: number;
  insuranceReimbursement: number;
  patientResponsibility: number;
  dateOfService: string;
  planType?: string; // HMO, PPO, EPO, etc.
  deductibleMet?: boolean;
  copayAmount?: number;
  coinsurancePercentage?: number;
  region?: string; // Geographic region
  patientAge?: number;
  sessionType?: string; // Initial eval, follow-up, etc.
}

interface PredictionFeatures {
  insuranceProvider: string;
  cptCode: string;
  practiceCharge: number;
  planType?: string;
  deductibleMet?: boolean;
  region?: string;
  patientAge?: number;
  sessionType?: string;
  recentTrends?: boolean; // Include recent 6-month trends
}

interface ReimbursementPrediction {
  predictedReimbursement: number;
  confidenceScore: number; // 0-1 scale
  dataPoints: number; // How many historical records used
  trends: {
    recent6Months: number; // Average change in last 6 months
    seasonalVariation: number; // Seasonal adjustment factor
  };
  recommendations: string[];
}

export class AIReimbursementPredictor {
  private historicalData: ReimbursementRecord[] = [];
  
  constructor(historicalRecords?: ReimbursementRecord[]) {
    if (historicalRecords) {
      this.historicalData = historicalRecords;
    }
  }

  /**
   * Add new reimbursement data to improve predictions
   */
  addReimbursementRecord(record: ReimbursementRecord): void {
    this.historicalData.push(record);
  }

  /**
   * Bulk import historical data from CSV or database
   */
  importHistoricalData(records: ReimbursementRecord[]): void {
    this.historicalData = [...this.historicalData, ...records];
  }

  /**
   * Predict reimbursement based on historical patterns
   */
  predictReimbursement(features: PredictionFeatures): ReimbursementPrediction {
    // Filter relevant historical data
    const relevantRecords = this.filterRelevantRecords(features);
    
    if (relevantRecords.length === 0) {
      return this.getFallbackPrediction(features);
    }

    // Calculate weighted average based on similarity
    const weightedPrediction = this.calculateWeightedPrediction(relevantRecords, features);
    
    // Analyze trends
    const trends = this.analyzeTrends(relevantRecords);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(relevantRecords, features);

    return {
      predictedReimbursement: weightedPrediction.amount,
      confidenceScore: weightedPrediction.confidence,
      dataPoints: relevantRecords.length,
      trends,
      recommendations
    };
  }

  /**
   * Get predictions for multiple CPT codes at once
   */
  predictMultipleCodes(
    insuranceProvider: string, 
    cptCodes: string[], 
    baseFeatures: Omit<PredictionFeatures, 'cptCode'>
  ): Record<string, ReimbursementPrediction> {
    const predictions: Record<string, ReimbursementPrediction> = {};
    
    for (const cptCode of cptCodes) {
      predictions[cptCode] = this.predictReimbursement({
        ...baseFeatures,
        cptCode,
        insuranceProvider
      });
    }
    
    return predictions;
  }

  private filterRelevantRecords(features: PredictionFeatures): ReimbursementRecord[] {
    return this.historicalData.filter(record => {
      // Exact matches get priority
      if (record.insuranceProvider === features.insuranceProvider && 
          record.cptCode === features.cptCode) {
        return true;
      }
      
      // Similar insurance providers (same company, different plans)
      if (this.areSimilarInsurers(record.insuranceProvider, features.insuranceProvider) &&
          record.cptCode === features.cptCode) {
        return true;
      }
      
      // Same insurer, similar CPT codes
      if (record.insuranceProvider === features.insuranceProvider &&
          this.areSimilarCptCodes(record.cptCode, features.cptCode)) {
        return true;
      }
      
      return false;
    }).sort((a, b) => {
      // Sort by relevance (most recent and exact matches first)
      const aScore = this.calculateRelevanceScore(a, features);
      const bScore = this.calculateRelevanceScore(b, features);
      return bScore - aScore;
    });
  }

  private calculateRelevanceScore(record: ReimbursementRecord, features: PredictionFeatures): number {
    let score = 0;
    
    // Exact matches
    if (record.insuranceProvider === features.insuranceProvider) score += 50;
    if (record.cptCode === features.cptCode) score += 50;
    
    // Recency (more recent = higher score)
    const daysSince = this.daysSinceDate(record.dateOfService);
    score += Math.max(0, 30 - (daysSince / 30)); // Up to 30 points for recency
    
    // Plan type match
    if (record.planType && features.planType && record.planType === features.planType) {
      score += 20;
    }
    
    // Deductible status match
    if (record.deductibleMet === features.deductibleMet) score += 10;
    
    // Regional match
    if (record.region && features.region && record.region === features.region) {
      score += 15;
    }
    
    return score;
  }

  private calculateWeightedPrediction(
    records: ReimbursementRecord[], 
    features: PredictionFeatures
  ): { amount: number; confidence: number } {
    if (records.length === 0) {
      return { amount: 0, confidence: 0 };
    }
    
    let totalWeight = 0;
    let weightedSum = 0;
    
    records.forEach(record => {
      const weight = this.calculateRelevanceScore(record, features);
      totalWeight += weight;
      weightedSum += record.insuranceReimbursement * weight;
    });
    
    const predictedAmount = weightedSum / totalWeight;
    
    // Calculate confidence based on data consistency and quantity
    const variance = this.calculateVariance(records.map(r => r.insuranceReimbursement));
    const dataConsistency = Math.max(0, 1 - (variance / predictedAmount));
    const sampleSizeConfidence = Math.min(1, records.length / 20); // Full confidence with 20+ data points
    
    const confidence = (dataConsistency * 0.7) + (sampleSizeConfidence * 0.3);
    
    return {
      amount: Math.round(predictedAmount * 100) / 100,
      confidence: Math.round(confidence * 100) / 100
    };
  }

  private analyzeTrends(records: ReimbursementRecord[]): ReimbursementPrediction['trends'] {
    const sortedRecords = records
      .sort((a, b) => new Date(a.dateOfService).getTime() - new Date(b.dateOfService).getTime());
    
    // Calculate 6-month trend
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const recentRecords = sortedRecords.filter(r => 
      new Date(r.dateOfService) >= sixMonthsAgo
    );
    
    const olderRecords = sortedRecords.filter(r => 
      new Date(r.dateOfService) < sixMonthsAgo
    );
    
    const recentAvg = this.calculateAverage(recentRecords.map(r => r.insuranceReimbursement));
    const olderAvg = this.calculateAverage(olderRecords.map(r => r.insuranceReimbursement));
    
    const recent6Months = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
    
    // Seasonal variation (simplified)
    const seasonalVariation = this.calculateSeasonalVariation(sortedRecords);
    
    return {
      recent6Months: Math.round(recent6Months * 100) / 100,
      seasonalVariation: Math.round(seasonalVariation * 100) / 100
    };
  }

  private generateRecommendations(
    records: ReimbursementRecord[], 
    features: PredictionFeatures
  ): string[] {
    const recommendations: string[] = [];
    
    if (records.length < 5) {
      recommendations.push("Limited historical data available. Estimates may be less accurate.");
    }
    
    const avgReimbursement = this.calculateAverage(records.map(r => r.insuranceReimbursement));
    const variance = this.calculateVariance(records.map(r => r.insuranceReimbursement));
    
    if (variance / avgReimbursement > 0.3) {
      recommendations.push("High variability in reimbursements. Consider verifying plan details.");
    }
    
    // Check for recent declining trends
    const recentRecords = records
      .filter(r => this.daysSinceDate(r.dateOfService) < 90)
      .map(r => r.insuranceReimbursement);
    
    if (recentRecords.length > 2) {
      const trend = this.calculateTrend(recentRecords);
      if (trend < -0.1) {
        recommendations.push("Recent downward trend in reimbursements detected.");
      }
    }
    
    return recommendations;
  }

  private getFallbackPrediction(features: PredictionFeatures): ReimbursementPrediction {
    // Use current hardcoded estimates as fallback
    const fallbackRates: Record<string, Record<string, number>> = {
      'UnitedHealth': { '97166': 85, '97530': 75, '97110': 70 },
      'Anthem': { '97166': 80, '97530': 70, '97110': 65 },
      'Aetna': { '97166': 82, '97530': 72, '97110': 68 },
      'BCBS': { '97166': 88, '97530': 78, '97110': 73 },
      'Cigna': { '97166': 79, '97530': 69, '97110': 64 }
    };
    
    const rate = fallbackRates[features.insuranceProvider]?.[features.cptCode] || 70;
    
    return {
      predictedReimbursement: rate,
      confidenceScore: 0.3, // Low confidence for fallback
      dataPoints: 0,
      trends: { recent6Months: 0, seasonalVariation: 0 },
      recommendations: ["Using industry averages. Upload historical data for accurate predictions."]
    };
  }

  // Utility methods
  private areSimilarInsurers(insurer1: string, insurer2: string): boolean {
    const normalizeInsurer = (name: string) => 
      name.toLowerCase().replace(/[^a-z]/g, '');
    
    const norm1 = normalizeInsurer(insurer1);
    const norm2 = normalizeInsurer(insurer2);
    
    // Check if they share common keywords
    const keywords1 = norm1.split(/(?=[A-Z])/).filter(k => k.length > 2);
    const keywords2 = norm2.split(/(?=[A-Z])/).filter(k => k.length > 2);
    
    return keywords1.some(k1 => keywords2.some(k2 => k1.includes(k2) || k2.includes(k1)));
  }

  private areSimilarCptCodes(code1: string, code2: string): boolean {
    // OT evaluation codes are similar to each other
    const evalCodes = ['97165', '97166', '97167'];
    if (evalCodes.includes(code1) && evalCodes.includes(code2)) return true;
    
    // Therapy codes are similar
    const therapyCodes = ['97110', '97112', '97530', '97535', '97140'];
    if (therapyCodes.includes(code1) && therapyCodes.includes(code2)) return true;
    
    return false;
  }

  private daysSinceDate(dateString: string): number {
    const date = new Date(dateString);
    const now = new Date();
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  }

  private calculateAverage(numbers: number[]): number {
    return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
  }

  private calculateVariance(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const avg = this.calculateAverage(numbers);
    const squaredDiffs = numbers.map(n => Math.pow(n - avg, 2));
    return this.calculateAverage(squaredDiffs);
  }

  private calculateTrend(numbers: number[]): number {
    if (numbers.length < 2) return 0;
    const firstHalf = numbers.slice(0, Math.floor(numbers.length / 2));
    const secondHalf = numbers.slice(Math.floor(numbers.length / 2));
    const firstAvg = this.calculateAverage(firstHalf);
    const secondAvg = this.calculateAverage(secondHalf);
    return firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;
  }

  private calculateSeasonalVariation(records: ReimbursementRecord[]): number {
    // Simplified seasonal calculation
    const monthlyAvgs: Record<number, number[]> = {};
    
    records.forEach(record => {
      const month = new Date(record.dateOfService).getMonth();
      if (!monthlyAvgs[month]) monthlyAvgs[month] = [];
      monthlyAvgs[month].push(record.insuranceReimbursement);
    });
    
    const monthlyMeans = Object.keys(monthlyAvgs).map(month => 
      this.calculateAverage(monthlyAvgs[parseInt(month)])
    );
    
    if (monthlyMeans.length === 0) return 0;
    
    const overallMean = this.calculateAverage(monthlyMeans);
    const variance = this.calculateVariance(monthlyMeans);
    
    return variance / overallMean;
  }

  /**
   * Export model training data for external ML systems
   */
  exportTrainingData(): {
    features: any[];
    labels: number[];
    metadata: { totalRecords: number; dateRange: string[] };
  } {
    const features = this.historicalData.map(record => ({
      insuranceProvider: record.insuranceProvider,
      cptCode: record.cptCode,
      practiceCharge: record.practiceCharge,
      planType: record.planType || 'unknown',
      deductibleMet: record.deductibleMet || false,
      region: record.region || 'unknown',
      patientAge: record.patientAge || 0,
      sessionType: record.sessionType || 'unknown',
      daysSinceRecord: this.daysSinceDate(record.dateOfService)
    }));

    const labels = this.historicalData.map(record => record.insuranceReimbursement);
    
    const dates = this.historicalData.map(r => r.dateOfService).sort();
    const dateRange = dates.length > 0 ? [dates[0], dates[dates.length - 1]] : [];

    return {
      features,
      labels,
      metadata: {
        totalRecords: this.historicalData.length,
        dateRange
      }
    };
  }
}

export default AIReimbursementPredictor;
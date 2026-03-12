-- Add denial_prediction column to claims table for AI denial risk analysis
ALTER TABLE claims ADD COLUMN IF NOT EXISTS denial_prediction JSONB;

-- Add comment for documentation
COMMENT ON COLUMN claims.denial_prediction IS 'AI denial prediction result: { riskScore, riskLevel, issues, overallRecommendation, analyzedAt }';

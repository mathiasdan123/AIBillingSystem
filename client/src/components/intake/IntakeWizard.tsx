/**
 * IntakeWizard Component
 *
 * Main container for the multi-step intake form wizard.
 * Manages step navigation, data persistence, and submission.
 *
 * Steps are built dynamically from `STEP_DEFS` so optional steps (e.g. the
 * payer-advocacy Benefits Authorization step, gated by the practice flag
 * `benefitsAuthEnabled`) can be inserted without renumbering everything by
 * hand. Position in the rendered wizard is derived, not hardcoded.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { IntakeBranding } from './IntakeBranding';
import { IntakeProgress } from './IntakeProgress';
import { HipaaNoticeStep } from './steps/HipaaNoticeStep';
import { ParentQuestionnaireStep } from './steps/ParentQuestionnaireStep';
import { WaiverReleaseStep } from './steps/WaiverReleaseStep';
import { BenefitsAuthorizationStep } from './steps/BenefitsAuthorizationStep';
import { CreditCardAuthStep } from './steps/CreditCardAuthStep';
import { ReviewSubmitStep } from './steps/ReviewSubmitStep';

interface IntakeWizardProps {
  portalToken: string;
}

interface IntakeStatus {
  intakeCompleted: boolean;
  intakeCompletedAt: string | null;
  currentStep: number;
  steps: {
    hipaaNotice: { completed: boolean; signedAt: string | null };
    parentQuestionnaire: { completed: boolean; savedSections: string[] };
    waiverRelease: { completed: boolean; signedAt: string | null };
    benefitsAuth?: { enabled: boolean; completed: boolean; signedAt: string | null };
    creditCardAuth: { completed: boolean; required: boolean; skipped: boolean };
    reviewSubmit: { completed: boolean; submittedAt: string | null };
  };
  branding: {
    practiceId: number;
    practiceName: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
  };
  requireCardOnFile: boolean;
  benefitsAuthEnabled?: boolean;
}

interface IntakeData {
  intakeData: Record<string, any>;
  intakeCompletedAt: string | null;
}

/** Stable identifiers for each step in display order. */
type StepKey =
  | 'hipaaNotice'
  | 'parentQuestionnaire'
  | 'waiverRelease'
  | 'benefitsAuth'
  | 'creditCardAuth'
  | 'reviewSubmit';

const STEP_TITLES: Record<StepKey, string> = {
  hipaaNotice: 'HIPAA Notice',
  parentQuestionnaire: 'Parent Questionnaire',
  waiverRelease: 'Waiver & Release',
  benefitsAuth: 'Benefits Authorization',
  creditCardAuth: 'Card Authorization',
  reviewSubmit: 'Review & Submit',
};

export function IntakeWizard({ portalToken }: IntakeWizardProps) {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [localData, setLocalData] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);

  // Fetch intake status
  const { data: status, isLoading: statusLoading, error: statusError } = useQuery<IntakeStatus>({
    queryKey: ['intake-status'],
    queryFn: async () => {
      const res = await fetch('/api/patient-portal/intake/status', {
        headers: { Authorization: `Bearer ${portalToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch intake status');
      return res.json();
    },
  });

  // Fetch saved intake data
  const { data: savedData, isLoading: dataLoading } = useQuery<IntakeData>({
    queryKey: ['intake-data'],
    queryFn: async () => {
      const res = await fetch('/api/patient-portal/intake/data', {
        headers: { Authorization: `Bearer ${portalToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch intake data');
      return res.json();
    },
  });

  // The ordered list of step keys for THIS practice. Benefits Authorization is
  // only present when the practice has enabled it (flag default-OFF).
  const stepKeys = useMemo<StepKey[]>(() => {
    const benefitsAuthOn =
      status?.benefitsAuthEnabled === true || status?.steps?.benefitsAuth?.enabled === true;
    const keys: StepKey[] = ['hipaaNotice', 'parentQuestionnaire', 'waiverRelease'];
    if (benefitsAuthOn) keys.push('benefitsAuth');
    keys.push('creditCardAuth', 'reviewSubmit');
    return keys;
  }, [status?.benefitsAuthEnabled, status?.steps?.benefitsAuth?.enabled]);

  const totalSteps = stepKeys.length;
  const keyForStep = (n: number): StepKey | undefined => stepKeys[n - 1];

  // Initialize local data from saved data
  useEffect(() => {
    if (savedData?.intakeData) {
      setLocalData(savedData.intakeData);
    }
  }, [savedData]);

  // Set current step from status on first load only
  useEffect(() => {
    if (status?.currentStep && currentStep === 1) {
      setCurrentStep(status.currentStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Save step data mutation
  const saveStepMutation = useMutation({
    mutationFn: async ({ stepId, data }: { stepId: string; data: any }) => {
      const res = await fetch(`/api/patient-portal/intake/step/${stepId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${portalToken}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to save step data');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intake-status'] });
    },
  });

  // Create consent mutation
  const createConsentMutation = useMutation({
    mutationFn: async (data: {
      consentType: string;
      signatureName: string;
      signatureRelationship: string;
    }) => {
      const res = await fetch('/api/patient-portal/intake/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${portalToken}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create consent');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intake-status'] });
    },
  });

  // Submit intake mutation
  const submitIntakeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/patient-portal/intake/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${portalToken}`,
        },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to submit intake');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intake-status'] });
      queryClient.invalidateQueries({ queryKey: ['patient-portal-dashboard'] });
    },
  });

  // Handle step data update (local + auto-save)
  const handleStepDataChange = useCallback(
    (stepId: string, data: any) => {
      setLocalData((prev) => ({
        ...prev,
        sections: {
          ...(prev.sections || {}),
          [stepId]: data,
        },
      }));
      // Debounced auto-save
      saveStepMutation.mutate({ stepId, data });
    },
    [saveStepMutation]
  );

  // Handle consent signing
  const handleSignConsent = useCallback(
    async (consentType: string, signatureName: string, signatureRelationship: string) => {
      try {
        await createConsentMutation.mutateAsync({
          consentType,
          signatureName,
          signatureRelationship,
        });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to sign consent');
        return false;
      }
    },
    [createConsentMutation]
  );

  // Handle navigation to any step
  const goToStep = useCallback(
    (step: number) => {
      setError(null);
      if (step >= 1 && step <= totalSteps) {
        setCurrentStep(step);
      }
    },
    [totalSteps]
  );

  // Handle next step
  const handleNext = useCallback(() => {
    setError(null);
    setCurrentStep((s) => (s < totalSteps ? s + 1 : s));
  }, [totalSteps]);

  // Handle previous step
  const handlePrevious = useCallback(() => {
    setError(null);
    setCurrentStep((s) => (s > 1 ? s - 1 : s));
  }, []);

  // Handle final submission
  const handleSubmit = useCallback(async () => {
    try {
      setError(null);
      await submitIntakeMutation.mutateAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit intake');
    }
  }, [submitIntakeMutation]);

  // Loading state
  if (statusLoading || dataLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error state
  if (statusError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load intake form. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  // Already completed state
  if (status?.intakeCompleted) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Intake Complete</h2>
          <p className="text-gray-600">
            Thank you for completing your intake form. Your information has been saved.
          </p>
          {status.intakeCompletedAt && (
            <p className="text-sm text-gray-500 mt-2">
              Completed on {new Date(status.intakeCompletedAt).toLocaleDateString()}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const branding = status?.branding;

  // Per-step completion lookup, used by both the progress bar and submit gate.
  const isStepCompleted = (key: StepKey): boolean => {
    switch (key) {
      case 'hipaaNotice':
        return status?.steps.hipaaNotice.completed || false;
      case 'parentQuestionnaire':
        return status?.steps.parentQuestionnaire.completed || false;
      case 'waiverRelease':
        return status?.steps.waiverRelease.completed || false;
      case 'benefitsAuth':
        return status?.steps.benefitsAuth?.completed || false;
      case 'creditCardAuth':
        return (
          status?.steps.creditCardAuth.completed ||
          status?.steps.creditCardAuth.skipped ||
          false
        );
      case 'reviewSubmit':
        return status?.steps.reviewSubmit.completed || false;
      default:
        return false;
    }
  };

  const steps = stepKeys.map((key, idx) => ({
    id: idx + 1,
    title: STEP_TITLES[key],
    completed: isStepCompleted(key),
  }));

  const activeKey = keyForStep(currentStep);

  // Submit gate: required steps complete. Benefits Auth is NOT gating (optional
  // advocacy consent) — its absence never blocks intake submission.
  const canSubmit =
    !!status?.steps.hipaaNotice.completed &&
    !!status?.steps.waiverRelease.completed &&
    (status?.steps.creditCardAuth.completed ||
      status?.steps.creditCardAuth.skipped ||
      !status?.requireCardOnFile);
  const missingSteps: string[] = [];
  if (!status?.steps.hipaaNotice.completed) missingSteps.push('HIPAA Notice');
  if (!status?.steps.waiverRelease.completed) missingSteps.push('Waiver & Release');
  if (
    status?.requireCardOnFile &&
    !status?.steps.creditCardAuth.completed &&
    !status?.steps.creditCardAuth.skipped
  ) {
    missingSteps.push('Card Authorization');
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      {/* Branding Header */}
      {branding && (
        <IntakeBranding
          practiceName={branding.practiceName}
          logoUrl={branding.logoUrl}
          primaryColor={branding.primaryColor}
        />
      )}

      {/* Progress Indicator */}
      <IntakeProgress
        steps={steps}
        currentStep={currentStep}
        primaryColor={branding?.primaryColor}
        onStepClick={goToStep}
      />

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Step Content */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          {activeKey === 'hipaaNotice' && (
            <HipaaNoticeStep
              completed={status?.steps.hipaaNotice.completed || false}
              onSign={handleSignConsent}
              onComplete={handleNext}
            />
          )}
          {activeKey === 'parentQuestionnaire' && (
            <ParentQuestionnaireStep
              data={localData.sections || {}}
              onDataChange={handleStepDataChange}
              onComplete={handleNext}
            />
          )}
          {activeKey === 'waiverRelease' && (
            <WaiverReleaseStep
              completed={status?.steps.waiverRelease.completed || false}
              onSign={handleSignConsent}
              onComplete={handleNext}
            />
          )}
          {activeKey === 'benefitsAuth' && (
            <BenefitsAuthorizationStep
              completed={status?.steps.benefitsAuth?.completed || false}
              onSign={handleSignConsent}
              onComplete={handleNext}
            />
          )}
          {activeKey === 'creditCardAuth' && (
            <CreditCardAuthStep
              portalToken={portalToken}
              required={status?.requireCardOnFile || false}
              completed={status?.steps.creditCardAuth.completed || false}
              skipped={status?.steps.creditCardAuth.skipped || false}
              onComplete={handleNext}
            />
          )}
          {activeKey === 'reviewSubmit' && (
            <ReviewSubmitStep
              data={localData}
              status={status}
              onSubmit={handleSubmit}
              isSubmitting={submitIntakeMutation.isPending}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      <div className="space-y-3">
        <div className="flex justify-between">
          <Button variant="outline" onClick={handlePrevious} disabled={currentStep === 1}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>
          {currentStep < totalSteps ? (
            <Button onClick={handleNext}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitIntakeMutation.isPending || !canSubmit}>
              {submitIntakeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Intake'
              )}
            </Button>
          )}
        </div>
        {activeKey === 'reviewSubmit' && !canSubmit && missingSteps.length > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please complete the following before submitting: {missingSteps.join(', ')}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

export default IntakeWizard;

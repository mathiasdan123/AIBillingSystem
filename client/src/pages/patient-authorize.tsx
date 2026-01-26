import { useState, useEffect } from 'react';
import { useParams } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Shield, Check, X, AlertCircle, Loader2, Lock, FileText, Clock, Heart } from 'lucide-react';

interface AuthorizationInfo {
  id: number;
  status: string;
  scopes: string[];
  practice: {
    name: string;
    logoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
    phone?: string;
    email?: string;
    privacyPolicyUrl?: string;
  };
  patient: {
    firstName: string;
  };
  expiresAt: string;
}

const scopeLabels: Record<string, { label: string; description: string; icon: typeof Shield }> = {
  eligibility: {
    label: 'Insurance Eligibility',
    description: 'Verify your coverage status and plan information',
    icon: Shield,
  },
  benefits: {
    label: 'Benefits Information',
    description: 'Access deductibles, copays, and coverage limits',
    icon: FileText,
  },
  claims_history: {
    label: 'Claims History',
    description: 'View past claims and payment records',
    icon: Clock,
  },
  prior_auth: {
    label: 'Prior Authorization',
    description: 'Check prior authorization requirements',
    icon: Check,
  },
};

export default function PatientAuthorizePage() {
  const { token } = useParams<{ token: string }>();
  const [consentChecked, setConsentChecked] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [decision, setDecision] = useState<'authorized' | 'denied' | null>(null);

  // Fetch authorization info
  const {
    data: authInfo,
    isLoading,
    error,
  } = useQuery<AuthorizationInfo>({
    queryKey: [`/api/authorize/${token}`],
    enabled: !!token,
    retry: false,
  });

  // Submit decision mutation
  const submitMutation = useMutation({
    mutationFn: async (choice: 'authorize' | 'deny') => {
      const response = await fetch(`/api/authorize/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: choice,
          signature: choice === 'authorize' ? 'Electronic consent via web form' : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to submit decision');
      }

      return response.json();
    },
    onSuccess: (data) => {
      setSubmitted(true);
      setDecision(data.status);
    },
  });

  // Dynamic styling based on practice branding
  const primaryColor = authInfo?.practice?.primaryColor || '#2563eb';
  const secondaryColor = authInfo?.practice?.secondaryColor || '#1e40af';

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-12 text-center">
            <Loader2 className="w-12 h-12 animate-spin mx-auto text-blue-500 mb-4" />
            <p className="text-gray-600">Loading authorization request...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !authInfo) {
    const errorMessage = error instanceof Error ? error.message : 'Authorization not found';
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-12 text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Unable to Load</h2>
            <p className="text-gray-600">{errorMessage}</p>
            <p className="text-sm text-gray-500 mt-4">
              This link may have expired or already been used. Please contact your healthcare provider
              for a new authorization link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            {authInfo.practice.logoUrl && (
              <img
                src={authInfo.practice.logoUrl}
                alt={authInfo.practice.name}
                className="h-12 mx-auto mb-4"
              />
            )}
            <CardTitle className="text-2xl">{authInfo.practice.name}</CardTitle>
          </CardHeader>
          <CardContent className="text-center py-8">
            {decision === 'authorized' ? (
              <>
                <div
                  className="w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <Check className="w-10 h-10" style={{ color: primaryColor }} />
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  Authorization Confirmed
                </h2>
                <p className="text-gray-600 mb-6">
                  Thank you, {authInfo.patient.firstName}! Your authorization has been recorded.
                  {authInfo.practice.name} can now access your insurance information to better serve you.
                </p>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-left">
                  <h3 className="font-medium text-green-800 mb-2">What happens next?</h3>
                  <ul className="text-sm text-green-700 space-y-1">
                    <li>Your provider will verify your coverage</li>
                    <li>You'll receive accurate cost estimates</li>
                    <li>Claims will be processed efficiently</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full bg-gray-100 mx-auto mb-6 flex items-center justify-center">
                  <X className="w-10 h-10 text-gray-500" />
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  Decision Recorded
                </h2>
                <p className="text-gray-600 mb-6">
                  We've recorded your decision, {authInfo.patient.firstName}. Your insurance information
                  will not be accessed.
                </p>
                <p className="text-sm text-gray-500">
                  If you change your mind, please contact {authInfo.practice.name} to request a new
                  authorization link.
                </p>
              </>
            )}
          </CardContent>
          <CardFooter className="justify-center border-t pt-6">
            <p className="text-xs text-gray-500">
              {authInfo.practice.phone && (
                <span>Questions? Call {authInfo.practice.phone}</span>
              )}
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <Card className="mb-6">
          <div
            className="p-6 text-center text-white rounded-t-lg"
            style={{
              background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
            }}
          >
            {authInfo.practice.logoUrl && (
              <img
                src={authInfo.practice.logoUrl}
                alt={authInfo.practice.name}
                className="h-14 mx-auto mb-4 bg-white/10 rounded px-4 py-2"
              />
            )}
            <h1 className="text-2xl font-bold">{authInfo.practice.name}</h1>
            <p className="text-white/80 mt-1">Insurance Authorization Request</p>
          </div>

          <CardContent className="p-6">
            <p className="text-lg text-gray-700">
              Hello <strong>{authInfo.patient.firstName}</strong>,
            </p>
            <p className="text-gray-600 mt-2">
              {authInfo.practice.name} is requesting your permission to access your insurance
              information to provide you with better care and accurate cost estimates.
            </p>
          </CardContent>
        </Card>

        {/* Requested Access */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5" style={{ color: primaryColor }} />
              Information We're Requesting
            </CardTitle>
            <CardDescription>
              Your authorization will allow access to the following:
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {authInfo.scopes.map((scope) => {
                const scopeInfo = scopeLabels[scope];
                if (!scopeInfo) return null;
                const Icon = scopeInfo.icon;

                return (
                  <div
                    key={scope}
                    className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100"
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${primaryColor}15` }}
                    >
                      <Icon className="w-5 h-5" style={{ color: primaryColor }} />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">{scopeInfo.label}</h4>
                      <p className="text-sm text-gray-600">{scopeInfo.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Privacy & Security */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Lock className="w-5 h-5" style={{ color: primaryColor }} />
              Your Privacy is Protected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-gray-600">
              <li className="flex items-start gap-2">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <span>Your information is protected by HIPAA regulations</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <span>Data is encrypted and securely transmitted</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <span>Only used for healthcare purposes</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <span>You can revoke this authorization at any time</span>
              </li>
            </ul>

            {authInfo.practice.privacyPolicyUrl && (
              <a
                href={authInfo.practice.privacyPolicyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-4 text-sm hover:underline"
                style={{ color: primaryColor }}
              >
                View Privacy Policy
              </a>
            )}
          </CardContent>
        </Card>

        {/* Consent & Actions */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-3 mb-6">
              <Checkbox
                id="consent"
                checked={consentChecked}
                onCheckedChange={(checked) => setConsentChecked(checked === true)}
                className="mt-1"
              />
              <label htmlFor="consent" className="text-sm text-gray-700 cursor-pointer">
                I understand that by authorizing this request, {authInfo.practice.name} will be able
                to access my insurance information for healthcare purposes. I can revoke this
                authorization at any time by contacting the practice.
              </label>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                className="flex-1 h-12 text-white"
                style={{ backgroundColor: primaryColor }}
                disabled={!consentChecked || submitMutation.isPending}
                onClick={() => submitMutation.mutate('authorize')}
              >
                {submitMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                ) : (
                  <Check className="w-5 h-5 mr-2" />
                )}
                Authorize Access
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-12"
                disabled={submitMutation.isPending}
                onClick={() => submitMutation.mutate('deny')}
              >
                <X className="w-5 h-5 mr-2" />
                Decline
              </Button>
            </div>

            {submitMutation.error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {submitMutation.error instanceof Error
                  ? submitMutation.error.message
                  : 'An error occurred. Please try again.'}
              </div>
            )}
          </CardContent>

          <CardFooter className="border-t bg-gray-50 rounded-b-lg">
            <div className="w-full text-center text-xs text-gray-500 py-2">
              <p>
                {authInfo.practice.phone && (
                  <span>Need help? Call {authInfo.practice.phone}</span>
                )}
                {authInfo.practice.phone && authInfo.practice.email && <span> | </span>}
                {authInfo.practice.email && (
                  <a href={`mailto:${authInfo.practice.email}`} className="hover:underline">
                    {authInfo.practice.email}
                  </a>
                )}
              </p>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

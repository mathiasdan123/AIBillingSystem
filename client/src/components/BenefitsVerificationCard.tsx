import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Shield, DollarSign, Calendar, AlertTriangle,
  CheckCircle, XCircle, Clock, RefreshCw, Loader2,
  Activity, Brain, MessageCircle, Heart, FileCheck
} from "lucide-react";

interface TherapyVisitInfo {
  allowed?: number;
  used?: number;
  remaining?: number;
}

interface DetailedBenefits {
  planStatus: 'active' | 'inactive' | 'unknown';
  planName?: string;
  planNumber?: string;
  groupNumber?: string;
  planType?: string;
  effectiveDate?: string;
  terminationDate?: string;
  therapyVisits?: {
    ot?: TherapyVisitInfo;
    pt?: TherapyVisitInfo;
    st?: TherapyVisitInfo;
    mentalHealth?: TherapyVisitInfo;
    combined?: TherapyVisitInfo;
  };
  authRequired: boolean;
  authNotes?: string;
  copay?: number;
  specialistCopay?: number;
  coinsurance?: number;
  deductible?: {
    individual?: number;
    individualMet?: number;
    family?: number;
    familyMet?: number;
  };
  outOfPocketMax?: {
    individual?: number;
    individualMet?: number;
    family?: number;
    familyMet?: number;
  };
  checkedAt: string;
  source: string;
  errors?: string[];
}

interface BenefitsVerificationCardProps {
  patientId: number;
  patientName: string;
  insuranceProvider?: string | null;
}

function VisitLimitBar({
  label,
  icon: Icon,
  visits,
}: {
  label: string;
  icon: React.ElementType;
  visits: TherapyVisitInfo;
}) {
  const allowed = visits.allowed || 0;
  const used = visits.used || 0;
  const remaining = visits.remaining ?? (allowed - used);
  const progress = allowed > 0 ? (used / allowed) * 100 : 0;
  const isLow = remaining <= 5 && remaining > 0;
  const isExhausted = remaining <= 0 && allowed > 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">{label}</span>
        </div>
        <span className="text-sm text-slate-600">
          {used} / {allowed} used
        </span>
      </div>
      <Progress
        value={progress}
        className={`h-2 ${isExhausted ? '[&>div]:bg-red-500' : isLow ? '[&>div]:bg-amber-500' : ''}`}
      />
      <div className="flex justify-between">
        <span className={`text-xs ${isExhausted ? 'text-red-600 font-medium' : isLow ? 'text-amber-600' : 'text-slate-500'}`}>
          {isExhausted
            ? 'Visit limit reached'
            : isLow
            ? `Only ${remaining} visits remaining`
            : `${remaining} visits remaining`}
        </span>
      </div>
    </div>
  );
}

function FinancialProgressBar({
  label,
  current,
  max,
  showRemaining = true,
}: {
  label: string;
  current: number;
  max: number;
  showRemaining?: boolean;
}) {
  const progress = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const remaining = max - current;
  const isMet = progress >= 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-sm text-slate-600">
          ${current.toLocaleString()} / ${max.toLocaleString()}
        </span>
      </div>
      <Progress value={progress} className="h-2" />
      {showRemaining && (
        <span className={`text-xs ${isMet ? 'text-green-600' : 'text-slate-500'}`}>
          {isMet ? 'Met' : `$${remaining.toLocaleString()} remaining`}
        </span>
      )}
    </div>
  );
}

export default function BenefitsVerificationCard({
  patientId,
  patientName,
  insuranceProvider,
}: BenefitsVerificationCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch stored eligibility data
  const { data: storedEligibility } = useQuery({
    queryKey: [`/api/patients/${patientId}/eligibility`],
    enabled: !!patientId,
  }) as any;

  // State for the detailed benefits data
  const [detailedBenefits, setDetailedBenefits] = useState<DetailedBenefits | null>(null);

  // Mutation for running the detailed benefits check
  const verifyMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/insurance/detailed-benefits", {
        patientId,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.benefits) {
        setDetailedBenefits(data.benefits);
      }
      // Refresh stored eligibility
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/eligibility`] });

      const status = data.benefits?.planStatus;
      toast({
        title: status === 'active' ? "Benefits Verified" : status === 'inactive' ? "Coverage Inactive" : "Verification Complete",
        description: status === 'active'
          ? `${data.benefits?.planName || insuranceProvider || 'Plan'} - Coverage is active`
          : status === 'inactive'
          ? "Patient coverage is not active"
          : "Unable to fully verify coverage",
        variant: status === 'active' ? "default" : "destructive",
      });
    },
    onError: () => {
      toast({
        title: "Verification Failed",
        description: "Unable to check benefits. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Use detailed benefits if available, otherwise fall back to stored eligibility
  const benefits = detailedBenefits;
  const hasStoredData = storedEligibility && storedEligibility.status;
  const hasData = benefits || hasStoredData;

  // Derive display values from benefits or stored eligibility
  const isActive = benefits
    ? benefits.planStatus === 'active'
    : storedEligibility?.status === 'active';
  const planName = benefits?.planName || storedEligibility?.planName;
  const planType = benefits?.planType || storedEligibility?.coverageType;
  const authRequired = benefits?.authRequired ?? storedEligibility?.authRequired;
  const copay = benefits?.copay ?? (storedEligibility?.copay != null ? parseFloat(storedEligibility.copay) : undefined);
  const coinsurance = benefits?.coinsurance ?? storedEligibility?.coinsurance;
  const lastChecked = benefits?.checkedAt || storedEligibility?.checkDate || storedEligibility?.createdAt;

  // Financial details
  const deductibleIndividual = benefits?.deductible?.individual ?? (storedEligibility?.deductible != null ? parseFloat(storedEligibility.deductible) : 0);
  const deductibleIndividualMet = benefits?.deductible?.individualMet ?? (storedEligibility?.deductibleMet != null ? parseFloat(storedEligibility.deductibleMet) : 0);
  const deductibleFamily = benefits?.deductible?.family ?? 0;
  const deductibleFamilyMet = benefits?.deductible?.familyMet ?? 0;
  const oopIndividual = benefits?.outOfPocketMax?.individual ?? (storedEligibility?.outOfPocketMax != null ? parseFloat(storedEligibility.outOfPocketMax) : 0);
  const oopIndividualMet = benefits?.outOfPocketMax?.individualMet ?? (storedEligibility?.outOfPocketMet != null ? parseFloat(storedEligibility.outOfPocketMet) : 0);
  const oopFamily = benefits?.outOfPocketMax?.family ?? 0;
  const oopFamilyMet = benefits?.outOfPocketMax?.familyMet ?? 0;

  // Effective dates
  const effectiveDate = benefits?.effectiveDate || storedEligibility?.effectiveDate;
  const terminationDate = benefits?.terminationDate || storedEligibility?.terminationDate;

  if (!insuranceProvider) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center">
          <Shield className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No insurance information on file</p>
          <p className="text-xs text-slate-400 mt-1">Add insurance details to verify benefits</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Benefits Verification
          </CardTitle>
          <div className="flex items-center gap-2">
            {hasData && (
              <Badge className={
                isActive
                  ? "bg-green-100 text-green-700"
                  : isActive === false
                  ? "bg-red-100 text-red-700"
                  : "bg-slate-100 text-slate-700"
              }>
                {isActive ? (
                  <><CheckCircle className="w-3 h-3 mr-1" /> Active</>
                ) : isActive === false ? (
                  <><XCircle className="w-3 h-3 mr-1" /> Inactive</>
                ) : (
                  <><AlertTriangle className="w-3 h-3 mr-1" /> Unknown</>
                )}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => verifyMutation.mutate()}
              disabled={verifyMutation.isPending}
            >
              {verifyMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 mr-1" />
                  {hasData ? 'Re-verify' : 'Verify Benefits'}
                </>
              )}
            </Button>
          </div>
        </div>
        {(planName || planType) && (
          <div className="flex items-center gap-2 mt-1">
            {planName && <p className="text-sm text-slate-600">{planName}</p>}
            {planType && (
              <Badge variant="outline" className="text-xs">
                {planType}
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {!hasData ? (
          <div className="p-6 text-center">
            <FileCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No eligibility data available</p>
            <p className="text-xs text-slate-400 mt-1">
              Click "Verify Benefits" to check coverage in real-time
            </p>
          </div>
        ) : !isActive && isActive !== undefined ? (
          <div className="p-4 bg-red-50 rounded-lg border border-red-100">
            <p className="text-sm text-red-700 font-medium">Coverage is not active</p>
            <p className="text-xs text-red-600 mt-1">
              Please verify insurance information or contact the patient
            </p>
          </div>
        ) : (
          <>
            {/* Authorization Required Banner */}
            {authRequired && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-100 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800">Prior Authorization Required</p>
                  <p className="text-xs text-amber-700">
                    {benefits?.authNotes || 'Contact insurance before scheduling sessions'}
                  </p>
                </div>
              </div>
            )}

            {/* Financial Summary Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 font-medium">Copay</p>
                <p className="text-lg font-bold text-slate-900">
                  {copay != null && copay > 0 ? `$${copay}` : 'N/A'}
                </p>
                {benefits?.specialistCopay != null && benefits.specialistCopay !== copay && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Specialist: ${benefits.specialistCopay}
                  </p>
                )}
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 font-medium">Coinsurance</p>
                <p className="text-lg font-bold text-slate-900">
                  {coinsurance != null && coinsurance > 0 ? `${coinsurance}%` : 'N/A'}
                </p>
              </div>
            </div>

            {/* Therapy Visit Limits */}
            {benefits?.therapyVisits && Object.keys(benefits.therapyVisits).length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-blue-600" />
                  Therapy Visit Limits
                </h4>
                {benefits.therapyVisits.ot && (
                  <VisitLimitBar
                    label="Occupational Therapy (OT)"
                    icon={Activity}
                    visits={benefits.therapyVisits.ot}
                  />
                )}
                {benefits.therapyVisits.pt && (
                  <VisitLimitBar
                    label="Physical Therapy (PT)"
                    icon={Heart}
                    visits={benefits.therapyVisits.pt}
                  />
                )}
                {benefits.therapyVisits.st && (
                  <VisitLimitBar
                    label="Speech Therapy (ST)"
                    icon={MessageCircle}
                    visits={benefits.therapyVisits.st}
                  />
                )}
                {benefits.therapyVisits.mentalHealth && (
                  <VisitLimitBar
                    label="Mental Health"
                    icon={Brain}
                    visits={benefits.therapyVisits.mentalHealth}
                  />
                )}
                {benefits.therapyVisits.combined && (
                  <VisitLimitBar
                    label="All Therapy (Combined)"
                    icon={Activity}
                    visits={benefits.therapyVisits.combined}
                  />
                )}
              </div>
            )}

            {/* Generic visit limit from stored eligibility */}
            {!benefits?.therapyVisits && storedEligibility?.visitsAllowed > 0 && (
              <VisitLimitBar
                label="Therapy Visits"
                icon={Activity}
                visits={{
                  allowed: storedEligibility.visitsAllowed,
                  used: storedEligibility.visitsUsed || 0,
                  remaining: storedEligibility.visitsAllowed - (storedEligibility.visitsUsed || 0),
                }}
              />
            )}

            {/* Deductible Progress */}
            {(deductibleIndividual > 0 || deductibleFamily > 0) && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4 text-blue-600" />
                  Deductible
                </h4>
                {deductibleIndividual > 0 && (
                  <FinancialProgressBar
                    label="Individual"
                    current={deductibleIndividualMet}
                    max={deductibleIndividual}
                  />
                )}
                {deductibleFamily > 0 && (
                  <FinancialProgressBar
                    label="Family"
                    current={deductibleFamilyMet}
                    max={deductibleFamily}
                  />
                )}
              </div>
            )}

            {/* Out-of-Pocket Maximum Progress */}
            {(oopIndividual > 0 || oopFamily > 0) && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  Out-of-Pocket Maximum
                </h4>
                {oopIndividual > 0 && (
                  <FinancialProgressBar
                    label="Individual"
                    current={oopIndividualMet}
                    max={oopIndividual}
                  />
                )}
                {oopFamily > 0 && (
                  <FinancialProgressBar
                    label="Family"
                    current={oopFamilyMet}
                    max={oopFamily}
                  />
                )}
              </div>
            )}

            {/* Effective Dates */}
            <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t">
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span>
                  Effective: {effectiveDate
                    ? new Date(effectiveDate).toLocaleDateString()
                    : 'N/A'}
                </span>
              </div>
              {terminationDate && (
                <span>
                  Ends: {new Date(terminationDate).toLocaleDateString()}
                </span>
              )}
            </div>
          </>
        )}

        {/* Last Verified */}
        {lastChecked && (
          <div className="flex items-center justify-between text-xs text-slate-400 pt-2">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Last verified: {new Date(lastChecked).toLocaleString()}
            </span>
            {(benefits?.source || storedEligibility?.source) && (
              <Badge variant="outline" className="text-xs">
                {(benefits?.source || storedEligibility?.source) === 'stedi' ? 'Live Data' : 'Cached'}
              </Badge>
            )}
          </div>
        )}

        {/* Errors */}
        {benefits?.errors && benefits.errors.length > 0 && (
          <div className="p-3 bg-red-50 rounded-lg border border-red-100">
            <p className="text-xs text-red-600 font-medium mb-1">Verification Issues:</p>
            {benefits.errors.map((err, i) => (
              <p key={i} className="text-xs text-red-600">{err}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

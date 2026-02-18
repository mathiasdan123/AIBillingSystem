import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Shield, DollarSign, Calendar, AlertTriangle,
  CheckCircle, XCircle, Clock, CreditCard
} from "lucide-react";

interface BenefitsSummaryProps {
  eligibility: {
    status: string;
    coverageType?: string | null;
    effectiveDate?: string | null;
    terminationDate?: string | null;
    copay?: string | number | null;
    deductible?: string | number | null;
    deductibleMet?: string | number | null;
    outOfPocketMax?: string | number | null;
    outOfPocketMet?: string | number | null;
    coinsurance?: number | null;
    visitsAllowed?: number | null;
    visitsUsed?: number | null;
    authRequired?: boolean | null;
    planName?: string | null;
    groupNumber?: string | null;
    checkDate?: string;
    source?: string;
  } | null;
  showLastChecked?: boolean;
  compact?: boolean;
}

export default function BenefitsSummary({ eligibility, showLastChecked = true, compact = false }: BenefitsSummaryProps) {
  if (!eligibility) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center">
          <Shield className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No eligibility data available</p>
          <p className="text-xs text-slate-400 mt-1">Click "Check Eligibility" to verify coverage</p>
        </CardContent>
      </Card>
    );
  }

  const isActive = eligibility.status === 'active';
  const copay = parseFloat(String(eligibility.copay || 0));
  const deductible = parseFloat(String(eligibility.deductible || 0));
  const deductibleMet = parseFloat(String(eligibility.deductibleMet || 0));
  const outOfPocketMax = parseFloat(String(eligibility.outOfPocketMax || 0));
  const outOfPocketMet = parseFloat(String(eligibility.outOfPocketMet || 0));
  const coinsurance = eligibility.coinsurance || 0;
  const visitsAllowed = eligibility.visitsAllowed || 0;
  const visitsUsed = eligibility.visitsUsed || 0;

  const deductibleProgress = deductible > 0 ? (deductibleMet / deductible) * 100 : 0;
  const oopProgress = outOfPocketMax > 0 ? (outOfPocketMet / outOfPocketMax) * 100 : 0;
  const visitsProgress = visitsAllowed > 0 ? (visitsUsed / visitsAllowed) * 100 : 0;
  const visitsRemaining = visitsAllowed - visitsUsed;

  // Calculate estimated patient cost for next session
  const estimatedCost = () => {
    if (!isActive) return null;

    // If deductible not met, patient pays full rate (up to deductible remaining)
    const deductibleRemaining = deductible - deductibleMet;
    if (deductibleRemaining > 0) {
      return { amount: "Full Rate", note: `$${deductibleRemaining.toFixed(0)} deductible remaining` };
    }

    // If deductible met, patient pays copay or coinsurance
    if (copay > 0) {
      return { amount: `$${copay.toFixed(0)}`, note: "Copay" };
    }

    if (coinsurance > 0) {
      return { amount: `${coinsurance}%`, note: "of allowed amount" };
    }

    return { amount: "$0", note: "Fully covered" };
  };

  const cost = estimatedCost();

  if (compact) {
    return (
      <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg">
        <div className="flex items-center gap-2">
          {isActive ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : (
            <XCircle className="w-5 h-5 text-red-500" />
          )}
          <span className={`font-medium ${isActive ? 'text-green-700' : 'text-red-700'}`}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        {isActive && cost && (
          <>
            <div className="h-4 w-px bg-slate-300" />
            <div className="flex items-center gap-1">
              <CreditCard className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium">{cost.amount}</span>
              <span className="text-xs text-slate-500">{cost.note}</span>
            </div>
          </>
        )}
        {isActive && visitsAllowed > 0 && (
          <>
            <div className="h-4 w-px bg-slate-300" />
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span className="text-sm">
                <span className="font-medium">{visitsRemaining}</span>
                <span className="text-slate-500"> visits left</span>
              </span>
            </div>
          </>
        )}
        {eligibility.authRequired && (
          <>
            <div className="h-4 w-px bg-slate-300" />
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Auth Required
            </Badge>
          </>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Benefits Summary
          </CardTitle>
          <Badge className={isActive
            ? "bg-green-100 text-green-700"
            : "bg-red-100 text-red-700"
          }>
            {isActive ? (
              <><CheckCircle className="w-3 h-3 mr-1" /> Active</>
            ) : (
              <><XCircle className="w-3 h-3 mr-1" /> Inactive</>
            )}
          </Badge>
        </div>
        {eligibility.planName && (
          <p className="text-sm text-slate-600">{eligibility.planName}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!isActive ? (
          <div className="p-4 bg-red-50 rounded-lg border border-red-100">
            <p className="text-sm text-red-700 font-medium">Coverage is not active</p>
            <p className="text-xs text-red-600 mt-1">
              Please verify insurance information or contact the patient
            </p>
          </div>
        ) : (
          <>
            {/* Estimated Cost Card */}
            {cost && (
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Estimated Patient Cost</p>
                    <p className="text-2xl font-bold text-blue-700">{cost.amount}</p>
                    <p className="text-xs text-blue-600">{cost.note}</p>
                  </div>
                  <DollarSign className="w-10 h-10 text-blue-200" />
                </div>
              </div>
            )}

            {/* Key Benefits Grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Copay */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 font-medium">Copay</p>
                <p className="text-lg font-bold text-slate-900">
                  {copay > 0 ? `$${copay.toFixed(0)}` : 'N/A'}
                </p>
              </div>

              {/* Coinsurance */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 font-medium">Coinsurance</p>
                <p className="text-lg font-bold text-slate-900">
                  {coinsurance > 0 ? `${coinsurance}%` : 'N/A'}
                </p>
              </div>
            </div>

            {/* Deductible Progress */}
            {deductible > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">Deductible</p>
                  <p className="text-sm text-slate-600">
                    ${deductibleMet.toFixed(0)} / ${deductible.toFixed(0)}
                  </p>
                </div>
                <Progress value={deductibleProgress} className="h-2" />
                {deductibleProgress < 100 && (
                  <p className="text-xs text-amber-600">
                    ${(deductible - deductibleMet).toFixed(0)} remaining before insurance pays
                  </p>
                )}
                {deductibleProgress >= 100 && (
                  <p className="text-xs text-green-600">Deductible met</p>
                )}
              </div>
            )}

            {/* Out of Pocket Max Progress */}
            {outOfPocketMax > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">Out-of-Pocket Max</p>
                  <p className="text-sm text-slate-600">
                    ${outOfPocketMet.toFixed(0)} / ${outOfPocketMax.toFixed(0)}
                  </p>
                </div>
                <Progress value={oopProgress} className="h-2" />
              </div>
            )}

            {/* Visits Progress */}
            {visitsAllowed > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">Therapy Visits</p>
                  <p className="text-sm text-slate-600">
                    {visitsUsed} used / {visitsAllowed} allowed
                  </p>
                </div>
                <Progress
                  value={visitsProgress}
                  className={`h-2 ${visitsProgress > 80 ? '[&>div]:bg-amber-500' : ''}`}
                />
                {visitsRemaining <= 5 && visitsRemaining > 0 && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Only {visitsRemaining} visits remaining
                  </p>
                )}
                {visitsRemaining <= 0 && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Visit limit reached - authorization may be needed
                  </p>
                )}
              </div>
            )}

            {/* Authorization Required Warning */}
            {eligibility.authRequired && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-100 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">Prior Authorization Required</p>
                  <p className="text-xs text-amber-700">Contact insurance before scheduling sessions</p>
                </div>
              </div>
            )}

            {/* Coverage Dates */}
            <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t">
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span>
                  Effective: {eligibility.effectiveDate
                    ? new Date(eligibility.effectiveDate).toLocaleDateString()
                    : 'N/A'}
                </span>
              </div>
              {eligibility.terminationDate && (
                <span>
                  Ends: {new Date(eligibility.terminationDate).toLocaleDateString()}
                </span>
              )}
            </div>
          </>
        )}

        {/* Last Checked */}
        {showLastChecked && eligibility.checkDate && (
          <div className="flex items-center justify-between text-xs text-slate-400 pt-2">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Last verified: {new Date(eligibility.checkDate).toLocaleString()}
            </span>
            {eligibility.source && (
              <Badge variant="outline" className="text-xs">
                {eligibility.source === 'stedi' ? 'Live Data' : 'Cached'}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

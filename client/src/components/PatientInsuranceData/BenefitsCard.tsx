import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { DollarSign, AlertCircle, CheckCircle, XCircle } from 'lucide-react';

interface NormalizedBenefits {
  deductible: {
    individual: number;
    family: number;
    individualMet: number;
    familyMet: number;
  };
  outOfPocketMax: {
    individual: number;
    family: number;
    individualMet: number;
    familyMet: number;
  };
  copay: number;
  coinsurance: number;
  visitsAllowed?: number;
  visitsUsed?: number;
  priorAuthRequired: boolean;
  referralRequired: boolean;
  serviceLimitations?: string[];
}

interface BenefitsCardProps {
  benefits: NormalizedBenefits;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function ProgressBar({
  label,
  current,
  max,
  color = 'blue',
}: {
  label: string;
  current: number;
  max: number;
  color?: 'blue' | 'green' | 'amber';
}) {
  const percentage = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    amber: 'bg-amber-500',
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium">
          {formatCurrency(current)} / {formatCurrency(max)}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClasses[color]} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="text-xs text-gray-500 text-right">
        {formatCurrency(max - current)} remaining
      </div>
    </div>
  );
}

export default function BenefitsCard({ benefits }: BenefitsCardProps) {
  const {
    deductible,
    outOfPocketMax,
    copay,
    coinsurance,
    visitsAllowed,
    visitsUsed,
    priorAuthRequired,
    referralRequired,
    serviceLimitations,
  } = benefits;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-blue-600" />
          Benefits Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Deductibles */}
        <div>
          <h4 className="font-medium text-gray-900 mb-3">Deductible</h4>
          <div className="grid grid-cols-2 gap-6">
            <ProgressBar
              label="Individual"
              current={deductible.individualMet}
              max={deductible.individual}
              color={deductible.individualMet >= deductible.individual ? 'green' : 'blue'}
            />
            <ProgressBar
              label="Family"
              current={deductible.familyMet}
              max={deductible.family}
              color={deductible.familyMet >= deductible.family ? 'green' : 'blue'}
            />
          </div>
        </div>

        {/* Out of Pocket Max */}
        <div className="pt-4 border-t">
          <h4 className="font-medium text-gray-900 mb-3">Out-of-Pocket Maximum</h4>
          <div className="grid grid-cols-2 gap-6">
            <ProgressBar
              label="Individual"
              current={outOfPocketMax.individualMet}
              max={outOfPocketMax.individual}
              color={
                outOfPocketMax.individualMet >= outOfPocketMax.individual ? 'green' : 'amber'
              }
            />
            <ProgressBar
              label="Family"
              current={outOfPocketMax.familyMet}
              max={outOfPocketMax.family}
              color={outOfPocketMax.familyMet >= outOfPocketMax.family ? 'green' : 'amber'}
            />
          </div>
        </div>

        {/* Cost Sharing */}
        <div className="pt-4 border-t">
          <h4 className="font-medium text-gray-900 mb-3">Cost Sharing</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="text-sm text-blue-700">Copay</div>
              <div className="text-2xl font-bold text-blue-900 mt-1">
                {copay > 0 ? formatCurrency(copay) : 'N/A'}
              </div>
              <div className="text-xs text-blue-600 mt-1">Per visit</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-4">
              <div className="text-sm text-purple-700">Coinsurance</div>
              <div className="text-2xl font-bold text-purple-900 mt-1">{coinsurance}%</div>
              <div className="text-xs text-purple-600 mt-1">Patient responsibility</div>
            </div>
          </div>
        </div>

        {/* Visits */}
        {visitsAllowed !== undefined && (
          <div className="pt-4 border-t">
            <h4 className="font-medium text-gray-900 mb-3">Visit Allowance</h4>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm text-gray-600">Visits Used</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {visitsUsed || 0} / {visitsAllowed}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-600">Remaining</div>
                  <div className="text-2xl font-bold text-green-600">
                    {visitsAllowed - (visitsUsed || 0)}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all"
                    style={{
                      width: `${((visitsUsed || 0) / visitsAllowed) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Requirements */}
        <div className="pt-4 border-t">
          <h4 className="font-medium text-gray-900 mb-3">Requirements</h4>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className={
                priorAuthRequired
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-green-300 bg-green-50 text-green-800'
              }
            >
              {priorAuthRequired ? (
                <>
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Prior Auth Required
                </>
              ) : (
                <>
                  <CheckCircle className="w-3 h-3 mr-1" />
                  No Prior Auth
                </>
              )}
            </Badge>
            <Badge
              variant="outline"
              className={
                referralRequired
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-green-300 bg-green-50 text-green-800'
              }
            >
              {referralRequired ? (
                <>
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Referral Required
                </>
              ) : (
                <>
                  <CheckCircle className="w-3 h-3 mr-1" />
                  No Referral Needed
                </>
              )}
            </Badge>
          </div>
        </div>

        {/* Service Limitations */}
        {serviceLimitations && serviceLimitations.length > 0 && (
          <div className="pt-4 border-t">
            <h4 className="font-medium text-gray-900 mb-3">Service Limitations</h4>
            <ul className="space-y-1">
              {serviceLimitations.map((limitation, index) => (
                <li
                  key={index}
                  className="text-sm text-gray-600 flex items-start gap-2"
                >
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  {limitation}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

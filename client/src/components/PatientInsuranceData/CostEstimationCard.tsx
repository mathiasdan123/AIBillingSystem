import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface CostEstimationProps {
  benefits: {
    copay: number | null;
    coinsurance: number | null;
    deductible: number | null;
    deductibleMet: number | null;
    outOfPocketMax: number | null;
    outOfPocketMet: number | null;
    visitsAllowed: number | null;
    visitsUsed: number | null;
    authRequired: boolean;
    priorAuthStatus: string | null;
  } | null;
  sessionRate?: number;
}

export default function CostEstimationCard({ benefits, sessionRate = 150 }: CostEstimationProps) {
  if (!benefits) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Cost Estimation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No benefits data available. Verify insurance to see estimates.</p>
        </CardContent>
      </Card>
    );
  }

  const remainingDeductible = benefits.deductible && benefits.deductibleMet
    ? Math.max(0, benefits.deductible - benefits.deductibleMet)
    : null;
  const deductibleFullyMet = remainingDeductible !== null && remainingDeductible === 0;

  // Estimate per-session cost
  let patientCopay = 0;
  let insurancePayment = 0;
  let deductibleImpact = 0;

  if (benefits.copay && deductibleFullyMet) {
    patientCopay = benefits.copay;
    insurancePayment = sessionRate - patientCopay;
  } else if (benefits.coinsurance && deductibleFullyMet) {
    patientCopay = sessionRate * (benefits.coinsurance / 100);
    insurancePayment = sessionRate - patientCopay;
  } else if (remainingDeductible && remainingDeductible > 0) {
    deductibleImpact = Math.min(remainingDeductible, sessionRate);
    const afterDeductible = sessionRate - deductibleImpact;
    if (benefits.coinsurance) {
      patientCopay = deductibleImpact + afterDeductible * (benefits.coinsurance / 100);
    } else {
      patientCopay = deductibleImpact;
    }
    insurancePayment = sessionRate - patientCopay;
  } else {
    patientCopay = benefits.copay || 0;
    insurancePayment = sessionRate - patientCopay;
  }

  const sessionsRemaining = benefits.visitsAllowed && benefits.visitsUsed
    ? benefits.visitsAllowed - benefits.visitsUsed
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Per-Session Cost Estimate</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Patient Responsibility</p>
            <p className="text-lg font-semibold text-red-600">${patientCopay.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Insurance Expected</p>
            <p className="text-lg font-semibold text-green-600">${Math.max(0, insurancePayment).toFixed(2)}</p>
          </div>
        </div>

        {remainingDeductible !== null && (
          <div>
            <p className="text-xs text-muted-foreground">Remaining Deductible</p>
            <p className="text-sm font-medium">
              ${remainingDeductible.toFixed(2)}
              {deductibleFullyMet && <Badge variant="outline" className="ml-2 text-green-600">Met</Badge>}
            </p>
          </div>
        )}

        {deductibleImpact > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Deductible Impact This Session</p>
            <p className="text-sm font-medium text-orange-600">${deductibleImpact.toFixed(2)}</p>
          </div>
        )}

        {sessionsRemaining !== null && (
          <div>
            <p className="text-xs text-muted-foreground">Sessions Remaining</p>
            <p className="text-sm font-medium">
              {sessionsRemaining} of {benefits.visitsAllowed}
              {sessionsRemaining <= 5 && sessionsRemaining > 0 && (
                <Badge variant="destructive" className="ml-2">Low</Badge>
              )}
              {sessionsRemaining === 0 && (
                <Badge variant="destructive" className="ml-2">Exhausted</Badge>
              )}
            </p>
          </div>
        )}

        {benefits.authRequired && (
          <div className="border-t pt-2">
            <div className="flex items-center gap-2">
              <Badge variant={benefits.priorAuthStatus === 'approved' ? 'default' : 'destructive'}>
                Prior Auth {benefits.priorAuthStatus || 'Required'}
              </Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

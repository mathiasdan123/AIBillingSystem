import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getAuthHeaders } from '@/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';

interface BenefitsCardProps {
  patientId: number;
  eligibility: {
    status: string;
    subscriberName?: string;
    memberId?: string;
    planName?: string;
    coverageType?: string;
    effectiveDate?: string;
    terminationDate?: string | null;
  } | null;
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
  } | null;
  verifiedAt: string | null;
}

export default function BenefitsCard({ patientId, eligibility, benefits, verifiedAt }: BenefitsCardProps) {
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/patients/${patientId}/insurance-data/refresh`, {
        method: 'POST',
        headers: { ...headers },
      });
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/insurance-data`] });
    } catch (err) {
      console.error('Failed to refresh:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const statusColor = eligibility?.status === 'active' ? 'bg-green-100 text-green-800'
    : eligibility?.status === 'inactive' ? 'bg-red-100 text-red-800'
    : 'bg-yellow-100 text-yellow-800';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Insurance Benefits</CardTitle>
        <div className="flex items-center gap-2">
          {verifiedAt && (
            <span className="text-xs text-muted-foreground">
              Verified {new Date(verifiedAt).toLocaleDateString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!eligibility ? (
          <p className="text-sm text-muted-foreground">No insurance data on file.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge className={statusColor}>
                {eligibility.status?.toUpperCase()}
              </Badge>
              {eligibility.coverageType && (
                <Badge variant="outline">{eligibility.coverageType}</Badge>
              )}
            </div>

            {eligibility.planName && (
              <p className="text-sm">{eligibility.planName}</p>
            )}

            {benefits && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {benefits.copay !== null && (
                  <div>
                    <span className="text-muted-foreground">Copay:</span>{' '}
                    <span className="font-medium">${benefits.copay}</span>
                  </div>
                )}
                {benefits.coinsurance !== null && (
                  <div>
                    <span className="text-muted-foreground">Coinsurance:</span>{' '}
                    <span className="font-medium">{benefits.coinsurance}%</span>
                  </div>
                )}
                {benefits.deductible !== null && (
                  <div>
                    <span className="text-muted-foreground">Deductible:</span>{' '}
                    <span className="font-medium">
                      ${benefits.deductibleMet ?? 0} / ${benefits.deductible}
                    </span>
                  </div>
                )}
                {benefits.outOfPocketMax !== null && (
                  <div>
                    <span className="text-muted-foreground">OOP Max:</span>{' '}
                    <span className="font-medium">
                      ${benefits.outOfPocketMet ?? 0} / ${benefits.outOfPocketMax}
                    </span>
                  </div>
                )}
                {benefits.visitsAllowed !== null && (
                  <div>
                    <span className="text-muted-foreground">Visits:</span>{' '}
                    <span className="font-medium">
                      {benefits.visitsUsed ?? 0} / {benefits.visitsAllowed}
                    </span>
                  </div>
                )}
                {benefits.authRequired && (
                  <div className="col-span-2">
                    <Badge variant="destructive">Prior Auth Required</Badge>
                  </div>
                )}
              </div>
            )}

            {eligibility.effectiveDate && (
              <p className="text-xs text-muted-foreground">
                Effective: {eligibility.effectiveDate}
                {eligibility.terminationDate && ` - ${eligibility.terminationDate}`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

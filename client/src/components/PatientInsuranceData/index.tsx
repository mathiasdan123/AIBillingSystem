import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import {
  Shield,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
  FileText,
  DollarSign,
  History,
  ClipboardCheck,
} from 'lucide-react';
import EligibilityCard from './EligibilityCard';
import BenefitsCard from './BenefitsCard';
import ClaimsHistoryTable from './ClaimsHistoryTable';

interface PatientInsuranceDataProps {
  patientId: number;
}

interface InsuranceDataResponse {
  patientId: number;
  authorization: {
    id: number;
    status: string;
    scopes: string[];
    expiresAt: string;
    authorizedAt: string;
  };
  data: {
    eligibility?: any;
    benefits?: any;
    claims_history?: any;
    prior_auth?: any;
  };
}

export default function PatientInsuranceData({ patientId }: PatientInsuranceDataProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('eligibility');

  // Fetch insurance data
  const {
    data: insuranceData,
    isLoading,
    error,
    refetch,
  } = useQuery<InsuranceDataResponse>({
    queryKey: [`/api/patients/${patientId}/insurance-data`],
    enabled: !!patientId,
    retry: false,
  });

  // Refresh data mutation
  const refreshMutation = useMutation({
    mutationFn: async (types?: string[]) => {
      const response = await apiRequest('POST', `/api/patients/${patientId}/insurance-data/refresh`, {
        types,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to refresh data');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Data Refreshed', description: 'Insurance data has been updated' });
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/insurance-data`] });
    },
    onError: (error) => {
      toast({
        title: 'Refresh Failed',
        description: error instanceof Error ? error.message : 'Failed to refresh data',
        variant: 'destructive',
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-3" />
          <p className="text-gray-600">Loading insurance data...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to load insurance data';
    const requiresAuth = (error as any)?.requiresAuthorization;

    return (
      <Card>
        <CardContent className="p-8 text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {requiresAuth ? 'Authorization Required' : 'Unable to Load Data'}
          </h3>
          <p className="text-gray-600 mb-4">{errorMessage}</p>
          {requiresAuth && (
            <p className="text-sm text-gray-500">
              Request authorization from the patient to access their insurance information.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!insuranceData) {
    return null;
  }

  const { authorization, data } = insuranceData;
  const hasEligibility = !!data.eligibility;
  const hasBenefits = !!data.benefits;
  const hasClaimsHistory = !!data.claims_history;
  const hasPriorAuth = !!data.prior_auth;

  return (
    <div className="space-y-4">
      {/* Authorization Status Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              <CardTitle className="text-lg">Insurance Data Access</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={authorization.status === 'authorized' ? 'default' : 'secondary'}
                className={
                  authorization.status === 'authorized'
                    ? 'bg-green-100 text-green-800'
                    : ''
                }
              >
                {authorization.status === 'authorized' ? (
                  <CheckCircle className="w-3 h-3 mr-1" />
                ) : (
                  <Clock className="w-3 h-3 mr-1" />
                )}
                {authorization.status.charAt(0).toUpperCase() + authorization.status.slice(1)}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshMutation.mutate(undefined)}
                disabled={refreshMutation.isPending}
              >
                {refreshMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
          <CardDescription>
            Authorized on{' '}
            {new Date(authorization.authorizedAt).toLocaleDateString()} | Expires{' '}
            {new Date(authorization.expiresAt).toLocaleDateString()}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Data Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 mb-4">
          <TabsTrigger value="eligibility" disabled={!authorization.scopes.includes('eligibility')}>
            <Shield className="w-4 h-4 mr-1.5" />
            Eligibility
          </TabsTrigger>
          <TabsTrigger value="benefits" disabled={!authorization.scopes.includes('benefits')}>
            <DollarSign className="w-4 h-4 mr-1.5" />
            Benefits
          </TabsTrigger>
          <TabsTrigger
            value="claims_history"
            disabled={!authorization.scopes.includes('claims_history')}
          >
            <History className="w-4 h-4 mr-1.5" />
            Claims
          </TabsTrigger>
          <TabsTrigger value="prior_auth" disabled={!authorization.scopes.includes('prior_auth')}>
            <ClipboardCheck className="w-4 h-4 mr-1.5" />
            Prior Auth
          </TabsTrigger>
        </TabsList>

        <TabsContent value="eligibility">
          {hasEligibility ? (
            <EligibilityCard eligibility={data.eligibility} />
          ) : (
            <NoDataCard
              type="eligibility"
              onRefresh={() => refreshMutation.mutate(['eligibility'])}
              isRefreshing={refreshMutation.isPending}
            />
          )}
        </TabsContent>

        <TabsContent value="benefits">
          {hasBenefits ? (
            <BenefitsCard benefits={data.benefits} />
          ) : (
            <NoDataCard
              type="benefits"
              onRefresh={() => refreshMutation.mutate(['benefits'])}
              isRefreshing={refreshMutation.isPending}
            />
          )}
        </TabsContent>

        <TabsContent value="claims_history">
          {hasClaimsHistory ? (
            <ClaimsHistoryTable claimsHistory={data.claims_history} />
          ) : (
            <NoDataCard
              type="claims history"
              onRefresh={() => refreshMutation.mutate(['claims_history'])}
              isRefreshing={refreshMutation.isPending}
            />
          )}
        </TabsContent>

        <TabsContent value="prior_auth">
          {hasPriorAuth ? (
            <PriorAuthCard priorAuth={data.prior_auth} />
          ) : (
            <NoDataCard
              type="prior authorization"
              onRefresh={() => refreshMutation.mutate(['prior_auth'])}
              isRefreshing={refreshMutation.isPending}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// No data placeholder component
function NoDataCard({
  type,
  onRefresh,
  isRefreshing,
}: {
  type: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No {type} data available</h3>
        <p className="text-gray-500 mb-4">Click refresh to fetch the latest data from the payer.</p>
        <Button onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Fetching...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Fetch Data
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// Prior Auth Card (simple version)
function PriorAuthCard({ priorAuth }: { priorAuth: any }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-blue-600" />
          Prior Authorization Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="text-sm font-medium text-gray-700">Required:</div>
            <Badge variant={priorAuth.required ? 'default' : 'secondary'}>
              {priorAuth.required ? 'Yes' : 'No'}
            </Badge>
          </div>

          {priorAuth.authNumber && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-500">Auth Number</div>
                <div className="font-medium">{priorAuth.authNumber}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Status</div>
                <Badge
                  variant={priorAuth.status === 'approved' ? 'default' : 'secondary'}
                  className={
                    priorAuth.status === 'approved' ? 'bg-green-100 text-green-800' : ''
                  }
                >
                  {priorAuth.status}
                </Badge>
              </div>
            </div>
          )}

          {priorAuth.approvedUnits && (
            <div className="grid grid-cols-3 gap-4 pt-2 border-t">
              <div>
                <div className="text-sm text-gray-500">Approved Units</div>
                <div className="font-medium">{priorAuth.approvedUnits}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Used</div>
                <div className="font-medium">{priorAuth.usedUnits || 0}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Remaining</div>
                <div className="font-medium text-green-600">{priorAuth.remainingUnits || 0}</div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

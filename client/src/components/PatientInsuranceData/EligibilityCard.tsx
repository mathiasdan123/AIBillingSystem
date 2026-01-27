import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, CheckCircle, XCircle, Calendar, CreditCard, Users } from 'lucide-react';

interface NormalizedEligibility {
  isEligible: boolean;
  effectiveDate: string;
  terminationDate?: string;
  planName: string;
  planType: string;
  memberId: string;
  groupNumber?: string;
  coverageLevel: string;
  networkStatus: string;
}

interface EligibilityCardProps {
  eligibility: NormalizedEligibility;
}

export default function EligibilityCard({ eligibility }: EligibilityCardProps) {
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Eligibility Status
          </CardTitle>
          <Badge
            variant={eligibility.isEligible ? 'default' : 'destructive'}
            className={`text-sm px-3 py-1 ${
              eligibility.isEligible
                ? 'bg-green-100 text-green-800 hover:bg-green-100'
                : 'bg-red-100 text-red-800 hover:bg-red-100'
            }`}
          >
            {eligibility.isEligible ? (
              <>
                <CheckCircle className="w-4 h-4 mr-1" />
                Active
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 mr-1" />
                Inactive
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-6">
          {/* Plan Information */}
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-500 mb-1">Plan Name</div>
              <div className="font-semibold text-gray-900">{eligibility.planName}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-1">Plan Type</div>
              <Badge variant="outline">{eligibility.planType}</Badge>
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-1">Network Status</div>
              <Badge
                variant="outline"
                className={
                  eligibility.networkStatus === 'in_network'
                    ? 'border-green-300 text-green-700 bg-green-50'
                    : 'border-amber-300 text-amber-700 bg-amber-50'
                }
              >
                {eligibility.networkStatus === 'in_network' ? 'In-Network' : 'Out-of-Network'}
              </Badge>
            </div>
          </div>

          {/* Member Information */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CreditCard className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <div className="text-sm text-gray-500">Member ID</div>
                <div className="font-mono font-medium">{eligibility.memberId}</div>
              </div>
            </div>

            {eligibility.groupNumber && (
              <div className="flex items-start gap-3">
                <Users className="w-5 h-5 text-gray-400 mt-0.5" />
                <div>
                  <div className="text-sm text-gray-500">Group Number</div>
                  <div className="font-mono font-medium">{eligibility.groupNumber}</div>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <div className="text-sm text-gray-500">Coverage Level</div>
                <div className="font-medium capitalize">{eligibility.coverageLevel}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Coverage Dates */}
        <div className="mt-6 pt-4 border-t">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Coverage Period</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Effective Date</div>
              <div className="font-medium text-gray-900 mt-1">
                {formatDate(eligibility.effectiveDate)}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wide">
                {eligibility.terminationDate ? 'Termination Date' : 'Coverage End'}
              </div>
              <div className="font-medium text-gray-900 mt-1">
                {eligibility.terminationDate
                  ? formatDate(eligibility.terminationDate)
                  : 'Ongoing'}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

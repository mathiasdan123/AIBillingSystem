import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Upload, Sparkles, Info } from 'lucide-react';

/**
 * Patient-portal cost estimate card.
 *
 * Two states:
 *   1. needsUpload=true   → CTA to upload SBC, with a one-line carrot
 *      ("upload your plan and see your real per-session cost")
 *   2. estimateAvailable=true → shows actual per-session cost breakdown,
 *      accumulator status, and a confidence note
 *
 * Powers the upload-adoption strategy: patients see real numbers once
 * they upload, which is the strongest motivator for them to actually do it.
 */

interface CostEstimateResponse {
  needsUpload?: boolean;
  estimateAvailable?: boolean;
  message?: string;
  hint?: string;
  planName?: string | null;
  perSessionCost?: number;
  breakdown?: {
    billed: number;
    insurancePays: number;
    youPay: number;
    deductibleNote: string;
  };
  accumulators?: {
    oonDeductibleMet: number | null;
    oonOopMet: number | null;
  };
  confidence?: 'high' | 'medium' | 'low';
  notes?: string[];
}

interface Props {
  token: string;
  onNavigateToDocuments: () => void;
}

export default function PortalCostEstimateCard({ token, onNavigateToDocuments }: Props) {
  const { data, isLoading } = useQuery<CostEstimateResponse>({
    queryKey: ['/api/patient-portal/cost-estimate', token],
    queryFn: async () => {
      const res = await fetch('/api/patient-portal/cost-estimate', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch cost estimate');
      return res.json();
    },
  });

  if (isLoading) return null;

  // No data shape we recognize — fail silent (don't show a broken card to patients).
  if (!data) return null;

  // State 1: needs upload
  if (data.needsUpload) {
    return (
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <CardTitle className="text-base">See your real per-session cost</CardTitle>
              <CardDescription className="text-xs mt-0.5">Upload your insurance plan documents</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-emerald-900 mb-3">
            {data.message ?? 'Upload your insurance plan documents and we will show you your real per-session cost — including how much your deductible has covered so far.'}
          </p>
          {data.hint && (
            <p className="text-xs text-emerald-800/80 mb-3 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{data.hint}</span>
            </p>
          )}
          <Button onClick={onNavigateToDocuments} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Upload className="w-4 h-4 mr-2" />
            Upload Plan Documents
          </Button>
        </CardContent>
      </Card>
    );
  }

  // State 2: estimate available
  if (data.estimateAvailable && data.breakdown) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              Your per-session cost
            </CardTitle>
            {data.confidence && (
              <Badge variant="outline" className="text-[10px]">
                {data.confidence} confidence
              </Badge>
            )}
          </div>
          {data.planName && (
            <CardDescription className="text-xs">{data.planName}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="text-center py-2">
            <div className="text-3xl font-bold text-slate-900">
              ${data.breakdown.youPay.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">your typical out-of-pocket per session</div>
          </div>
          <div className="mt-4 pt-3 border-t space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Total session cost</span>
              <span>${data.breakdown.billed.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Insurance pays</span>
              <span>${data.breakdown.insurancePays.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold text-slate-900 pt-1.5 border-t">
              <span>You pay</span>
              <span>${data.breakdown.youPay.toFixed(2)}</span>
            </div>
          </div>
          {data.breakdown.deductibleNote && (
            <p className="mt-3 text-xs text-muted-foreground">{data.breakdown.deductibleNote}</p>
          )}
          {data.accumulators?.oonDeductibleMet != null && (
            <p className="mt-1 text-xs text-muted-foreground">
              Out-of-network deductible used so far this year: ${data.accumulators.oonDeductibleMet}
            </p>
          )}
          <p className="mt-3 text-[10px] text-muted-foreground italic">
            Estimate based on your plan documents. Your actual cost may vary depending on services provided.
          </p>
        </CardContent>
      </Card>
    );
  }

  // State 3: have plan but estimate failed — show light fallback
  if (data.estimateAvailable === false) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-slate-600" />
            Cost information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{data.message}</p>
        </CardContent>
      </Card>
    );
  }

  return null;
}

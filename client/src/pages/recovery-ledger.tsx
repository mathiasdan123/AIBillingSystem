import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiRequest } from '@/lib/queryClient';
import { ShieldCheck, TrendingUp, AlertTriangle, DollarSign, Info } from 'lucide-react';
import PageLayout from '@/components/PageLayout';

/**
 * Recovery Ledger — "Sheer for practices," the payer-advocate wedge made visible.
 *
 * Answers one question: how much money has the system saved / recovered?
 *
 * Honesty contract (mirrored from the backend):
 *   - Appeals recovered + Underpayments caught = HARD DOLLARS → headline.
 *   - Denials flagged pre-submission = COUNT ONLY, never dollarized (a flagged
 *     claim is not proof a denial was prevented). Shown as a separate,
 *     clearly-labeled stat so we never overstate recovered money.
 */

interface RecoveryLedger {
  appealsRecovered: {
    count: number;
    totalAppealed: number;
    totalRecovered: number;
    successRate: number;
  };
  underpaymentsCaught: { count: number; amount: number };
  denialsFlagged: { count: number; note: string };
  valueDelivered: number;
  windowStart: string | null;
  windowEnd: string | null;
}

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function RecoveryLedgerPage() {
  const { data, isLoading } = useQuery<RecoveryLedger>({
    queryKey: ['/api/analytics/recovery-ledger'],
    queryFn: async () => (await apiRequest('GET', '/api/analytics/recovery-ledger')).json(),
  });

  return (
    <PageLayout
      title="Recovery Ledger"
      description="How much the platform has recovered and protected for your practice — appeals won, underpayments caught, and at-risk claims flagged before they go out."
      isLoading={isLoading}
    >
      {/* Headline — hard dollars only */}
      <Card className="mb-6 border-green-200 bg-green-50/50 dark:bg-green-900/10 dark:border-green-800">
        <CardHeader>
          <CardDescription className="flex items-center gap-2 text-green-800 dark:text-green-200">
            <DollarSign className="w-4 h-4" /> Total value delivered
          </CardDescription>
          <CardTitle className="text-4xl text-green-700 dark:text-green-300">
            {fmtUsd(data?.valueDelivered ?? 0)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Realized hard dollars: appeals recovered + underpayments caught. Does not include
            estimated value of denials flagged before submission (counted separately below, never
            dollarized).
          </p>
        </CardContent>
      </Card>

      {/* Three pillars */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Pillar 1: Appeals recovered */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-600" /> Appeals recovered
            </CardTitle>
            <CardDescription>Dollars won back from denied claims via appeals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold text-blue-700 dark:text-blue-300">
              {fmtUsd(data?.appealsRecovered.totalRecovered ?? 0)}
            </div>
            <div className="text-sm text-muted-foreground">
              {data?.appealsRecovered.count ?? 0} appeal(s) won/partial
              {' · '}
              {Math.round(data?.appealsRecovered.successRate ?? 0)}% success rate
            </div>
            <div className="text-xs text-muted-foreground">
              of {fmtUsd(data?.appealsRecovered.totalAppealed ?? 0)} appealed
            </div>
          </CardContent>
        </Card>

        {/* Pillar 2: Underpayments caught */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" /> Underpayments caught
            </CardTitle>
            <CardDescription>Contract-vs-paid gaps detected on remittances.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold text-emerald-700 dark:text-emerald-300">
              {fmtUsd(data?.underpaymentsCaught.amount ?? 0)}
            </div>
            <div className="text-sm text-muted-foreground">
              {data?.underpaymentsCaught.count ?? 0} claim(s) flagged below contract
            </div>
          </CardContent>
        </Card>

        {/* Pillar 3: Denials flagged (count only) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" /> Denials flagged pre-submission
            </CardTitle>
            <CardDescription>High-risk claims caught before they were sent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold text-amber-700 dark:text-amber-300">
              {data?.denialsFlagged.count ?? 0}
            </div>
            <div className="text-xs text-muted-foreground flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              {data?.denialsFlagged.note ??
                'At-risk claims caught before submission. Not monetized.'}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

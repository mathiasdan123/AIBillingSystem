import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import PageLayout from '@/components/PageLayout';
import { useToast } from '@/hooks/use-toast';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

/**
 * Investor Metrics — the diligence dashboard. Persisted daily KPI time series
 * (global rollup over real practices only; demo data excluded). Definitions
 * live in server/services/investorMetricsService.ts.
 */

interface MetricsResponse {
  days: number;
  series: Record<string, Array<{ date: string; value: number }>>;
  latest: Record<string, number>;
}

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtNum = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

const CARDS: Array<{ metric: string; label: string; fmt: (n: number) => string; sub?: string }> = [
  { metric: 'value_recovered_cum', label: 'Dollars recovered (realized)', fmt: fmtUsd, sub: 'Appeals won + underpayments collected' },
  { metric: 'claims_submitted_cum', label: 'Claims submitted', fmt: fmtNum },
  { metric: 'first_pass_acceptance', label: 'First-pass acceptance', fmt: fmtPct, sub: 'Paid without appeal ÷ resolved' },
  { metric: 'denial_rate', label: 'Denial rate', fmt: fmtPct },
  { metric: 'avg_days_to_payment', label: 'Avg days to payment', fmt: fmtNum },
  { metric: 'active_practices', label: 'Active practices (30d)', fmt: fmtNum },
  { metric: 'value_identified_cum', label: 'Underpayment gap identified', fmt: fmtUsd, sub: 'Measured, not yet collected — reported separately' },
  { metric: 'blanche_conversations_cum', label: 'Blanche conversations', fmt: fmtNum },
];

export default function InvestorMetricsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<MetricsResponse>({
    queryKey: ['/api/investor-metrics'],
    queryFn: async () => (await apiRequest('GET', '/api/investor-metrics?days=180')).json(),
  });

  const backfill = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/investor-metrics/backfill', { days: 90 })).json(),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['/api/investor-metrics'] });
      toast({ title: 'Backfill complete', description: `${r.stored} daily snapshots recomputed.` });
    },
    onError: () => toast({ title: 'Backfill failed', variant: 'destructive' }),
  });

  const recoveredSeries = data?.series?.value_recovered_cum ?? [];
  const claimsSeries = data?.series?.claims_submitted_cum ?? [];

  return (
    <PageLayout
      title="Investor Metrics"
      description="Persisted daily KPIs across real practices — demo data excluded. The numbers a diligence process asks for, provable over time."
      isLoading={isLoading}
    >
      <div className="flex justify-end mb-4">
        <Button variant="outline" size="sm" onClick={() => backfill.mutate()} disabled={backfill.isPending}>
          {backfill.isPending ? 'Recomputing…' : 'Backfill 90 days'}
        </Button>
      </div>

      {/* Latest values */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        {CARDS.map((c) => (
          <Card key={c.metric}>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs">{c.label}</CardDescription>
              <CardTitle className="text-2xl">{c.fmt(data?.latest?.[c.metric] ?? 0)}</CardTitle>
            </CardHeader>
            {c.sub && (
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">{c.sub}</p>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Trend charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dollars recovered (cumulative)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={recoveredSeries}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                <XAxis dataKey="date" fontSize={11} minTickGap={30} />
                <YAxis fontSize={11} tickFormatter={(v: number) => fmtUsd(v)} width={72} />
                <Tooltip formatter={(v: number) => fmtUsd(Number(v))} />
                <Line type="monotone" dataKey="value" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Claims submitted (cumulative)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={claimsSeries}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                <XAxis dataKey="date" fontSize={11} minTickGap={30} />
                <YAxis fontSize={11} width={48} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

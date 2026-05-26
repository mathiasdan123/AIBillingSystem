/**
 * Cost Dashboard (admin-only)
 *
 * Surfaces Anthropic API spend and prompt-cache efficiency. Gated by
 * `isAdmin` in App.tsx; the backend route also enforces the role check.
 */

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, DollarSign, Database, Info } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, PieChart, Pie, Cell,
} from 'recharts';

interface SummaryResponse {
  generatedAt: string;
  mtd: { spendUsd: number; budgetUsd: number; usedPct: number; warnPct: number; warning: boolean };
  dailyTrend: Array<{ date: string; usd: number }>;
  spendByModel: Array<{ model: string; usd: number }>;
  cacheEfficiency: Array<{
    date: string;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    uncachedInputTokens: number;
    hitRatePct: number;
  }>;
  cacheTtlSeconds: number;
}

interface PerPracticeResponse {
  available: boolean;
  reason?: string;
  rows: Array<{ practiceId: number; practiceName: string; usd: number }>;
}

const MODEL_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#16a34a', '#ea580c', '#dc2626'];

export default function CostDashboard() {
  const { data: summary, isLoading, error } = useQuery<SummaryResponse>({
    queryKey: ['/api/admin/cost-dashboard/summary'],
    retry: false,
    refetchInterval: 5 * 60 * 1000, // match server cache TTL
  });

  const { data: perPractice } = useQuery<PerPracticeResponse>({
    queryKey: ['/api/admin/cost-dashboard/per-practice'],
    retry: false,
  });

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading cost data…</div>;
  }
  if (error || !summary) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Failed to load Anthropic cost report
            </CardTitle>
            <CardDescription>
              Check that <code>ANTHROPIC_ADMIN_API_KEY_SECRET_ID</code> (or{' '}
              <code>ANTHROPIC_ADMIN_API_KEY</code> in dev) is set and the key starts with{' '}
              <code>sk-ant-admin-</code>. Service account keys are not accepted by the Admin API.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Unknown error'}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { mtd, dailyTrend, spendByModel, cacheEfficiency } = summary;
  const totalCacheReads = cacheEfficiency.reduce((a, b) => a + b.cacheReadTokens, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI Cost Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Anthropic API spend and prompt-cache health. Updated every 5 min ·{' '}
          last fetch {new Date(summary.generatedAt).toLocaleString()}
        </p>
      </div>

      {/* MTD spend vs budget */}
      <Card data-testid="card-mtd-spend">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" /> Month-to-date spend
          </CardTitle>
          <CardDescription>vs ${mtd.budgetUsd.toFixed(0)} monthly budget</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3 mb-3">
            <div className={`text-5xl font-bold ${mtd.warning ? 'text-destructive' : ''}`}>
              ${mtd.spendUsd.toFixed(2)}
            </div>
            <Badge variant={mtd.warning ? 'destructive' : 'secondary'}>
              {mtd.usedPct.toFixed(1)}% of budget
            </Badge>
            {mtd.warning && (
              <span className="flex items-center gap-1 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" /> over {mtd.warnPct}% threshold
              </span>
            )}
          </div>
          <Progress value={Math.min(100, mtd.usedPct)} className="h-3" />
        </CardContent>
      </Card>

      {/* Daily spend trend */}
      <Card>
        <CardHeader>
          <CardTitle>Daily spend — last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
              <Line type="monotone" dataKey="usd" stroke="#2563eb" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Spend by model */}
      <Card>
        <CardHeader>
          <CardTitle>Spend by model (MTD)</CardTitle>
          <CardDescription>
            Watch for Opus where Sonnet/Haiku would do — see <code>selectModelForQuery</code> in
            ai-assistant.ts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {spendByModel.length === 0 ? (
            <p className="text-sm text-muted-foreground">No spend yet this month.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={spendByModel}
                    dataKey="usd"
                    nameKey="model"
                    outerRadius={90}
                    label={(d: any) => `${d.model}: $${d.usd.toFixed(2)}`}
                  >
                    {spendByModel.map((_, i) => (
                      <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                </PieChart>
              </ResponsiveContainer>
              <table className="text-sm w-full">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Model</th>
                    <th className="py-1 text-right">USD</th>
                  </tr>
                </thead>
                <tbody>
                  {spendByModel.map((r) => (
                    <tr key={r.model} className="border-t">
                      <td className="py-2 font-mono">{r.model}</td>
                      <td className="py-2 text-right">${r.usd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cache efficiency */}
      <Card data-testid="card-cache-efficiency">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" /> Prompt-cache efficiency
          </CardTitle>
          <CardDescription>
            Cache-read vs cache-creation vs uncached input tokens, by day. Regression detector: if
            the hit-rate line crashes toward 0 after a deploy, caching broke. Cross-check against{' '}
            <code>/ecs/therapybill-app</code> "Blanche turn usage" logs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {totalCacheReads === 0 ? (
            <div className="text-sm text-muted-foreground flex items-start gap-2 p-3 rounded bg-amber-50 border border-amber-200">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                No cache reads recorded in the last 30 days. This is expected if production traffic
                hasn't hit the cached prompt path yet (caching shipped in <code>72fffdad</code>).
                Once Blanche has real traffic, this should climb above 50% on repeat conversations.
              </span>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={cacheEfficiency}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="cacheReadTokens" stackId="a" fill="#16a34a" name="Cache read" />
                  <Bar dataKey="cacheCreationTokens" stackId="a" fill="#0891b2" name="Cache creation" />
                  <Bar dataKey="uncachedInputTokens" stackId="a" fill="#94a3b8" name="Uncached input" />
                </BarChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={cacheEfficiency}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                  <Line
                    type="monotone"
                    dataKey="hitRatePct"
                    stroke="#16a34a"
                    strokeWidth={2}
                    name="Cache hit rate"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </CardContent>
      </Card>

      {/* Per-practice attribution (placeholder) */}
      <Card>
        <CardHeader>
          <CardTitle>Per-practice cost-to-serve</CardTitle>
          <CardDescription>Not yet wired — see note below.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground flex items-start gap-2 p-3 rounded bg-slate-50 border">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              {perPractice?.reason ??
                'All Anthropic calls share one org key with no per-practice tag, so the Admin Cost API cannot attribute spend per practice. Recommended next step: add an ai_usage_events table and instrument every messages.create call site (currently only ai-assistant.ts logs cache tokens).'}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

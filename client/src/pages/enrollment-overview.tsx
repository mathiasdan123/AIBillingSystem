import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiRequest } from '@/lib/queryClient';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import PageLayout from '@/components/PageLayout';

/**
 * Enrollment Ops Overview (Phase 4) — cross-practice readiness rollup.
 * Reads GET /api/admin/enrollment-overview.
 */

interface PracticeRow {
  practiceId: number;
  name: string | null;
  npiPresent: boolean;
  npiValid: boolean;
  taxIdPresent: boolean;
  addressComplete: boolean;
  authorized: boolean;
  hasStediProvider: boolean;
  enrollmentReady: boolean;
  blockers: string[];
  counts: Record<string, Record<string, number>>;
}

interface Overview {
  summary: { totalPractices: number; enrollmentReady: number; withStediProvider: number; authorized: number };
  practices: PracticeRow[];
}

export default function EnrollmentOverviewPage() {
  const { data, isLoading } = useQuery<Overview>({
    queryKey: ['/api/admin/enrollment-overview'],
    queryFn: async () => (await apiRequest('GET', '/api/admin/enrollment-overview')).json(),
  });

  const s = data?.summary;

  return (
    <PageLayout
      title="Enrollment Overview"
      description="Cross-practice enrollment readiness. Which practices can transact, and what's blocking the rest."
      isLoading={isLoading}
    >
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Practices" value={s.totalPractices} />
          <Stat label="Enrollment-ready" value={s.enrollmentReady} tone="success" />
          <Stat label="With Stedi provider" value={s.withStediProvider} />
          <Stat label="Authorized" value={s.authorized} />
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Practice</th>
                  <th className="px-4 py-2 font-medium">Ready</th>
                  <th className="px-4 py-2 font-medium">Identity</th>
                  <th className="px-4 py-2 font-medium">ERA enrolled</th>
                  <th className="px-4 py-2 font-medium">Blockers</th>
                </tr>
              </thead>
              <tbody>
                {(data?.practices ?? []).map((p) => (
                  <tr key={p.practiceId} className="border-b last:border-b-0 hover:bg-muted/30 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.name ?? `Practice ${p.practiceId}`}</div>
                      <div className="text-xs text-muted-foreground">#{p.practiceId}</div>
                    </td>
                    <td className="px-4 py-3">
                      {p.enrollmentReady ? (
                        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Ready
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Blocked
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs space-y-0.5">
                      <Check ok={p.npiPresent && p.npiValid} label="NPI" />
                      <Check ok={p.taxIdPresent} label="Tax ID" />
                      <Check ok={p.addressComplete} label="Address" />
                      <Check ok={p.authorized} label="Authorized" />
                      <Check ok={p.hasStediProvider} label="Stedi provider" />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-green-700">{p.counts?.era?.enrolled ?? 0} enrolled</span>
                      {', '}
                      <span className="text-blue-700">{p.counts?.era?.pending ?? 0} pending</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
                      {p.blockers.length === 0 ? '—' : p.blockers.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </PageLayout>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' }) {
  return (
    <div className={`p-3 rounded-lg border ${tone === 'success' ? 'bg-green-50 border-green-200 text-green-900 dark:bg-green-900/20 dark:text-green-100' : 'bg-slate-50 border-slate-200 text-slate-900 dark:bg-slate-900/20 dark:text-slate-100'}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={ok ? 'text-green-700 dark:text-green-300' : 'text-slate-400'}>
      {ok ? '✓' : '○'} {label}
    </div>
  );
}

/**
 * Stedi Readiness Dashboard (admin / billing only).
 *
 * Single-screen answer to "how close are we to going live on Stedi
 * end-to-end?" — API key environment, payer enrollment per transaction
 * type, last 7 days of real traffic, and a composite blockers list that
 * tells the operator exactly what to do next.
 *
 * Read-only. Enrollment changes happen in /payer-enrollments; this is
 * the situational-awareness view.
 */
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  KeyRound,
  Building2,
  Activity,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { Link } from 'wouter';

type EnvLabel = 'production' | 'test' | 'unknown';
interface EnrollmentBucket {
  enrolled: number;
  pending: number;
  not_enrolled: number;
  rejected: number;
}
interface ReadinessResponse {
  ready: boolean;
  blockers: string[];
  apiKey: { present: boolean; source: 'practice' | 'env' | 'none'; environment: EnvLabel };
  enrollments: Record<'eligibility' | 'claims' | 'era', EnrollmentBucket>;
  enrollmentDetail: Array<{
    id: number;
    payerName: string;
    transactionType: string;
    status: string;
    requestedAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    rejectionReason: string | null;
  }>;
  recentActivity: {
    eligibility: { last7dCount: number; lastAt: string | null };
    claims: { last7dCount: number; lastAt: string | null };
    remittance: { last7dCount: number; lastAt: string | null };
  };
  generatedAt: string;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return 'never';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'yellow' | 'red' | 'gray' }) {
  const map = {
    green: 'bg-green-100 text-green-800 border-green-200',
    yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    red: 'bg-red-100 text-red-800 border-red-200',
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${map[tone]}`}>
      {label}
    </span>
  );
}

function EnrollmentCard({
  title,
  description,
  bucket,
}: {
  title: string;
  description: string;
  bucket: EnrollmentBucket;
}) {
  const tone: 'green' | 'yellow' | 'red' =
    bucket.enrolled > 0 ? 'green' : bucket.pending > 0 ? 'yellow' : 'red';
  const label =
    bucket.enrolled > 0
      ? `${bucket.enrolled} enrolled`
      : bucket.pending > 0
      ? `${bucket.pending} pending`
      : 'none enrolled';
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <StatusPill label={label} tone={tone} />
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="text-lg font-semibold text-green-700">{bucket.enrolled}</div>
            <div className="text-xs text-muted-foreground">enrolled</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-yellow-700">{bucket.pending}</div>
            <div className="text-xs text-muted-foreground">pending</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-gray-500">{bucket.not_enrolled}</div>
            <div className="text-xs text-muted-foreground">not started</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-red-700">{bucket.rejected}</div>
            <div className="text-xs text-muted-foreground">rejected</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityCard({
  title,
  txnLabel,
  count,
  lastAt,
}: {
  title: string;
  txnLabel: string;
  count: number;
  lastAt: string | null;
}) {
  const tone = count > 0 ? 'green' : 'red';
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <StatusPill label={count > 0 ? 'active' : 'idle'} tone={tone} />
        </div>
        <CardDescription className="text-xs">{txnLabel}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="text-2xl font-semibold">{count}</div>
        <div className="text-xs text-muted-foreground">in the last 7 days</div>
        <div className="text-xs text-muted-foreground mt-1">last: {formatTimestamp(lastAt)}</div>
      </CardContent>
    </Card>
  );
}

export default function StediReadiness() {
  const { data, isLoading, error, refetch } = useQuery<ReadinessResponse>({
    queryKey: ['/api/admin/stedi-readiness'],
    queryFn: async () => {
      const res = await fetch('/api/admin/stedi-readiness', { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to load readiness');
      }
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6 pt-20 md:pt-6 md:ml-64 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" /> Failed to load readiness
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
            <Button onClick={() => refetch()} className="mt-3">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!data) return null;

  const keyTone: 'green' | 'yellow' | 'red' =
    data.apiKey.environment === 'production'
      ? 'green'
      : data.apiKey.environment === 'test'
      ? 'yellow'
      : 'red';
  const keyLabel =
    data.apiKey.environment === 'production'
      ? 'production'
      : data.apiKey.environment === 'test'
      ? 'test / sandbox'
      : data.apiKey.present
      ? 'unknown prefix'
      : 'not configured';

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6" />
          Stedi Readiness
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          How close this practice is to clearing a real claim end-to-end through Stedi. Read-only —
          enrollment changes happen on the{' '}
          <Link href="/payer-enrollments" className="underline text-primary">
            Payer Enrollments
          </Link>{' '}
          page.
        </p>
      </div>

      {/* Hero readiness banner */}
      <Card
        className={
          data.ready
            ? 'border-green-300 bg-green-50'
            : 'border-yellow-300 bg-yellow-50'
        }
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {data.ready ? (
              <>
                <CheckCircle2 className="h-6 w-6 text-green-700" />
                <span className="text-green-800">Ready to clear real claims</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-6 w-6 text-yellow-700" />
                <span className="text-yellow-900">
                  {data.blockers.length} blocker{data.blockers.length === 1 ? '' : 's'} before go-live
                </span>
              </>
            )}
          </CardTitle>
        </CardHeader>
        {!data.ready && (
          <CardContent>
            <ul className="space-y-1 text-sm">
              {data.blockers.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-yellow-700 mt-0.5">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      {/* API key card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Stedi API Key
            </CardTitle>
            <StatusPill label={keyLabel} tone={keyTone} />
          </div>
          <CardDescription className="text-xs">
            Source: {data.apiKey.source} {data.apiKey.source === 'env' ? '(STEDI_API_KEY env var)' : data.apiKey.source === 'practice' ? '(per-practice override)' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.apiKey.environment === 'test' && (
            <p className="text-sm text-muted-foreground">
              Sandbox traffic works against test payers (Aetna, UHC, Anthem BCBS, Horizon BCBS) but real
              claims won't reach real payers. Swap in a production key to go live.
            </p>
          )}
          {!data.apiKey.present && (
            <p className="text-sm text-muted-foreground">
              Set <code className="text-xs bg-muted px-1 py-0.5 rounded">STEDI_API_KEY</code> in environment
              or attach a key on the practice record.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Enrollment cards */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Building2 className="h-5 w-5" /> Payer Enrollments
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <EnrollmentCard
            title="Eligibility (270/271)"
            description="Patient coverage verification"
            bucket={data.enrollments.eligibility}
          />
          <EnrollmentCard
            title="Claims (837)"
            description="Claim submission to payers"
            bucket={data.enrollments.claims}
          />
          <EnrollmentCard
            title="ERA (835)"
            description="Auto-posting of remittance + payment info"
            bucket={data.enrollments.era}
          />
        </div>
      </div>

      {/* Recent activity */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5" /> Recent Activity (last 7 days)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ActivityCard
            title="Eligibility checks"
            txnLabel="270/271 calls"
            count={data.recentActivity.eligibility.last7dCount}
            lastAt={data.recentActivity.eligibility.lastAt}
          />
          <ActivityCard
            title="Claim submissions"
            txnLabel="837 transactions"
            count={data.recentActivity.claims.last7dCount}
            lastAt={data.recentActivity.claims.lastAt}
          />
          <ActivityCard
            title="ERA receipts"
            txnLabel="835 remittance advice"
            count={data.recentActivity.remittance.last7dCount}
            lastAt={data.recentActivity.remittance.lastAt}
          />
        </div>
      </div>

      {/* Drill-down: per-payer enrollment table */}
      {data.enrollmentDetail.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-payer enrollment detail</CardTitle>
            <CardDescription className="text-xs">
              {data.enrollmentDetail.length} row{data.enrollmentDetail.length === 1 ? '' : 's'}.{' '}
              <Link href="/payer-enrollments" className="underline">
                Manage <ExternalLink className="h-3 w-3 inline -mt-0.5" />
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium">Payer</th>
                    <th className="text-left py-2 px-2 font-medium">Transaction</th>
                    <th className="text-left py-2 px-2 font-medium">Status</th>
                    <th className="text-left py-2 px-2 font-medium">Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {data.enrollmentDetail.map((row) => {
                    const tone =
                      row.status === 'enrolled'
                        ? 'green'
                        : row.status === 'pending'
                        ? 'yellow'
                        : row.status === 'rejected'
                        ? 'red'
                        : 'gray';
                    return (
                      <tr key={row.id} className="border-b last:border-b-0">
                        <td className="py-2 px-2">{row.payerName}</td>
                        <td className="py-2 px-2 text-muted-foreground">{row.transactionType}</td>
                        <td className="py-2 px-2">
                          <StatusPill label={row.status} tone={tone} />
                        </td>
                        <td className="py-2 px-2 text-muted-foreground text-xs">
                          {formatTimestamp(row.approvedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Generated {formatTimestamp(data.generatedAt)}
      </p>
    </div>
  );
}

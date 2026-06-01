import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiRequest } from '@/lib/queryClient';
import { Link } from 'wouter';
import {
  AlertTriangle,
  ShieldAlert,
  Scale,
  TrendingDown,
  Clock,
  FileText,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import PageLayout from '@/components/PageLayout';

/**
 * Biller Cockpit — the single "what needs action" worklist. Each bucket shows
 * a count + sample claims and links to where the work gets done. Read-only
 * aggregation; the actual actions happen on the existing claims/appeals pages.
 */

interface CockpitClaimSample {
  id: number;
  claimNumber: string | null;
  patientName: string | null;
  totalAmount: string | null;
  status: string | null;
  createdAt: string | null;
}
interface CockpitBucket {
  key: string;
  label: string;
  count: number;
  samples: CockpitClaimSample[];
  href: string;
}
interface BillerCockpit {
  buckets: CockpitBucket[];
  totalActionable: number;
  generatedAt: string;
}

const BUCKET_ICON: Record<string, typeof AlertTriangle> = {
  held: AlertTriangle,
  atRisk: ShieldAlert,
  deniedNoAppeal: Scale,
  underpaid: TrendingDown,
  aging: Clock,
  draft: FileText,
};

// Tone per bucket — red for revenue-at-risk states, amber for queues, slate for drafts.
const BUCKET_TONE: Record<string, string> = {
  held: 'text-red-600',
  atRisk: 'text-red-600',
  deniedNoAppeal: 'text-amber-600',
  underpaid: 'text-amber-600',
  aging: 'text-amber-600',
  draft: 'text-slate-500',
};

const fmtUsd = (v: string | null) => {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

export default function BillerCockpitPage() {
  const { data, isLoading } = useQuery<BillerCockpit>({
    queryKey: ['/api/analytics/biller-cockpit'],
    queryFn: async () => (await apiRequest('GET', '/api/analytics/biller-cockpit')).json(),
  });

  const buckets = data?.buckets ?? [];
  const allClear = !isLoading && (data?.totalActionable ?? 0) === 0;

  return (
    <PageLayout
      title="Biller Cockpit"
      description="Everything that needs action in one place — held claims, denials awaiting appeal, underpayments, aging, and drafts. Click any bucket to work it."
      isLoading={isLoading}
    >
      {allClear ? (
        <Card className="border-green-200 bg-green-50/50 dark:bg-green-900/10 dark:border-green-800">
          <CardContent className="flex items-center gap-3 py-6">
            <CheckCircle2 className="w-8 h-8 text-green-600 flex-shrink-0" />
            <div>
              <div className="font-semibold text-green-800 dark:text-green-200">Worklist clear</div>
              <p className="text-sm text-muted-foreground">No claims currently need action. Nice.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-4 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{data?.totalActionable ?? 0}</span> item(s)
            across {buckets.filter((b) => b.count > 0).length} active bucket(s).
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {buckets.map((bucket) => {
              const Icon = BUCKET_ICON[bucket.key] ?? FileText;
              const tone = bucket.count > 0 ? (BUCKET_TONE[bucket.key] ?? 'text-slate-500') : 'text-slate-400';
              return (
                <Card key={bucket.key} className={bucket.count > 0 ? '' : 'opacity-60'}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Icon className={`w-4 h-4 ${tone}`} />
                        {bucket.label}
                      </CardTitle>
                      <Badge variant="outline" className={bucket.count > 0 ? 'font-bold' : 'text-muted-foreground'}>
                        {bucket.count}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {bucket.samples.length > 0 ? (
                      <ul className="space-y-1 mb-3">
                        {bucket.samples.map((s) => (
                          <li key={s.id} className="text-xs flex items-center justify-between gap-2">
                            <span className="truncate">
                              {s.patientName || 'Unknown'}{' '}
                              <span className="text-muted-foreground font-mono">
                                {s.claimNumber ? `#${s.claimNumber}` : `id ${s.id}`}
                              </span>
                            </span>
                            <span className="text-muted-foreground flex-shrink-0">{fmtUsd(s.totalAmount)}</span>
                          </li>
                        ))}
                        {bucket.count > bucket.samples.length && (
                          <li className="text-[11px] text-muted-foreground italic">
                            +{bucket.count - bucket.samples.length} more
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground mb-3">
                        {bucket.count > 0 ? 'Open to work this queue.' : 'Nothing here right now.'}
                      </p>
                    )}
                    {bucket.count > 0 && (
                      <Link
                        href={bucket.href}
                        className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5"
                      >
                        View all <ChevronRight className="w-3 h-3" />
                      </Link>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </PageLayout>
  );
}

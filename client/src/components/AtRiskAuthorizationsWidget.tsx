import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { Sparkles, AlertTriangle, Clock, ArrowRight, CheckCircle2 } from 'lucide-react';

/**
 * Dashboard widget — surfaces authorizations projected to lapse within
 * the next 30 days, combining calendar-expiry and pace-based unit
 * exhaustion forecasting (see getAtRiskAuthorizations).
 *
 * Rendered on the main dashboard so billers see urgency first thing in
 * the morning without opening individual patient records.
 */

interface AtRiskEntry {
  auth: {
    id: number;
    patientId: number;
    authorizationNumber: string | null;
    cptCode: string | null;
    authorizedUnits: number;
    usedUnits: number;
    endDate: string;
  };
  patientName: string;
  predictedEndDate: string;
  daysUntilPredictedEnd: number;
  reason: 'expiring' | 'exhausting' | 'both';
  sessionsPerWeek: number | null;
  projectedSessionsRemaining: number | null;
}

const MAX_VISIBLE = 5;

export default function AtRiskAuthorizationsWidget() {
  const { data = [], isLoading } = useQuery<AtRiskEntry[]>({
    queryKey: ['/api/treatment-authorizations/at-risk'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/treatment-authorizations/at-risk?daysAhead=30');
      return res.json();
    },
  });

  // Bucket by urgency for the count line.
  const urgent = data.filter((e) => e.daysUntilPredictedEnd <= 7);
  const soon = data.filter((e) => e.daysUntilPredictedEnd > 7 && e.daysUntilPredictedEnd <= 30);

  const visible = data.slice(0, MAX_VISIBLE);
  const hiddenCount = Math.max(0, data.length - MAX_VISIBLE);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" aria-hidden="true" />
            Auths at risk
            <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">
              AI forecast
            </Badge>
          </CardTitle>
          {data.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {urgent.length > 0 && (
                <span className="text-red-600 font-medium">{urgent.length} urgent</span>
              )}
              {urgent.length > 0 && soon.length > 0 && ' · '}
              {soon.length > 0 && <span>{soon.length} within 30d</span>}
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : data.length === 0 ? (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            <span>
              No authorizations at risk in the next 30 days. You'll see a warning here the moment any
              patient is projected to run out of units or approach expiry.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((entry) => (
              <Link
                key={entry.auth.id}
                href={`/patients?highlight=${entry.auth.patientId}`}
                className="block p-2 rounded-md hover:bg-muted/50 transition-colors"
                data-testid={`at-risk-row-${entry.auth.id}`}
              >
                <div className="flex items-start gap-2">
                  <UrgencyIcon days={entry.daysUntilPredictedEnd} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{entry.patientName}</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {entry.auth.authorizationNumber || 'no auth #'}
                      </span>
                      {entry.auth.cptCode && (
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {entry.auth.cptCode}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {reasonText(entry)}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div
                      className={`text-sm font-semibold ${
                        entry.daysUntilPredictedEnd <= 7
                          ? 'text-red-600'
                          : entry.daysUntilPredictedEnd <= 14
                            ? 'text-amber-600'
                            : 'text-slate-600'
                      }`}
                    >
                      {entry.daysUntilPredictedEnd}d
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatDate(entry.predictedEndDate)}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
            {hiddenCount > 0 && (
              <Button variant="ghost" size="sm" asChild className="w-full">
                <Link href="/patients">
                  +{hiddenCount} more
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UrgencyIcon({ days }: { days: number }) {
  if (days <= 7) return <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />;
  if (days <= 14) return <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />;
  return <Clock className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />;
}

function reasonText(e: AtRiskEntry): string {
  const remaining = Math.max(0, e.auth.authorizedUnits - e.auth.usedUnits);
  if (e.reason === 'exhausting' && e.sessionsPerWeek) {
    return `${remaining} units left · ${e.sessionsPerWeek.toFixed(1)}/wk pace → runs out ${formatDate(e.predictedEndDate)}`;
  }
  if (e.reason === 'both' && e.sessionsPerWeek) {
    return `${remaining} units + expires ${formatDate(e.predictedEndDate)} · ${e.sessionsPerWeek.toFixed(1)}/wk`;
  }
  return `${remaining} units left · expires ${formatDate(e.predictedEndDate)}`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { BadgeCheck, AlertTriangle, Clock, ArrowRight, CheckCircle2 } from 'lucide-react';

/**
 * Dashboard widget — provider credentials with an upcoming expiration or
 * re-credentialing deadline. Mirrors the at-risk-authorizations widget
 * pattern but for credentialing paperwork rather than PA units.
 */

interface CredentialAtRiskEntry {
  credential: {
    id: number;
    providerName: string;
    payerName: string;
    enrollmentStatus: string;
    expirationDate: string | null;
    reCredentialingDate: string | null;
  };
  daysUntilExpiration: number | null;
  daysUntilReCredentialing: number | null;
  daysUntilAction: number;
  reason: 'expiring' | 're_credentialing' | 'both';
}

const MAX_VISIBLE = 5;

export default function CredentialingDeadlinesWidget() {
  const { data = [], isLoading } = useQuery<CredentialAtRiskEntry[]>({
    queryKey: ['/api/credentialing/at-risk'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/credentialing/at-risk?daysAhead=60');
      return res.json();
    },
  });

  const urgent = data.filter((e) => e.daysUntilAction <= 14);
  const later = data.filter((e) => e.daysUntilAction > 14);
  const visible = data.slice(0, MAX_VISIBLE);
  const hiddenCount = Math.max(0, data.length - MAX_VISIBLE);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BadgeCheck className="w-5 h-5 text-blue-600" aria-hidden="true" />
            Credentialing deadlines
          </CardTitle>
          {data.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {urgent.length > 0 && (
                <span className="text-red-600 font-medium">{urgent.length} urgent</span>
              )}
              {urgent.length > 0 && later.length > 0 && ' · '}
              {later.length > 0 && <span>{later.length} within 60d</span>}
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
              No provider credentialing deadlines in the next 60 days. We'll alert you here and via
              email as soon as any credential approaches expiration or re-credentialing.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((entry) => (
              <Link
                key={entry.credential.id}
                href="/credentialing"
                className="block p-2 rounded-md hover:bg-muted/50 transition-colors"
                data-testid={`credentialing-row-${entry.credential.id}`}
              >
                <div className="flex items-start gap-2">
                  <UrgencyIcon days={entry.daysUntilAction} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">
                        {entry.credential.providerName}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {entry.credential.payerName}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] capitalize bg-slate-50 text-slate-700"
                      >
                        {entry.credential.enrollmentStatus.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{reasonText(entry)}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div
                      className={`text-sm font-semibold ${
                        entry.daysUntilAction <= 7
                          ? 'text-red-600'
                          : entry.daysUntilAction <= 14
                            ? 'text-amber-600'
                            : 'text-slate-600'
                      }`}
                    >
                      {entry.daysUntilAction}d
                    </div>
                  </div>
                </div>
              </Link>
            ))}
            {hiddenCount > 0 && (
              <Button variant="ghost" size="sm" asChild className="w-full">
                <Link href="/credentialing">
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

function reasonText(e: CredentialAtRiskEntry): string {
  if (e.reason === 'expiring') {
    return `Credential expires ${formatDate(e.credential.expirationDate!)}`;
  }
  if (e.reason === 're_credentialing') {
    return `Re-credentialing due ${formatDate(e.credential.reCredentialingDate!)}`;
  }
  return `Expires ${formatDate(e.credential.expirationDate!)} · Re-cred ${formatDate(e.credential.reCredentialingDate!)}`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

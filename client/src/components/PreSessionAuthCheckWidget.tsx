import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { CalendarClock, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';

/**
 * Forward-looking auth-coverage widget. Lists upcoming appointments
 * (next 7 days) where the patient lacks an active auth with units
 * remaining covering the scheduled date. Click-through to the patient
 * detail to log the auth.
 *
 * Pairs with the at-risk-authorizations widget, which catches auths
 * predicted to lapse SOON. This one catches sessions about to bill
 * against missing coverage.
 */

interface AppointmentNeedingAuth {
  appointment: { id: number; patientId: number; startTime: string; title: string | null };
  patientName: string;
  reason: 'no_active_auth' | 'expired_by_date' | 'units_exhausted';
  nearestAuth: {
    authorizationNumber: string | null;
    endDate: string | null;
    authorizedUnits: number;
    usedUnits: number;
  } | null;
}

const MAX_VISIBLE = 5;

export default function PreSessionAuthCheckWidget() {
  const { data = [], isLoading } = useQuery<AppointmentNeedingAuth[]>({
    queryKey: ['/api/appointments/auth-coverage'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/appointments/auth-coverage?daysAhead=7');
      return res.json();
    },
  });

  // Tomorrow's count is most urgent.
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);
  const urgent = data.filter((d) => {
    const t = new Date(d.appointment.startTime);
    return t >= tomorrow && t < dayAfter;
  });

  const visible = data.slice(0, MAX_VISIBLE);
  const hidden = Math.max(0, data.length - MAX_VISIBLE);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-amber-600" aria-hidden="true" />
            Sessions needing auth
          </CardTitle>
          {data.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {urgent.length > 0 && (
                <span className="text-red-600 font-medium">{urgent.length} tomorrow</span>
              )}
              {urgent.length > 0 && data.length > urgent.length && ' · '}
              {data.length > urgent.length && <span>{data.length} this week</span>}
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
              All upcoming sessions in the next 7 days are covered by an active authorization. We'll
              flag any that aren't here and email you the night before.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((entry) => (
              <Link
                key={entry.appointment.id}
                href={`/patients?highlight=${entry.appointment.patientId}`}
                className="block p-2 rounded-md hover:bg-muted/50 transition-colors"
                data-testid={`auth-coverage-row-${entry.appointment.id}`}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{entry.patientName}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {reasonLabel(entry.reason)}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatWhen(entry.appointment.startTime)}
                      {entry.nearestAuth?.authorizationNumber && (
                        <>
                          {' · auth '}
                          <span className="font-mono">{entry.nearestAuth.authorizationNumber}</span>
                          {entry.reason === 'expired_by_date' && entry.nearestAuth.endDate && (
                            <> ended {formatDate(entry.nearestAuth.endDate)}</>
                          )}
                          {entry.reason === 'units_exhausted' && (
                            <>
                              {' '}
                              ({entry.nearestAuth.usedUnits}/{entry.nearestAuth.authorizedUnits} used)
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
            {hidden > 0 && (
              <Button variant="ghost" size="sm" asChild className="w-full">
                <Link href="/calendar">
                  +{hidden} more
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

function reasonLabel(r: AppointmentNeedingAuth['reason']): string {
  if (r === 'no_active_auth') return 'No auth on file';
  if (r === 'expired_by_date') return 'Auth expired';
  return 'Units exhausted';
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

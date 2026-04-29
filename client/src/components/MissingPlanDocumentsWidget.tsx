import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { FileQuestion, ArrowRight, CheckCircle2, Mail } from 'lucide-react';

/**
 * Practice-dashboard widget — patients with insurance on file but no
 * uploaded plan documents. Each one is a real revenue lift opportunity:
 * with parsed plan benefits + accumulators, the appeal generator and
 * cost estimator both produce dramatically better output.
 *
 * Sorted with eligibility-verified patients first (those are billed
 * patients, so they're the highest leverage to chase first).
 */

interface MissingPlanPatient {
  id: number;
  firstName: string;
  lastName: string;
  insuranceProvider: string | null;
  email: string | null;
  phone: string | null;
  hasEligibilityCheck: boolean;
}

interface MissingPlanResponse {
  count: number;
  patients: MissingPlanPatient[];
}

const MAX_VISIBLE = 5;

interface Props {
  practiceId: number;
}

export default function MissingPlanDocumentsWidget({ practiceId }: Props) {
  const { data, isLoading } = useQuery<MissingPlanResponse>({
    queryKey: ['/api/practices', practiceId, 'patients-missing-plan-documents'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/practices/${practiceId}/patients-missing-plan-documents`);
      return res.json();
    },
  });

  const patients = data?.patients ?? [];
  const verifiedCount = patients.filter((p) => p.hasEligibilityCheck).length;
  const visible = patients.slice(0, MAX_VISIBLE);
  const hidden = Math.max(0, patients.length - MAX_VISIBLE);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileQuestion className="w-5 h-5 text-amber-600" />
            Patients missing plan documents
          </CardTitle>
          {patients.length > 0 && (
            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
              {patients.length} to chase
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : patients.length === 0 ? (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            <span>
              All patients with insurance have plan documents on file. Appeal letters and cost
              estimates are using full plan data.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-2">
              These patients have insurance but no plan documents uploaded. Uploading their
              SBC unlocks accurate cost estimates and stronger appeal letters.
              {verifiedCount > 0 && (
                <span className="text-amber-700 font-medium"> {verifiedCount} have already been seen for billing — chase those first.</span>
              )}
            </p>
            {visible.map((p) => (
              <Link
                key={p.id}
                href={`/patients?highlight=${p.id}`}
                className="block p-2 rounded-md hover:bg-muted/50 transition-colors"
                data-testid={`missing-plan-row-${p.id}`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">
                        {p.firstName} {p.lastName}
                      </span>
                      {p.hasEligibilityCheck && (
                        <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">
                          Verified
                        </Badge>
                      )}
                      {p.insuranceProvider && (
                        <span className="text-xs text-muted-foreground">{p.insuranceProvider}</span>
                      )}
                    </div>
                    {p.email && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {p.email}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
            {hidden > 0 && (
              <Button variant="ghost" size="sm" asChild className="w-full">
                <Link href="/patients">
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

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { CheckCircle2, AlertTriangle, Search, RefreshCw, HelpCircle } from 'lucide-react';
import PageLayout from '@/components/PageLayout';

/**
 * Payer Mapping (onboarding) — turn the raw insurance names on patients into
 * verified Stedi payer IDs, with a human review/confirm step. Backed by the
 * resolvePracticePayer ladder; this page exposes scan → review → confirm.
 */

interface Mapping {
  id?: number;
  rawName: string;
  normalizedName?: string;
  stediPayerId: string | null;
  displayName: string | null;
  transactionSupport?: Record<string, string> | null;
  confidence?: string | number | null;
  source?: string | null;
  status?: string | null;
}

interface ScanRow {
  rawName: string;
  resolved: {
    stediPayerId: string | null;
    displayName: string | null;
    transactionSupport: Record<string, string> | null;
    confidence: number;
    source: string;
    needsReview: boolean;
  };
}

interface PayerSearchResult {
  payerId: string;
  displayName: string;
  operatingStates: string[];
  transactionSupport: Record<string, string>;
}

function supportBadge(value?: string) {
  if (!value) return null;
  const v = value.toUpperCase();
  const cls =
    v === 'SUPPORTED'
      ? 'bg-green-100 text-green-800'
      : v === 'ENROLLMENT_REQUIRED'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-slate-100 text-slate-600';
  const label = v === 'SUPPORTED' ? 'Live' : v === 'ENROLLMENT_REQUIRED' ? 'Needs enrollment' : 'No';
  return <Badge className={cls}>{label}</Badge>;
}

export default function PayerMappingPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [overrideFor, setOverrideFor] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<PayerSearchResult[]>([]);

  const { data, isLoading } = useQuery<{ mappings: Mapping[] }>({
    queryKey: ['/api/payer-mapping'],
    queryFn: async () => (await apiRequest('GET', '/api/payer-mapping')).json(),
  });

  const scanMutation = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/payer-mapping/scan', {})).json(),
    onSuccess: (r: { distinctPayers: number; matched: number; needsReview: number }) => {
      qc.invalidateQueries({ queryKey: ['/api/payer-mapping'] });
      toast({
        title: 'Scan complete',
        description: `${r.distinctPayers} payers found · ${r.matched} matched · ${r.needsReview} need review`,
      });
    },
    onError: (e: any) =>
      toast({ title: 'Scan failed', description: e?.message, variant: 'destructive' }),
  });

  const confirmMutation = useMutation({
    mutationFn: async (vars: { id: number; stediPayerId: string; displayName: string | null }) =>
      (await apiRequest('PUT', `/api/payer-mapping/${vars.id}`, {
        stediPayerId: vars.stediPayerId,
        displayName: vars.displayName,
      })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/payer-mapping'] });
      setOverrideFor(null);
      setSearchResults([]);
      setSearchTerm('');
      toast({ title: 'Payer confirmed' });
    },
    onError: (e: any) =>
      toast({ title: 'Could not confirm', description: e?.message, variant: 'destructive' }),
  });

  const searchMutation = useMutation({
    mutationFn: async (q: string) =>
      (await apiRequest('GET', `/api/payer-mapping/search?q=${encodeURIComponent(q)}`)).json(),
    onSuccess: (r: { results: PayerSearchResult[] }) => setSearchResults(r.results || []),
    onError: () => setSearchResults([]),
  });

  const mappings = data?.mappings ?? [];
  const confirmed = mappings.filter((m) => m.status === 'confirmed').length;
  const needsReview = mappings.filter((m) => !m.stediPayerId || m.status === 'auto').length;

  return (
    <PageLayout
      title="Payer Mapping"
      description="Match the insurance names on your patients to verified Stedi payer IDs so eligibility and claims route correctly."
      isLoading={isLoading}
    >
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {needsReview === 0 && mappings.length > 0 ? (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            )}
            {mappings.length === 0
              ? 'No payers mapped yet'
              : `${confirmed} confirmed · ${needsReview} need review`}
          </CardTitle>
          <CardDescription>
            Scan pulls every distinct insurance name off your patients and resolves each to a Stedi
            payer ID (cache → known payers → live Stedi search). Review the matches, then confirm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
            <RefreshCw className={`w-4 h-4 mr-2 ${scanMutation.isPending ? 'animate-spin' : ''}`} />
            {scanMutation.isPending ? 'Scanning…' : 'Scan my payers'}
          </Button>
        </CardContent>
      </Card>

      {mappings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {mappings.map((m) => {
              const ts = m.transactionSupport || {};
              const isUnmatched = !m.stediPayerId;
              return (
                <div key={m.id ?? m.rawName} className="border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium">{m.rawName}</div>
                      <div className="text-sm text-muted-foreground">
                        {isUnmatched ? (
                          <span className="text-amber-700">No confident match — pick one below</span>
                        ) : (
                          <>
                            → {m.displayName || 'Unknown'}{' '}
                            <span className="font-mono">({m.stediPayerId})</span>
                          </>
                        )}
                      </div>
                      {!isUnmatched && (
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          <span className="text-muted-foreground">Eligibility</span>
                          {supportBadge(ts.eligibilityCheck)}
                          <span className="text-muted-foreground ml-2">Claims</span>
                          {supportBadge(ts.professionalClaimSubmission)}
                          <span className="text-muted-foreground ml-2">ERA</span>
                          {supportBadge(ts.claimPayment)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {m.status === 'confirmed' ? (
                        <Badge className="bg-green-100 text-green-800">Confirmed</Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800">
                          {isUnmatched ? 'Unmatched' : 'Auto'}
                        </Badge>
                      )}
                      {!isUnmatched && m.status !== 'confirmed' && m.id && (
                        <Button
                          size="sm"
                          onClick={() =>
                            confirmMutation.mutate({
                              id: m.id!,
                              stediPayerId: m.stediPayerId!,
                              displayName: m.displayName,
                            })
                          }
                          disabled={confirmMutation.isPending}
                        >
                          Confirm
                        </Button>
                      )}
                      {m.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setOverrideFor(overrideFor === m.id ? null : m.id!);
                            setSearchTerm(m.rawName);
                            setSearchResults([]);
                          }}
                        >
                          {isUnmatched ? 'Find payer' : 'Override'}
                        </Button>
                      )}
                    </div>
                  </div>

                  {overrideFor === m.id && (
                    <div className="mt-3 border-t pt-3">
                      <div className="flex gap-2">
                        <Input
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Search Stedi payer network (e.g. 'Horizon BCBS NJ')"
                          onKeyDown={(e) => e.key === 'Enter' && searchMutation.mutate(searchTerm)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => searchMutation.mutate(searchTerm)}
                          disabled={!searchTerm || searchMutation.isPending}
                        >
                          <Search className="w-4 h-4 mr-1" /> Search
                        </Button>
                      </div>
                      <div className="mt-2 space-y-1">
                        {searchResults.map((r) => (
                          <div
                            key={r.payerId}
                            className="flex items-center justify-between gap-2 text-sm p-2 rounded hover:bg-slate-50"
                          >
                            <div>
                              <span className="font-medium">{r.displayName}</span>{' '}
                              <span className="font-mono text-muted-foreground">({r.payerId})</span>
                              {r.operatingStates?.length > 0 && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  {r.operatingStates.slice(0, 4).join(', ')}
                                </span>
                              )}
                            </div>
                            <Button
                              size="sm"
                              onClick={() =>
                                confirmMutation.mutate({
                                  id: m.id!,
                                  stediPayerId: r.payerId,
                                  displayName: r.displayName,
                                })
                              }
                              disabled={confirmMutation.isPending}
                            >
                              Use this
                            </Button>
                          </div>
                        ))}
                        {searchMutation.isPending && (
                          <div className="text-xs text-muted-foreground">Searching…</div>
                        )}
                        {!searchMutation.isPending &&
                          searchResults.length === 0 &&
                          searchMutation.isSuccess && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <HelpCircle className="w-3 h-3" /> No payers found — try a different name.
                            </div>
                          )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </PageLayout>
  );
}

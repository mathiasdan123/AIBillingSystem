import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import {
  FileCheck2,
  Plus,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Hourglass,
  Sparkles,
  Upload,
  Loader2,
  Copy,
} from 'lucide-react';

/**
 * Prior Authorizations Section (Phase 1 PA tracking UI).
 *
 * Renders a list of prior authorizations for a single patient, with quick
 * status signals: remaining units + expiry countdown. Billers log PA records
 * captured by phone/fax/portal (since Stedi 278 automation is still
 * upcoming). Claims can later auto-pull a matching active auth when billing
 * — that wire-up is a follow-up.
 *
 * Backend contract:
 *   GET    /api/treatment-authorizations?patientId=:id
 *   POST   /api/treatment-authorizations
 *   PATCH  /api/treatment-authorizations/:id
 * Schema fields used: authorizationNumber, authorizedUnits, usedUnits,
 *   startDate, endDate, status, cptCode, diagnosisCode, notes.
 */

interface AtRiskEntry {
  auth: { id: number };
  patientName: string;
  predictedEndDate: string;
  daysUntilPredictedEnd: number;
  reason: 'expiring' | 'exhausting' | 'both';
  sessionsPerWeek: number | null;
  projectedSessionsRemaining: number | null;
}

interface Authorization {
  id: number;
  practiceId: number;
  patientId: number;
  insuranceId: number | null;
  authorizationNumber: string | null;
  diagnosisCode: string | null;
  cptCode: string | null;
  authorizedUnits: number;
  usedUnits: number;
  startDate: string;
  endDate: string;
  status: 'active' | 'pending' | 'expired' | 'exhausted' | 'denied';
  approvedDate: string | null;
  deniedReason: string | null;
  notes: string | null;
}

interface PriorAuthorizationsSectionProps {
  patientId: number;
}

export default function PriorAuthorizationsSection({
  patientId,
}: PriorAuthorizationsSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    authorizationNumber: '',
    cptCode: '',
    diagnosisCode: '',
    authorizedUnits: '',
    startDate: '',
    endDate: '',
    status: 'active' as Authorization['status'],
    notes: '',
  });

  // AI PA Assistant state — draft letter + scan approval document.
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftForm, setDraftForm] = useState({
    cptCode: '',
    diagnosisCode: '',
    requestedUnits: '',
    frequency: '',
    requestedStartDate: '',
    requestedEndDate: '',
  });
  const [draftResult, setDraftResult] = useState<{
    letter: string;
    subject: string;
    medicalNecessitySummary: string;
  } | null>(null);
  const [scanInputRef] = useState(() => ({ current: null as HTMLInputElement | null }));
  const [scanning, setScanning] = useState(false);

  const { data: auths = [], isLoading } = useQuery<Authorization[]>({
    queryKey: [`/api/treatment-authorizations?patientId=${patientId}`],
    queryFn: async () => {
      const res = await apiRequest(
        'GET',
        `/api/treatment-authorizations?patientId=${patientId}`
      );
      return res.json();
    },
    enabled: !!patientId,
  });

  // Pace-based at-risk predictions (expiry-date + projected unit exhaustion
  // based on sessions/week for this patient). Scoped to the practice, so
  // we filter client-side to entries matching our patient's auths.
  const { data: atRiskList = [] } = useQuery<AtRiskEntry[]>({
    queryKey: ['/api/treatment-authorizations/at-risk'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/treatment-authorizations/at-risk?daysAhead=60');
      return res.json();
    },
  });
  const atRiskById = useMemo(() => {
    const m = new Map<number, AtRiskEntry>();
    for (const e of atRiskList) m.set(e.auth.id, e);
    return m;
  }, [atRiskList]);

  const draftMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest('POST', '/api/treatment-authorizations/draft-request', body);
      return res.json();
    },
    onSuccess: (data) => {
      setDraftResult({
        letter: data.letter ?? '',
        subject: data.subject ?? '',
        medicalNecessitySummary: data.medicalNecessitySummary ?? '',
      });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't draft letter",
        description: err?.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (imageBase64: string) => {
      const res = await apiRequest('POST', '/api/treatment-authorizations/parse-document', {
        image: imageBase64,
      });
      return res.json();
    },
    onSuccess: (data) => {
      // Merge extracted fields into the Add Authorization form for review.
      setForm((prev) => ({
        ...prev,
        authorizationNumber: data.authorizationNumber ?? prev.authorizationNumber,
        cptCode: data.cptCode ?? prev.cptCode,
        diagnosisCode: data.diagnosisCode ?? prev.diagnosisCode,
        authorizedUnits: data.authorizedUnits != null ? String(data.authorizedUnits) : prev.authorizedUnits,
        startDate: data.startDate ?? prev.startDate,
        endDate: data.endDate ?? prev.endDate,
        notes: data.notes
          ? prev.notes
            ? `${prev.notes}\n---\n${data.notes}`
            : data.notes
          : prev.notes,
      }));
      setScanning(false);
      setAddOpen(true);
      toast({
        title: 'Document parsed',
        description: data.extractionNotes || 'Review the fields and save when ready.',
      });
    },
    onError: (err: any) => {
      setScanning(false);
      toast({
        title: "Couldn't read document",
        description: err?.message || 'Try a clearer scan.',
        variant: 'destructive',
      });
    },
  });

  const handleScanFile = (file: File) => {
    setScanning(true);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        setScanning(false);
        return;
      }
      scanMutation.mutate(result);
    };
    reader.onerror = () => {
      setScanning(false);
      toast({ title: "Couldn't read file", variant: 'destructive' });
    };
    reader.readAsDataURL(file);
  };

  const createMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest('POST', '/api/treatment-authorizations', body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/treatment-authorizations?patientId=${patientId}`],
      });
      toast({ title: 'Authorization added', description: 'Saved to this patient.' });
      setAddOpen(false);
      setForm({
        authorizationNumber: '',
        cptCode: '',
        diagnosisCode: '',
        authorizedUnits: '',
        startDate: '',
        endDate: '',
        status: 'active',
        notes: '',
      });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't save",
        description: err?.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const grouped = useMemo(() => {
    const active: Authorization[] = [];
    const pending: Authorization[] = [];
    const inactive: Authorization[] = [];
    for (const a of auths) {
      if (a.status === 'active') active.push(a);
      else if (a.status === 'pending') pending.push(a);
      else inactive.push(a);
    }
    return { active, pending, inactive };
  }, [auths]);

  const handleSubmit = () => {
    const units = parseInt(form.authorizedUnits, 10);
    if (!form.authorizationNumber.trim() || !form.startDate || !form.endDate || !units || units < 1) {
      toast({
        title: 'Missing required fields',
        description: 'Auth number, start, end, and units are required.',
        variant: 'destructive',
      });
      return;
    }
    createMutation.mutate({
      patientId,
      authorizationNumber: form.authorizationNumber.trim(),
      cptCode: form.cptCode.trim() || null,
      diagnosisCode: form.diagnosisCode.trim() || null,
      authorizedUnits: units,
      startDate: form.startDate,
      endDate: form.endDate,
      status: form.status,
      notes: form.notes.trim() || null,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-blue-600" aria-hidden="true" />
            Prior Authorizations
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <input
              ref={(el) => {
                scanInputRef.current = el;
              }}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleScanFile(file);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => scanInputRef.current?.click()}
              disabled={scanning || scanMutation.isPending}
              data-testid="button-scan-auth-doc"
              title="Upload a PA approval letter — AI reads it and fills the form"
            >
              {scanning || scanMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-1" />
              )}
              Scan Approval
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraftOpen(true)}
              data-testid="button-draft-pa-letter"
              title="AI drafts a PA request letter using this patient's clinical history"
            >
              <Sparkles className="w-4 h-4 mr-1 text-purple-600" />
              Draft PA Request
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(true)}
              data-testid="button-add-authorization"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Manually
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : auths.length === 0 ? (
          <div className="text-center py-6">
            <FileCheck2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No prior authorizations on file for this patient.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Add one after getting approval from the payer. Claims will auto-pull it when you bill
              matching CPTs.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.active.length > 0 && (
              <AuthGroup title="Active" auths={grouped.active} atRiskById={atRiskById} />
            )}
            {grouped.pending.length > 0 && (
              <AuthGroup title="Pending" auths={grouped.pending} atRiskById={atRiskById} />
            )}
            {grouped.inactive.length > 0 && (
              <AuthGroup title="Expired / Exhausted / Denied" auths={grouped.inactive} dim atRiskById={atRiskById} />
            )}
          </div>
        )}
      </CardContent>

      {/* Draft PA Request Dialog — AI-generated letter */}
      <Dialog
        open={draftOpen}
        onOpenChange={(open) => {
          setDraftOpen(open);
          if (!open) setDraftResult(null);
        }}
      >
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              Draft PA Request Letter
            </DialogTitle>
            <DialogDescription>
              AI drafts a formal prior authorization request using this patient's clinical history
              and your practice info. Review, tweak, and export — or paste into the payer's portal.
            </DialogDescription>
          </DialogHeader>

          {!draftResult ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="draft-cpt">CPT Code *</Label>
                  <Input
                    id="draft-cpt"
                    value={draftForm.cptCode}
                    onChange={(e) => setDraftForm({ ...draftForm, cptCode: e.target.value })}
                    placeholder="97530"
                  />
                </div>
                <div>
                  <Label htmlFor="draft-icd">Diagnosis *</Label>
                  <Input
                    id="draft-icd"
                    value={draftForm.diagnosisCode}
                    onChange={(e) => setDraftForm({ ...draftForm, diagnosisCode: e.target.value })}
                    placeholder="F84.0"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="draft-units">Requested Units *</Label>
                  <Input
                    id="draft-units"
                    type="number"
                    min={1}
                    value={draftForm.requestedUnits}
                    onChange={(e) => setDraftForm({ ...draftForm, requestedUnits: e.target.value })}
                    placeholder="24"
                  />
                </div>
                <div>
                  <Label htmlFor="draft-freq">Frequency (optional)</Label>
                  <Input
                    id="draft-freq"
                    value={draftForm.frequency}
                    onChange={(e) => setDraftForm({ ...draftForm, frequency: e.target.value })}
                    placeholder="2x/week"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="draft-start">Requested Start</Label>
                  <Input
                    id="draft-start"
                    type="date"
                    value={draftForm.requestedStartDate}
                    onChange={(e) =>
                      setDraftForm({ ...draftForm, requestedStartDate: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="draft-end">Requested End</Label>
                  <Input
                    id="draft-end"
                    type="date"
                    value={draftForm.requestedEndDate}
                    onChange={(e) =>
                      setDraftForm({ ...draftForm, requestedEndDate: e.target.value })
                    }
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                AI will use this patient's latest SOAP note for medical necessity language. If there
                aren't any SOAP notes yet, the letter drafts defensively without clinical specifics.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-md bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-100">
                <strong>Summary:</strong> {draftResult.medicalNecessitySummary}
              </div>
              <div>
                <Label>Suggested Subject</Label>
                <Input value={draftResult.subject} readOnly />
              </div>
              <div>
                <Label>Letter</Label>
                <Textarea
                  value={draftResult.letter}
                  onChange={(e) =>
                    setDraftResult({ ...draftResult, letter: e.target.value })
                  }
                  rows={18}
                  className="font-mono text-xs"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Review the letter before sending. AI drafts are a starting point — verify clinical
                details, dates, and recipient info.
              </p>
            </div>
          )}

          <DialogFooter>
            {!draftResult ? (
              <>
                <Button variant="outline" onClick={() => setDraftOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    const units = parseInt(draftForm.requestedUnits, 10);
                    if (!draftForm.cptCode || !draftForm.diagnosisCode || !units || units < 1) {
                      toast({
                        title: 'Missing required fields',
                        description: 'CPT, diagnosis, and units are required.',
                        variant: 'destructive',
                      });
                      return;
                    }
                    draftMutation.mutate({
                      patientId,
                      cptCode: draftForm.cptCode.trim(),
                      diagnosisCode: draftForm.diagnosisCode.trim(),
                      requestedUnits: units,
                      frequency: draftForm.frequency.trim() || null,
                      requestedStartDate: draftForm.requestedStartDate || null,
                      requestedEndDate: draftForm.requestedEndDate || null,
                    });
                  }}
                  disabled={draftMutation.isPending}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  data-testid="button-generate-pa-letter"
                >
                  {draftMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      Drafting…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-1" />
                      Generate with AI
                    </>
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setDraftResult(null)}>
                  Start Over
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(draftResult.letter);
                    toast({ title: 'Letter copied to clipboard' });
                  }}
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Copy
                </Button>
                <Button
                  onClick={async () => {
                    // Render server-side as a properly typeset PDF with
                    // practice letterhead, recipient block, signature line,
                    // etc. Falls back to plain-text download if the PDF
                    // endpoint errors so the biller is never stuck.
                    try {
                      const res = await fetch('/api/treatment-authorizations/render-letter-pdf', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                          letter: draftResult.letter,
                          subject: draftResult.subject,
                        }),
                      });
                      if (!res.ok) throw new Error('PDF render failed');
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `pa-request-${Date.now()}.pdf`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch {
                      // Fallback: plain text. Biller can still print / fax.
                      const blob = new Blob([draftResult.letter], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `pa-request-${Date.now()}.txt`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      toast({
                        title: 'PDF render failed',
                        description: 'Downloaded as plain text instead.',
                      });
                    }
                  }}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  Download PDF
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Authorization Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Add Prior Authorization</DialogTitle>
            <DialogDescription>
              Log an authorization you received from the payer. Claims for matching CPTs will pull
              this record automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="auth-number">Authorization Number *</Label>
              <Input
                id="auth-number"
                value={form.authorizationNumber}
                onChange={(e) => setForm({ ...form, authorizationNumber: e.target.value })}
                placeholder="e.g. AUTH-12345"
                data-testid="input-auth-number"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="auth-cpt">CPT Code</Label>
                <Input
                  id="auth-cpt"
                  value={form.cptCode}
                  onChange={(e) => setForm({ ...form, cptCode: e.target.value })}
                  placeholder="97530"
                />
              </div>
              <div>
                <Label htmlFor="auth-icd">Diagnosis (ICD-10)</Label>
                <Input
                  id="auth-icd"
                  value={form.diagnosisCode}
                  onChange={(e) => setForm({ ...form, diagnosisCode: e.target.value })}
                  placeholder="F84.0"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="auth-units">Authorized Units *</Label>
                <Input
                  id="auth-units"
                  type="number"
                  min={1}
                  value={form.authorizedUnits}
                  onChange={(e) => setForm({ ...form, authorizedUnits: e.target.value })}
                  placeholder="20"
                />
              </div>
              <div>
                <Label htmlFor="auth-start">Start Date *</Label>
                <Input
                  id="auth-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="auth-end">End Date *</Label>
                <Input
                  id="auth-end"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="auth-notes">Notes (optional)</Label>
              <Textarea
                id="auth-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Approved for OT only; peer-to-peer review completed 4/22"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-save-authorization"
            >
              {createMutation.isPending ? 'Saving…' : 'Save Authorization'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Inner rendering helpers ────────────────────────────────────────────

function AuthGroup({
  title,
  auths,
  atRiskById,
  dim = false,
}: {
  title: string;
  auths: Authorization[];
  atRiskById: Map<number, AtRiskEntry>;
  dim?: boolean;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title} ({auths.length})
      </h4>
      <div className={`space-y-2 ${dim ? 'opacity-70' : ''}`}>
        {auths.map((a) => (
          <AuthRow key={a.id} auth={a} atRisk={atRiskById.get(a.id)} />
        ))}
      </div>
    </div>
  );
}

function AuthRow({ auth, atRisk }: { auth: Authorization; atRisk?: AtRiskEntry }) {
  const remaining = Math.max(0, auth.authorizedUnits - auth.usedUnits);
  const utilizationPct = auth.authorizedUnits > 0
    ? Math.min(100, Math.round((auth.usedUnits / auth.authorizedUnits) * 100))
    : 0;
  const nearExhaustion = auth.status === 'active' && utilizationPct >= 80;
  const daysUntilExpiry = daysUntil(auth.endDate);
  const expiringSoon = auth.status === 'active' && daysUntilExpiry >= 0 && daysUntilExpiry <= 14;

  return (
    <div className="p-3 border rounded-lg bg-card" data-testid={`auth-row-${auth.id}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-medium text-sm">
              {auth.authorizationNumber || '(no auth number)'}
            </span>
            <StatusBadge status={auth.status} />
            {nearExhaustion && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {utilizationPct}% used
              </Badge>
            )}
            {expiringSoon && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                <Clock className="w-3 h-3 mr-1" />
                Expires in {daysUntilExpiry}d
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {auth.cptCode && <span>CPT: <span className="font-mono">{auth.cptCode}</span></span>}
            {auth.diagnosisCode && <span>Dx: <span className="font-mono">{auth.diagnosisCode}</span></span>}
            <span>Valid: {formatDate(auth.startDate)} – {formatDate(auth.endDate)}</span>
          </div>
        </div>
      </div>

      {/* Units utilization */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {auth.usedUnits} / {auth.authorizedUnits} units used
          </span>
          <span className={remaining <= 3 ? 'text-amber-600 font-medium' : 'text-muted-foreground'}>
            {remaining} remaining
          </span>
        </div>
        <Progress
          value={utilizationPct}
          className={`h-1.5 ${utilizationPct >= 80 ? '[&>div]:bg-amber-500' : ''}`}
        />
      </div>

      {/* AI forecast (session-cadence + expiry-date combined) */}
      {atRisk && (
        <div className="mt-2 p-2 rounded bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 flex items-start gap-2">
          <Sparkles className="w-3.5 h-3.5 text-purple-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="text-xs text-purple-900 dark:text-purple-100 flex-1">
            <span className="font-medium">AI forecast:</span>{' '}
            {atRisk.reason === 'exhausting' ? (
              <>
                At current pace of{' '}
                <span className="font-mono">{atRisk.sessionsPerWeek?.toFixed(1)}</span> sessions/week,
                this auth runs out of units around <strong>{formatDate(atRisk.predictedEndDate)}</strong>{' '}
                — <strong>{atRisk.daysUntilPredictedEnd} days away</strong>. Request renewal now.
              </>
            ) : atRisk.reason === 'expiring' ? (
              <>
                Expires on <strong>{formatDate(atRisk.predictedEndDate)}</strong>{' '}
                ({atRisk.daysUntilPredictedEnd} days). Request renewal before then.
              </>
            ) : (
              <>
                Expires <strong>{formatDate(atRisk.predictedEndDate)}</strong> AND projected to
                run out of units at{' '}
                <span className="font-mono">{atRisk.sessionsPerWeek?.toFixed(1)}</span>/week pace.{' '}
                <strong>{atRisk.daysUntilPredictedEnd} days</strong>. Request renewal now.
              </>
            )}
          </div>
        </div>
      )}

      {auth.notes && (
        <p className="text-xs text-muted-foreground mt-2 italic">{auth.notes}</p>
      )}
      {auth.status === 'denied' && auth.deniedReason && (
        <p className="text-xs text-red-600 mt-2">Denied: {auth.deniedReason}</p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Authorization['status'] }) {
  const config: Record<Authorization['status'], { label: string; className: string; Icon: typeof CheckCircle }> = {
    active: { label: 'Active', className: 'bg-green-100 text-green-800 border-green-200', Icon: CheckCircle },
    pending: { label: 'Pending', className: 'bg-blue-100 text-blue-800 border-blue-200', Icon: Hourglass },
    expired: { label: 'Expired', className: 'bg-slate-100 text-slate-700 border-slate-200', Icon: Clock },
    exhausted: { label: 'Exhausted', className: 'bg-amber-100 text-amber-800 border-amber-200', Icon: AlertTriangle },
    denied: { label: 'Denied', className: 'bg-red-100 text-red-800 border-red-200', Icon: XCircle },
  };
  const { label, className, Icon } = config[status];
  return (
    <Badge variant="outline" className={className}>
      <Icon className="w-3 h-3 mr-1" />
      {label}
    </Badge>
  );
}

function daysUntil(dateStr: string): number {
  if (!dateStr) return Infinity;
  const end = new Date(dateStr);
  const now = new Date();
  return Math.floor((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

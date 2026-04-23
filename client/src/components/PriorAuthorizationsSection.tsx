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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddOpen(true)}
            data-testid="button-add-authorization"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Authorization
          </Button>
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
              <AuthGroup title="Active" auths={grouped.active} />
            )}
            {grouped.pending.length > 0 && (
              <AuthGroup title="Pending" auths={grouped.pending} />
            )}
            {grouped.inactive.length > 0 && (
              <AuthGroup title="Expired / Exhausted / Denied" auths={grouped.inactive} dim />
            )}
          </div>
        )}
      </CardContent>

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
  dim = false,
}: {
  title: string;
  auths: Authorization[];
  dim?: boolean;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title} ({auths.length})
      </h4>
      <div className={`space-y-2 ${dim ? 'opacity-70' : ''}`}>
        {auths.map((a) => (
          <AuthRow key={a.id} auth={a} />
        ))}
      </div>
    </div>
  );
}

function AuthRow({ auth }: { auth: Authorization }) {
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

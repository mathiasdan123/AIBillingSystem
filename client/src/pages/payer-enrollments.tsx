import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Minus,
  Handshake,
  Info,
} from 'lucide-react';

/**
 * Payer Enrollments page (Slice C).
 *
 * Shows every known payer with this practice's enrollment status for each
 * EDI transaction type (eligibility, claims, ERA). Practices need
 * approval from each payer before transactions for that payer will flow
 * — this page makes the "which payers are we actually live with today"
 * question answerable in one glance instead of discovering it via silent
 * claim rejections.
 *
 * Status lifecycle per (payer, transaction):
 *   not_enrolled → pending → enrolled
 *                         ↘ rejected (with reason)
 *
 * Click any cell to change status or add notes.
 */

type EnrollmentStatus = 'not_enrolled' | 'pending' | 'enrolled' | 'rejected';
type TransactionType = 'eligibility' | 'claims' | 'era';

interface EnrollmentCell {
  id: number | null;
  transactionType: TransactionType;
  status: EnrollmentStatus;
  requiresEnrollment: boolean;
  requestedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
}

interface PayerRow {
  name: string;
  payerId: string;
  enrollments: EnrollmentCell[];
}

const TX_LABELS: Record<TransactionType, string> = {
  eligibility: 'Eligibility (270/271)',
  claims: 'Claims (837P)',
  era: 'ERA (835)',
};

export default function PayerEnrollmentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{
    payerName: string;
    payerId: string;
    cell: EnrollmentCell;
  } | null>(null);
  const [form, setForm] = useState({
    status: 'not_enrolled' as EnrollmentStatus,
    notes: '',
    rejectionReason: '',
  });

  const { data: rows = [], isLoading } = useQuery<PayerRow[]>({
    queryKey: ['/api/payer-enrollments'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/payer-enrollments');
      return res.json();
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (body: {
      payerName: string;
      payerId: string;
      transactionType: TransactionType;
      status: EnrollmentStatus;
      notes?: string;
      rejectionReason?: string;
    }) => {
      const res = await apiRequest('POST', '/api/payer-enrollments', body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payer-enrollments'] });
      toast({ title: 'Enrollment updated' });
      setEditing(null);
    },
    onError: () => {
      toast({
        title: 'Failed to save',
        description: 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const openEdit = (payerName: string, payerId: string, cell: EnrollmentCell) => {
    setEditing({ payerName, payerId, cell });
    setForm({
      status: cell.status,
      notes: cell.notes ?? '',
      rejectionReason: cell.rejectionReason ?? '',
    });
  };

  // Summary counts across the top of the page.
  const totals = { enrolled: 0, pending: 0, rejected: 0, not_enrolled: 0 };
  let needsEnrollmentRemaining = 0;
  for (const row of rows) {
    for (const c of row.enrollments) {
      totals[c.status]++;
      if (c.requiresEnrollment && c.status === 'not_enrolled') {
        needsEnrollmentRemaining++;
      }
    }
  }

  return (
    <div className="container max-w-6xl mx-auto py-6 px-4 md:py-8 md:px-6">
      <div className="flex items-start gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
          <Handshake className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Payer Enrollments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track which payers you can submit to today. Some payers require separate enrollment
            approval per transaction type (eligibility checks, claims, or electronic remits).
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Enrolled" value={totals.enrolled} tone="success" />
        <SummaryCard label="Pending" value={totals.pending} tone="info" />
        <SummaryCard label="Rejected" value={totals.rejected} tone="danger" />
        <SummaryCard label="Not started" value={totals.not_enrolled} tone="muted" />
      </div>

      {needsEnrollmentRemaining > 0 && (
        <div className="mb-4 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-100 flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <span>
            <strong>{needsEnrollmentRemaining}</strong> transaction(s) across payers that require
            enrollment are still marked "not started." Claims or ERAs for those payers may be
            silently rejected until enrollment completes (typically 2-6 weeks after submission).
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payer Status</CardTitle>
          <CardDescription>
            Click any cell to update status, add notes, or record a rejection reason.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Payer</th>
                    {(['eligibility', 'claims', 'era'] as TransactionType[]).map((tx) => (
                      <th key={tx} className="px-4 py-2 font-medium">
                        {TX_LABELS[tx]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{row.payerId}</div>
                      </td>
                      {row.enrollments.map((cell) => (
                        <td key={cell.transactionType} className="px-4 py-3">
                          <button
                            onClick={() => openEdit(row.name, row.payerId, cell)}
                            className="w-full text-left"
                            data-testid={`cell-${row.name}-${cell.transactionType}`}
                          >
                            <StatusPill status={cell.status} />
                            {cell.requiresEnrollment && cell.status === 'not_enrolled' && (
                              <div className="text-[10px] text-amber-600 mt-0.5">
                                Enrollment required
                              </div>
                            )}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editing?.payerName} — {editing && TX_LABELS[editing.cell.transactionType]}
            </DialogTitle>
            <DialogDescription>
              Update enrollment status for this transaction type.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as EnrollmentStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_enrolled">Not enrolled</SelectItem>
                  <SelectItem value="pending">Pending (submitted to payer)</SelectItem>
                  <SelectItem value="enrolled">Enrolled (approved)</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.status === 'rejected' && (
              <div>
                <Label htmlFor="rejection-reason">Rejection reason</Label>
                <Input
                  id="rejection-reason"
                  value={form.rejectionReason}
                  onChange={(e) => setForm({ ...form, rejectionReason: e.target.value })}
                  placeholder="e.g. Missing signed EDI agreement"
                />
              </div>
            )}
            <div>
              <Label htmlFor="enrollment-notes">Notes (optional)</Label>
              <Textarea
                id="enrollment-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Form submitted 4/15, 2-4 week approval expected"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editing) return;
                upsertMutation.mutate({
                  payerName: editing.payerName,
                  payerId: editing.payerId,
                  transactionType: editing.cell.transactionType,
                  status: form.status,
                  notes: form.notes || undefined,
                  rejectionReason: form.rejectionReason || undefined,
                });
              }}
              disabled={upsertMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {upsertMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'info' | 'danger' | 'muted';
}) {
  const tones = {
    success: 'bg-green-50 text-green-900 border-green-200 dark:bg-green-900/20 dark:text-green-100 dark:border-green-800',
    info: 'bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-900/20 dark:text-blue-100 dark:border-blue-800',
    danger: 'bg-red-50 text-red-900 border-red-200 dark:bg-red-900/20 dark:text-red-100 dark:border-red-800',
    muted: 'bg-slate-50 text-slate-900 border-slate-200 dark:bg-slate-900/20 dark:text-slate-100 dark:border-slate-800',
  }[tone];
  return (
    <div className={`p-3 rounded-lg border ${tones}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: EnrollmentStatus }) {
  const config: Record<EnrollmentStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
    enrolled: { label: 'Enrolled', className: 'bg-green-100 text-green-800 border-green-200', Icon: CheckCircle2 },
    pending: { label: 'Pending', className: 'bg-blue-100 text-blue-800 border-blue-200', Icon: Clock },
    rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800 border-red-200', Icon: XCircle },
    not_enrolled: { label: 'Not enrolled', className: 'bg-slate-100 text-slate-600 border-slate-200', Icon: Minus },
  };
  const { label, className, Icon } = config[status];
  return (
    <Badge variant="outline" className={className}>
      <Icon className="w-3 h-3 mr-1" />
      {label}
    </Badge>
  );
}

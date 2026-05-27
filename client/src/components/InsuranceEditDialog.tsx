/**
 * InsuranceEditDialog
 *
 * Reusable edit form for a patient's primary + secondary insurance,
 * including the effective / termination dates added in the patient-insurance
 * migration. Used from:
 *   - Patient detail page ("Edit insurance" button next to the Insurance Information section)
 *   - Claim-submit scrub-error dialog ("Fix insurance" shortcut so users can
 *     resolve missing-insurance failures without leaving the claim)
 *   - Calendar inline new-patient form (collects insurance at scheduling
 *     time so the patient is claim-ready from minute one)
 *
 * Backed by PATCH /api/patients/:id/insurance, which only accepts the
 * insurance-related field allowlist.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield } from 'lucide-react';

export interface InsuranceFields {
  insuranceProvider?: string | null;
  insuranceId?: string | null;
  policyNumber?: string | null;
  groupNumber?: string | null;
  effectiveDate?: string | null;
  terminationDate?: string | null;
  secondaryInsuranceProvider?: string | null;
  secondaryInsuranceMemberId?: string | null;
  secondaryInsurancePolicyNumber?: string | null;
  secondaryInsuranceGroupNumber?: string | null;
  secondaryInsuranceRelationship?: string | null;
  secondaryInsuranceSubscriberName?: string | null;
  secondaryInsuranceSubscriberDob?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: number;
  patientName?: string;
  initialValues: InsuranceFields;
  /** Optional: invoked after a successful save (e.g. retry claim submit). */
  onSaved?: (updated: InsuranceFields) => void;
}

const EMPTY: InsuranceFields = {
  insuranceProvider: '',
  insuranceId: '',
  policyNumber: '',
  groupNumber: '',
  effectiveDate: '',
  terminationDate: '',
  secondaryInsuranceProvider: '',
  secondaryInsuranceMemberId: '',
  secondaryInsurancePolicyNumber: '',
  secondaryInsuranceGroupNumber: '',
  secondaryInsuranceRelationship: '',
  secondaryInsuranceSubscriberName: '',
  secondaryInsuranceSubscriberDob: '',
};

export default function InsuranceEditDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  initialValues,
  onSaved,
}: Props) {
  const [form, setForm] = useState<InsuranceFields>({ ...EMPTY, ...nullsToEmpty(initialValues) });
  const [showSecondary, setShowSecondary] = useState(!!initialValues.secondaryInsuranceProvider);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Re-hydrate the form when the dialog is reopened for a different patient.
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, ...nullsToEmpty(initialValues) });
      setShowSecondary(!!initialValues.secondaryInsuranceProvider);
    }
  }, [open, initialValues]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/patients/${patientId}/insurance`, form);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['/api/patients'] });
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}`] });
      toast({ title: 'Insurance updated' });
      onSaved?.(updated);
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Could not update insurance',
        description: err?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const set = (k: keyof InsuranceFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" /> Edit Insurance
            {patientName && <span className="text-muted-foreground font-normal">· {patientName}</span>}
          </DialogTitle>
          <DialogDescription>
            Updates the patient's insurance on file. Required for clean claim submission.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <section className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Primary Insurance</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider" id="ip">
                <Input id="ip" value={form.insuranceProvider ?? ''} onChange={set('insuranceProvider')} data-testid="input-insurance-provider" />
              </Field>
              <Field label="Member ID" id="im">
                <Input id="im" value={form.insuranceId ?? ''} onChange={set('insuranceId')} data-testid="input-insurance-id" />
              </Field>
              <Field label="Policy Number" id="ipn">
                <Input id="ipn" value={form.policyNumber ?? ''} onChange={set('policyNumber')} data-testid="input-policy-number" />
              </Field>
              <Field label="Group Number" id="ig">
                <Input id="ig" value={form.groupNumber ?? ''} onChange={set('groupNumber')} data-testid="input-group-number" />
              </Field>
              <Field label="Effective Date" id="ied">
                <Input id="ied" type="date" value={form.effectiveDate ?? ''} onChange={set('effectiveDate')} data-testid="input-effective-date" />
              </Field>
              <Field label="Termination Date" id="itd" hint="Leave blank if open-ended.">
                <Input id="itd" type="date" value={form.terminationDate ?? ''} onChange={set('terminationDate')} data-testid="input-termination-date" />
              </Field>
            </div>
          </section>

          {!showSecondary && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowSecondary(true)}
              data-testid="button-add-secondary-insurance"
            >
              + Add secondary insurance
            </Button>
          )}

          {showSecondary && (
            <section className="space-y-3 border-t pt-4">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Secondary Insurance</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Provider" id="sip">
                  <Input id="sip" value={form.secondaryInsuranceProvider ?? ''} onChange={set('secondaryInsuranceProvider')} />
                </Field>
                <Field label="Member ID" id="sim">
                  <Input id="sim" value={form.secondaryInsuranceMemberId ?? ''} onChange={set('secondaryInsuranceMemberId')} />
                </Field>
                <Field label="Policy Number" id="sipn">
                  <Input id="sipn" value={form.secondaryInsurancePolicyNumber ?? ''} onChange={set('secondaryInsurancePolicyNumber')} />
                </Field>
                <Field label="Group Number" id="sig">
                  <Input id="sig" value={form.secondaryInsuranceGroupNumber ?? ''} onChange={set('secondaryInsuranceGroupNumber')} />
                </Field>
                <Field label="Relationship to Patient" id="sir">
                  <Select
                    value={form.secondaryInsuranceRelationship ?? ''}
                    onValueChange={(v) => setForm((f) => ({ ...f, secondaryInsuranceRelationship: v }))}
                  >
                    <SelectTrigger id="sir"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self">Self</SelectItem>
                      <SelectItem value="spouse">Spouse</SelectItem>
                      <SelectItem value="child">Child</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Subscriber Name" id="sisn">
                  <Input id="sisn" value={form.secondaryInsuranceSubscriberName ?? ''} onChange={set('secondaryInsuranceSubscriberName')} />
                </Field>
                <Field label="Subscriber DOB" id="sisd">
                  <Input id="sisd" type="date" value={form.secondaryInsuranceSubscriberDob ?? ''} onChange={set('secondaryInsuranceSubscriberDob')} />
                </Field>
              </div>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-insurance">
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Drizzle returns null for empty columns; <input value> requires strings. */
function nullsToEmpty(v: InsuranceFields): InsuranceFields {
  const out: any = {};
  for (const [k, val] of Object.entries(v)) out[k] = val ?? '';
  return out;
}

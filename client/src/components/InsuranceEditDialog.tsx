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
import { PayerCombobox } from '@/components/PayerCombobox';

export interface InsuranceFields {
  insuranceProvider?: string | null;
  insurancePayerId?: string | null;
  insuranceId?: string | null;
  policyNumber?: string | null;
  groupNumber?: string | null;
  effectiveDate?: string | null;
  terminationDate?: string | null;
  copayAmount?: string | null;
  coinsurancePercent?: string | null;
  // CMS-1500 Boxes 4, 6, 11a — who actually holds the primary policy.
  insuranceRelationship?: string | null;
  insuranceSubscriberFirstName?: string | null;
  insuranceSubscriberLastName?: string | null;
  insuranceSubscriberDob?: string | null;
  insuranceSubscriberSex?: string | null;
  secondaryInsuranceProvider?: string | null;
  secondaryInsurancePayerId?: string | null;
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
  insurancePayerId: '',
  insuranceId: '',
  policyNumber: '',
  groupNumber: '',
  effectiveDate: '',
  terminationDate: '',
  copayAmount: '',
  coinsurancePercent: '',
  insuranceRelationship: '',
  insuranceSubscriberFirstName: '',
  insuranceSubscriberLastName: '',
  insuranceSubscriberDob: '',
  insuranceSubscriberSex: '',
  secondaryInsuranceProvider: '',
  secondaryInsurancePayerId: '',
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
                <PayerCombobox
                  id="ip"
                  data-testid="combobox-insurance-provider"
                  value={form.insuranceProvider ?? ''}
                  payerId={form.insurancePayerId || null}
                  onSelect={({ name, payerId }) =>
                    setForm((f) => ({ ...f, insuranceProvider: name, insurancePayerId: payerId ?? '' }))
                  }
                />
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
              <Field
                label="Copay"
                id="icp"
                hint="Leave blank to use the amount from the eligibility check. Set it here when the payer's figure is missing or wrong — the front desk will see this at every check-in."
              >
                <Input
                  id="icp"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 30.00"
                  value={form.copayAmount ?? ''}
                  onChange={set('copayAmount')}
                  data-testid="input-copay-amount"
                />
              </Field>
              <Field
                label="Coinsurance %"
                id="ico"
                hint="For plans with no copay — e.g. 20 means the patient owes 20% after their deductible. Shown to the front desk as guidance; the exact amount is billed after insurance processes."
              >
                <Input
                  id="ico"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  placeholder="e.g. 20"
                  value={form.coinsurancePercent ?? ''}
                  onChange={set('coinsurancePercent')}
                  data-testid="input-coinsurance-percent"
                />
              </Field>
            </div>
          </section>

          {/*
            CMS-1500 Boxes 4, 6 and 11a. Before these fields existed every claim
            was filed as though the patient held the policy, so a child on a
            parent's plan went out under the child's name and denied.
          */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Policyholder
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Patient's relationship to policyholder"
                id="irel"
                hint="Who the plan belongs to. Choose Self if the patient is the policyholder."
              >
                <Select
                  value={form.insuranceRelationship || 'self'}
                  onValueChange={(v) => setForm((f) => ({ ...f, insuranceRelationship: v }))}
                >
                  <SelectTrigger id="irel" data-testid="select-insurance-relationship">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">Self — the patient holds the policy</SelectItem>
                    <SelectItem value="spouse">Spouse</SelectItem>
                    <SelectItem value="child">Child</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {form.insuranceRelationship && form.insuranceRelationship !== 'self' && (
              <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
                <p className="col-span-2 text-xs text-muted-foreground">
                  Enter the policyholder exactly as the insurer has them. The payer matches
                  on name and date of birth — a nickname or a guessed spelling will deny.
                  The member ID above is the policyholder's; dependents share it.
                </p>
                <Field label="Policyholder first name" id="isfn">
                  <Input
                    id="isfn"
                    value={form.insuranceSubscriberFirstName ?? ''}
                    onChange={set('insuranceSubscriberFirstName')}
                    data-testid="input-subscriber-first-name"
                  />
                </Field>
                <Field label="Policyholder last name" id="isln">
                  <Input
                    id="isln"
                    value={form.insuranceSubscriberLastName ?? ''}
                    onChange={set('insuranceSubscriberLastName')}
                    data-testid="input-subscriber-last-name"
                  />
                </Field>
                <Field label="Policyholder date of birth" id="isdob">
                  <Input
                    id="isdob"
                    type="date"
                    value={form.insuranceSubscriberDob ?? ''}
                    onChange={set('insuranceSubscriberDob')}
                    data-testid="input-subscriber-dob"
                  />
                </Field>
                <Field label="Policyholder sex" id="issex" hint="As the insurer has it on the policy.">
                  <Select
                    value={form.insuranceSubscriberSex || ''}
                    onValueChange={(v) => setForm((f) => ({ ...f, insuranceSubscriberSex: v }))}
                  >
                    <SelectTrigger id="issex" data-testid="select-subscriber-sex">
                      <SelectValue placeholder="Not recorded" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="M">Male</SelectItem>
                      <SelectItem value="F">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
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
                  <PayerCombobox
                    id="sip"
                    data-testid="combobox-secondary-insurance-provider"
                    value={form.secondaryInsuranceProvider ?? ''}
                    payerId={form.secondaryInsurancePayerId || null}
                    onSelect={({ name, payerId }) =>
                      setForm((f) => ({ ...f, secondaryInsuranceProvider: name, secondaryInsurancePayerId: payerId ?? '' }))
                    }
                  />
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

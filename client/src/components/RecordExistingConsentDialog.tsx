/**
 * RecordExistingConsentDialog
 *
 * For a patient who already consented by some other means before this
 * system existed — a paper intake form, a prior EHR, etc. Deliberately NOT
 * a live e-signature form: staff attest that a specific document already
 * covers this, with a note of the source and the original date, so the
 * record is honestly distinguishable from a real-time signing event.
 *
 * Backed by POST /api/patients/:id/consents/migrate.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { FileSignature } from 'lucide-react';

const CONSENT_TYPE_OPTIONS = [
  { value: 'hipaa_privacy_practices', label: 'HIPAA Notice of Privacy Practices' },
  { value: 'waiver_release', label: 'Waiver & Release' },
  { value: 'financial_responsibility', label: 'Financial Responsibility' },
  { value: 'sms_reminders', label: 'SMS Appointment Reminders' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: number;
  patientName?: string;
}

export default function RecordExistingConsentDialog({ open, onOpenChange, patientId, patientName }: Props) {
  const [consentTypes, setConsentTypes] = useState<string[]>([]);
  const [signatureName, setSignatureName] = useState('');
  const [originalDate, setOriginalDate] = useState('');
  const [attestationSource, setAttestationSource] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const reset = () => {
    setConsentTypes([]);
    setSignatureName('');
    setOriginalDate('');
    setAttestationSource('');
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/patients/${patientId}/consents/migrate`, {
        consentTypes,
        signatureName,
        originalDate,
        attestationSource,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}`] });
      toast({ title: 'Consent recorded', description: `${consentTypes.length} consent record(s) saved.` });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Could not record consent',
        description: err?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const toggle = (value: string) =>
    setConsentTypes((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  const canSubmit =
    consentTypes.length > 0 && signatureName.trim() && originalDate && attestationSource.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="w-5 h-5" /> Record Existing Consent
            {patientName && <span className="text-muted-foreground font-normal">· {patientName}</span>}
          </DialogTitle>
          <DialogDescription>
            Use this when the patient already consented some other way before this system existed —
            a paper intake form on file, a prior EHR, etc. This is <strong>not</strong> a live signature:
            it records that staff attest consent was already obtained, with a note of the source.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Which consents does this cover?</Label>
            {CONSENT_TYPE_OPTIONS.map((opt) => (
              <div key={opt.value} className="flex items-center space-x-2">
                <Checkbox
                  id={`consent-${opt.value}`}
                  checked={consentTypes.includes(opt.value)}
                  onCheckedChange={() => toggle(opt.value)}
                  data-testid={`checkbox-consent-${opt.value}`}
                />
                <Label htmlFor={`consent-${opt.value}`} className="font-normal cursor-pointer">
                  {opt.label}
                </Label>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="rec-signature-name">Name on the original document</Label>
            <Input
              id="rec-signature-name"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder="e.g. Jane Smith (parent/guardian)"
              data-testid="input-migrated-signature-name"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="rec-original-date">Original consent date</Label>
            <Input
              id="rec-original-date"
              type="date"
              value={originalDate}
              onChange={(e) => setOriginalDate(e.target.value)}
              data-testid="input-migrated-original-date"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="rec-source">Source of this consent</Label>
            <Textarea
              id="rec-source"
              value={attestationSource}
              onChange={(e) => setAttestationSource(e.target.value)}
              placeholder="e.g. Paper intake form on file, signed at first visit 2024-03-12"
              rows={2}
              data-testid="input-attestation-source"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
            data-testid="button-save-migrated-consent"
          >
            {mutation.isPending ? 'Saving…' : 'Record Consent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

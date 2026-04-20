import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '@/lib/queryClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { CreditCard, AlertTriangle, CheckCircle2, Loader2, Info } from 'lucide-react';

interface CopayInfo {
  appointmentId: number;
  isTelehealth: boolean;
  expectedCents: number | null;
  expectedFormatted: string | null;
  source: 'eligibility' | 'cache' | 'none' | 'recorded';
  stale: boolean;
  lastCheckedAt: string | null;
  eligibilityId: number | null;
  status: 'pending' | 'collected' | 'skipped' | 'failed' | 'not_applicable' | null;
  collectedCents: number | null;
  paymentMethods: Array<{
    id: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    isDefault: boolean;
  }>;
  chargingEnabled: boolean;
  maxAmountCents: number;
}

interface CopayModalProps {
  appointmentId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called after the user's chosen resolution finishes successfully
   * (skipped, no-op because no copay was due, or already-collected).
   * The parent should use this to trigger the actual check-in.
   */
  onProceed: () => void;
}

// Small format helpers
function formatCents(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export default function CopayModal({
  appointmentId,
  open,
  onOpenChange,
  onProceed,
}: CopayModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  // Amount override (in dollars, string for easier input binding). Null =
  // use whatever /copay-info returns as expectedCents.
  const [amountOverride, setAmountOverride] = useState<string>('');
  const [selectedPM, setSelectedPM] = useState<string | null>(null);

  // Reset local state when modal closes.
  useEffect(() => {
    if (!open) {
      setNote('');
      setAmountOverride('');
      setSelectedPM(null);
    }
  }, [open]);

  // Fetch copay info only while the modal is open and we have an id.
  const { data, isLoading } = useQuery<CopayInfo>({
    queryKey: ['/api/appointments', appointmentId, 'copay-info'],
    queryFn: async () => {
      const res = await fetch(`/api/appointments/${appointmentId}/copay-info`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load copay info');
      return res.json();
    },
    enabled: open && appointmentId != null,
    staleTime: 0,
  });

  const skipMutation = useMutation({
    mutationFn: async () => {
      if (!appointmentId) return null;
      const res = await apiRequest('POST', `/api/appointments/${appointmentId}/copay/skip`, {
        note: note.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      onOpenChange(false);
      onProceed();
    },
  });

  const chargeMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      if (!appointmentId) throw new Error('No appointment selected');
      const amountOverrideCents = amountOverride
        ? Math.round(parseFloat(amountOverride) * 100)
        : undefined;
      const res = await apiRequest('POST', `/api/appointments/${appointmentId}/copay/charge`, {
        paymentMethodId,
        amountCents: amountOverrideCents,
      });
      return res.json();
    },
    onSuccess: () => {
      // Surface via toast so the user sees it even as modal closes.
      toast({
        title: t('copay.chargeSuccessTitle', 'Copay collected'),
        description: t('copay.chargeSuccessDesc', 'Charge recorded on the appointment.'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/appointments'] });
      onOpenChange(false);
      onProceed();
    },
    onError: (err: any) => {
      toast({
        title: t('copay.chargeErrorTitle', 'Charge failed'),
        description: err?.message ?? 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // ---- Derived display state ----
  const expected = data?.expectedCents ?? null;
  const hasExpected = expected != null && expected > 0;
  const alreadyResolved = data?.status === 'collected' || data?.status === 'skipped';
  const telehealth = Boolean(data?.isTelehealth);
  const canCharge = Boolean(data?.chargingEnabled) && hasExpected && !alreadyResolved && !telehealth;

  // Effective amount to charge: override if set and valid, else expected.
  const overrideParsed = amountOverride ? parseFloat(amountOverride) : NaN;
  const overrideValid = amountOverride !== '' && Number.isFinite(overrideParsed) && overrideParsed > 0;
  const effectiveAmountCents = overrideValid
    ? Math.round(overrideParsed * 100)
    : (expected ?? 0);
  const maxCents = data?.maxAmountCents ?? 50000;
  const overCap = effectiveAmountCents > maxCents;

  const title = hasExpected ? t('copay.title', 'Collect Copay') : t('copay.titleNone', 'Check In');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
            {title}
          </DialogTitle>
          <DialogDescription>
            {hasExpected
              ? t('copay.expectedLabel', 'Expected copay')
              : telehealth
                ? t('copay.telehealth')
                : t('copay.noCopay')}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-3 text-sm">
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          )}

          {/* Amount block */}
          {!isLoading && hasExpected && (
            <div className="rounded-md border border-border/70 bg-muted/30 px-4 py-3">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    {t('copay.expectedLabel', 'Expected copay')}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-foreground mt-0.5">
                    {formatCents(effectiveAmountCents)}
                  </div>
                </div>
                {canCharge && (
                  <div className="flex-shrink-0">
                    <Label htmlFor="copay-amount-override" className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
                      {t('copay.amountOverrideLabel', 'Adjust')}
                    </Label>
                    <div className="relative mt-1">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                      <Input
                        id="copay-amount-override"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={amountOverride}
                        onChange={(e) => setAmountOverride(e.target.value)}
                        placeholder={(expected! / 100).toFixed(2)}
                        className="h-8 w-24 pl-5 text-right text-[13px] tabular-nums"
                      />
                    </div>
                  </div>
                )}
              </div>
              {data?.stale && (
                <div className="flex items-center gap-1.5 mt-2 text-[12px] text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.5} />
                  {t('copay.stale')}
                </div>
              )}
              {canCharge && overCap && (
                <div className="flex items-center gap-1.5 mt-2 text-[12px] text-red-700">
                  <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.5} />
                  {t('copay.overCapWarn', {
                    amount: `$${(maxCents / 100).toFixed(2)}`,
                    defaultValue: `Amount exceeds practice cap of $${(maxCents / 100).toFixed(2)}.`,
                  })}
                </div>
              )}
            </div>
          )}

          {/* Already-resolved note */}
          {!isLoading && alreadyResolved && (
            <div className="flex items-start gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-800 text-[13px]">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                {data?.status === 'collected'
                  ? t('copay.alreadyCollected', { amount: formatCents(data.collectedCents) })
                  : t('copay.alreadySkipped')}
              </div>
            </div>
          )}

          {/* No-eligibility hint when not telehealth and no copay data */}
          {!isLoading && !hasExpected && !telehealth && !alreadyResolved && data?.source === 'none' && (
            <div className="flex items-start gap-2 rounded-md bg-sky-50 border border-sky-200 px-3 py-2 text-sky-800 text-[13px]">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>{t('copay.noEligibility')}</div>
            </div>
          )}

          {/* Saved payment methods */}
          {!isLoading && hasExpected && !alreadyResolved && !telehealth && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground mb-1.5">
                {t('copay.savedCardsHeader')}
              </div>
              {data && data.paymentMethods.length === 0 ? (
                <div className="text-[13px] text-muted-foreground">
                  {t('copay.noSavedCards')}
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {data?.paymentMethods.map((pm) => {
                    const isSelected = selectedPM === pm.id;
                    const clickable = canCharge && !overCap && !chargeMutation.isPending;
                    return (
                    <li
                      key={pm.id}
                      className={[
                        'flex items-center justify-between rounded-md border px-3 py-2 text-[13px] transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/[0.06]'
                          : 'border-border/70 bg-background/50',
                        clickable ? 'cursor-pointer hover:bg-accent/40' : '',
                      ].join(' ')}
                      title={canCharge ? undefined : t('copay.chargeDisabledTooltip')}
                      onClick={() => clickable && setSelectedPM(pm.id)}
                    >
                      <span className="flex items-center gap-2">
                        <CreditCard className={`w-3.5 h-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} strokeWidth={1.5} />
                        <span className="font-medium">
                          {pm.brand ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1) : 'Card'}
                        </span>
                        <span className="text-muted-foreground">•••• {pm.last4 ?? '····'}</span>
                        {pm.isDefault && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                            default
                          </Badge>
                        )}
                      </span>
                      {pm.expMonth != null && pm.expYear != null && (
                        <span className="text-[11px] text-muted-foreground">
                          {t('copay.cardRowSuffix', {
                            mm: String(pm.expMonth).padStart(2, '0'),
                            yy: String(pm.expYear).slice(-2),
                          })}
                        </span>
                      )}
                    </li>
                    );
                  })}
                </ul>
              )}
              {canCharge && data?.paymentMethods.length === 0 && (
                <div className="text-[12px] text-muted-foreground mt-2">
                  {t('copay.addCardHint', 'Add a card from the patient record to enable charging.')}
                </div>
              )}
            </div>
          )}

          {/* Skip note (only if there's a copay being skipped) */}
          {!isLoading && hasExpected && !alreadyResolved && !telehealth && (
            <div className="pt-1">
              <Label htmlFor="copay-skip-note" className="text-[12px] text-muted-foreground">
                {t('copay.skipNoteOptional', 'Note (optional)')}
              </Label>
              <Textarea
                id="copay-skip-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('copay.skipNotePlaceholder')}
                rows={2}
                className="mt-1 text-[13px]"
                maxLength={500}
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={skipMutation.isPending || chargeMutation.isPending}
          >
            {t('copay.cancel', 'Cancel')}
          </Button>
          {hasExpected && !alreadyResolved && !telehealth ? (
            <>
              <Button
                variant="outline"
                onClick={() => skipMutation.mutate()}
                disabled={skipMutation.isPending || chargeMutation.isPending}
              >
                {skipMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                {t('copay.skipAndCheckIn')}
              </Button>
              {canCharge && (
                <Button
                  onClick={() => selectedPM && chargeMutation.mutate(selectedPM)}
                  disabled={
                    !selectedPM ||
                    overCap ||
                    chargeMutation.isPending ||
                    skipMutation.isPending
                  }
                >
                  {chargeMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  {t('copay.chargeAndCheckIn', {
                    amount: formatCents(effectiveAmountCents),
                    defaultValue: `Charge ${formatCents(effectiveAmountCents)} & check in`,
                  })}
                </Button>
              )}
            </>
          ) : (
            // No copay due OR already resolved: offer a single "Check in" button that
            // just proceeds without calling /copay/skip (nothing to skip).
            <Button
              onClick={() => {
                onOpenChange(false);
                onProceed();
              }}
            >
              {t('copay.checkInOnly', 'Check in')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  const [note, setNote] = useState('');

  // Reset local state when modal closes.
  useEffect(() => {
    if (!open) setNote('');
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

  // ---- Derived display state ----
  const expected = data?.expectedCents ?? null;
  const hasExpected = expected != null && expected > 0;
  const alreadyResolved = data?.status === 'collected' || data?.status === 'skipped';
  const telehealth = Boolean(data?.isTelehealth);
  const noCopayCase = telehealth || (data && expected === 0) || (data && data.source === 'none' && !hasExpected);

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
              <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                {t('copay.expectedLabel', 'Expected copay')}
              </div>
              <div className="text-2xl font-semibold tabular-nums text-foreground mt-0.5">
                {data?.expectedFormatted ?? formatCents(expected)}
              </div>
              {data?.stale && (
                <div className="flex items-center gap-1.5 mt-2 text-[12px] text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.5} />
                  {t('copay.stale')}
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

          {/* Saved payment methods (read-only until Slice C) */}
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
                  {data?.paymentMethods.map((pm) => (
                    <li
                      key={pm.id}
                      className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-[13px] bg-background/50"
                      title={t('copay.chargeDisabledTooltip')}
                    >
                      <span className="flex items-center gap-2">
                        <CreditCard className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.5} />
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
                  ))}
                </ul>
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
            disabled={skipMutation.isPending}
          >
            {t('copay.cancel', 'Cancel')}
          </Button>
          {hasExpected && !alreadyResolved && !telehealth ? (
            <Button
              onClick={() => skipMutation.mutate()}
              disabled={skipMutation.isPending}
            >
              {skipMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {t('copay.skipAndCheckIn')}
            </Button>
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

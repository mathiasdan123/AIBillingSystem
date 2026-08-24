import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Search } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface PayerSearchResult {
  payerId: string;
  displayName: string;
  aliases?: string[];
  operatingStates?: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills the search with the payer name we already know about. */
  initialQuery?: string;
  /** Receives the new (or existing) directory entry so the caller can select it. */
  onAdded?: (insurance: { id: number; name: string; payerCode: string }) => void;
}

/**
 * Add a payer to the directory.
 *
 * The catalog used to be seed-only, so a practice whose payer mix included
 * anything outside the seeded list simply could not bill that payer. This
 * searches the clearinghouse's payer registry rather than accepting a typed
 * name: a hand-entered "Blue Cross Blue Shield" cannot route a claim (it
 * names ~35 different companies), and the payer ID is what actually reaches
 * the 837P.
 */
export default function AddPayerDialog({ open, onOpenChange, initialQuery = '', onAdded }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isFetching, error } = useQuery<{ results: PayerSearchResult[] }>({
    queryKey: [`/api/payer-mapping/search?q=${encodeURIComponent(submitted)}`],
    enabled: open && submitted.trim().length > 1,
    retry: false,
  });

  const addPayer = useMutation({
    mutationFn: async (payer: PayerSearchResult) => {
      const res = await apiRequest('POST', '/api/insurances', {
        name: payer.displayName,
        payerCode: payer.payerId,
      });
      return res.json();
    },
    onSuccess: (insurance: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurances'] });
      toast({
        title: insurance.created ? 'Payer added' : 'Payer already in your list',
        description: `${insurance.name} is now available on claims.`,
      });
      onAdded?.(insurance);
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Could not add payer',
        description: err?.message ?? 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const results = data?.results ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a payer</DialogTitle>
          <DialogDescription>
            Search the clearinghouse's payer list. Picking from here means claims can actually be
            routed to them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="payer-search">Payer name</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="payer-search"
                value={query}
                placeholder="e.g. Horizon Blue Cross"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setSubmitted(query);
                  }
                }}
                data-testid="input-payer-search"
              />
              <Button type="button" variant="outline" onClick={() => setSubmitted(query)}>
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {isFetching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching payers…
            </div>
          )}

          {error && !isFetching && (
            <p className="text-sm text-amber-700">
              Payer search is unavailable right now. This needs the clearinghouse connection — try
              again shortly.
            </p>
          )}

          {!isFetching && !error && submitted.trim().length > 1 && results.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No payers matched “{submitted}”. Try the payer's full legal name as it appears on the
              patient's card.
            </p>
          )}

          <div className="max-h-64 overflow-y-auto divide-y">
            {results.map((payer) => (
              <div key={payer.payerId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{payer.displayName}</div>
                  <div className="text-xs text-muted-foreground">
                    ID {payer.payerId}
                    {payer.operatingStates?.length ? ` · ${payer.operatingStates.join(', ')}` : ''}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={addPayer.isPending}
                  onClick={() => addPayer.mutate(payer)}
                  data-testid={`button-add-payer-${payer.payerId}`}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

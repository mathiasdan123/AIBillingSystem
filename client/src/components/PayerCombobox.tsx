/**
 * Searchable payer picker backed by Stedi's payer registry
 * (GET /api/payer-mapping/search).
 *
 * Exists to end free-text payer entry, which caused two production failures in
 * one week: a typo ("BLUE CROSS BLUE SHELD") that couldn't route at all, and a
 * correctly spelled "BLUE CROSS BLUE SHIELD" that named ~35 regional companies
 * so no software could route it either. Picking from the registry writes both
 * the canonical payer name AND the Stedi payer ID, and the payer ID is what
 * eligibility checks and claim submission actually route on.
 *
 * Free text remains possible via an explicit "Use as typed" escape hatch —
 * some plans genuinely aren't in the registry — but it's visually the last
 * option, not the default behaviour, and it stores no payer ID.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, PenLine, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface PayerSelection {
  /** Canonical payer display name (or the raw text for "use as typed"). */
  name: string;
  /** Stedi primary payer ID; null when the user chose free text. */
  payerId: string | null;
}

interface PayerSearchItem {
  payerId: string;
  displayName: string;
  aliases: string[];
  operatingStates: string[];
}

interface PayerComboboxProps {
  /** Current payer name (may be legacy free text). */
  value: string;
  /** Current payer ID, if one has been stored. */
  payerId?: string | null;
  onSelect: (selection: PayerSelection) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'data-testid'?: string;
}

/** Small debounce so we don't fire a registry search per keystroke. */
function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function PayerCombobox({
  value,
  payerId,
  onSelect,
  placeholder = 'Search payers…',
  disabled,
  id,
  'data-testid': testId,
}: PayerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 300);
  // Keyboard users tab straight back to the trigger after picking.
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { data, isFetching, isError } = useQuery<{ results: PayerSearchItem[] }>({
    queryKey: ['/api/payer-mapping/search', debounced],
    queryFn: async () => {
      const res = await fetch(`/api/payer-mapping/search?q=${encodeURIComponent(debounced)}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Payer search failed');
      return res.json();
    },
    enabled: open && debounced.length >= 2,
    staleTime: 5 * 60 * 1000, // registry data barely changes; cache repeat queries
    retry: false,
  });

  const results = useMemo(() => data?.results ?? [], [data]);

  const pick = (selection: PayerSelection) => {
    onSelect(selection);
    setOpen(false);
    setSearch('');
    triggerRef.current?.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate text-left', !value && 'text-muted-foreground')}>
            {value || placeholder}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-1.5">
            {value && (payerId ? (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {payerId}
              </Badge>
            ) : (
              // Legacy/free-text value with no routable ID — flag it gently so
              // staff know this record still routes by name matching.
              <Badge variant="outline" className="gap-1 text-[10px] text-amber-600">
                <ShieldQuestion className="h-3 w-3" /> no payer ID
              </Badge>
            ))}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {/* Results come pre-ranked by the registry; client-side re-filtering
            would fight that ranking, so filtering is disabled. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Type at least 2 characters…"
          />
          <CommandList>
            {isFetching && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching registry…
              </div>
            )}
            {isError && (
              <div className="px-3 py-3 text-sm text-destructive">
                Payer search is unavailable right now. You can still type the
                name and use it as-is below.
              </div>
            )}
            {!isFetching && !isError && debounced.length >= 2 && results.length === 0 && (
              <CommandEmpty>No payers match “{debounced}”.</CommandEmpty>
            )}
            {results.length > 0 && (
              <CommandGroup heading="Payer registry">
                {results.map((p) => (
                  <CommandItem
                    key={`${p.payerId}-${p.displayName}`}
                    value={`${p.payerId}-${p.displayName}`}
                    onSelect={() => pick({ name: p.displayName, payerId: p.payerId })}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4 shrink-0',
                        payerId === p.payerId ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{p.displayName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {(p.operatingStates ?? []).slice(0, 6).join(', ')}
                      </div>
                    </div>
                    <Badge variant="secondary" className="ml-2 shrink-0 font-mono text-[10px]">
                      {p.payerId}
                    </Badge>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {search.trim().length > 0 && (
              <CommandGroup heading="Not in the registry?">
                <CommandItem
                  value={`__freetext__${search}`}
                  onSelect={() => pick({ name: search.trim(), payerId: null })}
                  className="text-muted-foreground"
                >
                  <PenLine className="mr-2 h-4 w-4 shrink-0" />
                  Use “{search.trim()}” as typed (no payer ID — may not route
                  automatically)
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

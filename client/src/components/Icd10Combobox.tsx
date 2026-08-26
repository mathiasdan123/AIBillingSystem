/**
 * Searchable ICD-10 picker with add-on-first-use.
 *
 * Replaces the fixed dropdown that scrolled the whole catalog. Type a code
 * ("F84") or a word from the description ("autism") to filter; when the typed
 * text looks like a valid ICD-10 code that is not in the catalog yet, an
 * "Add" row appears — the code is format-validated server-side, inserted, and
 * selected in one step. Daniel's requirement (2026-08-26): a therapist must
 * be able to WRITE IN a diagnosis, not only pick from what was seeded — the
 * ~21 seeded codes were an unblocking measure, not the universe, and the full
 * ICD-10 set (~70k) is deliberately not preloaded.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

interface Icd10Code {
  id: number;
  code: string;
  description: string;
}

interface Props {
  codes: Icd10Code[];
  /** Selected catalog id, as a string ('' when unset). */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  testId?: string;
  className?: string;
}

const CODE_SHAPE = /^[A-TV-Za-tv-z][0-9][0-9A-Za-z](\.[0-9A-Za-z]{1,4})?$/;

export function Icd10Combobox({ codes, value, onChange, placeholder, testId, className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const selected = codes.find((c) => String(c.id) === value);

  const normalizedSearch = search.trim().toUpperCase();
  const looksLikeNewCode =
    CODE_SHAPE.test(normalizedSearch) &&
    !codes.some((c) => c.code.toUpperCase() === normalizedSearch);

  const addMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/icd10-codes", { code });
      return res.json();
    },
    onSuccess: (created: Icd10Code) => {
      // The shared catalog query feeds every picker on the page.
      queryClient.invalidateQueries({ queryKey: ["/api/icd10-codes"] });
      onChange(String(created.id));
      setOpen(false);
      setSearch("");
      toast({ title: `${created.code} added to your diagnosis list` });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't add that code",
        description: String(error?.message ?? "").replace(/^\d{3}:\s*/, "") || "Check the format (e.g. F84.0).",
        variant: "destructive",
      });
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`w-full justify-between font-normal ${!selected ? "text-muted-foreground" : ""} ${className ?? ""}`}
          data-testid={testId}
        >
          <span className="truncate">
            {selected ? `${selected.code} — ${selected.description}` : (placeholder ?? "ICD-10 diagnosis (required)")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          // Match on code AND description, not the default value-only search.
          filter={(itemValue, searchText) =>
            itemValue.toLowerCase().includes(searchText.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder="Type a code (F84.0) or a word (autism)…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {looksLikeNewCode ? "" : "No matching diagnosis — type a full code (e.g. F84.0) to add it."}
            </CommandEmpty>
            {looksLikeNewCode && (
              <CommandGroup>
                <CommandItem
                  value={`__add__${normalizedSearch}`}
                  onSelect={() => addMutation.mutate(normalizedSearch)}
                  disabled={addMutation.isPending}
                  data-testid="icd10-add-new"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {addMutation.isPending ? "Adding…" : `Add ${normalizedSearch} to your diagnosis list`}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {codes.map((icd) => (
                <CommandItem
                  key={icd.id}
                  value={`${icd.code} ${icd.description}`}
                  onSelect={() => {
                    onChange(String(icd.id));
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${String(icd.id) === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="font-mono mr-2">{icd.code}</span>
                  <span className="truncate">{icd.description}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

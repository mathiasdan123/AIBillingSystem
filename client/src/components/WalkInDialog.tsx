import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ChevronsUpDown, Plus, UserPlus } from "lucide-react";

interface Patient {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
}

interface Therapist {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: Patient[];
  therapists: Therapist[];
}

const DURATIONS = [30, 45, 60, 90];

/**
 * Minimal "walk-in" appointment creator for the Front Desk.
 *
 * Optimized for the common case: existing patient shows up unscheduled, or
 * staff schedules a quick add on the spot. For a fully-featured appointment
 * dialog (recurrence, locations, types), the Calendar page has the rich form.
 */
export function WalkInDialog({ open, onOpenChange, patients, therapists }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientId, setPatientId] = useState<string>("");
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [newPatient, setNewPatient] = useState({ firstName: "", lastName: "" });
  const [therapistId, setTherapistId] = useState<string>("");
  const [duration, setDuration] = useState<number>(60);

  function reset() {
    setPatientSearchOpen(false);
    setPatientSearch("");
    setPatientId("");
    setIsNewPatient(false);
    setNewPatient({ firstName: "", lastName: "" });
    setTherapistId("");
    setDuration(60);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      let finalPatientId = patientId;

      // Create patient first if walk-in is brand new.
      if (isNewPatient) {
        if (!newPatient.firstName.trim() || !newPatient.lastName.trim()) {
          throw new Error("First and last name are required for a new patient");
        }
        const patientRes = await apiRequest("POST", "/api/patients", {
          firstName: newPatient.firstName.trim(),
          lastName: newPatient.lastName.trim(),
          dateOfBirth: "2000-01-01",
          practiceId: 1,
        });
        const created = await patientRes.json();
        finalPatientId = String(created.id);
        queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      } else if (!finalPatientId) {
        throw new Error("Please select a patient or add a new one");
      }

      const start = new Date();
      const end = new Date(start.getTime() + duration * 60_000);
      const res = await apiRequest("POST", "/api/appointments", {
        practiceId: 1,
        patientId: parseInt(finalPatientId, 10),
        therapistId: therapistId || null,
        title: "Walk-in",
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        status: "scheduled",
        notes: "Walk-in (created from Front Desk)",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      toast({ title: "Walk-in scheduled", description: `${duration}-minute session starting now.` });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't schedule walk-in", description: err.message, variant: "destructive" });
    },
  });

  const selectedPatient = patients.find((p) => String(p.id) === patientId);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Walk-in</DialogTitle>
          <DialogDescription>Add a quick appointment for now.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Patient</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs h-7 px-2"
                onClick={() => {
                  setIsNewPatient(!isNewPatient);
                  setPatientId("");
                  setNewPatient({ firstName: "", lastName: "" });
                }}
              >
                {isNewPatient ? "Select existing" : (<><UserPlus className="w-3 h-3 mr-1" />New patient</>)}
              </Button>
            </div>

            {isNewPatient ? (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="First name"
                  value={newPatient.firstName}
                  onChange={(e) => setNewPatient({ ...newPatient, firstName: e.target.value })}
                />
                <Input
                  placeholder="Last name"
                  value={newPatient.lastName}
                  onChange={(e) => setNewPatient({ ...newPatient, lastName: e.target.value })}
                />
              </div>
            ) : (
              <Popover open={patientSearchOpen} onOpenChange={setPatientSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={patientSearchOpen}
                    className="w-full justify-between font-normal"
                  >
                    {selectedPatient
                      ? `${selectedPatient.firstName ?? ""} ${selectedPatient.lastName ?? ""}`.trim()
                      : "Select patient..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search patients..."
                      value={patientSearch}
                      onValueChange={setPatientSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No patient found.</CommandEmpty>
                      <CommandGroup>
                        {patients.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()}
                            onSelect={() => {
                              setPatientId(String(p.id));
                              setPatientSearchOpen(false);
                              setPatientSearch("");
                            }}
                          >
                            {p.firstName} {p.lastName}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Therapist (optional)</Label>
              <Select value={therapistId} onValueChange={setTherapistId}>
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  {therapists.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.firstName} {t.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Duration</Label>
              <Select value={String(duration)} onValueChange={(v) => setDuration(parseInt(v, 10))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            <Plus className="w-4 h-4 mr-1" />
            {createMutation.isPending ? "Scheduling…" : "Schedule walk-in"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

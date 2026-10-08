/**
 * Progress Notes panel (Progress tab) — the full clinical flow that replaced
 * the #358 "Draft progress summary" prototype button:
 *
 *   due indicator → start note → goal table (therapist-entered % per goal)
 *   → AI draft (per-goal commentary + narratives) → edit everything →
 *   optional plan extension WITH required written rationale → finalize.
 *
 * The AI assists with drafting from documented sessions only; the treating
 * therapist reviews, edits, and approves every section. The progress % per
 * goal is the therapist's clinical judgment — it is never auto-computed.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ClipboardList, FileText, Loader2, Lock, Sparkles } from "lucide-react";

interface GoalEntry {
  goalId: number;
  goalText: string;
  goalTerm: string | null;
  durationWeeks: number | null;
  startDate: string | null;
  endDate: string | null;
  progressPercent: number | null;
  interventions: string;
  assistanceLevels: string;
  currentAbility: string;
}

interface ProgressNoteRecord {
  id: number;
  status: "draft" | "finalized";
  windowStart: string | null;
  windowEnd: string | null;
  sessionsReviewed: number | null;
  goalEntries: GoalEntry[] | null;
  presentLevel: string | null;
  annualGoals: string | null;
  recommendations: string | null;
  extensionRequested: boolean | null;
  extensionNewEndDate: string | null;
  extensionRationale: string | null;
  generatedAt: string | null;
  finalizedAt: string | null;
}

interface Cadence {
  due: boolean;
  reason: "sessions" | "days" | null;
  anchorDate: string | null;
  completedSessionsSinceAnchor: number;
  daysSinceAnchor: number | null;
  sessionsUntilDue: number | null;
  daysUntilDue: number | null;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function termLabel(term: string | null): string {
  if (term === "short_term") return "Short Term";
  if (term === "long_term") return "Long Term";
  return "—";
}

export default function ProgressNotesPanel({ patientId }: { patientId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);

  const listKey = `/api/progress-notes/patient/${patientId}`;
  const cadenceKey = `/api/progress-notes/patient/${patientId}/cadence`;

  const { data: notes } = useQuery<ProgressNoteRecord[]>({ queryKey: [listKey], enabled: !!patientId });
  const { data: cadence } = useQuery<Cadence>({ queryKey: [cadenceKey], enabled: !!patientId });

  const createNote = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", listKey, {});
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Could not start the progress note.");
      return body as ProgressNoteRecord;
    },
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: [listKey] });
      setOpenNoteId(note.id);
    },
    onError: (e: any) => toast({ title: "Couldn't start a progress note", description: e.message, variant: "destructive" }),
  });

  const dueBanner = cadence?.due ? (
    <Badge variant="destructive" data-testid="badge-progress-note-due">
      Progress note due —{" "}
      {cadence.reason === "sessions"
        ? `${cadence.completedSessionsSinceAnchor} sessions since last note`
        : `${cadence.daysSinceAnchor} days since last note`}
    </Badge>
  ) : cadence?.anchorDate ? (
    <span className="text-xs text-muted-foreground" data-testid="text-progress-note-countdown">
      Next due in {cadence.sessionsUntilDue} session{cadence.sessionsUntilDue === 1 ? "" : "s"} or {cadence.daysUntilDue} day{cadence.daysUntilDue === 1 ? "" : "s"}
    </span>
  ) : null;

  return (
    <Card data-testid="progress-notes-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-teal-600" /> Progress notes
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {dueBanner}
            <Button size="sm" onClick={() => createNote.mutate()} disabled={createNote.isPending} data-testid="button-start-progress-note">
              {createNote.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-1" />}
              Start progress note
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {(notes ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-progress-notes">
            No progress notes yet. A note reviews every treatment goal — due every 10 sessions or 90 days, whichever comes first.
          </p>
        ) : (
          <ul className="divide-y">
            {(notes ?? []).map((n) => (
              <li key={n.id} className="py-2 flex items-center justify-between gap-2 flex-wrap" data-testid={`row-progress-note-${n.id}`}>
                <div className="text-sm">
                  <span className="font-medium">{fmtDate(n.windowStart)} – {fmtDate(n.windowEnd)}</span>
                  <span className="text-muted-foreground ml-2">{n.sessionsReviewed ?? 0} sessions</span>
                </div>
                <div className="flex items-center gap-2">
                  {n.status === "finalized" ? (
                    <Badge variant="secondary"><Lock className="w-3 h-3 mr-1" />Finalized {fmtDate(n.finalizedAt)}</Badge>
                  ) : (
                    <Badge variant="outline">Draft</Badge>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setOpenNoteId(n.id)} data-testid={`button-open-progress-note-${n.id}`}>
                    {n.status === "finalized" ? "View" : "Continue"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          The AI drafts from the documented sessions only; the treating therapist reviews, edits, and approves every section. Progress % is the therapist's clinical judgment.
        </p>
      </CardContent>
      {openNoteId != null && (
        <ProgressNoteEditor
          noteId={openNoteId}
          patientId={patientId}
          onClose={() => {
            setOpenNoteId(null);
            queryClient.invalidateQueries({ queryKey: [listKey] });
            queryClient.invalidateQueries({ queryKey: [cadenceKey] });
          }}
        />
      )}
    </Card>
  );
}

function ProgressNoteEditor({ noteId, patientId, onClose }: { noteId: number; patientId: number; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const noteKey = `/api/progress-notes/${noteId}`;
  const { data: note, isLoading } = useQuery<ProgressNoteRecord>({ queryKey: [noteKey] });

  // Local working copy of the editable fields; seeded from the fetched note.
  const [edits, setEdits] = useState<Partial<ProgressNoteRecord> | null>(null);
  const working: ProgressNoteRecord | null = note ? ({ ...note, ...(edits ?? {}) } as ProgressNoteRecord) : null;
  const entries = working?.goalEntries ?? [];
  const finalized = working?.status === "finalized";

  const setField = (field: keyof ProgressNoteRecord, value: unknown) =>
    setEdits((prev) => ({ ...(prev ?? {}), [field]: value }));

  const setEntry = (goalId: number, patch: Partial<GoalEntry>) =>
    setEdits((prev) => {
      const base = (prev?.goalEntries ?? note?.goalEntries ?? []) as GoalEntry[];
      return {
        ...(prev ?? {}),
        goalEntries: base.map((e) => (e.goalId === goalId ? { ...e, ...patch } : e)),
      };
    });

  const refresh = () => queryClient.invalidateQueries({ queryKey: [noteKey] });

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!edits) return note;
      const res = await apiRequest("PATCH", noteKey, edits);
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Could not save the draft.");
      return body;
    },
    onSuccess: () => {
      setEdits(null);
      refresh();
      toast({ title: "Draft saved" });
    },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const generate = useMutation({
    mutationFn: async () => {
      // Persist any pending edits (therapist-entered %) before generating so
      // the draft is grounded in them.
      if (edits) {
        const saveRes = await apiRequest("PATCH", noteKey, edits);
        if (!saveRes.ok) {
          const body = await saveRes.json();
          throw new Error(body.message || "Could not save before generating.");
        }
      }
      const res = await apiRequest("POST", `${noteKey}/generate`, {});
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Could not draft the note.");
      return body;
    },
    onSuccess: () => {
      setEdits(null);
      refresh();
      toast({ title: "Draft generated", description: "Review and edit every section before finalizing." });
    },
    onError: (e: any) => toast({ title: "Couldn't generate the draft", description: e.message, variant: "destructive" }),
  });

  const finalize = useMutation({
    mutationFn: async (updateGoalProgress: boolean) => {
      if (edits) {
        const saveRes = await apiRequest("PATCH", noteKey, edits);
        if (!saveRes.ok) {
          const body = await saveRes.json();
          throw new Error(body.message || "Could not save before finalizing.");
        }
      }
      const res = await apiRequest("POST", `${noteKey}/finalize`, { updateGoalProgress });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Could not finalize the note.");
      return body;
    },
    onSuccess: () => {
      setEdits(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/progress`] });
      toast({ title: "Progress note finalized", description: "The note is now locked." });
    },
    onError: (e: any) => toast({ title: "Couldn't finalize", description: e.message, variant: "destructive" }),
  });

  const [syncGoalProgress, setSyncGoalProgress] = useState(true);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto" data-testid="progress-note-editor">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-teal-600" />
            Progress note {working ? `— ${fmtDate(working.windowStart)} to ${fmtDate(working.windowEnd)}` : ""}
            {finalized && <Badge variant="secondary"><Lock className="w-3 h-3 mr-1" />Finalized</Badge>}
          </DialogTitle>
          <DialogDescription>
            Reviews every treatment goal: interventions utilized, assistance levels required, and current ability. The AI drafts from documented sessions only; you review, edit, and approve. Progress % is your clinical judgment — it is never auto-computed.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !working ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="space-y-5">
            {!finalized && (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="button-generate-progress-note">
                  {generate.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Drafting…</>
                  ) : (
                    <><Sparkles className="w-3.5 h-3.5 mr-1" />{working.generatedAt ? "Regenerate AI draft" : "Generate AI draft"}</>
                  )}
                </Button>
              </div>
            )}

            {/* ---- Goal table ---- */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Treatment goals</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border" data-testid="table-progress-note-goals">
                  <thead>
                    <tr className="bg-muted/50 text-left">
                      <th className="p-2 font-medium">Goal</th>
                      <th className="p-2 font-medium whitespace-nowrap">Duration (wks)</th>
                      <th className="p-2 font-medium whitespace-nowrap">Start</th>
                      <th className="p-2 font-medium whitespace-nowrap">End</th>
                      <th className="p-2 font-medium whitespace-nowrap">Progress %</th>
                      <th className="p-2 font-medium whitespace-nowrap">Term</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.goalId} className="border-t align-top" data-testid={`row-goal-${e.goalId}`}>
                        <td className="p-2">{e.goalText}</td>
                        <td className="p-2">{e.durationWeeks ?? "—"}</td>
                        <td className="p-2 whitespace-nowrap">{e.startDate ? fmtDate(e.startDate) : "—"}</td>
                        <td className="p-2 whitespace-nowrap">{e.endDate ? fmtDate(e.endDate) : "—"}</td>
                        <td className="p-2">
                          {finalized ? (
                            <span>{e.progressPercent != null ? `${e.progressPercent}%` : "—"}</span>
                          ) : (
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              className="h-7 w-20"
                              value={e.progressPercent ?? ""}
                              placeholder="%"
                              onChange={(ev) => {
                                const v = ev.target.value;
                                setEntry(e.goalId, { progressPercent: v === "" ? null : Math.max(0, Math.min(100, Math.round(Number(v)))) });
                              }}
                              data-testid={`input-progress-percent-${e.goalId}`}
                            />
                          )}
                        </td>
                        <td className="p-2 whitespace-nowrap">{termLabel(e.goalTerm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Progress % reflects your judgment of assistance level and trials against each goal's criteria.
              </p>
            </div>

            {/* ---- Per-goal commentary ---- */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Per-goal commentary</h4>
              {entries.map((e, i) => (
                <div key={e.goalId} className="border rounded-md p-3 space-y-2" data-testid={`commentary-goal-${e.goalId}`}>
                  <p className="text-xs font-medium">Goal {i + 1}: {e.goalText}</p>
                  {([
                    ["interventions", "Interventions utilized"],
                    ["assistanceLevels", "Assistance levels required"],
                    ["currentAbility", "Current ability"],
                  ] as const).map(([field, label]) => (
                    <div key={field}>
                      <Label className="text-[11px] uppercase text-muted-foreground">{label}</Label>
                      <Textarea
                        value={(e as any)[field] ?? ""}
                        onChange={(ev) => setEntry(e.goalId, { [field]: ev.target.value } as Partial<GoalEntry>)}
                        rows={2}
                        className="text-sm mt-1"
                        readOnly={finalized}
                        data-testid={`textarea-${field}-${e.goalId}`}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* ---- Narrative sections ---- */}
            {([
              ["presentLevel", "Present Level of Functioning", 6],
              ["annualGoals", "Annual goals", 4],
              ["recommendations", "Recommendations", 4],
            ] as const).map(([field, label, rows]) => (
              <div key={field}>
                <Label className="text-xs font-semibold uppercase text-muted-foreground">{label}</Label>
                <Textarea
                  value={(working as any)[field] ?? ""}
                  onChange={(ev) => setField(field, ev.target.value)}
                  rows={rows}
                  className="text-sm mt-1"
                  readOnly={finalized}
                  data-testid={`textarea-note-${field}`}
                />
              </div>
            ))}

            {/* ---- Plan extension ---- */}
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="extension-requested"
                  checked={!!working.extensionRequested}
                  disabled={finalized}
                  onCheckedChange={(c) => setField("extensionRequested", c === true)}
                  data-testid="checkbox-extension-requested"
                />
                <Label htmlFor="extension-requested" className="text-sm">
                  Goals are still progressing — extend the treatment plan's end date
                </Label>
              </div>
              {working.extensionRequested && (
                <div className="space-y-2 pl-6">
                  <div>
                    <Label className="text-xs">New plan end date</Label>
                    <Input
                      type="date"
                      className="h-8 w-44"
                      value={working.extensionNewEndDate ?? ""}
                      readOnly={finalized}
                      onChange={(ev) => setField("extensionNewEndDate", ev.target.value || null)}
                      data-testid="input-extension-end-date"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">
                      Why is the extension appropriate, and why does continued treatment remain medically necessary? (required)
                    </Label>
                    <Textarea
                      value={working.extensionRationale ?? ""}
                      onChange={(ev) => setField("extensionRationale", ev.target.value)}
                      rows={3}
                      className="text-sm mt-1"
                      readOnly={finalized}
                      placeholder="A few sentences in your own words — stored with the note and the plan."
                      data-testid="textarea-extension-rationale"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ---- Actions ---- */}
            {!finalized && (
              <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="sync-goal-progress"
                    checked={syncGoalProgress}
                    onCheckedChange={(c) => setSyncGoalProgress(c === true)}
                    data-testid="checkbox-sync-goal-progress"
                  />
                  <Label htmlFor="sync-goal-progress" className="text-xs text-muted-foreground">
                    Update each goal's progress % on the plan when finalizing
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending || !edits} data-testid="button-save-progress-note">
                    {saveDraft.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Save draft
                  </Button>
                  <Button size="sm" onClick={() => finalize.mutate(syncGoalProgress)} disabled={finalize.isPending} data-testid="button-finalize-progress-note">
                    {finalize.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Lock className="w-3.5 h-3.5 mr-1" />}
                    Finalize note
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

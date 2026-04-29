import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Edit2, Trash2, AlertTriangle } from "lucide-react";

interface MaintenanceWindow {
  id: number;
  practiceId: number | null;
  message: string;
  severity: "info" | "warning" | "critical";
  startsAt: string;
  endsAt: string;
  dismissible: boolean;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

type FormState = {
  scope: "system" | "practice";
  practiceId: string;
  message: string;
  severity: "info" | "warning" | "critical";
  startsAt: string;
  endsAt: string;
  dismissible: boolean;
};

function emptyForm(): FormState {
  // Default to "starts now, ends in 1 hour" — formatted for datetime-local inputs.
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  return {
    scope: "system",
    practiceId: "",
    message: "",
    severity: "info",
    startsAt: toLocalInputValue(now),
    endsAt: toLocalInputValue(later),
    dismissible: true,
  };
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputToIso(localValue: string): string {
  return new Date(localValue).toISOString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function isActive(w: MaintenanceWindow): boolean {
  const now = Date.now();
  return new Date(w.startsAt).getTime() <= now && new Date(w.endsAt).getTime() >= now;
}

const SEVERITY_BADGE: Record<string, string> = {
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
};

export default function MaintenanceWindowsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const { data: windows = [], isLoading } = useQuery<MaintenanceWindow[]>({
    queryKey: ["/api/maintenance-windows"],
  });

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      message: form.message.trim(),
      severity: form.severity,
      startsAt: fromInputToIso(form.startsAt),
      endsAt: fromInputToIso(form.endsAt),
      dismissible: form.dismissible,
    };
    if (form.scope === "system") {
      payload.practiceId = null;
    } else {
      const parsed = parseInt(form.practiceId, 10);
      payload.practiceId = isNaN(parsed) ? null : parsed;
    }
    return payload;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/maintenance-windows", buildPayload());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-windows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-windows/active"] });
      toast({ title: "Maintenance window created" });
      setDialogOpen(false);
      setForm(emptyForm());
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to create",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (editingId == null) throw new Error("No window selected");
      const res = await apiRequest("PATCH", `/api/maintenance-windows/${editingId}`, buildPayload());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-windows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-windows/active"] });
      toast({ title: "Maintenance window updated" });
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm());
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to update",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/maintenance-windows/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-windows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-windows/active"] });
      toast({ title: "Maintenance window deleted" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to delete",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (w: MaintenanceWindow) => {
    setEditingId(w.id);
    setForm({
      scope: w.practiceId == null ? "system" : "practice",
      practiceId: w.practiceId == null ? "" : String(w.practiceId),
      message: w.message,
      severity: w.severity,
      startsAt: toLocalInputValue(new Date(w.startsAt)),
      endsAt: toLocalInputValue(new Date(w.endsAt)),
      dismissible: w.dismissible,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.message.trim()) {
      toast({ title: "Message is required", variant: "destructive" });
      return;
    }
    if (new Date(form.endsAt) <= new Date(form.startsAt)) {
      toast({ title: "End time must be after start time", variant: "destructive" });
      return;
    }
    if (editingId != null) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="maintenance-windows-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Maintenance Windows</h1>
          <p className="text-sm text-muted-foreground">
            Post a banner shown to users during scheduled maintenance.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-new-maintenance">
          <Plus className="h-4 w-4 mr-2" />
          New window
        </Button>
      </div>

      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
        <CardContent className="pt-6 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-300 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 dark:text-amber-100">
            <strong>HIPAA reminder:</strong> Maintenance messages are shown to all users.
            Do not include any patient information (names, DOBs, MRNs, claim numbers, or other PHI).
            Keep messages limited to operational details.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All windows</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : windows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No maintenance windows yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead>Dismissible</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {windows.map((w) => (
                  <TableRow key={w.id} data-testid={`row-maintenance-${w.id}`}>
                    <TableCell>
                      {isActive(w) ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Scheduled</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={SEVERITY_BADGE[w.severity] ?? ""}>{w.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      {w.practiceId == null ? "System-wide" : `Practice ${w.practiceId}`}
                    </TableCell>
                    <TableCell className="max-w-md truncate" title={w.message}>
                      {w.message}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(w.startsAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(w.endsAt)}</TableCell>
                    <TableCell>{w.dismissible ? "Yes" : "No"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(w)}
                          data-testid={`button-edit-${w.id}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm("Delete this maintenance window?")) {
                              deleteMutation.mutate(w.id);
                            }
                          }}
                          data-testid={`button-delete-${w.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit maintenance window" : "New maintenance window"}</DialogTitle>
              <DialogDescription>
                Banner shown to users between the start and end times.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="scope">Scope</Label>
                <Select
                  value={form.scope}
                  onValueChange={(v: "system" | "practice") => setForm((f) => ({ ...f, scope: v }))}
                >
                  <SelectTrigger id="scope" data-testid="select-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System-wide (all practices)</SelectItem>
                    <SelectItem value="practice">Single practice</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.scope === "practice" && (
                <div className="space-y-2">
                  <Label htmlFor="practiceId">Practice ID</Label>
                  <Input
                    id="practiceId"
                    type="number"
                    value={form.practiceId}
                    onChange={(e) => setForm((f) => ({ ...f, practiceId: e.target.value }))}
                    data-testid="input-practice-id"
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="message">Message</Label>
                <Textarea
                  id="message"
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                  placeholder="Scheduled maintenance Sunday 3am ET, expect 5 min interruption."
                  rows={3}
                  data-testid="input-message"
                  required
                />
                <p className="text-xs text-muted-foreground">No PHI. Operational details only.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="severity">Severity</Label>
                <Select
                  value={form.severity}
                  onValueChange={(v: "info" | "warning" | "critical") =>
                    setForm((f) => ({ ...f, severity: v }))
                  }
                >
                  <SelectTrigger id="severity" data-testid="select-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info (blue)</SelectItem>
                    <SelectItem value="warning">Warning (amber)</SelectItem>
                    <SelectItem value="critical">Critical (red)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="startsAt">Starts at</Label>
                  <Input
                    id="startsAt"
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
                    data-testid="input-starts-at"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endsAt">Ends at</Label>
                  <Input
                    id="endsAt"
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
                    data-testid="input-ends-at"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  id="dismissible"
                  checked={form.dismissible}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, dismissible: v }))}
                  data-testid="switch-dismissible"
                />
                <Label htmlFor="dismissible">Allow users to dismiss the banner</Label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-maintenance"
              >
                {editingId ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

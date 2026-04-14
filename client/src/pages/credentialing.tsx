import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, Trash2, Edit2, AlertTriangle, ShieldCheck, Search,
} from "lucide-react";

// ==================== TYPES ====================

interface ProviderCredential {
  id: number;
  practiceId: number;
  providerId: string;
  providerName: string;
  providerNpi: string | null;
  payerName: string;
  payerId: string | null;
  caqhProfileId: string | null;
  enrollmentStatus: string;
  enrollmentDate: string | null;
  expirationDate: string | null;
  reCredentialingDate: string | null;
  applicationSubmittedAt: string | null;
  notes: string | null;
  documents: any;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = "all" | "active" | "pending" | "in_progress" | "expired" | "denied" | "expiring_soon";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  expired: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  denied: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  in_progress: "In Progress",
  expired: "Expired",
  denied: "Denied",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString();
}

function isExpiringSoon(expirationDate: string | null, days: number = 30): boolean {
  if (!expirationDate) return false;
  const expDate = new Date(expirationDate);
  const now = new Date();
  const diffMs = expDate.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= days;
}

// ==================== FORM DEFAULTS ====================

const emptyForm = {
  providerId: "",
  providerName: "",
  providerNpi: "",
  payerName: "",
  payerId: "",
  caqhProfileId: "",
  enrollmentStatus: "pending",
  enrollmentDate: "",
  expirationDate: "",
  reCredentialingDate: "",
  notes: "",
};

// ==================== COMPONENT ====================

export default function CredentialingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  // Fetch all credentials
  const { data: credentials = [], isLoading } = useQuery<ProviderCredential[]>({
    queryKey: ["/api/credentialing"],
    queryFn: async () => {
      const res = await fetch("/api/credentialing", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch credentials");
      return res.json();
    },
  });

  // Fetch expiring credentials (for alert banner)
  const { data: expiringCredentials = [] } = useQuery<ProviderCredential[]>({
    queryKey: ["/api/credentialing/expiring", "30"],
    queryFn: async () => {
      const res = await fetch("/api/credentialing/expiring?days=30", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof emptyForm) => {
      const res = await apiRequest("POST", "/api/credentialing", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentialing"] });
      toast({ title: "Credential record created" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof emptyForm> }) => {
      const res = await apiRequest("PATCH", `/api/credentialing/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentialing"] });
      toast({ title: "Credential record updated" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/credentialing/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentialing"] });
      toast({ title: "Credential record deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Filter credentials
  const filteredCredentials = useMemo(() => {
    let filtered = credentials;

    if (statusFilter === "expiring_soon") {
      filtered = filtered.filter((c) => isExpiringSoon(c.expirationDate, 90));
    } else if (statusFilter !== "all") {
      filtered = filtered.filter((c) => c.enrollmentStatus === statusFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.providerName.toLowerCase().includes(q) ||
          c.payerName.toLowerCase().includes(q) ||
          (c.providerNpi && c.providerNpi.toLowerCase().includes(q))
      );
    }

    return filtered;
  }, [credentials, statusFilter, searchQuery]);

  function openAddDialog() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditDialog(credential: ProviderCredential) {
    setEditingId(credential.id);
    setForm({
      providerId: credential.providerId,
      providerName: credential.providerName,
      providerNpi: credential.providerNpi || "",
      payerName: credential.payerName,
      payerId: credential.payerId || "",
      caqhProfileId: credential.caqhProfileId || "",
      enrollmentStatus: credential.enrollmentStatus || "pending",
      enrollmentDate: credential.enrollmentDate || "",
      expirationDate: credential.expirationDate || "",
      reCredentialingDate: credential.reCredentialingDate || "",
      notes: credential.notes || "",
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="md:ml-64 p-4 md:p-8 mt-14 md:mt-0 mb-20 md:mb-0">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="w-6 h-6" />
              Credentialing Management
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Track provider enrollment status with each payer
            </p>
          </div>
          <Button onClick={openAddDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Add Credential
          </Button>
        </div>

        {/* Alert banner for expiring credentials */}
        {expiringCredentials.length > 0 && (
          <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950 dark:border-orange-800">
            <CardContent className="py-3 px-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-orange-800 dark:text-orange-200">
                  {expiringCredentials.length} credential{expiringCredentials.length !== 1 ? "s" : ""} expiring in the next 30 days
                </p>
                <ul className="text-sm text-orange-700 dark:text-orange-300 mt-1 space-y-0.5">
                  {expiringCredentials.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      {c.providerName} - {c.payerName} (expires {formatDate(c.expirationDate)})
                    </li>
                  ))}
                  {expiringCredentials.length > 5 && (
                    <li>...and {expiringCredentials.length - 5} more</li>
                  )}
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by provider, payer, or NPI..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Credentials Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Provider Credentials ({filteredCredentials.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : filteredCredentials.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-lg font-medium">No credentials found</p>
                <p className="text-sm mt-1">
                  {statusFilter !== "all" || searchQuery
                    ? "Try adjusting your filters"
                    : "Click 'Add Credential' to start tracking provider enrollments"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Payer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Enrollment Date</TableHead>
                      <TableHead>Expiration</TableHead>
                      <TableHead>Re-Credentialing</TableHead>
                      <TableHead>CAQH ID</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCredentials.map((credential) => {
                      const expiringSoon = isExpiringSoon(credential.expirationDate);
                      return (
                        <TableRow key={credential.id}>
                          <TableCell>
                            <div>
                              <span className="font-medium">{credential.providerName}</span>
                              {credential.providerNpi && (
                                <span className="block text-xs text-muted-foreground">
                                  NPI: {credential.providerNpi}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <span>{credential.payerName}</span>
                              {credential.payerId && (
                                <span className="block text-xs text-muted-foreground">
                                  ID: {credential.payerId}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                STATUS_COLORS[credential.enrollmentStatus || "pending"] ||
                                STATUS_COLORS.pending
                              }
                            >
                              {STATUS_LABELS[credential.enrollmentStatus || "pending"] || credential.enrollmentStatus}
                            </Badge>
                            {expiringSoon && (
                              <Badge className="ml-1 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                                Expiring Soon
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{formatDate(credential.enrollmentDate)}</TableCell>
                          <TableCell className={expiringSoon ? "text-orange-600 font-medium" : ""}>
                            {formatDate(credential.expirationDate)}
                          </TableCell>
                          <TableCell>{formatDate(credential.reCredentialingDate)}</TableCell>
                          <TableCell>{credential.caqhProfileId || "-"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditDialog(credential)}
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (window.confirm("Delete this credential record?")) {
                                    deleteMutation.mutate(credential.id);
                                  }
                                }}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Credential" : "Add Credential"}</DialogTitle>
              <DialogDescription>
                {editingId
                  ? "Update the provider credentialing record."
                  : "Track a new provider enrollment with a payer."}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="providerName">Provider Name *</Label>
                  <Input
                    id="providerName"
                    value={form.providerName}
                    onChange={(e) => updateField("providerName", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="providerId">Provider ID *</Label>
                  <Input
                    id="providerId"
                    value={form.providerId}
                    onChange={(e) => updateField("providerId", e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="providerNpi">NPI</Label>
                  <Input
                    id="providerNpi"
                    value={form.providerNpi}
                    onChange={(e) => updateField("providerNpi", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="caqhProfileId">CAQH Profile ID</Label>
                  <Input
                    id="caqhProfileId"
                    value={form.caqhProfileId}
                    onChange={(e) => updateField("caqhProfileId", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payerName">Payer Name *</Label>
                  <Input
                    id="payerName"
                    value={form.payerName}
                    onChange={(e) => updateField("payerName", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="payerId">Payer ID</Label>
                  <Input
                    id="payerId"
                    value={form.payerId}
                    onChange={(e) => updateField("payerId", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="enrollmentStatus">Enrollment Status</Label>
                <Select
                  value={form.enrollmentStatus}
                  onValueChange={(v) => updateField("enrollmentStatus", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="denied">Denied</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="enrollmentDate">Enrollment Date</Label>
                  <Input
                    id="enrollmentDate"
                    type="date"
                    value={form.enrollmentDate}
                    onChange={(e) => updateField("enrollmentDate", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expirationDate">Expiration Date</Label>
                  <Input
                    id="expirationDate"
                    type="date"
                    value={form.expirationDate}
                    onChange={(e) => updateField("expirationDate", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reCredentialingDate">Re-Credential Date</Label>
                  <Input
                    id="reCredentialingDate"
                    type="date"
                    value={form.reCredentialingDate}
                    onChange={(e) => updateField("reCredentialingDate", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : editingId
                    ? "Update"
                    : "Create"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

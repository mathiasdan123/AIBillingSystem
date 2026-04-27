import { useState, useMemo } from "react";
import { Link } from "wouter";
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
  Sparkles, FileText, ClipboardList, Loader2, Copy,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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

  // AI draft state — "Draft packet" or "Draft application"
  const [draftMode, setDraftMode] = useState<null | 'packet' | 'application'>(null);
  const [draftForm, setDraftForm] = useState({
    // Pick from dropdown OR type freehand — one or the other, not both.
    providerSource: 'existing' as 'existing' | 'manual',
    providerId: '',
    providerName: '',
    providerCredentials: '',
    providerNpi: '',
    providerLicense: '',
    payerName: '',
    notes: '',
  });
  const [draftPacketResult, setDraftPacketResult] = useState<any | null>(null);
  const [draftAppResult, setDraftAppResult] = useState<any | null>(null);

  // Therapists for the draft-mode provider dropdown
  const { data: therapists = [] } = useQuery<Array<{ id: string; firstName: string; lastName: string; credentials: string | null }>>({
    queryKey: ["/api/therapists"],
    queryFn: async () => {
      const res = await fetch("/api/therapists", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Cross-link: pull payer enrollment status so each credential row can
  // surface "EDI: enrolled / pending" alongside the credentialing record.
  // Mirrors the cross-link the payer-enrollments page has the other
  // direction. Status is computed per (payer, transactionType) — we
  // aggregate across the three transaction types per payer for display.
  const { data: enrollmentRows } = useQuery<Array<{
    name: string;
    enrollments: Array<{ transactionType: string; status: string; requiresEnrollment: boolean }>;
  }>>({
    queryKey: ["/api/payer-enrollments"],
    queryFn: async () => {
      const res = await fetch("/api/payer-enrollments", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const enrollmentByPayer = useMemo(() => {
    const m = new Map<string, { enrolledCount: number; total: number; pendingCount: number; rejectedCount: number }>();
    for (const row of enrollmentRows ?? []) {
      const key = row.name.toLowerCase();
      let enrolled = 0;
      let pending = 0;
      let rejected = 0;
      for (const e of row.enrollments) {
        if (e.status === 'enrolled') enrolled++;
        else if (e.status === 'pending') pending++;
        else if (e.status === 'rejected') rejected++;
      }
      m.set(key, {
        enrolledCount: enrolled,
        total: row.enrollments.length,
        pendingCount: pending,
        rejectedCount: rejected,
      });
    }
    return m;
  }, [enrollmentRows]);

  const draftPacketMutation = useMutation({
    mutationFn: async (body: { providerId: string; payerName: string; notes?: string }) => {
      const res = await apiRequest("POST", "/api/credentialing/draft-packet", body);
      return res.json();
    },
    onSuccess: (data) => setDraftPacketResult(data),
    onError: (err: any) => toast({
      title: "Couldn't draft packet",
      description: err?.message || 'Please try again.',
      variant: 'destructive',
    }),
  });
  const draftAppMutation = useMutation({
    mutationFn: async (body: { providerId: string; payerName: string; notes?: string }) => {
      const res = await apiRequest("POST", "/api/credentialing/draft-application", body);
      return res.json();
    },
    onSuccess: (data) => setDraftAppResult(data),
    onError: (err: any) => toast({
      title: "Couldn't draft application",
      description: err?.message || 'Please try again.',
      variant: 'destructive',
    }),
  });
  const resetDraft = () => {
    setDraftMode(null);
    setDraftForm({
      providerSource: 'existing',
      providerId: '',
      providerName: '',
      providerCredentials: '',
      providerNpi: '',
      providerLicense: '',
      payerName: '',
      notes: '',
    });
    setDraftPacketResult(null);
    setDraftAppResult(null);
  };
  const handleGenerateDraft = () => {
    const isExisting = draftForm.providerSource === 'existing';
    const hasProvider = isExisting
      ? Boolean(draftForm.providerId)
      : Boolean(draftForm.providerName.trim());
    if (!hasProvider || !draftForm.payerName.trim()) {
      toast({
        title: 'Missing info',
        description: isExisting
          ? 'Select a provider and enter a payer.'
          : 'Enter a provider name and a payer.',
        variant: 'destructive',
      });
      return;
    }
    const body: any = {
      payerName: draftForm.payerName.trim(),
      notes: draftForm.notes.trim() || undefined,
    };
    if (isExisting) {
      body.providerId = draftForm.providerId;
    } else {
      body.providerName = draftForm.providerName.trim();
      if (draftForm.providerCredentials.trim()) body.providerCredentials = draftForm.providerCredentials.trim();
      if (draftForm.providerNpi.trim()) body.providerNpi = draftForm.providerNpi.trim();
      if (draftForm.providerLicense.trim()) body.providerLicense = draftForm.providerLicense.trim();
    }
    if (draftMode === 'packet') draftPacketMutation.mutate(body);
    else if (draftMode === 'application') draftAppMutation.mutate(body);
  };

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
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="button-ai-credentialing">
                  <Sparkles className="w-4 h-4 mr-2 text-purple-600" />
                  AI Draft
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDraftMode('packet')} data-testid="menu-draft-packet">
                  <FileText className="w-4 h-4 mr-2" />
                  Draft enrollment packet letter
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDraftMode('application')} data-testid="menu-draft-application">
                  <ClipboardList className="w-4 h-4 mr-2" />
                  Draft credentialing application
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={openAddDialog}>
              <Plus className="w-4 h-4 mr-2" />
              Add Credential
            </Button>
          </div>
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
                      <TableHead title="Practice's EDI enrollment with this payer for eligibility / claims / ERA">EDI</TableHead>
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
                          <TableCell>
                            {(() => {
                              const ediStatus = enrollmentByPayer.get(credential.payerName.toLowerCase());
                              if (!ediStatus || ediStatus.total === 0) {
                                return (
                                  <Link href="/payer-enrollments" className="text-xs text-slate-400 hover:underline">
                                    Not tracked
                                  </Link>
                                );
                              }
                              if (ediStatus.enrolledCount === ediStatus.total) {
                                return (
                                  <Link href="/payer-enrollments">
                                    <Badge className="bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer">
                                      All enrolled
                                    </Badge>
                                  </Link>
                                );
                              }
                              if (ediStatus.rejectedCount > 0) {
                                return (
                                  <Link href="/payer-enrollments">
                                    <Badge className="bg-red-100 text-red-800 hover:bg-red-200 cursor-pointer">
                                      {ediStatus.rejectedCount} rejected
                                    </Badge>
                                  </Link>
                                );
                              }
                              if (ediStatus.pendingCount > 0) {
                                return (
                                  <Link href="/payer-enrollments">
                                    <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 cursor-pointer">
                                      {ediStatus.pendingCount} pending · {ediStatus.enrolledCount}/{ediStatus.total} enrolled
                                    </Badge>
                                  </Link>
                                );
                              }
                              return (
                                <Link href="/payer-enrollments">
                                  <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer">
                                    {ediStatus.enrolledCount}/{ediStatus.total} enrolled
                                  </Badge>
                                </Link>
                              );
                            })()}
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

              {/* Documents — only shown when editing an existing credential
                  (need an id to attach to). */}
              {editingId && <DocumentsSection credentialId={editingId} />}

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

        {/* AI Draft Dialog — packet or application */}
        <Dialog
          open={draftMode !== null}
          onOpenChange={(open) => {
            if (!open) resetDraft();
          }}
        >
          <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                {draftMode === 'packet'
                  ? 'Draft Enrollment Packet Letter'
                  : 'Draft Credentialing Application'}
              </DialogTitle>
              <DialogDescription>
                {draftMode === 'packet'
                  ? 'AI generates a cover letter + document checklist for the enrollment packet you submit to this payer.'
                  : 'AI generates an application cover letter + Q&A prefills you can paste into the payer credentialing portal.'}
              </DialogDescription>
            </DialogHeader>

            {/* Step 1: form */}
            {!draftPacketResult && !draftAppResult && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Provider *</Label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      className={`px-2 py-1 rounded ${
                        draftForm.providerSource === 'existing'
                          ? 'bg-purple-100 text-purple-800 font-medium'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                      onClick={() => setDraftForm({ ...draftForm, providerSource: 'existing' })}
                      data-testid="tab-existing-provider"
                    >
                      Existing therapist
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-1 rounded ${
                        draftForm.providerSource === 'manual'
                          ? 'bg-purple-100 text-purple-800 font-medium'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                      onClick={() => setDraftForm({ ...draftForm, providerSource: 'manual' })}
                      data-testid="tab-manual-provider"
                    >
                      Enter manually
                    </button>
                  </div>
                  {draftForm.providerSource === 'existing' ? (
                    therapists.length > 0 ? (
                      <Select
                        value={draftForm.providerId}
                        onValueChange={(v) => setDraftForm({ ...draftForm, providerId: v })}
                      >
                        <SelectTrigger data-testid="select-draft-provider">
                          <SelectValue placeholder="Select a therapist" />
                        </SelectTrigger>
                        <SelectContent>
                          {therapists.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.firstName} {t.lastName}
                              {t.credentials ? `, ${t.credentials}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="p-3 text-xs text-amber-800 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded">
                        No therapists in the system yet. Switch to <strong>Enter manually</strong> above
                        to draft credentials for a new hire before they're added to the Therapists tab.
                      </div>
                    )
                  ) : (
                    <div className="space-y-2">
                      <Input
                        value={draftForm.providerName}
                        onChange={(e) => setDraftForm({ ...draftForm, providerName: e.target.value })}
                        placeholder="Full name (e.g. Jane Smith, OTR/L)"
                        data-testid="input-manual-provider-name"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          value={draftForm.providerCredentials}
                          onChange={(e) => setDraftForm({ ...draftForm, providerCredentials: e.target.value })}
                          placeholder="Credentials (OTR/L)"
                        />
                        <Input
                          value={draftForm.providerNpi}
                          onChange={(e) => setDraftForm({ ...draftForm, providerNpi: e.target.value })}
                          placeholder="NPI (optional)"
                        />
                        <Input
                          value={draftForm.providerLicense}
                          onChange={(e) => setDraftForm({ ...draftForm, providerLicense: e.target.value })}
                          placeholder="License # (optional)"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        The AI fills missing fields with "To be provided" rather than fabricating.
                      </p>
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="draft-payer">Payer *</Label>
                  <Input
                    id="draft-payer"
                    value={draftForm.payerName}
                    onChange={(e) => setDraftForm({ ...draftForm, payerName: e.target.value })}
                    placeholder="e.g. Aetna, Blue Cross Blue Shield"
                    data-testid="input-draft-payer"
                  />
                </div>
                <div>
                  <Label htmlFor="draft-notes">Additional notes (optional)</Label>
                  <Textarea
                    id="draft-notes"
                    value={draftForm.notes}
                    onChange={(e) => setDraftForm({ ...draftForm, notes: e.target.value })}
                    placeholder={
                      draftMode === 'packet'
                        ? 'Any payer-specific requirements or context you want reflected in the cover letter'
                        : 'Any provider history, specialties, or context the application should mention'
                    }
                    rows={3}
                  />
                </div>
              </div>
            )}

            {/* Step 2: results — packet */}
            {draftPacketResult && (
              <div className="space-y-3">
                <div className="p-3 rounded-md bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-100">
                  <strong>Summary:</strong> {draftPacketResult.summary}
                </div>
                <div>
                  <Label>Cover letter</Label>
                  <Textarea
                    value={draftPacketResult.coverLetter}
                    onChange={(e) =>
                      setDraftPacketResult({ ...draftPacketResult, coverLetter: e.target.value })
                    }
                    rows={16}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <Label>Document checklist</Label>
                  <div className="border rounded-md divide-y max-h-60 overflow-y-auto">
                    {draftPacketResult.documentChecklist?.map((d: any, i: number) => (
                      <div key={i} className="p-2 text-sm">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            defaultChecked={d.alreadyOnFile}
                            className="mt-0"
                          />
                          <span className="font-medium">{d.item}</span>
                          {d.alreadyOnFile && (
                            <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700">
                              On file
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground pl-6 mt-0.5">{d.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: results — application */}
            {draftAppResult && (
              <div className="space-y-3">
                <div className="p-3 rounded-md bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-100">
                  <strong>Summary:</strong> {draftAppResult.summary}
                </div>
                <div>
                  <Label>Cover letter</Label>
                  <Textarea
                    value={draftAppResult.coverLetter}
                    onChange={(e) =>
                      setDraftAppResult({ ...draftAppResult, coverLetter: e.target.value })
                    }
                    rows={14}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <Label>Prefilled application answers</Label>
                  <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
                    {draftAppResult.prefilledAnswers?.map((qa: any, i: number) => (
                      <div key={i} className="p-2 text-sm">
                        <div className="font-medium text-xs text-muted-foreground">
                          {qa.question}
                          <Badge
                            variant="outline"
                            className="ml-2 text-[9px] capitalize"
                          >
                            {qa.source}
                          </Badge>
                        </div>
                        <div className="text-sm mt-0.5">{qa.answer}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              {!draftPacketResult && !draftAppResult ? (
                <>
                  <Button variant="outline" onClick={resetDraft}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleGenerateDraft}
                    disabled={draftPacketMutation.isPending || draftAppMutation.isPending}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    data-testid="button-generate-credentialing-draft"
                  >
                    {draftPacketMutation.isPending || draftAppMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        Drafting…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-1" />
                        Generate with AI
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={resetDraft}>
                    Start over
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const text = draftPacketResult
                        ? `${draftPacketResult.coverLetter}\n\n--- Document checklist ---\n${
                            draftPacketResult.documentChecklist
                              ?.map((d: any) => `- [${d.alreadyOnFile ? 'x' : ' '}] ${d.item}: ${d.description}`)
                              .join('\n') ?? ''
                          }`
                        : `${draftAppResult.coverLetter}\n\n--- Application prefills ---\n${
                            draftAppResult.prefilledAnswers
                              ?.map((qa: any) => `Q: ${qa.question}\nA: ${qa.answer} [${qa.source}]`)
                              .join('\n\n') ?? ''
                          }`;
                      navigator.clipboard.writeText(text);
                      toast({ title: 'Copied to clipboard' });
                    }}
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Copy all
                  </Button>
                  <Button
                    onClick={async () => {
                      // Render server-side PDF with letterhead + appended
                      // sections (checklist for packet, Q&A for application).
                      const isPacket = Boolean(draftPacketResult);
                      const result = draftPacketResult || draftAppResult;
                      try {
                        const res = await fetch('/api/credentialing/render-letter-pdf', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({
                            mode: isPacket ? 'packet' : 'application',
                            letter: result.coverLetter,
                            payerName: draftForm.payerName.trim(),
                            documentChecklist: isPacket ? result.documentChecklist : undefined,
                            prefilledAnswers: !isPacket ? result.prefilledAnswers : undefined,
                          }),
                        });
                        if (!res.ok) throw new Error('PDF render failed');
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `credentialing-${isPacket ? 'packet' : 'application'}-${Date.now()}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      } catch {
                        toast({
                          title: 'PDF render failed',
                          description: 'Try Copy all and paste into a doc.',
                          variant: 'destructive',
                        });
                      }
                    }}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    Download PDF
                  </Button>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// ─── Documents (license PDFs, malpractice COIs, diplomas, etc.) ────
//
// Stored inline as base64 in provider_credentials.documents (JSONB).
// Per-file 4 MB cap, 10 files per credential. Server validates both.
// Trade-off vs. S3 — simple, no bucket setup, encrypted at rest by
// RDS. When usage grows, swap for S3 with presigned URLs (the
// list/upload/download endpoints already return metadata-only on
// list, so the swap is invisible to callers).

interface CredentialDocument {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

const DOC_MAX_SIZE = 4 * 1024 * 1024;
const DOC_ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];

function DocumentsSection({ credentialId }: { credentialId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputId = `cred-${credentialId}-doc-upload`;

  const { data: docs = [], isLoading } = useQuery<CredentialDocument[]>({
    queryKey: [`/api/credentialing/${credentialId}/documents`],
    queryFn: async () => {
      const res = await fetch(`/api/credentialing/${credentialId}/documents`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      const res = await apiRequest('POST', `/api/credentialing/${credentialId}/documents`, {
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        base64,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/credentialing/${credentialId}/documents`] });
      toast({ title: 'Document uploaded' });
    },
    onError: (err: any) => {
      toast({
        title: 'Upload failed',
        description: err?.message || 'Try a smaller PDF.',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      const res = await apiRequest('DELETE', `/api/credentialing/${credentialId}/documents/${docId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/credentialing/${credentialId}/documents`] });
      toast({ title: 'Document deleted' });
    },
    onError: (err: any) => {
      toast({ title: 'Delete failed', description: err?.message, variant: 'destructive' });
    },
  });

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!DOC_ALLOWED_TYPES.includes(file.type)) {
      toast({
        title: 'Unsupported file type',
        description: 'PDF, JPG, PNG, or HEIC only.',
        variant: 'destructive',
      });
      return;
    }
    if (file.size > DOC_MAX_SIZE) {
      toast({
        title: 'File too large',
        description: 'Max 4 MB per file. Reduce + retry.',
        variant: 'destructive',
      });
      return;
    }
    uploadMutation.mutate(file);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Supporting Documents</Label>
        <span className="text-xs text-muted-foreground">{docs.length}/10 · 4 MB max each</span>
      </div>
      <p className="text-xs text-muted-foreground">
        License PDFs, malpractice insurance certificate, diploma, CV. Required when submitting
        the enrollment packet to most payers.
      </p>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No documents uploaded yet.</p>
      ) : (
        <div className="border rounded-md divide-y">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between p-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{d.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {formatSize(d.sizeBytes)} · uploaded {new Date(d.uploadedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    window.open(`/api/credentialing/${credentialId}/documents/${d.id}`, '_blank');
                  }}
                  title="Download"
                >
                  Download
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(`Delete ${d.filename}?`)) deleteMutation.mutate(d.id);
                  }}
                  disabled={deleteMutation.isPending}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <input
          id={fileInputId}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/*"
          onChange={handleFileSelected}
          className="hidden"
          disabled={uploadMutation.isPending || docs.length >= 10}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => document.getElementById(fileInputId)?.click()}
          disabled={uploadMutation.isPending || docs.length >= 10}
        >
          {uploadMutation.isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Upload document
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

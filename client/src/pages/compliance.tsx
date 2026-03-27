import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  FileText,
  Clock,
  Plus,
  Bell,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// Types
interface ComplianceCheck {
  checkType: string;
  label: string;
  status: string;
  details: any;
  lastCheckedAt: string;
}

interface ComplianceDashboard {
  score: number;
  totalChecks: number;
  passCount: number;
  warningCount: number;
  failCount: number;
  notCheckedCount: number;
  checks: ComplianceCheck[];
  lastAssessedAt: string;
}

interface AuditLogEntry {
  id: number;
  eventCategory: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  userId: string | null;
  practiceId: number | null;
  ipAddress: string | null;
  details: any;
  success: boolean | null;
  createdAt: string;
}

interface AuditLogResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface BreachIncident {
  id: number;
  practiceId: number;
  discoveredAt: string;
  description: string;
  breachType: string;
  affectedIndividualsCount: number;
  phiInvolved: string | null;
  riskAssessment: string;
  remediationSteps: string | null;
  status: string;
  notificationStatus: string;
  notifiedIndividualsAt: string | null;
  notifiedHhsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Status badge helpers
function getStatusIcon(status: string) {
  switch (status) {
    case "pass": return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "warning": return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    case "fail": return <XCircle className="h-4 w-4 text-red-600" />;
    default: return <HelpCircle className="h-4 w-4 text-gray-400" />;
  }
}

function getStatusBadge(status: string) {
  const variants: Record<string, string> = {
    pass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    fail: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    not_checked: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  const labels: Record<string, string> = {
    pass: "Pass",
    warning: "Warning",
    fail: "Fail",
    not_checked: "Not Checked",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${variants[status] || variants.not_checked}`}>
      {getStatusIcon(status)}
      {labels[status] || "Unknown"}
    </span>
  );
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
}

function getProgressColor(score: number): string {
  if (score >= 80) return "[&>div]:bg-green-500";
  if (score >= 50) return "[&>div]:bg-yellow-500";
  return "[&>div]:bg-red-500";
}

// Notification status colors
const notificationStatusLabels: Record<string, string> = {
  pending: "Pending",
  individuals_notified: "Individuals Notified",
  hhs_notified: "HHS Notified",
  complete: "Complete",
};

const notificationStatusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  individuals_notified: "bg-blue-100 text-blue-800",
  hhs_notified: "bg-purple-100 text-purple-800",
  complete: "bg-green-100 text-green-800",
};

const breachStatusColors: Record<string, string> = {
  open: "bg-yellow-100 text-yellow-800",
  under_review: "bg-blue-100 text-blue-800",
  closed: "bg-green-100 text-green-800",
};

export default function CompliancePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [auditPage, setAuditPage] = useState(1);
  const [auditCategory, setAuditCategory] = useState<string>("all");
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<BreachIncident | null>(null);
  const [breachForm, setBreachForm] = useState({
    discoveredAt: "",
    description: "",
    breachType: "unauthorized_access",
    affectedIndividualsCount: 0,
    phiInvolved: "",
    riskAssessment: "low",
    remediationSteps: "",
  });

  // Queries
  const { data: dashboard, isLoading: dashLoading, refetch: refetchDashboard } = useQuery<ComplianceDashboard>({
    queryKey: ["/api/compliance/dashboard"],
  });

  const auditQueryParams = new URLSearchParams({
    page: String(auditPage),
    limit: "25",
    ...(auditCategory !== "all" ? { eventCategory: auditCategory } : {}),
  });
  const { data: auditData, isLoading: auditLoading } = useQuery<AuditLogResponse>({
    queryKey: [`/api/compliance/audit-log?${auditQueryParams.toString()}`],
    enabled: activeTab === "audit-log",
  });

  const { data: breachIncidents } = useQuery<BreachIncident[]>({
    queryKey: ["/api/compliance/breach-incidents"],
    enabled: activeTab === "breach-incidents",
  });

  // Mutations
  const runAssessment = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/compliance/dashboard");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/dashboard"] });
      toast({ title: "Assessment Complete", description: "Compliance checks have been refreshed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to run compliance assessment.", variant: "destructive" });
    },
  });

  const updateCheck = useMutation({
    mutationFn: async ({ checkType, status, notes }: { checkType: string; status: string; notes?: string }) => {
      const res = await apiRequest("PUT", `/api/compliance/checks/${checkType}`, { status, notes });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/dashboard"] });
      toast({ title: "Updated", description: "Compliance check status updated." });
    },
  });

  const createBreach = useMutation({
    mutationFn: async (data: typeof breachForm) => {
      const res = await apiRequest("POST", "/api/compliance/breach-incidents", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/breach-incidents"] });
      setShowReportDialog(false);
      setBreachForm({
        discoveredAt: "",
        description: "",
        breachType: "unauthorized_access",
        affectedIndividualsCount: 0,
        phiInvolved: "",
        riskAssessment: "low",
        remediationSteps: "",
      });
      toast({ title: "Incident Reported", description: "Breach incident has been recorded." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to report breach incident.", variant: "destructive" });
    },
  });

  const triggerNotify = useMutation({
    mutationFn: async ({ id, notifyType }: { id: number; notifyType: string }) => {
      const res = await apiRequest("POST", `/api/compliance/breach-incidents/${id}/notify`, { notifyType });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/breach-incidents"] });
      toast({ title: "Notification Sent", description: "Breach notification workflow triggered." });
    },
  });

  const updateIncident = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PUT", `/api/compliance/breach-incidents/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/breach-incidents"] });
      setSelectedIncident(null);
      toast({ title: "Updated", description: "Breach incident updated." });
    },
  });

  const score = dashboard?.score ?? 0;
  const checks = dashboard?.checks ?? [];

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6" />
            HIPAA Compliance Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Self-assessment posture and breach incident management
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="dashboard">Compliance Posture</TabsTrigger>
          <TabsTrigger value="audit-log">Audit Log</TabsTrigger>
          <TabsTrigger value="breach-incidents">Breach Incidents</TabsTrigger>
        </TabsList>

        {/* ===== COMPLIANCE DASHBOARD TAB ===== */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* Score Card */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Overall Compliance Score</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col items-center justify-center py-4">
                  <div className={`text-5xl font-bold ${getScoreColor(score)}`}>
                    {dashLoading ? "--" : `${score}%`}
                  </div>
                  <Progress value={score} className={`mt-4 w-full h-3 ${getProgressColor(score)}`} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    <span>{dashboard?.passCount ?? 0} Passing</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />
                    <span>{dashboard?.warningCount ?? 0} Warnings</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <XCircle className="h-3.5 w-3.5 text-red-600" />
                    <span>{dashboard?.failCount ?? 0} Failing</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <HelpCircle className="h-3.5 w-3.5 text-gray-400" />
                    <span>{dashboard?.notCheckedCount ?? 0} Unchecked</span>
                  </div>
                </div>
                <Button
                  className="w-full mt-2"
                  onClick={() => runAssessment.mutate()}
                  disabled={runAssessment.isPending}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${runAssessment.isPending ? "animate-spin" : ""}`} />
                  {runAssessment.isPending ? "Running..." : "Run Assessment"}
                </Button>
                {dashboard?.lastAssessedAt && (
                  <p className="text-xs text-muted-foreground text-center">
                    Last assessed: {new Date(dashboard.lastAssessedAt).toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Checklist */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Compliance Checklist</CardTitle>
                <CardDescription>HIPAA Security Rule requirements and safeguards</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dashLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading compliance checks...</div>
                  ) : checks.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No compliance data yet. Click "Run Assessment" to get started.
                    </div>
                  ) : (
                    checks.map((check) => (
                      <div
                        key={check.checkType}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {getStatusIcon(check.status)}
                          <div>
                            <div className="font-medium text-sm">{check.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {check.details?.note
                                ? check.details.note
                                : check.checkType === "mfa_enforcement"
                                  ? `${check.details?.mfaEnabled ?? 0}/${check.details?.totalUsers ?? 0} users with MFA`
                                  : check.checkType === "encryption_enabled"
                                    ? check.details?.encryptionKeyConfigured ? "PHI encryption key configured" : "PHI encryption key not set"
                                    : check.checkType === "audit_logging"
                                      ? `${check.details?.recentEntries ?? 0} entries in last 24h`
                                      : check.checkType === "baa_signed"
                                        ? `${check.details?.active ?? 0} active, ${check.details?.expired ?? 0} expired BAAs`
                                        : check.checkType === "access_controls"
                                          ? `Roles in use: ${(check.details?.rolesInUse ?? []).join(", ") || "none"}`
                                          : ""}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(check.status)}
                          {["data_retention", "breach_notification_plan", "risk_assessment", "training_completed", "backup_verified"].includes(check.checkType) && (
                            <Select
                              value={check.status}
                              onValueChange={(val) => updateCheck.mutate({ checkType: check.checkType, status: val })}
                            >
                              <SelectTrigger className="w-[100px] h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pass">Pass</SelectItem>
                                <SelectItem value="warning">Warning</SelectItem>
                                <SelectItem value="fail">Fail</SelectItem>
                                <SelectItem value="not_checked">Not Checked</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== AUDIT LOG TAB ===== */}
        <TabsContent value="audit-log" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    HIPAA Audit Log
                  </CardTitle>
                  <CardDescription>Complete record of system access and data operations</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={auditCategory} onValueChange={(val) => { setAuditCategory(val); setAuditPage(1); }}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="auth">Authentication</SelectItem>
                      <SelectItem value="phi_access">PHI Access</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="data_export">Data Export</SelectItem>
                      <SelectItem value="breach">Breach</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading audit log...</div>
              ) : !auditData || auditData.logs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No audit log entries found.</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-2 pr-4 font-medium">Timestamp</th>
                          <th className="pb-2 pr-4 font-medium">Category</th>
                          <th className="pb-2 pr-4 font-medium">Event</th>
                          <th className="pb-2 pr-4 font-medium">Resource</th>
                          <th className="pb-2 pr-4 font-medium">User</th>
                          <th className="pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditData.logs.map((entry) => (
                          <tr key={entry.id} className="border-b last:border-0 hover:bg-accent/50">
                            <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(entry.createdAt).toLocaleString()}
                            </td>
                            <td className="py-2 pr-4">
                              <Badge variant="outline" className="text-xs">
                                {entry.eventCategory}
                              </Badge>
                            </td>
                            <td className="py-2 pr-4 text-xs">{entry.eventType}</td>
                            <td className="py-2 pr-4 text-xs">
                              {entry.resourceType && (
                                <span>
                                  {entry.resourceType}
                                  {entry.resourceId && <span className="text-muted-foreground"> #{entry.resourceId}</span>}
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{entry.userId || "-"}</td>
                            <td className="py-2">
                              {entry.success !== false ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5 text-red-600" />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      Showing {((auditData.page - 1) * auditData.limit) + 1}-{Math.min(auditData.page * auditData.limit, auditData.total)} of {auditData.total} entries
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={auditPage <= 1}
                        onClick={() => setAuditPage(p => p - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm">Page {auditData.page} of {auditData.totalPages}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={auditPage >= auditData.totalPages}
                        onClick={() => setAuditPage(p => p + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== BREACH INCIDENTS TAB ===== */}
        <TabsContent value="breach-incidents" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" />
                Breach Incidents
              </h2>
              <p className="text-sm text-muted-foreground">
                Track and manage HIPAA breach incidents per 45 CFR 164.400-414
              </p>
            </div>
            <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Report Incident
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Report Breach Incident</DialogTitle>
                  <DialogDescription>
                    Document a potential or confirmed HIPAA breach incident.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Date Discovered</Label>
                    <Input
                      type="datetime-local"
                      value={breachForm.discoveredAt}
                      onChange={(e) => setBreachForm(prev => ({ ...prev, discoveredAt: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Breach Type</Label>
                    <Select
                      value={breachForm.breachType}
                      onValueChange={(val) => setBreachForm(prev => ({ ...prev, breachType: val }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unauthorized_access">Unauthorized Access</SelectItem>
                        <SelectItem value="data_loss">Data Loss</SelectItem>
                        <SelectItem value="theft">Theft</SelectItem>
                        <SelectItem value="hacking">Hacking</SelectItem>
                        <SelectItem value="improper_disposal">Improper Disposal</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={breachForm.description}
                      onChange={(e) => setBreachForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe the breach incident..."
                      rows={3}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Affected Individuals</Label>
                      <Input
                        type="number"
                        min={0}
                        value={breachForm.affectedIndividualsCount}
                        onChange={(e) => setBreachForm(prev => ({ ...prev, affectedIndividualsCount: parseInt(e.target.value, 10) || 0 }))}
                      />
                    </div>
                    <div>
                      <Label>Risk Assessment</Label>
                      <Select
                        value={breachForm.riskAssessment}
                        onValueChange={(val) => setBreachForm(prev => ({ ...prev, riskAssessment: val }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>PHI Involved</Label>
                    <Input
                      value={breachForm.phiInvolved}
                      onChange={(e) => setBreachForm(prev => ({ ...prev, phiInvolved: e.target.value }))}
                      placeholder="Types of PHI involved..."
                    />
                  </div>
                  <div>
                    <Label>Remediation Steps</Label>
                    <Textarea
                      value={breachForm.remediationSteps}
                      onChange={(e) => setBreachForm(prev => ({ ...prev, remediationSteps: e.target.value }))}
                      placeholder="Steps taken or planned to contain the breach..."
                      rows={2}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowReportDialog(false)}>Cancel</Button>
                  <Button
                    onClick={() => createBreach.mutate(breachForm)}
                    disabled={createBreach.isPending || !breachForm.discoveredAt || !breachForm.description}
                  >
                    {createBreach.isPending ? "Reporting..." : "Report Incident"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Incident Detail View */}
          {selectedIncident ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Incident #{selectedIncident.id} - {selectedIncident.breachType.replace(/_/g, " ")}
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIncident(null)}>
                    Back to List
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <div className="mt-1">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${breachStatusColors[selectedIncident.status] || ""}`}>
                        {selectedIncident.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Risk</Label>
                    <div className="mt-1">
                      <Badge variant="outline">{selectedIncident.riskAssessment}</Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Affected</Label>
                    <div className="mt-1 font-medium">{selectedIncident.affectedIndividualsCount} individuals</div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Discovered</Label>
                    <div className="mt-1 text-sm">{new Date(selectedIncident.discoveredAt).toLocaleDateString()}</div>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <p className="mt-1 text-sm">{selectedIncident.description}</p>
                </div>

                {selectedIncident.phiInvolved && (
                  <div>
                    <Label className="text-xs text-muted-foreground">PHI Involved</Label>
                    <p className="mt-1 text-sm">{selectedIncident.phiInvolved}</p>
                  </div>
                )}

                {selectedIncident.remediationSteps && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Remediation Steps</Label>
                    <p className="mt-1 text-sm">{selectedIncident.remediationSteps}</p>
                  </div>
                )}

                {/* Notification Timeline */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-3 block">Notification Timeline</Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded border">
                      <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4" />
                        <span className="text-sm">Notify Affected Individuals</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedIncident.notifiedIndividualsAt ? (
                          <span className="text-xs text-green-600">
                            Notified {new Date(selectedIncident.notifiedIndividualsAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => triggerNotify.mutate({ id: selectedIncident.id, notifyType: "individuals" })}
                            disabled={triggerNotify.isPending}
                          >
                            Send Notification
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded border">
                      <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4" />
                        <span className="text-sm">Notify HHS (required within 60 days)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedIncident.notifiedHhsAt ? (
                          <span className="text-xs text-green-600">
                            Notified {new Date(selectedIncident.notifiedHhsAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => triggerNotify.mutate({ id: selectedIncident.id, notifyType: "hhs" })}
                            disabled={triggerNotify.isPending}
                          >
                            Send Notification
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status actions */}
                <div className="flex items-center gap-2 pt-4 border-t">
                  <Label className="text-xs text-muted-foreground mr-2">Update Status:</Label>
                  {selectedIncident.status !== "closed" && (
                    <>
                      {selectedIncident.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateIncident.mutate({ id: selectedIncident.id, data: { status: "under_review" } })}
                        >
                          Mark Under Review
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateIncident.mutate({ id: selectedIncident.id, data: { status: "closed" } })}
                      >
                        Close Incident
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            /* Incident List */
            <div className="space-y-3">
              {!breachIncidents || breachIncidents.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <ShieldCheck className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No breach incidents recorded.</p>
                    <p className="text-xs mt-1">Use the "Report Incident" button to document any breach events.</p>
                  </CardContent>
                </Card>
              ) : (
                breachIncidents.map((incident) => (
                  <Card
                    key={incident.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => setSelectedIncident(incident)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <ShieldAlert className="h-5 w-5 text-red-500" />
                          <div>
                            <div className="font-medium text-sm">
                              {incident.breachType.replace(/_/g, " ")} - #{incident.id}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Discovered: {new Date(incident.discoveredAt).toLocaleDateString()} | {incident.affectedIndividualsCount} affected
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${breachStatusColors[incident.status] || ""}`}>
                            {incident.status.replace(/_/g, " ")}
                          </span>
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${notificationStatusColors[incident.notificationStatus] || ""}`}>
                            {notificationStatusLabels[incident.notificationStatus] || incident.notificationStatus}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{incident.description}</p>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  ShieldAlert, Plus, AlertTriangle, Clock, Users, Activity,
  Bell, FileText, Send, CheckCircle, XCircle, AlertOctagon,
  Building, Mail, Newspaper,
} from "lucide-react";

interface BreachIncident {
  id: number;
  practiceId: number;
  discoveredAt: string;
  breachDate: string | null;
  description: string;
  breachType: string;
  affectedIndividualsCount: number;
  phiInvolved: string | null;
  phiTypesInvolved: string | null;
  riskAssessment: string;
  remediationSteps: string | null;
  mitigationSteps: string | null;
  status: string;
  notificationStatus: string;
  notifiedIndividualsAt: string | null;
  notifiedHhsAt: string | null;
  notifiedMediaAt: string | null;
  notifiedStateAgAt: string | null;
  notificationDeadline: string;
  requiresMediaNotification: boolean;
  stateJurisdictions: string | null;
  hhsReportData: string | null;
  daysUntilDeadline: number;
  isOverdue: boolean;
  requiresHhsImmediate: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DashboardData {
  totalIncidents: number;
  activeIncidents: number;
  pendingNotifications: number;
  overdueCount: number;
  overdueNotifications: Array<{
    id: number;
    description: string;
    discoveredAt: string;
    affectedCount: number;
    notificationStatus: string;
  }>;
  upcomingDeadlines: Array<{
    incidentId: number;
    deadline: string;
    daysRemaining: number;
  }>;
  largeBreachCount: number;
  mediaNotificationRequired: number;
  stateAgPending: number;
  annualLogItems: number;
  complianceStatus: string;
}

const statusColors: Record<string, string> = {
  detected: "bg-red-100 text-red-800",
  investigating: "bg-orange-100 text-orange-800",
  contained: "bg-yellow-100 text-yellow-800",
  notifying: "bg-blue-100 text-blue-800",
  resolved: "bg-green-100 text-green-800",
  // Legacy statuses
  open: "bg-yellow-100 text-yellow-800",
  under_review: "bg-blue-100 text-blue-800",
  closed: "bg-green-100 text-green-800",
};

const riskColors: Record<string, string> = {
  low: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-red-100 text-red-800",
};

const notificationColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  individuals_notified: "bg-blue-100 text-blue-800",
  hhs_notified: "bg-purple-100 text-purple-800",
  complete: "bg-green-100 text-green-800",
};

const complianceStatusColors: Record<string, string> = {
  compliant: "bg-green-100 text-green-800",
  action_required: "bg-yellow-100 text-yellow-800",
  non_compliant: "bg-red-100 text-red-800",
};

const BREACH_TYPES = [
  { value: "unauthorized_access", label: "Unauthorized Access" },
  { value: "theft", label: "Theft" },
  { value: "loss", label: "Loss" },
  { value: "improper_disposal", label: "Improper Disposal" },
  { value: "hacking", label: "Hacking/IT Incident" },
  { value: "other", label: "Other" },
];

const PHI_TYPES = [
  { value: "names", label: "Names" },
  { value: "ssn", label: "Social Security Numbers" },
  { value: "dob", label: "Dates of Birth" },
  { value: "diagnosis", label: "Diagnosis/Condition Information" },
  { value: "treatment", label: "Treatment Information" },
  { value: "insurance", label: "Health Insurance Information" },
  { value: "financial", label: "Financial/Billing Information" },
  { value: "contact", label: "Contact Information" },
  { value: "medical_record", label: "Medical Record Numbers" },
  { value: "medications", label: "Medication Information" },
];

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming",
];

const STATUS_FLOW = ["detected", "investigating", "contained", "notifying", "resolved"];

export default function BreachIncidentsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<BreachIncident | null>(null);
  const [showNotifyDialog, setShowNotifyDialog] = useState<{ type: string; incidentId: number } | null>(null);
  const [selectedPhiTypes, setSelectedPhiTypes] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [form, setForm] = useState({
    discoveredAt: "",
    breachDate: "",
    description: "",
    breachType: "",
    affectedIndividualsCount: 0,
    riskAssessment: "low",
    remediationSteps: "",
    mitigationSteps: "",
  });

  // Dashboard data
  const { data: dashboard } = useQuery<DashboardData>({
    queryKey: ["/api/breach-management/dashboard"],
  });

  // Incidents list
  const { data: rawIncidents } = useQuery<BreachIncident[]>({
    queryKey: ["/api/breach-management/incidents"],
  });
  const incidents = rawIncidents ?? [];

  // Create incident
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiRequest("POST", "/api/breach-management/incidents", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/breach-management/incidents"] });
      qc.invalidateQueries({ queryKey: ["/api/breach-management/dashboard"] });
      setShowCreate(false);
      setForm({ discoveredAt: "", breachDate: "", description: "", breachType: "", affectedIndividualsCount: 0, riskAssessment: "low", remediationSteps: "", mitigationSteps: "" });
      setSelectedPhiTypes([]);
      setSelectedStates([]);
      toast({ title: "Breach Reported", description: "Incident has been created and notification deadline set." });
    },
    onError: () => toast({ title: "Error", description: "Failed to create breach incident.", variant: "destructive" }),
  });

  // Update incident
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/breach-management/incidents/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/breach-management/incidents"] });
      qc.invalidateQueries({ queryKey: ["/api/breach-management/dashboard"] });
      toast({ title: "Updated", description: "Incident updated." });
    },
  });

  // Notification mutations
  const notifyIndividualsMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/breach-management/incidents/${id}/notify-individuals`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/breach-management/incidents"] });
      qc.invalidateQueries({ queryKey: ["/api/breach-management/dashboard"] });
      setShowNotifyDialog(null);
      toast({ title: "Individuals Notified", description: "Patient breach notification workflow initiated." });
    },
  });

  const notifyHhsMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/breach-management/incidents/${id}/notify-hhs`, {}),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/breach-management/incidents"] });
      qc.invalidateQueries({ queryKey: ["/api/breach-management/dashboard"] });
      setShowNotifyDialog(null);
      toast({ title: "HHS Report Generated", description: "Submit the report at the HHS Breach Portal." });
    },
  });

  const notifyStateAgMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/breach-management/incidents/${id}/notify-state-ag`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/breach-management/incidents"] });
      qc.invalidateQueries({ queryKey: ["/api/breach-management/dashboard"] });
      setShowNotifyDialog(null);
      toast({ title: "State AG Letter Generated", description: "Review and send the notification letter." });
    },
  });

  const notifyMediaMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/breach-management/incidents/${id}/notify-media`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/breach-management/incidents"] });
      qc.invalidateQueries({ queryKey: ["/api/breach-management/dashboard"] });
      setShowNotifyDialog(null);
      toast({ title: "Media Notification Recorded", description: "Media notification has been logged." });
    },
  });

  const handleCreate = () => {
    createMutation.mutate({
      ...form,
      phiTypesInvolved: selectedPhiTypes,
      stateJurisdictions: selectedStates,
    });
  };

  const handleStatusTransition = (incident: BreachIncident, newStatus: string) => {
    updateMutation.mutate({ id: incident.id, data: { status: newStatus } });
    if (selectedIncident?.id === incident.id) {
      setSelectedIncident({ ...selectedIncident, status: newStatus });
    }
  };

  const getNextStatus = (current: string): string | null => {
    const idx = STATUS_FLOW.indexOf(current);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return null;
    return STATUS_FLOW[idx + 1];
  };

  const togglePhiType = (value: string) => {
    setSelectedPhiTypes(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const toggleState = (state: string) => {
    setSelectedStates(prev => prev.includes(state) ? prev.filter(s => s !== state) : [...prev, state]);
  };

  const formatDate = (d: string | null) => {
    if (!d) return "N/A";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="md:ml-64 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Breach Management</h1>
            <p className="text-slate-600 dark:text-slate-400">HIPAA Breach Notification Rule compliance (45 CFR 164.400-414)</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Report Breach</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Report Breach Incident</DialogTitle>
                <DialogDescription>Document a new HIPAA breach incident. A 60-day notification deadline will be automatically calculated.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Date Discovered *</Label>
                    <Input type="date" value={form.discoveredAt} onChange={(e) => setForm({ ...form, discoveredAt: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Date of Breach (if known)</Label>
                    <Input type="date" value={form.breachDate} onChange={(e) => setForm({ ...form, breachDate: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description *</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe what happened, how it was discovered, and the scope of the breach..." rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Breach Type *</Label>
                    <Select value={form.breachType} onValueChange={(v) => setForm({ ...form, breachType: v })}>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        {BREACH_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Risk Assessment</Label>
                    <Select value={form.riskAssessment} onValueChange={(v) => setForm({ ...form, riskAssessment: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Number of Individuals Affected</Label>
                  <Input type="number" min={0} value={form.affectedIndividualsCount} onChange={(e) => setForm({ ...form, affectedIndividualsCount: parseInt(e.target.value) || 0 })} />
                  {form.affectedIndividualsCount >= 500 && (
                    <p className="text-sm text-red-600 font-medium">This breach affects 500+ individuals. HHS and media notification required within 60 days.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>PHI Types Involved</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {PHI_TYPES.map(t => (
                      <label key={t.value} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={selectedPhiTypes.includes(t.value)} onChange={() => togglePhiType(t.value)} className="rounded" />
                        {t.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Affected State Jurisdictions</Label>
                  <div className="max-h-32 overflow-y-auto border rounded p-2 grid grid-cols-3 gap-1">
                    {US_STATES.map(s => (
                      <label key={s} className="flex items-center gap-1 text-xs cursor-pointer">
                        <input type="checkbox" checked={selectedStates.includes(s)} onChange={() => toggleState(s)} className="rounded" />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Mitigation Steps (for affected individuals)</Label>
                  <Textarea value={form.mitigationSteps} onChange={(e) => setForm({ ...form, mitigationSteps: e.target.value })} placeholder="What steps are being taken to mitigate harm to affected individuals..." rows={2} />
                </div>
                <div className="space-y-2">
                  <Label>Remediation Steps (internal)</Label>
                  <Textarea value={form.remediationSteps} onChange={(e) => setForm({ ...form, remediationSteps: e.target.value })} placeholder="Internal steps taken to prevent recurrence..." rows={2} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending || !form.discoveredAt || !form.description || !form.breachType}>
                  {createMutation.isPending ? "Creating..." : "Report Breach"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="incidents">Incident Log</TabsTrigger>
            <TabsTrigger value="notifications">Notification Tracker</TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Active Incidents</p>
                      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{dashboard?.activeIncidents ?? 0}</p>
                    </div>
                    <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                      <ShieldAlert className="w-6 h-6 text-orange-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Pending Notifications</p>
                      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{dashboard?.pendingNotifications ?? 0}</p>
                    </div>
                    <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
                      <Bell className="w-6 h-6 text-yellow-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Overdue</p>
                      <p className="text-2xl font-bold" style={{ color: (dashboard?.overdueCount ?? 0) > 0 ? '#dc2626' : '#16a34a' }}>{dashboard?.overdueCount ?? 0}</p>
                    </div>
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${(dashboard?.overdueCount ?? 0) > 0 ? 'bg-red-100' : 'bg-green-100'}`}>
                      <AlertOctagon className={`w-6 h-6 ${(dashboard?.overdueCount ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Compliance</p>
                      <Badge className={complianceStatusColors[dashboard?.complianceStatus || 'compliant'] || 'bg-gray-100'}>
                        {(dashboard?.complianceStatus || 'compliant').replace(/_/g, ' ').toUpperCase()}
                      </Badge>
                    </div>
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                      <CheckCircle className="w-6 h-6 text-blue-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Overdue alerts */}
            {(dashboard?.overdueCount ?? 0) > 0 && (
              <Card className="mb-6 border-red-200 bg-red-50 dark:bg-red-950/20">
                <CardHeader>
                  <CardTitle className="text-red-800 dark:text-red-400 flex items-center gap-2">
                    <AlertOctagon className="w-5 h-5" /> Overdue Notifications
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                    The following incidents have exceeded the 60-day HIPAA notification deadline. Immediate action is required.
                  </p>
                  {dashboard?.overdueNotifications.map(n => (
                    <div key={n.id} className="flex items-center justify-between py-2 border-b border-red-200 last:border-0">
                      <div>
                        <span className="font-medium text-red-900 dark:text-red-200">BR-{String(n.id).padStart(4, "0")}</span>
                        <span className="ml-2 text-sm text-red-700 dark:text-red-300">{n.description?.substring(0, 80)}...</span>
                      </div>
                      <Badge className="bg-red-200 text-red-800">{n.affectedCount} affected</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Upcoming deadlines */}
            {(dashboard?.upcomingDeadlines?.length ?? 0) > 0 && (
              <Card className="mb-6 border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
                <CardHeader>
                  <CardTitle className="text-yellow-800 dark:text-yellow-400 flex items-center gap-2">
                    <Clock className="w-5 h-5" /> Upcoming Deadlines (Next 14 Days)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dashboard?.upcomingDeadlines.map(d => (
                    <div key={d.incidentId} className="flex items-center justify-between py-2 border-b border-yellow-200 last:border-0">
                      <span className="font-medium">BR-{String(d.incidentId).padStart(4, "0")}</span>
                      <div className="text-right">
                        <span className="text-sm text-yellow-800 dark:text-yellow-300">{formatDate(d.deadline)}</span>
                        <Badge className="ml-2 bg-yellow-200 text-yellow-800">{d.daysRemaining} days</Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium text-slate-600">HHS Reporting</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Large breaches (500+)</span>
                      <Badge variant="outline">{dashboard?.largeBreachCount ?? 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Annual log items (&lt;500)</span>
                      <Badge variant="outline">{dashboard?.annualLogItems ?? 0}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium text-slate-600">State AG Notifications</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex justify-between text-sm">
                    <span>Pending notifications</span>
                    <Badge variant="outline">{dashboard?.stateAgPending ?? 0}</Badge>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium text-slate-600">Media Notifications</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex justify-between text-sm">
                    <span>Required (500+ in state)</span>
                    <Badge variant="outline">{dashboard?.mediaNotificationRequired ?? 0}</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Incident Log Tab */}
          <TabsContent value="incidents">
            <Card>
              <CardContent className="pt-6">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-medium text-slate-600">ID</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Discovered</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Description</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Type</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Affected</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Risk</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Status</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Deadline</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidents.map((inc) => (
                        <tr key={inc.id} className="border-b hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer" onClick={() => setSelectedIncident(inc)}>
                          <td className="py-3 px-4 font-mono text-sm">BR-{String(inc.id).padStart(4, "0")}</td>
                          <td className="py-3 px-4 text-sm">{formatDate(inc.discoveredAt)}</td>
                          <td className="py-3 px-4 max-w-[200px] truncate text-sm">{inc.description}</td>
                          <td className="py-3 px-4"><Badge variant="outline" className="text-xs">{inc.breachType?.replace(/_/g, " ")}</Badge></td>
                          <td className="py-3 px-4 text-sm">
                            {inc.affectedIndividualsCount}
                            {inc.requiresHhsImmediate && <Badge className="ml-1 bg-red-100 text-red-700 text-xs">500+</Badge>}
                          </td>
                          <td className="py-3 px-4"><Badge className={`text-xs ${riskColors[inc.riskAssessment] || "bg-gray-100 text-gray-800"}`}>{inc.riskAssessment}</Badge></td>
                          <td className="py-3 px-4"><Badge className={`text-xs ${statusColors[inc.status] || "bg-gray-100 text-gray-800"}`}>{inc.status?.replace(/_/g, " ")}</Badge></td>
                          <td className="py-3 px-4 text-sm">
                            {inc.isOverdue ? (
                              <Badge className="bg-red-100 text-red-800 text-xs">OVERDUE</Badge>
                            ) : inc.notificationStatus === 'complete' ? (
                              <Badge className="bg-green-100 text-green-800 text-xs">Complete</Badge>
                            ) : (
                              <span className={inc.daysUntilDeadline <= 14 ? 'text-yellow-700 font-medium' : ''}>
                                {inc.daysUntilDeadline}d
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedIncident(inc); }}>View</Button>
                          </td>
                        </tr>
                      ))}
                      {incidents.length === 0 && (
                        <tr><td colSpan={9} className="py-8 text-center text-slate-500">No breach incidents recorded.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notification Tracker Tab */}
          <TabsContent value="notifications">
            <div className="space-y-4">
              {incidents.filter(i => i.status !== 'resolved').length === 0 ? (
                <Card><CardContent className="py-12 text-center text-slate-500">No active incidents requiring notification.</CardContent></Card>
              ) : (
                incidents.filter(i => i.status !== 'resolved').map(inc => (
                  <Card key={inc.id} className={inc.isOverdue ? 'border-red-300' : ''}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-semibold text-lg">BR-{String(inc.id).padStart(4, "0")} - {inc.breachType?.replace(/_/g, " ")}</h3>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{inc.description?.substring(0, 120)}{(inc.description?.length ?? 0) > 120 ? '...' : ''}</p>
                        </div>
                        <div className="text-right">
                          <Badge className={`${notificationColors[inc.notificationStatus] || 'bg-gray-100'} mb-1`}>
                            {inc.notificationStatus?.replace(/_/g, " ")}
                          </Badge>
                          <p className="text-xs text-slate-500 mt-1">
                            Deadline: {formatDate(inc.notificationDeadline)}
                            {inc.isOverdue && <span className="text-red-600 font-bold ml-1">(OVERDUE)</span>}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        {/* Individual Notification */}
                        <div className={`p-3 rounded-lg border ${inc.notifiedIndividualsAt ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <Mail className="w-4 h-4" />
                            <span className="text-sm font-medium">Individuals</span>
                          </div>
                          {inc.notifiedIndividualsAt ? (
                            <p className="text-xs text-green-700">{formatDate(inc.notifiedIndividualsAt)}</p>
                          ) : (
                            <Button size="sm" variant="outline" className="w-full mt-1 text-xs" onClick={() => setShowNotifyDialog({ type: 'individuals', incidentId: inc.id })}>
                              <Send className="w-3 h-3 mr-1" />Notify
                            </Button>
                          )}
                        </div>
                        {/* HHS Notification */}
                        <div className={`p-3 rounded-lg border ${inc.notifiedHhsAt ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <Building className="w-4 h-4" />
                            <span className="text-sm font-medium">HHS</span>
                          </div>
                          {inc.requiresHhsImmediate && !inc.notifiedHhsAt && (
                            <p className="text-xs text-red-600 font-medium mb-1">Required (500+)</p>
                          )}
                          {inc.notifiedHhsAt ? (
                            <p className="text-xs text-green-700">{formatDate(inc.notifiedHhsAt)}</p>
                          ) : (
                            <Button size="sm" variant="outline" className="w-full mt-1 text-xs" onClick={() => setShowNotifyDialog({ type: 'hhs', incidentId: inc.id })}>
                              <FileText className="w-3 h-3 mr-1" />Generate
                            </Button>
                          )}
                        </div>
                        {/* State AG */}
                        <div className={`p-3 rounded-lg border ${inc.notifiedStateAgAt ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <Building className="w-4 h-4" />
                            <span className="text-sm font-medium">State AG</span>
                          </div>
                          {inc.notifiedStateAgAt ? (
                            <p className="text-xs text-green-700">{formatDate(inc.notifiedStateAgAt)}</p>
                          ) : (
                            <Button size="sm" variant="outline" className="w-full mt-1 text-xs" onClick={() => setShowNotifyDialog({ type: 'state_ag', incidentId: inc.id })}>
                              <FileText className="w-3 h-3 mr-1" />Generate
                            </Button>
                          )}
                        </div>
                        {/* Media */}
                        <div className={`p-3 rounded-lg border ${inc.notifiedMediaAt ? 'bg-green-50 border-green-200' : inc.requiresMediaNotification ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <Newspaper className="w-4 h-4" />
                            <span className="text-sm font-medium">Media</span>
                          </div>
                          {inc.requiresMediaNotification && !inc.notifiedMediaAt && (
                            <p className="text-xs text-red-600 font-medium mb-1">Required (500+)</p>
                          )}
                          {inc.notifiedMediaAt ? (
                            <p className="text-xs text-green-700">{formatDate(inc.notifiedMediaAt)}</p>
                          ) : inc.requiresMediaNotification ? (
                            <Button size="sm" variant="outline" className="w-full mt-1 text-xs" onClick={() => setShowNotifyDialog({ type: 'media', incidentId: inc.id })}>
                              <Send className="w-3 h-3 mr-1" />Record
                            </Button>
                          ) : (
                            <p className="text-xs text-slate-500">Not required</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Notification Confirmation Dialog */}
        <Dialog open={!!showNotifyDialog} onOpenChange={(open) => { if (!open) setShowNotifyDialog(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {showNotifyDialog?.type === 'individuals' && 'Send Individual Notifications'}
                {showNotifyDialog?.type === 'hhs' && 'Generate HHS Breach Report'}
                {showNotifyDialog?.type === 'state_ag' && 'Generate State AG Notification'}
                {showNotifyDialog?.type === 'media' && 'Record Media Notification'}
              </DialogTitle>
              <DialogDescription>
                {showNotifyDialog?.type === 'individuals' && 'This will generate patient breach notification letters per 45 CFR 164.404. Letters must include: description of breach, types of PHI involved, protective steps, mitigation actions, and contact information.'}
                {showNotifyDialog?.type === 'hhs' && 'This will generate the breach report data for submission to the HHS Breach Portal (ocrportal.hhs.gov). For breaches affecting 500+ individuals, this must be submitted within 60 days of discovery.'}
                {showNotifyDialog?.type === 'state_ag' && 'This will generate notification letter templates for each affected state Attorney General per state breach notification laws.'}
                {showNotifyDialog?.type === 'media' && 'Per 45 CFR 164.406, prominent media outlets must be notified when 500+ individuals in a single state are affected. Record that media notification has been completed.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNotifyDialog(null)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (!showNotifyDialog) return;
                  const { type, incidentId } = showNotifyDialog;
                  if (type === 'individuals') notifyIndividualsMutation.mutate(incidentId);
                  else if (type === 'hhs') notifyHhsMutation.mutate(incidentId);
                  else if (type === 'state_ag') notifyStateAgMutation.mutate(incidentId);
                  else if (type === 'media') notifyMediaMutation.mutate(incidentId);
                }}
                disabled={notifyIndividualsMutation.isPending || notifyHhsMutation.isPending || notifyStateAgMutation.isPending || notifyMediaMutation.isPending}
              >
                {showNotifyDialog?.type === 'hhs' || showNotifyDialog?.type === 'state_ag' ? 'Generate' : 'Confirm'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Incident Detail Dialog */}
        <Dialog open={!!selectedIncident} onOpenChange={(open) => { if (!open) setSelectedIncident(null); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Breach Incident BR-{String(selectedIncident?.id || 0).padStart(4, "0")}</DialogTitle>
              <DialogDescription>Full incident details, status management, and notification tracking.</DialogDescription>
            </DialogHeader>
            {selectedIncident && (
              <div className="space-y-4 py-4">
                {/* Status Flow */}
                <div className="flex items-center gap-1 mb-4">
                  {STATUS_FLOW.map((s, idx) => {
                    const isActive = STATUS_FLOW.indexOf(selectedIncident.status) >= idx;
                    const isCurrent = selectedIncident.status === s;
                    return (
                      <div key={s} className="flex items-center gap-1">
                        <div className={`px-3 py-1 rounded-full text-xs font-medium ${isCurrent ? 'bg-blue-600 text-white' : isActive ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-400'}`}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </div>
                        {idx < STATUS_FLOW.length - 1 && <span className={`text-xs ${isActive ? 'text-blue-400' : 'text-slate-300'}`}>&rarr;</span>}
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div><Label className="text-slate-500">Discovered</Label><p className="font-medium">{formatDate(selectedIncident.discoveredAt)}</p></div>
                  <div><Label className="text-slate-500">Breach Date</Label><p className="font-medium">{formatDate(selectedIncident.breachDate)}</p></div>
                  <div><Label className="text-slate-500">Type</Label><p className="font-medium">{selectedIncident.breachType?.replace(/_/g, " ")}</p></div>
                  <div><Label className="text-slate-500">Affected Individuals</Label><p className="font-medium">{selectedIncident.affectedIndividualsCount}</p></div>
                  <div><Label className="text-slate-500">Risk</Label><Badge className={riskColors[selectedIncident.riskAssessment] || "bg-gray-100"}>{selectedIncident.riskAssessment}</Badge></div>
                  <div><Label className="text-slate-500">Notification Deadline</Label><p className="font-medium">{formatDate(selectedIncident.notificationDeadline)}</p></div>
                </div>

                {selectedIncident.phiTypesInvolved && (
                  <div>
                    <Label className="text-slate-500">PHI Types Involved</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(() => {
                        try {
                          return (JSON.parse(selectedIncident.phiTypesInvolved) as string[]).map(t => (
                            <Badge key={t} variant="outline" className="text-xs">{PHI_TYPES.find(p => p.value === t)?.label || t}</Badge>
                          ));
                        } catch { return <span className="text-sm">{selectedIncident.phiTypesInvolved}</span>; }
                      })()}
                    </div>
                  </div>
                )}

                <div><Label className="text-slate-500">Description</Label><p className="mt-1 text-sm">{selectedIncident.description}</p></div>
                <div><Label className="text-slate-500">Mitigation Steps</Label><p className="mt-1 text-sm">{selectedIncident.mitigationSteps || "None documented"}</p></div>
                <div><Label className="text-slate-500">Remediation Steps</Label><p className="mt-1 text-sm">{selectedIncident.remediationSteps || "None documented"}</p></div>

                {/* Notification Status */}
                <div className="border-t pt-4">
                  <Label className="text-slate-500 mb-2 block">Notification Status</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      {selectedIncident.notifiedIndividualsAt ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-slate-300" />}
                      <span>Individuals: {selectedIncident.notifiedIndividualsAt ? formatDate(selectedIncident.notifiedIndividualsAt) : 'Pending'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {selectedIncident.notifiedHhsAt ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-slate-300" />}
                      <span>HHS: {selectedIncident.notifiedHhsAt ? formatDate(selectedIncident.notifiedHhsAt) : 'Pending'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {selectedIncident.notifiedStateAgAt ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-slate-300" />}
                      <span>State AG: {selectedIncident.notifiedStateAgAt ? formatDate(selectedIncident.notifiedStateAgAt) : 'Pending'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {selectedIncident.notifiedMediaAt ? <CheckCircle className="w-4 h-4 text-green-600" /> : selectedIncident.requiresMediaNotification ? <AlertTriangle className="w-4 h-4 text-red-500" /> : <span className="w-4 h-4 text-slate-300">--</span>}
                      <span>Media: {selectedIncident.notifiedMediaAt ? formatDate(selectedIncident.notifiedMediaAt) : selectedIncident.requiresMediaNotification ? 'Required' : 'N/A'}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-4 border-t">
                  {getNextStatus(selectedIncident.status) && (
                    <Button variant="outline" onClick={() => handleStatusTransition(selectedIncident, getNextStatus(selectedIncident.status)!)}>
                      Advance to: {getNextStatus(selectedIncident.status)!.charAt(0).toUpperCase() + getNextStatus(selectedIncident.status)!.slice(1)}
                    </Button>
                  )}
                  {selectedIncident.status !== 'resolved' && (
                    <Button variant="outline" className="text-green-700" onClick={() => handleStatusTransition(selectedIncident, 'resolved')}>
                      Resolve
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

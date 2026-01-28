import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ShieldAlert, Plus, AlertTriangle, Clock, Users, Activity } from "lucide-react";

interface BreachIncident {
  id: number;
  practiceId: number;
  discoveredAt: string;
  description: string;
  breachType: string;
  affectedIndividualsCount: number;
  phiInvolved: boolean;
  riskAssessment: string;
  remediationSteps: string;
  status: string;
  notificationStatus: string;
  createdAt: string;
  updatedAt: string;
}

const statusColors: Record<string, string> = {
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

export default function BreachIncidentsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<BreachIncident | null>(null);
  const [form, setForm] = useState({
    practiceId: 1,
    discoveredAt: "",
    description: "",
    breachType: "",
    affectedIndividualsCount: 0,
    phiInvolved: false,
    riskAssessment: "",
    remediationSteps: "",
  });

  const { data: incidents = [] } = useQuery<BreachIncident[]>({
    queryKey: ["/api/admin/breach-incidents?practiceId=1"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/admin/breach-incidents", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/breach-incidents?practiceId=1"] });
      setShowCreate(false);
      setForm({ practiceId: 1, discoveredAt: "", description: "", breachType: "", affectedIndividualsCount: 0, phiInvolved: false, riskAssessment: "", remediationSteps: "" });
      toast({ title: "Breach Reported", description: "Incident has been created." });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<BreachIncident> }) =>
      apiRequest("PATCH", "/api/admin/breach-incidents/" + id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/breach-incidents?practiceId=1"] });
      toast({ title: "Updated", description: "Incident updated." });
    },
  });

  const notifyMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", "/api/admin/breach-incidents/" + id + "/notify", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/breach-incidents?practiceId=1"] });
      toast({ title: "Notification Triggered", description: "Breach notification process initiated." });
    },
  });

  const totalIncidents = incidents.length;
  const openIncidents = incidents.filter((i) => i.status === "open").length;
  const pendingNotification = incidents.filter((i) => i.notificationStatus === "pending").length;
  const highRisk = incidents.filter((i) => i.riskAssessment === "high").length;

  return (
    <div className="md:ml-64 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Breach Incidents</h1>
            <p className="text-slate-600">HIPAA breach incident tracking and notification management</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Report Breach</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Report Breach Incident</DialogTitle>
                <DialogDescription>Document a new HIPAA breach incident.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Date Discovered</Label>
                  <Input type="date" value={form.discoveredAt} onChange={(e) => setForm({ ...form, discoveredAt: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the breach incident..." />
                </div>
                <div className="space-y-2">
                  <Label>Breach Type</Label>
                  <Select value={form.breachType} onValueChange={(v) => setForm({ ...form, breachType: v })}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unauthorized_access">Unauthorized Access</SelectItem>
                      <SelectItem value="theft">Theft</SelectItem>
                      <SelectItem value="loss">Loss</SelectItem>
                      <SelectItem value="improper_disposal">Improper Disposal</SelectItem>
                      <SelectItem value="hacking">Hacking/IT Incident</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Affected Individuals</Label>
                    <Input type="number" value={form.affectedIndividualsCount} onChange={(e) => setForm({ ...form, affectedIndividualsCount: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Risk Assessment</Label>
                    <Select value={form.riskAssessment} onValueChange={(v) => setForm({ ...form, riskAssessment: v })}>
                      <SelectTrigger><SelectValue placeholder="Select risk" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="phiInvolved" checked={form.phiInvolved} onChange={(e) => setForm({ ...form, phiInvolved: e.target.checked })} />
                  <Label htmlFor="phiInvolved">PHI Involved</Label>
                </div>
                <div className="space-y-2">
                  <Label>Remediation Steps</Label>
                  <Textarea value={form.remediationSteps} onChange={(e) => setForm({ ...form, remediationSteps: e.target.value })} placeholder="Steps taken to remediate..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending}>Report Breach</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-600">Total Incidents</p><p className="text-2xl font-bold text-slate-900">{totalIncidents}</p></div><div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center"><ShieldAlert className="w-6 h-6 text-slate-600" /></div></div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-600">Open</p><p className="text-2xl font-bold text-slate-900">{openIncidents}</p></div><div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center"><AlertTriangle className="w-6 h-6 text-yellow-600" /></div></div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-600">Pending Notification</p><p className="text-2xl font-bold text-slate-900">{pendingNotification}</p></div><div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center"><Clock className="w-6 h-6 text-blue-600" /></div></div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-600">High Risk</p><p className="text-2xl font-bold text-slate-900">{highRisk}</p></div><div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center"><Activity className="w-6 h-6 text-red-600" /></div></div></CardContent></Card>
        </div>

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
                    <th className="text-left py-3 px-4 font-medium text-slate-600">Notification</th>
                    <th className="text-left py-3 px-4 font-medium text-slate-600">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc) => (
                    <tr key={inc.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedIncident(inc)}>
                      <td className="py-3 px-4">BR-{String(inc.id).padStart(4, "0")}</td>
                      <td className="py-3 px-4">{inc.discoveredAt?.split("T")[0]}</td>
                      <td className="py-3 px-4 max-w-[200px] truncate">{inc.description}</td>
                      <td className="py-3 px-4"><Badge variant="outline">{inc.breachType?.replace(/_/g, " ")}</Badge></td>
                      <td className="py-3 px-4">{inc.affectedIndividualsCount}</td>
                      <td className="py-3 px-4"><Badge className={riskColors[inc.riskAssessment] || "bg-gray-100 text-gray-800"}>{inc.riskAssessment}</Badge></td>
                      <td className="py-3 px-4"><Badge className={notificationColors[inc.notificationStatus] || "bg-gray-100 text-gray-800"}>{inc.notificationStatus?.replace(/_/g, " ")}</Badge></td>
                      <td className="py-3 px-4"><Badge className={statusColors[inc.status] || "bg-gray-100 text-gray-800"}>{inc.status?.replace(/_/g, " ")}</Badge></td>
                      <td className="py-3 px-4"><Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedIncident(inc); }}>View</Button></td>
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

        {/* Detail Dialog */}
        <Dialog open={!!selectedIncident} onOpenChange={(open) => { if (!open) setSelectedIncident(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Breach Incident BR-{String(selectedIncident?.id || 0).padStart(4, "0")}</DialogTitle>
              <DialogDescription>Full incident details and management actions.</DialogDescription>
            </DialogHeader>
            {selectedIncident && (
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label className="text-slate-500">Discovered</Label><p className="font-medium">{selectedIncident.discoveredAt?.split("T")[0]}</p></div>
                  <div><Label className="text-slate-500">Type</Label><p className="font-medium">{selectedIncident.breachType?.replace(/_/g, " ")}</p></div>
                  <div><Label className="text-slate-500">Affected Individuals</Label><p className="font-medium">{selectedIncident.affectedIndividualsCount}</p></div>
                  <div><Label className="text-slate-500">PHI Involved</Label><p className="font-medium">{selectedIncident.phiInvolved ? "Yes" : "No"}</p></div>
                  <div><Label className="text-slate-500">Risk Assessment</Label><p><Badge className={riskColors[selectedIncident.riskAssessment] || "bg-gray-100 text-gray-800"}>{selectedIncident.riskAssessment}</Badge></p></div>
                  <div><Label className="text-slate-500">Status</Label><p><Badge className={statusColors[selectedIncident.status] || "bg-gray-100 text-gray-800"}>{selectedIncident.status?.replace(/_/g, " ")}</Badge></p></div>
                  <div><Label className="text-slate-500">Notification Status</Label><p><Badge className={notificationColors[selectedIncident.notificationStatus] || "bg-gray-100 text-gray-800"}>{selectedIncident.notificationStatus?.replace(/_/g, " ")}</Badge></p></div>
                </div>
                <div><Label className="text-slate-500">Description</Label><p className="mt-1">{selectedIncident.description}</p></div>
                <div><Label className="text-slate-500">Remediation Steps</Label><p className="mt-1">{selectedIncident.remediationSteps || "None documented"}</p></div>
                <div className="flex gap-2 pt-4 border-t">
                  {selectedIncident.status !== "under_review" && (
                    <Button variant="outline" onClick={() => { updateMutation.mutate({ id: selectedIncident.id, data: { status: "under_review" } }); setSelectedIncident({ ...selectedIncident, status: "under_review" }); }}>Mark Under Review</Button>
                  )}
                  {selectedIncident.status !== "closed" && (
                    <Button variant="outline" onClick={() => { updateMutation.mutate({ id: selectedIncident.id, data: { status: "closed" } }); setSelectedIncident({ ...selectedIncident, status: "closed" }); }}>Close Incident</Button>
                  )}
                  <Button variant="default" onClick={() => notifyMutation.mutate(selectedIncident.id)} disabled={notifyMutation.isPending}>Trigger Notification</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

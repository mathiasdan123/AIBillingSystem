import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  Users,
  CheckCircle,
  XCircle,
  Bell,
  Plus,
  Trash2,
  Calendar,
  AlertTriangle,
  Phone,
  Mail,
  User,
  ArrowUp,
  ArrowDown,
  TrendingUp,
  Send,
  ThumbsUp,
  ThumbsDown,
  Timer,
} from "lucide-react";

interface WaitlistEntry {
  id: number;
  practiceId: number;
  patientId: number;
  therapistId?: string;
  preferredDays?: string[];
  preferredTimeStart?: string;
  preferredTimeEnd?: string;
  appointmentType?: string;
  priority: number;
  status: string;
  reason?: string;
  notes?: string;
  offeredAt?: string;
  offeredSlot?: { date: string; startTime: string; endTime: string };
  respondBy?: string;
  notifiedAt?: string;
  notifiedSlot?: { date: string; time: string; therapistId?: string };
  scheduledAppointmentId?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface Patient {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

interface Therapist {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface WaitlistStats {
  totalWaiting: number;
  notified: number;
  scheduled: number;
  expired: number;
  highPriority: number;
  averageWaitDays: number;
  offered: number;
  fillRate: number;
  filledThisMonth: number;
}

const DAYS_OF_WEEK = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "Normal", color: "bg-gray-100 text-gray-800" },
  1: { label: "Low", color: "bg-blue-100 text-blue-800" },
  2: { label: "Medium", color: "bg-yellow-100 text-yellow-800" },
  3: { label: "High", color: "bg-orange-100 text-orange-800" },
  4: { label: "Urgent", color: "bg-red-100 text-red-800" },
};

const STATUS_COLORS: Record<string, string> = {
  waiting: "bg-blue-100 text-blue-800",
  offered: "bg-purple-100 text-purple-800",
  scheduled: "bg-green-100 text-green-800",
  expired: "bg-gray-100 text-gray-800",
  cancelled: "bg-red-100 text-red-800",
  notified: "bg-purple-100 text-purple-800",
};

export default function WaitlistPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedEntry, setSelectedEntry] = useState<WaitlistEntry | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isNotifyDialogOpen, setIsNotifyDialogOpen] = useState(false);
  const [notifySlot, setNotifySlot] = useState({ date: "", time: "" });

  // Fetch waitlist entries
  const { data: waitlistEntries = [], isLoading } = useQuery<WaitlistEntry[]>({
    queryKey: ["/api/waitlist", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ practiceId: "1" });
      if (statusFilter !== "all") {
        params.append("status", statusFilter);
      }
      const res = await fetch(`/api/waitlist?${params}`);
      if (!res.ok) throw new Error("Failed to fetch waitlist");
      return res.json();
    },
  });

  // Fetch waitlist stats
  const { data: stats } = useQuery<WaitlistStats>({
    queryKey: ["/api/waitlist/stats"],
    queryFn: async () => {
      const res = await fetch("/api/waitlist/stats?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  // Fetch patients for the add dialog
  const { data: patientsData } = useQuery<any>({
    queryKey: ["/api/patients"],
    queryFn: async () => {
      const res = await fetch("/api/patients?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch patients");
      return res.json();
    },
  });

  const patients: Patient[] = Array.isArray(patientsData)
    ? patientsData
    : patientsData?.data || [];

  // Fetch therapists
  const { data: therapists = [] } = useQuery<Therapist[]>({
    queryKey: ["/api/therapists"],
    queryFn: async () => {
      const res = await fetch("/api/therapists");
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Create waitlist entry mutation
  const createEntry = useMutation({
    mutationFn: async (data: Partial<WaitlistEntry>) => {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create entry");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist/stats"] });
      setIsAddDialogOpen(false);
      toast({ title: "Patient added to waitlist" });
    },
    onError: () => {
      toast({ title: "Failed to add patient", variant: "destructive" });
    },
  });

  // Update entry mutation
  const updateEntry = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<WaitlistEntry>) => {
      const res = await fetch(`/api/waitlist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update entry");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist/stats"] });
      toast({ title: "Entry updated" });
    },
  });

  // Delete entry mutation
  const deleteEntry = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/waitlist/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete entry");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist/stats"] });
      setSelectedEntry(null);
      toast({ title: "Entry removed from waitlist" });
    },
  });

  // Accept offer mutation
  const acceptOffer = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/waitlist/${id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message || "Failed to accept offer");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      setSelectedEntry(null);
      toast({
        title: "Slot accepted",
        description: `Appointment #${data.appointment?.id} created`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to accept offer", description: err.message, variant: "destructive" });
    },
  });

  // Decline offer mutation
  const declineOffer = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/waitlist/${id}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to decline offer");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist/stats"] });
      setSelectedEntry(null);
      const nextMsg = data.nextOffer?.matched
        ? "Slot offered to next patient"
        : "No other matches found";
      toast({ title: "Offer declined", description: nextMsg });
    },
    onError: () => {
      toast({ title: "Failed to decline offer", variant: "destructive" });
    },
  });

  // Notify patient mutation
  const notifyPatient = useMutation({
    mutationFn: async ({ id, date, time }: { id: number; date: string; time: string }) => {
      const res = await fetch(`/api/waitlist/${id}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time }),
      });
      if (!res.ok) throw new Error("Failed to notify patient");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist/stats"] });
      setIsNotifyDialogOpen(false);
      if (data.emailSent || data.smsSent) {
        toast({
          title: "Patient notified",
          description: `Email: ${data.emailSent ? "Sent" : "Not sent"}, SMS: ${data.smsSent ? "Sent" : "Not sent"}`,
        });
      } else {
        toast({
          title: "Notification failed",
          description: data.errors?.join(", "),
          variant: "destructive",
        });
      }
    },
  });

  // Offer slot manually mutation
  const offerSlot = useMutation({
    mutationFn: async (params: { date: string; startTime: string; endTime?: string; appointmentType?: string }) => {
      const res = await fetch("/api/waitlist/auto-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, practiceId: 1 }),
      });
      if (!res.ok) throw new Error("Failed to auto-fill");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist/stats"] });
      if (data.matched) {
        toast({
          title: "Slot offered",
          description: `Offered to patient (${data.matchCount} matches found)`,
        });
      } else {
        toast({ title: "No matches", description: "No matching waitlist patients found" });
      }
    },
    onError: () => {
      toast({ title: "Auto-fill failed", variant: "destructive" });
    },
  });

  // Get patient name by ID
  const getPatientName = (patientId: number) => {
    const patient = patients.find((p) => p.id === patientId);
    return patient ? `${patient.firstName} ${patient.lastName}` : `Patient #${patientId}`;
  };

  // Get patient by ID
  const getPatient = (patientId: number) => {
    return patients.find((p) => p.id === patientId);
  };

  // Get therapist name
  const getTherapistName = (therapistId?: string) => {
    if (!therapistId) return "Any therapist";
    const therapist = therapists.find((t) => t.id === therapistId);
    return therapist ? `${therapist.firstName || ""} ${therapist.lastName || ""}`.trim() || therapistId : therapistId;
  };

  // Calculate days waiting
  const getDaysWaiting = (createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  };

  // Format preferred days
  const formatPreferredDays = (days?: string[]) => {
    if (!days || days.length === 0) return "Any day";
    if (days.length === 7) return "Any day";
    return days.map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(", ");
  };

  // Format preferred time
  const formatPreferredTime = (start?: string, end?: string) => {
    if (!start || !end) return "Any time";
    return `${start} - ${end}`;
  };

  const filteredEntries = waitlistEntries;

  return (
    <div className="md:ml-64 p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Waitlist Management</h1>
          <p className="text-muted-foreground">
            Smart waitlist with auto-fill for cancelled slots
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add to Waitlist
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Patient to Waitlist</DialogTitle>
              <DialogDescription>
                Add a patient who wants an earlier or different appointment slot
              </DialogDescription>
            </DialogHeader>
            <AddWaitlistForm
              patients={patients}
              therapists={therapists}
              onSubmit={(data) => createEntry.mutate(data)}
              isLoading={createEntry.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.totalWaiting || 0}</p>
                <p className="text-xs text-muted-foreground">Waiting</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.highPriority || 0}</p>
                <p className="text-xs text-muted-foreground">High Priority</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.offered || 0}</p>
                <p className="text-xs text-muted-foreground">Offered</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-indigo-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.notified || 0}</p>
                <p className="text-xs text-muted-foreground">Notified</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.scheduled || 0}</p>
                <p className="text-xs text-muted-foreground">Scheduled</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.fillRate || 0}%</p>
                <p className="text-xs text-muted-foreground">Fill Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-teal-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.filledThisMonth || 0}</p>
                <p className="text-xs text-muted-foreground">Filled (Month)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.averageWaitDays || 0}</p>
                <p className="text-xs text-muted-foreground">Avg Wait (days)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex gap-4 items-center">
        <Label>Filter by status:</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="waiting">Waiting</SelectItem>
            <SelectItem value="offered">Offered</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Waitlist Table */}
      <Card>
        <CardHeader>
          <CardTitle>Waitlist Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : filteredEntries.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No patients on the waitlist
            </p>
          ) : (
            <div className="space-y-3">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 cursor-pointer"
                  onClick={() => setSelectedEntry(entry)}
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{getPatientName(entry.patientId)}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatPreferredDays(entry.preferredDays as string[])} &bull;{" "}
                        {formatPreferredTime(entry.preferredTimeStart, entry.preferredTimeEnd)}
                        {entry.appointmentType && (
                          <> &bull; {entry.appointmentType}</>
                        )}
                      </p>
                      {entry.therapistId && (
                        <p className="text-xs text-muted-foreground">
                          Preferred: {getTherapistName(entry.therapistId)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Offered slot countdown */}
                    {entry.status === "offered" && entry.respondBy && (
                      <CountdownBadge respondBy={entry.respondBy} />
                    )}
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">
                        {getDaysWaiting(entry.createdAt)} days waiting
                      </p>
                    </div>
                    <Badge className={PRIORITY_LABELS[entry.priority]?.color || PRIORITY_LABELS[0].color}>
                      {PRIORITY_LABELS[entry.priority]?.label || "Normal"}
                    </Badge>
                    <Badge className={STATUS_COLORS[entry.status] || STATUS_COLORS.waiting}>
                      {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <Sheet open={!!selectedEntry} onOpenChange={() => setSelectedEntry(null)}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          {selectedEntry && (
            <>
              <SheetHeader>
                <SheetTitle>{getPatientName(selectedEntry.patientId)}</SheetTitle>
                <SheetDescription>Waitlist Entry Details</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                {/* Status & Priority */}
                <div className="flex gap-2">
                  <Badge className={STATUS_COLORS[selectedEntry.status] || STATUS_COLORS.waiting}>
                    {selectedEntry.status.charAt(0).toUpperCase() + selectedEntry.status.slice(1)}
                  </Badge>
                  <Badge className={PRIORITY_LABELS[selectedEntry.priority]?.color || PRIORITY_LABELS[0].color}>
                    {PRIORITY_LABELS[selectedEntry.priority]?.label || "Normal"} Priority
                  </Badge>
                </div>

                {/* Offered Slot Info */}
                {selectedEntry.status === "offered" && selectedEntry.offeredSlot && (
                  <div className="p-4 border rounded-lg bg-purple-50 dark:bg-purple-900/20 space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                      <Send className="h-4 w-4" />
                      Slot Offered
                    </h4>
                    <div className="text-sm space-y-1">
                      <p>
                        <span className="text-muted-foreground">Date: </span>
                        {new Date(selectedEntry.offeredSlot.date + "T00:00:00").toLocaleDateString("en-US", {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Time: </span>
                        {selectedEntry.offeredSlot.startTime}
                        {selectedEntry.offeredSlot.endTime && selectedEntry.offeredSlot.endTime !== selectedEntry.offeredSlot.startTime
                          ? ` - ${selectedEntry.offeredSlot.endTime}`
                          : ""}
                      </p>
                    </div>
                    {selectedEntry.respondBy && (
                      <div className="flex items-center gap-2">
                        <Timer className="h-4 w-4 text-orange-500" />
                        <CountdownBadge respondBy={selectedEntry.respondBy} />
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        onClick={() => acceptOffer.mutate(selectedEntry.id)}
                        disabled={acceptOffer.isPending}
                      >
                        <ThumbsUp className="mr-1 h-4 w-4" />
                        {acceptOffer.isPending ? "Accepting..." : "Accept"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => declineOffer.mutate(selectedEntry.id)}
                        disabled={declineOffer.isPending}
                      >
                        <ThumbsDown className="mr-1 h-4 w-4" />
                        {declineOffer.isPending ? "Declining..." : "Decline"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Contact Info */}
                <div className="space-y-2">
                  <h4 className="font-medium">Contact</h4>
                  {(() => {
                    const patient = getPatient(selectedEntry.patientId);
                    return (
                      <div className="space-y-1 text-sm">
                        {patient?.email && (
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span>{patient.email}</span>
                          </div>
                        )}
                        {patient?.phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span>{patient.phone}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Preferences */}
                <div className="space-y-2">
                  <h4 className="font-medium">Preferences</h4>
                  <div className="text-sm space-y-1">
                    <p>
                      <span className="text-muted-foreground">Days: </span>
                      {formatPreferredDays(selectedEntry.preferredDays as string[])}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Time: </span>
                      {formatPreferredTime(
                        selectedEntry.preferredTimeStart,
                        selectedEntry.preferredTimeEnd
                      )}
                    </p>
                    {selectedEntry.appointmentType && (
                      <p>
                        <span className="text-muted-foreground">Type: </span>
                        {selectedEntry.appointmentType}
                      </p>
                    )}
                    <p>
                      <span className="text-muted-foreground">Therapist: </span>
                      {getTherapistName(selectedEntry.therapistId)}
                    </p>
                  </div>
                </div>

                {/* Reason */}
                {selectedEntry.reason && (
                  <div className="space-y-2">
                    <h4 className="font-medium">Reason</h4>
                    <p className="text-sm">{selectedEntry.reason}</p>
                  </div>
                )}

                {/* Notes */}
                {selectedEntry.notes && (
                  <div className="space-y-2">
                    <h4 className="font-medium">Notes</h4>
                    <p className="text-sm">{selectedEntry.notes}</p>
                  </div>
                )}

                {/* Timeline */}
                <div className="space-y-2">
                  <h4 className="font-medium">Timeline</h4>
                  <div className="text-sm space-y-1">
                    <p>
                      <span className="text-muted-foreground">Added: </span>
                      {new Date(selectedEntry.createdAt).toLocaleDateString()}
                    </p>
                    {selectedEntry.offeredAt && (
                      <p>
                        <span className="text-muted-foreground">Offered: </span>
                        {new Date(selectedEntry.offeredAt).toLocaleString()}
                      </p>
                    )}
                    {selectedEntry.notifiedAt && (
                      <p>
                        <span className="text-muted-foreground">Notified: </span>
                        {new Date(selectedEntry.notifiedAt).toLocaleDateString()}
                      </p>
                    )}
                    {selectedEntry.expiresAt && (
                      <p>
                        <span className="text-muted-foreground">Expires: </span>
                        {new Date(selectedEntry.expiresAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions for waiting status */}
                {selectedEntry.status === "waiting" && (
                  <div className="flex gap-2">
                    <Dialog open={isNotifyDialogOpen} onOpenChange={setIsNotifyDialogOpen}>
                      <DialogTrigger asChild>
                        <Button className="flex-1">
                          <Bell className="mr-2 h-4 w-4" />
                          Notify of Opening
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Notify Patient of Opening</DialogTitle>
                          <DialogDescription>
                            Send an email/SMS about an available appointment slot
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label>Date</Label>
                            <Input
                              type="date"
                              value={notifySlot.date}
                              onChange={(e) =>
                                setNotifySlot((s) => ({ ...s, date: e.target.value }))
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Time</Label>
                            <Input
                              type="time"
                              value={notifySlot.time}
                              onChange={(e) =>
                                setNotifySlot((s) => ({ ...s, time: e.target.value }))
                              }
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            onClick={() =>
                              notifyPatient.mutate({
                                id: selectedEntry.id,
                                date: notifySlot.date,
                                time: notifySlot.time,
                              })
                            }
                            disabled={
                              !notifySlot.date || !notifySlot.time || notifyPatient.isPending
                            }
                          >
                            {notifyPatient.isPending ? "Sending..." : "Send Notification"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                )}

                {/* Priority Update */}
                <div className="space-y-2">
                  <Label>Update Priority</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selectedEntry.priority >= 4}
                      onClick={() =>
                        updateEntry.mutate({
                          id: selectedEntry.id,
                          priority: Math.min((selectedEntry.priority || 0) + 1, 4),
                        })
                      }
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium px-2">
                      {PRIORITY_LABELS[selectedEntry.priority]?.label || "Normal"} ({selectedEntry.priority})
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selectedEntry.priority <= 0}
                      onClick={() =>
                        updateEntry.mutate({
                          id: selectedEntry.id,
                          priority: Math.max((selectedEntry.priority || 0) - 1, 0),
                        })
                      }
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Delete */}
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    if (confirm("Remove this patient from the waitlist?")) {
                      deleteEntry.mutate(selectedEntry.id);
                    }
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove from Waitlist
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Countdown timer component for respondBy deadline
function CountdownBadge({ respondBy }: { respondBy: string }) {
  const [timeLeft, setTimeLeft] = useState("");
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    const update = () => {
      const now = new Date().getTime();
      const deadline = new Date(respondBy).getTime();
      const diff = deadline - now;

      if (diff <= 0) {
        setTimeLeft("Expired");
        setIsExpired(true);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m left`);
      } else {
        setTimeLeft(`${minutes}m left`);
      }
      setIsExpired(false);
    };

    update();
    const interval = setInterval(update, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [respondBy]);

  return (
    <Badge className={isExpired ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}>
      <Timer className="mr-1 h-3 w-3" />
      {timeLeft}
    </Badge>
  );
}

// Add Waitlist Form Component
function AddWaitlistForm({
  patients,
  therapists,
  onSubmit,
  isLoading,
}: {
  patients: Patient[];
  therapists: Therapist[];
  onSubmit: (data: Partial<WaitlistEntry>) => void;
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [newPatientData, setNewPatientData] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [formData, setFormData] = useState({
    patientId: "",
    therapistId: "",
    priority: "0",
    preferredDays: [] as string[],
    preferredTimeStart: "",
    preferredTimeEnd: "",
    appointmentType: "",
    reason: "",
    notes: "",
    expiresAt: "",
  });

  const handleDayToggle = (day: string) => {
    setFormData((prev) => ({
      ...prev,
      preferredDays: prev.preferredDays.includes(day)
        ? prev.preferredDays.filter((d) => d !== day)
        : Array.from(new Set([...prev.preferredDays, day])),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let patientId = formData.patientId;

    if (isNewPatient) {
      if (!newPatientData.firstName.trim() || !newPatientData.lastName.trim()) {
        toast({ title: "Error", description: "Please enter the patient's first and last name", variant: "destructive" });
        return;
      }
      try {
        const res = await apiRequest("POST", "/api/patients", {
          firstName: newPatientData.firstName.trim(),
          lastName: newPatientData.lastName.trim(),
          phone: newPatientData.phone.trim() || null,
          email: newPatientData.email.trim() || null,
          dateOfBirth: "2000-01-01",
          practiceId: 1,
        });
        const created = await res.json();
        patientId = String(created.id);
        queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      } catch (err: any) {
        toast({ title: "Error creating patient", description: err.message, variant: "destructive" });
        return;
      }
    } else if (!patientId) {
      toast({ title: "Error", description: "Please select a patient or add a new one", variant: "destructive" });
      return;
    }

    onSubmit({
      patientId: parseInt(patientId),
      therapistId: formData.therapistId || undefined,
      priority: parseInt(formData.priority),
      preferredDays: formData.preferredDays.length > 0 ? formData.preferredDays : undefined,
      preferredTimeStart: formData.preferredTimeStart || undefined,
      preferredTimeEnd: formData.preferredTimeEnd || undefined,
      appointmentType: formData.appointmentType || undefined,
      reason: formData.reason || undefined,
      notes: formData.notes || undefined,
      expiresAt: formData.expiresAt ? new Date(formData.expiresAt).toISOString() : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Patient *</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => {
              setIsNewPatient(!isNewPatient);
              if (!isNewPatient) {
                setFormData((prev) => ({ ...prev, patientId: "" }));
              } else {
                setNewPatientData({ firstName: "", lastName: "", phone: "", email: "" });
              }
            }}
          >
            {isNewPatient ? "Select Existing Patient" : "+ New Patient"}
          </Button>
        </div>
        {isNewPatient ? (
          <div className="space-y-2 p-3 border rounded-md bg-muted/30">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">First Name *</Label>
                <Input
                  placeholder="First name"
                  value={newPatientData.firstName}
                  onChange={(e) => setNewPatientData({ ...newPatientData, firstName: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Last Name *</Label>
                <Input
                  placeholder="Last name"
                  value={newPatientData.lastName}
                  onChange={(e) => setNewPatientData({ ...newPatientData, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Phone</Label>
                <Input
                  placeholder="Phone number"
                  value={newPatientData.phone}
                  onChange={(e) => setNewPatientData({ ...newPatientData, phone: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  placeholder="Email address"
                  value={newPatientData.email}
                  onChange={(e) => setNewPatientData({ ...newPatientData, email: e.target.value })}
                />
              </div>
            </div>
          </div>
        ) : (
          <Select
            value={formData.patientId}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, patientId: value }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a patient" />
            </SelectTrigger>
            <SelectContent>
              {patients.map((patient) => (
                <SelectItem key={patient.id} value={String(patient.id)}>
                  {patient.firstName} {patient.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <Label>Preferred Therapist (optional)</Label>
        <Select
          value={formData.therapistId}
          onValueChange={(value) => setFormData((prev) => ({ ...prev, therapistId: value === "__none__" ? "" : value }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Any therapist" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Any therapist</SelectItem>
            {therapists.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.firstName || ""} {t.lastName || ""} {t.email ? `(${t.email})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Appointment Type (optional)</Label>
        <Input
          placeholder="e.g., Individual Therapy, Group Session"
          value={formData.appointmentType}
          onChange={(e) => setFormData((prev) => ({ ...prev, appointmentType: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label>Priority</Label>
        <Select
          value={formData.priority}
          onValueChange={(value) => setFormData((prev) => ({ ...prev, priority: value }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Normal (0)</SelectItem>
            <SelectItem value="1">Low (1)</SelectItem>
            <SelectItem value="2">Medium (2)</SelectItem>
            <SelectItem value="3">High (3)</SelectItem>
            <SelectItem value="4">Urgent (4)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Preferred Days</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS_OF_WEEK.map((day) => (
            <div key={day.value} className="flex items-center gap-1">
              <Checkbox
                id={day.value}
                checked={formData.preferredDays.includes(day.value)}
                onCheckedChange={() => handleDayToggle(day.value)}
              />
              <Label htmlFor={day.value} className="text-sm cursor-pointer">
                {day.label.slice(0, 3)}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Preferred Time Start</Label>
          <Input
            type="time"
            value={formData.preferredTimeStart}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, preferredTimeStart: e.target.value }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label>Preferred Time End</Label>
          <Input
            type="time"
            value={formData.preferredTimeEnd}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, preferredTimeEnd: e.target.value }))
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Reason</Label>
        <Textarea
          placeholder="Why do they need an earlier appointment?"
          value={formData.reason}
          onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea
          placeholder="Any additional notes..."
          value={formData.notes}
          onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label>Expires On (optional)</Label>
        <Input
          type="date"
          value={formData.expiresAt}
          onChange={(e) => setFormData((prev) => ({ ...prev, expiresAt: e.target.value }))}
        />
      </div>

      <DialogFooter>
        <Button type="submit" disabled={!formData.patientId || isLoading}>
          {isLoading ? "Adding..." : "Add to Waitlist"}
        </Button>
      </DialogFooter>
    </form>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ChevronLeft, ChevronRight, Plus, Clock, User, Mail, XCircle, CalendarX } from "lucide-react";
import type { Appointment } from "@shared/schema";

interface AvailabilitySlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);

const CANCELLATION_REASONS = [
  { value: "patient_request", label: "Patient Request" },
  { value: "sick", label: "Sick" },
  { value: "schedule_conflict", label: "Schedule Conflict" },
  { value: "weather", label: "Weather" },
  { value: "no_show", label: "No Show" },
  { value: "other", label: "Other" },
];

export default function CalendarPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"week" | "day">("week");
  const [showNewAppointment, setShowNewAppointment] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelNotes, setCancelNotes] = useState("");
  const [cancelledBy, setCancelledBy] = useState("");

  const [availability, setAvailability] = useState<AvailabilitySlot[]>([
    { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
    { dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
    { dayOfWeek: 3, startTime: "09:00", endTime: "17:00" },
    { dayOfWeek: 4, startTime: "09:00", endTime: "17:00" },
    { dayOfWeek: 5, startTime: "09:00", endTime: "17:00" },
  ]);

  const [newAppointment, setNewAppointment] = useState({
    patientId: "",
    date: new Date().toISOString().split("T")[0],
    startTime: "09:00",
    type: "Individual Therapy",
    notes: "",
  });

  // Fetch patients for the dropdown
  const { data: patients = [] } = useQuery<any[]>({
    queryKey: ["/api/patients"],
  });

  // Compute date range for the current view
  const getWeekDates = (date: Date) => {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  };

  const weekDates = getWeekDates(currentDate);

  // Fetch appointments from backend
  const weekStart = new Date(weekDates[0]);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekDates[6]);
  weekEnd.setHours(23, 59, 59, 999);

  const { data: appointments = [] } = useQuery<Appointment[]>({
    queryKey: ["/api/appointments", `?practiceId=1&start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`],
  });

  // This week's cancellation summary
  const thisWeekCancelled = appointments.filter(a => a.status === "cancelled").length;
  const thisWeekTotal = appointments.length;
  const thisWeekRate = thisWeekTotal > 0 ? Math.round((thisWeekCancelled / thisWeekTotal) * 100) : 0;

  // Create appointment mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/appointments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      setShowNewAppointment(false);
      toast({ title: "Appointment Scheduled", description: "Appointment created successfully." });
      setNewAppointment({ patientId: "", date: new Date().toISOString().split("T")[0], startTime: "09:00", type: "Individual Therapy", notes: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Cancel appointment mutation
  const cancelMutation = useMutation({
    mutationFn: async ({ id, reason, notes, cancelledBy }: { id: number; reason: string; notes?: string; cancelledBy?: string }) => {
      const res = await apiRequest("POST", `/api/appointments/${id}/cancel`, { reason, notes, cancelledBy });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      setShowCancelDialog(false);
      setSelectedAppointment(null);
      setCancelReason("");
      setCancelNotes("");
      setCancelledBy("");
      toast({ title: "Appointment Cancelled", description: "The appointment has been cancelled." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleCreateAppointment = () => {
    if (!newAppointment.patientId) {
      toast({ title: "Error", description: "Please select a patient", variant: "destructive" });
      return;
    }
    const sh = parseInt(newAppointment.startTime.split(":")[0]);
    const endTime = String(sh + 1).padStart(2, "0") + ":00";

    const startDt = new Date(`${newAppointment.date}T${newAppointment.startTime}:00`);
    const endDt = new Date(`${newAppointment.date}T${endTime}:00`);

    createMutation.mutate({
      practiceId: 1,
      patientId: parseInt(newAppointment.patientId),
      title: newAppointment.type,
      startTime: startDt.toISOString(),
      endTime: endDt.toISOString(),
      status: "scheduled",
      notes: newAppointment.notes || null,
    });
  };

  const handleCancelAppointment = () => {
    if (!selectedAppointment || !cancelReason) {
      toast({ title: "Error", description: "Please select a cancellation reason", variant: "destructive" });
      return;
    }
    cancelMutation.mutate({
      id: selectedAppointment.id,
      reason: cancelReason,
      notes: cancelNotes || undefined,
      cancelledBy: cancelledBy || undefined,
    });
  };

  const openCancelDialog = (apt: Appointment) => {
    setSelectedAppointment(apt);
    setCancelReason("");
    setCancelNotes("");
    setCancelledBy("");
    setShowCancelDialog(true);
  };

  const navigateWeek = (dir: number) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + dir * 7);
    setCurrentDate(d);
  };
  const navigateDay = (dir: number) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };
  const formatDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const formatDateFull = (date: Date) => date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const getAppointmentsForDate = (date: Date) => {
    const dateStr = date.toISOString().split("T")[0];
    return appointments.filter(apt => {
      const aptDate = new Date(apt.startTime).toISOString().split("T")[0];
      return aptDate === dateStr;
    });
  };

  const getAppointmentStyle = (apt: Appointment) => {
    const start = new Date(apt.startTime);
    const end = new Date(apt.endTime);
    const sh = start.getHours();
    const sm = start.getMinutes();
    const eh = end.getHours();
    const em = end.getMinutes();
    const top = ((sh - 8) * 60 + sm) * (64 / 60) - 2;
    const height = ((eh - sh) * 60 + (em - sm)) * (64 / 60);
    return { top: top + "px", height: Math.max(height, 24) + "px" };
  };

  const getStatusColor = (s: string) =>
    s === "completed" ? "bg-green-100 text-green-800" :
    s === "scheduled" ? "bg-blue-100 text-blue-800" :
    s === "cancelled" ? "bg-red-100 text-red-800" :
    s === "no_show" ? "bg-orange-100 text-orange-800" :
    "bg-gray-100 text-gray-800";

  const getCalendarBlockStyle = (apt: Appointment) =>
    apt.status === "cancelled" ? "bg-red-200 border-l-4 border-red-600 text-red-900" :
    apt.status === "completed" ? "bg-green-100 border-l-4 border-green-500" :
    "bg-blue-100 border-l-4 border-blue-500";

  const formatTime = (dt: string | Date) => {
    const d = new Date(dt);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  return (
    <div className="md:ml-64 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
            <p className="text-slate-600">Manage your appointments and availability</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowAvailability(true)}>
              <Clock className="w-4 h-4 mr-2" />Availability
            </Button>
            <Dialog open={showNewAppointment} onOpenChange={setShowNewAppointment}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" />New Appointment</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Schedule New Appointment</DialogTitle>
                  <DialogDescription>Create a new 1-hour therapy session.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Patient</Label>
                    <Select value={newAppointment.patientId} onValueChange={(v) => setNewAppointment({ ...newAppointment, patientId: v })}>
                      <SelectTrigger><SelectValue placeholder="Select a patient" /></SelectTrigger>
                      <SelectContent>
                        {patients.map((p: any) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.firstName} {p.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Input type="date" value={newAppointment.date} onChange={(e) => setNewAppointment({ ...newAppointment, date: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Select value={newAppointment.startTime} onValueChange={(v) => setNewAppointment({ ...newAppointment, startTime: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {HOURS.map((h) => (
                            <SelectItem key={h} value={String(h).padStart(2, "0") + ":00"}>
                              {h > 12 ? (h - 12) + ":00 PM" : h === 12 ? "12:00 PM" : h + ":00 AM"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Session Type</Label>
                    <Select value={newAppointment.type} onValueChange={(v) => setNewAppointment({ ...newAppointment, type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Individual Therapy">Individual Therapy</SelectItem>
                        <SelectItem value="Family Therapy">Family Therapy</SelectItem>
                        <SelectItem value="Group Therapy">Group Therapy</SelectItem>
                        <SelectItem value="Initial Evaluation">Initial Evaluation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes (optional)</Label>
                    <Input placeholder="Any special notes..." value={newAppointment.notes} onChange={(e) => setNewAppointment({ ...newAppointment, notes: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowNewAppointment(false)}>Cancel</Button>
                  <Button onClick={handleCreateAppointment} disabled={createMutation.isPending}>
                    <Mail className="w-4 h-4 mr-2" />Schedule
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Weekly cancellation summary */}
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <CalendarX className="w-4 h-4 text-red-500" />
                <span className="font-medium">This Week:</span>
              </div>
              <div>
                <span className="font-semibold">{thisWeekCancelled}</span> cancelled of <span className="font-semibold">{thisWeekTotal}</span> total
              </div>
              <Badge variant={thisWeekRate > 20 ? "destructive" : "secondary"}>
                {thisWeekRate}% cancel rate
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Navigation */}
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => view === "week" ? navigateWeek(-1) : navigateDay(-1)}><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="sm" onClick={() => view === "week" ? navigateWeek(1) : navigateDay(1)}><ChevronRight className="w-4 h-4" /></Button>
                <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>Today</Button>
              </div>
              <h2 className="text-lg font-semibold">
                {view === "week" ? formatDate(weekDates[0]) + " - " + formatDate(weekDates[6]) + ", " + weekDates[0].getFullYear() : formatDateFull(currentDate)}
              </h2>
              <div className="flex items-center gap-2">
                <Button variant={view === "week" ? "default" : "outline"} size="sm" onClick={() => setView("week")}>Week</Button>
                <Button variant={view === "day" ? "default" : "outline"} size="sm" onClick={() => setView("day")}>Day</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Calendar Grid */}
        <Card>
          <CardContent className="p-0">
            {view === "week" && (
              <div className="grid grid-cols-8 border-b">
                <div className="w-16 border-r" />
                {weekDates.map((date, i) => (
                  <div key={i} className={"p-2 text-center border-r last:border-r-0 " + (date.toDateString() === new Date().toDateString() ? "bg-blue-50" : "")}>
                    <div className="text-sm text-slate-500">{DAYS[date.getDay()].slice(0, 3)}</div>
                    <div className={"text-lg font-semibold " + (date.toDateString() === new Date().toDateString() ? "text-blue-600" : "")}>{date.getDate()}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="relative">
              <div className={"grid " + (view === "week" ? "grid-cols-8" : "grid-cols-2")}>
                <div className="w-16 border-r">
                  {HOURS.map((h) => (
                    <div key={h} className="h-16 border-b text-xs text-slate-500 text-right pr-2 pt-1">
                      {h > 12 ? (h - 12) + " PM" : h === 12 ? "12 PM" : h + " AM"}
                    </div>
                  ))}
                </div>
                {(view === "week" ? weekDates : [currentDate]).map((date, ci) => (
                  <div key={ci} className="relative border-r last:border-r-0">
                    {HOURS.map((h) => (<div key={h} className="h-16 border-b" />))}
                    {getAppointmentsForDate(date).map((apt) => (
                      <div
                        key={apt.id}
                        className={"absolute left-1 right-1 rounded-lg p-2 cursor-pointer hover:opacity-90 " + getCalendarBlockStyle(apt)}
                        style={getAppointmentStyle(apt)}
                        onClick={() => {
                          if (apt.status !== "cancelled") {
                            openCancelDialog(apt);
                          } else {
                            toast({ title: apt.title || "Appointment", description: `Cancelled: ${apt.cancellationReason || "N/A"}` });
                          }
                        }}
                      >
                        <div className="text-xs font-medium truncate">{apt.title || "Appointment"}</div>
                        <div className="text-xs text-slate-600 truncate">
                          {formatTime(apt.startTime)}
                          {apt.status === "cancelled" && ` (Cancelled${(apt as any).cancelledBy ? ` by ${(apt as any).cancelledBy === "patient" ? "Patient" : "Staff"}` : ""})`}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Appointments */}
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-lg">Upcoming Appointments</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {appointments
                .filter(a => new Date(a.startTime) >= new Date() && a.status !== "cancelled")
                .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                .slice(0, 5)
                .map((apt) => (
                  <div key={apt.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <User className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <div className="font-medium">{apt.title || "Appointment"}</div>
                        <div className="text-sm text-slate-600">
                          {new Date(apt.startTime).toLocaleDateString()} at {formatTime(apt.startTime)} - {formatTime(apt.endTime)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getStatusColor(apt.status || "scheduled")}>{apt.status}</Badge>
                      <Button variant="outline" size="sm" onClick={() => openCancelDialog(apt)}>
                        <XCircle className="w-4 h-4 mr-1" />Cancel
                      </Button>
                    </div>
                  </div>
                ))}
              {appointments.filter(a => new Date(a.startTime) >= new Date() && a.status !== "cancelled").length === 0 && (
                <p className="text-center text-slate-500 py-4">No upcoming appointments</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cancel Appointment Dialog */}
        <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel Appointment</DialogTitle>
              <DialogDescription>
                {selectedAppointment && (
                  <>Cancel appointment: {selectedAppointment.title} on {new Date(selectedAppointment.startTime).toLocaleDateString()} at {formatTime(selectedAppointment.startTime)}</>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Cancellation Reason</Label>
                <Select value={cancelReason} onValueChange={setCancelReason}>
                  <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                  <SelectContent>
                    {CANCELLATION_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cancelled By</Label>
                <Select value={cancelledBy} onValueChange={setCancelledBy}>
                  <SelectTrigger><SelectValue placeholder="Who is cancelling?" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="patient">Patient</SelectItem>
                    <SelectItem value="therapist">Therapist</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  placeholder="Additional details..."
                  value={cancelNotes}
                  onChange={(e) => setCancelNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCancelDialog(false)}>Back</Button>
              <Button variant="destructive" onClick={handleCancelAppointment} disabled={cancelMutation.isPending || !cancelReason}>
                <XCircle className="w-4 h-4 mr-2" />Confirm Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Availability Dialog */}
        <Dialog open={showAvailability} onOpenChange={setShowAvailability}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Manage Availability</DialogTitle>
              <DialogDescription>Set your regular working hours for each day of the week.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {DAYS.map((day, idx) => {
                const slot = availability.find(a => a.dayOfWeek === idx);
                return (
                  <div key={day} className="flex items-center gap-4">
                    <div className="w-24 font-medium">{day}</div>
                    <input
                      type="checkbox"
                      checked={!!slot}
                      onChange={(e) => e.target.checked
                        ? setAvailability([...availability, { dayOfWeek: idx, startTime: "09:00", endTime: "17:00" }])
                        : setAvailability(availability.filter(a => a.dayOfWeek !== idx))}
                      className="w-4 h-4"
                    />
                    {slot && (
                      <>
                        <Input type="time" value={slot.startTime} onChange={(e) => setAvailability(availability.map(a => a.dayOfWeek === idx ? { ...a, startTime: e.target.value } : a))} className="w-32" />
                        <span>to</span>
                        <Input type="time" value={slot.endTime} onChange={(e) => setAvailability(availability.map(a => a.dayOfWeek === idx ? { ...a, endTime: e.target.value } : a))} className="w-32" />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button onClick={() => { setShowAvailability(false); toast({ title: "Availability Saved", description: "Your availability has been updated." }); }}>Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

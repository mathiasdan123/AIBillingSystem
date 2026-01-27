import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Plus, Clock, User, Mail } from "lucide-react";

interface Appointment {
  id: number;
  patientId: number;
  patientName: string;
  patientEmail: string;
  date: string;
  startTime: string;
  endTime: string;
  type: string;
  status: "scheduled" | "confirmed" | "cancelled" | "completed";
  notes?: string;
}

interface AvailabilitySlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);

const mockPatients = [
  { id: 1, name: "John Smith", email: "john.smith@email.com" },
  { id: 2, name: "Sarah Johnson", email: "sarah.j@email.com" },
  { id: 3, name: "Michael Brown", email: "m.brown@email.com" },
];

export default function CalendarPage() {
  console.log("CalendarPage is rendering!");
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"week" | "day">("week");
  const [showNewAppointment, setShowNewAppointment] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);

  const [appointments, setAppointments] = useState<Appointment[]>([
    { id: 1, patientId: 1, patientName: "John Smith", patientEmail: "john.smith@email.com", date: new Date().toISOString().split("T")[0], startTime: "09:00", endTime: "10:00", type: "Individual Therapy", status: "confirmed" },
    { id: 2, patientId: 2, patientName: "Sarah Johnson", patientEmail: "sarah.j@email.com", date: new Date().toISOString().split("T")[0], startTime: "14:00", endTime: "15:00", type: "Individual Therapy", status: "scheduled" },
  ]);

  const [availability, setAvailability] = useState<AvailabilitySlot[]>([
    { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
    { dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
    { dayOfWeek: 3, startTime: "09:00", endTime: "17:00" },
    { dayOfWeek: 4, startTime: "09:00", endTime: "17:00" },
    { dayOfWeek: 5, startTime: "09:00", endTime: "17:00" },
  ]);

  const [newAppointment, setNewAppointment] = useState({ patientId: "", date: new Date().toISOString().split("T")[0], startTime: "09:00", type: "Individual Therapy", notes: "" });

  const getWeekDates = (date: Date) => {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  };

  const weekDates = getWeekDates(currentDate);
  const navigateWeek = (dir: number) => { const d = new Date(currentDate); d.setDate(d.getDate() + dir * 7); setCurrentDate(d); };
  const navigateDay = (dir: number) => { const d = new Date(currentDate); d.setDate(d.getDate() + dir); setCurrentDate(d); };
  const formatDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const formatDateFull = (date: Date) => date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const getAppointmentsForDate = (date: Date) => appointments.filter(apt => apt.date === date.toISOString().split("T")[0]);

  const getAppointmentStyle = (apt: Appointment) => {
    const [sh, sm] = apt.startTime.split(":").map(Number);
    const [eh, em] = apt.endTime.split(":").map(Number);
    const top = ((sh - 8) * 60 + sm) * (64 / 60);
    const height = ((eh - sh) * 60 + (em - sm)) * (64 / 60);
    return { top: top + "px", height: height + "px" };
  };

  const handleCreateAppointment = () => {
    if (!newAppointment.patientId) { toast({ title: "Error", description: "Please select a patient", variant: "destructive" }); return; }
    const patient = mockPatients.find(p => p.id === parseInt(newAppointment.patientId));
    if (!patient) return;
    const sh = parseInt(newAppointment.startTime.split(":")[0]);
    const endTime = String(sh + 1).padStart(2, "0") + ":00";
    const apt: Appointment = { id: appointments.length + 1, patientId: patient.id, patientName: patient.name, patientEmail: patient.email, date: newAppointment.date, startTime: newAppointment.startTime, endTime, type: newAppointment.type, status: "scheduled", notes: newAppointment.notes };
    setAppointments([...appointments, apt]);
    setShowNewAppointment(false);
    toast({ title: "Appointment Scheduled", description: "Confirmation email sent to " + patient.email });
    setNewAppointment({ patientId: "", date: new Date().toISOString().split("T")[0], startTime: "09:00", type: "Individual Therapy", notes: "" });
  };

  const sendConfirmationEmail = (apt: Appointment) => toast({ title: "Confirmation Sent", description: "Reminder email sent to " + apt.patientEmail });
  const getStatusColor = (s: string) => s === "confirmed" ? "bg-green-100 text-green-800" : s === "scheduled" ? "bg-blue-100 text-blue-800" : s === "cancelled" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800";

  return (
    <div className="md:ml-64 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
            <p className="text-slate-600">Manage your appointments and availability</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowAvailability(true)}><Clock className="w-4 h-4 mr-2" />Availability</Button>
            <Dialog open={showNewAppointment} onOpenChange={setShowNewAppointment}>
              <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Appointment</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Schedule New Appointment</DialogTitle><DialogDescription>Create a new 1-hour therapy session.</DialogDescription></DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2"><Label>Patient</Label><Select value={newAppointment.patientId} onValueChange={(v) => setNewAppointment({ ...newAppointment, patientId: v })}><SelectTrigger><SelectValue placeholder="Select a patient" /></SelectTrigger><SelectContent>{mockPatients.map((p) => (<SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>))}</SelectContent></Select></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Date</Label><Input type="date" value={newAppointment.date} onChange={(e) => setNewAppointment({ ...newAppointment, date: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Start Time</Label><Select value={newAppointment.startTime} onValueChange={(v) => setNewAppointment({ ...newAppointment, startTime: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{HOURS.map((h) => (<SelectItem key={h} value={String(h).padStart(2, "0") + ":00"}>{h > 12 ? (h - 12) + ":00 PM" : h === 12 ? "12:00 PM" : h + ":00 AM"}</SelectItem>))}</SelectContent></Select></div>
                  </div>
                  <div className="space-y-2"><Label>Session Type</Label><Select value={newAppointment.type} onValueChange={(v) => setNewAppointment({ ...newAppointment, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Individual Therapy">Individual Therapy</SelectItem><SelectItem value="Family Therapy">Family Therapy</SelectItem><SelectItem value="Group Therapy">Group Therapy</SelectItem><SelectItem value="Initial Evaluation">Initial Evaluation</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2"><Label>Notes (optional)</Label><Input placeholder="Any special notes..." value={newAppointment.notes} onChange={(e) => setNewAppointment({ ...newAppointment, notes: e.target.value })} /></div>
                </div>
                <DialogFooter><Button variant="outline" onClick={() => setShowNewAppointment(false)}>Cancel</Button><Button onClick={handleCreateAppointment}><Mail className="w-4 h-4 mr-2" />Schedule & Send Confirmation</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card className="mb-6"><CardContent className="py-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => view === "week" ? navigateWeek(-1) : navigateDay(-1)}><ChevronLeft className="w-4 h-4" /></Button><Button variant="outline" size="sm" onClick={() => view === "week" ? navigateWeek(1) : navigateDay(1)}><ChevronRight className="w-4 h-4" /></Button><Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>Today</Button></div><h2 className="text-lg font-semibold">{view === "week" ? formatDate(weekDates[0]) + " - " + formatDate(weekDates[6]) + ", " + weekDates[0].getFullYear() : formatDateFull(currentDate)}</h2><div className="flex items-center gap-2"><Button variant={view === "week" ? "default" : "outline"} size="sm" onClick={() => setView("week")}>Week</Button><Button variant={view === "day" ? "default" : "outline"} size="sm" onClick={() => setView("day")}>Day</Button></div></div></CardContent></Card>

        <Card><CardContent className="p-0">{view === "week" && (<div className="grid grid-cols-8 border-b"><div className="w-16 border-r" />{weekDates.map((date, i) => (<div key={i} className={"p-2 text-center border-r last:border-r-0 " + (date.toDateString() === new Date().toDateString() ? "bg-blue-50" : "")}><div className="text-sm text-slate-500">{DAYS[date.getDay()].slice(0, 3)}</div><div className={"text-lg font-semibold " + (date.toDateString() === new Date().toDateString() ? "text-blue-600" : "")}>{date.getDate()}</div></div>))}</div>)}<div className="relative"><div className={"grid " + (view === "week" ? "grid-cols-8" : "grid-cols-2")}><div className="w-16 border-r">{HOURS.map((h) => (<div key={h} className="h-16 border-b text-xs text-slate-500 text-right pr-2 pt-1">{h > 12 ? (h - 12) + " PM" : h === 12 ? "12 PM" : h + " AM"}</div>))}</div>{(view === "week" ? weekDates : [currentDate]).map((date, ci) => (<div key={ci} className="relative border-r last:border-r-0">{HOURS.map((h) => (<div key={h} className="h-16 border-b" />))}{getAppointmentsForDate(date).map((apt) => (<div key={apt.id} className={"absolute left-1 right-1 rounded-lg p-2 cursor-pointer hover:opacity-90 " + (apt.status === "confirmed" ? "bg-green-100 border-l-4 border-green-500" : apt.status === "scheduled" ? "bg-blue-100 border-l-4 border-blue-500" : "bg-gray-100 border-l-4 border-gray-500")} style={getAppointmentStyle(apt)} onClick={() => toast({ title: apt.patientName, description: apt.type + " - " + apt.startTime + " to " + apt.endTime })}><div className="text-xs font-medium truncate">{apt.patientName}</div><div className="text-xs text-slate-600 truncate">{apt.type}</div></div>))}</div>))}</div></div></CardContent></Card>

        <Card className="mt-6"><CardHeader><CardTitle className="text-lg">Upcoming Appointments</CardTitle></CardHeader><CardContent><div className="space-y-4">{appointments.filter(a => new Date(a.date) >= new Date(new Date().toDateString())).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 5).map((apt) => (<div key={apt.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg"><div className="flex items-center gap-4"><div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-blue-600" /></div><div><div className="font-medium">{apt.patientName}</div><div className="text-sm text-slate-600">{new Date(apt.date).toLocaleDateString()} at {apt.startTime} - {apt.endTime}</div></div></div><div className="flex items-center gap-2"><Badge className={getStatusColor(apt.status)}>{apt.status}</Badge><Button variant="outline" size="sm" onClick={() => sendConfirmationEmail(apt)}><Mail className="w-4 h-4 mr-1" />Send Reminder</Button></div></div>))}</div></CardContent></Card>

        <Dialog open={showAvailability} onOpenChange={setShowAvailability}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Manage Availability</DialogTitle><DialogDescription>Set your regular working hours for each day of the week.</DialogDescription></DialogHeader><div className="space-y-4 py-4">{DAYS.map((day, idx) => { const slot = availability.find(a => a.dayOfWeek === idx); return (<div key={day} className="flex items-center gap-4"><div className="w-24 font-medium">{day}</div><input type="checkbox" checked={!!slot} onChange={(e) => e.target.checked ? setAvailability([...availability, { dayOfWeek: idx, startTime: "09:00", endTime: "17:00" }]) : setAvailability(availability.filter(a => a.dayOfWeek !== idx))} className="w-4 h-4" />{slot && (<><Input type="time" value={slot.startTime} onChange={(e) => setAvailability(availability.map(a => a.dayOfWeek === idx ? { ...a, startTime: e.target.value } : a))} className="w-32" /><span>to</span><Input type="time" value={slot.endTime} onChange={(e) => setAvailability(availability.map(a => a.dayOfWeek === idx ? { ...a, endTime: e.target.value } : a))} className="w-32" /></>)}</div>); })}</div><DialogFooter><Button onClick={() => { setShowAvailability(false); toast({ title: "Availability Saved", description: "Your availability has been updated." }); }}>Save Changes</Button></DialogFooter></DialogContent></Dialog>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ChevronLeft, ChevronRight, Plus, Clock, User, Mail, XCircle, CalendarX, ClipboardList, Repeat, Building2, Check, ChevronsUpDown } from "lucide-react";
import type { Appointment } from "@shared/schema";
import AppointmentRequestQueue from "@/components/AppointmentRequestQueue";

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
  // Default to day view on mobile (screen width < 768px)
  const [view, setView] = useState<"week" | "day">(
    typeof window !== 'undefined' && window.innerWidth < 768 ? "day" : "week"
  );
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
    therapistId: "",
    date: new Date().toISOString().split("T")[0],
    startTime: "09:00",
    type: "Individual Therapy",
    notes: "",
    locationId: "",
    recurrencePattern: "none" as "none" | "weekly" | "biweekly" | "monthly",
    recurrenceEndType: "occurrences" as "occurrences" | "endDate",
    numberOfOccurrences: "12",
    recurrenceEndDate: "",
  });
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [newPatientData, setNewPatientData] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [showSeriesActionDialog, setShowSeriesActionDialog] = useState(false);
  const [seriesAction, setSeriesAction] = useState<"cancel" | "delete" | null>(null);
  const [seriesActionAppointment, setSeriesActionAppointment] = useState<Appointment | null>(null);

  // Fetch patients for the dropdown
  const { data: patients = [] } = useQuery<any[]>({
    queryKey: ["/api/patients"],
  });

  // Fetch therapists for the dropdown
  const { data: therapists = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
  });

  // Fetch locations for the dropdown
  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
    queryFn: async () => {
      const res = await fetch('/api/locations');
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Location filter state
  const [filterLocationId, setFilterLocationId] = useState<string>("all");

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
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      setShowNewAppointment(false);
      const desc = data.seriesInfo
        ? `Created ${data.seriesInfo.totalCreated} appointments (${data.seriesInfo.recurrenceDescription})`
        : "Appointment created successfully.";
      toast({ title: "Appointment Scheduled", description: desc });
      setNewAppointment({ patientId: "", therapistId: "", date: new Date().toISOString().split("T")[0], startTime: "09:00", type: "Individual Therapy", notes: "", locationId: "", recurrencePattern: "none", recurrenceEndType: "occurrences", numberOfOccurrences: "12", recurrenceEndDate: "" });
      setIsNewPatient(false);
      setNewPatientData({ firstName: "", lastName: "", phone: "", email: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Cancel series mutation
  const cancelSeriesMutation = useMutation({
    mutationFn: async ({ seriesId, reason, notes, cancelledBy }: { seriesId: string; reason: string; notes?: string; cancelledBy?: string }) => {
      const res = await apiRequest("POST", `/api/appointments/series/${seriesId}/cancel`, { reason, notes, cancelledBy });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      setShowSeriesActionDialog(false);
      setSeriesActionAppointment(null);
      setCancelReason("");
      setCancelNotes("");
      setCancelledBy("");
      toast({ title: "Series Cancelled", description: `${data.cancelledCount} future appointments cancelled.` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Delete series mutation
  const deleteSeriesMutation = useMutation({
    mutationFn: async ({ seriesId }: { seriesId: string }) => {
      const res = await apiRequest("DELETE", `/api/appointments/series/${seriesId}`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      setShowSeriesActionDialog(false);
      setSeriesActionAppointment(null);
      toast({ title: "Series Deleted", description: `${data.deletedCount} appointments deleted.` });
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

  const handleCreateAppointment = async () => {
    let patientId = newAppointment.patientId;

    // If creating a new patient, do that first
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

    const sh = parseInt(newAppointment.startTime.split(":")[0]);
    const endTime = String(sh + 1).padStart(2, "0") + ":00";

    const startDt = new Date(`${newAppointment.date}T${newAppointment.startTime}:00`);
    const endDt = new Date(`${newAppointment.date}T${endTime}:00`);

    const payload: any = {
      practiceId: 1,
      patientId: parseInt(patientId),
      therapistId: newAppointment.therapistId || null,
      locationId: newAppointment.locationId ? parseInt(newAppointment.locationId) : null,
      title: newAppointment.type,
      startTime: startDt.toISOString(),
      endTime: endDt.toISOString(),
      status: "scheduled",
      notes: newAppointment.notes || null,
    };

    if (newAppointment.recurrencePattern !== "none") {
      payload.recurrencePattern = newAppointment.recurrencePattern;
      if (newAppointment.recurrenceEndType === "occurrences") {
        payload.numberOfOccurrences = parseInt(newAppointment.numberOfOccurrences) || 12;
      } else if (newAppointment.recurrenceEndDate) {
        payload.recurrenceEndDate = new Date(newAppointment.recurrenceEndDate).toISOString();
      }
    }

    createMutation.mutate(payload);
  };

  const handleCancelAppointment = () => {
    if (!selectedAppointment || !cancelReason) {
      toast({ title: "Error", description: "Please select a cancellation reason", variant: "destructive" });
      return;
    }
    // Check if we're cancelling a whole series
    const seriesCancelId = (window as any).__cancelSeriesId;
    if (seriesCancelId) {
      delete (window as any).__cancelSeriesId;
      cancelSeriesMutation.mutate({
        seriesId: seriesCancelId,
        reason: cancelReason,
        notes: cancelNotes || undefined,
        cancelledBy: cancelledBy || undefined,
      });
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
    // If this is a recurring appointment, ask whether to cancel this one or the whole series
    if ((apt as any).isRecurring && (apt as any).seriesId) {
      setSeriesActionAppointment(apt);
      setSeriesAction("cancel");
      setCancelReason("");
      setCancelNotes("");
      setCancelledBy("");
      setShowSeriesActionDialog(true);
    } else {
      setSelectedAppointment(apt);
      setCancelReason("");
      setCancelNotes("");
      setCancelledBy("");
      setShowCancelDialog(true);
    }
  };

  const handleSeriesActionSingle = () => {
    if (!seriesActionAppointment) return;
    setShowSeriesActionDialog(false);
    if (seriesAction === "cancel") {
      setSelectedAppointment(seriesActionAppointment);
      setShowCancelDialog(true);
    }
  };

  const handleSeriesActionAll = () => {
    if (!seriesActionAppointment || !(seriesActionAppointment as any).seriesId) return;
    if (seriesAction === "cancel") {
      setShowSeriesActionDialog(false);
      setSelectedAppointment(seriesActionAppointment);
      setShowCancelDialog(true);
      // We'll use a flag to distinguish series cancel from single cancel
    } else if (seriesAction === "delete") {
      deleteSeriesMutation.mutate({ seriesId: (seriesActionAppointment as any).seriesId });
    }
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

  // Filter appointments by selected location
  const filteredAppointments = filterLocationId === "all"
    ? appointments
    : appointments.filter(apt => (apt as any).locationId === parseInt(filterLocationId));

  const getAppointmentsForDate = (date: Date) => {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    return filteredAppointments.filter(apt => {
      const s = new Date(apt.startTime);
      return s.getUTCFullYear() === y && s.getUTCMonth() === m && s.getUTCDate() === d;
    });
  };

  const getAppointmentStyle = (apt: Appointment) => {
    const start = new Date(apt.startTime);
    const end = new Date(apt.endTime);
    const sh = start.getUTCHours();
    const sm = start.getUTCMinutes();
    const eh = end.getUTCHours();
    const em = end.getUTCMinutes();
    const top = Math.max(0, ((sh - 8) * 60 + sm) * (64 / 60));
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
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  // Touch swipe support for day navigation on mobile
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX - touchEndX;
    // Swipe threshold of 50px
    if (Math.abs(diff) > 50) {
      if (view === "day") {
        navigateDay(diff > 0 ? 1 : -1);
      } else {
        navigateWeek(diff > 0 ? 1 : -1);
      }
    }
    setTouchStartX(null);
  };

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Calendar</h1>
            <p className="text-sm md:text-base text-muted-foreground">Manage your appointments and availability</p>
          </div>
          <div className="flex gap-2 items-center">
            {locations.length > 0 && (
              <Select value={filterLocationId} onValueChange={setFilterLocationId}>
                <SelectTrigger className="w-[160px] min-h-[44px] text-xs md:text-sm">
                  <Building2 className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={() => setShowAvailability(true)} className="min-h-[44px] text-xs md:text-sm">
              <Clock className="w-4 h-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Availability</span>
              <span className="sm:hidden">Hours</span>
            </Button>
            <Dialog open={showNewAppointment} onOpenChange={setShowNewAppointment}>
              <DialogTrigger asChild>
                <Button className="min-h-[44px] text-xs md:text-sm"><Plus className="w-4 h-4 mr-1 md:mr-2" /><span className="hidden sm:inline">New Appointment</span><span className="sm:hidden">New</span></Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Schedule New Appointment</DialogTitle>
                  <DialogDescription>Create a new 1-hour therapy session.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Patient</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 px-2"
                        onClick={() => {
                          setIsNewPatient(!isNewPatient);
                          if (!isNewPatient) {
                            setNewAppointment({ ...newAppointment, patientId: "" });
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
                      <Popover open={patientSearchOpen} onOpenChange={setPatientSearchOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={patientSearchOpen}
                            className="w-full justify-between font-normal"
                          >
                            {newAppointment.patientId
                              ? (() => {
                                  const p = patients.find((p: any) => String(p.id) === newAppointment.patientId);
                                  return p ? `${(p as any).firstName} ${(p as any).lastName}` : "Select a patient";
                                })()
                              : "Search or type patient name..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Type a name to search..." />
                            <CommandList>
                              <CommandEmpty>
                                <div className="text-center py-2">
                                  <p className="text-sm text-muted-foreground mb-2">No patient found</p>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setIsNewPatient(true);
                                      setPatientSearchOpen(false);
                                      setNewAppointment({ ...newAppointment, patientId: "" });
                                    }}
                                  >
                                    <Plus className="mr-1 h-3 w-3" />
                                    Add New Patient
                                  </Button>
                                </div>
                              </CommandEmpty>
                              <CommandGroup>
                                {patients.map((p: any) => (
                                  <CommandItem
                                    key={p.id}
                                    value={`${p.firstName} ${p.lastName}`}
                                    onSelect={() => {
                                      setNewAppointment({ ...newAppointment, patientId: String(p.id) });
                                      setPatientSearchOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={`mr-2 h-4 w-4 ${
                                        newAppointment.patientId === String(p.id) ? "opacity-100" : "opacity-0"
                                      }`}
                                    />
                                    {p.firstName} {p.lastName}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Therapist</Label>
                    <Select value={newAppointment.therapistId} onValueChange={(v) => setNewAppointment({ ...newAppointment, therapistId: v })}>
                      <SelectTrigger><SelectValue placeholder="Select a therapist" /></SelectTrigger>
                      <SelectContent>
                        {therapists.map((t: any) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.firstName} {t.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {locations.length > 0 && (
                    <div className="space-y-2">
                      <Label>Location</Label>
                      <Select value={newAppointment.locationId} onValueChange={(v) => setNewAppointment({ ...newAppointment, locationId: v })}>
                        <SelectTrigger><SelectValue placeholder="Select a location (optional)" /></SelectTrigger>
                        <SelectContent>
                          {locations.map((loc: any) => (
                            <SelectItem key={loc.id} value={String(loc.id)}>
                              <span className="flex items-center gap-1.5">
                                <Building2 className="w-3 h-3" />
                                {loc.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
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
                  <div className="space-y-2">
                    <Label>Repeats</Label>
                    <Select value={newAppointment.recurrencePattern} onValueChange={(v) => setNewAppointment({ ...newAppointment, recurrencePattern: v as any })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Does not repeat</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newAppointment.recurrencePattern !== "none" && (
                    <div className="space-y-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                        <Repeat className="w-4 h-4" />
                        Recurring Appointment
                      </div>
                      <div className="space-y-2">
                        <Label>End After</Label>
                        <Select value={newAppointment.recurrenceEndType} onValueChange={(v) => setNewAppointment({ ...newAppointment, recurrenceEndType: v as any })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="occurrences">Number of sessions</SelectItem>
                            <SelectItem value="endDate">End date</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {newAppointment.recurrenceEndType === "occurrences" ? (
                        <div className="space-y-2">
                          <Label>Number of sessions (2-52)</Label>
                          <Input
                            type="number"
                            min="2"
                            max="52"
                            value={newAppointment.numberOfOccurrences}
                            onChange={(e) => setNewAppointment({ ...newAppointment, numberOfOccurrences: e.target.value })}
                          />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label>End Date</Label>
                          <Input
                            type="date"
                            value={newAppointment.recurrenceEndDate}
                            onChange={(e) => setNewAppointment({ ...newAppointment, recurrenceEndDate: e.target.value })}
                            min={newAppointment.date}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowNewAppointment(false)}>Cancel</Button>
                  <Button onClick={handleCreateAppointment} disabled={createMutation.isPending}>
                    {newAppointment.recurrencePattern !== "none" && <Repeat className="w-4 h-4 mr-2" />}
                    {newAppointment.recurrencePattern !== "none" ? "Schedule Series" : "Schedule"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Weekly cancellation summary */}
        <Card className="mb-3 md:mb-4 relative z-10">
          <CardContent className="py-2.5 md:py-3 px-3 md:px-6">
            <div className="flex flex-wrap items-center gap-2 md:gap-6 text-xs md:text-sm">
              <div className="flex items-center gap-1.5 md:gap-2">
                <CalendarX className="w-4 h-4 text-red-500" />
                <span className="font-medium">This Week:</span>
              </div>
              <div>
                <span className="font-semibold">{thisWeekCancelled}</span> cancelled of <span className="font-semibold">{thisWeekTotal}</span> total
              </div>
              <Badge variant={thisWeekRate > 20 ? "destructive" : "secondary"} className="text-[10px] md:text-xs">
                {thisWeekRate}% cancel rate
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Pending Appointment Requests */}
        <div className="mb-6">
          <AppointmentRequestQueue practiceId={1} />
        </div>

        {/* Navigation */}
        <Card className="mb-4 md:mb-6 relative z-10">
          <CardContent className="py-3 md:py-4 px-3 md:px-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0" onClick={() => view === "week" ? navigateWeek(-1) : navigateDay(-1)}><ChevronLeft className="w-4 h-4" /></Button>
                  <Button variant="outline" size="sm" className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0" onClick={() => view === "week" ? navigateWeek(1) : navigateDay(1)}><ChevronRight className="w-4 h-4" /></Button>
                  <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-0" onClick={() => setCurrentDate(new Date())}>Today</Button>
                </div>
                <div className="flex items-center gap-1.5 sm:hidden">
                  <Button variant={view === "week" ? "default" : "outline"} size="sm" className="min-h-[44px] text-xs" onClick={() => setView("week")}>Week</Button>
                  <Button variant={view === "day" ? "default" : "outline"} size="sm" className="min-h-[44px] text-xs" onClick={() => setView("day")}>Day</Button>
                </div>
              </div>
              <h2 className="text-sm md:text-lg font-semibold text-center">
                {view === "week" ? formatDate(weekDates[0]) + " - " + formatDate(weekDates[6]) + ", " + weekDates[0].getFullYear() : formatDateFull(currentDate)}
              </h2>
              <div className="hidden sm:flex items-center gap-2">
                <Button variant={view === "week" ? "default" : "outline"} size="sm" onClick={() => setView("week")}>Week</Button>
                <Button variant={view === "day" ? "default" : "outline"} size="sm" onClick={() => setView("day")}>Day</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Calendar Grid */}
        <Card>
          <CardContent className="p-0" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            {view === "week" && (
              <div className="hidden md:grid grid-cols-8 border-b">
                <div className="w-16 border-r" />
                {weekDates.map((date, i) => (
                  <div key={i} className={"p-2 text-center border-r last:border-r-0 " + (date.toDateString() === new Date().toDateString() ? "bg-blue-50" : "")}>
                    <div className="text-sm text-slate-500">{DAYS[date.getDay()].slice(0, 3)}</div>
                    <div className={"text-lg font-semibold " + (date.toDateString() === new Date().toDateString() ? "text-blue-600" : "")}>{date.getDate()}</div>
                  </div>
                ))}
              </div>
            )}
            {/* Desktop: traditional time grid */}
            <div className="hidden md:block relative">
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
                        <div className="text-xs font-medium truncate flex items-center gap-1">
                          {(apt as any).isRecurring && <Repeat className="w-3 h-3 flex-shrink-0" />}
                          {apt.title || "Appointment"}
                        </div>
                        <div className="text-xs text-slate-600 truncate">
                          {formatTime(apt.startTime)}
                          {apt.therapistId && (() => {
                            const therapist = therapists.find((t: any) => t.id === apt.therapistId);
                            return therapist ? ` - ${therapist.firstName}` : "";
                          })()}
                          {(apt as any).locationId && (() => {
                            const loc = locations.find((l: any) => l.id === (apt as any).locationId);
                            return loc ? ` @ ${loc.name}` : "";
                          })()}
                          {apt.status === "cancelled" && ` (Cancelled${(apt as any).cancelledBy ? ` by ${(apt as any).cancelledBy === "patient" ? "Patient" : "Staff"}` : ""})`}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile: stacked appointment cards */}
            <div className="md:hidden p-3">
              {view === "week" && (
                <div className="flex gap-2 mb-3 overflow-x-auto pb-2 -mx-1 px-1">
                  {weekDates.map((date, i) => (
                    <button
                      key={i}
                      onClick={() => { setCurrentDate(date); setView("day"); }}
                      className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-lg min-w-[52px] min-h-[44px] transition-colors ${
                        date.toDateString() === new Date().toDateString()
                          ? "bg-blue-100 text-blue-700 font-semibold"
                          : "bg-slate-50 text-slate-600"
                      }`}
                    >
                      <span className="text-[10px] uppercase">{DAYS[date.getDay()].slice(0, 3)}</span>
                      <span className="text-sm font-semibold">{date.getDate()}</span>
                      {getAppointmentsForDate(date).length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-0.5" />
                      )}
                    </button>
                  ))}
                </div>
              )}
              {(() => {
                const datesToShow = view === "day" ? [currentDate] : weekDates;
                const allApts = datesToShow.flatMap(d => getAppointmentsForDate(d));
                const sorted = allApts.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                if (sorted.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <CalendarX className="h-10 w-10 text-muted-foreground mb-3" />
                      <h3 className="text-base font-semibold text-foreground mb-1">No appointments {view === "day" ? "today" : "this week"}</h3>
                      <p className="text-sm text-muted-foreground mb-4">Schedule a session to get started.</p>
                      <Button size="sm" onClick={() => setShowNewAppointment(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        New Appointment
                      </Button>
                    </div>
                  );
                }
                return (
                  <div className="space-y-2">
                    {sorted.map((apt) => (
                      <div
                        key={apt.id}
                        className={`rounded-lg p-3 cursor-pointer active:opacity-80 ${getCalendarBlockStyle(apt)}`}
                        onClick={() => {
                          if (apt.status !== "cancelled") {
                            openCancelDialog(apt);
                          } else {
                            toast({ title: apt.title || "Appointment", description: `Cancelled: ${apt.cancellationReason || "N/A"}` });
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            {(apt as any).isRecurring && <Repeat className="w-3.5 h-3.5 flex-shrink-0" />}
                            <span className="font-medium text-sm truncate">{apt.title || "Appointment"}</span>
                          </div>
                          <Badge className={`${getStatusColor(apt.status || "scheduled")} text-[10px] flex-shrink-0 ml-2`}>
                            {apt.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-600 mt-1">
                          {formatTime(apt.startTime)} - {formatTime(apt.endTime)}
                          {apt.therapistId && (() => {
                            const therapist = therapists.find((t: any) => t.id === apt.therapistId);
                            return therapist ? ` | ${therapist.firstName}` : "";
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Appointments */}
        <Card className="mt-4 md:mt-6">
          <CardHeader className="px-4 md:px-6"><CardTitle className="text-base md:text-lg">Upcoming Appointments</CardTitle></CardHeader>
          <CardContent className="px-4 md:px-6">
            <div className="space-y-2 md:space-y-4">
              {appointments
                .filter(a => new Date(a.startTime) >= new Date() && a.status !== "cancelled")
                .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                .slice(0, 5)
                .map((apt) => (
                  <div key={apt.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 bg-slate-50 rounded-lg gap-2 md:gap-4">
                    <div className="flex items-center gap-3 md:gap-4">
                      <div className="w-9 h-9 md:w-10 md:h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm md:text-base flex items-center gap-1">
                          {(apt as any).isRecurring && <Repeat className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                          <span className="truncate">{apt.title || "Appointment"}</span>
                        </div>
                        <div className="text-xs md:text-sm text-slate-600 truncate">
                          {new Date(apt.startTime).toLocaleDateString()} at {formatTime(apt.startTime)} - {formatTime(apt.endTime)}
                          {apt.therapistId && (() => {
                            const therapist = therapists.find((t: any) => t.id === apt.therapistId);
                            return therapist ? ` | ${therapist.firstName} ${therapist.lastName}` : "";
                          })()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-12 sm:ml-0">
                      <Badge className={`${getStatusColor(apt.status || "scheduled")} text-[10px] md:text-xs`}>{apt.status}</Badge>
                      <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-0" onClick={() => openCancelDialog(apt)}>
                        <XCircle className="w-4 h-4 mr-1" />Cancel
                      </Button>
                    </div>
                  </div>
                ))}
              {appointments.filter(a => new Date(a.startTime) >= new Date() && a.status !== "cancelled").length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 md:py-12 text-center">
                  <ClipboardList className="h-10 w-10 md:h-12 md:w-12 text-muted-foreground mb-3 md:mb-4" />
                  <h3 className="text-base md:text-lg font-semibold mb-2">No upcoming appointments</h3>
                  <p className="text-muted-foreground mb-4 md:mb-6 max-w-md text-sm">
                    Schedule your first appointment to start managing your calendar.
                  </p>
                  <Button onClick={() => setShowNewAppointment(true)} className="w-full sm:w-auto min-h-[44px]">
                    <Plus className="w-4 h-4 mr-2" />
                    Schedule an Appointment
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cancel Appointment Dialog */}
        <Dialog open={showCancelDialog} onOpenChange={(open) => { setShowCancelDialog(open); if (!open) { delete (window as any).__cancelSeriesId; } }}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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

        {/* Series Action Dialog — "This appointment only" vs "All future" */}
        <Dialog open={showSeriesActionDialog} onOpenChange={setShowSeriesActionDialog}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Recurring Appointment</DialogTitle>
              <DialogDescription>
                This appointment is part of a recurring series. What would you like to do?
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <Button
                variant="outline"
                className="w-full justify-start h-auto p-4"
                onClick={handleSeriesActionSingle}
              >
                <div className="text-left">
                  <div className="font-medium">This appointment only</div>
                  <div className="text-sm text-slate-500">Cancel only this single appointment</div>
                </div>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start h-auto p-4"
                onClick={() => {
                  if (!seriesActionAppointment || !(seriesActionAppointment as any).seriesId) return;
                  setShowSeriesActionDialog(false);
                  // For cancel-all, go through the cancel dialog with a series flag
                  setCancelReason("");
                  setCancelNotes("");
                  setCancelledBy("");
                  setSelectedAppointment(seriesActionAppointment);
                  // Mark that we want to cancel the whole series
                  (window as any).__cancelSeriesId = (seriesActionAppointment as any).seriesId;
                  setShowCancelDialog(true);
                }}
              >
                <div className="text-left">
                  <div className="font-medium">This and all future appointments</div>
                  <div className="text-sm text-slate-500">Cancel all remaining appointments in this series</div>
                </div>
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSeriesActionDialog(false)}>Back</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Availability Dialog */}
        <Dialog open={showAvailability} onOpenChange={setShowAvailability}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
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

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar as CalendarIcon,
  Clock,
  Plus,
  User,
  CheckCircle,
  XCircle,
  AlertCircle,
  ClockIcon,
  Loader2,
  MapPin,
} from "lucide-react";

interface Appointment {
  id: number;
  startTime: string;
  endTime: string;
  title?: string;
  status: string;
  notes?: string;
  therapistName?: string;
  therapistId?: string;
}

interface AppointmentRequest {
  id: number;
  requestedDate: string;
  requestedTime: string;
  status: string;
  notes?: string;
  appointmentTypeId?: number;
  appointmentTypeName?: string;
  therapistId?: string;
  therapistName?: string;
  createdAt: string;
  rejectionReason?: string;
}

interface AppointmentType {
  id: number;
  name: string;
  description?: string;
  duration: number;
  requiresApproval: boolean;
}

interface Therapist {
  id: string;
  firstName: string;
  lastName: string;
}

interface PatientPortalAppointmentsProps {
  token: string;
}

export default function PatientPortalAppointments({ token }: PatientPortalAppointmentsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [selectedTab, setSelectedTab] = useState("upcoming");

  // Request form state
  const [selectedType, setSelectedType] = useState<string>("");
  const [selectedTherapist, setSelectedTherapist] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [requestNotes, setRequestNotes] = useState("");

  // Fetch dashboard to check intake and payment status
  const { data: dashboardData } = useQuery({
    queryKey: ["/api/patient-portal/dashboard", token],
    queryFn: async () => {
      const res = await fetch(`/api/patient-portal/dashboard`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
  });

  const intakeCompleted = dashboardData?.intakeCompleted ?? false;
  const hasPaymentMethod = dashboardData?.hasPaymentMethod ?? false;
  const canSchedule = intakeCompleted && hasPaymentMethod;

  // Fetch appointments
  const { data: appointmentsData, isLoading: appointmentsLoading } = useQuery({
    queryKey: ["/api/patient-portal/appointments", token],
    queryFn: async () => {
      const res = await fetch(`/api/patient-portal/appointments`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch appointments");
      return res.json();
    },
  });

  // Fetch appointment requests
  const { data: requestsData, isLoading: requestsLoading } = useQuery({
    queryKey: ["/api/patient-portal/appointment-requests", token],
    queryFn: async () => {
      const res = await fetch(`/api/patient-portal/appointment-requests`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch requests");
      return res.json();
    },
  });

  // Fetch appointment types
  const { data: appointmentTypes = [] } = useQuery<AppointmentType[]>({
    queryKey: ["/api/patient-portal/appointment-types", token],
    queryFn: async () => {
      const res = await fetch(`/api/patient-portal/appointment-types`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch appointment types");
      return res.json();
    },
  });

  // Fetch therapists
  const { data: therapists = [] } = useQuery<Therapist[]>({
    queryKey: ["/api/patient-portal/therapists", token],
    queryFn: async () => {
      const res = await fetch(`/api/patient-portal/therapists`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch therapists");
      return res.json();
    },
  });

  // Submit appointment request
  const requestMutation = useMutation({
    mutationFn: async (request: {
      appointmentTypeId: number;
      therapistId?: string;
      requestedDate: string;
      requestedTime: string;
      notes?: string;
    }) => {
      const res = await fetch(`/api/patient-portal/appointments/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to submit request");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patient-portal/appointment-requests", token] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-portal/dashboard", token] });
      setShowRequestDialog(false);
      resetForm();
      toast({
        title: t('portal.requestSubmitted'),
        description: t('portal.requestSubmittedDesc'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('portal.requestFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Cancel appointment request
  const cancelRequestMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const res = await fetch(`/api/patient-portal/appointment-requests/${requestId}/cancel`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to cancel request");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patient-portal/appointment-requests", token] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-portal/dashboard", token] });
      toast({
        title: t('portal.requestCancelled'),
        description: t('portal.requestCancelledDesc'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('portal.cancelFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setSelectedType("");
    setSelectedTherapist("");
    setSelectedDate(undefined);
    setSelectedTime("");
    setRequestNotes("");
  };

  const handleSubmitRequest = () => {
    if (!selectedType || !selectedDate || !selectedTime) {
      toast({
        title: t('portal.missingInfo'),
        description: t('portal.selectTypeDateTime'),
        variant: "destructive",
      });
      return;
    }

    requestMutation.mutate({
      appointmentTypeId: parseInt(selectedType),
      therapistId: selectedTherapist || undefined,
      requestedDate: selectedDate.toISOString().split("T")[0],
      requestedTime: selectedTime,
      notes: requestNotes || undefined,
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "scheduled":
      case "confirmed":
        return <Badge className="bg-green-500">{t('status.confirmed')}</Badge>;
      case "pending_approval":
        return <Badge variant="outline" className="text-yellow-600 border-yellow-600">{t('status.pendingApproval')}</Badge>;
      case "cancelled":
        return <Badge variant="destructive">{t('status.cancelled')}</Badge>;
      case "completed":
        return <Badge variant="secondary">{t('status.completed')}</Badge>;
      case "rejected":
        return <Badge variant="destructive">{t('status.rejected')}</Badge>;
      case "no_show":
        return <Badge variant="outline" className="text-red-600">{t('status.noShow')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const appointments = appointmentsData?.appointments || [];
  const requests = requestsData?.requests || [];

  const now = new Date();
  const upcomingAppointments = appointments.filter(
    (apt: Appointment) => new Date(apt.startTime) >= now && apt.status !== "cancelled"
  );
  const pastAppointments = appointments.filter(
    (apt: Appointment) => new Date(apt.startTime) < now || apt.status === "completed"
  );
  const pendingRequests = requests.filter(
    (req: AppointmentRequest) => req.status === "pending_approval"
  );

  // Generate available time slots
  const timeSlots = [];
  for (let hour = 8; hour <= 18; hour++) {
    timeSlots.push(`${hour.toString().padStart(2, "0")}:00`);
    timeSlots.push(`${hour.toString().padStart(2, "0")}:30`);
  }

  const isLoading = appointmentsLoading || requestsLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('portal.appointments')}</h2>
          <p className="text-muted-foreground">
            {t('portal.viewAppointments')}
          </p>
        </div>
        <Button
          onClick={() => setShowRequestDialog(true)}
          disabled={!canSchedule}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('portal.requestAppointment')}
        </Button>
      </div>

      {/* Requirements Alert - Show if intake or payment is missing */}
      {!canSchedule && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-red-800">{t('portal.completeToSchedule')}</p>
                <ul className="mt-2 space-y-1 text-sm text-red-700">
                  {!intakeCompleted && (
                    <li className="flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      {t('portal.completeIntake')}
                    </li>
                  )}
                  {!hasPaymentMethod && (
                    <li className="flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      {t('portal.addPaymentMethod')}
                    </li>
                  )}
                </ul>
                <p className="mt-3 text-sm text-red-600">
                  {t('portal.updateProfileReqs')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Requests Alert */}
      {pendingRequests.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
              <ClockIcon className="h-5 w-5 text-yellow-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium">
                {t('portal.pendingRequestCount', { count: pendingRequests.length })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('portal.staffReview')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList>
          <TabsTrigger value="upcoming">
            {t('portal.upcoming')}
            {upcomingAppointments.length > 0 && (
              <Badge variant="secondary" className="ml-2">{upcomingAppointments.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="requests">
            {t('portal.requests')}
            {pendingRequests.length > 0 && (
              <Badge variant="secondary" className="ml-2">{pendingRequests.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="past">{t('portal.past')}</TabsTrigger>
        </TabsList>

        {/* Upcoming Appointments */}
        <TabsContent value="upcoming">
          <Card>
            <CardHeader>
              <CardTitle>{t('portal.upcomingAppointments')}</CardTitle>
              <CardDescription>{t('portal.confirmedFuture')}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : upcomingAppointments.length === 0 ? (
                <div className="text-center py-8">
                  <CalendarIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">{t('portal.noUpcomingAppt')}</p>
                  <Button variant="outline" className="mt-4" onClick={() => setShowRequestDialog(true)}>
                    {t('portal.requestAnAppt')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {upcomingAppointments.map((apt: Appointment) => (
                    <AppointmentCard
                      key={apt.id}
                      appointment={apt}
                      formatDate={formatDate}
                      formatTime={formatTime}
                      getStatusBadge={getStatusBadge}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appointment Requests */}
        <TabsContent value="requests">
          <Card>
            <CardHeader>
              <CardTitle>{t('portal.appointmentRequests')}</CardTitle>
              <CardDescription>{t('portal.trackRequests')}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : requests.length === 0 ? (
                <div className="text-center py-8">
                  <ClockIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">{t('portal.noAppointmentRequests')}</p>
                  <Button variant="outline" className="mt-4" onClick={() => setShowRequestDialog(true)}>
                    {t('portal.requestAnAppt')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {requests.map((req: AppointmentRequest) => (
                    <RequestCard
                      key={req.id}
                      request={req}
                      getStatusBadge={getStatusBadge}
                      onCancel={() => cancelRequestMutation.mutate(req.id)}
                      isCancelling={cancelRequestMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Past Appointments */}
        <TabsContent value="past">
          <Card>
            <CardHeader>
              <CardTitle>{t('portal.pastAppointments')}</CardTitle>
              <CardDescription>{t('portal.pastApptDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : pastAppointments.length === 0 ? (
                <div className="text-center py-8">
                  <CalendarIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">{t('portal.noPastAppointments')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pastAppointments.map((apt: Appointment) => (
                    <AppointmentCard
                      key={apt.id}
                      appointment={apt}
                      formatDate={formatDate}
                      formatTime={formatTime}
                      getStatusBadge={getStatusBadge}
                      isPast
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Request Appointment Dialog */}
      <Dialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('portal.requestDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('portal.requestDialogDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Appointment Type */}
            <div className="space-y-2">
              <Label>{t('portal.appointmentType')} *</Label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger>
                  <SelectValue placeholder={t('portal.selectAppointmentType')} />
                </SelectTrigger>
                <SelectContent>
                  {appointmentTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id.toString()}>
                      {type.name} ({type.duration} {t('portal.min')})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preferred Therapist */}
            <div className="space-y-2">
              <Label>{t('portal.preferredTherapist')}</Label>
              <Select value={selectedTherapist} onValueChange={setSelectedTherapist}>
                <SelectTrigger>
                  <SelectValue placeholder={t('portal.noPreference')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('portal.noPreference')}</SelectItem>
                  {therapists.map((therapist) => (
                    <SelectItem key={therapist.id} value={therapist.id}>
                      {therapist.firstName} {therapist.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Selection */}
            <div className="space-y-2">
              <Label>{t('portal.preferredDate')} *</Label>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                disabled={(date) => date < new Date() || date.getDay() === 0 || date.getDay() === 6}
                className="rounded-md border"
              />
            </div>

            {/* Time Selection */}
            <div className="space-y-2">
              <Label>{t('portal.preferredTime')} *</Label>
              <Select value={selectedTime} onValueChange={setSelectedTime}>
                <SelectTrigger>
                  <SelectValue placeholder={t('portal.selectTime')} />
                </SelectTrigger>
                <SelectContent>
                  {timeSlots.map((time) => (
                    <SelectItem key={time} value={time}>
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>{t('portal.additionalNotes')}</Label>
              <Textarea
                value={requestNotes}
                onChange={(e) => setRequestNotes(e.target.value)}
                placeholder={t('portal.notesPlaceholder')}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRequestDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmitRequest}
              disabled={!selectedType || !selectedDate || !selectedTime || requestMutation.isPending}
            >
              {requestMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('portal.submitting')}
                </>
              ) : (
                t('portal.submitRequest')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AppointmentCard({
  appointment,
  formatDate,
  formatTime,
  getStatusBadge,
  isPast = false,
}: {
  appointment: Appointment;
  formatDate: (date: string) => string;
  formatTime: (date: string) => string;
  getStatusBadge: (status: string) => React.ReactNode;
  isPast?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className={`p-4 rounded-lg border ${isPast ? "bg-slate-50" : "bg-white"}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${isPast ? "bg-slate-200" : "bg-primary/10"}`}>
            <CalendarIcon className={`h-6 w-6 ${isPast ? "text-slate-500" : "text-primary"}`} />
          </div>
          <div>
            <p className="font-medium">{appointment.title || t('portal.appointment')}</p>
            <p className="text-sm text-muted-foreground">
              {formatDate(appointment.startTime)}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
            </p>
            {appointment.therapistName && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <User className="h-3 w-3" />
                {appointment.therapistName}
              </p>
            )}
          </div>
        </div>
        {getStatusBadge(appointment.status)}
      </div>
    </div>
  );
}

function RequestCard({
  request,
  getStatusBadge,
  onCancel,
  isCancelling,
}: {
  request: AppointmentRequest;
  getStatusBadge: (status: string) => React.ReactNode;
  onCancel: () => void;
  isCancelling: boolean;
}) {
  const { t } = useTranslation();
  const isPending = request.status === "pending_approval";

  return (
    <div className={`p-4 rounded-lg border ${isPending ? "border-yellow-200 bg-yellow-50" : "bg-slate-50"}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${isPending ? "bg-yellow-100" : "bg-slate-200"}`}>
            <ClockIcon className={`h-6 w-6 ${isPending ? "text-yellow-600" : "text-slate-500"}`} />
          </div>
          <div>
            <p className="font-medium">{request.appointmentTypeName || t('portal.appointmentRequest')}</p>
            <p className="text-sm text-muted-foreground">
              {t('portal.requested')} {request.requestedDate} at {request.requestedTime}
            </p>
            {request.therapistName && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <User className="h-3 w-3" />
                {t('portal.preferred')} {request.therapistName}
              </p>
            )}
            {request.notes && (
              <p className="text-sm text-muted-foreground mt-1">
                {t('portal.notes')} {request.notes}
              </p>
            )}
            {request.rejectionReason && (
              <p className="text-sm text-red-600 mt-1">
                {t('portal.reason')} {request.rejectionReason}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {getStatusBadge(request.status)}
          {isPending && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isCancelling}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              {isCancelling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <XCircle className="h-4 w-4 mr-1" />
                  {t('common.cancel')}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

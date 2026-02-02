import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  Clock,
  Settings,
  Plus,
  Trash2,
  Edit,
  ExternalLink,
  Copy,
  CheckCircle,
  XCircle,
  Users,
} from "lucide-react";

interface AppointmentType {
  id: number;
  name: string;
  description?: string;
  duration: number;
  price?: string;
  color?: string;
  isActive: boolean;
  allowOnlineBooking: boolean;
  requiresApproval: boolean;
  bufferBefore: number;
  bufferAfter: number;
  maxAdvanceBooking: number;
  minAdvanceBooking: number;
}

interface TherapistAvailability {
  id: number;
  therapistId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

interface BookingSettings {
  id?: number;
  practiceId: number;
  isOnlineBookingEnabled: boolean;
  bookingPageSlug?: string;
  welcomeMessage?: string;
  confirmationMessage?: string;
  requirePhoneNumber: boolean;
  requireInsuranceInfo: boolean;
  allowNewPatients: boolean;
  newPatientMessage?: string;
  cancellationPolicy?: string;
  defaultTimezone: string;
}

interface OnlineBooking {
  id: number;
  confirmationCode: string;
  status: string;
  requestedDate: string;
  requestedTime: string;
  guestFirstName?: string;
  guestLastName?: string;
  guestEmail?: string;
  patientId?: number;
  isNewPatient: boolean;
  createdAt: string;
}

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export default function BookingSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isTypeDialogOpen, setIsTypeDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<AppointmentType | null>(null);

  // Fetch booking settings
  const { data: settings } = useQuery<BookingSettings>({
    queryKey: ["/api/booking/settings"],
    queryFn: async () => {
      const res = await fetch("/api/booking/settings?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  // Fetch appointment types
  const { data: appointmentTypes = [] } = useQuery<AppointmentType[]>({
    queryKey: ["/api/booking/appointment-types"],
    queryFn: async () => {
      const res = await fetch("/api/booking/appointment-types?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch types");
      return res.json();
    },
  });

  // Fetch availability
  const { data: availability = [] } = useQuery<TherapistAvailability[]>({
    queryKey: ["/api/booking/availability"],
    queryFn: async () => {
      const res = await fetch("/api/booking/availability?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch availability");
      return res.json();
    },
  });

  // Fetch pending bookings
  const { data: pendingBookings = [] } = useQuery<OnlineBooking[]>({
    queryKey: ["/api/booking/bookings", "pending"],
    queryFn: async () => {
      const res = await fetch("/api/booking/bookings?practiceId=1&status=pending");
      if (!res.ok) throw new Error("Failed to fetch bookings");
      return res.json();
    },
  });

  // Save settings mutation
  const saveSettings = useMutation({
    mutationFn: async (data: Partial<BookingSettings>) => {
      const res = await fetch("/api/booking/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, practiceId: 1 }),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/booking/settings"] });
      toast({ title: "Settings saved" });
    },
  });

  // Create/update appointment type
  const saveAppointmentType = useMutation({
    mutationFn: async (data: Partial<AppointmentType>) => {
      const url = data.id
        ? `/api/booking/appointment-types/${data.id}`
        : "/api/booking/appointment-types";
      const method = data.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, practiceId: 1 }),
      });
      if (!res.ok) throw new Error("Failed to save appointment type");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/booking/appointment-types"] });
      setIsTypeDialogOpen(false);
      setEditingType(null);
      toast({ title: "Appointment type saved" });
    },
  });

  // Delete appointment type
  const deleteAppointmentType = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/booking/appointment-types/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/booking/appointment-types"] });
      toast({ title: "Appointment type deleted" });
    },
  });

  // Confirm booking
  const confirmBooking = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/booking/bookings/${id}/confirm`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to confirm booking");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/booking/bookings"] });
      toast({ title: "Booking confirmed and appointment created" });
    },
  });

  // Cancel booking
  const cancelBooking = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/booking/bookings/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cancelled by admin" }),
      });
      if (!res.ok) throw new Error("Failed to cancel booking");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/booking/bookings"] });
      toast({ title: "Booking cancelled" });
    },
  });

  const bookingUrl = settings?.bookingPageSlug
    ? `${window.location.origin}/book/${settings.bookingPageSlug}`
    : null;

  return (
    <div className="md:ml-64 p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Online Booking</h1>
          <p className="text-muted-foreground">
            Configure your online scheduling and manage bookings
          </p>
        </div>
        {bookingUrl && (
          <div className="flex items-center gap-2">
            <Input value={bookingUrl} readOnly className="w-64" />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(bookingUrl);
                toast({ title: "Link copied to clipboard" });
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" asChild>
              <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="settings" className="space-y-4">
        <TabsList>
          <TabsTrigger value="settings">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="types">
            <Calendar className="mr-2 h-4 w-4" />
            Appointment Types
          </TabsTrigger>
          <TabsTrigger value="availability">
            <Clock className="mr-2 h-4 w-4" />
            Availability
          </TabsTrigger>
          <TabsTrigger value="bookings">
            <Users className="mr-2 h-4 w-4" />
            Pending Bookings
            {pendingBookings.length > 0 && (
              <Badge className="ml-2" variant="destructive">
                {pendingBookings.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Booking Page Settings</CardTitle>
              <CardDescription>
                Configure your public booking page
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Online Booking</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow patients to book appointments online
                  </p>
                </div>
                <Switch
                  checked={settings?.isOnlineBookingEnabled ?? true}
                  onCheckedChange={(checked) =>
                    saveSettings.mutate({ isOnlineBookingEnabled: checked })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Booking Page URL Slug</Label>
                <div className="flex gap-2">
                  <span className="flex items-center text-muted-foreground">
                    {window.location.origin}/book/
                  </span>
                  <Input
                    value={settings?.bookingPageSlug || ""}
                    onChange={(e) =>
                      saveSettings.mutate({ bookingPageSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })
                    }
                    placeholder="my-practice"
                    className="w-48"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Welcome Message</Label>
                <Textarea
                  value={settings?.welcomeMessage || ""}
                  onChange={(e) =>
                    saveSettings.mutate({ welcomeMessage: e.target.value })
                  }
                  placeholder="Welcome to our practice! Please select a service to get started."
                  rows={2}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Allow New Patients</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow new patients to book online
                  </p>
                </div>
                <Switch
                  checked={settings?.allowNewPatients ?? true}
                  onCheckedChange={(checked) =>
                    saveSettings.mutate({ allowNewPatients: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Require Phone Number</Label>
                  <p className="text-sm text-muted-foreground">
                    Make phone number a required field
                  </p>
                </div>
                <Switch
                  checked={settings?.requirePhoneNumber ?? true}
                  onCheckedChange={(checked) =>
                    saveSettings.mutate({ requirePhoneNumber: checked })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Cancellation Policy</Label>
                <Textarea
                  value={settings?.cancellationPolicy || ""}
                  onChange={(e) =>
                    saveSettings.mutate({ cancellationPolicy: e.target.value })
                  }
                  placeholder="Please provide at least 24 hours notice for cancellations..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appointment Types Tab */}
        <TabsContent value="types">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Appointment Types</CardTitle>
                <CardDescription>
                  Configure the types of appointments patients can book
                </CardDescription>
              </div>
              <Dialog open={isTypeDialogOpen} onOpenChange={setIsTypeDialogOpen}>
                <DialogTrigger asChild>
                  <Button onClick={() => setEditingType(null)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Type
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {editingType ? "Edit" : "Add"} Appointment Type
                    </DialogTitle>
                  </DialogHeader>
                  <AppointmentTypeForm
                    type={editingType}
                    onSubmit={(data) => saveAppointmentType.mutate(data)}
                    isLoading={saveAppointmentType.isPending}
                  />
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {appointmentTypes.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No appointment types configured. Add one to enable online booking.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Online Booking</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {appointmentTypes.map((type) => (
                      <TableRow key={type.id}>
                        <TableCell className="font-medium">{type.name}</TableCell>
                        <TableCell>{type.duration} min</TableCell>
                        <TableCell>
                          {type.price ? `$${type.price}` : "-"}
                        </TableCell>
                        <TableCell>
                          {type.allowOnlineBooking ? (
                            <Badge variant="outline" className="bg-green-50">
                              Enabled
                            </Badge>
                          ) : (
                            <Badge variant="outline">Disabled</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {type.isActive ? (
                            <Badge>Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingType(type);
                                setIsTypeDialogOpen(true);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm("Delete this appointment type?")) {
                                  deleteAppointmentType.mutate(type.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Availability Tab */}
        <TabsContent value="availability">
          <Card>
            <CardHeader>
              <CardTitle>Therapist Availability</CardTitle>
              <CardDescription>
                Set weekly availability for online bookings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Availability is configured per therapist in their profile settings.
                Current availability slots: {availability.length}
              </p>
              {availability.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Therapist</TableHead>
                      <TableHead>Day</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {availability.map((slot) => (
                      <TableRow key={slot.id}>
                        <TableCell>{slot.therapistId}</TableCell>
                        <TableCell>{DAYS_OF_WEEK[slot.dayOfWeek]}</TableCell>
                        <TableCell>
                          {slot.startTime} - {slot.endTime}
                        </TableCell>
                        <TableCell>
                          {slot.isAvailable ? (
                            <Badge>Available</Badge>
                          ) : (
                            <Badge variant="secondary">Unavailable</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pending Bookings Tab */}
        <TabsContent value="bookings">
          <Card>
            <CardHeader>
              <CardTitle>Pending Bookings</CardTitle>
              <CardDescription>
                Review and confirm online booking requests
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pendingBookings.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No pending bookings
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingBookings.map((booking) => (
                      <TableRow key={booking.id}>
                        <TableCell className="font-mono">
                          {booking.confirmationCode}
                        </TableCell>
                        <TableCell>
                          {booking.guestFirstName} {booking.guestLastName}
                          {booking.isNewPatient && (
                            <Badge variant="outline" className="ml-2">
                              New
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {new Date(booking.requestedDate).toLocaleDateString()} at{" "}
                          {booking.requestedTime}
                        </TableCell>
                        <TableCell>
                          {booking.status}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => confirmBooking.mutate(booking.id)}
                              disabled={confirmBooking.isPending}
                            >
                              <CheckCircle className="mr-1 h-4 w-4" />
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (confirm("Cancel this booking?")) {
                                  cancelBooking.mutate(booking.id);
                                }
                              }}
                            >
                              <XCircle className="mr-1 h-4 w-4" />
                              Cancel
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Appointment Type Form
function AppointmentTypeForm({
  type,
  onSubmit,
  isLoading,
}: {
  type: AppointmentType | null;
  onSubmit: (data: Partial<AppointmentType>) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    name: type?.name || "",
    description: type?.description || "",
    duration: type?.duration || 60,
    price: type?.price || "",
    isActive: type?.isActive ?? true,
    allowOnlineBooking: type?.allowOnlineBooking ?? true,
    requiresApproval: type?.requiresApproval ?? false,
    bufferBefore: type?.bufferBefore || 0,
    bufferAfter: type?.bufferAfter || 0,
    maxAdvanceBooking: type?.maxAdvanceBooking || 60,
    minAdvanceBooking: type?.minAdvanceBooking || 1,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...(type?.id ? { id: type.id } : {}),
      ...formData,
      duration: Number(formData.duration),
      bufferBefore: Number(formData.bufferBefore),
      bufferAfter: Number(formData.bufferAfter),
      maxAdvanceBooking: Number(formData.maxAdvanceBooking),
      minAdvanceBooking: Number(formData.minAdvanceBooking),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Name *</Label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
          placeholder="Initial Consultation"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          value={formData.description}
          onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
          placeholder="A comprehensive first session..."
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Duration (minutes) *</Label>
          <Select
            value={String(formData.duration)}
            onValueChange={(v) => setFormData((p) => ({ ...p, duration: Number(v) }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[15, 30, 45, 60, 75, 90, 120].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Price</Label>
          <Input
            type="number"
            value={formData.price}
            onChange={(e) => setFormData((p) => ({ ...p, price: e.target.value }))}
            placeholder="150.00"
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label>Active</Label>
        <Switch
          checked={formData.isActive}
          onCheckedChange={(checked) => setFormData((p) => ({ ...p, isActive: checked }))}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label>Allow Online Booking</Label>
        <Switch
          checked={formData.allowOnlineBooking}
          onCheckedChange={(checked) =>
            setFormData((p) => ({ ...p, allowOnlineBooking: checked }))
          }
        />
      </div>

      <DialogFooter>
        <Button type="submit" disabled={!formData.name || isLoading}>
          {isLoading ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

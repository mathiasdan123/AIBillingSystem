import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Clock,
  MapPin,
  Phone,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Calendar as CalendarIcon,
  User,
} from "lucide-react";

interface BookingPageData {
  practice: {
    id: number;
    name: string;
    address?: string;
    phone?: string;
  };
  settings: {
    welcomeMessage?: string;
    allowNewPatients: boolean;
    newPatientMessage?: string;
    cancellationPolicy?: string;
    requirePhoneNumber: boolean;
    requireInsuranceInfo: boolean;
  };
  appointmentTypes: {
    id: number;
    name: string;
    description?: string;
    duration: number;
    price?: string;
  }[];
  therapists: {
    id: string;
    name: string;
  }[];
}

type BookingStep = "service" | "datetime" | "info" | "confirm" | "success";

export default function PublicBookingPage() {
  const params = useParams<{ slug: string }>();
  const [pageData, setPageData] = useState<BookingPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<BookingStep>("service");

  // Booking form state
  const [selectedType, setSelectedType] = useState<number | null>(null);
  const [selectedTherapist, setSelectedTherapist] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    notes: "",
    isNewPatient: true,
    agreeToPolicy: false,
  });

  const [submitting, setSubmitting] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState<string | null>(null);

  // Load booking page data
  useEffect(() => {
    async function loadPage() {
      try {
        const res = await fetch(`/api/public/book/${params.slug}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Booking page not found");
          } else {
            setError("Failed to load booking page");
          }
          return;
        }
        const data = await res.json();
        setPageData(data);
      } catch (err) {
        setError("Failed to load booking page");
      } finally {
        setLoading(false);
      }
    }
    loadPage();
  }, [params.slug]);

  // Load available slots when date changes
  useEffect(() => {
    async function loadSlots() {
      if (!selectedType || !selectedDate) return;

      setSlotsLoading(true);
      try {
        const dateStr = selectedDate.toISOString().split("T")[0];
        const searchParams = new URLSearchParams({
          appointmentTypeId: String(selectedType),
          date: dateStr,
        });
        if (selectedTherapist) {
          searchParams.append("therapistId", selectedTherapist);
        }

        const res = await fetch(`/api/public/book/${params.slug}/slots?${searchParams}`);
        if (res.ok) {
          const slots = await res.json();
          setAvailableSlots(slots);
        }
      } catch (err) {
        console.error("Failed to load slots:", err);
      } finally {
        setSlotsLoading(false);
      }
    }
    loadSlots();
  }, [selectedType, selectedTherapist, selectedDate]);

  const handleSubmit = async () => {
    if (!selectedType || !selectedDate || !selectedTime) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/book/${params.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentTypeId: selectedType,
          therapistId: selectedTherapist,
          date: selectedDate.toISOString().split("T")[0],
          time: selectedTime,
          ...formData,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Failed to submit booking");
        return;
      }

      setConfirmationCode(data.confirmationCode);
      setStep("success");
    } catch (err) {
      setError("Failed to submit booking");
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}`;
  };

  const getSelectedTypeName = () => {
    return pageData?.appointmentTypes.find((t) => t.id === selectedType)?.name || "";
  };

  const getSelectedTherapistName = () => {
    if (!selectedTherapist) return "Any available";
    return pageData?.therapists.find((t) => t.id === selectedTherapist)?.name || "";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !pageData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-muted-foreground">{error || "Page not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-primary text-white py-8">
        <div className="max-w-3xl mx-auto px-4">
          <h1 className="text-3xl font-bold">{pageData.practice.name}</h1>
          {pageData.practice.address && (
            <p className="flex items-center gap-2 mt-2 opacity-90">
              <MapPin className="h-4 w-4" />
              {pageData.practice.address}
            </p>
          )}
          {pageData.practice.phone && (
            <p className="flex items-center gap-2 mt-1 opacity-90">
              <Phone className="h-4 w-4" />
              {pageData.practice.phone}
            </p>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Progress Steps */}
        {step !== "success" && (
          <div className="flex justify-between mb-8">
            {["service", "datetime", "info", "confirm"].map((s, i) => (
              <div
                key={s}
                className={`flex items-center ${i < 3 ? "flex-1" : ""}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    step === s
                      ? "bg-primary text-white"
                      : ["service", "datetime", "info", "confirm"].indexOf(step) >
                        ["service", "datetime", "info", "confirm"].indexOf(s)
                      ? "bg-green-500 text-white"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {["service", "datetime", "info", "confirm"].indexOf(step) > i ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    i + 1
                  )}
                </div>
                {i < 3 && (
                  <div
                    className={`flex-1 h-1 mx-2 ${
                      ["service", "datetime", "info", "confirm"].indexOf(step) > i
                        ? "bg-green-500"
                        : "bg-gray-200"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Step 1: Select Service */}
        {step === "service" && (
          <Card>
            <CardHeader>
              <CardTitle>Select Service</CardTitle>
              <CardDescription>
                {pageData.settings.welcomeMessage ||
                  "Choose the type of appointment you'd like to book"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {pageData.appointmentTypes.map((type) => (
                <div
                  key={type.id}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    selectedType === type.id
                      ? "border-primary bg-primary/5"
                      : "hover:border-gray-300"
                  }`}
                  onClick={() => setSelectedType(type.id)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-medium">{type.name}</h3>
                      {type.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {type.description}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {type.duration} minutes
                      </p>
                    </div>
                    {type.price && (
                      <Badge variant="secondary">${type.price}</Badge>
                    )}
                  </div>
                </div>
              ))}

              {pageData.therapists.length > 1 && (
                <div className="pt-4 border-t">
                  <Label>Preferred Therapist (optional)</Label>
                  <Select
                    value={selectedTherapist || "any"}
                    onValueChange={(v) => setSelectedTherapist(v === "any" ? null : v)}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Any available" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any available</SelectItem>
                      {pageData.therapists.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="pt-4 flex justify-end">
                <Button onClick={() => setStep("datetime")} disabled={!selectedType}>
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Select Date & Time */}
        {step === "datetime" && (
          <Card>
            <CardHeader>
              <CardTitle>Select Date & Time</CardTitle>
              <CardDescription>
                Choose your preferred appointment date and time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <Label className="mb-2 block">Select Date</Label>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      setSelectedDate(date);
                      setSelectedTime(null);
                    }}
                    disabled={(date) => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      return date < today || date.getDay() === 0;
                    }}
                    className="rounded-md border"
                  />
                </div>

                <div>
                  <Label className="mb-2 block">Available Times</Label>
                  {!selectedDate ? (
                    <p className="text-sm text-muted-foreground">
                      Please select a date first
                    </p>
                  ) : slotsLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading available times...
                    </div>
                  ) : availableSlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No available times for this date. Please select another date.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto">
                      {availableSlots.map((slot) => (
                        <Button
                          key={slot}
                          variant={selectedTime === slot ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedTime(slot)}
                        >
                          {formatTime(slot)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-6 flex justify-between">
                <Button variant="outline" onClick={() => setStep("service")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep("info")}
                  disabled={!selectedDate || !selectedTime}
                >
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Your Information */}
        {step === "info" && (
          <Card>
            <CardHeader>
              <CardTitle>Your Information</CardTitle>
              <CardDescription>
                Please provide your contact details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>First Name *</Label>
                  <Input
                    value={formData.firstName}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, firstName: e.target.value }))
                    }
                    placeholder="John"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Name *</Label>
                  <Input
                    value={formData.lastName}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, lastName: e.target.value }))
                    }
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, email: e.target.value }))
                  }
                  placeholder="john@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Phone {pageData.settings.requirePhoneNumber ? "*" : "(optional)"}
                </Label>
                <Input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  placeholder="(555) 123-4567"
                />
              </div>

              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="Any additional information you'd like us to know..."
                  rows={3}
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="newPatient"
                  checked={formData.isNewPatient}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, isNewPatient: !!checked }))
                  }
                />
                <Label htmlFor="newPatient" className="cursor-pointer">
                  I am a new patient
                </Label>
              </div>

              <div className="pt-6 flex justify-between">
                <Button variant="outline" onClick={() => setStep("datetime")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep("confirm")}
                  disabled={
                    !formData.firstName ||
                    !formData.lastName ||
                    !formData.email ||
                    (pageData.settings.requirePhoneNumber && !formData.phone)
                  }
                >
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Confirm */}
        {step === "confirm" && (
          <Card>
            <CardHeader>
              <CardTitle>Confirm Your Booking</CardTitle>
              <CardDescription>
                Please review your appointment details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-muted p-4 rounded-lg space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service:</span>
                  <span className="font-medium">{getSelectedTypeName()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Therapist:</span>
                  <span className="font-medium">{getSelectedTherapistName()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date:</span>
                  <span className="font-medium">
                    {selectedDate?.toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time:</span>
                  <span className="font-medium">
                    {selectedTime && formatTime(selectedTime)}
                  </span>
                </div>
              </div>

              <div className="bg-muted p-4 rounded-lg space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name:</span>
                  <span className="font-medium">
                    {formData.firstName} {formData.lastName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email:</span>
                  <span className="font-medium">{formData.email}</span>
                </div>
                {formData.phone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone:</span>
                    <span className="font-medium">{formData.phone}</span>
                  </div>
                )}
              </div>

              {pageData.settings.cancellationPolicy && (
                <div className="space-y-2">
                  <h4 className="font-medium">Cancellation Policy</h4>
                  <p className="text-sm text-muted-foreground">
                    {pageData.settings.cancellationPolicy}
                  </p>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="agreePolicy"
                      checked={formData.agreeToPolicy}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({ ...prev, agreeToPolicy: !!checked }))
                      }
                    />
                    <Label htmlFor="agreePolicy" className="cursor-pointer text-sm">
                      I agree to the cancellation policy
                    </Label>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="pt-4 flex justify-between">
                <Button variant="outline" onClick={() => setStep("info")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={
                    submitting ||
                    (!!pageData.settings.cancellationPolicy && !formData.agreeToPolicy)
                  }
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Confirm Booking
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Success */}
        {step === "success" && (
          <Card>
            <CardContent className="pt-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Booking Request Submitted!</h2>
              <p className="text-muted-foreground mb-6">
                Your appointment request has been received. You will receive a confirmation
                email shortly.
              </p>

              <div className="bg-muted p-4 rounded-lg inline-block">
                <p className="text-sm text-muted-foreground">Confirmation Code</p>
                <p className="text-2xl font-mono font-bold">{confirmationCode}</p>
              </div>

              <div className="mt-8 space-y-4">
                <div className="bg-muted p-4 rounded-lg text-left space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Service:</span>
                    <span className="font-medium">{getSelectedTypeName()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date:</span>
                    <span className="font-medium">
                      {selectedDate?.toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time:</span>
                    <span className="font-medium">
                      {selectedTime && formatTime(selectedTime)}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  Save your confirmation code. You can use it to check your booking status.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

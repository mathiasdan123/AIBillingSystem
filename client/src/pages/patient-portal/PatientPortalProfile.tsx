import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Shield,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle,
  CreditCard,
} from "lucide-react";

interface PatientProfile {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  phoneType?: string;
  dateOfBirth?: string;
  address?: string;
  preferredContactMethod?: string;
  smsConsentGiven?: boolean;
  // Insurance info
  insuranceProvider?: string;
  insuranceId?: string;
  policyNumber?: string;
  groupNumber?: string;
}

interface PatientPortalProfileProps {
  token: string;
}

export default function PatientPortalProfile({ token }: PatientPortalProfileProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<PatientProfile>>({});

  const { data: profile, isLoading, error } = useQuery<PatientProfile>({
    queryKey: ["/api/patient-portal/profile", token],
    queryFn: async () => {
      const res = await fetch(`/api/patient-portal/profile`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error("Failed to fetch profile");
      }
      return res.json();
    },
  });

  // Set form data when profile is loaded
  useEffect(() => {
    if (profile) {
      setFormData(profile);
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<PatientProfile>) => {
      const res = await fetch(`/api/patient-portal/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update profile");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patient-portal/profile", token] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-portal/dashboard", token] });
      setIsEditing(false);
      toast({
        title: "Profile Updated",
        description: "Your information has been saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  const handleCancel = () => {
    setFormData(profile || {});
    setIsEditing(false);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "Not set";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-8">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <p className="text-lg font-medium">Failed to load profile</p>
          <p className="text-muted-foreground">Please try refreshing the page</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Personal Information */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Personal Information
              </CardTitle>
              <CardDescription>
                Your basic contact information
              </CardDescription>
            </div>
            {!isEditing ? (
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                Edit Profile
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* First Name */}
            <div className="space-y-2">
              <Label>First Name</Label>
              {isEditing ? (
                <Input
                  value={formData.firstName || ""}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">{profile.firstName}</p>
              )}
            </div>

            {/* Last Name */}
            <div className="space-y-2">
              <Label>Last Name</Label>
              {isEditing ? (
                <Input
                  value={formData.lastName || ""}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">{profile.lastName}</p>
              )}
            </div>

            {/* Date of Birth */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Date of Birth
              </Label>
              {isEditing ? (
                <Input
                  type="date"
                  value={formData.dateOfBirth || ""}
                  onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {formatDate(profile.dateOfBirth)}
                </p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email Address
              </Label>
              {isEditing ? (
                <Input
                  type="email"
                  value={formData.email || ""}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.email || "Not set"}
                </p>
              )}
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Phone Number
              </Label>
              {isEditing ? (
                <Input
                  type="tel"
                  value={formData.phone || ""}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.phone || "Not set"}
                </p>
              )}
            </div>

            {/* Phone Type */}
            <div className="space-y-2">
              <Label>Phone Type</Label>
              {isEditing ? (
                <Select
                  value={formData.phoneType || "mobile"}
                  onValueChange={(value) => setFormData({ ...formData, phoneType: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mobile">Mobile</SelectItem>
                    <SelectItem value="landline">Landline</SelectItem>
                    <SelectItem value="work">Work</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md capitalize">
                  {profile.phoneType || "Mobile"}
                </p>
              )}
            </div>

            {/* Address */}
            <div className="space-y-2 md:col-span-2">
              <Label className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Address
              </Label>
              {isEditing ? (
                <Textarea
                  value={formData.address || ""}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Street address, City, State, ZIP"
                  rows={2}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md min-h-[60px]">
                  {profile.address || "Not set"}
                </p>
              )}
            </div>

            {/* Preferred Contact Method */}
            <div className="space-y-2">
              <Label>Preferred Contact Method</Label>
              {isEditing ? (
                <Select
                  value={formData.preferredContactMethod || "email"}
                  onValueChange={(value) => setFormData({ ...formData, preferredContactMethod: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">Text Message (SMS)</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md capitalize">
                  {profile.preferredContactMethod || "Email"}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Insurance Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Insurance Information
          </CardTitle>
          <CardDescription>
            Your health insurance details for billing purposes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Insurance Provider */}
            <div className="space-y-2">
              <Label>Insurance Provider</Label>
              {isEditing ? (
                <Input
                  value={formData.insuranceProvider || ""}
                  onChange={(e) => setFormData({ ...formData, insuranceProvider: e.target.value })}
                  placeholder="e.g., Blue Cross Blue Shield"
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.insuranceProvider || "Not set"}
                </p>
              )}
            </div>

            {/* Member ID */}
            <div className="space-y-2">
              <Label>Member ID</Label>
              {isEditing ? (
                <Input
                  value={formData.insuranceId || ""}
                  onChange={(e) => setFormData({ ...formData, insuranceId: e.target.value })}
                  placeholder="Your member ID number"
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.insuranceId || "Not set"}
                </p>
              )}
            </div>

            {/* Policy Number */}
            <div className="space-y-2">
              <Label>Policy Number</Label>
              {isEditing ? (
                <Input
                  value={formData.policyNumber || ""}
                  onChange={(e) => setFormData({ ...formData, policyNumber: e.target.value })}
                  placeholder="Policy number"
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.policyNumber || "Not set"}
                </p>
              )}
            </div>

            {/* Group Number */}
            <div className="space-y-2">
              <Label>Group Number</Label>
              {isEditing ? (
                <Input
                  value={formData.groupNumber || ""}
                  onChange={(e) => setFormData({ ...formData, groupNumber: e.target.value })}
                  placeholder="Group number (if applicable)"
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.groupNumber || "Not set"}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-blue-900">Your information is secure</p>
                <p className="text-blue-700">
                  Insurance information is encrypted and used only for billing purposes.
                  We never share your data with third parties without your consent.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Payment Method
          </CardTitle>
          <CardDescription>
            A payment method on file is required to schedule appointments
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-900">Payment method required</p>
                <p className="text-yellow-700">
                  Please contact the office to add a payment method to your account.
                  This is required before you can schedule appointments.
                </p>
                <p className="text-yellow-600 mt-2 text-xs">
                  Online payment setup coming soon.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile Completion Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Profile Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <ProfileCheckItem label="Name" completed={!!profile.firstName && !!profile.lastName} />
            <ProfileCheckItem label="Email" completed={!!profile.email} />
            <ProfileCheckItem label="Phone" completed={!!profile.phone} />
            <ProfileCheckItem label="Date of Birth" completed={!!profile.dateOfBirth} />
            <ProfileCheckItem label="Address" completed={!!profile.address} />
            <ProfileCheckItem label="Insurance Provider" completed={!!profile.insuranceProvider} />
            <ProfileCheckItem label="Insurance ID" completed={!!profile.insuranceId} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileCheckItem({ label, completed }: { label: string; completed: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-md">
      <span className="text-sm">{label}</span>
      {completed ? (
        <Badge className="bg-green-500">
          <CheckCircle className="h-3 w-3 mr-1" />
          Complete
        </Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          Missing
        </Badge>
      )}
    </div>
  );
}

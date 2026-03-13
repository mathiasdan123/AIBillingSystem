import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  Bell,
  Moon,
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

interface NotificationPrefs {
  id: number;
  emailEnabled: boolean;
  smsEnabled: boolean;
  portalEnabled: boolean;
  appointmentReminders: boolean;
  billingNotifications: boolean;
  claimUpdates: boolean;
  surveyReminders: boolean;
  marketingEmails: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

interface PatientPortalProfileProps {
  token: string;
}

export default function PatientPortalProfile({ token }: PatientPortalProfileProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
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
        title: t('portal.profileUpdated'),
        description: t('portal.profileUpdatedDesc'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('portal.updateFailed'),
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
    if (!dateStr) return t('common.notSet');
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
          <p className="text-lg font-medium">{t('portal.failedLoadProfile')}</p>
          <p className="text-muted-foreground">{t('portal.tryRefreshing')}</p>
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
                {t('portal.personalInfo')}
              </CardTitle>
              <CardDescription>
                {t('portal.basicContact')}
              </CardDescription>
            </div>
            {!isEditing ? (
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                {t('portal.editProfile')}
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCancel}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {t('portal.saveChanges')}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* First Name */}
            <div className="space-y-2">
              <Label>{t('form.firstName')}</Label>
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
              <Label>{t('form.lastName')}</Label>
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
                {t('form.dateOfBirth')}
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
                {t('form.emailAddress')}
              </Label>
              {isEditing ? (
                <Input
                  type="email"
                  value={formData.email || ""}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.email || t('common.notSet')}
                </p>
              )}
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                {t('form.phoneNumber')}
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
                  {profile.phone || t('common.notSet')}
                </p>
              )}
            </div>

            {/* Phone Type */}
            <div className="space-y-2">
              <Label>{t('form.phoneType')}</Label>
              {isEditing ? (
                <Select
                  value={formData.phoneType || "mobile"}
                  onValueChange={(value) => setFormData({ ...formData, phoneType: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('form.mobile')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mobile">{t('form.mobile')}</SelectItem>
                    <SelectItem value="landline">{t('form.landline')}</SelectItem>
                    <SelectItem value="work">{t('form.work')}</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md capitalize">
                  {profile.phoneType || t('form.mobile')}
                </p>
              )}
            </div>

            {/* Address */}
            <div className="space-y-2 md:col-span-2">
              <Label className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {t('form.address')}
              </Label>
              {isEditing ? (
                <Textarea
                  value={formData.address || ""}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder={t('portal.addressPlaceholder')}
                  rows={2}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md min-h-[60px]">
                  {profile.address || t('common.notSet')}
                </p>
              )}
            </div>

            {/* Preferred Contact Method */}
            <div className="space-y-2">
              <Label>{t('form.preferredContactMethod')}</Label>
              {isEditing ? (
                <Select
                  value={formData.preferredContactMethod || "email"}
                  onValueChange={(value) => setFormData({ ...formData, preferredContactMethod: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('form.email')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">{t('form.email')}</SelectItem>
                    <SelectItem value="sms">{t('form.textMessage')}</SelectItem>
                    <SelectItem value="both">{t('form.both')}</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md capitalize">
                  {profile.preferredContactMethod || t('form.email')}
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
            {t('portal.insuranceInfo')}
          </CardTitle>
          <CardDescription>
            {t('portal.insuranceBillingDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Insurance Provider */}
            <div className="space-y-2">
              <Label>{t('portal.insuranceProvider')}</Label>
              {isEditing ? (
                <Input
                  value={formData.insuranceProvider || ""}
                  onChange={(e) => setFormData({ ...formData, insuranceProvider: e.target.value })}
                  placeholder={t('portal.insurancePlaceholder')}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.insuranceProvider || t('common.notSet')}
                </p>
              )}
            </div>

            {/* Member ID */}
            <div className="space-y-2">
              <Label>{t('portal.memberId')}</Label>
              {isEditing ? (
                <Input
                  value={formData.insuranceId || ""}
                  onChange={(e) => setFormData({ ...formData, insuranceId: e.target.value })}
                  placeholder={t('portal.memberIdPlaceholder')}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.insuranceId || t('common.notSet')}
                </p>
              )}
            </div>

            {/* Policy Number */}
            <div className="space-y-2">
              <Label>{t('portal.policyNumber')}</Label>
              {isEditing ? (
                <Input
                  value={formData.policyNumber || ""}
                  onChange={(e) => setFormData({ ...formData, policyNumber: e.target.value })}
                  placeholder={t('portal.policyPlaceholder')}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.policyNumber || t('common.notSet')}
                </p>
              )}
            </div>

            {/* Group Number */}
            <div className="space-y-2">
              <Label>{t('portal.groupNumber')}</Label>
              {isEditing ? (
                <Input
                  value={formData.groupNumber || ""}
                  onChange={(e) => setFormData({ ...formData, groupNumber: e.target.value })}
                  placeholder={t('portal.groupPlaceholder')}
                />
              ) : (
                <p className="text-sm py-2 px-3 bg-slate-50 rounded-md">
                  {profile.groupNumber || t('common.notSet')}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-blue-900">{t('portal.infoSecure')}</p>
                <p className="text-blue-700">
                  {t('portal.infoSecureDesc')}
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
            {t('portal.paymentMethod')}
          </CardTitle>
          <CardDescription>
            {t('portal.paymentRequired')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-900">{t('portal.paymentMethodRequired')}</p>
                <p className="text-yellow-700">
                  {t('portal.contactOffice')}
                </p>
                <p className="text-yellow-600 mt-2 text-xs">
                  {t('portal.onlinePaymentSoon')}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <PatientNotificationPreferences token={token} />

      {/* Profile Completion Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            {t('portal.profileStatus')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <ProfileCheckItem label={t('portal.name')} completed={!!profile.firstName && !!profile.lastName} />
            <ProfileCheckItem label={t('form.email')} completed={!!profile.email} />
            <ProfileCheckItem label={t('form.phone')} completed={!!profile.phone} />
            <ProfileCheckItem label={t('form.dateOfBirth')} completed={!!profile.dateOfBirth} />
            <ProfileCheckItem label={t('form.address')} completed={!!profile.address} />
            <ProfileCheckItem label={t('portal.insuranceProvider')} completed={!!profile.insuranceProvider} />
            <ProfileCheckItem label={t('portal.memberId')} completed={!!profile.insuranceId} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileCheckItem({ label, completed }: { label: string; completed: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-md">
      <span className="text-sm">{label}</span>
      {completed ? (
        <Badge className="bg-green-500">
          <CheckCircle className="h-3 w-3 mr-1" />
          {t('status.complete')}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          {t('status.missing')}
        </Badge>
      )}
    </div>
  );
}

function PatientNotificationPreferences({ token }: { token: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [formData, setFormData] = useState<Partial<NotificationPrefs>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: prefs, isLoading } = useQuery<NotificationPrefs>({
    queryKey: ["/api/patient-portal/notification-preferences", token],
    queryFn: async () => {
      const res = await fetch("/api/patient-portal/notification-preferences", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch preferences");
      return res.json();
    },
  });

  useEffect(() => {
    if (prefs) {
      setFormData(prefs);
      setHasChanges(false);
    }
  }, [prefs]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<NotificationPrefs>) => {
      const res = await fetch("/api/patient-portal/notification-preferences", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update preferences");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/patient-portal/notification-preferences", token],
      });
      setHasChanges(false);
      toast({
        title: t("notifications.saved", "Preferences Saved"),
        description: t("notifications.savedDesc", "Your notification preferences have been updated."),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("notifications.saveFailed", "Save Failed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleToggle = (field: keyof NotificationPrefs, value: boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleTimeChange = (field: "quietHoursStart" | "quietHoursEnd", value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value || null }));
    setHasChanges(true);
  };

  const handleSave = () => {
    const { id, ...updates } = formData;
    updateMutation.mutate(updates);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              {t("notifications.title", "Notification Settings")}
            </CardTitle>
            <CardDescription>
              {t("notifications.subtitle", "Control how and when you receive notifications.")}
            </CardDescription>
          </div>
          {hasChanges && (
            <Button onClick={handleSave} disabled={updateMutation.isPending} size="sm">
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {t("notifications.save", "Save Changes")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Channels */}
        <div className="space-y-3">
          <Label className="text-xs font-semibold uppercase text-muted-foreground">
            {t("notifications.channels", "Notification Channels")}
          </Label>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm">{t("notifications.email", "Email")}</span>
            <Switch
              checked={formData.emailEnabled ?? true}
              onCheckedChange={(checked) => handleToggle("emailEnabled", checked)}
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm">{t("notifications.sms", "SMS / Text")}</span>
            <Switch
              checked={formData.smsEnabled ?? true}
              onCheckedChange={(checked) => handleToggle("smsEnabled", checked)}
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm">{t("notifications.portal", "Portal")}</span>
            <Switch
              checked={formData.portalEnabled ?? true}
              onCheckedChange={(checked) => handleToggle("portalEnabled", checked)}
            />
          </div>
        </div>

        <Separator />

        {/* Types */}
        <div className="space-y-3">
          <Label className="text-xs font-semibold uppercase text-muted-foreground">
            {t("notifications.types", "Notification Types")}
          </Label>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm">
              {t("notifications.appointmentReminders", "Appointment Reminders")}
            </span>
            <Switch
              checked={formData.appointmentReminders ?? true}
              onCheckedChange={(checked) => handleToggle("appointmentReminders", checked)}
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm">
              {t("notifications.billingNotifications", "Billing Notifications")}
            </span>
            <Switch
              checked={formData.billingNotifications ?? true}
              onCheckedChange={(checked) => handleToggle("billingNotifications", checked)}
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm">
              {t("notifications.surveyReminders", "Survey Reminders")}
            </span>
            <Switch
              checked={formData.surveyReminders ?? true}
              onCheckedChange={(checked) => handleToggle("surveyReminders", checked)}
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm">
              {t("notifications.marketingEmails", "Marketing Emails")}
            </span>
            <Switch
              checked={formData.marketingEmails ?? false}
              onCheckedChange={(checked) => handleToggle("marketingEmails", checked)}
            />
          </div>
        </div>

        <Separator />

        {/* Quiet Hours */}
        <div className="space-y-3">
          <Label className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
            <Moon className="h-3 w-3" />
            {t("notifications.quietHours", "Quiet Hours")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("notifications.quietHoursDesc", "Set hours when notifications will be deferred. Leave empty to disable.")}
          </p>
          <div className="grid gap-3 grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("notifications.quietStart", "Start Time")}</Label>
              <Input
                type="time"
                value={formData.quietHoursStart || ""}
                onChange={(e) => handleTimeChange("quietHoursStart", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notifications.quietEnd", "End Time")}</Label>
              <Input
                type="time"
                value={formData.quietHoursEnd || ""}
                onChange={(e) => handleTimeChange("quietHoursEnd", e.target.value)}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

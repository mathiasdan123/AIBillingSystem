import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Bell,
  Mail,
  MessageSquare,
  Monitor,
  Calendar,
  CreditCard,
  FileText,
  ClipboardList,
  Megaphone,
  Moon,
  Save,
  Loader2,
} from "lucide-react";

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

export default function NotificationSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [formData, setFormData] = useState<Partial<NotificationPrefs>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: prefs, isLoading } = useQuery<NotificationPrefs>({
    queryKey: ["/api/notification-preferences"],
  });

  useEffect(() => {
    if (prefs) {
      setFormData(prefs);
      setHasChanges(false);
    }
  }, [prefs]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<NotificationPrefs>) => {
      const res = await fetch("/api/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update preferences");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
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
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6" />
            {t("notifications.title", "Notification Settings")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("notifications.subtitle", "Control how and when you receive notifications.")}
          </p>
        </div>
        {hasChanges && (
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {t("notifications.save", "Save Changes")}
          </Button>
        )}
      </div>

      {/* Notification Channels */}
      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.channels", "Notification Channels")}</CardTitle>
          <CardDescription>
            {t("notifications.channelsDesc", "Choose how you want to receive notifications.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">{t("notifications.email", "Email")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("notifications.emailDesc", "Receive notifications via email")}
                </p>
              </div>
            </div>
            <Switch
              checked={formData.emailEnabled ?? true}
              onCheckedChange={(checked) => handleToggle("emailEnabled", checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">{t("notifications.sms", "SMS / Text")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("notifications.smsDesc", "Receive notifications via text message")}
                </p>
              </div>
            </div>
            <Switch
              checked={formData.smsEnabled ?? true}
              onCheckedChange={(checked) => handleToggle("smsEnabled", checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Monitor className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">{t("notifications.portal", "Portal")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("notifications.portalDesc", "Receive in-app portal notifications")}
                </p>
              </div>
            </div>
            <Switch
              checked={formData.portalEnabled ?? true}
              onCheckedChange={(checked) => handleToggle("portalEnabled", checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Notification Types */}
      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.types", "Notification Types")}</CardTitle>
          <CardDescription>
            {t("notifications.typesDesc", "Select which types of notifications you want to receive.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">
                  {t("notifications.appointmentReminders", "Appointment Reminders")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("notifications.appointmentRemindersDesc", "Reminders about upcoming appointments")}
                </p>
              </div>
            </div>
            <Switch
              checked={formData.appointmentReminders ?? true}
              onCheckedChange={(checked) => handleToggle("appointmentReminders", checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">
                  {t("notifications.billingNotifications", "Billing Notifications")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("notifications.billingNotificationsDesc", "Updates about billing and payments")}
                </p>
              </div>
            </div>
            <Switch
              checked={formData.billingNotifications ?? true}
              onCheckedChange={(checked) => handleToggle("billingNotifications", checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">
                  {t("notifications.claimUpdates", "Claim Updates")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("notifications.claimUpdatesDesc", "Status changes on insurance claims")}
                </p>
              </div>
            </div>
            <Switch
              checked={formData.claimUpdates ?? true}
              onCheckedChange={(checked) => handleToggle("claimUpdates", checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ClipboardList className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">
                  {t("notifications.surveyReminders", "Survey Reminders")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("notifications.surveyRemindersDesc", "Reminders to complete assessments and surveys")}
                </p>
              </div>
            </div>
            <Switch
              checked={formData.surveyReminders ?? true}
              onCheckedChange={(checked) => handleToggle("surveyReminders", checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Megaphone className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">
                  {t("notifications.marketingEmails", "Marketing Emails")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("notifications.marketingEmailsDesc", "Product updates, tips, and announcements")}
                </p>
              </div>
            </div>
            <Switch
              checked={formData.marketingEmails ?? false}
              onCheckedChange={(checked) => handleToggle("marketingEmails", checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Moon className="h-5 w-5" />
            {t("notifications.quietHours", "Quiet Hours")}
          </CardTitle>
          <CardDescription>
            {t("notifications.quietHoursDesc", "Set hours when notifications will be deferred. Leave empty to disable.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("notifications.quietStart", "Start Time")}</Label>
              <Input
                type="time"
                value={formData.quietHoursStart || ""}
                onChange={(e) => handleTimeChange("quietHoursStart", e.target.value)}
                placeholder="22:00"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("notifications.quietEnd", "End Time")}</Label>
              <Input
                type="time"
                value={formData.quietHoursEnd || ""}
                onChange={(e) => handleTimeChange("quietHoursEnd", e.target.value)}
                placeholder="08:00"
              />
            </div>
          </div>
          {formData.quietHoursStart && formData.quietHoursEnd && (
            <p className="text-sm text-muted-foreground mt-3">
              {t("notifications.quietHoursActive", "Notifications will be deferred between {{start}} and {{end}}.", {
                start: formData.quietHoursStart,
                end: formData.quietHoursEnd,
              })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Save button at bottom for mobile */}
      {hasChanges && (
        <div className="flex justify-end pb-6">
          <Button onClick={handleSave} disabled={updateMutation.isPending} size="lg">
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {t("notifications.save", "Save Changes")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Practice-level notification template editor (P0.5 UI).
 *
 * Admin/billing-only. Lists the three template types × two channels (email,
 * sms), lets the practice customize subject (email only) + body with
 * {{variable}} placeholders, toggle active, or revert to the hardcoded
 * default by deleting the row.
 *
 * Backed by /api/notification-templates.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Mail, MessageSquare, Save, Loader2, RotateCcw, FileText } from "lucide-react";

interface NotificationTemplate {
  id: number;
  practiceId: number;
  notificationType: string;
  channel: string;
  subject: string | null;
  body: string;
  isActive: boolean;
  updatedAt: string;
}

type TemplateType = "appointment_reminder" | "appointment_confirmation" | "appointment_cancellation";
type Channel = "email" | "sms";

const TYPE_LABELS: Record<TemplateType, string> = {
  appointment_reminder: "Appointment Reminder",
  appointment_confirmation: "Appointment Confirmation",
  appointment_cancellation: "Appointment Cancellation",
};

const TYPE_DESCRIPTIONS: Record<TemplateType, string> = {
  appointment_reminder: "Sent ahead of an upcoming appointment.",
  appointment_confirmation: "Sent when a new appointment is booked.",
  appointment_cancellation: "Sent when an appointment is cancelled.",
};

// Variables available per notification type. Kept in sync with the
// renderer's documented variables in
// server/services/notificationTemplateRenderer.ts.
const AVAILABLE_VARIABLES: Record<TemplateType, string[]> = {
  appointment_reminder: ["patientName", "appointmentDate", "appointmentTime", "practiceName", "practicePhone", "providerName"],
  appointment_confirmation: ["patientName", "appointmentDate", "appointmentTime", "practiceName", "providerName"],
  appointment_cancellation: ["patientName", "appointmentDate", "appointmentTime", "practiceName"],
};

const TEMPLATE_TYPES: TemplateType[] = [
  "appointment_reminder",
  "appointment_confirmation",
  "appointment_cancellation",
];

const CHANNELS: Channel[] = ["email", "sms"];

interface EditorState {
  subject: string;
  body: string;
  isActive: boolean;
}

const emptyEditor: EditorState = { subject: "", body: "", isActive: true };

export default function NotificationTemplates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeType, setActiveType] = useState<TemplateType>("appointment_reminder");
  const [editorByKey, setEditorByKey] = useState<Record<string, EditorState>>({});

  const { data: templates = [], isLoading } = useQuery<NotificationTemplate[]>({
    queryKey: ["/api/notification-templates"],
    queryFn: async () => {
      const res = await fetch("/api/notification-templates", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load templates");
      const json = await res.json();
      return Array.isArray(json) ? json : (json.templates ?? []);
    },
  });

  const findTemplate = (type: TemplateType, channel: Channel): NotificationTemplate | undefined =>
    templates.find((t) => t.notificationType === type && t.channel === channel);

  const editorKey = (type: TemplateType, channel: Channel) => `${type}::${channel}`;

  const editorFor = (type: TemplateType, channel: Channel): EditorState => {
    const key = editorKey(type, channel);
    if (editorByKey[key]) return editorByKey[key];
    const t = findTemplate(type, channel);
    return t
      ? { subject: t.subject ?? "", body: t.body, isActive: t.isActive }
      : { ...emptyEditor };
  };

  const setEditor = (type: TemplateType, channel: Channel, patch: Partial<EditorState>) => {
    const key = editorKey(type, channel);
    setEditorByKey((prev) => ({
      ...prev,
      [key]: { ...editorFor(type, channel), ...patch },
    }));
  };

  const clearEditor = (type: TemplateType, channel: Channel) => {
    const key = editorKey(type, channel);
    setEditorByKey((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };

  const hasChanges = (type: TemplateType, channel: Channel): boolean => {
    const key = editorKey(type, channel);
    return editorByKey[key] !== undefined;
  };

  const saveMutation = useMutation({
    mutationFn: async (vars: { type: TemplateType; channel: Channel; state: EditorState }) => {
      const res = await fetch("/api/notification-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          notificationType: vars.type,
          channel: vars.channel,
          subject: vars.channel === "email" ? vars.state.subject || null : null,
          body: vars.state.body,
          isActive: vars.state.isActive,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || "Failed to save template");
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-templates"] });
      clearEditor(vars.type, vars.channel);
      toast({ title: "Template saved", description: `${TYPE_LABELS[vars.type]} (${vars.channel}) updated.` });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/notification-templates/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || "Failed to revert to default");
      }
      return res.json();
    },
    onSuccess: (_d, _id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-templates"] });
      toast({ title: "Reverted to default", description: "Custom template removed; the built-in default will be used." });
    },
    onError: (e: Error) => {
      toast({ title: "Revert failed", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderEditor = (type: TemplateType, channel: Channel) => {
    const existing = findTemplate(type, channel);
    const state = editorFor(type, channel);
    const dirty = hasChanges(type, channel);
    const channelIcon = channel === "email" ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />;

    return (
      <Card key={`${type}-${channel}`} className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {channelIcon}
              <CardTitle className="text-base capitalize">{channel}</CardTitle>
              {existing ? (
                <Badge variant={existing.isActive ? "default" : "secondary"}>
                  {existing.isActive ? "Custom (active)" : "Custom (inactive — using default)"}
                </Badge>
              ) : (
                <Badge variant="outline">Using default</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor={`active-${type}-${channel}`} className="text-sm">Active</Label>
              <Switch
                id={`active-${type}-${channel}`}
                checked={state.isActive}
                onCheckedChange={(checked) => setEditor(type, channel, { isActive: checked })}
              />
            </div>
          </div>
          <CardDescription className="text-xs">
            Variables you can use:{" "}
            {AVAILABLE_VARIABLES[type].map((v, i) => (
              <code key={v} className="text-xs bg-muted px-1 py-0.5 rounded mr-1">{`{{${v}}}`}</code>
            ))}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {channel === "email" && (
            <div className="space-y-1">
              <Label htmlFor={`subject-${type}-${channel}`}>Subject</Label>
              <Input
                id={`subject-${type}-${channel}`}
                value={state.subject}
                onChange={(e) => setEditor(type, channel, { subject: e.target.value })}
                placeholder="Reminder: appointment with {{practiceName}}"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={`body-${type}-${channel}`}>Body</Label>
            <Textarea
              id={`body-${type}-${channel}`}
              value={state.body}
              onChange={(e) => setEditor(type, channel, { body: e.target.value })}
              rows={channel === "sms" ? 4 : 8}
              placeholder={
                channel === "sms"
                  ? "Hi {{patientName}}, this is a reminder of your appointment on {{appointmentDate}} at {{appointmentTime}}."
                  : "Hi {{patientName}},\n\nThis is a reminder that you have an appointment with {{practiceName}} on {{appointmentDate}} at {{appointmentTime}}.\n\nSee you then."
              }
            />
            {channel === "sms" && (
              <p className="text-xs text-muted-foreground">
                Tip: SMS is typically capped at 160 characters per segment. Long messages may be split.
              </p>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            {existing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm("Remove the custom template and fall back to the built-in default?")) {
                    deleteMutation.mutate(existing.id);
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                <RotateCcw className="h-4 w-4 mr-1" /> Revert to default
              </Button>
            )}
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearEditor(type, channel)}
                disabled={saveMutation.isPending}
              >
                Discard
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => saveMutation.mutate({ type, channel, state })}
              disabled={!dirty || saveMutation.isPending || !state.body.trim()}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" />
          Notification Templates
        </h1>
        <p className="text-muted-foreground mt-1">
          Customize the email and SMS messages your practice sends to patients. Use{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">{`{{variable}}`}</code> placeholders — they'll be
          substituted at send time. Leave a template alone to use the built-in default.
        </p>
      </div>

      <Tabs value={activeType} onValueChange={(v) => setActiveType(v as TemplateType)}>
        <TabsList className="grid grid-cols-3 w-full">
          {TEMPLATE_TYPES.map((type) => (
            <TabsTrigger key={type} value={type} className="text-xs sm:text-sm">
              {TYPE_LABELS[type]}
            </TabsTrigger>
          ))}
        </TabsList>
        {TEMPLATE_TYPES.map((type) => (
          <TabsContent key={type} value={type} className="mt-4">
            <p className="text-sm text-muted-foreground mb-3">{TYPE_DESCRIPTIONS[type]}</p>
            {CHANNELS.map((channel) => renderEditor(type, channel))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

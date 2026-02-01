import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
  Video,
  Phone,
  Clock,
  Users,
  Settings,
  Play,
  Copy,
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
  Calendar,
  User,
} from "lucide-react";

interface TelehealthSession {
  id: number;
  practiceId: number;
  appointmentId: number;
  patientId?: number;
  therapistId?: string;
  roomName: string;
  roomUrl?: string;
  hostUrl?: string;
  patientAccessCode?: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart?: string;
  actualEnd?: string;
  patientJoinedAt?: string;
  therapistJoinedAt?: string;
  duration?: number;
  waitingRoomEnabled: boolean;
  patientName?: string;
}

interface TelehealthSettings {
  id?: number;
  practiceId: number;
  isEnabled: boolean;
  provider: string;
  defaultWaitingRoomEnabled: boolean;
  defaultRecordingEnabled: boolean;
  requireRecordingConsent: boolean;
  autoCreateRooms: boolean;
  sendJoinReminder: boolean;
  joinReminderMinutes: number;
  maxSessionDuration: number;
  welcomeMessage?: string;
  waitingRoomMessage?: string;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  waiting: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-800",
  cancelled: "bg-red-100 text-red-800",
  no_show: "bg-orange-100 text-orange-800",
};

export default function TelehealthPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSession, setSelectedSession] = useState<TelehealthSession | null>(null);

  // Fetch settings
  const { data: settings } = useQuery<TelehealthSettings>({
    queryKey: ["/api/telehealth/settings"],
    queryFn: async () => {
      const res = await fetch("/api/telehealth/settings?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  // Fetch today's sessions
  const { data: todaysSessions = [], isLoading } = useQuery<TelehealthSession[]>({
    queryKey: ["/api/telehealth/sessions/today"],
    queryFn: async () => {
      const res = await fetch("/api/telehealth/sessions/today?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch sessions");
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch all sessions
  const { data: allSessions = [] } = useQuery<TelehealthSession[]>({
    queryKey: ["/api/telehealth/sessions"],
    queryFn: async () => {
      const res = await fetch("/api/telehealth/sessions?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch sessions");
      return res.json();
    },
  });

  // Save settings mutation
  const saveSettings = useMutation({
    mutationFn: async (data: Partial<TelehealthSettings>) => {
      const res = await fetch("/api/telehealth/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, practiceId: 1 }),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/telehealth/settings"] });
      toast({ title: "Settings saved" });
    },
  });

  // Join session mutation
  const joinSession = useMutation({
    mutationFn: async (sessionId: number) => {
      const res = await fetch(`/api/telehealth/sessions/${sessionId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isTherapist: true }),
      });
      if (!res.ok) throw new Error("Failed to join session");
      return res.json();
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["/api/telehealth/sessions"] });
      // Open video room in new tab
      window.open(session.hostUrl, "_blank");
    },
  });

  // End session mutation
  const endSession = useMutation({
    mutationFn: async (sessionId: number) => {
      const res = await fetch(`/api/telehealth/sessions/${sessionId}/end`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to end session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/telehealth/sessions"] });
      toast({ title: "Session ended" });
    },
  });

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getSessionDuration = (session: TelehealthSession) => {
    const start = new Date(session.scheduledStart);
    const end = new Date(session.scheduledEnd);
    return Math.round((end.getTime() - start.getTime()) / 60000);
  };

  const waitingSessions = todaysSessions.filter((s) => s.status === "waiting");
  const inProgressSessions = todaysSessions.filter((s) => s.status === "in_progress");
  const upcomingSessions = todaysSessions.filter((s) => s.status === "scheduled");

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Telehealth</h1>
          <p className="text-muted-foreground">
            Manage your video sessions with patients
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className={waitingSessions.length > 0 ? "border-yellow-400" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className={`h-5 w-5 ${waitingSessions.length > 0 ? "text-yellow-500" : "text-muted-foreground"}`} />
              <div>
                <p className="text-2xl font-bold">{waitingSessions.length}</p>
                <p className="text-xs text-muted-foreground">In Waiting Room</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={inProgressSessions.length > 0 ? "border-green-400" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Video className={`h-5 w-5 ${inProgressSessions.length > 0 ? "text-green-500" : "text-muted-foreground"}`} />
              <div>
                <p className="text-2xl font-bold">{inProgressSessions.length}</p>
                <p className="text-xs text-muted-foreground">In Progress</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{upcomingSessions.length}</p>
                <p className="text-xs text-muted-foreground">Upcoming Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-2xl font-bold">{todaysSessions.length}</p>
                <p className="text-xs text-muted-foreground">Total Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="today" className="space-y-4">
        <TabsList>
          <TabsTrigger value="today">
            Today's Sessions
            {waitingSessions.length > 0 && (
              <Badge className="ml-2 bg-yellow-500">{waitingSessions.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All Sessions</TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        {/* Today's Sessions */}
        <TabsContent value="today">
          {/* Waiting Room Alert */}
          {waitingSessions.length > 0 && (
            <Card className="border-yellow-400 bg-yellow-50 mb-4">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Users className="h-6 w-6 text-yellow-600" />
                  <div className="flex-1">
                    <p className="font-medium text-yellow-800">
                      {waitingSessions.length} patient{waitingSessions.length > 1 ? "s" : ""} waiting
                    </p>
                    <p className="text-sm text-yellow-700">
                      {waitingSessions.map((s) => s.patientName).join(", ")}
                    </p>
                  </div>
                  {waitingSessions.length === 1 && (
                    <Button
                      onClick={() => joinSession.mutate(waitingSessions[0].id)}
                      disabled={joinSession.isPending}
                    >
                      <Video className="mr-2 h-4 w-4" />
                      Join Now
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Today's Sessions</CardTitle>
              <CardDescription>
                {new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : todaysSessions.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No telehealth sessions scheduled for today
                </p>
              ) : (
                <div className="space-y-3">
                  {todaysSessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{session.patientName || "Patient"}</p>
                          <p className="text-sm text-muted-foreground">
                            {formatTime(session.scheduledStart)} - {formatTime(session.scheduledEnd)}
                            <span className="mx-2">•</span>
                            {getSessionDuration(session)} min
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className={STATUS_COLORS[session.status]}>
                          {session.status === "in_progress"
                            ? "In Progress"
                            : session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                        </Badge>
                        {session.status === "waiting" && (
                          <Button
                            size="sm"
                            onClick={() => joinSession.mutate(session.id)}
                            disabled={joinSession.isPending}
                          >
                            <Video className="mr-1 h-4 w-4" />
                            Join
                          </Button>
                        )}
                        {session.status === "in_progress" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(session.hostUrl, "_blank")}
                            >
                              <ExternalLink className="mr-1 h-4 w-4" />
                              Open
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                if (confirm("End this session?")) {
                                  endSession.mutate(session.id);
                                }
                              }}
                            >
                              End
                            </Button>
                          </>
                        )}
                        {session.status === "scheduled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedSession(session)}
                          >
                            Details
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* All Sessions */}
        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>All Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {allSessions.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No telehealth sessions found
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allSessions.slice(0, 50).map((session) => (
                      <TableRow key={session.id}>
                        <TableCell>
                          {new Date(session.scheduledStart).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{formatTime(session.scheduledStart)}</TableCell>
                        <TableCell>{session.patientName || `Patient #${session.patientId}`}</TableCell>
                        <TableCell>
                          {session.duration
                            ? `${session.duration} min`
                            : `${getSessionDuration(session)} min (scheduled)`}
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[session.status]}>
                            {session.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Telehealth Settings</CardTitle>
              <CardDescription>Configure your video session settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Telehealth</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow video sessions for appointments
                  </p>
                </div>
                <Switch
                  checked={settings?.isEnabled ?? true}
                  onCheckedChange={(checked) => saveSettings.mutate({ isEnabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Default Waiting Room</Label>
                  <p className="text-sm text-muted-foreground">
                    Patients wait until therapist admits them
                  </p>
                </div>
                <Switch
                  checked={settings?.defaultWaitingRoomEnabled ?? true}
                  onCheckedChange={(checked) =>
                    saveSettings.mutate({ defaultWaitingRoomEnabled: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Auto-Create Rooms</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically create video room when appointment is scheduled
                  </p>
                </div>
                <Switch
                  checked={settings?.autoCreateRooms ?? true}
                  onCheckedChange={(checked) => saveSettings.mutate({ autoCreateRooms: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Send Join Reminder</Label>
                  <p className="text-sm text-muted-foreground">
                    Send reminder before session starts
                  </p>
                </div>
                <Switch
                  checked={settings?.sendJoinReminder ?? true}
                  onCheckedChange={(checked) => saveSettings.mutate({ sendJoinReminder: checked })}
                />
              </div>

              <div className="space-y-2">
                <Label>Waiting Room Message</Label>
                <Textarea
                  value={settings?.waitingRoomMessage || ""}
                  onChange={(e) => saveSettings.mutate({ waitingRoomMessage: e.target.value })}
                  placeholder="Your therapist will be with you shortly..."
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Session Details Dialog */}
      <Dialog open={!!selectedSession} onOpenChange={() => setSelectedSession(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Session Details</DialogTitle>
            <DialogDescription>
              {selectedSession?.patientName || "Patient"} -{" "}
              {selectedSession && formatTime(selectedSession.scheduledStart)}
            </DialogDescription>
          </DialogHeader>
          {selectedSession && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <p>
                    <Badge className={STATUS_COLORS[selectedSession.status]}>
                      {selectedSession.status}
                    </Badge>
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Duration</Label>
                  <p>{getSessionDuration(selectedSession)} minutes</p>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Patient Access Code</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="bg-muted px-3 py-2 rounded text-lg font-mono">
                    {selectedSession.patientAccessCode}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedSession.patientAccessCode || "");
                      toast({ title: "Code copied" });
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Share this code with your patient to join the session
                </p>
              </div>

              <div>
                <Label className="text-muted-foreground">Patient Join Link</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={`${window.location.origin}/join/${selectedSession.patientAccessCode}`}
                    readOnly
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `${window.location.origin}/join/${selectedSession.patientAccessCode}`
                      );
                      toast({ title: "Link copied" });
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  className="flex-1"
                  onClick={() => {
                    joinSession.mutate(selectedSession.id);
                    setSelectedSession(null);
                  }}
                >
                  <Video className="mr-2 h-4 w-4" />
                  Start Session
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

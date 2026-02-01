import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Video,
  Loader2,
  CheckCircle,
  Clock,
  AlertCircle,
  User,
  Mic,
  MicOff,
  VideoIcon,
  VideoOff,
} from "lucide-react";

interface SessionInfo {
  sessionId: number;
  roomName: string;
  roomUrl: string;
  patientName: string;
  practiceName: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  waitingRoomEnabled: boolean;
}

interface SessionStatus {
  status: string;
  therapistJoined: boolean;
}

export default function TelehealthJoinPage() {
  const params = useParams<{ code: string }>();
  const [accessCode, setAccessCode] = useState(params.code || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [isInWaitingRoom, setIsInWaitingRoom] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  // If code is in URL, auto-lookup
  useEffect(() => {
    if (params.code) {
      lookupSession(params.code);
    }
  }, [params.code]);

  // Poll for status updates when in waiting room
  useEffect(() => {
    if (!isInWaitingRoom || !accessCode) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/public/telehealth/status/${accessCode}`);
        if (res.ok) {
          const status = await res.json();
          setSessionStatus(status);

          // If therapist joined and session is in progress, redirect to room
          if (status.status === "in_progress" && status.therapistJoined) {
            // In a real implementation, this would open the video room
            // For now, we'll just update the UI
          }
        }
      } catch (err) {
        console.error("Failed to check status:", err);
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [isInWaitingRoom, accessCode]);

  const lookupSession = async (code: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/public/telehealth/join/${code.toUpperCase()}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Failed to find session");
        return;
      }

      setSessionInfo(data);
      setAccessCode(code.toUpperCase());
    } catch (err) {
      setError("Failed to connect. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const joinWaitingRoom = async () => {
    if (!accessCode) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/public/telehealth/waiting/${accessCode}`, {
        method: "POST",
      });

      if (res.ok) {
        setIsInWaitingRoom(true);
      }
    } catch (err) {
      setError("Failed to join waiting room");
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  // Waiting Room View
  if (isInWaitingRoom && sessionInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
              <Clock className="h-8 w-8 text-yellow-600" />
            </div>
            <CardTitle>Waiting Room</CardTitle>
            <CardDescription>{sessionInfo.practiceName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center">
              <p className="text-lg">
                Hi <span className="font-medium">{sessionInfo.patientName}</span>,
              </p>
              <p className="text-muted-foreground mt-2">
                Your therapist will be with you shortly. Please wait here.
              </p>
            </div>

            {/* Session Info */}
            <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Scheduled:</span>
                <span>{formatTime(sessionInfo.scheduledStart)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className="flex items-center gap-1">
                  {sessionStatus?.therapistJoined ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Therapist is ready
                    </>
                  ) : (
                    <>
                      <Clock className="h-4 w-4 text-yellow-500" />
                      Waiting for therapist
                    </>
                  )}
                </span>
              </div>
            </div>

            {/* Media Controls Preview */}
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                Check your audio and video before joining
              </p>
              <div className="flex justify-center gap-4">
                <Button
                  variant={micEnabled ? "default" : "outline"}
                  size="lg"
                  onClick={() => setMicEnabled(!micEnabled)}
                >
                  {micEnabled ? (
                    <Mic className="h-5 w-5" />
                  ) : (
                    <MicOff className="h-5 w-5" />
                  )}
                </Button>
                <Button
                  variant={videoEnabled ? "default" : "outline"}
                  size="lg"
                  onClick={() => setVideoEnabled(!videoEnabled)}
                >
                  {videoEnabled ? (
                    <VideoIcon className="h-5 w-5" />
                  ) : (
                    <VideoOff className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </div>

            {sessionStatus?.status === "in_progress" && sessionStatus?.therapistJoined && (
              <Button className="w-full" size="lg">
                <Video className="mr-2 h-5 w-5" />
                Join Session Now
              </Button>
            )}

            <p className="text-xs text-center text-muted-foreground">
              Please keep this page open. You'll be notified when your session begins.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Session Info View (pre-join)
  if (sessionInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Video className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Ready to Join?</CardTitle>
            <CardDescription>{sessionInfo.practiceName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted p-4 rounded-lg space-y-3">
              <div className="flex items-center gap-3">
                <User className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Patient</p>
                  <p className="font-medium">{sessionInfo.patientName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Scheduled</p>
                  <p className="font-medium">
                    {formatDate(sessionInfo.scheduledStart)} at{" "}
                    {formatTime(sessionInfo.scheduledStart)}
                  </p>
                </div>
              </div>
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={joinWaitingRoom}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Video className="mr-2 h-5 w-5" />
              )}
              {sessionInfo.waitingRoomEnabled ? "Enter Waiting Room" : "Join Session"}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              By joining, you agree to participate in this telehealth session.
              Your session may be recorded with your consent.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Code Entry View
  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Video className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Join Your Session</CardTitle>
          <CardDescription>
            Enter your access code to join your telehealth appointment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Access Code</Label>
            <Input
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
              placeholder="Enter your 6-character code"
              className="text-center text-2xl font-mono tracking-widest"
              maxLength={6}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <Button
            className="w-full"
            size="lg"
            onClick={() => lookupSession(accessCode)}
            disabled={loading || accessCode.length < 6}
          >
            {loading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Video className="mr-2 h-5 w-5" />
            )}
            Find My Session
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Your access code was provided by your therapist or sent to you via email/text.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

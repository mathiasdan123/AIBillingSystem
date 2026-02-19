import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Calendar,
  Clock,
  User,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Phone,
  Mail,
} from "lucide-react";

interface AppointmentRequest {
  id: number;
  practiceId: number;
  patientId: number;
  appointmentTypeId?: number;
  therapistId?: string;
  requestedDate: string;
  requestedTime: string;
  notes?: string;
  status: string;
  rejectionReason?: string;
  createdAt: string;
  patientName: string;
  patientEmail?: string;
  patientPhone?: string;
  appointmentTypeName: string;
  appointmentTypeDuration: number;
  therapistName?: string;
}

interface Therapist {
  id: string;
  firstName: string;
  lastName: string;
}

interface AppointmentRequestQueueProps {
  practiceId?: number;
}

export default function AppointmentRequestQueue({ practiceId = 1 }: AppointmentRequestQueueProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedRequest, setSelectedRequest] = useState<AppointmentRequest | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  // Approval form state
  const [assignedTherapist, setAssignedTherapist] = useState("");
  const [adjustedDate, setAdjustedDate] = useState("");
  const [adjustedTime, setAdjustedTime] = useState("");
  const [approvalNotes, setApprovalNotes] = useState("");

  // Fetch pending requests
  const { data: requests = [], isLoading } = useQuery<AppointmentRequest[]>({
    queryKey: ["/api/appointment-requests", practiceId, "pending"],
    queryFn: async () => {
      const res = await fetch(`/api/appointment-requests?practiceId=${practiceId}&status=pending_approval`);
      if (!res.ok) throw new Error("Failed to fetch requests");
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch therapists
  const { data: therapists = [] } = useQuery<Therapist[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (data: {
      requestId: number;
      therapistId?: string;
      startTime?: string;
      endTime?: string;
      notes?: string;
    }) => {
      const res = await apiRequest("POST", `/api/appointment-requests/${data.requestId}/approve`, {
        therapistId: data.therapistId,
        startTime: data.startTime,
        endTime: data.endTime,
        notes: data.notes,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointment-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      setApproveDialogOpen(false);
      resetForm();
      toast({
        title: "Request Approved",
        description: "The appointment has been scheduled and the patient will be notified.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Approval Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async (data: { requestId: number; rejectionReason?: string }) => {
      const res = await apiRequest("POST", `/api/appointment-requests/${data.requestId}/reject`, {
        rejectionReason: data.rejectionReason,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointment-requests"] });
      setRejectDialogOpen(false);
      resetForm();
      toast({
        title: "Request Rejected",
        description: "The patient will be notified of the rejection.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Rejection Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setSelectedRequest(null);
    setAssignedTherapist("");
    setAdjustedDate("");
    setAdjustedTime("");
    setApprovalNotes("");
    setRejectionReason("");
  };

  const openApproveDialog = (request: AppointmentRequest) => {
    setSelectedRequest(request);
    setAssignedTherapist(request.therapistId || "");
    setAdjustedDate(request.requestedDate);
    setAdjustedTime(request.requestedTime);
    setApprovalNotes(request.notes || "");
    setApproveDialogOpen(true);
  };

  const openRejectDialog = (request: AppointmentRequest) => {
    setSelectedRequest(request);
    setRejectionReason("");
    setRejectDialogOpen(true);
  };

  const handleApprove = () => {
    if (!selectedRequest) return;

    // Calculate start and end times
    const startTime = `${adjustedDate}T${adjustedTime}:00`;
    const duration = selectedRequest.appointmentTypeDuration || 60;
    const endDate = new Date(startTime);
    endDate.setMinutes(endDate.getMinutes() + duration);
    const endTime = endDate.toISOString();

    approveMutation.mutate({
      requestId: selectedRequest.id,
      therapistId: assignedTherapist || undefined,
      startTime,
      endTime,
      notes: approvalNotes || undefined,
    });
  };

  const handleReject = () => {
    if (!selectedRequest) return;

    rejectMutation.mutate({
      requestId: selectedRequest.id,
      rejectionReason: rejectionReason || undefined,
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatCreatedAt = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) {
      return "Just now";
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Pending Appointment Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-yellow-600" />
            Pending Appointment Requests
            {requests.length > 0 && (
              <Badge variant="secondary">{requests.length}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Review and approve appointment requests from patients
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="text-muted-foreground">No pending requests</p>
              <p className="text-sm text-muted-foreground">
                New requests from patients will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="p-4 border rounded-lg bg-yellow-50 border-yellow-200"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{request.patientName}</span>
                        <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                          Pending
                        </Badge>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(request.requestedDate)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {request.requestedTime}
                        </span>
                      </div>

                      <div className="text-sm">
                        <span className="text-muted-foreground">Type: </span>
                        <span>{request.appointmentTypeName}</span>
                        <span className="text-muted-foreground ml-2">
                          ({request.appointmentTypeDuration} min)
                        </span>
                      </div>

                      {request.therapistName && (
                        <div className="text-sm">
                          <span className="text-muted-foreground">Preferred: </span>
                          <span>{request.therapistName}</span>
                        </div>
                      )}

                      {request.notes && (
                        <div className="text-sm">
                          <span className="text-muted-foreground">Notes: </span>
                          <span>{request.notes}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {request.patientEmail && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {request.patientEmail}
                          </span>
                        )}
                        {request.patientPhone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {request.patientPhone}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Requested {formatCreatedAt(request.createdAt)}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        onClick={() => openApproveDialog(request)}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openRejectDialog(request)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approve Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Appointment Request</DialogTitle>
            <DialogDescription>
              Confirm the appointment details. You can adjust the date, time, or assigned therapist.
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4 py-4">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="font-medium">{selectedRequest.patientName}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedRequest.appointmentTypeName} ({selectedRequest.appointmentTypeDuration} min)
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={adjustedDate}
                    onChange={(e) => setAdjustedDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Time</Label>
                  <Input
                    type="time"
                    value={adjustedTime}
                    onChange={(e) => setAdjustedTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Assign Therapist</Label>
                <Select value={assignedTherapist} onValueChange={setAssignedTherapist}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select therapist" />
                  </SelectTrigger>
                  <SelectContent>
                    {therapists.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.firstName} {t.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Notes (Optional)</Label>
                <Textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Any additional notes..."
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {approveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Approve & Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Appointment Request</DialogTitle>
            <DialogDescription>
              Provide a reason for rejection (optional). The patient will be notified.
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4 py-4">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="font-medium">{selectedRequest.patientName}</p>
                <p className="text-sm text-muted-foreground">
                  Requested: {formatDate(selectedRequest.requestedDate)} at {selectedRequest.requestedTime}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Reason for Rejection (Optional)</Label>
                <Textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g., No availability at requested time, please choose another slot..."
                  rows={3}
                />
              </div>

              <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                <div className="flex items-center gap-2 text-sm text-yellow-800">
                  <AlertCircle className="h-4 w-4" />
                  <span>The patient will receive an email notification about this rejection.</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

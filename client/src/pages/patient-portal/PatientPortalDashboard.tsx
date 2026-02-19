import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar,
  Clock,
  User,
  FileText,
  Bell,
  Plus,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  ClockIcon,
} from "lucide-react";

interface DashboardData {
  patient: {
    id: number;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    dateOfBirth?: string;
    insuranceProvider?: string;
  } | null;
  upcomingAppointments: Array<{
    id: number;
    startTime: string;
    endTime: string;
    title?: string;
    status: string;
    therapistName?: string;
  }>;
  pendingRequests: Array<{
    id: number;
    requestedDate: string;
    requestedTime: string;
    status: string;
    appointmentTypeName?: string;
  }>;
  recentAppointments: Array<{
    id: number;
    startTime: string;
    status: string;
    title?: string;
  }>;
  profileCompletion: {
    percentage: number;
    missingFields: string[];
  };
}

interface PatientPortalDashboardProps {
  token: string;
  onNavigate: (tab: string) => void;
}

export default function PatientPortalDashboard({ token, onNavigate }: PatientPortalDashboardProps) {
  const { data: dashboard, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/patient-portal/dashboard", token],
    queryFn: async () => {
      const res = await fetch(`/api/patient-portal/dashboard`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error("Failed to fetch dashboard");
      }
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
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
        return <Badge className="bg-green-500">Confirmed</Badge>;
      case "pending_approval":
        return <Badge variant="outline" className="text-yellow-600 border-yellow-600">Pending Approval</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Cancelled</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-8">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <p className="text-lg font-medium">Failed to load dashboard</p>
          <p className="text-muted-foreground">Please try refreshing the page</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">
            Welcome back, {dashboard.patient?.firstName}!
          </h2>
          <p className="text-muted-foreground">
            Here's an overview of your account
          </p>
        </div>
        <Button onClick={() => onNavigate("appointments")}>
          <Plus className="h-4 w-4 mr-2" />
          Request Appointment
        </Button>
      </div>

      {/* Profile Completion Alert */}
      {dashboard.profileCompletion.percentage < 100 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                <Bell className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="font-medium">Complete your profile</p>
                <p className="text-sm text-muted-foreground">
                  Your profile is {dashboard.profileCompletion.percentage}% complete.
                  Missing: {dashboard.profileCompletion.missingFields.join(", ")}
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={() => onNavigate("profile")}>
              Complete Profile
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Quick Profile Card - First */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              Your Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">
                  {dashboard.patient?.firstName} {dashboard.patient?.lastName}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium truncate max-w-[150px]">
                  {dashboard.patient?.email || "Not set"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Phone</span>
                <span className="font-medium">
                  {dashboard.patient?.phone || "Not set"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Insurance</span>
                <span className="font-medium truncate max-w-[150px]">
                  {dashboard.patient?.insuranceProvider || "Not set"}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full mt-4"
              onClick={() => onNavigate("profile")}
            >
              <FileText className="h-4 w-4 mr-2" />
              Update Profile
            </Button>
          </CardContent>
        </Card>

        {/* Upcoming Appointments Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Upcoming Appointments
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.upcomingAppointments.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm mb-3">No upcoming appointments</p>
                <Button variant="outline" size="sm" onClick={() => onNavigate("appointments")}>
                  Schedule Now
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {dashboard.upcomingAppointments.slice(0, 3).map((apt) => (
                  <div key={apt.id} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                      <Clock className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {apt.title || "Appointment"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(apt.startTime)} at {formatTime(apt.startTime)}
                      </p>
                    </div>
                    {getStatusBadge(apt.status)}
                  </div>
                ))}
              </div>
            )}
            <Button
              variant="link"
              className="w-full mt-3"
              onClick={() => onNavigate("appointments")}
            >
              View All Appointments
            </Button>
          </CardContent>
        </Card>

        {/* Pending Requests Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClockIcon className="h-5 w-5 text-yellow-600" />
              Pending Requests
              {dashboard.pendingRequests.length > 0 && (
                <Badge variant="secondary">{dashboard.pendingRequests.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.pendingRequests.length === 0 ? (
              <div className="text-center py-4">
                <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">No pending requests</p>
              </div>
            ) : (
              <div className="space-y-3">
                {dashboard.pendingRequests.slice(0, 3).map((req) => (
                  <div key={req.id} className="flex items-center gap-3 p-2 bg-yellow-50 rounded-lg border border-yellow-100">
                    <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                      <ClockIcon className="h-5 w-5 text-yellow-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {req.appointmentTypeName || "Appointment Request"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Requested: {req.requestedDate} at {req.requestedTime}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Button
              variant="link"
              className="w-full mt-3"
              onClick={() => onNavigate("appointments")}
            >
              View All Requests
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      {dashboard.recentAppointments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Appointments</CardTitle>
            <CardDescription>Your appointment history</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {dashboard.recentAppointments.map((apt) => (
                <div
                  key={apt.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{apt.title || "Appointment"}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(apt.startTime)}
                      </p>
                    </div>
                  </div>
                  {getStatusBadge(apt.status)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

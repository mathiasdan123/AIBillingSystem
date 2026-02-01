import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  FileText,
  MessageSquare,
  User,
  Clock,
  DollarSign,
  Download,
  Eye,
  CheckCircle,
  AlertCircle,
  Loader2,
  LogOut,
  Home,
  PenTool,
} from "lucide-react";

interface DashboardData {
  patient: {
    id: number;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    dateOfBirth?: string;
    address?: string;
  } | null;
  upcomingAppointments: Array<{
    id: number;
    startTime: string;
    endTime: string;
    type?: string;
    status: string;
  }>;
  recentStatements: Array<{
    id: number;
    statementNumber: string;
    statementDate: string;
    totalAmount: string;
    balanceDue: string;
    status: string;
  }>;
  unreadMessages: number;
  documents: Array<{
    id: number;
    name: string;
    category: string;
    createdAt: string;
    requiresSignature: boolean;
    signedAt?: string;
    viewedAt?: string;
  }>;
  permissions: {
    canViewAppointments: boolean;
    canViewStatements: boolean;
    canViewDocuments: boolean;
    canSendMessages: boolean;
    canUpdateProfile: boolean;
    canCompleteIntake: boolean;
  };
}

export default function PatientPortalPage() {
  const params = useParams<{ token?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get token from URL params or localStorage
  const [portalToken, setPortalToken] = useState<string | null>(() => {
    return params.token || localStorage.getItem("portalToken");
  });
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedDocument, setSelectedDocument] = useState<any>(null);

  // If we have a magic link token, exchange it for a portal token
  useEffect(() => {
    if (params.token && params.token.length === 64) {
      // This looks like a magic link token, exchange it
      fetch(`/api/public/portal/login/${params.token}`)
        .then(res => res.json())
        .then(data => {
          if (data.portalToken) {
            localStorage.setItem("portalToken", data.portalToken);
            setPortalToken(data.portalToken);
            setLocation("/portal");
          } else {
            toast({
              title: "Login Failed",
              description: data.message || "Invalid or expired login link",
              variant: "destructive",
            });
          }
        })
        .catch(() => {
          toast({
            title: "Login Failed",
            description: "Could not connect to server",
            variant: "destructive",
          });
        });
    }
  }, [params.token, setLocation, toast]);

  // Fetch dashboard data
  const { data: dashboard, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/public/portal", portalToken, "dashboard"],
    queryFn: async () => {
      const res = await fetch(`/api/public/portal/${portalToken}/dashboard`);
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("portalToken");
          setPortalToken(null);
          throw new Error("Session expired");
        }
        throw new Error("Failed to fetch dashboard");
      }
      return res.json();
    },
    enabled: !!portalToken,
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch appointments
  const { data: appointments = [] } = useQuery({
    queryKey: ["/api/public/portal", portalToken, "appointments"],
    queryFn: async () => {
      const res = await fetch(`/api/public/portal/${portalToken}/appointments`);
      if (!res.ok) throw new Error("Failed to fetch appointments");
      return res.json();
    },
    enabled: !!portalToken && dashboard?.permissions?.canViewAppointments,
  });

  // Fetch statements
  const { data: statements = [] } = useQuery({
    queryKey: ["/api/public/portal", portalToken, "statements"],
    queryFn: async () => {
      const res = await fetch(`/api/public/portal/${portalToken}/statements`);
      if (!res.ok) throw new Error("Failed to fetch statements");
      return res.json();
    },
    enabled: !!portalToken && dashboard?.permissions?.canViewStatements,
  });

  // Fetch documents
  const { data: documents = [] } = useQuery({
    queryKey: ["/api/public/portal", portalToken, "documents"],
    queryFn: async () => {
      const res = await fetch(`/api/public/portal/${portalToken}/documents`);
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
    enabled: !!portalToken && dashboard?.permissions?.canViewDocuments,
  });

  const handleLogout = () => {
    localStorage.removeItem("portalToken");
    setPortalToken(null);
    setLocation("/");
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatCurrency = (amount: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(amount));
  };

  // Loading state
  if (!portalToken) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <User className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Patient Portal</CardTitle>
            <CardDescription>
              Please use the link sent to your email to access the portal.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted-foreground text-sm">
              If you haven't received a link, please contact your healthcare provider.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
            <CardTitle>Session Expired</CardTitle>
            <CardDescription>
              Your session has expired. Please request a new login link.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={handleLogout}>Return to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <Home className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Patient Portal</h1>
              <p className="text-sm text-muted-foreground">
                Welcome, {dashboard.patient?.firstName}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview">
              <Home className="h-4 w-4 mr-2" />
              Overview
            </TabsTrigger>
            {dashboard.permissions.canViewAppointments && (
              <TabsTrigger value="appointments">
                <Calendar className="h-4 w-4 mr-2" />
                Appointments
              </TabsTrigger>
            )}
            {dashboard.permissions.canViewStatements && (
              <TabsTrigger value="statements">
                <DollarSign className="h-4 w-4 mr-2" />
                Statements
              </TabsTrigger>
            )}
            {dashboard.permissions.canViewDocuments && (
              <TabsTrigger value="documents">
                <FileText className="h-4 w-4 mr-2" />
                Documents
              </TabsTrigger>
            )}
            <TabsTrigger value="profile">
              <User className="h-4 w-4 mr-2" />
              Profile
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {/* Upcoming Appointments Card */}
              {dashboard.permissions.canViewAppointments && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-primary" />
                      Upcoming Appointments
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {dashboard.upcomingAppointments.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No upcoming appointments</p>
                    ) : (
                      <div className="space-y-3">
                        {dashboard.upcomingAppointments.slice(0, 3).map((apt) => (
                          <div key={apt.id} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                              <Clock className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{formatDate(apt.startTime)}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatTime(apt.startTime)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      variant="link"
                      className="w-full mt-3"
                      onClick={() => setActiveTab("appointments")}
                    >
                      View All Appointments
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Messages Card */}
              {dashboard.permissions.canSendMessages && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-primary" />
                      Messages
                      {dashboard.unreadMessages > 0 && (
                        <Badge variant="destructive" className="ml-2">
                          {dashboard.unreadMessages}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground text-sm mb-4">
                      {dashboard.unreadMessages > 0
                        ? `You have ${dashboard.unreadMessages} unread message(s)`
                        : "No new messages"}
                    </p>
                    <Button variant="outline" className="w-full">
                      Open Messages
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Balance Card */}
              {dashboard.permissions.canViewStatements && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-primary" />
                      Account Balance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {dashboard.recentStatements.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No outstanding balance</p>
                    ) : (
                      <>
                        <p className="text-2xl font-bold">
                          {formatCurrency(
                            dashboard.recentStatements
                              .reduce((sum, s) => sum + parseFloat(s.balanceDue), 0)
                              .toString()
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mb-4">Total balance due</p>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => setActiveTab("statements")}
                        >
                          View Statements
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Documents Card */}
              {dashboard.permissions.canViewDocuments && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      Documents
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {dashboard.documents.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No documents</p>
                    ) : (
                      <>
                        <div className="space-y-2">
                          {dashboard.documents.slice(0, 3).map((doc) => (
                            <div
                              key={doc.id}
                              className="flex items-center justify-between p-2 bg-slate-50 rounded"
                            >
                              <span className="text-sm truncate">{doc.name}</span>
                              {doc.requiresSignature && !doc.signedAt && (
                                <Badge variant="outline" className="text-yellow-600">
                                  Needs Signature
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                        <Button
                          variant="link"
                          className="w-full mt-3"
                          onClick={() => setActiveTab("documents")}
                        >
                          View All Documents
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Appointments Tab */}
          <TabsContent value="appointments">
            <Card>
              <CardHeader>
                <CardTitle>Your Appointments</CardTitle>
                <CardDescription>View your upcoming and past appointments</CardDescription>
              </CardHeader>
              <CardContent>
                {appointments.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No appointments found</p>
                ) : (
                  <div className="space-y-4">
                    {appointments.map((apt: any) => {
                      const isUpcoming = new Date(apt.startTime) >= new Date();
                      return (
                        <div
                          key={apt.id}
                          className={`flex items-center justify-between p-4 rounded-lg border ${
                            isUpcoming ? "bg-white" : "bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                                isUpcoming ? "bg-primary/10" : "bg-slate-200"
                              }`}
                            >
                              <Calendar
                                className={`h-6 w-6 ${isUpcoming ? "text-primary" : "text-slate-500"}`}
                              />
                            </div>
                            <div>
                              <p className="font-medium">{formatDate(apt.startTime)}</p>
                              <p className="text-sm text-muted-foreground">
                                {formatTime(apt.startTime)} - {formatTime(apt.endTime)}
                              </p>
                            </div>
                          </div>
                          <Badge
                            variant={
                              apt.status === "confirmed"
                                ? "default"
                                : apt.status === "cancelled"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {apt.status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Statements Tab */}
          <TabsContent value="statements">
            <Card>
              <CardHeader>
                <CardTitle>Billing Statements</CardTitle>
                <CardDescription>View and pay your statements</CardDescription>
              </CardHeader>
              <CardContent>
                {statements.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No statements found</p>
                ) : (
                  <div className="space-y-4">
                    {statements.map((stmt: any) => (
                      <div
                        key={stmt.id}
                        className="flex items-center justify-between p-4 rounded-lg border"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                            <DollarSign className="h-6 w-6 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{stmt.statementNumber}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatDate(stmt.statementDate)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold">{formatCurrency(stmt.balanceDue)}</p>
                          <Badge
                            variant={
                              stmt.status === "paid"
                                ? "default"
                                : stmt.status === "overdue"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {stmt.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <CardTitle>Your Documents</CardTitle>
                <CardDescription>View and sign documents from your provider</CardDescription>
              </CardHeader>
              <CardContent>
                {documents.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No documents found</p>
                ) : (
                  <div className="space-y-4">
                    {documents.map((doc: any) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-4 rounded-lg border"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                            <FileText className="h-6 w-6 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{doc.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {doc.category} - {formatDate(doc.createdAt)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {doc.requiresSignature && !doc.signedAt ? (
                            <Button size="sm" onClick={() => setSelectedDocument(doc)}>
                              <PenTool className="h-4 w-4 mr-2" />
                              Sign
                            </Button>
                          ) : doc.signedAt ? (
                            <Badge variant="default" className="bg-green-500">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Signed
                            </Badge>
                          ) : null}
                          <Button variant="outline" size="sm">
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Profile Tab */}
          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle>Your Profile</CardTitle>
                <CardDescription>View and update your information</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Full Name</label>
                      <p className="text-lg">
                        {dashboard.patient?.firstName} {dashboard.patient?.lastName}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Email</label>
                      <p>{dashboard.patient?.email || "Not provided"}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Phone</label>
                      <p>{dashboard.patient?.phone || "Not provided"}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Date of Birth</label>
                      <p>
                        {dashboard.patient?.dateOfBirth
                          ? formatDate(dashboard.patient.dateOfBirth)
                          : "Not provided"}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Address</label>
                      <p>{dashboard.patient?.address || "Not provided"}</p>
                    </div>
                  </div>
                </div>
                {dashboard.permissions.canUpdateProfile && (
                  <div className="mt-6 pt-6 border-t">
                    <Button variant="outline">Update Contact Information</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Document Signature Dialog */}
      <Dialog open={!!selectedDocument} onOpenChange={() => setSelectedDocument(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign Document</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-muted-foreground mb-4">
              Please sign below to acknowledge that you have read and agree to the terms of:
            </p>
            <p className="font-medium mb-6">{selectedDocument?.name}</p>
            <div className="border-2 border-dashed rounded-lg h-32 flex items-center justify-center bg-slate-50">
              <p className="text-muted-foreground">Signature pad would go here</p>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="outline" className="flex-1" onClick={() => setSelectedDocument(null)}>
                Cancel
              </Button>
              <Button className="flex-1">Submit Signature</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

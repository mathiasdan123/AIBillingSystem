import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, TrendingDown, DollarSign, FileText, AlertCircle, CheckCircle, CalendarX, Clock, UserX, AlertTriangle, Users, Building2, UserCog, CreditCard, Shield, AlertOctagon } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export default function Analytics() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [practiceId] = useState(1);
  const [timeRange, setTimeRange] = useState("12months");

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: dashboardStats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/analytics/dashboard', practiceId],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ['/api/analytics/revenue', practiceId, timeRange],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: claimsByStatus, isLoading: claimsStatusLoading } = useQuery({
    queryKey: ['/api/analytics/claims-by-status', practiceId],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: denialReasons, isLoading: denialReasonsLoading } = useQuery({
    queryKey: ['/api/analytics/denial-reasons', practiceId],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: cancellationStats } = useQuery({
    queryKey: ['/api/analytics/cancellations', `?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: cancellationTrend } = useQuery({
    queryKey: ['/api/analytics/cancellations/trend', `?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: cancellationsByPatient } = useQuery({
    queryKey: ['/api/analytics/cancellations/by-patient', `?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  // NEW QUERIES for enhanced analytics
  const { data: patients = [] } = useQuery<any[]>({
    queryKey: ["/api/patients"],
    enabled: isAuthenticated,
  });

  const { data: claims = [] } = useQuery<any[]>({
    queryKey: ["/api/claims"],
    enabled: isAuthenticated,
  });

  const { data: therapists = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
    enabled: isAuthenticated,
  });

  const { data: eligibilityData = [] } = useQuery<any[]>({
    queryKey: ["/api/eligibility-checks"],
    enabled: isAuthenticated,
  });

  // Calculate patient payment stats
  const patientPaymentStats = patients.map((patient: any) => {
    const patientClaims = claims.filter((c: any) => c.patientId === patient.id);
    const totalBilled = patientClaims.reduce((sum: number, c: any) => sum + parseFloat(c.totalAmount || 0), 0);
    const paidClaims = patientClaims.filter((c: any) => c.status === 'paid');
    const totalPaid = paidClaims.reduce((sum: number, c: any) => sum + parseFloat(c.paidAmount || c.totalAmount || 0), 0);
    const insurancePaid = paidClaims.reduce((sum: number, c: any) => sum + parseFloat(c.insurancePaid || c.totalAmount * 0.8 || 0), 0);
    const patientPaid = totalPaid - insurancePaid;

    return {
      id: patient.id,
      name: `${patient.firstName} ${patient.lastName}`,
      insurance: patient.insuranceProvider || 'Self-Pay',
      totalBilled,
      totalPaid,
      insurancePaid,
      patientPaid,
      claimCount: patientClaims.length,
      paidCount: paidClaims.length,
    };
  }).sort((a: any, b: any) => b.totalPaid - a.totalPaid);

  // Calculate therapist revenue stats
  const therapistStats = therapists.map((therapist: any) => {
    // Find claims/sessions for this therapist
    const therapistClaims = claims.filter((c: any) => c.therapistId === therapist.id);
    const totalRevenue = therapistClaims.reduce((sum: number, c: any) => {
      if (c.status === 'paid') return sum + parseFloat(c.paidAmount || c.totalAmount || 0);
      return sum;
    }, 0);
    const totalBilled = therapistClaims.reduce((sum: number, c: any) => sum + parseFloat(c.totalAmount || 0), 0);
    const sessionCount = therapistClaims.length;

    return {
      id: therapist.id,
      name: `${therapist.firstName || ''} ${therapist.lastName || ''}`.trim() || therapist.email,
      totalRevenue,
      totalBilled,
      sessionCount,
      avgPerSession: sessionCount > 0 ? totalRevenue / sessionCount : 0,
    };
  }).filter((t: any) => t.name).sort((a: any, b: any) => b.totalRevenue - a.totalRevenue);

  // Patients approaching visit limits
  const patientsNearVisitLimit = patients
    .map((patient: any) => {
      // Get latest eligibility for this patient
      const patientEligibility = eligibilityData.find((e: any) => e.patientId === patient.id);
      if (!patientEligibility || !patientEligibility.visitsAllowed) return null;

      const visitsAllowed = patientEligibility.visitsAllowed || 0;
      const visitsUsed = patientEligibility.visitsUsed || 0;
      const visitsRemaining = visitsAllowed - visitsUsed;
      const percentUsed = visitsAllowed > 0 ? (visitsUsed / visitsAllowed) * 100 : 0;

      return {
        id: patient.id,
        name: `${patient.firstName} ${patient.lastName}`,
        insurance: patient.insuranceProvider || 'N/A',
        visitsAllowed,
        visitsUsed,
        visitsRemaining,
        percentUsed,
      };
    })
    .filter((p: any) => p && p.visitsRemaining <= 5 && p.visitsAllowed > 0)
    .sort((a: any, b: any) => a.visitsRemaining - b.visitsRemaining);

  // Summary stats
  const totalPatients = patients.length;
  const activePatients = patients.filter((p: any) => {
    const patientClaims = claims.filter((c: any) => c.patientId === p.id);
    const recentClaim = patientClaims.find((c: any) => {
      const claimDate = new Date(c.serviceDate || c.createdAt);
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      return claimDate >= threeMonthsAgo;
    });
    return !!recentClaim;
  }).length;

  const totalInsurancePaid = patientPaymentStats.reduce((sum: any, p: any) => sum + p.insurancePaid, 0);
  const totalPatientPaid = patientPaymentStats.reduce((sum: any, p: any) => sum + p.patientPaid, 0);

  if (isLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const COLORS = ['hsl(207, 90%, 54%)', 'hsl(142, 71%, 45%)', 'hsl(0, 84.2%, 60.2%)', 'hsl(45, 93%, 47%)'];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'hsl(142, 71%, 45%)';
      case 'submitted':
        return 'hsl(45, 93%, 47%)';
      case 'denied':
        return 'hsl(0, 84.2%, 60.2%)';
      default:
        return 'hsl(207, 90%, 54%)';
    }
  };

  // Mock revenue data for demonstration
  const mockRevenueData = [
    { month: '2024-01', revenue: 15000, claims: 45 },
    { month: '2024-02', revenue: 18000, claims: 52 },
    { month: '2024-03', revenue: 22000, claims: 61 },
    { month: '2024-04', revenue: 19000, claims: 48 },
    { month: '2024-05', revenue: 25000, claims: 67 },
    { month: '2024-06', revenue: 28000, claims: 73 },
    { month: '2024-07', revenue: 26000, claims: 69 },
    { month: '2024-08', revenue: 30000, claims: 78 },
    { month: '2024-09', revenue: 32000, claims: 82 },
    { month: '2024-10', revenue: 29000, claims: 75 },
    { month: '2024-11', revenue: 35000, claims: 89 },
    { month: '2024-12', revenue: 38000, claims: 95 },
  ];

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analytics Dashboard</h1>
          <p className="text-slate-600">Track your practice performance and billing insights</p>
        </div>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3months">Last 3 months</SelectItem>
            <SelectItem value="6months">Last 6 months</SelectItem>
            <SelectItem value="12months">Last 12 months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="patients">Patients</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="therapists">Therapists</TabsTrigger>
          <TabsTrigger value="cancellations">Cancellations</TabsTrigger>
        </TabsList>

        {/* ==================== OVERVIEW TAB ==================== */}
        <TabsContent value="overview" className="space-y-6">

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(dashboardStats?.totalRevenue || 0)}</div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingUp className="w-3 h-3 mr-1 text-healthcare-green-500" />
              <span className="text-healthcare-green-500">+12.5%</span>
              <span className="ml-1">from last month</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Claims Success Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats?.successRate?.toFixed(1) || 0}%</div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingUp className="w-3 h-3 mr-1 text-healthcare-green-500" />
              <span className="text-healthcare-green-500">+2.1%</span>
              <span className="ml-1">from last month</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Denial Rate</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats?.denialRate?.toFixed(1) || 0}%</div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingDown className="w-3 h-3 mr-1 text-healthcare-green-500" />
              <span className="text-healthcare-green-500">-1.8%</span>
              <span className="ml-1">from last month</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Claims</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats?.pendingClaims || 0}</div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingDown className="w-3 h-3 mr-1 text-healthcare-green-500" />
              <span className="text-healthcare-green-500">-5 claims</span>
              <span className="ml-1">from last week</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Revenue Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue Trend</CardTitle>
            <CardDescription>Monthly revenue over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={mockRevenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="month" 
                  tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short' })}
                />
                <YAxis tickFormatter={(value) => `$${value / 1000}k`} />
                <Tooltip 
                  formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                  labelFormatter={(label) => new Date(label).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                />
                <Line 
                  type="monotone" 
                  dataKey="revenue" 
                  stroke="hsl(207, 90%, 54%)" 
                  strokeWidth={2}
                  dot={{ fill: 'hsl(207, 90%, 54%)', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Claims by Status */}
        <Card>
          <CardHeader>
            <CardTitle>Claims by Status</CardTitle>
            <CardDescription>Distribution of claim statuses</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={claimsByStatus}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {claimsByStatus?.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={getStatusColor(entry.status)} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Claims Volume */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Claims Volume</CardTitle>
          <CardDescription>Number of claims processed monthly</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={mockRevenueData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="month" 
                tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short' })}
              />
              <YAxis />
              <Tooltip 
                formatter={(value: number) => [value, 'Claims']}
                labelFormatter={(label) => new Date(label).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              />
              <Bar dataKey="claims" fill="hsl(142, 71%, 45%)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Denial Reasons */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Top Denial Reasons</CardTitle>
          <CardDescription>Most common reasons for claim denials</CardDescription>
        </CardHeader>
        <CardContent>
          {denialReasonsLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : denialReasons?.length ? (
            <div className="space-y-3">
              {denialReasons.map((reason: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                      <span className="text-red-600 font-medium text-sm">{index + 1}</span>
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{reason.reason}</p>
                      <p className="text-sm text-slate-600">{reason.count} claims affected</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="w-16 h-2 bg-slate-200 rounded-full">
                      <div
                        className="h-full bg-red-500 rounded-full"
                        style={{ width: `${(reason.count / (denialReasons[0]?.count || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 text-healthcare-green-500 mx-auto mb-4" />
              <p className="text-slate-600">No denial reasons found - great job!</p>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* ==================== PATIENTS TAB ==================== */}
        <TabsContent value="patients" className="space-y-6">
          {/* Patient Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalPatients}</div>
                <p className="text-xs text-muted-foreground">registered in system</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Patients</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{activePatients}</div>
                <p className="text-xs text-muted-foreground">seen in last 3 months</p>
              </CardContent>
            </Card>
            <Card className="bg-amber-50 border-amber-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-amber-800">Near Visit Limit</CardTitle>
                <AlertOctagon className="h-4 w-4 text-amber-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-700">{patientsNearVisitLimit.length}</div>
                <p className="text-xs text-amber-600">≤5 visits remaining</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Revenue/Patient</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(patientPaymentStats.length > 0
                    ? patientPaymentStats.reduce((sum: number, p: any) => sum + p.totalPaid, 0) / patientPaymentStats.length
                    : 0)}
                </div>
                <p className="text-xs text-muted-foreground">lifetime value</p>
              </CardContent>
            </Card>
          </div>

          {/* Patients Near Visit Limit Alert */}
          {patientsNearVisitLimit.length > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-800">
                  <AlertOctagon className="w-5 h-5" />
                  Patients Approaching Visit Limits
                </CardTitle>
                <CardDescription className="text-amber-700">
                  These patients are close to exhausting their allowed visits - consider requesting authorization
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Insurance</TableHead>
                      <TableHead className="text-center">Visits Used</TableHead>
                      <TableHead className="text-center">Visits Allowed</TableHead>
                      <TableHead className="text-center">Remaining</TableHead>
                      <TableHead>Progress</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patientsNearVisitLimit.slice(0, 10).map((patient: any) => (
                      <TableRow key={patient.id}>
                        <TableCell className="font-medium">{patient.name}</TableCell>
                        <TableCell>{patient.insurance}</TableCell>
                        <TableCell className="text-center">{patient.visitsUsed}</TableCell>
                        <TableCell className="text-center">{patient.visitsAllowed}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={patient.visitsRemaining <= 2 ? "destructive" : "secondary"}>
                            {patient.visitsRemaining}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="w-24">
                            <Progress value={patient.percentUsed} className="h-2" />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Patient Revenue Table */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue by Patient</CardTitle>
              <CardDescription>Patient billing and payment summary</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Insurance</TableHead>
                    <TableHead className="text-right">Total Billed</TableHead>
                    <TableHead className="text-right">Insurance Paid</TableHead>
                    <TableHead className="text-right">Patient Paid</TableHead>
                    <TableHead className="text-center">Claims</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patientPaymentStats.slice(0, 15).map((patient: any) => (
                    <TableRow key={patient.id}>
                      <TableCell className="font-medium">{patient.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{patient.insurance}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(patient.totalBilled)}</TableCell>
                      <TableCell className="text-right text-green-600">{formatCurrency(patient.insurancePaid)}</TableCell>
                      <TableCell className="text-right text-blue-600">{formatCurrency(patient.patientPaid)}</TableCell>
                      <TableCell className="text-center">{patient.claimCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== PAYMENTS TAB ==================== */}
        <TabsContent value="payments" className="space-y-6">
          {/* Payment Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-green-50 border-green-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-green-800">Insurance Payments</CardTitle>
                <Shield className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-700">{formatCurrency(totalInsurancePaid)}</div>
                <p className="text-xs text-green-600">total collected from payers</p>
              </CardContent>
            </Card>
            <Card className="bg-blue-50 border-blue-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-blue-800">Patient Payments</CardTitle>
                <CreditCard className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-700">{formatCurrency(totalPatientPaid)}</div>
                <p className="text-xs text-blue-600">copays & self-pay</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Collected</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totalInsurancePaid + totalPatientPaid)}</div>
                <p className="text-xs text-muted-foreground">all sources</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Insurance %</CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totalInsurancePaid + totalPatientPaid > 0
                    ? Math.round((totalInsurancePaid / (totalInsurancePaid + totalPatientPaid)) * 100)
                    : 0}%
                </div>
                <p className="text-xs text-muted-foreground">of revenue from insurance</p>
              </CardContent>
            </Card>
          </div>

          {/* Payment Source Pie Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Payment Sources</CardTitle>
                <CardDescription>Insurance vs Patient payments</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Insurance', value: totalInsurancePaid },
                        { name: 'Patient', value: totalPatientPaid },
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      dataKey="value"
                    >
                      <Cell fill="hsl(142, 71%, 45%)" />
                      <Cell fill="hsl(207, 90%, 54%)" />
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Paying Insurers</CardTitle>
                <CardDescription>Revenue by insurance company</CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const insurerPayments: Record<string, number> = {};
                  patientPaymentStats.forEach((p: any) => {
                    insurerPayments[p.insurance] = (insurerPayments[p.insurance] || 0) + p.insurancePaid;
                  });
                  const sortedInsurers = Object.entries(insurerPayments)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .slice(0, 5);

                  return (
                    <div className="space-y-3">
                      {sortedInsurers.map(([insurer, amount], idx) => (
                        <div key={insurer} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                              <span className="text-green-600 font-medium text-sm">{idx + 1}</span>
                            </div>
                            <span className="font-medium">{insurer}</span>
                          </div>
                          <span className="font-bold text-green-600">{formatCurrency(amount as number)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ==================== THERAPISTS TAB ==================== */}
        <TabsContent value="therapists" className="space-y-6">
          {/* Therapist Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Therapists</CardTitle>
                <UserCog className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{therapists.length}</div>
                <p className="text-xs text-muted-foreground">active in practice</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Revenue/Therapist</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(therapistStats.length > 0
                    ? therapistStats.reduce((sum: number, t: any) => sum + t.totalRevenue, 0) / therapistStats.length
                    : 0)}
                </div>
                <p className="text-xs text-muted-foreground">per therapist</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {therapistStats.reduce((sum: number, t: any) => sum + t.sessionCount, 0)}
                </div>
                <p className="text-xs text-muted-foreground">all therapists combined</p>
              </CardContent>
            </Card>
          </div>

          {/* Therapist Performance Table */}
          <Card>
            <CardHeader>
              <CardTitle>Therapist Performance</CardTitle>
              <CardDescription>Revenue and session stats by therapist</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Therapist</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Total Billed</TableHead>
                    <TableHead className="text-right">Revenue Collected</TableHead>
                    <TableHead className="text-right">Avg/Session</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {therapistStats.map((therapist: any) => (
                    <TableRow key={therapist.id}>
                      <TableCell className="font-medium">{therapist.name}</TableCell>
                      <TableCell className="text-right">{therapist.sessionCount}</TableCell>
                      <TableCell className="text-right">{formatCurrency(therapist.totalBilled)}</TableCell>
                      <TableCell className="text-right text-green-600 font-bold">{formatCurrency(therapist.totalRevenue)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(therapist.avgPerSession)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {therapistStats.length === 0 && (
                <div className="text-center py-8 text-slate-500">
                  No therapist data available yet
                </div>
              )}
            </CardContent>
          </Card>

          {/* Therapist Revenue Chart */}
          {therapistStats.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Revenue by Therapist</CardTitle>
                <CardDescription>Compare therapist performance</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={therapistStats.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(value) => `$${value / 1000}k`} />
                    <YAxis type="category" dataKey="name" width={120} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="totalRevenue" fill="hsl(207, 90%, 54%)" name="Revenue" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ==================== CANCELLATIONS TAB ==================== */}
        <TabsContent value="cancellations" className="space-y-6">

        {/* Cancellation Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Cancellations</CardTitle>
              <CalendarX className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{cancellationStats?.totalCancelled || 0}</div>
              <p className="text-xs text-muted-foreground">of {cancellationStats?.totalScheduled || 0} scheduled</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cancellation Rate</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{cancellationStats?.cancellationRate?.toFixed(1) || 0}%</div>
              <p className="text-xs text-muted-foreground">
                {(cancellationStats?.cancellationRate || 0) > 15 ? (
                  <span className="text-red-500">Above 15% threshold</span>
                ) : (
                  <span className="text-green-500">Within acceptable range</span>
                )}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Late Cancels</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{cancellationStats?.lateCancellations || 0}</div>
              <p className="text-xs text-muted-foreground">Within 24h of appointment</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">No-Shows</CardTitle>
              <UserX className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{cancellationStats?.totalNoShow || 0}</div>
              <p className="text-xs text-muted-foreground">{cancellationStats?.noShowRate?.toFixed(1) || 0}% no-show rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Lead Time</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{cancellationStats?.avgLeadTimeHours || 0}h</div>
              <p className="text-xs text-muted-foreground">Avg notice before appointment</p>
            </CardContent>
          </Card>
        </div>

        {/* Cancellation Trend + Reason Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Cancellation Trend</CardTitle>
              <CardDescription>Monthly cancellation and no-show rates</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={cancellationTrend || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(value) => {
                      const d = new Date(value + "-01");
                      return d.toLocaleDateString('en-US', { month: 'short' });
                    }}
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(label) => {
                      const d = new Date(label + "-01");
                      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="cancelled" stroke="hsl(0, 84%, 60%)" strokeWidth={2} name="Cancelled" />
                  <Line type="monotone" dataKey="noShows" stroke="hsl(25, 95%, 53%)" strokeWidth={2} name="No-Shows" />
                  <Line type="monotone" dataKey="scheduled" stroke="hsl(207, 90%, 54%)" strokeWidth={2} name="Scheduled" dot={false} strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cancellation Reasons</CardTitle>
              <CardDescription>Distribution of why appointments are cancelled</CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                // Aggregate reasons from trend data or use cancellationsByPatient
                const reasonCounts: Record<string, number> = {};
                (cancellationsByPatient || []).forEach((p: any) => {
                  if (p.cancellations > 0) reasonCounts["Cancellations"] = (reasonCounts["Cancellations"] || 0) + p.cancellations;
                  if (p.noShows > 0) reasonCounts["No-Shows"] = (reasonCounts["No-Shows"] || 0) + p.noShows;
                  if (p.lateCancellations > 0) reasonCounts["Late Cancels"] = (reasonCounts["Late Cancels"] || 0) + p.lateCancellations;
                });
                const pieData = Object.entries(reasonCounts).map(([name, value]) => ({ name, value }));
                const CANCEL_COLORS = ['hsl(0, 84%, 60%)', 'hsl(25, 95%, 53%)', 'hsl(45, 93%, 47%)', 'hsl(207, 90%, 54%)', 'hsl(142, 71%, 45%)', 'hsl(280, 68%, 60%)'];

                if (pieData.length === 0) {
                  return (
                    <div className="text-center py-8">
                      <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                      <p className="text-slate-600">No cancellations recorded yet</p>
                    </div>
                  );
                }

                return (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {pieData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={CANCEL_COLORS[index % CANCEL_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>
        </div>

        {/* Per-Patient Cancellation Table */}
        <Card>
          <CardHeader>
            <CardTitle>Cancellations by Patient</CardTitle>
            <CardDescription>Patients sorted by cancellation frequency</CardDescription>
          </CardHeader>
          <CardContent>
            {cancellationsByPatient?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead className="text-center">Total Appts</TableHead>
                    <TableHead className="text-center">Cancellations</TableHead>
                    <TableHead className="text-center">No-Shows</TableHead>
                    <TableHead className="text-center">Late Cancels</TableHead>
                    <TableHead className="text-center">Cancel Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cancellationsByPatient.map((patient: any) => {
                    const cancelRate = patient.totalAppointments > 0
                      ? Math.round((patient.cancellations / patient.totalAppointments) * 100)
                      : 0;
                    return (
                      <TableRow key={patient.patientId}>
                        <TableCell className="font-medium">{patient.patientName}</TableCell>
                        <TableCell className="text-center">{patient.totalAppointments}</TableCell>
                        <TableCell className="text-center">{patient.cancellations}</TableCell>
                        <TableCell className="text-center">{patient.noShows}</TableCell>
                        <TableCell className="text-center">{patient.lateCancellations}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={cancelRate > 30 ? "destructive" : "secondary"}>
                            {cancelRate}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <p className="text-slate-600">No cancellation data available yet</p>
              </div>
            )}
          </CardContent>
        </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

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
    queryKey: [`/api/analytics/cancellations?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: cancellationTrend } = useQuery({
    queryKey: [`/api/analytics/cancellations/trend?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: cancellationsByPatient } = useQuery({
    queryKey: [`/api/analytics/cancellations/by-patient?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  // Enhanced analytics queries
  const { data: collectionRate } = useQuery({
    queryKey: [`/api/analytics/collection-rate?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: cleanClaimsRate } = useQuery({
    queryKey: [`/api/analytics/clean-claims-rate?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: capacityUtilization } = useQuery({
    queryKey: [`/api/analytics/capacity?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: arAging } = useQuery({
    queryKey: [`/api/analytics/ar-aging?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: revenueForecast } = useQuery({
    queryKey: [`/api/analytics/revenue/forecast?practiceId=${practiceId}&months=3`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: referrals } = useQuery({
    queryKey: [`/api/analytics/referrals?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const { data: revenueByLocationTherapist } = useQuery({
    queryKey: [`/api/analytics/revenue-by-location-therapist?practiceId=${practiceId}`],
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
  const patientPaymentStats = (patients || []).map((patient: any) => {
    const patientClaims = (claims || []).filter((c: any) => c.patientId === patient.id);
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
  const therapistStats = (therapists || []).map((therapist: any) => {
    // Find claims/sessions for this therapist
    const therapistClaims = (claims || []).filter((c: any) => c.therapistId === therapist.id);
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
  const patientsNearVisitLimit = (patients || [])
    .map((patient: any) => {
      // Get latest eligibility for this patient
      const patientEligibility = (eligibilityData || []).find((e: any) => e.patientId === patient.id);
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
  const totalPatients = (patients || []).length;
  const activePatients = (patients || []).filter((p: any) => {
    const patientClaims = (claims || []).filter((c: any) => c.patientId === p.id);
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
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="capacity">Capacity</TabsTrigger>
          <TabsTrigger value="ar-aging">A/R Aging</TabsTrigger>
          <TabsTrigger value="referrals">Referrals</TabsTrigger>
          <TabsTrigger value="patients">Patients</TabsTrigger>
          <TabsTrigger value="therapists">Therapists</TabsTrigger>
          <TabsTrigger value="cancellations">Cancellations</TabsTrigger>
        </TabsList>

        {/* ==================== OVERVIEW TAB ==================== */}
        <TabsContent value="overview" className="space-y-6">

      {/* KPI Cards with Target Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Collection Rate */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Collection Rate</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {collectionRate?.collectionRate?.toFixed(1) || 0}%
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Target: 99%</span>
                <span className={(collectionRate?.collectionRate || 0) >= 99 ? 'text-green-600' : 'text-amber-600'}>
                  {((collectionRate?.collectionRate || 0) >= 99) ? 'On Target' : `${(99 - (collectionRate?.collectionRate || 0)).toFixed(1)}% below`}
                </span>
              </div>
              <Progress
                value={Math.min((collectionRate?.collectionRate || 0), 100)}
                className="h-2"
              />
            </div>
          </CardContent>
        </Card>

        {/* Clean Claims Rate */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clean Claims Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cleanClaimsRate?.cleanClaimsRate?.toFixed(1) || 0}%
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Target: 97%</span>
                <span className={(cleanClaimsRate?.cleanClaimsRate || 0) >= 97 ? 'text-green-600' : 'text-amber-600'}>
                  {((cleanClaimsRate?.cleanClaimsRate || 0) >= 97) ? 'On Target' : `${(97 - (cleanClaimsRate?.cleanClaimsRate || 0)).toFixed(1)}% below`}
                </span>
              </div>
              <Progress
                value={Math.min((cleanClaimsRate?.cleanClaimsRate || 0), 100)}
                className="h-2"
              />
            </div>
          </CardContent>
        </Card>

        {/* Arrived Capacity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Arrived Capacity</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {capacityUtilization?.arrivedRate?.toFixed(1) || 0}%
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Target: 90%</span>
                <span className={(capacityUtilization?.arrivedRate || 0) >= 90 ? 'text-green-600' : 'text-amber-600'}>
                  {((capacityUtilization?.arrivedRate || 0) >= 90) ? 'On Target' : `${(90 - (capacityUtilization?.arrivedRate || 0)).toFixed(1)}% below`}
                </span>
              </div>
              <Progress
                value={Math.min((capacityUtilization?.arrivedRate || 0), 100)}
                className="h-2"
              />
            </div>
          </CardContent>
        </Card>

        {/* Days in AR */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Days in A/R</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{arAging?.averageDays || 0} days</div>
            <div className="flex items-center text-xs text-muted-foreground mt-2">
              {(arAging?.averageDays || 0) <= 30 ? (
                <>
                  <TrendingDown className="w-3 h-3 mr-1 text-green-500" />
                  <span className="text-green-600">Healthy (under 30 days)</span>
                </>
              ) : (arAging?.averageDays || 0) <= 45 ? (
                <>
                  <AlertTriangle className="w-3 h-3 mr-1 text-amber-500" />
                  <span className="text-amber-600">Monitor (30-45 days)</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3 mr-1 text-red-500" />
                  <span className="text-red-600">Action needed ({arAging?.averageDays} days)</span>
                </>
              )}
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
            {claimsByStatus && claimsByStatus.length > 0 ? (
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
                    {claimsByStatus.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={getStatusColor(entry.status)} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-slate-500">
                {claimsStatusLoading ? 'Loading claims data...' : 'No claims data available'}
              </div>
            )}
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

        {/* ==================== REVENUE TAB ==================== */}
        <TabsContent value="revenue" className="space-y-6">
          {/* Revenue Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Collected</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(collectionRate?.totalCollected || 0)}</div>
                <p className="text-xs text-muted-foreground">of {formatCurrency(collectionRate?.totalBilled || 0)} billed</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Collection Rate</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{collectionRate?.collectionRate?.toFixed(1) || 0}%</div>
                <p className="text-xs text-muted-foreground">Target: {collectionRate?.target || 99}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Revenue Trend</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {revenueForecast?.[0]?.predicted ? `+${formatCurrency(revenueForecast[0].predicted)}` : 'N/A'}
                </div>
                <p className="text-xs text-muted-foreground">Next month forecast</p>
              </CardContent>
            </Card>
          </div>

          {/* Revenue Trend with Forecast */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue Trend & Forecast</CardTitle>
              <CardDescription>Historical revenue with 3-month prediction</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={[
                  ...(revenueData || mockRevenueData).map((d: any) => ({ ...d, type: 'actual' })),
                  ...(revenueForecast || []).map((d: any) => ({
                    month: d.month,
                    revenue: d.predicted,
                    predictedLow: d.confidence?.low,
                    predictedHigh: d.confidence?.high,
                    type: 'forecast'
                  }))
                ]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(value) => {
                      const d = new Date(value + '-01');
                      return d.toLocaleDateString('en-US', { month: 'short' });
                    }}
                  />
                  <YAxis tickFormatter={(value) => `$${value / 1000}k`} />
                  <Tooltip
                    formatter={(value: number, name: string) => [formatCurrency(value), name === 'revenue' ? 'Revenue' : name]}
                    labelFormatter={(label) => new Date(label + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(207, 90%, 54%)"
                    strokeWidth={2}
                    dot={{ fill: 'hsl(207, 90%, 54%)', strokeWidth: 2 }}
                    name="Revenue"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Revenue by Insurance */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue by Insurance</CardTitle>
              <CardDescription>Collection rates by insurance provider</CardDescription>
            </CardHeader>
            <CardContent>
              {collectionRate?.byInsurance?.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Insurance</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Collected</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {collectionRate.byInsurance.map((ins: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{ins.name}</TableCell>
                        <TableCell className="text-right">{formatCurrency(ins.billed)}</TableCell>
                        <TableCell className="text-right text-green-600">{formatCurrency(ins.collected)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={ins.rate >= 99 ? "default" : ins.rate >= 90 ? "secondary" : "destructive"}>
                            {ins.rate.toFixed(1)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-slate-500">No insurance data available</div>
              )}
            </CardContent>
          </Card>

          {/* Revenue by Therapist */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue by Therapist</CardTitle>
              <CardDescription>Performance metrics for each therapist</CardDescription>
            </CardHeader>
            <CardContent>
              {revenueByLocationTherapist?.byTherapist?.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Therapist</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Collected</TableHead>
                      <TableHead className="text-right">Claims</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Collection Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueByLocationTherapist.byTherapist.map((t: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{t.therapistName}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.totalBilled)}</TableCell>
                        <TableCell className="text-right text-green-600">{formatCurrency(t.totalRevenue)}</TableCell>
                        <TableCell className="text-right">{t.claimCount}</TableCell>
                        <TableCell className="text-right">{t.paidCount}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={t.totalBilled > 0 && (t.totalRevenue / t.totalBilled) >= 0.9 ? "default" : "secondary"}>
                            {t.totalBilled > 0 ? ((t.totalRevenue / t.totalBilled) * 100).toFixed(1) : 0}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-slate-500">No therapist revenue data available</div>
              )}
            </CardContent>
          </Card>

          {/* Revenue by Location */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue by Location</CardTitle>
              <CardDescription>Revenue breakdown by treatment location</CardDescription>
            </CardHeader>
            <CardContent>
              {revenueByLocationTherapist?.byLocation?.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={revenueByLocationTherapist.byLocation} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={(value) => `$${value / 1000}k`} />
                        <YAxis type="category" dataKey="location" width={120} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Bar dataKey="totalRevenue" fill="hsl(142, 71%, 45%)" name="Revenue" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Location</TableHead>
                          <TableHead className="text-right">Sessions</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {revenueByLocationTherapist.byLocation.map((loc: any, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{loc.location}</TableCell>
                            <TableCell className="text-right">{loc.sessionCount}</TableCell>
                            <TableCell className="text-right text-green-600">{formatCurrency(loc.totalRevenue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500">No location revenue data available</div>
              )}
            </CardContent>
          </Card>

          {/* Revenue by Therapist & Location Combined */}
          {revenueByLocationTherapist?.byTherapistAndLocation?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Revenue by Therapist & Location</CardTitle>
                <CardDescription>Detailed breakdown by therapist at each location</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Therapist</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueByLocationTherapist.byTherapistAndLocation.slice(0, 20).map((row: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{row.therapistName}</TableCell>
                        <TableCell>{row.location}</TableCell>
                        <TableCell className="text-right">{row.sessionCount}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.totalBilled)}</TableCell>
                        <TableCell className="text-right text-green-600">{formatCurrency(row.totalRevenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ==================== CLAIMS TAB ==================== */}
        <TabsContent value="claims" className="space-y-6">
          {/* Claims Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Submitted</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{cleanClaimsRate?.totalSubmitted || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Clean Claims</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{cleanClaimsRate?.acceptedFirstPass || 0}</div>
                <p className="text-xs text-muted-foreground">Accepted first submission</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Clean Claims Rate</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{cleanClaimsRate?.cleanClaimsRate?.toFixed(1) || 0}%</div>
                <p className="text-xs text-muted-foreground">Target: {cleanClaimsRate?.target || 97}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Denial Rate</CardTitle>
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{dashboardStats?.denialRate?.toFixed(1) || 0}%</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Claims by Status Pie */}
            <Card>
              <CardHeader>
                <CardTitle>Claims by Status</CardTitle>
                <CardDescription>Distribution of claim statuses</CardDescription>
              </CardHeader>
              <CardContent>
                {claimsByStatus && claimsByStatus.length > 0 ? (
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
                        {claimsByStatus.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={getStatusColor(entry.status)} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-slate-500">
                    No claims data available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rejection Reasons */}
            <Card>
              <CardHeader>
                <CardTitle>Top Rejection Reasons</CardTitle>
                <CardDescription>Most common reasons for claim rejections</CardDescription>
              </CardHeader>
              <CardContent>
                {cleanClaimsRate?.rejectionReasons?.length > 0 ? (
                  <div className="space-y-3">
                    {cleanClaimsRate.rejectionReasons.map((reason: any, index: number) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                            <span className="text-red-600 font-medium text-sm">{index + 1}</span>
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{reason.reason}</p>
                            <p className="text-sm text-slate-600">{reason.count} claims</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                    <p className="text-slate-600">No rejections - excellent!</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ==================== CAPACITY TAB ==================== */}
        <TabsContent value="capacity" className="space-y-6">
          {/* Capacity Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Slots</CardTitle>
                <CalendarX className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{capacityUtilization?.totalSlots || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Booked</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{capacityUtilization?.bookedSlots || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{capacityUtilization?.completedAppointments || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Arrived Rate</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{capacityUtilization?.arrivedRate?.toFixed(1) || 0}%</div>
                <p className="text-xs text-muted-foreground">Target: {capacityUtilization?.target || 90}%</p>
              </CardContent>
            </Card>
          </div>

          {/* Therapist Utilization */}
          <Card>
            <CardHeader>
              <CardTitle>Therapist Utilization</CardTitle>
              <CardDescription>Appointment completion rate by therapist</CardDescription>
            </CardHeader>
            <CardContent>
              {capacityUtilization?.byTherapist?.length > 0 ? (
                <div className="space-y-4">
                  {capacityUtilization.byTherapist.map((therapist: any, idx: number) => (
                    <div key={idx} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{therapist.name}</span>
                        <span className={therapist.utilization >= 90 ? 'text-green-600' : 'text-amber-600'}>
                          {therapist.utilization.toFixed(1)}%
                        </span>
                      </div>
                      <Progress value={therapist.utilization} className="h-2" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500">No therapist data available</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== AR AGING TAB ==================== */}
        <TabsContent value="ar-aging" className="space-y-6">
          {/* AR Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Days in A/R</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{arAging?.averageDays || 0} days</div>
                <p className="text-xs text-muted-foreground">
                  {(arAging?.averageDays || 0) <= 30 ? 'Healthy' : (arAging?.averageDays || 0) <= 45 ? 'Monitor' : 'Action needed'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Outstanding A/R</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(arAging?.byBucket?.reduce((sum: number, b: any) => sum + b.amount, 0) || 0)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Claims Outstanding</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {arAging?.byBucket?.reduce((sum: number, b: any) => sum + b.count, 0) || 0}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* AR Aging Buckets */}
          <Card>
            <CardHeader>
              <CardTitle>A/R Aging Buckets</CardTitle>
              <CardDescription>Claims and amounts by age</CardDescription>
            </CardHeader>
            <CardContent>
              {arAging?.byBucket?.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={arAging.byBucket}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" />
                    <YAxis yAxisId="left" orientation="left" tickFormatter={(value) => `$${value / 1000}k`} />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip formatter={(value: number, name: string) => [
                      name === 'amount' ? formatCurrency(value) : value,
                      name === 'amount' ? 'Amount' : 'Claims'
                    ]} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="amount" fill="hsl(207, 90%, 54%)" name="Amount" />
                    <Bar yAxisId="right" dataKey="count" fill="hsl(142, 71%, 45%)" name="Claims" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-8 text-slate-500">No A/R data available</div>
              )}
            </CardContent>
          </Card>

          {/* AR by Insurance */}
          <Card>
            <CardHeader>
              <CardTitle>A/R by Insurance</CardTitle>
              <CardDescription>Outstanding amounts and average days by payer</CardDescription>
            </CardHeader>
            <CardContent>
              {arAging?.byInsurance?.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Insurance</TableHead>
                      <TableHead className="text-right">Avg Days</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {arAging.byInsurance.map((ins: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{ins.name}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={ins.avgDays <= 30 ? "default" : ins.avgDays <= 45 ? "secondary" : "destructive"}>
                            {ins.avgDays} days
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(ins.outstanding)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-slate-500">No insurance A/R data available</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== REFERRALS TAB ==================== */}
        <TabsContent value="referrals" className="space-y-6">
          {/* Referrals Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Referrals</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{referrals?.totalReferrals || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Top Referrer Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(referrals?.sources?.[0]?.revenue || 0)}
                </div>
                <p className="text-xs text-muted-foreground">{referrals?.sources?.[0]?.name || 'N/A'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Referral Sources</CardTitle>
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{referrals?.sources?.length || 0}</div>
                <p className="text-xs text-muted-foreground">unique sources</p>
              </CardContent>
            </Card>
          </div>

          {/* Top Referring Providers */}
          <Card>
            <CardHeader>
              <CardTitle>Top Referring Providers</CardTitle>
              <CardDescription>Referral sources ranked by patient volume</CardDescription>
            </CardHeader>
            <CardContent>
              {referrals?.sources?.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Referrals</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Avg/Referral</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referrals.sources.map((source: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-blue-600 text-xs font-medium">{idx + 1}</span>
                            </div>
                            {source.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{source.referralCount}</TableCell>
                        <TableCell className="text-right text-green-600">{formatCurrency(source.revenue)}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(source.referralCount > 0 ? source.revenue / source.referralCount : 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-slate-500">No referral data available</div>
              )}
            </CardContent>
          </Card>

          {/* Referral Revenue Chart */}
          {referrals?.sources?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Referral Revenue Distribution</CardTitle>
                <CardDescription>Revenue by referral source</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={referrals.sources.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(value) => `$${value / 1000}k`} />
                    <YAxis type="category" dataKey="name" width={150} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="revenue" fill="hsl(207, 90%, 54%)" name="Revenue" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
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
                <div className="text-2xl font-bold">{(therapists || []).length}</div>
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

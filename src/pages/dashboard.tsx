import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import DashboardStats from "@/components/DashboardStats";
import { Plus, AlertCircle, CheckCircle, Clock, XCircle } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [practiceId] = useState(1); // Mock practice ID for now

  // Check if we have dev bypass
  const hasDevBypass = localStorage.getItem('dev-bypass') === 'true';
  const shouldAllowAccess = isAuthenticated || hasDevBypass;

  // Redirect to login if not authenticated and no dev bypass
  useEffect(() => {
    if (!isLoading && !shouldAllowAccess) {
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
  }, [shouldAllowAccess, isLoading, toast]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/analytics/dashboard'],
    enabled: shouldAllowAccess,
    retry: false,
  });

  const { data: recentClaims, isLoading: claimsLoading } = useQuery({
    queryKey: ['/api/claims'],
    enabled: shouldAllowAccess,
    retry: false,
  });

  const { data: recentPatients, isLoading: patientsLoading } = useQuery({
    queryKey: ['/api/patients'],
    enabled: shouldAllowAccess,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!shouldAllowAccess) {
    return null;
  }

  const getClaimStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-4 h-4 text-healthcare-green-500" />;
      case 'submitted':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'denied':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-slate-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'text-healthcare-green-500 bg-healthcare-green-50';
      case 'submitted':
        return 'text-yellow-600 bg-yellow-50';
      case 'denied':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-slate-600 bg-slate-50';
    }
  };

  return (
    <div className="p-6 md:ml-64">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          Welcome back, {user?.firstName || 'User'}!
        </h1>
        <p className="text-slate-600">
          Here's what's happening with your practice today.
        </p>
      </div>

      {/* Stats Overview */}
      {stats && <DashboardStats stats={stats} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        {/* Recent Claims */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Claims</CardTitle>
                <CardDescription>Latest billing activity</CardDescription>
              </div>
              <Link href="/claims">
                <Button size="sm">View All</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {claimsLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : recentClaims?.length ? (
              <div className="space-y-3">
                {recentClaims.slice(0, 5).map((claim: any) => (
                  <div key={claim.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                    <div className="flex items-center space-x-3">
                      {getClaimStatusIcon(claim.status)}
                      <div>
                        <p className="font-medium text-slate-900">{claim.claimNumber}</p>
                        <p className="text-sm text-slate-600">
                          ${claim.totalAmount} • {new Date(claim.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(claim.status)}`}>
                      {claim.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-500">No claims yet</p>
                <Link href="/claims">
                  <Button size="sm" className="mt-2">
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Claim
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Patients */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Patients</CardTitle>
                <CardDescription>Newly added patients</CardDescription>
              </div>
              <Link href="/patients">
                <Button size="sm">View All</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {patientsLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : recentPatients?.length ? (
              <div className="space-y-3">
                {recentPatients.slice(0, 5).map((patient: any) => (
                  <div key={patient.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                    <div>
                      <p className="font-medium text-slate-900">
                        {patient.firstName} {patient.lastName}
                      </p>
                      <p className="text-sm text-slate-600">
                        {patient.email} • {new Date(patient.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-slate-900">{patient.insuranceProvider}</p>
                      <p className="text-xs text-slate-600">{patient.insuranceId}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-500">No patients yet</p>
                <Link href="/patients">
                  <Button size="sm" className="mt-2">
                    <Plus className="w-4 h-4 mr-2" />
                    Add First Patient
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common tasks to get you started</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Link href="/patients">
              <Button variant="outline" className="w-full h-20 flex flex-col items-center justify-center space-y-2">
                <Plus className="w-6 h-6" />
                <span>Add Patient</span>
              </Button>
            </Link>
            <Link href="/claims">
              <Button variant="outline" className="w-full h-20 flex flex-col items-center justify-center space-y-2">
                <Plus className="w-6 h-6" />
                <span>Create Claim</span>
              </Button>
            </Link>
            <Link href="/expenses">
              <Button variant="outline" className="w-full h-20 flex flex-col items-center justify-center space-y-2">
                <Plus className="w-6 h-6" />
                <span>Add Expense</span>
              </Button>
            </Link>
            <Link href="/analytics">
              <Button variant="outline" className="w-full h-20 flex flex-col items-center justify-center space-y-2">
                <Plus className="w-6 h-6" />
                <span>View Reports</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

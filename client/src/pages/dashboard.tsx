import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import DashboardStats from "@/components/DashboardStats";
import PatientArAgingSummary from "@/components/PatientArAgingSummary";
import { Plus, AlertCircle, CheckCircle, Clock, XCircle, Ban, DollarSign, FileText, Users } from "lucide-react";
import { Link } from "wouter";
import { DashboardSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [practiceId] = useState(1); // Mock practice ID for now

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: t('dashboard.unauthorized'),
        description: t('dashboard.loggedOut'),
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast, t]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/analytics/dashboard'],
    enabled: isAuthenticated,
    retry: false,
  }) as any;

  const { data: recentClaims, isLoading: claimsLoading } = useQuery({
    queryKey: ['/api/claims'],
    enabled: isAuthenticated,
    retry: false,
  }) as any;

  const { data: recentPatients, isLoading: patientsLoading } = useQuery({
    queryKey: ['/api/patients'],
    enabled: isAuthenticated,
    retry: false,
  }) as any;

  const { data: deniedClaimsReport, isLoading: deniedLoading } = useQuery({
    queryKey: ['/api/reports/denied-claims', { period: 'today' }],
    enabled: isAuthenticated,
    retry: false,
  }) as any;

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (!isAuthenticated) {
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
    <div className="p-6 pt-20 md:pt-6 md:ml-64">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          {t('dashboard.welcomeBack', { name: user?.firstName || 'User' })}
        </h1>
        <p className="text-slate-600">
          {t('dashboard.practiceOverview')}
        </p>
      </div>

      {/* Stats Overview */}
      {stats && <DashboardStats stats={stats} />}

      {/* Denied Claims Alert */}
      {deniedClaimsReport && deniedClaimsReport.summary?.totalDenied > 0 && (
        <Card className="mt-6 border-red-200 bg-red-50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Ban className="w-5 h-5 text-red-600" />
                <CardTitle className="text-red-900">{t('dashboard.deniedClaimsToday')}</CardTitle>
              </div>
              <Link href="/reports">
                <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100">
                  {t('dashboard.viewFullReport')}
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center p-3 bg-white rounded-lg border border-red-100">
                <p className="text-2xl font-bold text-red-600">{deniedClaimsReport.summary.totalDenied}</p>
                <p className="text-xs text-slate-600">{t('dashboard.claimsDenied')}</p>
              </div>
              <div className="text-center p-3 bg-white rounded-lg border border-red-100">
                <p className="text-2xl font-bold text-red-600">
                  ${deniedClaimsReport.summary.totalAmountAtRisk?.toLocaleString() || '0'}
                </p>
                <p className="text-xs text-slate-600">{t('dashboard.amountAtRisk')}</p>
              </div>
              <div className="text-center p-3 bg-white rounded-lg border border-green-100">
                <p className="text-2xl font-bold text-green-600">{deniedClaimsReport.summary.appealsGenerated}</p>
                <p className="text-xs text-slate-600">{t('dashboard.appealsGenerated')}</p>
              </div>
              <div className="text-center p-3 bg-white rounded-lg border border-blue-100">
                <p className="text-2xl font-bold text-blue-600">{deniedClaimsReport.summary.appealsSent}</p>
                <p className="text-xs text-slate-600">{t('dashboard.appealsSent')}</p>
              </div>
            </div>

            {deniedClaimsReport.claims?.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-red-800 mb-2">{t('dashboard.todaysDeniedClaims')}</p>
                {deniedClaimsReport.claims.slice(0, 3).map((claim: any) => (
                  <div key={claim.id} className="flex items-center justify-between p-2 bg-white rounded border border-red-100">
                    <div className="flex items-center space-x-3">
                      <XCircle className="w-4 h-4 text-red-500" />
                      <div>
                        <p className="font-medium text-slate-900 text-sm">{claim.claimNumber}</p>
                        <p className="text-xs text-slate-600">{claim.patientName}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-red-600 text-sm">${claim.amount}</p>
                      <p className="text-xs text-slate-500">{claim.appealStatus === 'none' ? t('dashboard.noAppeal') : t('dashboard.appeal', { status: claim.appealStatus })}</p>
                    </div>
                  </div>
                ))}
                {deniedClaimsReport.claims.length > 3 && (
                  <p className="text-xs text-slate-500 text-center pt-1">
                    {t('dashboard.moreDeniedClaims', { count: deniedClaimsReport.claims.length - 3 })}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        {/* Recent Claims */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t('dashboard.recentClaims')}</CardTitle>
                <CardDescription>{t('dashboard.latestBilling')}</CardDescription>
              </div>
              <Link href="/claims">
                <Button size="sm">{t('common.viewAll')}</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {claimsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                    <div className="flex items-center space-x-3">
                      <Skeleton className="h-4 w-4 rounded-full" />
                      <div>
                        <Skeleton className="h-4 w-24 mb-1" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                ))}
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
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">{t('dashboard.noClaimsYet')}</h3>
                <p className="text-muted-foreground mb-6 max-w-md">
                  {t('dashboard.noClaimsDescription')}
                </p>
                <Link href="/claims">
                  <Button size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    {t('dashboard.createFirstClaim')}
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
                <CardTitle>{t('dashboard.recentPatients')}</CardTitle>
                <CardDescription>{t('dashboard.newlyAdded')}</CardDescription>
              </div>
              <Link href="/patients">
                <Button size="sm">{t('common.viewAll')}</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {patientsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                    <div>
                      <Skeleton className="h-4 w-32 mb-1" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                    <div className="text-right">
                      <Skeleton className="h-4 w-24 mb-1" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                ))}
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
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">{t('dashboard.welcomeGetStarted')}</h3>
                <p className="text-muted-foreground mb-6 max-w-md">
                  {t('dashboard.noPatientDescription')}
                </p>
                <Link href="/patients">
                  <Button size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    {t('dashboard.addFirstPatient')}
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Patient AR Aging Summary */}
      <div className="mt-6">
        <PatientArAgingSummary />
      </div>

      {/* Quick Actions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('dashboard.quickActions')}</CardTitle>
          <CardDescription>{t('dashboard.commonTasks')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Link href="/patients">
              <Button variant="outline" className="w-full h-20 flex flex-col items-center justify-center space-y-2">
                <Plus className="w-6 h-6" />
                <span>{t('dashboard.addPatient')}</span>
              </Button>
            </Link>
            <Link href="/claims">
              <Button variant="outline" className="w-full h-20 flex flex-col items-center justify-center space-y-2">
                <Plus className="w-6 h-6" />
                <span>{t('dashboard.createClaim')}</span>
              </Button>
            </Link>
            <Link href="/expenses">
              <Button variant="outline" className="w-full h-20 flex flex-col items-center justify-center space-y-2">
                <Plus className="w-6 h-6" />
                <span>{t('dashboard.addExpense')}</span>
              </Button>
            </Link>
            <Link href="/analytics">
              <Button variant="outline" className="w-full h-20 flex flex-col items-center justify-center space-y-2">
                <Plus className="w-6 h-6" />
                <span>{t('dashboard.viewReports')}</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

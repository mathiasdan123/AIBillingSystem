import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import DashboardStats from "@/components/DashboardStats";
import PatientArAgingSummary from "@/components/PatientArAgingSummary";
import AtRiskAuthorizationsWidget from "@/components/AtRiskAuthorizationsWidget";
import CredentialingDeadlinesWidget from "@/components/CredentialingDeadlinesWidget";
import PreSessionAuthCheckWidget from "@/components/PreSessionAuthCheckWidget";
import MissingPlanDocumentsWidget from "@/components/MissingPlanDocumentsWidget";
import { Plus, AlertCircle, CheckCircle, Clock, XCircle, Ban, DollarSign, FileText, Users, ArrowRight, Sparkles, Upload, BarChart3, Mail, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { DashboardSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [practiceId] = useState(user?.practiceId || 1);

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

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['/api/analytics/dashboard'],
    enabled: isAuthenticated,
  }) as any;

  const { data: recentClaims, isLoading: claimsLoading, isError: claimsError, refetch: refetchClaims } = useQuery({
    queryKey: ['/api/claims'],
    enabled: isAuthenticated,
  }) as any;

  const { data: recentPatients, isLoading: patientsLoading, isError: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['/api/patients'],
    enabled: isAuthenticated,
  }) as any;

  const { data: deniedClaimsReport, isLoading: deniedLoading, isError: deniedError, refetch: refetchDenied } = useQuery({
    queryKey: ['/api/reports/denied-claims', { period: 'today' }],
    enabled: isAuthenticated,
  }) as any;

  const { data: dailyInsights, isLoading: insightsLoading } = useQuery({
    queryKey: ['/api/analytics/reports/daily-insights'],
    enabled: isAuthenticated,
  }) as any;

  const emailInsightsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/analytics/reports/daily-insights/email');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Report Emailed', description: 'Daily insights report sent to practice admins.' });
    },
    onError: () => {
      toast({ title: 'Email Failed', description: 'Could not send report. Check SMTP settings.', variant: 'destructive' });
    },
  });

  const { data: onboardingStatus } = useQuery<{ step: number; completed: boolean }>({
    queryKey: ['/api/onboarding/status'],
    enabled: isAuthenticated,
  });

  const { data: onboardingChecklist } = useQuery<{ progress: number; completedRequired: number; totalRequired: number }>({
    queryKey: ['/api/onboarding/checklist'],
    enabled: isAuthenticated && onboardingStatus?.completed === false,
  });

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
        return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950';
      case 'submitted':
        return 'text-yellow-700 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-950';
      case 'denied':
        return 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-foreground mb-1 md:mb-2">
          {t('dashboard.welcomeBack', { name: user?.firstName || 'User' })}
        </h1>
        <p className="text-sm md:text-base text-muted-foreground">
          {t('dashboard.practiceOverview')}
        </p>
      </div>

      {/* Onboarding Banner */}
      {onboardingStatus && !onboardingStatus.completed && (
        <Card className="mb-6 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardContent className="py-4 px-4 md:px-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-blue-900">
                    {t('onboarding.bannerTitle')}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-24 bg-blue-200 rounded-full h-1.5">
                      <div
                        className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${onboardingChecklist?.progress ?? 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-blue-600">
                      {onboardingChecklist?.completedRequired ?? 0}/{onboardingChecklist?.totalRequired ?? 0} {t('onboarding.bannerComplete')}
                    </span>
                  </div>
                </div>
              </div>
              <Link href="/onboarding">
                <Button size="sm" className="gap-1 whitespace-nowrap bg-blue-600 hover:bg-blue-700">
                  {t('onboarding.continueSetup')} <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Overview */}
      {statsError ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground mb-2">Failed to load dashboard stats</p>
          <Button variant="outline" size="sm" onClick={() => refetchStats()}>
            Retry
          </Button>
        </div>
      ) : stats ? (
        <DashboardStats stats={stats} />
      ) : null}

      {/* Denied Claims Alert */}
      {deniedClaimsReport && deniedClaimsReport.summary?.totalDenied > 0 && (
        <Card className="mt-4 md:mt-6 border-red-200 bg-red-50">
          <CardHeader className="pb-3 px-4 md:px-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center space-x-2 min-w-0">
                <Ban className="w-5 h-5 text-red-600 flex-shrink-0" />
                <CardTitle className="text-red-900 text-sm md:text-base truncate">{t('dashboard.deniedClaimsToday')}</CardTitle>
              </div>
              <Link href="/reports">
                <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100 whitespace-nowrap text-xs md:text-sm">
                  {t('dashboard.viewFullReport')}
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 md:px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-4">
              <div className="text-center p-2 md:p-3 bg-card rounded-lg border border-red-100">
                <p className="text-xl md:text-2xl font-bold text-red-600">{deniedClaimsReport.summary.totalDenied}</p>
                <p className="text-[10px] md:text-xs text-muted-foreground">{t('dashboard.claimsDenied')}</p>
              </div>
              <div className="text-center p-2 md:p-3 bg-card rounded-lg border border-red-100">
                <p className="text-xl md:text-2xl font-bold text-red-600">
                  ${deniedClaimsReport.summary.totalAmountAtRisk?.toLocaleString() || '0'}
                </p>
                <p className="text-[10px] md:text-xs text-muted-foreground">{t('dashboard.amountAtRisk')}</p>
              </div>
              <div className="text-center p-2 md:p-3 bg-card rounded-lg border border-green-100">
                <p className="text-xl md:text-2xl font-bold text-green-600">{deniedClaimsReport.summary.appealsGenerated}</p>
                <p className="text-[10px] md:text-xs text-muted-foreground">{t('dashboard.appealsGenerated')}</p>
              </div>
              <div className="text-center p-2 md:p-3 bg-card rounded-lg border border-blue-100">
                <p className="text-xl md:text-2xl font-bold text-blue-600">{deniedClaimsReport.summary.appealsSent}</p>
                <p className="text-[10px] md:text-xs text-muted-foreground">{t('dashboard.appealsSent')}</p>
              </div>
            </div>

            {deniedClaimsReport.claims?.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-red-800 mb-2">{t('dashboard.todaysDeniedClaims')}</p>
                {deniedClaimsReport.claims.slice(0, 3).map((claim: any) => (
                  <div key={claim.id} className="flex items-center justify-between p-2 bg-white rounded border border-red-100">
                    <div className="flex items-center space-x-2 md:space-x-3 min-w-0">
                      <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground text-xs md:text-sm truncate">{claim.claimNumber}</p>
                        <p className="text-[10px] md:text-xs text-muted-foreground truncate">{claim.patientName}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="font-medium text-red-600 text-xs md:text-sm">${claim.amount}</p>
                      <p className="text-[10px] md:text-xs text-muted-foreground">{claim.appealStatus === 'none' ? t('dashboard.noAppeal') : t('dashboard.appeal', { status: claim.appealStatus })}</p>
                    </div>
                  </div>
                ))}
                {deniedClaimsReport.claims.length > 3 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    {t('dashboard.moreDeniedClaims', { count: deniedClaimsReport.claims.length - 3 })}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Daily Insights Widget */}
      {dailyInsights && (
        <Card className="mt-4 md:mt-6 border-blue-100 dark:border-blue-900">
          <CardHeader className="pb-3 px-4 md:px-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center space-x-2 min-w-0">
                <TrendingUp className="w-5 h-5 text-blue-600 flex-shrink-0" />
                <CardTitle className="text-sm md:text-base">Daily Insights</CardTitle>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7 px-2"
                  onClick={() => emailInsightsMutation.mutate()}
                  disabled={emailInsightsMutation.isPending}
                >
                  <Mail className="w-3.5 h-3.5 mr-1" />
                  {emailInsightsMutation.isPending ? 'Sending...' : 'Email'}
                </Button>
                <Link href="/insights-report">
                  <Button size="sm" variant="outline" className="text-xs h-7 px-2">
                    View Full Report
                  </Button>
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 md:px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="text-center p-2.5 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-100 dark:border-blue-900">
                <p className="text-lg md:text-xl font-bold text-blue-700 dark:text-blue-400">{dailyInsights.claimsSummary?.newToday || 0}</p>
                <p className="text-[10px] md:text-xs text-muted-foreground">Claims Today</p>
              </div>
              <div className="text-center p-2.5 bg-green-50 dark:bg-green-950 rounded-lg border border-green-100 dark:border-green-900">
                <p className="text-lg md:text-xl font-bold text-green-700 dark:text-green-400">
                  ${(dailyInsights.revenueCollectedToday || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-[10px] md:text-xs text-muted-foreground">Revenue</p>
              </div>
              <div className="text-center p-2.5 bg-purple-50 dark:bg-purple-950 rounded-lg border border-purple-100 dark:border-purple-900">
                <p className="text-lg md:text-xl font-bold text-purple-700 dark:text-purple-400">{dailyInsights.patientVolume?.completed || 0}</p>
                <p className="text-[10px] md:text-xs text-muted-foreground">Completed Appts</p>
              </div>
              <div className="text-center p-2.5 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-100 dark:border-amber-900">
                <p className={`text-lg md:text-xl font-bold ${(dailyInsights.denialRateTrailing7Day || 0) > 10 ? 'text-red-600' : 'text-amber-700 dark:text-amber-400'}`}>
                  {dailyInsights.denialRateTrailing7Day || 0}%
                </p>
                <p className="text-[10px] md:text-xs text-muted-foreground">7-Day Denial Rate</p>
              </div>
            </div>

            {/* Top 3 Action Items */}
            {dailyInsights.actionItems && dailyInsights.actionItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Top Action Items</p>
                {dailyInsights.actionItems.slice(0, 3).map((item: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded bg-muted/50 text-sm">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 mt-0.5 ${
                      item.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                      item.priority === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                      'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                    }`}>
                      {item.priority.toUpperCase()}
                    </span>
                    <span className="text-xs text-muted-foreground">{item.description}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mt-6 md:mt-8">
        {/* Recent Claims */}
        <Card>
          <CardHeader className="px-4 md:px-6">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base md:text-lg">{t('dashboard.recentClaims')}</CardTitle>
                <CardDescription className="text-xs md:text-sm">{t('dashboard.latestBilling')}</CardDescription>
              </div>
              <Link href="/claims">
                <Button size="sm" className="text-xs md:text-sm">{t('common.viewAll')}</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 md:px-6">
            {claimsError ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground mb-2">Failed to load claims</p>
                <Button variant="outline" size="sm" onClick={() => refetchClaims()}>
                  Retry
                </Button>
              </div>
            ) : claimsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
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
              <div className="space-y-2 md:space-y-3">
                {recentClaims.slice(0, 5).map((claim: any) => (
                  <div key={claim.id} className="flex items-center justify-between p-2.5 md:p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center space-x-2 md:space-x-3 min-w-0">
                      {getClaimStatusIcon(claim.status)}
                      <div className="min-w-0">
                        <p className="font-medium text-foreground text-sm truncate">{claim.claimNumber}</p>
                        <p className="text-xs md:text-sm text-muted-foreground truncate">
                          ${claim.totalAmount} • {new Date(claim.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-[10px] md:text-xs font-medium flex-shrink-0 ${getStatusColor(claim.status)}`}>
                      {claim.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 md:py-12 text-center">
                <FileText className="h-10 w-10 md:h-12 md:w-12 text-muted-foreground mb-3 md:mb-4" />
                <h3 className="text-base md:text-lg font-semibold mb-2">{t('dashboard.noClaimsYet')}</h3>
                <p className="text-muted-foreground mb-4 md:mb-6 max-w-md text-sm">
                  {t('dashboard.noClaimsDescription')}
                </p>
                <Link href="/claims">
                  <Button size="sm" className="w-full sm:w-auto">
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
          <CardHeader className="px-4 md:px-6">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base md:text-lg">{t('dashboard.recentPatients')}</CardTitle>
                <CardDescription className="text-xs md:text-sm">{t('dashboard.newlyAdded')}</CardDescription>
              </div>
              <Link href="/patients">
                <Button size="sm" className="text-xs md:text-sm">{t('common.viewAll')}</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 md:px-6">
            {patientsError ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground mb-2">Failed to load patients</p>
                <Button variant="outline" size="sm" onClick={() => refetchPatients()}>
                  Retry
                </Button>
              </div>
            ) : patientsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
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
              <div className="space-y-2 md:space-y-3">
                {recentPatients.slice(0, 5).map((patient: any) => (
                  <div key={patient.id} className="flex items-center justify-between p-2.5 md:p-3 rounded-lg bg-muted/50 gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground text-sm truncate">
                        {patient.firstName} {patient.lastName}
                      </p>
                      <p className="text-xs md:text-sm text-muted-foreground truncate">
                        {patient.email} • {new Date(patient.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs md:text-sm font-medium text-foreground truncate max-w-[120px]">{patient.insuranceProvider}</p>
                      <p className="text-[10px] md:text-xs text-muted-foreground truncate max-w-[120px]">{patient.insuranceId}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 md:py-12 text-center">
                <Users className="h-10 w-10 md:h-12 md:w-12 text-muted-foreground mb-3 md:mb-4" />
                <h3 className="text-base md:text-lg font-semibold mb-2">{t('dashboard.welcomeGetStarted')}</h3>
                <p className="text-muted-foreground mb-4 md:mb-6 max-w-md text-sm">
                  {t('dashboard.noPatientDescription')}
                </p>
                <Link href="/patients">
                  <Button size="sm" className="w-full sm:w-auto">
                    <Plus className="w-4 h-4 mr-2" />
                    {t('dashboard.addFirstPatient')}
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Patient AR Aging + Auths at Risk + Credentialing Deadlines + Sessions Needing Auth + Missing Plan Docs */}
      <div className="mt-4 md:mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PatientArAgingSummary />
        <PreSessionAuthCheckWidget />
        <AtRiskAuthorizationsWidget />
        <CredentialingDeadlinesWidget />
        <MissingPlanDocumentsWidget practiceId={practiceId} />
      </div>

      {/* Data Import CTA - Prominent for new practices */}
      {recentPatients && Array.isArray(recentPatients) && recentPatients.length < 10 && (
        <Card className="mt-4 md:mt-6 border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50">
          <CardContent className="py-5 px-4 md:px-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Upload className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-indigo-900">
                    Switching from another platform?
                  </h3>
                  <p className="text-sm text-indigo-700 mt-0.5">
                    Import your patients from SimplePractice, TherapyNotes, Jane App, or WebPT in minutes.
                  </p>
                </div>
              </div>
              <Link href="/data-import">
                <Button className="gap-1 whitespace-nowrap bg-indigo-600 hover:bg-indigo-700">
                  Import Patients <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <Card className="mt-4 md:mt-6">
        <CardHeader className="px-4 md:px-6">
          <CardTitle className="text-base md:text-lg">{t('dashboard.quickActions')}</CardTitle>
          <CardDescription className="text-xs md:text-sm">{t('dashboard.commonTasks')}</CardDescription>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <Link href="/patients">
              <Button variant="outline" className="w-full h-16 md:h-20 flex flex-col items-center justify-center space-y-1 md:space-y-2 text-xs md:text-sm">
                <Plus className="w-5 h-5 md:w-6 md:h-6" />
                <span>{t('dashboard.addPatient')}</span>
              </Button>
            </Link>
            <Link href="/claims">
              <Button variant="outline" className="w-full h-16 md:h-20 flex flex-col items-center justify-center space-y-1 md:space-y-2 text-xs md:text-sm">
                <Plus className="w-5 h-5 md:w-6 md:h-6" />
                <span>{t('dashboard.createClaim')}</span>
              </Button>
            </Link>
            <Link href="/expenses">
              <Button variant="outline" className="w-full h-16 md:h-20 flex flex-col items-center justify-center space-y-1 md:space-y-2 text-xs md:text-sm">
                <Plus className="w-5 h-5 md:w-6 md:h-6" />
                <span>{t('dashboard.addExpense')}</span>
              </Button>
            </Link>
            <Link href="/analytics">
              <Button variant="outline" className="w-full h-16 md:h-20 flex flex-col items-center justify-center space-y-1 md:space-y-2 text-xs md:text-sm">
                <Plus className="w-5 h-5 md:w-6 md:h-6" />
                <span>{t('dashboard.viewReports')}</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

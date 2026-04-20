import * as Sentry from "@sentry/react";
import { Switch, Route } from "wouter";
import { Suspense, lazy, Component, useEffect } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import SimpleNavigation from "@/components/SimpleNavigation";
import { CommandPalette } from "@/components/CommandPalette";
import IdleTimeoutWarning from "@/components/IdleTimeoutWarning";
import NotFound from "@/pages/not-found";
import AiBillingAssistant from "@/components/AiBillingAssistant";

// Keep frequently used pages in the main bundle
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Patients from "@/pages/patients";
import Calendar from "@/pages/calendar";

// Lazy load less frequently accessed pages for code-splitting
const Analytics = lazy(() => import("@/pages/analytics"));
const Accounting = lazy(() => import("@/pages/accounting"));
const Claims = lazy(() => import("@/pages/claims"));
const Appeals = lazy(() => import("@/pages/appeals"));
const Reports = lazy(() => import("@/pages/reports"));
const Expenses = lazy(() => import("@/pages/expenses"));
const Settings = lazy(() => import("@/pages/settings"));
const DataUpload = lazy(() => import("@/pages/data-upload"));
const PatientIntake = lazy(() => import("@/pages/intake"));
const SoapNotes = lazy(() => import("@/pages/soap-notes"));
const InvitePage = lazy(() => import("@/pages/invite"));
const PayerManagement = lazy(() => import("@/pages/payer-management"));
const BreachIncidents = lazy(() => import("@/pages/breach-incidents"));
const ComplianceDashboard = lazy(() => import("@/pages/compliance"));
const HipaaCompliance = lazy(() => import("@/pages/hipaa-compliance"));
const Waitlist = lazy(() => import("@/pages/waitlist"));
const FrontDesk = lazy(() => import("@/pages/front-desk"));
const Reviews = lazy(() => import("@/pages/reviews"));
const PublicBooking = lazy(() => import("@/pages/public-booking"));
const BookingSettings = lazy(() => import("@/pages/booking-settings"));
const Telehealth = lazy(() => import("@/pages/telehealth"));
const TelehealthJoin = lazy(() => import("@/pages/telehealth-join"));
const Messages = lazy(() => import("@/pages/messages"));
const PatientPortal = lazy(() => import("@/pages/patient-portal/index"));
const MfaChallenge = lazy(() => import("@/pages/mfa-challenge"));
const OutcomeMeasures = lazy(() => import("@/pages/outcome-measures"));
const PublicFeedback = lazy(() => import("@/pages/public-feedback"));
const SessionRecorder = lazy(() => import("@/pages/session-recorder"));
const InsuranceRates = lazy(() => import("@/pages/insurance-rates"));
const Billing = lazy(() => import("@/pages/billing"));
const Reimbursement = lazy(() => import("@/pages/reimbursement"));
const PayerContracts = lazy(() => import("@/pages/payer-contracts"));
const RemittancePage = lazy(() => import("@/pages/remittance"));
const TreatmentPlans = lazy(() => import("@/pages/treatment-plans"));
const AiInsights = lazy(() => import("@/pages/ai-insights"));
const TherapistProductivity = lazy(() => import("@/pages/therapist-productivity"));
const Onboarding = lazy(() => import("@/pages/onboarding"));
const Surveys = lazy(() => import("@/pages/surveys"));
const SchedulingInsights = lazy(() => import("@/pages/scheduling-insights"));
const NotificationSettings = lazy(() => import("@/pages/notification-settings"));
const BillingTasks = lazy(() => import("@/pages/billing-tasks"));
const Benchmarking = lazy(() => import("@/pages/benchmarking"));
const DailyReport = lazy(() => import("@/pages/daily-report"));
const InsightsReport = lazy(() => import("@/pages/insights-report"));
const BillingGuide = lazy(() => import("@/pages/billing-guide"));
const Credentialing = lazy(() => import("@/pages/credentialing"));

// Auth pages
const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
const ResetPassword = lazy(() => import("@/pages/reset-password"));
const VerifyEmail = lazy(() => import("@/pages/verify-email"));

// SSO settings (admin only)
const SsoSettings = lazy(() => import("@/pages/sso-settings"));

// Locations management
const Locations = lazy(() => import("@/pages/locations"));

// Data export (admin only)
const DataExport = lazy(() => import("@/pages/data-export"));

// Data import (admin only)
const DataImport = lazy(() => import("@/pages/data-import"));

// MCP setup guide
const McpSetup = lazy(() => import("@/pages/mcp-setup"));

// Self-service signup
const Signup = lazy(() => import("@/pages/signup"));

// Public pricing page
const Pricing = lazy(() => import("@/pages/pricing"));

// Legal pages
const PrivacyPolicy = lazy(() => import("@/pages/privacy-policy"));
const TermsOfService = lazy(() => import("@/pages/terms-of-service"));

// Error boundary for route-level errors
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    // Report to Sentry if initialized (no-ops if DSN was not configured)
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack || undefined,
        },
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-center p-6" role="alert">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-slate-600 mb-4">An unexpected error occurred. Please try refreshing the page.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Loading fallback component
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

function Router() {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <main id="main-content">
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Switch>
              <Route path="/" component={Landing} />
              <Route path="/signup" component={Signup} />
              <Route path="/pricing" component={Pricing} />
              <Route path="/privacy" component={PrivacyPolicy} />
              <Route path="/terms" component={TermsOfService} />
              <Route path="/intake" component={PatientIntake} />
              <Route path="/invite/:token" component={InvitePage} />
              <Route path="/mfa-challenge" component={MfaChallenge} />
              <Route path="/book/:slug" component={PublicBooking} />
              <Route path="/join/:code" component={TelehealthJoin} />
              <Route path="/portal" component={PatientPortal} />
              <Route path="/portal/login/:token" component={PatientPortal} />
              <Route path="/patient-portal" component={PatientPortal} />
              <Route path="/patient-portal/login" component={PatientPortal} />
              <Route path="/patient-portal/login/:token" component={PatientPortal} />
              <Route path="/feedback/:token" component={PublicFeedback} />
              <Route path="/forgot-password" component={ForgotPassword} />
              <Route path="/reset-password/:token" component={ResetPassword} />
              <Route path="/verify-email/:token" component={VerifyEmail} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </ErrorBoundary>
      </main>
    );
  }

  return (
    <>
      <SimpleNavigation />
      <CommandPalette />
      <IdleTimeoutWarning />
      <main id="main-content">
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/claims" component={Claims} />
              <Route path="/appeals" component={Appeals} />
              <Route path="/billing-tasks" component={BillingTasks} />
              <Route path="/waitlist" component={Waitlist} />
              <Route path="/front-desk" component={FrontDesk} />
              <Route path="/reviews" component={Reviews} />
              <Route path="/online-booking" component={BookingSettings} />
              <Route path="/telehealth" component={Telehealth} />
              <Route path="/messages" component={Messages} />
              <Route path="/join/:code" component={TelehealthJoin} />
              <Route path="/book/:slug" component={PublicBooking} />
              <Route path="/patients" component={Patients} />
              <Route path="/intake" component={PatientIntake} />
              <Route path="/calendar" component={Calendar} />
              <Route path="/scheduling-insights" component={SchedulingInsights} />
              <Route path="/soap-notes" component={SoapNotes} />
              <Route path="/session-recorder" component={SessionRecorder} />
              <Route path="/outcome-measures" component={OutcomeMeasures} />
              <Route path="/surveys" component={Surveys} />
              <Route path="/treatment-plans" component={TreatmentPlans} />
              {isAdmin && <Route path="/accounting" component={Accounting} />}
              {isAdmin && <Route path="/analytics" component={Analytics} />}
              {isAdmin && <Route path="/benchmarking" component={Benchmarking} />}
              <Route path="/reports" component={Reports} />
              <Route path="/expenses" component={Expenses} />
              <Route path="/settings" component={Settings} />
              <Route path="/data-upload" component={DataUpload} />
              <Route path="/payer-management" component={PayerManagement} />
              <Route path="/insurance-rates" component={InsuranceRates} />
              <Route path="/reimbursement" component={Reimbursement} />
              <Route path="/remittance" component={RemittancePage} />
              <Route path="/payer-contracts" component={PayerContracts} />
              <Route path="/ai-insights" component={AiInsights} />
              <Route path="/therapist-productivity" component={TherapistProductivity} />
              <Route path="/subscription" component={Billing} />
              {isAdmin && <Route path="/breach-incidents" component={BreachIncidents} />}
              {isAdmin && <Route path="/compliance" component={ComplianceDashboard} />}
              {isAdmin && <Route path="/hipaa-compliance" component={HipaaCompliance} />}
              {isAdmin && <Route path="/sso-settings" component={SsoSettings} />}
              {isAdmin && <Route path="/data-export" component={DataExport} />}
              {isAdmin && <Route path="/data-import" component={DataImport} />}
              {isAdmin && <Route path="/daily-report" component={DailyReport} />}
              <Route path="/insights-report" component={InsightsReport} />
              {isAdmin && <Route path="/credentialing" component={Credentialing} />}
              <Route path="/notification-settings" component={NotificationSettings} />
              <Route path="/mcp-setup" component={McpSetup} />
              <Route path="/onboarding" component={Onboarding} />
              <Route path="/billing-guide" component={BillingGuide} />
              <Route path="/locations" component={Locations} />
              <Route path="/invite/:token" component={InvitePage} />
              <Route path="/mfa-challenge" component={MfaChallenge} />
              <Route path="/feedback/:token" component={PublicFeedback} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </ErrorBoundary>
      </main>
    </>
  );
}

/** Listens for auth-error events from QueryCache and shows a toast */
function AuthErrorListener() {
  const { toast } = useToast();
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      toast({
        title: 'Session expired',
        description: detail?.message || 'Please log in again',
        variant: 'destructive',
      });
      setTimeout(() => {
        window.location.href = '/api/login';
      }, 1500);
    };
    window.addEventListener('auth-error', handler);
    return () => window.removeEventListener('auth-error', handler);
  }, [toast]);
  return null;
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <AuthErrorListener />
          <Router />
          <AiBillingAssistant />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;

import { Switch, Route } from "wouter";
import { Suspense, lazy } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import SimpleNavigation from "@/components/SimpleNavigation";
import IdleTimeoutWarning from "@/components/IdleTimeoutWarning";
import NotFound from "@/pages/not-found";

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
const Waitlist = lazy(() => import("@/pages/waitlist"));
const Reviews = lazy(() => import("@/pages/reviews"));
const PublicBooking = lazy(() => import("@/pages/public-booking"));
const BookingSettings = lazy(() => import("@/pages/booking-settings"));
const Telehealth = lazy(() => import("@/pages/telehealth"));
const TelehealthJoin = lazy(() => import("@/pages/telehealth-join"));
const Messages = lazy(() => import("@/pages/messages"));
const PatientPortal = lazy(() => import("@/pages/patient-portal"));
const NewPatientPortal = lazy(() => import("@/pages/patient-portal/index"));
const MfaChallenge = lazy(() => import("@/pages/mfa-challenge"));
const OutcomeMeasures = lazy(() => import("@/pages/outcome-measures"));
const PublicFeedback = lazy(() => import("@/pages/public-feedback"));
const SessionRecorder = lazy(() => import("@/pages/session-recorder"));
const InsuranceRates = lazy(() => import("@/pages/insurance-rates"));
const Billing = lazy(() => import("@/pages/billing"));
const Reimbursement = lazy(() => import("@/pages/reimbursement"));

// Auth pages
const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
const ResetPassword = lazy(() => import("@/pages/reset-password"));
const VerifyEmail = lazy(() => import("@/pages/verify-email"));

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
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/intake" component={PatientIntake} />
          <Route path="/invite/:token" component={InvitePage} />
          <Route path="/mfa-challenge" component={MfaChallenge} />
          <Route path="/book/:slug" component={PublicBooking} />
          <Route path="/join/:code" component={TelehealthJoin} />
          <Route path="/portal" component={PatientPortal} />
          <Route path="/portal/login/:token" component={PatientPortal} />
          <Route path="/patient-portal" component={NewPatientPortal} />
          <Route path="/patient-portal/login" component={NewPatientPortal} />
          <Route path="/patient-portal/login/:token" component={NewPatientPortal} />
          <Route path="/feedback/:token" component={PublicFeedback} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/reset-password/:token" component={ResetPassword} />
          <Route path="/verify-email/:token" component={VerifyEmail} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <>
      <SimpleNavigation />
      <IdleTimeoutWarning />
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/claims" component={Claims} />
          <Route path="/appeals" component={Appeals} />
          <Route path="/waitlist" component={Waitlist} />
          <Route path="/reviews" component={Reviews} />
          <Route path="/online-booking" component={BookingSettings} />
          <Route path="/telehealth" component={Telehealth} />
          <Route path="/messages" component={Messages} />
          <Route path="/join/:code" component={TelehealthJoin} />
          <Route path="/book/:slug" component={PublicBooking} />
          <Route path="/patients" component={Patients} />
          <Route path="/intake" component={PatientIntake} />
          <Route path="/calendar" component={Calendar} />
          <Route path="/soap-notes" component={SoapNotes} />
          <Route path="/session-recorder" component={SessionRecorder} />
          <Route path="/outcome-measures" component={OutcomeMeasures} />
          {isAdmin && <Route path="/accounting" component={Accounting} />}
          {isAdmin && <Route path="/analytics" component={Analytics} />}
          <Route path="/reports" component={Reports} />
          <Route path="/expenses" component={Expenses} />
          <Route path="/settings" component={Settings} />
          <Route path="/data-upload" component={DataUpload} />
          <Route path="/payer-management" component={PayerManagement} />
          <Route path="/insurance-rates" component={InsuranceRates} />
          <Route path="/reimbursement" component={Reimbursement} />
          <Route path="/subscription" component={Billing} />
          {isAdmin && <Route path="/breach-incidents" component={BreachIncidents} />}
          <Route path="/invite/:token" component={InvitePage} />
          <Route path="/mfa-challenge" component={MfaChallenge} />
          <Route path="/feedback/:token" component={PublicFeedback} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

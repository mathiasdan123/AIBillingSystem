import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import SimpleNavigation from "@/components/SimpleNavigation";
import Landing from "@/pages/landing";
import SimpleLanding from "@/pages/simple-landing";
import DirectLanding from "@/pages/direct-landing";
import DebugLanding from "@/pages/debug-landing";
import ButtonTest from "@/pages/button-test";
import DataUpload from "@/pages/data-upload";
import Dashboard from "@/pages/dashboard";
import Claims from "@/pages/claims";
import Patients from "@/pages/patients";
import PatientAuthorizePage from "@/pages/patient-authorize";
import Analytics from "@/pages/analytics";
import Expenses from "@/pages/expenses";
import Settings from "@/pages/settings";
import PatientIntake from "@/pages/intake";
import SoapNotes from "@/pages/soap-notes";
import CalendarPage from "@/pages/calendar";
import AccountingPage from "@/pages/accounting";
import DebugData from "@/pages/debug-data";
import SimpleTest from "@/pages/simple-test";
import SimplePatients from "@/pages/simple-patients";
import WorkingDashboard from "@/pages/working-dashboard";
import NotFound from "@/pages/not-found";

function Router() {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Check if we have dev bypass - only enable when explicitly set
  const hasDevBypass = localStorage.getItem('dev-bypass') === 'true';
  
  // For preview screen access, check if we're in a development environment
  // and no explicit bypass has been set to false
  const isDevEnvironment = import.meta.env.DEV;
  const hasExplicitBypassDisable = localStorage.getItem('dev-bypass') === 'false';
  
  // Show authenticated content if:
  // 1. User is actually authenticated, OR
  // 2. Dev bypass is explicitly enabled, OR  
  // 3. We're in dev environment AND bypass hasn't been explicitly disabled
  const shouldShowAuthenticatedContent = isAuthenticated || hasDevBypass || (isDevEnvironment && !hasExplicitBypassDisable);

  if (!shouldShowAuthenticatedContent) {
    return (
      <Switch>
        <Route path="/authorize/:token" component={PatientAuthorizePage} />
        <Route path="/" component={DebugLanding} />
        <Route path="/direct" component={DirectLanding} />
        <Route path="/simple" component={SimpleLanding} />
        <Route path="/original" component={Landing} />
        <Route path="/test-buttons" component={ButtonTest} />
        <Route path="/intake" component={PatientIntake} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  return (
    <>
      <SimpleNavigation />
      <Switch>
        <Route path="/authorize/:token" component={PatientAuthorizePage} />
        <Route path="/" component={WorkingDashboard} />
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/claims" component={Claims} />
        <Route path="/patients" component={SimplePatients} />
        <Route path="/intake" component={PatientIntake} />
        <Route path="/soap-notes" component={SoapNotes} />
        {isAdmin && <Route path="/accounting" component={AccountingPage} />}
        {isAdmin && <Route path="/analytics" component={Analytics} />}
        <Route path="/expenses" component={Expenses} />
        <Route path="/settings" component={Settings} />
        <Route path="/debug" component={DebugData} />
        <Route path="/data-upload" component={DataUpload} />
        <Route component={NotFound} />
      </Switch>
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

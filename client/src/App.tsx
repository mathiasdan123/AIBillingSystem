import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import SimpleNavigation from "@/components/SimpleNavigation";
import Landing from "@/pages/landing";
import DataUpload from "@/pages/data-upload";
import Dashboard from "@/pages/dashboard";
import Claims from "@/pages/claims";
import Patients from "@/pages/patients";
import PatientAuthorizePage from "@/pages/patient-authorize";
import Analytics from "@/pages/analytics";
import Reports from "@/pages/reports";
import Expenses from "@/pages/expenses";
import Settings from "@/pages/settings";
import PatientIntake from "@/pages/intake";
import SoapNotes from "@/pages/soap-notes";
import Calendar from "@/pages/calendar";
import Accounting from "@/pages/accounting";
import InvitePage from "@/pages/invite";
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

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/intake" component={PatientIntake} />
        <Route path="/invite/:token" component={InvitePage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  return (
    <>
      <SimpleNavigation />
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/claims" component={Claims} />
        <Route path="/patients" component={Patients} />
        <Route path="/intake" component={PatientIntake} />
        <Route path="/calendar" component={Calendar} />
        <Route path="/soap-notes" component={SoapNotes} />
        {isAdmin && <Route path="/accounting" component={Accounting} />}
        {isAdmin && <Route path="/analytics" component={Analytics} />}
        <Route path="/reports" component={Reports} />
        <Route path="/expenses" component={Expenses} />
        <Route path="/settings" component={Settings} />
        <Route path="/data-upload" component={DataUpload} />
        <Route path="/invite/:token" component={InvitePage} />
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

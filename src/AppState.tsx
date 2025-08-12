import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import StateNavigation from "@/components/StateNavigation";
import Landing from "@/pages/landing";
import Claims from "@/pages/claims";
import Analytics from "@/pages/analytics";
import Expenses from "@/pages/expenses";
import Settings from "@/pages/settings";
import PatientIntake from "@/pages/intake";
import SoapNotes from "@/pages/soap-notes";
import SimplePatients from "@/pages/simple-patients";
import WorkingDashboard from "@/pages/working-dashboard";

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const [currentPage, setCurrentPage] = useState('dashboard');

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <WorkingDashboard />;
      case 'patients':
        return <SimplePatients />;
      case 'intake':
        return <PatientIntake />;
      case 'soap-notes':
        return <SoapNotes />;
      case 'claims':
        return <Claims />;
      case 'analytics':
        return <Analytics />;
      case 'expenses':
        return <Expenses />;
      case 'settings':
        return <Settings />;
      default:
        return <WorkingDashboard />;
    }
  };

  if (isLoading || !isAuthenticated) {
    return <Landing />;
  }

  return (
    <>
      <StateNavigation 
        currentPage={currentPage} 
        onPageChange={setCurrentPage} 
      />
      <main>
        {renderPage()}
      </main>
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
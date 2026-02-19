import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Home,
  Calendar,
  User,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import PatientPortalLogin from "./PatientPortalLogin";
import PatientPortalDashboard from "./PatientPortalDashboard";
import PatientPortalProfile from "./PatientPortalProfile";
import PatientPortalAppointments from "./PatientPortalAppointments";

export default function PatientPortalPage() {
  const params = useParams<{ token?: string; tab?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Get token from localStorage
  const [portalToken, setPortalToken] = useState<string | null>(() => {
    return localStorage.getItem("patientPortalToken");
  });

  const [activeTab, setActiveTab] = useState(params.tab || "dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Handle login success
  const handleLoginSuccess = (token: string) => {
    setPortalToken(token);
    localStorage.setItem("patientPortalToken", token);
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem("patientPortalToken");
    setPortalToken(null);
    setLocation("/patient-portal");
    toast({
      title: "Logged Out",
      description: "You have been successfully logged out.",
    });
  };

  // Handle navigation
  const handleNavigate = (tab: string) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  // If no token and not on login path, show login
  if (!portalToken) {
    return <PatientPortalLogin onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <Home className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Patient Portal</h1>
              <p className="text-sm text-muted-foreground hidden sm:block">
                Manage your appointments and profile
              </p>
            </div>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-4">
            <nav className="flex items-center gap-1">
              <Button
                variant={activeTab === "dashboard" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleNavigate("dashboard")}
              >
                <Home className="h-4 w-4 mr-2" />
                Dashboard
              </Button>
              <Button
                variant={activeTab === "appointments" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleNavigate("appointments")}
              >
                <Calendar className="h-4 w-4 mr-2" />
                Appointments
              </Button>
              <Button
                variant={activeTab === "profile" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleNavigate("profile")}
              >
                <User className="h-4 w-4 mr-2" />
                Profile
              </Button>
            </nav>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t bg-white py-2 px-4">
            <nav className="flex flex-col gap-1">
              <Button
                variant={activeTab === "dashboard" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => handleNavigate("dashboard")}
              >
                <Home className="h-4 w-4 mr-2" />
                Dashboard
              </Button>
              <Button
                variant={activeTab === "appointments" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => handleNavigate("appointments")}
              >
                <Calendar className="h-4 w-4 mr-2" />
                Appointments
              </Button>
              <Button
                variant={activeTab === "profile" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => handleNavigate("profile")}
              >
                <User className="h-4 w-4 mr-2" />
                Profile
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start mt-2"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {activeTab === "dashboard" && (
          <PatientPortalDashboard token={portalToken} onNavigate={handleNavigate} />
        )}
        {activeTab === "appointments" && (
          <PatientPortalAppointments token={portalToken} />
        )}
        {activeTab === "profile" && (
          <PatientPortalProfile token={portalToken} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-white mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>Your health information is protected and secure.</p>
          <p className="mt-1">Need help? Contact your healthcare provider.</p>
        </div>
      </footer>
    </div>
  );
}

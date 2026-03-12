import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
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
  FileText,
} from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PatientPortalLogin from "./PatientPortalLogin";
import PatientPortalDashboard from "./PatientPortalDashboard";
import PatientPortalProfile from "./PatientPortalProfile";
import PatientPortalAppointments from "./PatientPortalAppointments";
import PatientPortalProgressNotes from "./PatientPortalProgressNotes";

export default function PatientPortalPage() {
  const params = useParams<{ token?: string; tab?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();

  // Get token from localStorage or URL query param (for demo QR code)
  const [portalToken, setPortalToken] = useState<string | null>(() => {
    // Check URL query params first (for QR code demo login)
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
      // Store in localStorage and clean up URL
      localStorage.setItem("patientPortalToken", tokenFromUrl);
      // Remove token from URL without page reload
      window.history.replaceState({}, '', window.location.pathname);
      return tokenFromUrl;
    }
    return localStorage.getItem("patientPortalToken");
  });

  // Demo mode auto-login
  const [demoLoading, setDemoLoading] = useState(false);
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === 'true' && !portalToken) {
      setDemoLoading(true);
      fetch('/api/patient-portal/demo-login')
        .then(res => res.json())
        .then(data => {
          if (data.portalToken) {
            localStorage.setItem("patientPortalToken", data.portalToken);
            setPortalToken(data.portalToken);
            window.history.replaceState({}, '', window.location.pathname);
          }
        })
        .catch(console.error)
        .finally(() => setDemoLoading(false));
    }
  }, [portalToken]);

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
      title: t('portal.loggedOutTitle'),
      description: t('portal.loggedOutDesc'),
    });
  };

  // Handle navigation
  const handleNavigate = (tab: string) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  // Demo loading state
  if (demoLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">{t('portal.loadingDemo')}</p>
        </div>
      </div>
    );
  }

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
              <h1 className="text-lg font-bold">{t('portal.patientPortal')}</h1>
              <p className="text-sm text-muted-foreground hidden sm:block">
                {t('portal.manageAppointments')}
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
                {t('portal.dashboard')}
              </Button>
              <Button
                variant={activeTab === "appointments" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleNavigate("appointments")}
              >
                <Calendar className="h-4 w-4 mr-2" />
                {t('portal.appointments')}
              </Button>
              <Button
                variant={activeTab === "progress-notes" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleNavigate("progress-notes")}
              >
                <FileText className="h-4 w-4 mr-2" />
                {t('portal.progressNotes')}
              </Button>
              <Button
                variant={activeTab === "profile" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleNavigate("profile")}
              >
                <User className="h-4 w-4 mr-2" />
                {t('portal.profile')}
              </Button>
            </nav>
            <LanguageSwitcher compact />
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              {t('portal.signOut')}
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2 md:hidden">
            <LanguageSwitcher compact />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
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
                {t('portal.dashboard')}
              </Button>
              <Button
                variant={activeTab === "appointments" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => handleNavigate("appointments")}
              >
                <Calendar className="h-4 w-4 mr-2" />
                {t('portal.appointments')}
              </Button>
              <Button
                variant={activeTab === "progress-notes" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => handleNavigate("progress-notes")}
              >
                <FileText className="h-4 w-4 mr-2" />
                {t('portal.progressNotes')}
              </Button>
              <Button
                variant={activeTab === "profile" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => handleNavigate("profile")}
              >
                <User className="h-4 w-4 mr-2" />
                {t('portal.profile')}
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start mt-2"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4 mr-2" />
                {t('portal.signOut')}
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
        {activeTab === "progress-notes" && (
          <PatientPortalProgressNotes token={portalToken} />
        )}
        {activeTab === "profile" && (
          <PatientPortalProfile token={portalToken} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-white mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>{t('portal.healthInfoSecure')}</p>
          <p className="mt-1">{t('portal.needHelp')}</p>
        </div>
      </footer>
    </div>
  );
}

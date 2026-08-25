import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Home,
  Calendar,
  User,
  LogOut,
  Menu,
  X,
  FileText,
  ClipboardList,
  ClipboardCheck,
  DollarSign,
  MessageSquare,
  FolderOpen,
} from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PatientPortalLogin from "./PatientPortalLogin";
import PatientPortalDashboard from "./PatientPortalDashboard";
import PatientPortalProfile from "./PatientPortalProfile";
import PatientPortalAppointments from "./PatientPortalAppointments";
import PatientPortalProgressNotes from "./PatientPortalProgressNotes";
import PatientPortalSurveys from "./PatientPortalSurveys";
import PatientPortalIntake from "./PatientPortalIntake";
import PatientPortalStatements from "./PatientPortalStatements";
import PatientPortalDocuments from "./PatientPortalDocuments";
import PatientPortalMessages from "./PatientPortalMessages";

export default function PatientPortalPage() {
  const params = useParams<{ token?: string; tab?: string }>();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();

  // Force light theme for the patient-facing portal. The portal hardcodes
  // light-on-light colors (bg-white headers, bg-slate-50 main, ghost-variant
  // tab buttons with no explicit text color) which become unreadable when
  // the user's OS is set to dark mode and next-themes applies the .dark
  // class. Restore the previous theme on unmount so the staff app is
  // unaffected.
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    const previous = theme;
    setTheme("light");
    return () => {
      if (previous) setTheme(previous);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A magic link in the URL ALWAYS wins over whatever is in localStorage.
   *
   * Two bugs lived here:
   *
   * 1. Shadowing. This initializer never looked at `params.token`, and the
   *    login screen — which is what actually redeems a magic link — only
   *    renders when there is no stored token. So a caregiver logged in for
   *    one child who opened the second child's emailed link on the same
   *    tablet was shown the FIRST child's chart: name, DOB, insurance ID,
   *    statements, documents, messages. No login screen, no mismatch
   *    warning. That is ordinary family behaviour on a shared device, not an
   *    attack, and it is a wrong-patient PHI disclosure.
   *
   * 2. `?token=` was accepted straight off the query string and written to
   *    localStorage. Anyone could send a link carrying a token minted on
   *    THEIR record; the recipient's browser would silently adopt that
   *    session, and the insurance cards, signed consents and saved card the
   *    caregiver then submitted would land in the attacker's chart. Session
   *    fixation. The magic-link path route covers every legitimate entry, so
   *    the query-param branch is simply removed.
   */
  const [portalToken, setPortalToken] = useState<string | null>(() => {
    // A path token means "log in as this patient" — drop any existing
    // session so the link is redeemed by PatientPortalLogin below rather
    // than being shadowed by the previous patient's token.
    if (params.token) {
      localStorage.removeItem("patientPortalToken");
      return null;
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

  // Check intake completion status to gate other tabs
  const { data: intakeStatus } = useQuery<{ intakeCompleted: boolean }>({
    queryKey: ['intake-status', portalToken],
    queryFn: async () => {
      const res = await fetch('/api/patient-portal/intake/status', {
        headers: { Authorization: `Bearer ${portalToken}` },
      });
      if (!res.ok) return { intakeCompleted: false };
      return res.json();
    },
    enabled: !!portalToken,
  });

  const intakeCompleted = intakeStatus?.intakeCompleted ?? false;

  // Handle login success
  const handleLoginSuccess = (token: string) => {
    // Drop every cached response before adopting the new session. Portal
    // queries are keyed by URL, not by patient, so without this the previous
    // patient's dashboard, statements and documents would render for the new
    // one until each query happened to refetch.
    queryClient.clear();
    setPortalToken(token);
    localStorage.setItem("patientPortalToken", token);
  };

  // Handle logout
  const handleLogout = () => {
    // Revoke on the SERVER too. Clearing localStorage alone left the token
    // valid, so anyone with a copy — or whoever picks up the shared tablet
    // next — could keep using it. Fire-and-forget: the local session is torn
    // down regardless, so logging out can never fail from the patient's side.
    const token = portalToken;
    if (token) {
      fetch('/api/patient-portal/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {
        /* best effort — local teardown below still happens */
      });
    }

    // Leave nothing behind on a shared device.
    queryClient.clear();
    localStorage.removeItem("patientPortalToken");
    setPortalToken(null);
    setLocation("/patient-portal");
    toast({
      title: t('portal.loggedOutTitle'),
      description: t('portal.loggedOutDesc'),
    });
  };

  // Handle navigation — block tabs behind intake completion
  const handleNavigate = (tab: string) => {
    if (!intakeCompleted && tab !== "dashboard" && tab !== "intake") {
      // Redirect to intake if they try to access gated tabs
      setActiveTab("intake");
      toast({
        title: t('portal.intakeRequiredTitle', 'Intake Required'),
        description: t('portal.intakeRequiredDesc', 'Please complete your intake forms before accessing other features.'),
      });
      setMobileMenuOpen(false);
      return;
    }
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
                variant={activeTab === "intake" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleNavigate("intake")}
              >
                <ClipboardCheck className="h-4 w-4 mr-2" />
                {t('portal.intake', 'Intake')}
                {!intakeCompleted && (
                  <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0">!</Badge>
                )}
              </Button>
              <Button
                variant={activeTab === "appointments" ? "default" : "ghost"}
                size="sm"
                className={!intakeCompleted ? "opacity-50" : ""}
                onClick={() => handleNavigate("appointments")}
              >
                <Calendar className="h-4 w-4 mr-2" />
                {t('portal.appointments')}
              </Button>
              <Button
                variant={activeTab === "statements" ? "default" : "ghost"}
                size="sm"
                className={!intakeCompleted ? "opacity-50" : ""}
                onClick={() => handleNavigate("statements")}
              >
                <DollarSign className="h-4 w-4 mr-2" />
                {t('portal.statements', 'Statements')}
              </Button>
              <Button
                variant={activeTab === "documents" ? "default" : "ghost"}
                size="sm"
                className={!intakeCompleted ? "opacity-50" : ""}
                onClick={() => handleNavigate("documents")}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                {t('portal.documents', 'Documents')}
              </Button>
              <Button
                variant={activeTab === "messages" ? "default" : "ghost"}
                size="sm"
                className={!intakeCompleted ? "opacity-50" : ""}
                onClick={() => handleNavigate("messages")}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                {t('portal.messages', 'Messages')}
              </Button>
              <Button
                variant={activeTab === "progress-notes" ? "default" : "ghost"}
                size="sm"
                className={!intakeCompleted ? "opacity-50" : ""}
                onClick={() => handleNavigate("progress-notes")}
              >
                <FileText className="h-4 w-4 mr-2" />
                {t('portal.progressNotes')}
              </Button>
              <Button
                variant={activeTab === "surveys" ? "default" : "ghost"}
                size="sm"
                className={!intakeCompleted ? "opacity-50" : ""}
                onClick={() => handleNavigate("surveys")}
              >
                <ClipboardList className="h-4 w-4 mr-2" />
                {t('portal.surveys.tab', 'Surveys')}
              </Button>
              <Button
                variant={activeTab === "profile" ? "default" : "ghost"}
                size="sm"
                className={!intakeCompleted ? "opacity-50" : ""}
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
                variant={activeTab === "intake" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => handleNavigate("intake")}
              >
                <ClipboardCheck className="h-4 w-4 mr-2" />
                {t('portal.intake', 'Intake')}
                {!intakeCompleted && (
                  <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0">!</Badge>
                )}
              </Button>
              <Button
                variant={activeTab === "appointments" ? "default" : "ghost"}
                className={`w-full justify-start ${!intakeCompleted ? "opacity-50" : ""}`}
                onClick={() => handleNavigate("appointments")}
              >
                <Calendar className="h-4 w-4 mr-2" />
                {t('portal.appointments')}
              </Button>
              <Button
                variant={activeTab === "statements" ? "default" : "ghost"}
                className={`w-full justify-start ${!intakeCompleted ? "opacity-50" : ""}`}
                onClick={() => handleNavigate("statements")}
              >
                <DollarSign className="h-4 w-4 mr-2" />
                {t('portal.statements', 'Statements')}
              </Button>
              <Button
                variant={activeTab === "documents" ? "default" : "ghost"}
                className={`w-full justify-start ${!intakeCompleted ? "opacity-50" : ""}`}
                onClick={() => handleNavigate("documents")}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                {t('portal.documents', 'Documents')}
              </Button>
              <Button
                variant={activeTab === "messages" ? "default" : "ghost"}
                className={`w-full justify-start ${!intakeCompleted ? "opacity-50" : ""}`}
                onClick={() => handleNavigate("messages")}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                {t('portal.messages', 'Messages')}
              </Button>
              <Button
                variant={activeTab === "progress-notes" ? "default" : "ghost"}
                className={`w-full justify-start ${!intakeCompleted ? "opacity-50" : ""}`}
                onClick={() => handleNavigate("progress-notes")}
              >
                <FileText className="h-4 w-4 mr-2" />
                {t('portal.progressNotes')}
              </Button>
              <Button
                variant={activeTab === "surveys" ? "default" : "ghost"}
                className={`w-full justify-start ${!intakeCompleted ? "opacity-50" : ""}`}
                onClick={() => handleNavigate("surveys")}
              >
                <ClipboardList className="h-4 w-4 mr-2" />
                {t('portal.surveys.tab', 'Surveys')}
              </Button>
              <Button
                variant={activeTab === "profile" ? "default" : "ghost"}
                className={`w-full justify-start ${!intakeCompleted ? "opacity-50" : ""}`}
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
        {activeTab === "statements" && (
          <PatientPortalStatements token={portalToken} />
        )}
        {activeTab === "documents" && (
          <PatientPortalDocuments token={portalToken} />
        )}
        {activeTab === "messages" && (
          <PatientPortalMessages token={portalToken} />
        )}
        {activeTab === "progress-notes" && (
          <PatientPortalProgressNotes token={portalToken} />
        )}
        {activeTab === "surveys" && (
          <PatientPortalSurveys token={portalToken} />
        )}
        {activeTab === "profile" && (
          <PatientPortalProfile token={portalToken} />
        )}
        {activeTab === "intake" && (
          <PatientPortalIntake portalToken={portalToken} />
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

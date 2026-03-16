import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Home,
  Users,
  FileText,
  TrendingUp,
  Receipt,
  Settings,
  LogOut,
  UserPlus,
  ClipboardList,
  Calendar,
  DollarSign,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Scale,
  Clock,
  Star,
  CalendarCheck,
  CalendarClock,
  Video,
  MessageSquare,
  BarChart3,
  Mic,
  CreditCard,
  Sun,
  Moon,
  Monitor,
  Handshake,
  Target,
  MoreHorizontal,
  Building2,
  Brain,
  UserCheck,
  Download,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/hooks/useAuth";
import LanguageSwitcher from "@/components/LanguageSwitcher";

// Navigation items with i18n keys instead of hardcoded names
const navigationItems = [
  { nameKey: 'nav.dashboard', href: '/', icon: Home, adminOnly: false },
  { nameKey: 'nav.patientIntake', href: '/intake', icon: UserPlus, adminOnly: false },
  { nameKey: 'nav.patients', href: '/patients', icon: Users, adminOnly: false },
  { nameKey: 'nav.calendar', href: '/calendar', icon: Calendar, adminOnly: false },
  { nameKey: 'nav.schedulingInsights', href: '/scheduling-insights', icon: CalendarClock, adminOnly: false },
  { nameKey: 'nav.waitlist', href: '/waitlist', icon: Clock, adminOnly: false },
  { nameKey: 'nav.reviews', href: '/reviews', icon: Star, adminOnly: false },
  { nameKey: 'nav.onlineBooking', href: '/online-booking', icon: CalendarCheck, adminOnly: false },
  { nameKey: 'nav.telehealth', href: '/telehealth', icon: Video, adminOnly: false },
  { nameKey: 'nav.messages', href: '/messages', icon: MessageSquare, adminOnly: false },
  { nameKey: 'nav.soapNotes', href: '/soap-notes', icon: ClipboardList, adminOnly: false },
  { nameKey: 'nav.sessionRecorder', href: '/session-recorder', icon: Mic, adminOnly: false },
  { nameKey: 'nav.outcomeMeasures', href: '/outcome-measures', icon: BarChart3, adminOnly: false },
  { nameKey: 'nav.surveys', href: '/surveys', icon: ClipboardList, adminOnly: false },
  { nameKey: 'nav.treatmentPlans', href: '/treatment-plans', icon: Target, adminOnly: false },
  { nameKey: 'nav.claims', href: '/claims', icon: FileText, adminOnly: false },
  { nameKey: 'nav.insuranceRates', href: '/insurance-rates', icon: DollarSign, adminOnly: false },
  { nameKey: 'nav.reimbursement', href: '/reimbursement', icon: TrendingUp, adminOnly: false },
  { nameKey: 'nav.era835', href: '/remittance', icon: Receipt, adminOnly: false },
  { nameKey: 'nav.payerContracts', href: '/payer-contracts', icon: Handshake, adminOnly: false },
  { nameKey: 'nav.appeals', href: '/appeals', icon: Scale, adminOnly: false },
  { nameKey: 'nav.aiInsights', href: '/ai-insights', icon: Brain, adminOnly: false },
  { nameKey: 'nav.accounting', href: '/accounting', icon: DollarSign, adminOnly: true },
  { nameKey: 'nav.analytics', href: '/analytics', icon: TrendingUp, adminOnly: true },
  { nameKey: 'nav.therapistProductivity', href: '/therapist-productivity', icon: UserCheck, adminOnly: false },
  { nameKey: 'nav.reportBuilder', href: '/reports', icon: BarChart3, adminOnly: false },
  { nameKey: 'nav.expenses', href: '/expenses', icon: Receipt, adminOnly: false },
  { nameKey: 'nav.payerManagement', href: '/payer-management', icon: Shield, adminOnly: true },
  { nameKey: 'nav.breachIncidents', href: '/breach-incidents', icon: ShieldAlert, adminOnly: true },
  { nameKey: 'nav.compliance', href: '/compliance', icon: ShieldCheck, adminOnly: true },
  { nameKey: 'nav.hipaaCompliance', href: '/hipaa-compliance', icon: Shield, adminOnly: true },
  { nameKey: 'nav.locations', href: '/locations', icon: Building2, adminOnly: false },
  { nameKey: 'nav.subscription', href: '/subscription', icon: CreditCard, adminOnly: true },
  { nameKey: 'nav.dataExport', href: '/data-export', icon: Download, adminOnly: true },
  { nameKey: 'nav.settings', href: '/settings', icon: Settings, adminOnly: false },
];

// Bottom tab bar items (the 4 primary + More)
const bottomTabItems = [
  { nameKey: 'nav.dashboard', href: '/', icon: Home },
  { nameKey: 'nav.patients', href: '/patients', icon: Users },
  { nameKey: 'nav.claims', href: '/claims', icon: FileText },
  { nameKey: 'nav.calendar', href: '/calendar', icon: Calendar },
];

export default function SimpleNavigation() {
  const [location, setLocation] = useLocation();
  const { user, isAdmin, currentRole } = useAuth();
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  // Location switcher data
  const { data: practiceLocations = [] } = useQuery<Array<{ id: number; name: string; isMainLocation: boolean }>>({
    queryKey: ['/api/locations'],
    queryFn: async () => {
      const res = await fetch('/api/locations');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const [selectedLocationId, setSelectedLocationId] = useState<string>('all');

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const themeLabel = theme === 'dark' ? t('theme.dark') : theme === 'light' ? t('theme.light') : t('theme.system');

  // Close mobile menu and more sheet on route change
  // Close more sheet on route change
  useEffect(() => {
    setMoreSheetOpen(false);
  }, [location]);

  // Prevent body scroll when more sheet is open
  useEffect(() => {
    if (moreSheetOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [moreSheetOpen]);

  // Filter navigation items based on role
  const filteredNavigation = navigationItems.filter(item => !item.adminOnly || isAdmin);

  // Items for the "More" sheet (everything not in bottom tabs)
  const bottomTabHrefs = new Set(bottomTabItems.map(item => item.href));
  const moreNavItems = filteredNavigation.filter(item => !bottomTabHrefs.has(item.href));

  const getUserInitials = () => {
    const typedUser = user as any;
    if (typedUser?.firstName && typedUser?.lastName) {
      return `${typedUser.firstName[0]}${typedUser.lastName[0]}`.toUpperCase();
    }
    return typedUser?.email?.[0]?.toUpperCase() || 'U';
  };

  const handleNavClick = (href: string) => {
    setLocation(href);
  };

  // Check if current location matches any bottom tab
  const isBottomTabActive = (href: string) => {
    if (href === '/') return location === '/';
    return location.startsWith(href);
  };

  // Check if current location matches any "more" item
  const isMoreActive = moreNavItems.some(item => {
    if (item.href === '/') return location === '/';
    return location.startsWith(item.href);
  });

  return (
    <>
      {/* Skip to main content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[200] focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-md focus:outline-none"
      >
        {t('nav.skipToMain')}
      </a>

      {/* Desktop Navigation - sidebar, hidden on mobile */}
      <nav
        role="navigation"
        aria-label={t('nav.mainNavigation')}
        className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 bg-background border-r border-border flex-col z-10"
      >
        <div className="flex items-center h-16 px-6 border-b border-border">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center mr-3">
            <FileText className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
          </div>
          <span className="text-xl font-bold text-foreground">TherapyBill AI</span>
        </div>

        {practiceLocations.length > 0 && (
          <div className="px-6 py-3 border-b border-border">
            <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
              <SelectTrigger className="w-full h-9 text-sm">
                <Building2 className="w-4 h-4 mr-2 text-muted-foreground" aria-hidden="true" />
                <SelectValue placeholder={t('locations.allLocations')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('locations.allLocations')}</SelectItem>
                {practiceLocations.map((loc) => (
                  <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex-1 px-6 py-6 overflow-y-auto">
          <ul className="space-y-2" role="list">
            {filteredNavigation.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              return (
                <li key={item.nameKey}>
                  <a
                    href={item.href}
                    onClick={(e) => {
                      e.preventDefault();
                      handleNavClick(item.href);
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <Icon className="w-5 h-5 mr-3" aria-hidden="true" />
                    {t(item.nameKey)}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="p-6 border-t border-border space-y-4">
          <div className="flex items-center justify-center">
            <LanguageSwitcher compact />
          </div>
          <div className="flex items-center space-x-3">
            <Avatar>
              <AvatarImage src={(user as any)?.profileImageUrl} />
              <AvatarFallback>{getUserInitials()}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {(user as any)?.firstName && (user as any)?.lastName
                  ? `${(user as any).firstName} ${(user as any).lastName}`
                  : (user as any)?.email || 'User'
                }
              </p>
              <p className="text-xs text-muted-foreground capitalize">{currentRole}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label={themeLabel}
              title={themeLabel}
              onClick={cycleTheme}
            >
              {(() => { const ThemeIcon = themeIcon; return <ThemeIcon className="w-4 h-4" aria-hidden="true" />; })()}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('nav.logOut')}
              onClick={() => window.location.href = '/api/logout'}
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Mobile: Top header bar with logo only (no hamburger needed since we have bottom tabs) */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-background border-b border-border">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center">
            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center mr-2">
              <FileText className="w-4 h-4 text-primary-foreground" aria-hidden="true" />
            </div>
            <span className="text-lg font-bold text-foreground">TherapyBill AI</span>
          </div>
          <div className="flex items-center gap-1">
            <LanguageSwitcher compact />
            <Button
              variant="ghost"
              size="sm"
              aria-label={themeLabel}
              title={themeLabel}
              onClick={cycleTheme}
              className="h-10 w-10 min-h-[44px] min-w-[44px]"
            >
              {(() => { const ThemeIcon = themeIcon; return <ThemeIcon className="w-4 h-4" aria-hidden="true" />; })()}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile: Bottom Tab Bar */}
      <nav
        role="navigation"
        aria-label={t('nav.mobileNavigation')}
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border safe-area-bottom"
      >
        <div className="flex items-stretch justify-around h-16 px-1">
          {bottomTabItems.map((item) => {
            const Icon = item.icon;
            const isActive = isBottomTabActive(item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault();
                  handleNavClick(item.href);
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center justify-center flex-1 min-h-[44px] min-w-[44px] transition-colors ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground'
                }`}
              >
                <Icon className="w-5 h-5 mb-0.5" aria-hidden="true" />
                <span className="text-[10px] font-medium leading-tight">{t(item.nameKey)}</span>
              </a>
            );
          })}
          {/* More tab */}
          <button
            onClick={() => setMoreSheetOpen(!moreSheetOpen)}
            aria-expanded={moreSheetOpen}
            aria-label="More navigation options"
            className={`flex flex-col items-center justify-center flex-1 min-h-[44px] min-w-[44px] transition-colors ${
              isMoreActive || moreSheetOpen
                ? 'text-primary'
                : 'text-muted-foreground'
            }`}
          >
            <MoreHorizontal className="w-5 h-5 mb-0.5" aria-hidden="true" />
            <span className="text-[10px] font-medium leading-tight">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile: "More" slide-up sheet */}
      {moreSheetOpen && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setMoreSheetOpen(false)}
            aria-hidden="true"
          />
          {/* Sheet */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-2xl border-t border-border max-h-[75vh] flex flex-col animate-in slide-in-from-bottom duration-300">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
            </div>
            {/* User info row */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
              <Avatar className="h-9 w-9">
                <AvatarImage src={(user as any)?.profileImageUrl} />
                <AvatarFallback className="text-xs">{getUserInitials()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {(user as any)?.firstName && (user as any)?.lastName
                    ? `${(user as any).firstName} ${(user as any).lastName}`
                    : (user as any)?.email || 'User'
                  }
                </p>
                <p className="text-xs text-muted-foreground capitalize">{currentRole}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('nav.logOut')}
                onClick={() => window.location.href = '/api/logout'}
                className="min-h-[44px] min-w-[44px]"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
            {/* Nav items grid */}
            <div className="flex-1 overflow-y-auto px-4 py-3 pb-20">
              <ul className="grid grid-cols-3 gap-2" role="list">
                {moreNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.href;
                  return (
                    <li key={item.nameKey}>
                      <a
                        href={item.href}
                        onClick={(e) => {
                          e.preventDefault();
                          handleNavClick(item.href);
                          setMoreSheetOpen(false);
                        }}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl min-h-[72px] text-center transition-colors ${
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        }`}
                      >
                        <Icon className="w-5 h-5 mb-1.5" aria-hidden="true" />
                        <span className="text-[11px] font-medium leading-tight">{t(item.nameKey)}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </>
      )}
    </>
  );
}

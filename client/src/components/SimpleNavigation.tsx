import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Home,
  Users,
  FileText,
  TrendingUp,
  Receipt,
  Settings,
  Menu,
  X,
  LogOut,
  UserPlus,
  ClipboardList,
  Calendar,
  DollarSign,
  Shield,
  ShieldAlert,
  Scale,
  Clock,
  Star,
  CalendarCheck,
  Video,
  MessageSquare,
  BarChart3,
  Mic,
  CreditCard,
  Sun,
  Moon,
  Monitor,
  Handshake,
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
  { nameKey: 'nav.waitlist', href: '/waitlist', icon: Clock, adminOnly: false },
  { nameKey: 'nav.reviews', href: '/reviews', icon: Star, adminOnly: false },
  { nameKey: 'nav.onlineBooking', href: '/online-booking', icon: CalendarCheck, adminOnly: false },
  { nameKey: 'nav.telehealth', href: '/telehealth', icon: Video, adminOnly: false },
  { nameKey: 'nav.messages', href: '/messages', icon: MessageSquare, adminOnly: false },
  { nameKey: 'nav.soapNotes', href: '/soap-notes', icon: ClipboardList, adminOnly: false },
  { nameKey: 'nav.sessionRecorder', href: '/session-recorder', icon: Mic, adminOnly: false },
  { nameKey: 'nav.outcomeMeasures', href: '/outcome-measures', icon: BarChart3, adminOnly: false },
  { nameKey: 'nav.claims', href: '/claims', icon: FileText, adminOnly: false },
  { nameKey: 'nav.insuranceRates', href: '/insurance-rates', icon: DollarSign, adminOnly: false },
  { nameKey: 'nav.reimbursement', href: '/reimbursement', icon: TrendingUp, adminOnly: false },
  { nameKey: 'nav.era835', href: '/remittance', icon: Receipt, adminOnly: false },
  { nameKey: 'nav.payerContracts', href: '/payer-contracts', icon: Handshake, adminOnly: false },
  { nameKey: 'nav.appeals', href: '/appeals', icon: Scale, adminOnly: false },
  { nameKey: 'nav.accounting', href: '/accounting', icon: DollarSign, adminOnly: true },
  { nameKey: 'nav.analytics', href: '/analytics', icon: TrendingUp, adminOnly: true },
  { nameKey: 'nav.expenses', href: '/expenses', icon: Receipt, adminOnly: false },
  { nameKey: 'nav.payerManagement', href: '/payer-management', icon: Shield, adminOnly: true },
  { nameKey: 'nav.breachIncidents', href: '/breach-incidents', icon: ShieldAlert, adminOnly: true },
  { nameKey: 'nav.subscription', href: '/subscription', icon: CreditCard, adminOnly: true },
  { nameKey: 'nav.settings', href: '/settings', icon: Settings, adminOnly: false },
];

export default function SimpleNavigation() {
  const [location, setLocation] = useLocation();
  const { user, isAdmin, currentRole } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const themeLabel = theme === 'dark' ? t('theme.dark') : theme === 'light' ? t('theme.light') : t('theme.system');

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  // Filter navigation items based on role
  const filteredNavigation = navigationItems.filter(item => !item.adminOnly || isAdmin);

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

  return (
    <>
      {/* Skip to main content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[200] focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-md focus:outline-none"
      >
        {t('nav.skipToMain')}
      </a>

      {/* Desktop Navigation */}
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

      {/* Mobile Navigation */}
      <div className="md:hidden">
        <div className="flex items-center justify-between h-16 px-4 bg-background border-b border-border">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center mr-3">
              <FileText className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
            </div>
            <span className="text-xl font-bold text-foreground">TherapyBill AI</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <Button
              variant="ghost"
              size="sm"
              aria-label={mobileMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav-menu"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-6 h-6" aria-hidden="true" /> : <Menu className="w-6 h-6" aria-hidden="true" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div id="mobile-nav-menu" className="fixed inset-0 top-16 bg-background z-50 overflow-y-auto">
            <nav role="navigation" aria-label={t('nav.mobileNavigation')} className="px-4 py-6">
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
                          setMobileMenuOpen(false);
                        }}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex items-center px-3 py-3 rounded-lg text-base font-medium transition-colors ${
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        }`}
                      >
                        <Icon className="w-6 h-6 mr-3" aria-hidden="true" />
                        {t(item.nameKey)}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        )}
      </div>
    </>
  );
}

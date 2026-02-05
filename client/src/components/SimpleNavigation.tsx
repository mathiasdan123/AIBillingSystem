import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
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
  Mic
} from "lucide-react";
import { useAuth, setDemoRole } from "@/hooks/useAuth";

const navigation = [
  { name: 'Dashboard', href: '/', icon: Home, adminOnly: false },
  { name: 'Patient Intake', href: '/intake', icon: UserPlus, adminOnly: false },
  { name: 'Patients', href: '/patients', icon: Users, adminOnly: false },
  { name: 'Calendar', href: '/calendar', icon: Calendar, adminOnly: false },
  { name: 'Waitlist', href: '/waitlist', icon: Clock, adminOnly: false },
  { name: 'Reviews', href: '/reviews', icon: Star, adminOnly: false },
  { name: 'Online Booking', href: '/online-booking', icon: CalendarCheck, adminOnly: false },
  { name: 'Telehealth', href: '/telehealth', icon: Video, adminOnly: false },
  { name: 'Messages', href: '/messages', icon: MessageSquare, adminOnly: false },
  { name: 'SOAP Notes', href: '/soap-notes', icon: ClipboardList, adminOnly: false },
  { name: 'Session Recorder', href: '/session-recorder', icon: Mic, adminOnly: false },
  { name: 'Outcome Measures', href: '/outcome-measures', icon: BarChart3, adminOnly: false },
  { name: 'Claims', href: '/claims', icon: FileText, adminOnly: false },
  { name: 'Insurance Rates', href: '/insurance-rates', icon: DollarSign, adminOnly: false },
  { name: 'Appeals', href: '/appeals', icon: Scale, adminOnly: false },
  { name: 'Accounting', href: '/accounting', icon: DollarSign, adminOnly: true },
  { name: 'Analytics', href: '/analytics', icon: TrendingUp, adminOnly: true },
  { name: 'Expenses', href: '/expenses', icon: Receipt, adminOnly: false },
  { name: 'Payer Management', href: '/payer-management', icon: Shield, adminOnly: true },
  { name: 'Breach Incidents', href: '/breach-incidents', icon: ShieldAlert, adminOnly: true },
  { name: 'Settings', href: '/settings', icon: Settings, adminOnly: false },
];

export default function SimpleNavigation() {
  const [location, setLocation] = useLocation();
  const { user, isAdmin, currentRole } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Filter navigation items based on role
  const filteredNavigation = navigation.filter(item => !item.adminOnly || isAdmin);

  const handleRoleSwitch = () => {
    setDemoRole(currentRole === 'admin' ? 'therapist' : 'admin');
  };

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
      {/* Desktop Navigation */}
      <nav className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-slate-200 flex-col z-10">
        <div className="flex items-center h-16 px-6 border-b border-slate-200">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mr-3">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-slate-900">TherapyBill AI</span>
        </div>

        <div className="flex-1 px-6 py-6 overflow-y-auto">
          <nav className="space-y-2">
            {filteredNavigation.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              return (
                <div
                  key={item.name}
                  onClick={() => handleNavClick(item.href)}
                  className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-5 h-5 mr-3" />
                  {item.name}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="p-6 border-t border-slate-200 space-y-4">
          {/* Demo Role Switcher - Only show in development mode */}
          {import.meta.env.DEV && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-medium text-amber-800">Demo Mode</span>
                </div>
                <Switch
                  checked={currentRole === 'admin'}
                  onCheckedChange={handleRoleSwitch}
                />
              </div>
              <p className="text-xs text-amber-700 mt-1">
                {currentRole === 'admin' ? 'Viewing as Admin' : 'Viewing as Therapist'}
              </p>
            </div>
          )}

          <div className="flex items-center space-x-3">
            <Avatar>
              <AvatarImage src={(user as any)?.profileImageUrl} />
              <AvatarFallback>{getUserInitials()}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900">
                {(user as any)?.firstName && (user as any)?.lastName
                  ? `${(user as any).firstName} ${(user as any).lastName}`
                  : (user as any)?.email || 'User'
                }
              </p>
              <p className="text-xs text-slate-500 capitalize">{currentRole}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.location.href = '/api/logout'}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      <div className="md:hidden">
        <div className="flex items-center justify-between h-16 px-4 bg-white border-b border-slate-200">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mr-3">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-slate-900">TherapyBill AI</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </Button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 top-16 bg-white z-50 overflow-y-auto">
            <nav className="px-4 py-6 space-y-2">
              {filteredNavigation.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href;
                return (
                  <div
                    key={item.name}
                    onClick={() => {
                      handleNavClick(item.href);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex items-center px-3 py-3 rounded-lg text-base font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-6 h-6 mr-3" />
                    {item.name}
                  </div>
                );
              })}
            </nav>
          </div>
        )}
      </div>
    </>
  );
}

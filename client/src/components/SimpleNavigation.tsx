import { useState } from "react";
import { useLocation } from "wouter";
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
  DollarSign
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const navigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Patient Intake', href: '/intake', icon: UserPlus },
  { name: 'Patients', href: '/patients', icon: Users },
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'SOAP Notes', href: '/soap-notes', icon: ClipboardList },
  { name: 'Claims', href: '/claims', icon: FileText },
  { name: 'Accounting', href: '/accounting', icon: DollarSign },
  { name: 'Analytics', href: '/analytics', icon: TrendingUp },
  { name: 'Expenses', href: '/expenses', icon: Receipt },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function SimpleNavigation() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
        
        <div className="flex-1 px-6 py-6">
          <nav className="space-y-2">
            {navigation.map((item) => {
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
        
        <div className="p-6 border-t border-slate-200">
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
              <p className="text-xs text-slate-500">{(user as any)?.role || 'Therapist'}</p>
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
          <div className="fixed inset-0 top-16 bg-white z-50">
            <nav className="px-4 py-6 space-y-2">
              {navigation.map((item) => {
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
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  FileText,
  Home,
  Users,
  CreditCard,
  TrendingUp,
  Receipt,
  Settings,
  Menu,
  LogOut,
  UserPlus,
  ClipboardList,
  BarChart3
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const navigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Patient Intake', href: '/intake', icon: UserPlus },
  { name: 'Patients', href: '/patients', icon: Users },
  { name: 'SOAP Notes', href: '/soap-notes', icon: ClipboardList },
  { name: 'Claims', href: '/claims', icon: FileText },
  { name: 'Analytics', href: '/analytics', icon: TrendingUp },
  { name: 'Reports', href: '/reports', icon: BarChart3 },
  { name: 'Expenses', href: '/expenses', icon: Receipt },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Navigation() {
  const [location] = useLocation();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const getUserInitials = () => {
    const typedUser = user as any; // Temporary fix for type issues
    if (typedUser?.firstName && typedUser?.lastName) {
      return `${typedUser.firstName[0]}${typedUser.lastName[0]}`.toUpperCase();
    }
    return typedUser?.email?.[0]?.toUpperCase() || 'U';
  };

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-slate-200 flex-col">
        <div className="flex items-center h-16 px-6 border-b border-slate-200">
          <div className="w-8 h-8 bg-medical-blue-500 rounded-lg flex items-center justify-center mr-3">
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
                <Link key={item.name} href={item.href}>
                  <div className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    isActive 
                      ? 'bg-medical-blue-50 text-medical-blue-600' 
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}>
                    <Icon className="w-5 h-5 mr-3" />
                    {item.name}
                  </div>
                </Link>
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
            <div className="w-8 h-8 bg-medical-blue-500 rounded-lg flex items-center justify-center mr-3">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-slate-900">TherapyBill AI</span>
          </div>
          
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80">
              <div className="flex flex-col h-full">
                <div className="flex items-center space-x-3 p-6 border-b border-slate-200">
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
                </div>
                
                <nav className="flex-1 px-6 py-6">
                  <div className="space-y-2">
                    {navigation.map((item) => {
                      const Icon = item.icon;
                      const isActive = location === item.href;
                      return (
                        <Link key={item.name} href={item.href}>
                          <a 
                            className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              isActive 
                                ? 'bg-medical-blue-50 text-medical-blue-600' 
                                : 'text-slate-700 hover:bg-slate-50'
                            }`}
                            onClick={() => setMobileMenuOpen(false)}
                          >
                            <Icon className="w-5 h-5 mr-3" />
                            {item.name}
                          </a>
                        </Link>
                      );
                    })}
                  </div>
                </nav>
                
                <div className="p-6 border-t border-slate-200">
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start"
                    onClick={() => window.location.href = '/api/logout'}
                  >
                    <LogOut className="w-4 h-4 mr-3" />
                    Sign Out
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </>
  );
}

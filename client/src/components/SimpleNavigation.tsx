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
  LogOut,
  Calendar,
  Sun,
  Moon,
  Monitor,
  MoreHorizontal,
  Building2,
  ChevronDown,
} from "lucide-react";
import { Search } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/hooks/useAuth";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { openCommandPalette } from "@/components/CommandPalette";
import {
  topLevelItems,
  navigationSections,
  sectionLabelFallbacks as mobileSectionLabels,
  flattenNavItems,
  itemVisibleToUser,
  type NavItem,
  type NavSection,
} from "@/lib/nav-config";

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

  // Track which sidebar sections are collapsed (desktop)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = (labelKey: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(labelKey)) {
        next.delete(labelKey);
      } else {
        next.add(labelKey);
      }
      return next;
    });
  };

  // Track which nested parent rows are expanded (desktop). Key is the parent's nameKey.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  const toggleParent = (nameKey: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(nameKey)) {
        next.delete(nameKey);
      } else {
        next.add(nameKey);
      }
      return next;
    });
  };

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

  // Filter navigation sections based on role. For parent items with children,
  // we filter children in-place and keep the parent only if at least one
  // child survives.
  const filteredSections = navigationSections
    .map(section => ({
      ...section,
      items: section.items
        .map((item): NavItem | null => {
          if (!itemVisibleToUser(item, isAdmin)) return null;
          if (item.children && item.children.length > 0) {
            return {
              ...item,
              children: item.children.filter(c => itemVisibleToUser(c, isAdmin)),
            };
          }
          return item;
        })
        .filter((item): item is NavItem => item !== null),
    }))
    .filter(section => section.items.length > 0);

  const filteredTopLevelItems = topLevelItems.filter(item => itemVisibleToUser(item, isAdmin));

  // Items for the "More" sheet (everything not in bottom tabs). We flatten
  // children here because the mobile sheet is a flat grid, not nested.
  const bottomTabHrefs = new Set(bottomTabItems.map(item => item.href));
  const moreNavSections = filteredSections
    .map(section => ({
      ...section,
      items: flattenNavItems(section.items, isAdmin).filter(
        item => !item.href || !bottomTabHrefs.has(item.href)
      ),
    }))
    .filter(section => section.items.length > 0);

  const moreNavItems = moreNavSections.flatMap(s => s.items);

  // Auto-expand parents whose child matches the current route, so the user
  // lands on a highlighted item even on first render.
  useEffect(() => {
    const shouldExpand: string[] = [];
    for (const section of filteredSections) {
      for (const item of section.items) {
        if (item.children && item.children.some(c => c.href === location)) {
          shouldExpand.push(item.nameKey);
        }
      }
    }
    if (shouldExpand.length > 0) {
      setExpandedParents(prev => {
        const next = new Set(prev);
        shouldExpand.forEach(k => next.add(k));
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

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
    if (!item.href) return false;
    if (item.href === '/') return location === '/';
    return location.startsWith(item.href);
  });

  // Check if any item (including nested children) in a section is active
  const isSectionActive = (section: NavSection) => {
    const matches = (item: NavItem): boolean => {
      if (item.href === '/') return location === '/';
      if (item.href && location === item.href) return true;
      return Boolean(item.children?.some(matches));
    };
    return section.items.some(matches);
  };

  // True if any child of this parent item is the current route.
  const isParentActive = (parent: NavItem): boolean => {
    return Boolean(parent.children?.some(c => c.href === location));
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

        {/* Command palette trigger */}
        <div className="px-3 py-3 border-b border-border">
          <button
            onClick={openCommandPalette}
            className="flex items-center w-full px-3 py-1.5 rounded-md text-sm text-muted-foreground bg-accent/30 hover:bg-accent transition-colors"
            aria-label={t('commandPalette.trigger', 'Search… (⌘K)')}
          >
            <Search className="w-4 h-4 mr-2 flex-shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left truncate">{t('commandPalette.trigger', 'Search…')}</span>
            <kbd className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground">
              ⌘K
            </kbd>
          </button>
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

        <div className="flex-1 px-3 py-3 overflow-y-auto">
          {/* Top-level items (Dashboard) — no section wrapper */}
          {filteredTopLevelItems.length > 0 && (
            <ul className="mb-3 space-y-0.5" role="list">
              {filteredTopLevelItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.href === '/' ? location === '/' : location === item.href;
                return (
                  <li key={item.nameKey}>
                    <a
                      href={item.href}
                      onClick={(e) => {
                        e.preventDefault();
                        if (item.href) handleNavClick(item.href);
                      }}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      }`}
                    >
                      <Icon className="w-4 h-4 mr-3 flex-shrink-0" aria-hidden="true" />
                      {t(item.nameKey)}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}

          {filteredSections.map((section) => {
            const isCollapsed = collapsedSections.has(section.labelKey);
            const sectionActive = isSectionActive(section);

            return (
              <div key={section.labelKey} className="mb-1">
                <button
                  onClick={() => toggleSection(section.labelKey)}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors rounded-md"
                  aria-expanded={!isCollapsed}
                >
                  <span className={sectionActive && isCollapsed ? 'text-primary' : ''}>
                    {t(section.labelKey, mobileSectionLabels[section.labelKey] || section.labelKey)}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                    aria-hidden="true"
                  />
                </button>
                {!isCollapsed && (
                  <ul className="mt-0.5 space-y-0.5" role="list">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const hasChildren = Boolean(item.children && item.children.length > 0);

                      // Parent-with-children row: toggles expansion, highlights if a child is active
                      if (hasChildren) {
                        const expanded = expandedParents.has(item.nameKey);
                        const parentActive = isParentActive(item);
                        return (
                          <li key={item.nameKey}>
                            <button
                              onClick={() => toggleParent(item.nameKey)}
                              aria-expanded={expanded}
                              className={`flex items-center w-full px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                parentActive
                                  ? 'text-primary'
                                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                              }`}
                            >
                              <Icon className="w-4 h-4 mr-3 flex-shrink-0" aria-hidden="true" />
                              <span className="flex-1 text-left">{t(item.nameKey)}</span>
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
                                aria-hidden="true"
                              />
                            </button>
                            {expanded && item.children && (
                              <ul className="mt-0.5 ml-6 space-y-0.5 border-l border-border pl-2" role="list">
                                {item.children.map((child) => {
                                  const ChildIcon = child.icon;
                                  const isActive = location === child.href;
                                  return (
                                    <li key={child.nameKey}>
                                      <a
                                        href={child.href}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          if (child.href) handleNavClick(child.href);
                                        }}
                                        aria-current={isActive ? 'page' : undefined}
                                        className={`flex items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                          isActive
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                                        }`}
                                      >
                                        <ChildIcon className="w-4 h-4 mr-3 flex-shrink-0" aria-hidden="true" />
                                        {t(child.nameKey)}
                                      </a>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </li>
                        );
                      }

                      // Leaf row
                      const isActive = location === item.href;
                      return (
                        <li key={item.nameKey}>
                          <a
                            href={item.href}
                            onClick={(e) => {
                              e.preventDefault();
                              if (item.href) handleNavClick(item.href);
                            }}
                            aria-current={isActive ? 'page' : undefined}
                            className={`flex items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              isActive
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            }`}
                          >
                            <Icon className="w-4 h-4 mr-3 flex-shrink-0" aria-hidden="true" />
                            {t(item.nameKey)}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-border space-y-3">
          <div className="flex items-center justify-center">
            <LanguageSwitcher compact />
          </div>
          <div className="flex items-center space-x-3">
            <Avatar className="h-8 w-8">
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
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('commandPalette.trigger', 'Search')}
              title={t('commandPalette.trigger', 'Search')}
              onClick={openCommandPalette}
              className="h-10 w-10 min-h-[44px] min-w-[44px]"
            >
              <Search className="w-4 h-4" aria-hidden="true" />
            </Button>
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
            {/* Nav items grouped by section */}
            <div className="flex-1 overflow-y-auto px-4 py-3 pb-20">
              {moreNavSections.map((section) => (
                <div key={section.labelKey} className="mb-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">
                    {t(section.labelKey, mobileSectionLabels[section.labelKey] || section.labelKey)}
                  </h3>
                  <ul className="grid grid-cols-3 gap-2" role="list">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = location === item.href;
                      return (
                        <li key={item.nameKey}>
                          <a
                            href={item.href ?? '#'}
                            onClick={(e) => {
                              e.preventDefault();
                              if (item.href) {
                                handleNavClick(item.href);
                                setMoreSheetOpen(false);
                              }
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
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

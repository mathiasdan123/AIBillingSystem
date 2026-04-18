import { useState, useEffect, useMemo } from "react";
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
  Search,
} from "lucide-react";
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

// ----- Design tokens (centralized for consistency) -----
// One stroke-width everywhere so the icon rail reads as precise rather than chunky.
const ICON_STROKE = 1.5;

// Bottom tab bar items (the 4 primary + More) — unchanged contract
const bottomTabItems = [
  { nameKey: 'nav.dashboard', href: '/', icon: Home },
  { nameKey: 'nav.patients', href: '/patients', icon: Users },
  { nameKey: 'nav.claims', href: '/claims', icon: FileText },
  { nameKey: 'nav.calendar', href: '/calendar', icon: Calendar },
];

// ----- localStorage persistence for collapsed state -----
const EXPANDED_STORAGE_KEY = 'sidebar:expanded';

function loadExpandedFromStorage(): Set<string> | null {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed);
  } catch {
    // fall through
  }
  return null;
}

function saveExpandedToStorage(expanded: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(expanded)));
  } catch {
    // localStorage may be disabled; silently ignore
  }
}

// Which section contains the current location? Used for "keep active group open".
function findActiveSectionLabelKey(
  sections: NavSection[],
  location: string
): string | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.href === location) return section.labelKey;
      if (item.children?.some((c) => c.href === location)) return section.labelKey;
    }
  }
  return null;
}

// ---------------- Sub-components ----------------

interface NavLinkProps {
  item: NavItem;
  isActive: boolean;
  onNavigate: (href: string) => void;
  indent?: boolean;
}

// Single leaf row. Active state = left-edge bar + subtle fill + icon color shift +
// full-strength foreground text. Inactive = near-full-strength text (not muted).
function NavLink({ item, isActive, onNavigate, indent = false }: NavLinkProps) {
  const { t } = useTranslation();
  const Icon = item.icon;

  return (
    <a
      href={item.href ?? '#'}
      onClick={(e) => {
        e.preventDefault();
        if (item.href) onNavigate(item.href);
      }}
      aria-current={isActive ? 'page' : undefined}
      className={[
        'relative flex items-center rounded-md text-[13px] leading-5',
        'gap-2.5',
        indent ? 'pl-9 pr-2' : 'px-2',
        'py-[5px]',
        isActive
          ? 'bg-primary/[0.06] font-semibold text-foreground before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:rounded-r-full before:bg-primary'
          : 'font-medium text-foreground/80 hover:bg-accent/50 hover:text-foreground',
      ].join(' ')}
    >
      {!indent && (
        <Icon
          className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary' : 'text-foreground/60'}`}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
        />
      )}
      {indent && (
        <Icon
          className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-primary' : 'text-foreground/50'}`}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{t(item.nameKey)}</span>
    </a>
  );
}

interface NavParentRowProps {
  item: NavItem;
  isParentActive: boolean;
  expanded: boolean;
  onToggle: () => void;
  activeHref: string;
  onNavigate: (href: string) => void;
}

// Parent-with-children row (expandable, non-navigable itself).
function NavParentRow({ item, isParentActive, expanded, onToggle, activeHref, onNavigate }: NavParentRowProps) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const children = item.children ?? [];

  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className={[
          'group flex items-center w-full rounded-md text-[13px] leading-5 px-2 py-[5px] gap-2.5',
          isParentActive
            ? 'font-semibold text-foreground'
            : 'font-medium text-foreground/80 hover:bg-accent/50 hover:text-foreground',
        ].join(' ')}
      >
        <Icon
          className={`w-4 h-4 flex-shrink-0 ${isParentActive ? 'text-primary' : 'text-foreground/60'}`}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
        />
        <span className="flex-1 text-left truncate">{t(item.nameKey)}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 flex-shrink-0 text-foreground/40 transition-transform duration-150 ease-out ${expanded ? '' : '-rotate-90'}`}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
        />
      </button>
      <CollapsibleBody open={expanded}>
        <ul className="mt-0.5 space-y-0.5" role="list">
          {children.map((child) => (
            <li key={child.nameKey}>
              <NavLink
                item={child}
                isActive={activeHref === child.href}
                onNavigate={onNavigate}
                indent
              />
            </li>
          ))}
        </ul>
      </CollapsibleBody>
    </li>
  );
}

// CSS grid-rows trick for smooth height animation without measuring.
// Wrapper grid's template-rows animates 0fr→1fr; inner div has overflow-hidden
// so the content clips cleanly during transition.
function CollapsibleBody({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        transition: 'grid-template-rows 150ms ease-out',
      }}
      aria-hidden={!open}
    >
      <div className="overflow-hidden">
        <div style={{ opacity: open ? 1 : 0, transition: 'opacity 150ms ease-out' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

interface NavSectionBlockProps {
  section: NavSection;
  expanded: boolean;
  onToggle: () => void;
  activeHref: string;
  onNavigate: (href: string) => void;
  expandedParents: Set<string>;
  onToggleParent: (nameKey: string) => void;
  isParentActive: (parent: NavItem) => boolean;
}

function NavSectionBlock({
  section,
  expanded,
  onToggle,
  activeHref,
  onNavigate,
  expandedParents,
  onToggleParent,
  isParentActive,
}: NavSectionBlockProps) {
  const { t } = useTranslation();

  return (
    <div className="group">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center justify-between w-full px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        <span>
          {t(section.labelKey, mobileSectionLabels[section.labelKey] || section.labelKey)}
        </span>
        {/* Chevron hidden until the section row is hovered — Notion-style reveal */}
        <ChevronDown
          className={`w-3 h-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-all duration-150 ease-out ${expanded ? '' : '-rotate-90'}`}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
        />
      </button>
      <CollapsibleBody open={expanded}>
        <ul className="mt-1 space-y-0.5" role="list">
          {section.items.map((item) => {
            const hasChildren = Boolean(item.children && item.children.length > 0);
            if (hasChildren) {
              return (
                <NavParentRow
                  key={item.nameKey}
                  item={item}
                  isParentActive={isParentActive(item)}
                  expanded={expandedParents.has(item.nameKey)}
                  onToggle={() => onToggleParent(item.nameKey)}
                  activeHref={activeHref}
                  onNavigate={onNavigate}
                />
              );
            }
            return (
              <li key={item.nameKey}>
                <NavLink
                  item={item}
                  isActive={activeHref === item.href}
                  onNavigate={onNavigate}
                />
              </li>
            );
          })}
        </ul>
      </CollapsibleBody>
    </div>
  );
}

// ---------------- Main component ----------------

export default function SimpleNavigation() {
  const [location, setLocation] = useLocation();
  const { user, isAdmin, currentRole } = useAuth();
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  // Filter navigation sections based on role. For parent items with children,
  // we filter children in-place and keep the parent only if at least one
  // child survives.
  const filteredSections = useMemo(() => navigationSections
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
    .filter(section => section.items.length > 0), [isAdmin]);

  const filteredTopLevelItems = useMemo(
    () => topLevelItems.filter(item => itemVisibleToUser(item, isAdmin)),
    [isAdmin]
  );

  // ---- Sidebar expand/collapse state (persisted) ----
  // Initialize from localStorage if available, else default: Inbox + active group.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const fromStorage = loadExpandedFromStorage();
    if (fromStorage) return fromStorage;
    const active = findActiveSectionLabelKey(filteredSections, location);
    const defaults = new Set<string>(['nav.sectionInbox']);
    if (active) defaults.add(active);
    return defaults;
  });

  // Persist on every change.
  useEffect(() => {
    saveExpandedToStorage(expandedSections);
  }, [expandedSections]);

  // If the user navigates into a collapsed section, auto-expand it so the
  // active item is visible. We don't auto-collapse anything.
  useEffect(() => {
    const active = findActiveSectionLabelKey(filteredSections, location);
    if (active && !expandedSections.has(active)) {
      setExpandedSections(prev => {
        const next = new Set(prev);
        next.add(active);
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const toggleSection = (labelKey: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(labelKey)) next.delete(labelKey);
      else next.add(labelKey);
      return next;
    });
  };

  // Nested parent rows (Settings > Practice, Compliance, Data).
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  const toggleParent = (nameKey: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(nameKey)) next.delete(nameKey);
      else next.add(nameKey);
      return next;
    });
  };

  // Auto-expand parents whose child is the active route on first render.
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

  // ---- Location switcher data ----
  const { data: practiceLocations = [] } = useQuery<Array<{ id: number; name: string; isMainLocation: boolean }>>({
    queryKey: ['/api/locations'],
    queryFn: async () => {
      const res = await fetch('/api/locations');
      if (!res.ok) return [];
      return res.json();
    },
  });
  const [selectedLocationId, setSelectedLocationId] = useState<string>('all');

  // ---- Theme ----
  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };
  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const themeLabel = theme === 'dark' ? t('theme.dark') : theme === 'light' ? t('theme.light') : t('theme.system');

  // ---- Mobile more sheet ----
  useEffect(() => { setMoreSheetOpen(false); }, [location]);
  useEffect(() => {
    if (moreSheetOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [moreSheetOpen]);

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

  const getUserInitials = () => {
    const typedUser = user as any;
    if (typedUser?.firstName && typedUser?.lastName) {
      return `${typedUser.firstName[0]}${typedUser.lastName[0]}`.toUpperCase();
    }
    return typedUser?.email?.[0]?.toUpperCase() || 'U';
  };

  const handleNavClick = (href: string) => setLocation(href);

  const isBottomTabActive = (href: string) => {
    if (href === '/') return location === '/';
    return location.startsWith(href);
  };

  const isMoreActive = moreNavItems.some(item => {
    if (!item.href) return false;
    if (item.href === '/') return location === '/';
    return location.startsWith(item.href);
  });

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

      {/* Desktop Navigation */}
      <nav
        role="navigation"
        aria-label={t('nav.mainNavigation')}
        className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 bg-background border-r border-border flex-col z-10"
      >
        {/* Logo row — single structural anchor; keeps its bottom border */}
        <div className="flex items-center h-14 px-4 border-b border-border">
          <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center mr-2.5">
            <FileText className="w-4 h-4 text-primary-foreground" strokeWidth={ICON_STROKE} aria-hidden="true" />
          </div>
          <span className="text-[15px] font-semibold text-foreground tracking-tight">TherapyBill AI</span>
        </div>

        {/* Search / Cmd+K — no background fill, quieter; lives in the nav body */}
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={openCommandPalette}
            className="group flex items-center w-full px-2 py-[5px] rounded-md text-[13px] text-foreground/70 hover:bg-accent/50 hover:text-foreground transition-colors"
            aria-label={t('commandPalette.trigger', 'Search… (⌘K)')}
          >
            <Search className="w-4 h-4 mr-2.5 flex-shrink-0 text-foreground/50" strokeWidth={ICON_STROKE} aria-hidden="true" />
            <span className="flex-1 text-left truncate">{t('commandPalette.trigger', 'Search…')}</span>
            <kbd className="ml-2 text-[10px] font-sans font-medium px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground/80 opacity-60 group-hover:opacity-100 transition-opacity">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Location switcher — no separating border; whitespace separates */}
        {practiceLocations.length > 0 && (
          <div className="px-3 pt-1 pb-2">
            <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
              <SelectTrigger className="w-full h-8 text-[13px] border-border/70">
                <Building2 className="w-3.5 h-3.5 mr-2 text-muted-foreground" strokeWidth={ICON_STROKE} aria-hidden="true" />
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

        {/* Scroll area */}
        <div className="flex-1 px-3 pt-2 pb-3 overflow-y-auto">
          {/* Top-level items (Dashboard) */}
          {filteredTopLevelItems.length > 0 && (
            <ul className="mb-5 space-y-0.5" role="list">
              {filteredTopLevelItems.map((item) => {
                const isActive = item.href === '/' ? location === '/' : location === item.href;
                return (
                  <li key={item.nameKey}>
                    <NavLink
                      item={item}
                      isActive={isActive}
                      onNavigate={handleNavClick}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {/* Sections with 20px rest between each */}
          <div className="space-y-5">
            {filteredSections.map((section) => (
              <NavSectionBlock
                key={section.labelKey}
                section={section}
                expanded={expandedSections.has(section.labelKey)}
                onToggle={() => toggleSection(section.labelKey)}
                activeHref={location}
                onNavigate={handleNavClick}
                expandedParents={expandedParents}
                onToggleParent={toggleParent}
                isParentActive={isParentActive}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border/60 space-y-2">
          <div className="flex items-center justify-center">
            <LanguageSwitcher compact />
          </div>
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7">
              <AvatarImage src={(user as any)?.profileImageUrl} />
              <AvatarFallback className="text-[10px]">{getUserInitials()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-foreground truncate leading-tight">
                {(user as any)?.firstName && (user as any)?.lastName
                  ? `${(user as any).firstName} ${(user as any).lastName}`
                  : (user as any)?.email || 'User'
                }
              </p>
              <p className="text-[10.5px] text-muted-foreground capitalize leading-tight">{currentRole}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={themeLabel}
              title={themeLabel}
              onClick={cycleTheme}
            >
              {(() => { const ThemeIcon = themeIcon; return <ThemeIcon className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} aria-hidden="true" />; })()}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={t('nav.logOut')}
              onClick={() => window.location.href = '/api/logout'}
            >
              <LogOut className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Mobile: Top header bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-background border-b border-border">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center">
            <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center mr-2">
              <FileText className="w-4 h-4 text-primary-foreground" strokeWidth={ICON_STROKE} aria-hidden="true" />
            </div>
            <span className="text-[15px] font-semibold text-foreground tracking-tight">TherapyBill AI</span>
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
              <Search className="w-4 h-4" strokeWidth={ICON_STROKE} aria-hidden="true" />
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
              {(() => { const ThemeIcon = themeIcon; return <ThemeIcon className="w-4 h-4" strokeWidth={ICON_STROKE} aria-hidden="true" />; })()}
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
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <Icon className="w-5 h-5 mb-0.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
                <span className="text-[10px] font-medium leading-tight">{t(item.nameKey)}</span>
              </a>
            );
          })}
          <button
            onClick={() => setMoreSheetOpen(!moreSheetOpen)}
            aria-expanded={moreSheetOpen}
            aria-label="More navigation options"
            className={`flex flex-col items-center justify-center flex-1 min-h-[44px] min-w-[44px] transition-colors ${
              isMoreActive || moreSheetOpen ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <MoreHorizontal className="w-5 h-5 mb-0.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
            <span className="text-[10px] font-medium leading-tight">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile: More sheet */}
      {moreSheetOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setMoreSheetOpen(false)}
            aria-hidden="true"
          />
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-2xl border-t border-border max-h-[75vh] flex flex-col animate-in slide-in-from-bottom duration-300">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
            </div>
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
                <LogOut className="w-4 h-4" strokeWidth={ICON_STROKE} aria-hidden="true" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 pb-20">
              {moreNavSections.map((section) => (
                <div key={section.labelKey} className="mb-4">
                  <h3 className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 px-1 mb-2">
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
                                ? 'bg-primary/[0.06] text-foreground before:content-[""]'
                                : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground'
                            }`}
                          >
                            <Icon
                              className={`w-5 h-5 mb-1.5 ${isActive ? 'text-primary' : 'text-foreground/60'}`}
                              strokeWidth={ICON_STROKE}
                              aria-hidden="true"
                            />
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

/**
 * Shared navigation config consumed by both the sidebar (SimpleNavigation)
 * and the Cmd+K command palette. Keeping this in one place prevents the
 * two surfaces from drifting apart.
 */

import {
  Home,
  Users,
  FileText,
  TrendingUp,
  Receipt,
  Settings,
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
  CreditCard,
  Handshake,
  Target,
  Building2,
  Brain,
  UserCheck,
  Download,
  Upload,
  ClipboardList,
  LogIn,
  AlertTriangle,
  Bell,
  Mail,
  Activity,
  Link2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  nameKey: string;
  href?: string;
  icon: LucideIcon;
  adminOnly: boolean;
  /** Practice financials (rates, claim charges, ERAs, revenue): visible to
   * admin + billing roles, hidden from therapists. The server enforces the
   * same boundary via requireFinancialRole — this only keeps the nav honest. */
  financial?: boolean;
  children?: NavItem[];
}

export interface NavSection {
  labelKey: string;
  items: NavItem[];
}

// Top-level items rendered above the collapsible sections (no section header).
export const topLevelItems: NavItem[] = [
  { nameKey: 'nav.dashboard', href: '/', icon: Home, adminOnly: false },
];

export const navigationSections: NavSection[] = [
  {
    labelKey: 'nav.sectionInbox',
    items: [
      { nameKey: 'nav.messages', href: '/messages', icon: MessageSquare, adminOnly: false },
      { nameKey: 'nav.aiInsights', href: '/ai-insights', icon: Brain, adminOnly: false },
    ],
  },
  {
    labelKey: 'nav.sectionClinical',
    items: [
      { nameKey: 'nav.patients', href: '/patients', icon: Users, adminOnly: false },
      { nameKey: 'nav.patientIntake', href: '/intake', icon: ClipboardList, adminOnly: false },
      { nameKey: 'nav.calendar', href: '/calendar', icon: Calendar, adminOnly: false },
      { nameKey: 'nav.soapNotes', href: '/soap-notes', icon: ClipboardList, adminOnly: false },
      { nameKey: 'nav.treatmentPlans', href: '/treatment-plans', icon: Target, adminOnly: false },
      { nameKey: 'nav.telehealth', href: '/telehealth', icon: Video, adminOnly: false },
      { nameKey: 'nav.outcomeMeasures', href: '/outcome-measures', icon: BarChart3, adminOnly: false },
      { nameKey: 'nav.surveys', href: '/surveys', icon: ClipboardList, adminOnly: false },
    ],
  },
  {
    labelKey: 'nav.sectionScheduling',
    items: [
      { nameKey: 'nav.frontDesk', href: '/front-desk', icon: LogIn, adminOnly: false },
      { nameKey: 'nav.waitlist', href: '/waitlist', icon: Clock, adminOnly: false },
      { nameKey: 'nav.onlineBooking', href: '/online-booking', icon: CalendarCheck, adminOnly: false },
      { nameKey: 'nav.insights', href: '/scheduling-insights', icon: CalendarClock, adminOnly: false },
      { nameKey: 'nav.reviews', href: '/reviews', icon: Star, adminOnly: false },
    ],
  },
  {
    labelKey: 'nav.sectionBilling',
    items: [
      { nameKey: 'nav.claims', href: '/claims', icon: FileText, adminOnly: false, financial: true },
      // Cockpit + ledger were adminOnly, but their APIs allow the billing
      // role too — `financial` matches the nav to what the server permits.
      { nameKey: 'nav.billerCockpit', href: '/biller-cockpit', icon: ClipboardList, adminOnly: false, financial: true },
      { nameKey: 'nav.recoveryLedger', href: '/recovery-ledger', icon: DollarSign, adminOnly: false, financial: true },
      { nameKey: 'nav.era835', href: '/remittance', icon: Receipt, adminOnly: false, financial: true },
      { nameKey: 'nav.appeals', href: '/appeals', icon: Scale, adminOnly: false, financial: true },
      { nameKey: 'nav.revenueAtRisk', href: '/revenue-at-risk', icon: AlertTriangle, adminOnly: false, financial: true },
      { nameKey: 'nav.payerContracts', href: '/payer-contracts', icon: Handshake, adminOnly: false, financial: true },
      { nameKey: 'nav.rates', href: '/insurance-rates', icon: DollarSign, adminOnly: false, financial: true },
      { nameKey: 'nav.reimbursement', href: '/reimbursement', icon: TrendingUp, adminOnly: false, financial: true },
      { nameKey: 'nav.expenses', href: '/expenses', icon: Receipt, adminOnly: false, financial: true },
      { nameKey: 'nav.accounting', href: '/accounting', icon: DollarSign, adminOnly: true },
    ],
  },
  {
    labelKey: 'nav.sectionReports',
    items: [
      { nameKey: 'nav.analytics', href: '/analytics', icon: TrendingUp, adminOnly: true },
      { nameKey: 'nav.productivity', href: '/therapist-productivity', icon: UserCheck, adminOnly: false },
      { nameKey: 'nav.benchmarking', href: '/benchmarking', icon: BarChart3, adminOnly: true },
      { nameKey: 'nav.reportBuilder', href: '/reports', icon: BarChart3, adminOnly: false },
    ],
  },
  {
    labelKey: 'nav.sectionSettings',
    items: [
      {
        nameKey: 'nav.practice',
        icon: Building2,
        adminOnly: false,
        children: [
          { nameKey: 'nav.practiceDetails', href: '/settings', icon: Settings, adminOnly: false },
          { nameKey: 'nav.locations', href: '/locations', icon: Building2, adminOnly: false },
          { nameKey: 'nav.payerManagement', href: '/payer-management', icon: Shield, adminOnly: true },
          { nameKey: 'nav.payerEnrollments', href: '/payer-enrollments', icon: Handshake, adminOnly: false, financial: true },
          // Billing role manages enrollments too (was adminOnly, which kept
          // billing staff out of a surface their API access allows).
          { nameKey: 'nav.providerProfile', href: '/provider-profile', icon: Building2, adminOnly: false, financial: true },
          { nameKey: 'nav.payerMapping', href: '/payer-mapping', icon: Link2, adminOnly: true },
          { nameKey: 'nav.enrollmentOverview', href: '/enrollment-overview', icon: BarChart3, adminOnly: true },
          { nameKey: 'nav.credentialing', href: '/credentialing', icon: ShieldCheck, adminOnly: true },
          { nameKey: 'nav.stediReadiness', href: '/stedi-readiness', icon: Activity, adminOnly: true },
        ],
      },
      {
        nameKey: 'nav.complianceGroup',
        icon: ShieldCheck,
        adminOnly: true,
        children: [
          { nameKey: 'nav.hipaaCompliance', href: '/hipaa-compliance', icon: Shield, adminOnly: true },
          { nameKey: 'nav.breachIncidents', href: '/breach-incidents', icon: ShieldAlert, adminOnly: true },
          { nameKey: 'nav.compliance', href: '/compliance', icon: ShieldCheck, adminOnly: true },
        ],
      },
      {
        nameKey: 'nav.data',
        icon: Download,
        adminOnly: true,
        children: [
          { nameKey: 'nav.dataImport', href: '/data-import', icon: Upload, adminOnly: true },
          { nameKey: 'nav.dataExport', href: '/data-export', icon: Download, adminOnly: true },
        ],
      },
      {
        nameKey: 'nav.notificationsGroup',
        icon: Bell,
        adminOnly: false,
        children: [
          { nameKey: 'nav.notificationTemplates', href: '/notification-templates', icon: Mail, adminOnly: true },
          { nameKey: 'nav.notificationPreferences', href: '/notification-settings', icon: Bell, adminOnly: false },
        ],
      },
      { nameKey: 'nav.subscription', href: '/subscription', icon: CreditCard, adminOnly: true },
      { nameKey: 'nav.preferences', href: '/settings', icon: Settings, adminOnly: false },
    ],
  },
];

// Section label fallbacks (used if i18n key missing or for the mobile "More" sheet).
export const sectionLabelFallbacks: Record<string, string> = {
  'nav.sectionInbox': 'Inbox',
  'nav.sectionClinical': 'Clinical',
  'nav.sectionScheduling': 'Scheduling',
  'nav.sectionBilling': 'Billing',
  'nav.sectionReports': 'Reports',
  'nav.sectionSettings': 'Settings',
};

// Flatten a NavItem tree (including children) into a list of leaf items
// visible to the current user. Leaves always have an href.
export function flattenNavItems(
  items: NavItem[],
  isAdmin: boolean,
  hasFinancialAccess: boolean,
): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    if (item.adminOnly && !isAdmin) continue;
    if (item.financial && !hasFinancialAccess) continue;
    if (item.children && item.children.length > 0) {
      out.push(...flattenNavItems(item.children, isAdmin, hasFinancialAccess));
    } else if (item.href) {
      out.push(item);
    }
  }
  return out;
}

// Section is visible if it has at least one visible leaf. Parent items with
// all-adminOnly children effectively become admin-only themselves.
export function itemVisibleToUser(
  item: NavItem,
  isAdmin: boolean,
  hasFinancialAccess: boolean,
): boolean {
  if (item.adminOnly && !isAdmin) return false;
  if (item.financial && !hasFinancialAccess) return false;
  if (item.children && item.children.length > 0) {
    return item.children.some((c) => itemVisibleToUser(c, isAdmin, hasFinancialAccess));
  }
  return true;
}

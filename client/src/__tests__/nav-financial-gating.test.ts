/**
 * Therapist-role users must not see practice-financial nav destinations
 * (claims, fee schedule / rates, ERAs, revenue). Admin and billing roles
 * keep them. Server-side the same boundary is requireFinancialRole.
 */
import { describe, it, expect } from 'vitest';
import {
  navigationSections,
  topLevelItems,
  itemVisibleToUser,
  flattenNavItems,
  type NavItem,
} from '@/lib/nav-config';

const billingSection = navigationSections.find((s) => s.labelKey === 'nav.sectionBilling')!;

function visibleNames(isAdmin: boolean, hasFinancialAccess: boolean): string[] {
  return navigationSections
    .flatMap((s) => flattenNavItems(s.items, isAdmin, hasFinancialAccess))
    .map((i) => i.nameKey);
}

describe('financial nav gating', () => {
  it('hides every billing-section item from therapists', () => {
    for (const item of billingSection.items) {
      expect(
        itemVisibleToUser(item, false, false),
        `${item.nameKey} should be hidden from therapist role`,
      ).toBe(false);
    }
  });

  it('shows financial items to the billing role (not just admin)', () => {
    const names = visibleNames(false, true);
    expect(names).toContain('nav.claims');
    expect(names).toContain('nav.rates');
    expect(names).toContain('nav.billerCockpit');
    expect(names).toContain('nav.era835');
  });

  it('leaves clinical + scheduling nav intact for therapists', () => {
    const names = visibleNames(false, false);
    expect(names).toContain('nav.patients');
    expect(names).toContain('nav.calendar');
    expect(names).toContain('nav.soapNotes');
    expect(names).toContain('nav.messages');
  });

  it('keeps the dashboard for everyone', () => {
    for (const item of topLevelItems) {
      expect(itemVisibleToUser(item, false, false)).toBe(true);
    }
  });

  it('every rate/revenue-sounding item carries the financial flag', () => {
    // Guard against someone adding a new money page without the flag.
    const moneyWords = /rate|revenue|billing|claim|payment|era|remit|expense|accounting|reimburse/i;
    const walk = (items: NavItem[]): NavItem[] => items.flatMap((i) => [i, ...(i.children ? walk(i.children) : [])]);
    const suspects = walk(billingSection.items).filter((i) => i.href && moneyWords.test(i.href));
    for (const item of suspects) {
      expect(
        item.financial || item.adminOnly,
        `${item.nameKey} (${item.href}) looks financial but has no financial/adminOnly flag`,
      ).toBe(true);
    }
  });
});

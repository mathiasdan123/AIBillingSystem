import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guard for the "dropdown opens invisibly behind the dialog" bug.
 *
 * DialogContent sits at z-[51] (bumped from z-50 in 0499823 for an overlay
 * stacking fix). Radix portals floating content (popover, select, dropdown
 * menu, tooltip) to <body>, outside the dialog's stacking context, so any
 * such layer with z-index <= 51 renders BEHIND an open dialog: the trigger
 * reports open/aria-expanded but nothing visible appears. This shipped twice:
 * select.tsx was bumped to z-[60] at some point, popover.tsx was missed and
 * broke the Create New Claim patient picker in production (reported
 * 2026-08-19; reproduced live against the demo practice).
 *
 * The z-index utility lives in a Tailwind class string, which tsc can't
 * check, so this test scans the source of every portalled floating-layer
 * primitive and asserts its z-index clears DialogContent's.
 */

const UI_DIR = resolve(__dirname, '../components/ui');

function zIndexOf(file: string): number[] {
  const src = readFileSync(resolve(UI_DIR, file), 'utf8');
  const matches = [...src.matchAll(/[\s"]z-(?:\[(\d+)\]|(\d+))[\s"]/g)];
  return matches.map((m) => parseInt(m[1] ?? m[2], 10));
}

describe('floating layers stack above dialogs', () => {
  const dialogZ = Math.max(...zIndexOf('dialog.tsx'));

  it('locates DialogContent z-index', () => {
    expect(dialogZ).toBeGreaterThanOrEqual(50);
  });

  // Every primitive whose content Radix portals to <body>. If you add a new
  // one (context menu, hover card, menubar...), add it here.
  const floatingPrimitives = [
    'popover.tsx',
    'select.tsx',
    'dropdown-menu.tsx',
    'tooltip.tsx',
  ];

  for (const file of floatingPrimitives) {
    it(`${file} content renders above an open dialog`, () => {
      const zs = zIndexOf(file);
      expect(zs.length).toBeGreaterThan(0);
      // Inner elements (sticky headers, scroll buttons) may use small z
      // values scoped to the content's own stacking context; the invariant
      // is that the outermost portalled layer clears the dialog.
      const outermost = Math.max(...zs);
      expect(
        outermost,
        `${file}'s floating layer is z-${outermost}, hidden behind z-${dialogZ} DialogContent`,
      ).toBeGreaterThan(dialogZ);
    });
  }
});

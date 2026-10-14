import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Sidebar-offset layout guard (2026-10-14 audit, issue: content clipped
 * under the fixed sidebar at ~1024px).
 *
 * SimpleNavigation renders a `fixed left-0 w-64` sidebar from the md
 * breakpoint up. The 256px offset that clears it is owned by ONE element:
 * the authenticated `<main id="main-content">` wrapper in App.tsx. It used
 * to be a per-page `md:ml-64`, and pages that forgot it (initial-evaluation,
 * support-tickets, …) rendered partially underneath the sidebar — left edges
 * of cards and buttons were hidden and unclickable.
 *
 * jsdom cannot measure fixed-position overlap, so this is a source-level
 * assertion:
 *   1. App.tsx's layout wrapper carries the offset class.
 *   2. No page or component re-adds md:ml-64 (which would now DOUBLE the
 *      offset to 512px).
 */

// Vitest runs from the repo root (vitest.config.client.ts); under the jsdom
// environment import.meta.url is an http: URL, so resolve from cwd instead.
const srcRoot = path.resolve(process.cwd(), 'client', 'src');

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsx(full));
    else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\.(tsx|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('fixed-sidebar layout offset', () => {
  it('App.tsx owns the sidebar offset on the authenticated <main> wrapper', () => {
    const appSrc = fs.readFileSync(path.join(srcRoot, 'App.tsx'), 'utf8');
    expect(appSrc).toMatch(
      /<main id="main-content" className="md:ml-64 print:ml-0">/,
    );
  });

  it('the sidebar itself is still fixed and 64 wide at md+ (offset must match)', () => {
    const navSrc = fs.readFileSync(
      path.join(srcRoot, 'components', 'SimpleNavigation.tsx'),
      'utf8',
    );
    // If someone changes the sidebar's width or breakpoint, the md:ml-64 on
    // the layout wrapper must change with it — this pins the pairing.
    expect(navSrc).toMatch(/hidden md:flex fixed left-0 top-0 bottom-0 w-64/);
  });

  it('no page or component re-adds md:ml-64 (would double the offset)', () => {
    const files = [
      ...walkTsx(path.join(srcRoot, 'pages')),
      ...walkTsx(path.join(srcRoot, 'components')),
    ];
    const offenders = files.filter((f) =>
      fs.readFileSync(f, 'utf8').includes('md:ml-64'),
    );
    expect(
      offenders.map((f) => path.relative(srcRoot, f)),
      'md:ml-64 belongs only on App.tsx\'s <main id="main-content"> — pages inherit it',
    ).toEqual([]);
  });
});

/**
 * Every API endpoint the client calls must exist on the server.
 *
 * On 2026-08-26 the New Claim dialog's diagnosis picker rendered empty during
 * a live billing session. The cause: the client had queried /api/icd10-codes
 * since the day it was written, and the server had NEVER served it — every
 * request 404'd, and a 404 is indistinguishable from an empty list in a
 * dropdown. It became a hard production blocker the moment a diagnosis was
 * made mandatory. The same class of silence hid the dead Stedi endpoints for
 * months.
 *
 * This test closes the class, statically: it extracts every /api/... URL the
 * client source references, extracts every route the server registers
 * (mount prefixes from routes.ts x router methods in each route file), and
 * fails naming any client URL with no matching server route.
 *
 * Static-source based on purpose: importing 60+ route modules would need the
 * whole db/auth graph mocked, and a mock that big stops resembling the app.
 * The trade-off is a conservative matcher — dynamic URL segments are
 * normalized to a wildcard, so this catches "route missing entirely", not
 * "wrong parameter shape". That is exactly the class that has hurt.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}

/** Client URLs: normalize template params and query strings away. */
function collectClientUrls(): Map<string, string[]> {
  const usages = new Map<string, string[]>();
  for (const file of walk(path.join(ROOT, 'client/src'), ['.ts', '.tsx'])) {
    if (file.includes('__tests__')) continue; // fixture URLs, not real calls
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/["'`](\/api\/[A-Za-z0-9/_${}.:?=&-]*)/g)) {
      let url = m[1];
      url = url.split('?')[0];                       // query string off
      url = url.replace(/\$\{[^}]*\}/g, '*');        // ${id} -> wildcard
      url = url.replace(/\$\{.*$/, '*');             // unterminated template tail
      url = url.replace(/([^/])\*$/, '$1');          // glued tail: '/waitlist*' -> '/waitlist'
      url = url.replace(/\/+$/, '');
      if (!url || url === '/api') continue;
      // A trailing wildcard-only URL like /api/* tells us nothing.
      if (/^\/api\/?\*?$/.test(url)) continue;
      const rel = path.relative(ROOT, file);
      if (!usages.has(url)) usages.set(url, []);
      usages.get(url)!.push(rel);
    }
  }
  return usages;
}

/** Server routes: mount prefixes from routes.ts x paths in each route file. */
function collectServerRoutes(): string[] {
  const routes: string[] = [];
  const routesTs = fs.readFileSync(path.join(ROOT, 'server/routes.ts'), 'utf8');

  // app.use('/api/xyz', someRouter) mounts — from EVERY server file, because
  // they are not all in routes.ts: replitAuth mounts localAuth at /api/auth,
  // and missing that made six perfectly-served auth pages look broken.
  const mounts: Array<{ prefix: string; router: string | null; sourceFile: string }> = [];
  for (const file of walk(path.join(ROOT, 'server'), ['.ts'])) {
    if (file.includes('__tests__')) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/app\.use\(\s*["'`](\/api[^"'`]*)["'`]\s*,\s*([A-Za-z0-9_]+)/g)) {
      mounts.push({ prefix: m[1], router: m[2], sourceFile: file });
    }
  }

  // Direct app.<method>('...') registrations from EVERY server file — the
  // register*Routes(app) helpers (BAA, breach management, compliance...) and
  // replitAuth (login/logout/callback) register straight on the app object,
  // not through a mounted router. Scanning only routes.ts missed all of them
  // and flagged working pages as broken.
  for (const file of walk(path.join(ROOT, 'server'), ['.ts'])) {
    if (file.includes('__tests__')) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/app\.(get|post|put|patch|delete|use|all)\(\s*["'`](\/api[^"'`]*)["'`]/g)) {
      routes.push(m[2]);
    }
  }

  // Map router variable -> file. Import lines look like:
  //   import { fooRouter, barRouter } from './routes/index' or './routes'
  // The route files themselves live in server/routes/*.ts; resolve by
  // scanning every route file for its default-export router paths and
  // attaching every mount prefix that names it. Simpler and robust:
  // apply EVERY route file's paths to EVERY prefix it is mounted under by
  // name-match on the import.
  const routeFiles = walk(path.join(ROOT, 'server/routes'), ['.ts']);
  const fileForRouter = new Map<string, string>();
  // routes/index.ts (or routes.ts) re-exports: import fooRouter from './routes/foo'
  // Direct default imports in routes.ts: import xRoutes from "./routes/x";
  for (const m of routesTs.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+["'`]\.\/routes\/([A-Za-z0-9_-]+)["'`]/g)) {
    fileForRouter.set(m[1], path.join(ROOT, 'server/routes', `${m[2]}.ts`));
  }
  const indexCandidates = [path.join(ROOT, 'server/routes/index.ts')];
  for (const cand of indexCandidates) {
    if (!fs.existsSync(cand)) continue;
    const idx = fs.readFileSync(cand, 'utf8');
    for (const m of idx.matchAll(/import\s+(?:\{\s*default\s+as\s+)?([A-Za-z0-9_]+)\s*\}?\s+from\s+["'`]\.\/([A-Za-z0-9_-]+)["'`]/g)) {
      fileForRouter.set(m[1], path.join(ROOT, 'server/routes', `${m[2]}.ts`));
    }
    for (const m of idx.matchAll(/export\s*\{\s*default\s+as\s+([A-Za-z0-9_]+)\s*\}\s*from\s+["'`]\.\/([A-Za-z0-9_-]+)["'`]/g)) {
      fileForRouter.set(m[1], path.join(ROOT, 'server/routes', `${m[2]}.ts`));
    }
  }

  const pathsInFile = (file: string): string[] => {
    if (!fs.existsSync(file)) return [];
    const src = fs.readFileSync(file, 'utf8');
    const out: string[] = [];
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete|use)\(\s*["'`]([^"'`]+)["'`]/g)) {
      out.push(m[2]);
    }
    return out;
  };

  // Same-file import resolution: `import x from "./routes/y"` in whichever
  // file declared the mount.
  for (const { router, sourceFile } of mounts) {
    if (!router || fileForRouter.has(router)) continue;
    const src = fs.readFileSync(sourceFile, 'utf8');
    // Quotes only in the class — a backtick would end the template literal.
    const m = src.match(new RegExp(`import\\s+${router}\\s+from\\s+["'].{0,4}?/routes/([A-Za-z0-9_-]+)["']`));
    if (m) fileForRouter.set(router, path.join(ROOT, 'server/routes', `${m[1]}.ts`));
  }

  for (const { prefix, router } of mounts) {
    // Middleware mounts (auditMiddleware, requireFinancialRole, MFA gates...)
    // are not routers; treating them as catch-alls made /api/#any match every
    // URL and the whole test prove nothing — it passed first try against a
    // codebase that shipped a missing route THAT SAME DAY. Only identifiers
    // that name a router may fall back to a catch-all.
    const looksLikeRouter = !!router && /Router$|Routes$/.test(router);
    if (!looksLikeRouter) continue;
    const file = router ? fileForRouter.get(router) : undefined;
    const subPaths = file ? pathsInFile(file) : [];
    if (subPaths.length === 0) {
      // A real router we could not resolve to a file (aliased import). Be
      // conservative for THAT PREFIX only.
      routes.push(prefix.replace(/\/$/, '') + '/#any');
      continue;
    }
    for (const sub of subPaths) {
      routes.push((prefix.replace(/\/$/, '') + (sub === '/' ? '' : sub)).replace(/\/$/, '') || prefix);
    }
  }
  return routes;
}

/** Does a client URL match a server route pattern? */
function matches(url: string, route: string): boolean {
  if (route.endsWith('/#any')) {
    return url.startsWith(route.slice(0, -'/#any'.length));
  }
  const u = url.split('/').filter(Boolean);
  const r = route.split('/').filter(Boolean);
  if (u.length !== r.length) return false;
  for (let i = 0; i < r.length; i++) {
    const rs = r[i];
    const us = u[i];
    if (rs.startsWith(':')) continue;      // server param matches anything
    if (us === '*') continue;              // client template matches anything
    if (rs !== us) return false;
  }
  return true;
}

describe('every client API call has a server route', () => {
  it('finds no client URL without a matching route', () => {
    const clientUrls = collectClientUrls();
    const serverRoutes = collectServerRoutes();

    expect(clientUrls.size).toBeGreaterThan(100); // extraction sanity
    expect(serverRoutes.length).toBeGreaterThan(100);

    const missing: string[] = [];
    for (const [url, files] of clientUrls) {
      const exact = serverRoutes.some((r) => matches(url, r));
      // Prefix building: the client often holds '/api/public/portal' in a
      // variable and concatenates '/<token>/documents' at call time. A URL
      // that is a strict prefix of a real route is fine.
      const isPrefix = serverRoutes.some((r) => r.startsWith(url + '/'));
      if (!exact && !isPrefix) {
        missing.push(`${url}  (used in ${files[0]})`);
      }
    }

    // Ratchet, not aspiration. These client calls have NO server route TODAY;
    // each is a page silently rendering empty (the icd10-codes failure mode).
    // The test forbids NEW entries, and forbids stale entries once fixed —
    // remove the line when you add the route. Triage notes per entry.
    // NOT listed but known-suspect: /api/notification-preferences passes only
    // via the prefix rule (server route is .../me; the client omits /me). The
    // matcher cannot see wrong-suffix bugs — only wholly missing routes.
    const KNOWN_MISSING = new Set<string>([
      '/api/expenses',                    // ExpenseTracker component — no expenses route anywhere
      '/api/eligibility-checks',          // analytics page still calls the endpoint retired with the dead Stedi paths
      '/api/patient-portal/notification-preferences', // portal profile — route never existed
      '/api/patients/*/assessments/trends', // outcome-measures page; server has /api/surveys/patient/:id/history
      '/api/assessments',                 // outcome-measures page — no assessments route
    ]);
    const newlyMissing = missing.filter((m) => !KNOWN_MISSING.has(m.split('  ')[0]));
    const fixedButListed = [...KNOWN_MISSING].filter(
      (k) => !missing.some((m) => m.split('  ')[0] === k),
    );

    expect(
      newlyMissing,
      `Client calls with NO server route (new since the ratchet):\n  ${newlyMissing.join('\n  ')}`,
    ).toEqual([]);
    expect(
      fixedButListed,
      `These are fixed — remove them from KNOWN_MISSING:\n  ${fixedButListed.join('\n  ')}`,
    ).toEqual([]);
  });
});

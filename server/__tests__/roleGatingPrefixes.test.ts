/**
 * Role-gating audit — the routes.ts prefix-gate block.
 *
 * requireFinancialRole's own behavior (therapist → 403, billing/admin pass,
 * fail closed) is covered by financialAccess.test.ts. What that cannot catch
 * is a prefix silently missing from the gate block in server/routes.ts — the
 * exact gap the audit found for insurance-rates, benchmarking,
 * patient-statements, the billing worklists, payment plans and reimbursement.
 *
 * Static-source based, like clientRoutesExist.test.ts, because registering
 * the real registerRoutes() needs the whole db/auth graph. The assertion is
 * ordering-aware: the gate must appear BEFORE any router mount of the same
 * prefix, or Express would serve the route handler first.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const routesTs = fs.readFileSync(path.resolve(__dirname, '../routes.ts'), 'utf8');

/** Prefixes that must be financial-gated (admin/billing only). */
const FINANCIAL_GATED_PREFIXES = [
  // Pre-audit block (regression guard)
  '/api/claims',
  '/api/fee-schedules',
  '/api/payer-contracts',
  '/api/remittance',
  '/api/reconciliation',
  '/api/revenue-at-risk',
  '/api/payment-postings',
  '/api/payer-intel',
  '/api/superbills',
  '/api/appeals',
  '/api/billing',
  '/api/payment-transactions',
  '/api/provider-profile',
  '/api/payer-enrollments',
  '/api/daily-report',
  '/api/practice-analytics',
  // Role-gating audit additions
  '/api/insurance-rates',    // F1
  '/api/reimbursement',      // F11
  '/api/benchmarking',       // F6
  '/api/patient-statements', // F7
  '/api/billing-tasks',      // F8
  '/api/billing-documents',  // F8
  '/api/claim-corrections',  // F8
  '/api/follow-ups',         // F8
  '/api/payment-plans',      // F9
  '/api/installments',       // F9
  '/api/payment-settings',   // F9
  '/api/expenses',           // wired with the new expenses router
];

/** Escape every regex metacharacter (incl. backslashes), not just slashes. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

function gateIndex(prefix: string): number {
  const re = new RegExp(
    `app\\.use\\(\\s*['"\`]${escapeRe(prefix)}['"\`]\\s*,\\s*requireFinancialRole\\s*\\)`,
  );
  const m = routesTs.match(re);
  return m?.index ?? -1;
}

function firstMountIndex(prefix: string): number {
  // First app.use('<prefix>', <somethingElse>) that is NOT the gate itself.
  const re = new RegExp(
    `app\\.use\\(\\s*['"\`]${escapeRe(prefix)}['"\`]\\s*,\\s*(?!requireFinancialRole)[A-Za-z]`,
    'g',
  );
  const m = re.exec(routesTs);
  return m?.index ?? Number.MAX_SAFE_INTEGER;
}

describe('routes.ts financial prefix gates (role-gating audit)', () => {
  it.each(FINANCIAL_GATED_PREFIXES)('gates %s with requireFinancialRole', (prefix) => {
    expect(gateIndex(prefix), `missing: app.use('${prefix}', requireFinancialRole)`).toBeGreaterThanOrEqual(0);
  });

  it.each(FINANCIAL_GATED_PREFIXES)('gate for %s appears before any router mount of it', (prefix) => {
    const gate = gateIndex(prefix);
    if (gate < 0) return; // covered by the test above
    expect(gate, `gate for ${prefix} must run before its router`).toBeLessThan(firstMountIndex(prefix));
  });
});

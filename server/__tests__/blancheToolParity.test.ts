/**
 * P1.4 — Blanche tool parity / drift detection.
 *
 * Background: during P0.6 we shipped six new tools to the in-app Blanche
 * dispatcher (server/routes/ai-assistant.ts) but forgot to mirror them
 * into the MCP registry (server/mcp/tools/*). They were "half-built" by
 * the Blanche-first standard, and we only caught it on a dogfood pass.
 * P0.6.5 backfilled them — this test prevents the same gap from
 * recurring.
 *
 * What this test enforces:
 *
 *   1. The two source files are the only inventory authority. We extract
 *      tool names from them with regex (no module instantiation needed —
 *      avoids dragging the DB connection into unit tests).
 *
 *   2. Every tool exposed on either surface must be classified — it
 *      either belongs to PARITY_TOOLS (must exist in both), or to
 *      SURFACE_ONLY_REASONS with a one-line justification. Silent surface-
 *      only tools fail the build. This forces the author of any new tool
 *      to make the Blanche-first decision explicitly.
 *
 *   3. Every PARITY_TOOLS entry must actually be present in both
 *      surfaces. This is the original "exposure gap" check from P0.6.
 *
 * Adding or renaming a tool? You will see this test fail. The error tells
 * you exactly what to add to which list — usually a single line edit
 * here. The friction is intentional.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');

// ── Source-file extraction ───────────────────────────────────────────

function extractInAppToolNames(): Set<string> {
  const src = readFileSync(
    join(REPO_ROOT, 'server', 'routes', 'ai-assistant.ts'),
    'utf8',
  );
  // Tools live inside an `assistantTools` array. Each entry is an
  // object literal whose first key is `name: 'tool_name'`. The regex is
  // anchored to that pattern; comments mentioning `name:` elsewhere
  // won't match because they lack the indentation + quote shape.
  const names = new Set<string>();
  const re = /^\s{4}name:\s*'([a-z_][a-z0-9_]*)'/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

function extractMcpToolNames(): Set<string> {
  // Each MCP tool registers via `server.tool('name', ...)`. We scan every
  // file under server/mcp/tools/.
  const fs = require('node:fs') as typeof import('node:fs');
  const dir = join(REPO_ROOT, 'server', 'mcp', 'tools');
  const names = new Set<string>();
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.ts')) continue;
    const src = fs.readFileSync(join(dir, entry), 'utf8');
    const re = /server\.tool\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

// ── Canonical inventories (UPDATE WHEN ADDING TOOLS) ─────────────────

/**
 * Tools that MUST exist on both surfaces. Adding to this list is the
 * Blanche-first commitment: every clinician/billing action a therapist
 * can do via the web chat must also be doable conversationally through
 * MCP. Surface-only intentionally narrow exceptions live in
 * SURFACE_ONLY_REASONS below.
 */
const PARITY_TOOLS: ReadonlySet<string> = new Set([
  'add_claim_line_item',
  'batch_eligibility_check',
  'bulk_eligibility_by_filter',
  'cancel_appointment',
  'check_eligibility',
  'check_in_appointment',
  'check_out_appointment',
  'create_appointment',
  'create_appointment_self_pay_invoice',
  'create_invoice',
  'create_patient',
  'draft_underpayment_dispute',
  'generate_appeal_letter',
  'generate_soap_note',
  'get_appointments',
  'get_claim_status',
  'get_ar_aging',
  'get_collection_rate',
  'get_dashboard_stats',
  'get_overdue_claims',
  'get_prior_session_notes',
  'get_revenue_by_month',
  'list_notification_templates',
  'mark_no_show',
  'reschedule_appointment',
  'review_denied_claims',
  'review_underpayments',
  'search_patients',
  'search_payer',
  'send_appointment_reminder',
  'send_patient_payment_link',
  'session_end',
  'session_start',
  'sign_soap_note',
  'submit_claim',
  'suggest_appointment_slot',
  'suggest_claim_correction',
  'update_notification_template',
  'update_patient_insurance',
  'update_soap_draft',
  'verify_benefits',
]);

/**
 * Tools that are intentionally exposed on only one surface. The value is
 * a one-line reason — keep it tight. If you can't justify the
 * single-surface exposure in a line, the tool probably belongs in
 * PARITY_TOOLS.
 *
 * Two reason categories appear here:
 *
 *   (a) UX/transport-bound: the tool only makes sense on the web chat
 *       (e.g. `navigate_user` which drives the React router). MCP has no
 *       equivalent affordance.
 *
 *   (b) Naming drift: MCP exposes a tool under a slightly different
 *       name than the in-app dispatcher. These are technical-debt
 *       entries — they should eventually be canonicalized so both
 *       surfaces use the same name. Tagged `[rename-debt]`.
 */
const SURFACE_ONLY_REASONS: Record<string, string> = {
  // ── in-app only: web-chat UX / admin / onboarding ──
  navigate_user: 'in-app only: drives client-side React router; no MCP analog',
  enable_demo_mode: 'in-app only: onboarding affordance',
  clear_demo_data: 'in-app only: onboarding affordance',
  find_legacy_demo_candidates: 'in-app only: admin one-off helper',
  mark_patients_as_demo: 'in-app only: admin one-off helper',
  unmark_demo_patients: 'in-app only: admin one-off helper',
  get_practice_setup_status: 'in-app only: drives the in-app onboarding checklist',
  send_patient_portal_invite: 'in-app only: web-chat flow with a button affordance',

  // ── in-app only: tool overlaps a PARITY tool semantically; merge or alias decision pending ──
  get_patient_count: 'in-app only: lightweight aggregate; folded into get_dashboard_stats on MCP',
  get_claims_by_status: 'in-app only: drilldown view; covered by get_dashboard_stats counts on MCP',
  get_top_denial_reasons: 'in-app only: drilldown view; MCP relies on review_denied_claims',
  get_provider_productivity: 'in-app only: web-chart drilldown',
  get_appeal_outcomes: 'in-app only: report view',
  check_plan_document_status: 'in-app only: payer-config status read',
  summarize_recent_eobs: 'in-app only: web-chat summarization; raw data via MCP era tools',

  // (The 7 former BACKFILL CANDIDATE tools — create_appointment,
  //  suggest_appointment_slot, send_appointment_reminder, review_denied_claims,
  //  review_underpayments, draft_underpayment_dispute, suggest_claim_correction
  //  — were mirrored onto MCP and promoted to PARITY_TOOLS above.)

  // ── MCP only ──
  get_patient: 'MCP only: single-record lookup; complements search_patients (list)',
  get_era_summary: 'MCP only: dedicated ERA reader; in-app uses summarize_recent_eobs',
  billing_code_accuracy_review: 'MCP only: AI billing-code accuracy review; in-app exposes the same primitive via the SOAP-note submission flow (no direct chat tool)',
  predict_denial_risk: 'MCP only: AI denial risk score; in-app does not expose a direct equivalent',
  get_recovery_summary: 'MCP only: payer-advocate recovery summary for the assistant voice; in-app equivalent is the Recovery Ledger page (/recovery-ledger), not a chat-parity tool',
  check_compliance_risk: 'MCP only: pre-submission audit-readiness assessment (scrubber + denial predictor + doc-vs-code check); in-app exposes it via POST /api/claims/:id/compliance-risk, not a chat-parity tool',
};

// ── The tests ─────────────────────────────────────────────────────────

describe('Blanche tool parity (P1.4 drift detection)', () => {
  const inApp = extractInAppToolNames();
  const mcp = extractMcpToolNames();

  it('every in-app tool is classified (PARITY or SURFACE_ONLY)', () => {
    const unclassified: string[] = [];
    for (const name of inApp) {
      if (PARITY_TOOLS.has(name)) continue;
      if (Object.prototype.hasOwnProperty.call(SURFACE_ONLY_REASONS, name)) continue;
      unclassified.push(name);
    }
    expect(
      unclassified,
      `Unclassified in-app tools: ${unclassified.join(', ')}.\n` +
        `→ Add to PARITY_TOOLS (and mirror into server/mcp/tools/*), or add to\n` +
        `  SURFACE_ONLY_REASONS with a one-line justification.`,
    ).toEqual([]);
  });

  it('every MCP tool is classified (PARITY or SURFACE_ONLY)', () => {
    const unclassified: string[] = [];
    for (const name of mcp) {
      if (PARITY_TOOLS.has(name)) continue;
      if (Object.prototype.hasOwnProperty.call(SURFACE_ONLY_REASONS, name)) continue;
      unclassified.push(name);
    }
    expect(
      unclassified,
      `Unclassified MCP tools: ${unclassified.join(', ')}.\n` +
        `→ Add to PARITY_TOOLS (and add to server/routes/ai-assistant.ts), or add to\n` +
        `  SURFACE_ONLY_REASONS with a one-line justification.`,
    ).toEqual([]);
  });

  it('every PARITY_TOOLS entry is exposed on both surfaces', () => {
    const missingFromInApp: string[] = [];
    const missingFromMcp: string[] = [];
    for (const name of PARITY_TOOLS) {
      if (!inApp.has(name)) missingFromInApp.push(name);
      if (!mcp.has(name)) missingFromMcp.push(name);
    }
    expect(
      { missingFromInApp, missingFromMcp },
      `PARITY tool(s) missing a surface — this is the exposure gap that P0.6 hit.\n` +
        `→ Add the missing implementation, or move the tool to SURFACE_ONLY_REASONS\n` +
        `  if it is no longer a Blanche-first guarantee.`,
    ).toEqual({ missingFromInApp: [], missingFromMcp: [] });
  });

  it('SURFACE_ONLY_REASONS does not contain stale entries', () => {
    // A tool listed here should actually exist on at least one surface.
    // Otherwise the entry is debt-rot — it documents nothing real.
    const stale: string[] = [];
    for (const name of Object.keys(SURFACE_ONLY_REASONS)) {
      if (!inApp.has(name) && !mcp.has(name)) stale.push(name);
    }
    expect(
      stale,
      `Stale SURFACE_ONLY_REASONS entries (no longer exist on any surface): ${stale.join(', ')}.\n` +
        `→ Remove them from SURFACE_ONLY_REASONS.`,
    ).toEqual([]);
  });

  it('every SURFACE_ONLY_REASONS reason is non-empty', () => {
    const empty: string[] = [];
    for (const [name, reason] of Object.entries(SURFACE_ONLY_REASONS)) {
      if (!reason || reason.trim().length < 10) empty.push(name);
    }
    expect(
      empty,
      `SURFACE_ONLY_REASONS entries with empty/too-short reasons: ${empty.join(', ')}.\n` +
        `→ Add a meaningful one-line justification.`,
    ).toEqual([]);
  });
});

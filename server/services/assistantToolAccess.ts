/**
 * Role gating for the AI assistant's tools.
 *
 * requireFinancialRole keeps therapist-role users out of the money routes —
 * /api/claims, /api/fee-schedules, /api/superbills, /api/remittance and the
 * rest (server/routes.ts:201-220). Blanche never went through those routes:
 * her tools call the storage layer directly, which financial-access.ts:16
 * notes in passing. So the Fee Schedule screen returned 403 to a therapist
 * while the assistant on that same page would answer "what do we charge for
 * 97530?" with the rate.
 *
 * The rule here is deliberately simple, because anything subtler will drift
 * out of step with the HTTP gate: **the assistant must not do for a user what
 * that user is forbidden to do in the UI.** A tool that reads or writes
 * practice money is available to the same roles the money routes are.
 */

/** Roles allowed practice financials. Mirrors FINANCIAL_ROLES in middleware/financial-access.ts. */
const FINANCIAL_ROLES = ['admin', 'billing'];

/**
 * Tools that read or write practice money: charges, rates, revenue, A/R,
 * collections, claim line amounts, invoices, payment links, remittances.
 *
 * Claim-workflow tools are included because /api/claims is gated wholesale —
 * a therapist who cannot open the Claims screen should not reach claim data
 * by asking for it in chat. Clinical tools (SOAP notes, appointments,
 * eligibility, patient search) are NOT here: those are the therapist's job.
 */
export const FINANCIAL_TOOLS: ReadonlySet<string> = new Set([
  // Revenue, A/R and practice-level money reporting
  'get_dashboard_stats',
  'get_revenue_by_month',
  'get_collection_rate',
  'get_ar_aging',
  'get_provider_productivity', // returns total billed amount per provider
  // Claims — /api/claims is financial-gated in full
  'get_claims_by_status',
  'get_top_denial_reasons',
  'get_overdue_claims',
  'get_claim_status',
  'submit_claim',
  'add_claim_line_item',
  'get_claim_line_items',
  'update_claim_line_item',
  'delete_claim_line_item',
  'review_denied_claims',
  'generate_appeal_letter',
  'get_appeal_outcomes',
  'suggest_claim_correction',
  'review_underpayments',
  'draft_underpayment_dispute',
  // Patient money
  'create_invoice',
  'create_appointment_self_pay_invoice',
  'send_patient_payment_link',
  'summarize_recent_eobs',
]);

/**
 * Tools a therapist still needs, whose output carries a price that must be
 * stripped rather than the whole tool withheld. list_cpt_codes resolves a CPT
 * string to the database id Blanche needs before touching a coding flow —
 * removing it would break clinical work to hide one field.
 */
export const RATE_FIELDS_BY_TOOL: Readonly<Record<string, readonly string[]>> = {
  list_cpt_codes: ['baseRate'],
};

/**
 * Tools that create, tag or destroy demo data practice-wide. These mirror
 * admin-only HTTP surfaces (practice provisioning / data hygiene): a
 * therapist must not be able to seed fake patients into the practice or
 * wipe records by asking Blanche (role-gating audit).
 */
export const ADMIN_TOOLS: ReadonlySet<string> = new Set([
  'enable_demo_mode',
  'clear_demo_data',
  'mark_patients_as_demo',
  'unmark_demo_patients',
]);

/**
 * Tools that change practice-level configuration admins and billers share.
 * update_notification_template mirrors the /api/notification-templates
 * routes, which are isAdminOrBilling — same roles as FINANCIAL_ROLES, but
 * kept as its own set because the denial wording differs (config, not money).
 */
export const ADMIN_OR_BILLING_TOOLS: ReadonlySet<string> = new Set([
  'update_notification_template',
]);

export function canUseFinancialTools(role?: string | null): boolean {
  return FINANCIAL_ROLES.includes((role ?? '').toLowerCase());
}

export function canUseAdminTools(role?: string | null): boolean {
  return (role ?? '').toLowerCase() === 'admin';
}

/** True if this role may call this tool. Fail closed: an unknown role gets the clinical set. */
export function canUseTool(toolName: string, role?: string | null): boolean {
  if (ADMIN_TOOLS.has(toolName)) return canUseAdminTools(role);
  if (ADMIN_OR_BILLING_TOOLS.has(toolName)) return canUseFinancialTools(role);
  return !FINANCIAL_TOOLS.has(toolName) || canUseFinancialTools(role);
}

/**
 * What Blanche says instead of the data. Phrased so she does not imply the
 * user did something wrong, and points at the person who can answer.
 */
export function financialToolDenial(toolName: string): string {
  return JSON.stringify({
    error: 'not_permitted_for_role',
    message:
      `This account does not have access to practice financial data, so ${toolName} is unavailable. ` +
      'Billing rates, claim charges, revenue and A/R are visible to admin and billing roles. ' +
      'Tell the user their practice admin or biller can answer this, and do not estimate or infer the figures.',
  });
}

/**
 * Role-appropriate denial for any blocked tool. Same phrasing contract as
 * financialToolDenial: never imply the user did something wrong, point at
 * the person who can do it.
 */
export function toolDenial(toolName: string): string {
  if (ADMIN_TOOLS.has(toolName)) {
    return JSON.stringify({
      error: 'not_permitted_for_role',
      message:
        `This account cannot run practice-admin actions, so ${toolName} is unavailable. ` +
        'Demo-data setup and cleanup are reserved for the practice admin. ' +
        'Tell the user their practice admin can do this, and do not attempt it another way.',
    });
  }
  if (ADMIN_OR_BILLING_TOOLS.has(toolName)) {
    return JSON.stringify({
      error: 'not_permitted_for_role',
      message:
        `This account cannot change practice-level configuration, so ${toolName} is unavailable. ` +
        'Notification templates are managed by admin and billing roles. ' +
        'Tell the user their practice admin or biller can make this change.',
    });
  }
  return financialToolDenial(toolName);
}

/**
 * Remove price fields from a tool result for roles without financial access.
 * Operates on the parsed JSON so a rate cannot survive as a substring.
 */
export function redactRateFields(toolName: string, resultJson: string, role?: string | null): string {
  const fields = RATE_FIELDS_BY_TOOL[toolName];
  if (!fields || canUseFinancialTools(role)) return resultJson;

  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    // Not JSON — cannot redact structurally, so withhold rather than leak.
    return financialToolDenial(toolName);
  }

  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (fields.includes(k)) continue;
        out[k] = strip(v);
      }
      return out;
    }
    return value;
  };

  return JSON.stringify(strip(parsed));
}

/**
 * The tool list to advertise to the model for this role.
 *
 * Filtering matters beyond enforcement: a tool Blanche can see is a tool she
 * will offer, and being told "I can pull that up" followed by a refusal is
 * worse than never offering. The final entry carries the prompt-cache
 * breakpoint (tools render before `system` in the request prefix), so it is
 * re-anchored onto whatever ends up last.
 */
export function toolsForRole<T extends { name: string; cache_control?: unknown }>(
  tools: readonly T[],
  role?: string | null
): T[] {
  // Admins see everything; billing sees everything except the admin-only
  // tools; everyone else additionally loses the financial set.
  if (canUseAdminTools(role)) return tools as T[];

  const allowed = tools.filter((t) => canUseTool(t.name, role));
  if (canUseFinancialTools(role) && allowed.length === tools.length) return tools as T[];
  if (allowed.length === 0) return allowed;

  return allowed.map((tool, i) => {
    const isLast = i === allowed.length - 1;
    if (isLast) {
      return tool.cache_control ? tool : ({ ...tool, cache_control: { type: 'ephemeral' } } as T);
    }
    if (!tool.cache_control) return tool;
    const { cache_control, ...rest } = tool as Record<string, unknown>;
    return rest as T;
  });
}

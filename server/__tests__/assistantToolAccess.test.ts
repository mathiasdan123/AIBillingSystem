/**
 * requireFinancialRole blocks therapist-role users from the money routes, but
 * Blanche never went through those routes — her tools call storage directly.
 * The Fee Schedule screen returned 403 to a therapist while the assistant on
 * that same page would answer "what do we charge for 97530?" with the rate.
 *
 * These assert the gate on the assistant side, including the one tool a
 * therapist still needs whose output carries a price.
 */
import { describe, it, expect } from 'vitest';
import {
  FINANCIAL_TOOLS,
  ADMIN_TOOLS,
  ADMIN_OR_BILLING_TOOLS,
  canUseFinancialTools,
  canUseAdminTools,
  canUseTool,
  financialToolDenial,
  toolDenial,
  redactRateFields,
  toolsForRole,
} from '../services/assistantToolAccess';

describe('assistant financial-tool access', () => {
  it('allows admin and billing, refuses therapist', () => {
    expect(canUseFinancialTools('admin')).toBe(true);
    expect(canUseFinancialTools('billing')).toBe(true);
    expect(canUseFinancialTools('therapist')).toBe(false);
  });

  it('fails closed on an absent or unrecognized role', () => {
    expect(canUseFinancialTools(undefined)).toBe(false);
    expect(canUseFinancialTools(null)).toBe(false);
    expect(canUseFinancialTools('')).toBe(false);
    expect(canUseFinancialTools('front_desk')).toBe(false);
    expect(canUseTool('get_ar_aging', undefined)).toBe(false);
  });

  it('is case-insensitive about the role', () => {
    expect(canUseFinancialTools('Billing')).toBe(true);
    expect(canUseFinancialTools('ADMIN')).toBe(true);
  });

  it('covers the money tools a therapist must not reach', () => {
    for (const tool of [
      'get_dashboard_stats',
      'get_revenue_by_month',
      'get_collection_rate',
      'get_ar_aging',
      'get_provider_productivity',
      'submit_claim',
      'get_claim_line_items',
      'create_invoice',
      'send_patient_payment_link',
      'summarize_recent_eobs',
    ]) {
      expect(FINANCIAL_TOOLS.has(tool), tool).toBe(true);
      expect(canUseTool(tool, 'therapist'), tool).toBe(false);
    }
  });

  it('leaves clinical tools alone for every role', () => {
    for (const tool of [
      'generate_soap_note',
      'sign_soap_note',
      'get_prior_session_notes',
      'search_patients',
      'create_appointment',
      'check_eligibility',
      'list_cpt_codes', // kept: Blanche needs the cptCodeId to code at all
    ]) {
      expect(FINANCIAL_TOOLS.has(tool), tool).toBe(false);
      expect(canUseTool(tool, 'therapist'), tool).toBe(true);
    }
  });

  it('tells the model to defer rather than estimate the number', () => {
    const denial = financialToolDenial('get_ar_aging');
    expect(JSON.parse(denial).error).toBe('not_permitted_for_role');
    expect(denial).toMatch(/do not estimate or infer/i);
    expect(denial).toMatch(/admin and billing roles/i);
    expect(denial).toMatch(/admin or biller can answer/i);
  });
});

describe('admin-only tools (role-gating audit)', () => {
  const DEMO_TOOLS = [
    'enable_demo_mode',
    'clear_demo_data',
    'mark_patients_as_demo',
    'unmark_demo_patients',
  ];

  it('demo-data tools are admin-only — billing and therapist are refused', () => {
    for (const tool of DEMO_TOOLS) {
      expect(ADMIN_TOOLS.has(tool), tool).toBe(true);
      expect(canUseTool(tool, 'admin'), tool).toBe(true);
      expect(canUseTool(tool, 'billing'), tool).toBe(false);
      expect(canUseTool(tool, 'therapist'), tool).toBe(false);
      expect(canUseTool(tool, undefined), tool).toBe(false);
    }
  });

  it('update_notification_template matches the isAdminOrBilling HTTP gate', () => {
    expect(ADMIN_OR_BILLING_TOOLS.has('update_notification_template')).toBe(true);
    expect(canUseTool('update_notification_template', 'admin')).toBe(true);
    expect(canUseTool('update_notification_template', 'billing')).toBe(true);
    expect(canUseTool('update_notification_template', 'therapist')).toBe(false);
  });

  it('canUseAdminTools is admin-only, case-insensitive, fail closed', () => {
    expect(canUseAdminTools('admin')).toBe(true);
    expect(canUseAdminTools('ADMIN')).toBe(true);
    expect(canUseAdminTools('billing')).toBe(false);
    expect(canUseAdminTools(undefined)).toBe(false);
    expect(canUseAdminTools(null)).toBe(false);
  });

  it('denials name who can act, and never leak through financial wording', () => {
    const adminDenial = toolDenial('enable_demo_mode');
    expect(JSON.parse(adminDenial).error).toBe('not_permitted_for_role');
    expect(adminDenial).toMatch(/practice admin/i);

    const configDenial = toolDenial('update_notification_template');
    expect(JSON.parse(configDenial).error).toBe('not_permitted_for_role');
    expect(configDenial).toMatch(/admin or biller/i);

    // Financial tools keep the original wording.
    expect(toolDenial('get_ar_aging')).toBe(financialToolDenial('get_ar_aging'));
  });

  it('toolsForRole hides admin tools from billing and everything gated from a therapist', () => {
    const tools = [
      { name: 'search_patients' },
      { name: 'enable_demo_mode' },
      { name: 'update_notification_template' },
      { name: 'get_ar_aging', cache_control: { type: 'ephemeral' } },
    ];

    expect(toolsForRole(tools, 'admin').map((t) => t.name)).toEqual([
      'search_patients', 'enable_demo_mode', 'update_notification_template', 'get_ar_aging',
    ]);

    const billing = toolsForRole(tools, 'billing');
    expect(billing.map((t) => t.name)).toEqual([
      'search_patients', 'update_notification_template', 'get_ar_aging',
    ]);
    // Cache breakpoint stays on exactly the last offered tool.
    expect(billing.filter((t: any) => t.cache_control)).toHaveLength(1);
    expect((billing[billing.length - 1] as any).cache_control).toEqual({ type: 'ephemeral' });

    const therapist = toolsForRole(tools, 'therapist');
    expect(therapist.map((t) => t.name)).toEqual(['search_patients']);
    expect((therapist[therapist.length - 1] as any).cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('rate redaction', () => {
  const catalog = JSON.stringify({
    count: 2,
    codes: [
      { cptCodeId: 7, code: '97530', description: 'Therapeutic Activities', baseRate: '289.00' },
      { cptCodeId: 8, code: '97110', description: 'Therapeutic Exercise', baseRate: '289.00' },
    ],
    note: 'Pass BOTH cptCodeId and cptCode.',
  });

  it('strips the rate for a therapist but keeps what coding needs', () => {
    const out = redactRateFields('list_cpt_codes', catalog, 'therapist');
    expect(out).not.toMatch(/289/);
    expect(out).not.toMatch(/baseRate/);
    const parsed = JSON.parse(out);
    expect(parsed.codes[0].cptCodeId).toBe(7);
    expect(parsed.codes[0].code).toBe('97530');
    expect(parsed.codes[0].description).toBe('Therapeutic Activities');
    expect(parsed.note).toMatch(/cptCodeId/);
  });

  it('leaves the rate intact for billing', () => {
    expect(redactRateFields('list_cpt_codes', catalog, 'billing')).toBe(catalog);
  });

  it('redacts for an absent role', () => {
    expect(redactRateFields('list_cpt_codes', catalog, undefined)).not.toMatch(/baseRate/);
  });

  it('withholds rather than leaks when the result is not JSON', () => {
    const out = redactRateFields('list_cpt_codes', 'baseRate is 289.00', 'therapist');
    expect(out).not.toMatch(/289/);
    expect(JSON.parse(out).error).toBe('not_permitted_for_role');
  });

  it('does not touch tools with no rate fields declared', () => {
    const soap = JSON.stringify({ note: 'subjective...' });
    expect(redactRateFields('generate_soap_note', soap, 'therapist')).toBe(soap);
  });
});

describe('tool list offered to the model', () => {
  const tools = [
    { name: 'search_patients' },
    { name: 'get_ar_aging' },
    { name: 'generate_soap_note' },
    { name: 'get_provider_productivity', cache_control: { type: 'ephemeral' } },
  ];

  it('hides money tools from a therapist so Blanche never offers them', () => {
    const names = toolsForRole(tools, 'therapist').map((t) => t.name);
    expect(names).toEqual(['search_patients', 'generate_soap_note']);
  });

  it('gives billing the full list unchanged', () => {
    expect(toolsForRole(tools, 'billing')).toBe(tools);
  });

  it('keeps the prompt-cache breakpoint on exactly the last tool', () => {
    // The breakpoint caches the whole tools array; filtering must not strand
    // it on a tool that was removed, nor leave two.
    const filtered = toolsForRole(tools, 'therapist') as Array<Record<string, unknown>>;
    const marked = filtered.filter((t) => t.cache_control);
    expect(marked).toHaveLength(1);
    expect(filtered[filtered.length - 1].cache_control).toEqual({ type: 'ephemeral' });
  });
});

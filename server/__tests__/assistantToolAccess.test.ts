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
  canUseFinancialTools,
  canUseTool,
  financialToolDenial,
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

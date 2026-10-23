/**
 * Blanche's navigate_user tool returns a JSON `{action: 'navigate', path,
 * label}` tool_result that only ever reached the model, not the client -
 * she'd narrate "I'm sending you there now" and nothing happened, because
 * nothing captured that result into the suggestedActions array the
 * frontend actually renders as a clickable button. Locking in the fix:
 * parseNavigateActionResult extracts the button from a raw tool result,
 * and mergeSuggestedActions folds it in alongside whatever the
 * [Action: ...] text convention already produced, deduped by path.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/stripeService', () => ({}));
vi.mock('../services/stediService', () => ({
  isStediConfigured: vi.fn(() => true),
  PAYER_IDS: {} as Record<string, string>,
}));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../replitAuth', () => ({ isAuthenticated: vi.fn() }));
vi.mock('../services/practiceContext', () => ({ getUserPracticeContext: vi.fn() }));
vi.mock('../services/aiSoapBillingService', () => ({ generateSoapNoteAndBilling: vi.fn() }));
vi.mock('../services/underpaymentAnalyzer', () => ({ assessUnderpayment: vi.fn(), analyzeAdjustment: vi.fn() }));

import { parseNavigateActionResult, mergeSuggestedActions } from '../routes/ai-assistant';

describe('parseNavigateActionResult', () => {
  it('extracts a label/path pair from a well-formed navigate tool result', () => {
    const toolResult = JSON.stringify({ action: 'navigate', path: '/settings', label: 'Go to settings' });
    expect(parseNavigateActionResult(toolResult)).toEqual({ label: 'Go to settings', path: '/settings' });
  });

  it('returns null for a role-gate denial string (not JSON)', () => {
    expect(parseNavigateActionResult('Access denied: this action requires admin or billing role.')).toBeNull();
  });

  it('returns null for JSON that is not a navigate action', () => {
    expect(parseNavigateActionResult(JSON.stringify({ status: 'ok', patients: [] }))).toBeNull();
  });

  it('returns null when path or label is missing', () => {
    expect(parseNavigateActionResult(JSON.stringify({ action: 'navigate', path: '/settings' }))).toBeNull();
  });
});

describe('mergeSuggestedActions', () => {
  it('appends navigate_user actions to the text-parsed ones', () => {
    const textActions = [{ label: 'View Claims', path: '/claims' }];
    const navActions = [{ label: 'Go to settings', path: '/settings' }];
    expect(mergeSuggestedActions(textActions, navActions)).toEqual([
      { label: 'View Claims', path: '/claims' },
      { label: 'Go to settings', path: '/settings' },
    ]);
  });

  it('dedupes by path when both mechanisms point at the same destination', () => {
    const textActions = [{ label: '[Action] MCP Setup', path: '/settings' }];
    const navActions = [{ label: 'Go to settings', path: '/settings' }];
    const result = mergeSuggestedActions(textActions, navActions);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ label: '[Action] MCP Setup', path: '/settings' });
  });

  it('returns the text actions unchanged when there are no navigation actions', () => {
    const textActions = [{ label: 'View Claims', path: '/claims' }];
    expect(mergeSuggestedActions(textActions, [])).toEqual(textActions);
  });
});

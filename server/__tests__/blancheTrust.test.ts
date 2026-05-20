import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/aiLearningService', () => ({}));

import { detectSuccessClaim, augmentIfHallucinatedSuccess } from '../routes/ai-assistant';

/**
 * Phase 4 trust safeguard (Layer 2): server-side detection of Blanche
 * claiming success in prose without actually calling a mutation tool.
 *
 * Regression: a production turn where Blanche replied "I've successfully
 * marked all 7 legacy patients as demo data" — zero tool calls happened.
 * The user trusted her, the data wasn't changed, and they only found out
 * when they couldn't see the expected DEMO badges in the UI.
 *
 * These tests pin the detection patterns and the augmentation behavior so
 * the same class of bug can't ship silently again.
 */

describe('detectSuccessClaim', () => {
  describe('catches past-tense action verbs', () => {
    const claims = [
      "I've marked all 7 patients as demo.",
      "I've created the patient for you.",
      "I've sent the portal invite.",
      "I've submitted the claim to the clearinghouse.",
      "I've cancelled appointment 42.",
      "I've cleared the demo data.",
      "I've scheduled the appointment.",
      "I've updated the records.",
      "I've flagged those rows.",
      "I've tagged 7 patients.",
      "I've invited the patient.",
      "I've generated the SOAP note.",
      "I marked them all as demo today.",
    ];
    for (const claim of claims) {
      it(`detects: "${claim.slice(0, 50)}..."`, () => {
        expect(detectSuccessClaim(claim)).not.toBeNull();
      });
    }
  });

  describe('catches "successfully X-ed" framing', () => {
    it('detects "successfully marked"', () => {
      expect(detectSuccessClaim('Successfully marked all the patients.')).not.toBeNull();
    });
    it('detects "successfully created"', () => {
      expect(detectSuccessClaim('Successfully created the invoice.')).not.toBeNull();
    });
  });

  describe('catches standalone success-y closers', () => {
    it('detects "Done!"', () => {
      expect(detectSuccessClaim('Done!')).not.toBeNull();
    });
    it('detects "All set."', () => {
      expect(detectSuccessClaim('All set.')).not.toBeNull();
    });
    it('detects "All done."', () => {
      expect(detectSuccessClaim('All done.')).not.toBeNull();
    });
    it('detects "Perfect!"', () => {
      expect(detectSuccessClaim('Perfect! ')).not.toBeNull();
    });
  });

  describe('catches checkmark "what was done" lists', () => {
    it('detects ✅ patients line', () => {
      expect(detectSuccessClaim('Here is what changed:\n✅ All these patients are now demo')).not.toBeNull();
    });
    it('detects bullet where the verb is the first word', () => {
      expect(detectSuccessClaim('Result:\n- Marked all 7 patients as demo')).not.toBeNull();
      expect(detectSuccessClaim('Result:\n- **Created** patient Aaron Sample')).not.toBeNull();
      expect(detectSuccessClaim('Result:\n- Sent portal invite to Jane')).not.toBeNull();
    });
  });

  describe('regression: bullet rule does NOT false-positive on future-intent phrasing', () => {
    // 2026-05-18: prior regex matched "[anything] created as|to" inside a
    // bullet. That made Blanche's legitimate "X needs to be created as Y"
    // intent statements look like success claims. Tightened to require the
    // verb at the start of the bullet content.
    it('does NOT match "needs to be created as a patient"', () => {
      expect(detectSuccessClaim(
        '**Current status:**\n- Janet Doe needs to be created as a patient first',
      )).toBeNull();
    });
    it('does NOT match "will be marked as"', () => {
      expect(detectSuccessClaim('- The patient will be marked as demo once you confirm')).toBeNull();
    });
    it('does NOT match "should be sent to"', () => {
      expect(detectSuccessClaim('- The invite should be sent to the parent')).toBeNull();
    });
    it('does NOT match "to be cancelled"', () => {
      expect(detectSuccessClaim('- The appointment is to be cancelled if no show')).toBeNull();
    });
  });

  describe('does NOT false-positive on legitimate replies', () => {
    const fine = [
      'I can help you with that. What would you like to do?',
      "I'm proposing to mark these 7 patients as demo. Click Confirm below to do it.",
      "I'd like to create a patient — please confirm the details below.",
      'These patients look like demo candidates. Want me to mark them?',
      'You currently have 11 patients in the system.',
      'The dashboard shows your revenue trends.',
      // Conditional past-tense should not match.
      "If you confirm, I will have marked them as demo.",
    ];
    for (const text of fine) {
      it(`does NOT match: "${text.slice(0, 50)}..."`, () => {
        expect(detectSuccessClaim(text)).toBeNull();
      });
    }
  });

  it('handles markdown emphasis (** and __ around the claim)', () => {
    expect(detectSuccessClaim("**I've marked them all as demo!**")).not.toBeNull();
    expect(detectSuccessClaim("__Successfully created__ the invoice.")).not.toBeNull();
  });
});

describe('augmentIfHallucinatedSuccess (two-mode)', () => {
  describe('no tool called — flag both strong claims AND theatre openers', () => {
    it('prepends "skipped tool call" warning for strong success claim', () => {
      const result = augmentIfHallucinatedSuccess("I've marked all 7 patients as demo data.", 0);
      expect(result).toContain('Heads up');
      expect(result).toContain('skipped a tool call');
      expect(result).toContain('Nothing was actually changed');
      expect(result).toContain("I've marked"); // original preserved
    });

    it('prepends warning for theatre opener even with no real claim', () => {
      const result = augmentIfHallucinatedSuccess("Perfect! Here's what I'll do.", 0);
      expect(result).toContain('Heads up');
      expect(result).toContain('skipped a tool call');
    });

    it('does NOT prepend when text is neutral intent phrasing', () => {
      const original = "I'm proposing to mark these patients as demo — confirm below.";
      expect(augmentIfHallucinatedSuccess(original, 0)).toBe(original);
    });
  });

  describe('READ tool called but no mutation (production false-positive fix)', () => {
    // Real case from 2026-05-20: user asked "walk me through onboarding".
    // Blanche correctly called get_practice_setup_status (a read tool — not
    // a mutation), then summarized practice state with "Great! I can see..."
    // The old detector flagged the "Great!" as a hallucination warning even
    // though the answer was grounded in real data. anyToolsCalledCount > 0
    // means we trust the response.
    it('does NOT warn on theatre opener when a READ tool was called', () => {
      const original = "Great! I can see your practice has 13 patients and 12 claims.";
      // mutations=0, anyTools=1 (read tool ran). Should NOT warn.
      expect(augmentIfHallucinatedSuccess(original, 0, 1)).toBe(original);
    });

    it('STILL warns on a strong false claim even when a read tool was called', () => {
      // Read tool ran but text claims a mutation that didn't happen.
      // Strong claims are flagged regardless of whether read tools ran.
      const result = augmentIfHallucinatedSuccess(
        "I've marked all 7 patients as demo data.",
        0,
        2,
      );
      expect(result).toContain('skipped a tool call');
    });

    it('does NOT warn on neutral language when a read tool was called', () => {
      const original = "Your practice has 13 patients and 12 claims so far.";
      expect(augmentIfHallucinatedSuccess(original, 0, 1)).toBe(original);
    });
  });

  describe('tool WAS called — only flag STRONG claims, tolerate theatre openers', () => {
    it('prepends "action not done yet" warning for strong claim (premature completion)', () => {
      const result = augmentIfHallucinatedSuccess("I've marked all 7 patients.", 1);
      expect(result).toContain('past-tense language');
      expect(result).toContain("hasn't run yet");
      expect(result).toContain('Confirm/Cancel card');
      expect(result).not.toContain('skipped a tool call'); // different warning variant
    });

    it('does NOT warn on cringe theatre opener when tool was called', () => {
      // Production case from 2026-05-18: "Perfect! I'm proposing to create Janet Doe"
      // + actual create_patient tool call. The user is shown a Confirm card; the
      // "Perfect!" is suboptimal but not deceptive — system prompt handles it.
      const original = "Perfect! I'm proposing to create Janet Doe as a new patient.";
      expect(augmentIfHallucinatedSuccess(original, 1)).toBe(original);
    });

    it('does NOT warn on neutral intent phrasing with tool call', () => {
      const original = "I'd like to create Janet Doe — please confirm below.";
      expect(augmentIfHallucinatedSuccess(original, 1)).toBe(original);
    });
  });

  describe('detectSuccessClaim modes', () => {
    it("strong-only mode does NOT match 'Perfect!'", () => {
      // Imported separately to test the mode parameter.
      expect(detectSuccessClaim("Perfect! Here's what I'll do.", 'strong-only')).toBeNull();
    });
    it("'all' mode DOES match 'Perfect!'", () => {
      expect(detectSuccessClaim("Perfect! Here's what I'll do.", 'all')).not.toBeNull();
    });
    it("'all' mode catches 'Great!' opener", () => {
      expect(detectSuccessClaim("Great! Let me create that.", 'all')).not.toBeNull();
    });
    it("'all' mode catches 'Excellent!' opener", () => {
      expect(detectSuccessClaim("Excellent! I'll handle that now.", 'all')).not.toBeNull();
    });
    it('default mode is "all"', () => {
      expect(detectSuccessClaim('Perfect! ')).not.toBeNull();
    });
  });

  it('regression: the exact production failure mode from 2026-05-18', () => {
    const productionFailure = `Perfect! I've successfully marked all 7 legacy patients as demo data:

**Patients Now Flagged as Demo:**
- Emma Johnson (ID: 56)

**What this means:**
✅ All these patients now have "DEMO" badges in your UI`;
    const result = augmentIfHallucinatedSuccess(productionFailure, 0);
    expect(result).toContain('Heads up');
    expect(result).toContain('Nothing was actually changed');
  });
});

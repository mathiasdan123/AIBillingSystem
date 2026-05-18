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

describe('augmentIfHallucinatedSuccess', () => {
  it('prepends a warning when success claim is present and zero mutations called', () => {
    const result = augmentIfHallucinatedSuccess(
      "I've marked all 7 patients as demo data.",
      0,
    );
    expect(result).toContain('Heads up');
    expect(result).toContain('I may have skipped a tool call');
    expect(result).toContain('Nothing was actually changed');
    expect(result).toContain("I've marked"); // original text preserved below the warning
  });

  it('does NOT prepend when a mutation was actually called', () => {
    const original = "I've marked all 7 patients as demo data.";
    const result = augmentIfHallucinatedSuccess(original, 1);
    expect(result).toBe(original);
  });

  it('does NOT prepend when no success claim is present', () => {
    const original = "I'm proposing to mark these patients as demo — confirm below.";
    const result = augmentIfHallucinatedSuccess(original, 0);
    expect(result).toBe(original);
  });

  it('warning includes the matched phrase for debuggability', () => {
    const result = augmentIfHallucinatedSuccess("Done!", 0);
    expect(result).toContain('Done!');
  });

  it('regression: the exact production failure mode from 2026-05-18', () => {
    // Verbatim shape of the production reply that misled the user.
    const productionFailure = `Perfect! I've successfully marked all 7 legacy patients as demo data:

**Patients Now Flagged as Demo:**
- Emma Johnson (ID: 56)
- Zara Lindqvist (ID: 54)

**What this means:**
✅ All these patients now have "DEMO" badges in your UI`;
    const result = augmentIfHallucinatedSuccess(productionFailure, 0);
    expect(result).toContain('Heads up');
    expect(result).toContain('Nothing was actually changed');
  });
});

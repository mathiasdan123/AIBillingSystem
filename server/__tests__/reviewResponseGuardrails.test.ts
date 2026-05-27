import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock for the Anthropic SDK so we can control / observe model calls
// per test. Default behavior throws — any test that does not explicitly
// override `mockCreate` will fail loudly if the model is called.
const mockCreate = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('Anthropic.messages.create should not have been called in this test');
  })
);

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = { create: mockCreate };
    constructor(_opts: any) {}
  }
  return { default: FakeAnthropic };
});

// Quiet the logger.
vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

// Ensure hasAnthropicKey() returns true for tests that exercise the AI path.
// Must be set BEFORE the module under test is imported. `vi.hoisted` runs
// before ES module imports, which are themselves hoisted to the top of the file.
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key-for-guardrails';
});

import {
  generateNegativeFeedbackResponse,
  detectCrisisLanguage,
  findForbiddenOutput,
  CRISIS_KEYWORDS,
  FORBIDDEN_OUTPUT_PATTERNS,
  NEGATIVE_FEEDBACK_SYSTEM_PROMPT,
} from '../services/reviewResponseService';

const baseOptions = {
  patientFirstName: 'Alex',
  practiceName: 'Sunrise Therapy',
  practicePhone: '555-555-1212',
  practiceEmail: 'office@sunrise.example',
  rating: 1,
};

function mockAiOnce(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  } as any);
}

describe('reviewResponseService — negative-feedback guardrails', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockImplementation(async () => {
      throw new Error('Anthropic.messages.create should not have been called in this test');
    });
  });

  describe('system prompt content', () => {
    it('contains the explicit forbidden-content guardrail language', () => {
      const prompt = NEGATIVE_FEEDBACK_SYSTEM_PROMPT('Sunrise Therapy', 1);

      // Medical / clinical
      expect(prompt).toMatch(/medical advice/i);
      expect(prompt).toMatch(/diagnosis/i);
      expect(prompt).toMatch(/medication/i);
      expect(prompt).toMatch(/treatment recommendations/i);
      // Legal / financial
      expect(prompt).toMatch(/legal advice/i);
      expect(prompt).toMatch(/financial advice/i);
      // No echoing PHI from feedback
      expect(prompt).toMatch(/do not (repeat|quote)/i);
      // No outcome promises / no fault admission
      expect(prompt).toMatch(/promises about specific outcomes/i);
      expect(prompt).toMatch(/admit fault/i);
      // Tone constraints
      expect(prompt).toMatch(/3 to 5 sentences/i);
    });
  });

  describe('crisis-language pre-flight bypass', () => {
    // One representative phrase from each category.
    const cases: Array<{ category: string; text: string }> = [
      { category: 'suicide', text: 'I have been having suicidal thoughts after my last session.' },
      { category: 'self-harm', text: 'I keep wanting to hurt myself and nobody is calling me back.' },
      { category: 'overdose', text: 'I almost took an overdose of my pills last night.' },
      { category: 'abuse', text: 'My partner is abusing me and I needed help.' },
      { category: 'emergency', text: 'This is an emergency, I need urgent help right now.' },
    ];

    for (const { category, text } of cases) {
      it(`bypasses Claude entirely for ${category} language and sends static crisis template`, async () => {
        const result = await generateNegativeFeedbackResponse({ ...baseOptions, feedbackText: text });

        expect(mockCreate).not.toHaveBeenCalled();
        expect(result.crisisFlagged).toBe(true);
        expect(result.usedAi).toBe(false);

        // Static crisis template must contain the required resources.
        expect(result.body).toMatch(/988/);
        expect(result.body).toMatch(/741741/);
        expect(result.body).toMatch(/911/);
        // No AI-assistance disclaimer on the crisis template (reads as human).
        expect(result.body).not.toMatch(/prepared with AI assistance/i);
      });
    }

    it('detectCrisisLanguage returns the matched keyword', () => {
      const r = detectCrisisLanguage('I want to die.');
      expect(r.matched).toBe(true);
      expect(r.keyword).toBeDefined();
      expect(CRISIS_KEYWORDS).toContain(r.keyword!);
    });

    it('detectCrisisLanguage returns false for benign feedback', () => {
      expect(detectCrisisLanguage('The waiting room was cold and the receptionist was rude.').matched).toBe(false);
      expect(detectCrisisLanguage(undefined).matched).toBe(false);
      expect(detectCrisisLanguage('').matched).toBe(false);
    });
  });

  describe('post-generation safety scan', () => {
    it('discards AI output containing a banned phrase and falls back to template', async () => {
      mockAiOnce("Dear Alex, you should take a different medication. Sincerely, the team.");

      const result = await generateNegativeFeedbackResponse({
        ...baseOptions,
        feedbackText: 'The therapist seemed distracted.',
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result.usedAi).toBe(false);
      expect(result.crisisFlagged).toBe(false);

      // Generic fallback copy markers; banned phrase absent.
      expect(result.body).toMatch(/sorry to hear/i);
      expect(result.body).not.toMatch(/you should take/i);
      expect(result.body).not.toMatch(/medication/i);
    });

    it('findForbiddenOutput flags every documented banned pattern', () => {
      // Each pattern in isolation must trip the matcher. We don't assert
      // identity of the returned match (some patterns are substrings of others,
      // e.g. "you have " inside "this means you have"); we only assert that
      // an offending phrase is identified.
      for (const pat of FORBIDDEN_OUTPUT_PATTERNS) {
        const hit = findForbiddenOutput(`The clinician said ${pat} something important.`);
        expect(hit, `expected to flag pattern ${JSON.stringify(pat)}`).not.toBeNull();
        expect(FORBIDDEN_OUTPUT_PATTERNS).toContain(hit!);
      }
      expect(findForbiddenOutput('totally innocuous email body about your experience')).toBeNull();
    });
  });

  describe('clean AI output', () => {
    it('appends the AI-assistance disclaimer to clean Claude output', async () => {
      const cleanBody =
        "Dear Alex, we are so sorry your experience fell short of what you deserve. " +
        "Your feedback matters to us, and we would like the chance to make things right. " +
        "Please call our office at your convenience so we can talk it through.";
      mockAiOnce(cleanBody);

      const result = await generateNegativeFeedbackResponse({
        ...baseOptions,
        feedbackText: 'The appointment started 20 minutes late.',
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result.usedAi).toBe(true);
      expect(result.crisisFlagged).toBe(false);
      expect(result.body).toMatch(/prepared with AI assistance/i);
      expect(result.body).toMatch(/988/); // disclaimer references 988
      // Confirm the AI body actually made it into the rendered email.
      expect(result.body).toMatch(/fell short of what you deserve/);
    });
  });
});


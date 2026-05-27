/**
 * Review Response Service
 * Uses AI to generate professional responses to Google reviews
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger';

let anthropicClient: Anthropic | null = null;

/**
 * Crisis-language patterns. If any patient feedback matches these, we bypass
 * Claude entirely and send a static, human-reviewed crisis-resources template.
 *
 * Substring match (case-insensitive). We deliberately err on the side of
 * over-triggering: a false positive sends helpful crisis resources; a false
 * negative could route a patient in danger to an AI-generated apology email.
 */
export const CRISIS_KEYWORDS: readonly string[] = [
  // Suicidal ideation
  'suicide',
  'suicidal',
  'kill myself',
  'killing myself',
  'end my life',
  'ending my life',
  'want to die',
  'wanna die',
  'end it all',
  // Self-harm
  'self-harm',
  'self harm',
  'selfharm',
  'hurt myself',
  'hurting myself',
  'cut myself',
  'cutting myself',
  // Overdose
  'overdose',
  "od'd",
  'took too many pills',
  // Abuse
  'abuse',
  'abused',
  'abusing me',
  'hurting me',
  'hitting me',
  'being beaten',
  // Acute emergency
  'emergency',
  '911',
  'urgent help',
];

/**
 * Forbidden output patterns. If Claude's response contains any of these
 * (case-insensitive), we discard the AI output and fall back to the static
 * generic template — these phrases shade into medical advice that
 * TherapyBill AI is not permitted to send to consumers.
 */
export const FORBIDDEN_OUTPUT_PATTERNS: readonly string[] = [
  'diagnose',
  'diagnosis',
  'medication',
  'dosage',
  'you should take',
  'you have ',
  'this means you have',
  'i prescribe',
  'treatment plan',
];

/**
 * System prompt for the negative-feedback follow-up email.
 * Exported so tests (and reviewers) can verify the guardrail language verbatim.
 */
export const NEGATIVE_FEEDBACK_SYSTEM_PROMPT = (practiceName: string, rating: number) => `You are writing a brief follow-up email on behalf of ${practiceName}, a therapy/healthcare practice, to a patient who submitted negative feedback (${rating} out of 5 stars).

ABSOLUTE PROHIBITIONS — violating any of these is a critical failure:
- DO NOT provide medical advice, symptom interpretation, diagnosis, treatment recommendations, medication guidance, dosage instructions, or any clinical opinion of any kind.
- DO NOT provide legal advice, statements about liability, or financial advice.
- DO NOT repeat, quote, paraphrase, or reference any clinical or personal details the patient may have included in their feedback. Acknowledging the patient by first name is fine. Refer to their feedback only in generic terms such as "your experience" or "your concerns" — never echo specifics from the message body.
- DO NOT make promises about specific outcomes (e.g. "we will refund you", "we will fire your therapist", "we will change our policy", "this will not happen again"). Offer only to discuss further.
- DO NOT admit fault, accept liability, or use language that could be construed as an admission (e.g. "we were negligent", "we failed you", "this was our mistake"). Empathy and apology for the experience are fine ("we're sorry your experience fell short"); admission of wrongdoing is not.
- DO NOT diagnose the situation, speculate about what went wrong, or offer clinical interpretation of the feedback.

REQUIRED TONE AND FORMAT:
- Empathetic, warm, human — not corporate.
- 3 to 5 sentences total. No paragraphs longer than two sentences.
- Address the patient by first name once.
- Apologize sincerely that their experience did not meet expectations.
- Offer ONE clear next step: invite them to call the office or reply to the email to discuss further.
- Do NOT include a subject line, greeting block, or signature — just the body paragraphs.
- Do NOT include any disclaimers or AI-attribution language; those are added downstream.`;

const AI_DISCLAIMER =
  'This message was prepared with AI assistance. For urgent concerns please call our office directly, or call 988 if you are in crisis.';

function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set - review response AI disabled');
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
}

interface ReviewResponseOptions {
  reviewerName: string;
  rating: number;
  reviewText: string;
  practiceName: string;
  practicePhone?: string;
  tone?: 'professional' | 'friendly' | 'empathetic';
  includeCallToAction?: boolean;
}

interface AnalyzedReview {
  sentiment: 'positive' | 'neutral' | 'negative';
  tags: string[];
  keyPoints: string[];
  suggestedPriority: 'low' | 'medium' | 'high';
}

/**
 * Generate an AI response to a Google review
 */
export async function generateReviewResponse(options: ReviewResponseOptions): Promise<{
  success: boolean;
  response?: string;
  error?: string;
}> {
  if (!hasAnthropicKey()) {
    return { success: false, error: 'Anthropic API key not configured' };
  }

  const { reviewerName, rating, reviewText, practiceName, practicePhone, tone = 'professional', includeCallToAction = true } = options;

  const toneDescriptions = {
    professional: 'professional and courteous',
    friendly: 'warm, friendly, and personable',
    empathetic: 'empathetic, understanding, and caring',
  };

  const isPositive = rating >= 4;
  const isNegative = rating <= 2;

  let systemPrompt = `You are a customer service expert for ${practiceName}, a mental health/therapy practice.
Your task is to write ${toneDescriptions[tone]} responses to Google reviews.

Guidelines:
- Keep responses concise (2-4 sentences)
- Be genuine and avoid generic responses
- Thank the reviewer by name
- Address specific points they mentioned
- For positive reviews: express gratitude and mention you're glad they had a good experience
- For negative reviews: apologize sincerely, take responsibility, and offer to make it right
- Never be defensive or dismissive
- Maintain HIPAA compliance - never confirm or discuss any medical details
- Do not mention specific treatments, conditions, or health information
${includeCallToAction && practicePhone ? `- For negative reviews, invite them to call ${practicePhone} to discuss further` : ''}
`;

  const userPrompt = `Write a response to this ${rating}-star review from ${reviewerName}:

"${reviewText}"

${isNegative ? 'This is a negative review - be apologetic and solution-focused.' : ''}
${isPositive ? 'This is a positive review - express genuine gratitude.' : ''}`;

  try {
    const client = getAnthropic();
    if (!client) {
      return { success: false, error: 'Anthropic not configured' };
    }
    const completion = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = completion.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const response = textBlock?.text?.trim();

    if (!response) {
      return { success: false, error: 'No response generated' };
    }

    return { success: true, response };
  } catch (error) {
    console.error('Error generating review response:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Analyze a review for sentiment, topics, and priority
 */
export async function analyzeReview(reviewText: string, rating: number): Promise<{
  success: boolean;
  analysis?: AnalyzedReview;
  error?: string;
}> {
  if (!hasAnthropicKey()) {
    // Return basic analysis without AI
    const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
    return {
      success: true,
      analysis: {
        sentiment,
        tags: [],
        keyPoints: [],
        suggestedPriority: sentiment === 'negative' ? 'high' : 'low',
      },
    };
  }

  try {
    const client = getAnthropic();
    if (!client) {
      throw new Error('Anthropic not configured');
    }
    const completion = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      temperature: 0.3,
      system: `Analyze this review and return a JSON object with:
- sentiment: "positive", "neutral", or "negative"
- tags: array of relevant topics (e.g., "staff", "wait_time", "communication", "treatment", "billing", "atmosphere", "scheduling")
- keyPoints: array of 1-3 key points mentioned
- suggestedPriority: "low", "medium", or "high" based on urgency to respond

Return ONLY a valid JSON object, no markdown fencing or commentary.`,
      messages: [
        {
          role: 'user',
          content: `Rating: ${rating} stars\nReview: "${reviewText}"`,
        },
      ],
    });

    const textBlock = completion.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const content = textBlock?.text?.trim();

    if (!content) {
      throw new Error('No analysis generated');
    }

    // Parse the JSON response (strip markdown fencing if any)
    const jsonMatch =
      content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;
    const analysis = JSON.parse(jsonStr) as AnalyzedReview;

    return { success: true, analysis };
  } catch (error) {
    console.error('Error analyzing review:', error);
    // Return basic analysis on error
    const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
    return {
      success: true,
      analysis: {
        sentiment,
        tags: [],
        keyPoints: [],
        suggestedPriority: sentiment === 'negative' ? 'high' : 'low',
      },
    };
  }
}

/**
 * Generate a review request message
 */
export function generateReviewRequestMessage(
  patientName: string,
  practiceName: string,
  googleReviewUrl: string,
  channel: 'email' | 'sms'
): { subject?: string; body: string } {
  if (channel === 'sms') {
    return {
      body: `Hi ${patientName}! Thank you for choosing ${practiceName}. We'd love to hear about your experience! Please leave us a review: ${googleReviewUrl}`,
    };
  }

  return {
    subject: `How was your visit at ${practiceName}?`,
    body: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">We'd Love Your Feedback!</h1>
    </div>

    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <p style="font-size: 16px; color: #1e293b;">Hi ${patientName},</p>

      <p style="color: #475569;">Thank you for your recent visit to ${practiceName}. Your feedback helps us provide the best possible care to our patients.</p>

      <p style="color: #475569;">Would you mind taking a moment to share your experience?</p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${googleReviewUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Leave a Review
        </a>
      </div>

      <p style="color: #64748b; font-size: 14px;">Your review helps others find quality mental health care and helps us continue to improve our services.</p>
    </div>

    <div style="background: #f1f5f9; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border: 1px solid #e2e8f0; border-top: none;">
      <p style="margin: 0; color: #64748b; font-size: 13px;">
        Thank you for being part of our community!<br>
        <strong>${practiceName}</strong>
      </p>
    </div>
  </div>
</body>
</html>`,
  };
}

/**
 * Generate a feedback request message (sends to private feedback page, not Google)
 */
export function generateFeedbackRequestMessage(
  patientName: string,
  practiceName: string,
  feedbackUrl: string,
  channel: 'email' | 'sms'
): { subject?: string; body: string } {
  if (channel === 'sms') {
    return {
      body: `Hi ${patientName}! Thank you for choosing ${practiceName}. We'd love to hear about your experience! Please share your feedback: ${feedbackUrl}`,
    };
  }

  return {
    subject: `How was your visit at ${practiceName}?`,
    body: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">We'd Love Your Feedback!</h1>
    </div>

    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <p style="font-size: 16px; color: #1e293b;">Hi ${patientName},</p>

      <p style="color: #475569;">Thank you for your recent visit to ${practiceName}. Your feedback is incredibly important to us and helps us provide the best possible care.</p>

      <p style="color: #475569;">Would you take a moment to share your experience? It only takes a minute.</p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${feedbackUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Share Your Feedback
        </a>
      </div>

      <p style="color: #64748b; font-size: 14px;">Your honest feedback helps us improve and continue providing quality care.</p>
    </div>

    <div style="background: #f1f5f9; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border: 1px solid #e2e8f0; border-top: none;">
      <p style="margin: 0; color: #64748b; font-size: 13px;">
        Thank you for being part of our community!<br>
        <strong>${practiceName}</strong>
      </p>
    </div>
  </div>
</body>
</html>`,
  };
}

/**
 * Generate a Google review request message (sent after positive feedback)
 */
export function generateGooglePostRequestMessage(
  patientName: string,
  practiceName: string,
  googleReviewUrl: string,
  channel: 'email' | 'sms'
): { subject?: string; body: string } {
  if (channel === 'sms') {
    return {
      body: `Hi ${patientName}! Thank you for your wonderful feedback about ${practiceName}! Would you be willing to share it publicly on Google? It would mean so much to us: ${googleReviewUrl}`,
    };
  }

  return {
    subject: `Would you share your experience on Google?`,
    body: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">Thank You for Your Kind Words! 🙏</h1>
    </div>

    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <p style="font-size: 16px; color: #1e293b;">Hi ${patientName},</p>

      <p style="color: #475569;">We were thrilled to receive your positive feedback! Comments like yours truly make our day and inspire us to keep providing excellent care.</p>

      <p style="color: #475569;">Would you be willing to share your experience on Google? Your review would help others in our community find quality care.</p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${googleReviewUrl}" style="display: inline-block; background: #22c55e; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Post Review on Google ⭐
        </a>
      </div>

      <p style="color: #64748b; font-size: 14px;">No pressure at all – we're just grateful you took the time to share your thoughts with us!</p>
    </div>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border: 1px solid #dcfce7; border-top: none;">
      <p style="margin: 0; color: #166534; font-size: 13px;">
        With gratitude,<br>
        <strong>${practiceName}</strong>
      </p>
    </div>
  </div>
</body>
</html>`,
  };
}

/**
 * Returns true if the patient feedback text contains language suggesting
 * a crisis (suicide, self-harm, overdose, abuse, acute emergency).
 *
 * Case-insensitive substring match against CRISIS_KEYWORDS. We choose
 * substring (not word-boundary) deliberately: a false positive routes the
 * patient to crisis resources, which is the safer error.
 */
export function detectCrisisLanguage(text?: string | null): { matched: boolean; keyword?: string } {
  if (!text) return { matched: false };
  const lower = text.toLowerCase();
  for (const kw of CRISIS_KEYWORDS) {
    if (lower.includes(kw)) {
      return { matched: true, keyword: kw };
    }
  }
  return { matched: false };
}

/**
 * Returns the first forbidden phrase found in the AI output (case-insensitive),
 * or null if the output is clean.
 */
export function findForbiddenOutput(text: string): string | null {
  const lower = text.toLowerCase();
  for (const pat of FORBIDDEN_OUTPUT_PATTERNS) {
    if (lower.includes(pat)) return pat;
  }
  return null;
}

/**
 * Build the static crisis-resources email. This is human-reviewed copy and is
 * sent verbatim — no AI in the path. Intentionally reads as if written by a
 * person at the practice; no AI-assistance disclaimer.
 */
export function buildCrisisTemplateEmail(options: {
  patientFirstName: string;
  practiceName: string;
  practicePhone?: string;
  practiceEmail?: string;
}): { subject: string; body: string } {
  const { patientFirstName, practiceName, practicePhone, practiceEmail } = options;
  const contactLine =
    practicePhone || practiceEmail
      ? `You can reach our office${practicePhone ? ` at ${practicePhone}` : ''}${practiceEmail ? ` or ${practiceEmail}` : ''}.`
      : 'Please reach out to our office directly.';

  const body = `Dear ${patientFirstName},

Thank you for sharing this with us. Your safety and wellbeing matter, and we want to make sure you have immediate support available.

If you are in crisis or thinking about harming yourself, please use one of these resources right now:

- Call or text 988 — the Suicide & Crisis Lifeline (24/7, free, confidential)
- Text HOME to 741741 — Crisis Text Line (24/7)
- If you are in immediate danger, call 911 or go to your nearest emergency room

${contactLine} A member of our team will follow up with you personally as soon as possible.

You are not alone, and help is available right now.

Warmly,
The ${practiceName} Team`;

  return {
    subject: `${patientFirstName}, please read — immediate support resources`,
    body: formatNegativeFeedbackEmail(patientFirstName, practiceName, body),
  };
}

/**
 * Generic fallback template used when AI is unavailable OR when the AI output
 * fails the post-generation safety check. Carries the AI-assistance disclaimer
 * since it sits in the same channel as the AI-generated email.
 */
function buildGenericFallbackEmail(options: {
  patientFirstName: string;
  practiceName: string;
  practicePhone?: string;
  practiceEmail?: string;
  hasFeedbackText: boolean;
  includeDisclaimer: boolean;
}): { subject: string; body: string } {
  const { patientFirstName, practiceName, practicePhone, practiceEmail, hasFeedbackText, includeDisclaimer } = options;

  const fallbackBody = `Dear ${patientFirstName},

Thank you for taking the time to share your feedback with us. We're truly sorry to hear that your recent experience at ${practiceName} didn't meet your expectations.

Your feedback is important to us, and we take it seriously. ${hasFeedbackText ? 'We would like to learn more so we can make things right.' : 'We would love to learn more about your experience so we can make things right.'}

${practicePhone || practiceEmail ? `Please reach out to us directly${practicePhone ? ` at ${practicePhone}` : ''}${practiceEmail ? ` or ${practiceEmail}` : ''} if you'd like to discuss this further.` : 'Please reply to this email if you would like to discuss this further.'}

Warm regards,
The ${practiceName} Team${includeDisclaimer ? `\n\n${AI_DISCLAIMER}` : ''}`;

  return {
    subject: `We're sorry to hear about your experience, ${patientFirstName}`,
    body: formatNegativeFeedbackEmail(patientFirstName, practiceName, fallbackBody),
  };
}

/**
 * Generate a personalized follow-up email for negative feedback (AI-powered),
 * with multiple guardrail layers:
 *   1. Pre-flight crisis-language check  → static crisis template, no AI call
 *   2. AI generation with hardened system prompt
 *   3. Post-generation forbidden-keyword scan → static generic fallback
 *   4. AI-assistance disclaimer appended to AI-generated emails
 *
 * Returned shape adds `crisisFlagged` so the caller can flag the feedback row
 * for immediate practice-staff review.
 */
export async function generateNegativeFeedbackResponse(options: {
  patientFirstName: string;
  practiceName: string;
  practicePhone?: string;
  practiceEmail?: string;
  rating: number;
  feedbackText?: string;
}): Promise<{ subject: string; body: string; crisisFlagged: boolean; usedAi: boolean }> {
  const { patientFirstName, practiceName, practicePhone, practiceEmail, rating, feedbackText } = options;

  // Layer 1 — pre-flight crisis-language detection. Never call the model on
  // crisis content; route directly to human-reviewed crisis resources.
  const crisis = detectCrisisLanguage(feedbackText);
  if (crisis.matched) {
    logger.warn('Negative-feedback crisis bypass triggered; skipping AI and sending crisis template', {
      matchedKeyword: crisis.keyword,
      rating,
    });
    const crisisEmail = buildCrisisTemplateEmail({ patientFirstName, practiceName, practicePhone, practiceEmail });
    return { ...crisisEmail, crisisFlagged: true, usedAi: false };
  }

  // Layer 2 — AI generation. Falls through to the generic template if the AI
  // is not configured or errors.
  if (hasAnthropicKey()) {
    try {
      const systemPrompt = NEGATIVE_FEEDBACK_SYSTEM_PROMPT(practiceName, rating);

      // Note: we intentionally do NOT pass the patient's raw feedback text into
      // the user prompt. The model has no need-to-know for the body content and
      // we want zero risk of it echoing PHI. It only sees the first name,
      // rating, and practice contact info.
      const userPrompt = `Patient first name: ${patientFirstName}
Rating: ${rating}/5
${practicePhone ? `Practice phone: ${practicePhone}` : ''}
${practiceEmail ? `Practice email: ${practiceEmail}` : ''}

Write the email body now, following every rule in the system prompt.`;

      const client = getAnthropic();
      if (!client) {
        throw new Error('Anthropic not configured');
      }
      const completion = await client.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 400,
        temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = completion.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text'
      );
      const aiBody = textBlock?.text?.trim() || '';

      if (aiBody) {
        // Layer 3 — post-generation safety scan.
        const banned = findForbiddenOutput(aiBody);
        if (banned) {
          logger.warn('Negative-feedback AI output failed safety scan; falling back to template', {
            matchedPhrase: banned,
          });
          // Fall through to generic fallback below.
        } else {
          // Layer 4 — disclaimer appended to AI output only.
          const withDisclaimer = `${aiBody}\n\n${AI_DISCLAIMER}`;
          return {
            subject: `We're sorry to hear about your experience, ${patientFirstName}`,
            body: formatNegativeFeedbackEmail(patientFirstName, practiceName, withDisclaimer),
            crisisFlagged: false,
            usedAi: true,
          };
        }
      }
    } catch (error) {
      logger.warn('Negative-feedback AI generation failed; falling back to template', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const fallback = buildGenericFallbackEmail({
    patientFirstName,
    practiceName,
    practicePhone,
    practiceEmail,
    hasFeedbackText: Boolean(feedbackText),
    includeDisclaimer: false,
  });
  return { ...fallback, crisisFlagged: false, usedAi: false };
}

function formatNegativeFeedbackEmail(patientFirstName: string, practiceName: string, bodyContent: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0; font-size: 22px;">Your Feedback Matters</h1>
    </div>

    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      ${bodyContent.split('\n').map(p => p.trim() ? `<p style="color: #374151; line-height: 1.6; margin: 0 0 16px 0;">${p}</p>` : '').join('')}
    </div>

    <div style="background: #f1f5f9; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border: 1px solid #e2e8f0; border-top: none;">
      <p style="margin: 0; color: #64748b; font-size: 13px;">
        <strong>${practiceName}</strong>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export default {
  generateReviewResponse,
  analyzeReview,
  generateReviewRequestMessage,
  generateFeedbackRequestMessage,
  generateGooglePostRequestMessage,
  generateNegativeFeedbackResponse,
};

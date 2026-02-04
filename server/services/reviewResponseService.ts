/**
 * Review Response Service
 * Uses AI to generate professional responses to Google reviews
 */

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  if (!process.env.OPENAI_API_KEY) {
    return { success: false, error: 'OpenAI API key not configured' };
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
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content?.trim();

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
  if (!process.env.OPENAI_API_KEY) {
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
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Analyze this review and return a JSON object with:
- sentiment: "positive", "neutral", or "negative"
- tags: array of relevant topics (e.g., "staff", "wait_time", "communication", "treatment", "billing", "atmosphere", "scheduling")
- keyPoints: array of 1-3 key points mentioned
- suggestedPriority: "low", "medium", or "high" based on urgency to respond

Return ONLY valid JSON, no other text.`,
        },
        {
          role: 'user',
          content: `Rating: ${rating} stars\nReview: "${reviewText}"`,
        },
      ],
      max_tokens: 200,
      temperature: 0.3,
    });

    const content = completion.choices[0]?.message?.content?.trim();

    if (!content) {
      throw new Error('No analysis generated');
    }

    // Parse the JSON response
    const analysis = JSON.parse(content) as AnalyzedReview;

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
 * Generate a personalized follow-up email for negative feedback (AI-powered)
 */
export async function generateNegativeFeedbackResponse(options: {
  patientFirstName: string;
  practiceName: string;
  practicePhone?: string;
  practiceEmail?: string;
  rating: number;
  feedbackText?: string;
}): Promise<{ subject: string; body: string }> {
  const { patientFirstName, practiceName, practicePhone, practiceEmail, rating, feedbackText } = options;

  // If OpenAI is configured, generate a personalized response
  if (process.env.OPENAI_API_KEY) {
    try {
      const systemPrompt = `You are writing a follow-up email on behalf of ${practiceName}, a therapy/healthcare practice.
A patient has submitted negative feedback (${rating} out of 5 stars).
Write a sincere, empathetic email that:
- Thanks them for their honest feedback
- Acknowledges their concerns without being defensive
- Apologizes for their experience
- Expresses genuine desire to improve
- Invites them to discuss further (phone/email provided)
- Keeps HIPAA compliance - never mention specific treatments or health details
- Is warm and human, not corporate
- Is concise (3-4 short paragraphs max)

Do NOT include a subject line - just the email body.`;

      const userPrompt = `Patient name: ${patientFirstName}
Rating: ${rating}/5
${feedbackText ? `Their feedback: "${feedbackText}"` : 'No written feedback provided.'}
${practicePhone ? `Practice phone: ${practicePhone}` : ''}
${practiceEmail ? `Practice email: ${practiceEmail}` : ''}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 400,
        temperature: 0.7,
      });

      const aiBody = completion.choices[0]?.message?.content?.trim() || '';

      if (aiBody) {
        return {
          subject: `We're sorry to hear about your experience, ${patientFirstName}`,
          body: formatNegativeFeedbackEmail(patientFirstName, practiceName, aiBody),
        };
      }
    } catch (error) {
      console.error('AI response generation failed, using template:', error);
    }
  }

  // Fallback template if AI is not available
  const fallbackBody = `Dear ${patientFirstName},

Thank you for taking the time to share your feedback with us. We're truly sorry to hear that your recent experience at ${practiceName} didn't meet your expectations.

Your feedback is incredibly valuable to us, and we take it seriously. We're committed to providing the best possible care, and hearing where we fell short helps us improve.

${feedbackText ? `We've carefully reviewed your comments and are taking steps to address the concerns you raised.` : `We would love to learn more about your experience so we can make things right.`}

${practicePhone || practiceEmail ? `Please don't hesitate to reach out to us directly${practicePhone ? ` at ${practicePhone}` : ''}${practiceEmail ? ` or ${practiceEmail}` : ''} if you'd like to discuss this further.` : ''}

We truly appreciate you giving us the opportunity to improve and hope we can serve you better in the future.

Warm regards,
The ${practiceName} Team`;

  return {
    subject: `We're sorry to hear about your experience, ${patientFirstName}`,
    body: formatNegativeFeedbackEmail(patientFirstName, practiceName, fallbackBody),
  };
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

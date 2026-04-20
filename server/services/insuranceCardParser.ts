/**
 * Insurance Card Parser Service
 *
 * Uses Claude vision to extract structured fields from a photo of a
 * physical insurance card (front and optionally back). Mirrors the
 * pattern established in planDocumentParser.parsePlanDocumentFromPDF,
 * but uses the `image` content block instead of `document`.
 *
 * Intended to run synchronously from the upload endpoint — Claude
 * typically returns within a few seconds for a single card image.
 */

import Anthropic from '@anthropic-ai/sdk';

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set — insurance card OCR disabled');
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

export interface ParsedInsuranceCard {
  success: boolean;
  // Core fields we try to populate on the patient/insurance record:
  memberId?: string | null;
  groupNumber?: string | null;
  payerName?: string | null;
  planName?: string | null;
  subscriberFirstName?: string | null;
  subscriberLastName?: string | null;
  subscriberDateOfBirth?: string | null; // YYYY-MM-DD when derivable
  relationshipToSubscriber?: 'self' | 'spouse' | 'child' | 'other' | null;
  // Service numbers frequently printed on the back of cards:
  customerServicePhone?: string | null;
  providerServicePhone?: string | null;
  payerAddress?: string | null;
  // Diagnostic metadata:
  confidence: number; // 0-1 self-assessed by the model
  notes?: string[];
  error?: string;
  processingTimeMs: number;
}

const SYSTEM_PROMPT = `You are an expert at reading U.S. health insurance member ID cards.
Given a photo of the front (and optionally back) of a card, extract the
following fields accurately. Prefer verbatim values from the card over
interpretations.

Return ONLY a JSON object with these keys (use null when not visible):
{
  "memberId": "MEMBER/SUBSCRIBER/POLICY ID as printed",
  "groupNumber": "GROUP #",
  "payerName": "Issuing insurance company (e.g. 'Aetna', 'Blue Cross Blue Shield of New Jersey', 'UnitedHealthcare')",
  "planName": "Plan/product name (e.g. 'Open Access PPO', 'Gold HMO')",
  "subscriberFirstName": "",
  "subscriberLastName": "",
  "subscriberDateOfBirth": "YYYY-MM-DD if printed on the card",
  "relationshipToSubscriber": "self|spouse|child|other — only if it can be inferred from the card itself",
  "customerServicePhone": "10-digit number if visible",
  "providerServicePhone": "10-digit number if visible",
  "payerAddress": "Mailing address for claims, one line",
  "confidence": 0.85,
  "notes": ["Anything you flagged (glare on group #, partial occlusion, back-of-card needed)"]
}

DO NOT:
- Fabricate values the card doesn't show
- Guess the subscriber's DOB from the patient's chart — if the card doesn't print it, return null
- Collapse member ID/group number into a single field
- Convert unrecognized text to "unknown"; use null instead

Return ONLY the JSON object, no markdown fencing, no commentary.`;

/**
 * Parse one or two card images (front + optional back) and return structured
 * fields. The data URL prefix (`data:image/jpeg;base64,...`) is stripped
 * automatically if present.
 */
export async function parseInsuranceCardFromImage(
  frontBase64: string,
  backBase64?: string | null,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif' = 'image/jpeg'
): Promise<ParsedInsuranceCard> {
  const started = Date.now();

  try {
    const client = getAnthropic();
    if (!client) {
      return {
        success: false,
        confidence: 0,
        error: 'Anthropic API key not configured',
        processingTimeMs: Date.now() - started,
      };
    }

    const stripDataUrl = (s: string) => {
      const m = s.match(/^data:([^;]+);base64,(.*)$/);
      return m ? { mime: m[1], data: m[2] } : { mime: mediaType, data: s };
    };
    const { mime: frontMime, data: frontData } = stripDataUrl(frontBase64);
    const back = backBase64 ? stripDataUrl(backBase64) : null;

    // Claude's image block requires one of these MIME types.
    const normalizeMime = (m: string) =>
      (m === 'image/heic' || m === 'image/heif' ? 'image/jpeg' : m) as
        | 'image/jpeg'
        | 'image/png'
        | 'image/webp'
        | 'image/gif';

    const content: any[] = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: normalizeMime(frontMime),
          data: frontData,
        },
      },
    ];
    if (back) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: normalizeMime(back.mime),
          data: back.data,
        },
      });
    }
    content.push({
      type: 'text',
      text: back
        ? 'Two images: FRONT (first) and BACK (second) of an insurance card. Extract all printed fields.'
        : 'One image: the FRONT of an insurance card. Extract all printed fields.',
    });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      temperature: 0.1,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    if (!textBlock) {
      return {
        success: false,
        confidence: 0,
        error: 'No response text from Claude',
        processingTimeMs: Date.now() - started,
      };
    }

    // Strip any accidental markdown fencing.
    const jsonMatch =
      textBlock.text.match(/```json\n?([\s\S]*?)\n?```/) ||
      textBlock.text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : textBlock.text;
    const parsed = JSON.parse(jsonStr);

    return {
      success: true,
      memberId: parsed.memberId ?? null,
      groupNumber: parsed.groupNumber ?? null,
      payerName: parsed.payerName ?? null,
      planName: parsed.planName ?? null,
      subscriberFirstName: parsed.subscriberFirstName ?? null,
      subscriberLastName: parsed.subscriberLastName ?? null,
      subscriberDateOfBirth: parsed.subscriberDateOfBirth ?? null,
      relationshipToSubscriber: parsed.relationshipToSubscriber ?? null,
      customerServicePhone: parsed.customerServicePhone ?? null,
      providerServicePhone: parsed.providerServicePhone ?? null,
      payerAddress: parsed.payerAddress ?? null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      processingTimeMs: Date.now() - started,
    };
  } catch (error) {
    return {
      success: false,
      confidence: 0,
      error: error instanceof Error ? error.message : String(error),
      processingTimeMs: Date.now() - started,
    };
  }
}

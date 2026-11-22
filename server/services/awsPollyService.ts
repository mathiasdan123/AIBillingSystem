/**
 * Amazon Polly Text-to-Speech Service
 *
 * HIPAA-eligible under the AWS BAA this practice already has - no separate
 * vendor BAA needed, unlike ElevenLabs (see textToSpeechService.ts). Uses
 * the ECS task role's AWS credentials, no API key.
 */

import { PollyClient, SynthesizeSpeechCommand, DescribeVoicesCommand } from "@aws-sdk/client-polly";
import { assertPhiAiAllowed } from "../utils/phiAiGuard";

interface PollyVoice {
  voice_id: string;
  name: string;
  category: string;
}

interface TTSResult {
  success: boolean;
  audioBase64?: string;
  contentType?: string;
  error?: string;
}

const DEFAULT_VOICE_ID = "Joanna";
const DEFAULT_ENGINE: "neural" | "standard" = "neural";

export const VOICE_PRESETS = {
  professional: "Joanna",
  friendly: "Ivy",
  authoritative: "Matthew",
  calm: "Kendra",
} as const;

let client: PollyClient | null = null;

function getClient(): PollyClient {
  if (!client) {
    client = new PollyClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return client;
}

export function isTextToSpeechAvailable(): boolean {
  return true; // Credentials come from the task role, not an API key - always "configured".
}

export async function getAvailableVoices(): Promise<PollyVoice[]> {
  try {
    const result = await getClient().send(new DescribeVoicesCommand({ Engine: DEFAULT_ENGINE }));
    return (result.Voices || []).map((v) => ({
      voice_id: v.Id || "",
      name: v.Name || v.Id || "",
      category: v.Gender || "",
    }));
  } catch (error) {
    console.error("Error fetching Polly voices:", error);
    return [];
  }
}

/**
 * Convert text to speech using Amazon Polly.
 */
export async function textToSpeech(
  text: string,
  options: {
    voiceId?: string;
    modelId?: string; // accepted for interface parity with the ElevenLabs service; unused by Polly
    stability?: number; // unused by Polly
    similarityBoost?: number; // unused by Polly
    style?: number; // unused by Polly
  } = {}
): Promise<TTSResult> {
  try {
    assertPhiAiAllowed("Text-to-speech (Amazon Polly)");
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Text-to-speech disabled",
    };
  }

  if (!text || text.trim().length === 0) {
    return {
      success: false,
      error: "Text is required for speech synthesis.",
    };
  }

  // Polly's neural engine caps input at 3000 characters per request.
  const maxLength = 3000;
  const truncatedText = text.length > maxLength
    ? text.substring(0, maxLength) + "... Text truncated for brevity."
    : text;

  // Validate voiceId against Polly's known voice ID charset (letters only)
  // before passing it through, so a caller-supplied value can't smuggle
  // anything unexpected into the request.
  const requestedVoiceId = options.voiceId;
  const voiceId =
    typeof requestedVoiceId === "string" && /^[A-Za-z]+$/.test(requestedVoiceId)
      ? requestedVoiceId
      : DEFAULT_VOICE_ID;

  try {
    const result = await getClient().send(
      new SynthesizeSpeechCommand({
        Text: truncatedText,
        VoiceId: voiceId as any,
        Engine: DEFAULT_ENGINE,
        OutputFormat: "mp3",
      })
    );

    if (!result.AudioStream) {
      return { success: false, error: "Polly returned no audio stream" };
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of result.AudioStream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const audioBase64 = Buffer.concat(chunks).toString("base64");

    return {
      success: true,
      audioBase64,
      contentType: "audio/mpeg",
    };
  } catch (error) {
    console.error("Polly text-to-speech error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Text-to-speech failed",
    };
  }
}

export async function soapNoteToSpeech(
  soapNote: {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
  },
  voiceId?: string
): Promise<TTSResult> {
  const sections: string[] = [];
  if (soapNote.subjective) sections.push(`Subjective: ${soapNote.subjective}`);
  if (soapNote.objective) sections.push(`Objective: ${soapNote.objective}`);
  if (soapNote.assessment) sections.push(`Assessment: ${soapNote.assessment}`);
  if (soapNote.plan) sections.push(`Plan: ${soapNote.plan}`);

  const fullText = sections.join("\n\n");
  return textToSpeech(fullText, { voiceId });
}

export async function appealLetterToSpeech(
  appealLetter: string,
  voiceId?: string
): Promise<TTSResult> {
  const voice = voiceId || VOICE_PRESETS.authoritative;
  return textToSpeech(appealLetter, { voiceId: voice });
}

export default {
  isTextToSpeechAvailable,
  getAvailableVoices,
  textToSpeech,
  soapNoteToSpeech,
  appealLetterToSpeech,
  VOICE_PRESETS,
};

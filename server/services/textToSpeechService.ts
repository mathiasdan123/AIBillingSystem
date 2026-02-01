/**
 * Eleven Labs Text-to-Speech Service
 * Converts text to natural-sounding speech for accessibility and ambient documentation
 */

interface ElevenLabsVoice {
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

// Default voice settings
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel - clear, professional female voice
const DEFAULT_MODEL_ID = "eleven_monolingual_v1";

// Voice presets for different use cases
export const VOICE_PRESETS = {
  professional: "21m00Tcm4TlvDq8ikWAM", // Rachel
  friendly: "EXAVITQu4vr4xnSDxMaL",     // Bella
  authoritative: "ErXwobaYiN019PkySvjV", // Antoni
  calm: "MF3mGyEYCl7XYWbV9V6O",         // Elli
} as const;

/**
 * Check if Eleven Labs TTS is available
 */
export function isTextToSpeechAvailable(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

/**
 * Get available voices from Eleven Labs
 */
export async function getAvailableVoices(): Promise<ElevenLabsVoice[]> {
  if (!process.env.ELEVENLABS_API_KEY) {
    return [];
  }

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
      },
    });

    if (!response.ok) {
      console.error("Failed to fetch voices:", response.statusText);
      return [];
    }

    const data = await response.json();
    return data.voices || [];
  } catch (error) {
    console.error("Error fetching Eleven Labs voices:", error);
    return [];
  }
}

/**
 * Convert text to speech using Eleven Labs API
 */
export async function textToSpeech(
  text: string,
  options: {
    voiceId?: string;
    modelId?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
  } = {}
): Promise<TTSResult> {
  if (!process.env.ELEVENLABS_API_KEY) {
    return {
      success: false,
      error: "Eleven Labs API key not configured. Add ELEVENLABS_API_KEY to .env file.",
    };
  }

  if (!text || text.trim().length === 0) {
    return {
      success: false,
      error: "Text is required for speech synthesis.",
    };
  }

  // Limit text length to avoid excessive API costs
  const maxLength = 5000;
  const truncatedText = text.length > maxLength
    ? text.substring(0, maxLength) + "... Text truncated for brevity."
    : text;

  const voiceId = options.voiceId || DEFAULT_VOICE_ID;
  const modelId = options.modelId || DEFAULT_MODEL_ID;

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: truncatedText,
          model_id: modelId,
          voice_settings: {
            stability: options.stability ?? 0.5,
            similarity_boost: options.similarityBoost ?? 0.75,
            style: options.style ?? 0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Eleven Labs API error:", response.status, errorText);
      return {
        success: false,
        error: `Text-to-speech failed: ${response.statusText}`,
      };
    }

    // Get audio as buffer and convert to base64
    const audioBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");

    return {
      success: true,
      audioBase64,
      contentType: "audio/mpeg",
    };
  } catch (error) {
    console.error("Text-to-speech error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Text-to-speech failed",
    };
  }
}

/**
 * Convert SOAP note to speech with appropriate pacing
 */
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

  if (soapNote.subjective) {
    sections.push(`Subjective: ${soapNote.subjective}`);
  }
  if (soapNote.objective) {
    sections.push(`Objective: ${soapNote.objective}`);
  }
  if (soapNote.assessment) {
    sections.push(`Assessment: ${soapNote.assessment}`);
  }
  if (soapNote.plan) {
    sections.push(`Plan: ${soapNote.plan}`);
  }

  const fullText = sections.join("\n\n");
  return textToSpeech(fullText, { voiceId });
}

/**
 * Convert appeal letter to speech
 */
export async function appealLetterToSpeech(
  appealLetter: string,
  voiceId?: string
): Promise<TTSResult> {
  // Use a more authoritative voice for appeal letters
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

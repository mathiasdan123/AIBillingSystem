import OpenAI from "openai";
import fs from "fs";
import path from "path";

// Lazy initialization of OpenAI client for voice transcription
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

export interface TranscriptionResult {
  text: string;
  duration?: number;
  language?: string;
  success: boolean;
  error?: string;
  method: "whisper" | "fallback";
}

/**
 * Transcribe audio file using OpenAI Whisper
 * Falls back to returning an error message if API key is not set
 */
export async function transcribeAudio(
  audioFilePath: string,
  language: string = "en"
): Promise<TranscriptionResult> {
  const client = getOpenAIClient();

  if (!client) {
    return {
      text: "",
      success: false,
      error: "OpenAI API key not configured. Please add OPENAI_API_KEY to .env file for voice transcription.",
      method: "fallback"
    };
  }

  try {
    // Read the audio file
    const audioFile = fs.createReadStream(audioFilePath);

    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language,
      response_format: "json",
    });

    return {
      text: transcription.text,
      success: true,
      method: "whisper"
    };
  } catch (error) {
    console.error("Whisper transcription error:", error);
    return {
      text: "",
      success: false,
      error: error instanceof Error ? error.message : "Transcription failed",
      method: "whisper"
    };
  }
}

/**
 * Transcribe audio from base64 encoded data
 */
export async function transcribeAudioBase64(
  base64Audio: string,
  mimeType: string = "audio/webm",
  language: string = "en"
): Promise<TranscriptionResult> {
  const client = getOpenAIClient();

  if (!client) {
    return {
      text: "",
      success: false,
      error: "OpenAI API key not configured. Please add OPENAI_API_KEY to .env file for voice transcription.",
      method: "fallback"
    };
  }

  try {
    // Decode base64 and write to temp file
    const buffer = Buffer.from(base64Audio, "base64");
    const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp3") ? "mp3" : "wav";
    const tempPath = path.join("/tmp", `audio-${Date.now()}.${ext}`);

    fs.writeFileSync(tempPath, buffer);

    try {
      const result = await transcribeAudio(tempPath, language);
      return result;
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  } catch (error) {
    console.error("Base64 transcription error:", error);
    return {
      text: "",
      success: false,
      error: error instanceof Error ? error.message : "Transcription failed",
      method: "whisper"
    };
  }
}

/**
 * Check if voice transcription is available
 */
export function isVoiceTranscriptionAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export default {
  transcribeAudio,
  transcribeAudioBase64,
  isVoiceTranscriptionAvailable
};

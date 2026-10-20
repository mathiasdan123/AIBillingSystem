import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { assertPhiAiAllowed } from "../utils/phiAiGuard";
import * as awsTranscribeService from "./awsTranscribeService";

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
  method: "whisper" | "transcribe" | "fallback";
}

/**
 * Set to 'aws' to route transcription through Amazon Transcribe instead of
 * OpenAI Whisper - HIPAA-eligible under the existing AWS BAA, no separate
 * vendor BAA needed. Defaults to 'openai' so behavior is unchanged until
 * explicitly opted in (same cutover pattern as AI_PROVIDER in aiProvider.ts).
 */
function useAwsTranscribe(): boolean {
  return (process.env.VOICE_PROVIDER || "").toLowerCase() === "aws";
}

/**
 * Transcribe audio file using OpenAI Whisper
 * Falls back to returning an error message if API key is not set
 */
async function transcribeAudioWhisper(
  audioFilePath: string,
  language: string = "en"
): Promise<TranscriptionResult> {
  try {
    assertPhiAiAllowed("Voice transcription (OpenAI Whisper)", "openai");
  } catch (error) {
    return {
      text: "",
      success: false,
      error: error instanceof Error ? error.message : "Voice transcription disabled",
      method: "fallback"
    };
  }

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
async function transcribeAudioBase64Whisper(
  base64Audio: string,
  mimeType: string = "audio/webm",
  language: string = "en"
): Promise<TranscriptionResult> {
  try {
    assertPhiAiAllowed("Voice transcription (OpenAI Whisper)", "openai");
  } catch (error) {
    return {
      text: "",
      success: false,
      error: error instanceof Error ? error.message : "Voice transcription disabled",
      method: "fallback"
    };
  }

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
      const result = await transcribeAudioWhisper(tempPath, language);
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

export async function transcribeAudio(
  audioFilePath: string,
  language: string = "en"
): Promise<TranscriptionResult> {
  if (useAwsTranscribe()) {
    return awsTranscribeService.transcribeAudio(audioFilePath, language);
  }
  return transcribeAudioWhisper(audioFilePath, language);
}

export async function transcribeAudioBase64(
  base64Audio: string,
  mimeType: string = "audio/webm",
  language: string = "en"
): Promise<TranscriptionResult> {
  if (useAwsTranscribe()) {
    return awsTranscribeService.transcribeAudioBase64(base64Audio, mimeType, language);
  }
  return transcribeAudioBase64Whisper(base64Audio, mimeType, language);
}

/**
 * Check if voice transcription is available
 */
export function isVoiceTranscriptionAvailable(): boolean {
  if (useAwsTranscribe()) {
    return awsTranscribeService.isVoiceTranscriptionAvailable();
  }
  return !!process.env.OPENAI_API_KEY;
}

export default {
  transcribeAudio,
  transcribeAudioBase64,
  isVoiceTranscriptionAvailable
};

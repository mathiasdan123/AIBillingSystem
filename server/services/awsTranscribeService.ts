/**
 * Amazon Transcribe Voice Transcription Service
 *
 * HIPAA-eligible under the AWS BAA this practice already has - no separate
 * vendor BAA needed, unlike OpenAI Whisper (see voiceService.ts). Uses the
 * ECS task role's AWS credentials, no API key.
 *
 * Transcribe's batch API requires the source audio to live in S3 first
 * (there's no "send raw bytes, get text back" call like Whisper's). This
 * uploads to a short-lived scratch location, starts a transcription job,
 * polls for completion, fetches the transcript, then deletes both the
 * uploaded audio and the job's output - PHI shouldn't sit in S3 any longer
 * than it takes to transcribe it.
 */

import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  DeleteTranscriptionJobCommand,
  type MediaFormat,
} from "@aws-sdk/client-transcribe";
import { assertPhiAiAllowed } from "../utils/phiAiGuard";

export interface TranscriptionResult {
  text: string;
  duration?: number;
  language?: string;
  success: boolean;
  error?: string;
  method: "transcribe" | "fallback";
}

const REGION = process.env.AWS_REGION || "us-east-1";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 90_000; // dictation clips and session recordings are short; fail rather than hang past this

let s3: S3Client | null = null;
let transcribe: TranscribeClient | null = null;

function getS3Client(): S3Client {
  if (!s3) s3 = new S3Client({ region: REGION });
  return s3;
}

function getTranscribeClient(): TranscribeClient {
  if (!transcribe) transcribe = new TranscribeClient({ region: REGION });
  return transcribe;
}

function getScratchBucket(): string | undefined {
  return process.env.TRANSCRIBE_SCRATCH_BUCKET;
}

export function isVoiceTranscriptionAvailable(): boolean {
  return !!getScratchBucket();
}

// Transcribe batch jobs accept these container/codec formats directly -
// webm included, so the browser's native MediaRecorder output needs no
// client-side transcoding.
const MEDIA_FORMAT_BY_MIME: Record<string, MediaFormat> = {
  webm: "webm" as MediaFormat,
  mp3: "mp3" as MediaFormat,
  mp4: "mp4" as MediaFormat,
  wav: "wav" as MediaFormat,
  flac: "flac" as MediaFormat,
  ogg: "ogg" as MediaFormat,
  amr: "amr" as MediaFormat,
};

// Transcribe needs a full locale (en-US), not the bare ISO 639-1 codes this
// app's callers pass (en, es, ...). Unrecognized codes fall back to
// automatic language identification rather than guessing a locale wrong.
const LANGUAGE_CODE_MAP: Record<string, string> = {
  en: "en-US",
  es: "es-US",
  fr: "fr-FR",
  pt: "pt-BR",
  de: "de-DE",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTranscriptionJob(
  buffer: Buffer,
  mediaFormat: MediaFormat,
  language: string
): Promise<TranscriptionResult> {
  const bucket = getScratchBucket();
  if (!bucket) {
    return {
      text: "",
      success: false,
      error: "TRANSCRIBE_SCRATCH_BUCKET not configured. Required for Amazon Transcribe voice transcription.",
      method: "fallback",
    };
  }

  const jobName = `therapybill-${randomUUID()}`;
  const objectKey = `transcribe-scratch/${jobName}.${mediaFormat}`;
  const s3Client = getS3Client();
  const transcribeClient = getTranscribeClient();

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: buffer,
        ServerSideEncryption: "aws:kms",
      })
    );

    const languageCode = LANGUAGE_CODE_MAP[language];

    await transcribeClient.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        Media: { MediaFileUri: `s3://${bucket}/${objectKey}` },
        MediaFormat: mediaFormat,
        ...(languageCode ? { LanguageCode: languageCode as any } : { IdentifyLanguage: true }),
      })
    );

    const deadline = Date.now() + MAX_POLL_MS;
    let transcriptUri: string | undefined;
    let jobLanguage: string | undefined;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const status = await transcribeClient.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: jobName })
      );
      const job = status.TranscriptionJob;
      if (job?.TranscriptionJobStatus === "COMPLETED") {
        transcriptUri = job.Transcript?.TranscriptFileUri;
        jobLanguage = job.LanguageCode;
        break;
      }
      if (job?.TranscriptionJobStatus === "FAILED") {
        return {
          text: "",
          success: false,
          error: `Transcription job failed: ${job.FailureReason || "unknown reason"}`,
          method: "transcribe",
        };
      }
      // IN_PROGRESS / QUEUED - keep polling
    }

    if (!transcriptUri) {
      return {
        text: "",
        success: false,
        error: `Transcription timed out after ${MAX_POLL_MS / 1000}s`,
        method: "transcribe",
      };
    }

    const transcriptResponse = await fetch(transcriptUri);
    if (!transcriptResponse.ok) {
      return {
        text: "",
        success: false,
        error: `Failed to fetch transcript result: ${transcriptResponse.statusText}`,
        method: "transcribe",
      };
    }
    const transcriptJson = (await transcriptResponse.json()) as {
      results?: { transcripts?: Array<{ transcript?: string }> };
    };
    const text = transcriptJson.results?.transcripts?.[0]?.transcript || "";

    return {
      text,
      success: true,
      method: "transcribe",
      language: jobLanguage,
    };
  } catch (error) {
    console.error("Transcribe error:", error);
    return {
      text: "",
      success: false,
      error: error instanceof Error ? error.message : "Transcription failed",
      method: "transcribe",
    };
  } finally {
    // Best-effort cleanup - PHI shouldn't linger in S3 or in the completed
    // job's stored transcript/output any longer than needed.
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    } catch (cleanupError) {
      console.error("Failed to delete Transcribe scratch audio object:", cleanupError);
    }
    try {
      await transcribeClient.send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    } catch (cleanupError) {
      console.error("Failed to delete Transcribe job:", cleanupError);
    }
  }
}

export async function transcribeAudio(
  audioFilePath: string,
  language: string = "en"
): Promise<TranscriptionResult> {
  try {
    assertPhiAiAllowed("Voice transcription (Amazon Transcribe)");
  } catch (error) {
    return {
      text: "",
      success: false,
      error: error instanceof Error ? error.message : "Voice transcription disabled",
      method: "fallback",
    };
  }

  const fs = await import("fs");
  const path = await import("path");
  const buffer = fs.readFileSync(audioFilePath);
  const ext = path.extname(audioFilePath).replace(".", "").toLowerCase();
  const mediaFormat = MEDIA_FORMAT_BY_MIME[ext] || ("wav" as MediaFormat);

  return runTranscriptionJob(buffer, mediaFormat, language);
}

export async function transcribeAudioBase64(
  base64Audio: string,
  mimeType: string = "audio/webm",
  language: string = "en"
): Promise<TranscriptionResult> {
  try {
    assertPhiAiAllowed("Voice transcription (Amazon Transcribe)");
  } catch (error) {
    return {
      text: "",
      success: false,
      error: error instanceof Error ? error.message : "Voice transcription disabled",
      method: "fallback",
    };
  }

  const buffer = Buffer.from(base64Audio, "base64");
  const ext = mimeType.includes("webm")
    ? "webm"
    : mimeType.includes("mp4")
      ? "mp4"
      : mimeType.includes("mp3")
        ? "mp3"
        : mimeType.includes("ogg")
          ? "ogg"
          : mimeType.includes("flac")
            ? "flac"
            : "wav";
  const mediaFormat = MEDIA_FORMAT_BY_MIME[ext] || ("wav" as MediaFormat);

  return runTranscriptionJob(buffer, mediaFormat, language);
}

export default {
  transcribeAudio,
  transcribeAudioBase64,
  isVoiceTranscriptionAvailable,
};

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ENV_KEYS = [
  'VOICE_PROVIDER', 'TTS_PROVIDER', 'PHI_AI_ENABLED', 'OPENAI_PHI_AI_ENABLED',
  'ELEVENLABS_PHI_AI_ENABLED', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY',
  'TRANSCRIBE_SCRATCH_BUCKET', 'AWS_REGION',
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  // vi.resetModules() clears the module cache but NOT doMock registrations -
  // without this, a test that mocks '../services/awsPollyService' (etc.) as
  // a fake module leaks that mock into a later test that wants the real one.
  vi.doUnmock('../services/awsPollyService');
  vi.doUnmock('../services/awsTranscribeService');
  vi.doUnmock('openai');
  vi.doUnmock('fs');
  vi.doUnmock('@aws-sdk/client-polly');
  vi.doUnmock('@aws-sdk/client-s3');
  vi.doUnmock('@aws-sdk/client-transcribe');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('voiceService provider switch', () => {
  it('defaults to OpenAI Whisper when VOICE_PROVIDER is unset', async () => {
    delete process.env.VOICE_PROVIDER;
    process.env.OPENAI_API_KEY = 'test-key';
    const transcribeMock = vi.fn();
    vi.doMock('openai', () => ({
      default: vi.fn().mockImplementation(() => ({ audio: { transcriptions: { create: transcribeMock } } })),
    }));
    const awsTranscribeMock = vi.fn();
    vi.doMock('../services/awsTranscribeService', () => ({ transcribeAudio: awsTranscribeMock }));
    transcribeMock.mockResolvedValue({ text: 'hello from whisper' });

    // A real (tiny) temp file, rather than mocking the 'fs' built-in -
    // fs.createReadStream opens its file descriptor asynchronously in the
    // background as soon as it's created, whether or not anything ever
    // reads from the stream (the mocked OpenAI client here never does).
    // Deleting the file right after the call - before that open
    // completes - would orphan the stream and surface as an unhandled
    // error on an unrelated later test. Left in place for the test
    // process's lifetime instead; it's a few bytes in a throwaway sandbox.
    const tempPath = path.join(os.tmpdir(), `voice-service-test-${Date.now()}.webm`);
    fs.writeFileSync(tempPath, Buffer.from('fake-audio'));

    const { transcribeAudio } = await import('../services/voiceService');
    const result = await transcribeAudio(tempPath);

    expect(result.method).toBe('whisper');
    expect(result.text).toBe('hello from whisper');
    expect(awsTranscribeMock).not.toHaveBeenCalled();
  });

  it('routes to Amazon Transcribe when VOICE_PROVIDER=aws, without touching OpenAI', async () => {
    process.env.VOICE_PROVIDER = 'aws';
    process.env.OPENAI_API_KEY = 'test-key';
    const openaiCreateMock = vi.fn();
    vi.doMock('openai', () => ({
      default: vi.fn().mockImplementation(() => ({ audio: { transcriptions: { create: openaiCreateMock } } })),
    }));
    const awsTranscribeMock = vi.fn().mockResolvedValue({
      text: 'hello from transcribe', success: true, method: 'transcribe',
    });
    vi.doMock('../services/awsTranscribeService', () => ({ transcribeAudio: awsTranscribeMock, transcribeAudioBase64: vi.fn(), isVoiceTranscriptionAvailable: vi.fn() }));

    const { transcribeAudio } = await import('../services/voiceService');
    const result = await transcribeAudio('/tmp/fake.webm', 'en');

    expect(result.method).toBe('transcribe');
    expect(result.text).toBe('hello from transcribe');
    expect(awsTranscribeMock).toHaveBeenCalledWith('/tmp/fake.webm', 'en');
    expect(openaiCreateMock).not.toHaveBeenCalled();
  });
});

describe('textToSpeechService provider switch', () => {
  it('defaults to ElevenLabs when TTS_PROVIDER is unset', async () => {
    delete process.env.TTS_PROVIDER;
    process.env.ELEVENLABS_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('fake-audio').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);
    const pollyMock = vi.fn();
    vi.doMock('../services/awsPollyService', () => ({ textToSpeech: pollyMock }));

    const { textToSpeech } = await import('../services/textToSpeechService');
    const result = await textToSpeech('hello');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('elevenlabs.io'), expect.any(Object));
    expect(pollyMock).not.toHaveBeenCalled();
  });

  it('routes to Amazon Polly when TTS_PROVIDER=aws, without touching ElevenLabs', async () => {
    process.env.TTS_PROVIDER = 'aws';
    process.env.ELEVENLABS_API_KEY = 'test-key';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const pollyMock = vi.fn().mockResolvedValue({ success: true, audioBase64: 'cG9sbHk=', contentType: 'audio/mpeg' });
    vi.doMock('../services/awsPollyService', () => ({ textToSpeech: pollyMock }));

    const { textToSpeech } = await import('../services/textToSpeechService');
    const result = await textToSpeech('hello');

    expect(result.success).toBe(true);
    expect(result.audioBase64).toBe('cG9sbHk=');
    expect(pollyMock).toHaveBeenCalledWith('hello', {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('awsPollyService', () => {
  it('respects the global PHI_AI_ENABLED kill-switch without calling AWS', async () => {
    process.env.PHI_AI_ENABLED = 'false';
    const sendMock = vi.fn();
    vi.doMock('@aws-sdk/client-polly', () => ({
      PollyClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
      SynthesizeSpeechCommand: vi.fn(),
      DescribeVoicesCommand: vi.fn(),
    }));

    const { textToSpeech } = await import('../services/awsPollyService');
    const result = await textToSpeech('hello');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/PHI_AI_ENABLED=false/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('synthesizes speech and returns base64 audio on success', async () => {
    const audioChunks = [new Uint8Array([1, 2, 3])];
    const sendMock = vi.fn().mockResolvedValue({
      AudioStream: (async function* () { for (const c of audioChunks) yield c; })(),
    });
    vi.doMock('@aws-sdk/client-polly', () => ({
      PollyClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
      SynthesizeSpeechCommand: vi.fn().mockImplementation((args) => args),
      DescribeVoicesCommand: vi.fn(),
    }));

    const { textToSpeech } = await import('../services/awsPollyService');
    const result = await textToSpeech('hello world');

    expect(result.success).toBe(true);
    expect(result.contentType).toBe('audio/mpeg');
    expect(Buffer.from(result.audioBase64!, 'base64')).toEqual(Buffer.from([1, 2, 3]));
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid voiceId and falls back to the default rather than passing it through', async () => {
    const sendMock = vi.fn().mockResolvedValue({
      AudioStream: (async function* () { yield new Uint8Array([9]); })(),
    });
    let capturedArgs: any;
    vi.doMock('@aws-sdk/client-polly', () => ({
      PollyClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
      SynthesizeSpeechCommand: vi.fn().mockImplementation((args) => { capturedArgs = args; return args; }),
      DescribeVoicesCommand: vi.fn(),
    }));

    const { textToSpeech } = await import('../services/awsPollyService');
    await textToSpeech('hello', { voiceId: '"; DROP TABLE x; --' });

    expect(capturedArgs.VoiceId).toBe('Joanna');
  });
});

describe('awsTranscribeService', () => {
  it('fails cleanly when TRANSCRIBE_SCRATCH_BUCKET is not configured, without calling AWS', async () => {
    delete process.env.TRANSCRIBE_SCRATCH_BUCKET;
    const s3SendMock = vi.fn();
    const transcribeSendMock = vi.fn();
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn().mockImplementation(() => ({ send: s3SendMock })),
      PutObjectCommand: vi.fn(),
      DeleteObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-transcribe', () => ({
      TranscribeClient: vi.fn().mockImplementation(() => ({ send: transcribeSendMock })),
      StartTranscriptionJobCommand: vi.fn(),
      GetTranscriptionJobCommand: vi.fn(),
      DeleteTranscriptionJobCommand: vi.fn(),
    }));

    const { transcribeAudioBase64 } = await import('../services/awsTranscribeService');
    const result = await transcribeAudioBase64('ZmFrZQ==', 'audio/webm', 'en');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/TRANSCRIBE_SCRATCH_BUCKET/);
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(transcribeSendMock).not.toHaveBeenCalled();
  });

  it('respects the global PHI_AI_ENABLED kill-switch before touching S3 or Transcribe', async () => {
    process.env.PHI_AI_ENABLED = 'false';
    process.env.TRANSCRIBE_SCRATCH_BUCKET = 'test-bucket';
    const s3SendMock = vi.fn();
    const transcribeSendMock = vi.fn();
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn().mockImplementation(() => ({ send: s3SendMock })),
      PutObjectCommand: vi.fn(),
      DeleteObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-transcribe', () => ({
      TranscribeClient: vi.fn().mockImplementation(() => ({ send: transcribeSendMock })),
      StartTranscriptionJobCommand: vi.fn(),
      GetTranscriptionJobCommand: vi.fn(),
      DeleteTranscriptionJobCommand: vi.fn(),
    }));

    const { transcribeAudioBase64 } = await import('../services/awsTranscribeService');
    const result = await transcribeAudioBase64('ZmFrZQ==', 'audio/webm', 'en');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/PHI_AI_ENABLED=false/);
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(transcribeSendMock).not.toHaveBeenCalled();
  });

  it('uploads, polls to completion, fetches the transcript, and cleans up both the S3 object and the job', async () => {
    vi.useFakeTimers();
    process.env.TRANSCRIBE_SCRATCH_BUCKET = 'test-bucket';

    const s3SendMock = vi.fn().mockResolvedValue({});
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn().mockImplementation(() => ({ send: s3SendMock })),
      PutObjectCommand: vi.fn().mockImplementation((args) => ({ __type: 'put', ...args })),
      DeleteObjectCommand: vi.fn().mockImplementation((args) => ({ __type: 'delete', ...args })),
    }));

    const transcribeSendMock = vi.fn()
      .mockResolvedValueOnce({}) // StartTranscriptionJobCommand
      .mockResolvedValueOnce({ TranscriptionJob: { TranscriptionJobStatus: 'COMPLETED', LanguageCode: 'en-US', Transcript: { TranscriptFileUri: 'https://example.com/transcript.json' } } }) // GetTranscriptionJobCommand
      .mockResolvedValueOnce({}); // DeleteTranscriptionJobCommand
    vi.doMock('@aws-sdk/client-transcribe', () => ({
      TranscribeClient: vi.fn().mockImplementation(() => ({ send: transcribeSendMock })),
      StartTranscriptionJobCommand: vi.fn().mockImplementation((args) => ({ __type: 'start', ...args })),
      GetTranscriptionJobCommand: vi.fn().mockImplementation((args) => ({ __type: 'get', ...args })),
      DeleteTranscriptionJobCommand: vi.fn().mockImplementation((args) => ({ __type: 'delete-job', ...args })),
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: { transcripts: [{ transcript: 'patient reports improved mobility' }] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { transcribeAudioBase64 } = await import('../services/awsTranscribeService');
    const resultPromise = transcribeAudioBase64('ZmFrZQ==', 'audio/webm', 'en');

    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.text).toBe('patient reports improved mobility');
    expect(result.method).toBe('transcribe');

    // Upload happened before polling started.
    expect(s3SendMock).toHaveBeenCalledTimes(2); // put, then delete during cleanup
    expect(transcribeSendMock).toHaveBeenCalledTimes(3); // start, get, delete-job

    vi.useRealTimers();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertPhiAiAllowed } from '../utils/phiAiGuard';

const ENV_KEYS = ['PHI_AI_ENABLED', 'OPENAI_PHI_AI_ENABLED', 'ELEVENLABS_PHI_AI_ENABLED'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('assertPhiAiAllowed', () => {
  it('allows by default when no flags are set', () => {
    delete process.env.PHI_AI_ENABLED;
    delete process.env.OPENAI_PHI_AI_ENABLED;
    delete process.env.ELEVENLABS_PHI_AI_ENABLED;
    expect(() => assertPhiAiAllowed('test context')).not.toThrow();
    expect(() => assertPhiAiAllowed('test context', 'openai')).not.toThrow();
    expect(() => assertPhiAiAllowed('test context', 'elevenlabs')).not.toThrow();
  });

  it('blocks every vendor when the global flag is disabled', () => {
    process.env.PHI_AI_ENABLED = 'false';
    expect(() => assertPhiAiAllowed('ctx')).toThrow(/PHI_AI_ENABLED=false/);
    expect(() => assertPhiAiAllowed('ctx', 'openai')).toThrow(/PHI_AI_ENABLED=false/);
    expect(() => assertPhiAiAllowed('ctx', 'elevenlabs')).toThrow(/PHI_AI_ENABLED=false/);
  });

  it('blocks only OpenAI when OPENAI_PHI_AI_ENABLED=false, leaving other vendors unaffected', () => {
    process.env.OPENAI_PHI_AI_ENABLED = 'false';
    expect(() => assertPhiAiAllowed('ctx', 'openai')).toThrow(/OPENAI_PHI_AI_ENABLED=false/);
    expect(() => assertPhiAiAllowed('ctx', 'elevenlabs')).not.toThrow();
    expect(() => assertPhiAiAllowed('ctx')).not.toThrow();
  });

  it('blocks only ElevenLabs when ELEVENLABS_PHI_AI_ENABLED=false, leaving other vendors unaffected', () => {
    process.env.ELEVENLABS_PHI_AI_ENABLED = 'false';
    expect(() => assertPhiAiAllowed('ctx', 'elevenlabs')).toThrow(/ELEVENLABS_PHI_AI_ENABLED=false/);
    expect(() => assertPhiAiAllowed('ctx', 'openai')).not.toThrow();
    expect(() => assertPhiAiAllowed('ctx')).not.toThrow();
  });
});

describe('voiceService respects OPENAI_PHI_AI_ENABLED', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('short-circuits transcribeAudio without calling OpenAI when disabled', async () => {
    process.env.OPENAI_PHI_AI_ENABLED = 'false';
    const createMock = vi.fn();
    vi.doMock('openai', () => ({
      default: vi.fn().mockImplementation(() => ({
        audio: { transcriptions: { create: createMock } },
      })),
    }));
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return { ...actual, createReadStream: vi.fn() };
    });

    const { transcribeAudio } = await import('../services/voiceService');
    const result = await transcribeAudio('/tmp/fake.webm');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/OPENAI_PHI_AI_ENABLED=false/);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('textToSpeechService respects ELEVENLABS_PHI_AI_ENABLED', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ELEVENLABS_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ELEVENLABS_API_KEY;
  });

  it('short-circuits textToSpeech without calling the ElevenLabs API when disabled', async () => {
    process.env.ELEVENLABS_PHI_AI_ENABLED = 'false';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { textToSpeech } = await import('../services/textToSpeechService');
    const result = await textToSpeech('some SOAP note content');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ELEVENLABS_PHI_AI_ENABLED=false/);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

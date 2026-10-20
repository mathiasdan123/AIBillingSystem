/**
 * Operational kill-switch for routing PHI to an external LLM/speech provider.
 *
 * Set PHI_AI_ENABLED=false to hard-fail every PHI→AI call across all vendors
 * (SOAP generation, appeal letters, denial prediction, voice transcription,
 * text-to-speech, etc.). Use this if BAA coverage for AI providers generally
 * is unconfirmed or has lapsed.
 *
 * Pass `vendor` to also gate a specific provider independently via
 * `<VENDOR>_PHI_AI_ENABLED` (e.g. OPENAI_PHI_AI_ENABLED=false,
 * ELEVENLABS_PHI_AI_ENABLED=false) — for providers whose BAA status differs
 * from the others (OpenAI Whisper and ElevenLabs currently have no confirmed
 * BAA, unlike Bedrock; see the documented Anthropic BAA/Bedrock gap).
 *
 * Both checks default to ENABLED so current behavior is unchanged until
 * explicitly turned off.
 */
export function assertPhiAiAllowed(
  context = 'AI PHI processing',
  vendor?: 'openai' | 'elevenlabs',
): void {
  if (process.env.PHI_AI_ENABLED === 'false') {
    throw new Error(
      `${context} is disabled (PHI_AI_ENABLED=false). Enable only once BAA coverage for the AI provider is confirmed for this org.`,
    );
  }
  if (vendor) {
    const envVar = `${vendor.toUpperCase()}_PHI_AI_ENABLED`;
    if (process.env[envVar] === 'false') {
      throw new Error(
        `${context} is disabled (${envVar}=false). Enable only once BAA coverage for ${vendor} is confirmed for this org.`,
      );
    }
  }
}

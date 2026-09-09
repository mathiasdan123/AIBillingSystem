/**
 * API access-log line formatting.
 *
 * Response BODIES are deliberately never logged (see the history note in
 * index.ts — a portal magic-link token once leaked through exactly that).
 * The one exception carved out here: the machine-readable `code` constant on
 * 4xx/5xx JSON errors (e.g. MFA_VERIFICATION_REQUIRED). It lets the
 * CloudWatch ForbiddenAccess metric filter exclude benign, expected 403s
 * (users mid-MFA-enrollment) so the high-forbidden alarm only counts
 * genuinely suspicious denials. The strict constant-shape check below is the
 * PHI guard: anything that isn't a short SCREAMING_SNAKE constant is dropped,
 * so dynamic or user-influenced strings can never reach the log line.
 */

const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,39}$/;

/** Returns body.code when it is a short constant-shaped string; else undefined. */
export function safeResponseCode(body: unknown): string | undefined {
  if (
    body &&
    typeof body === 'object' &&
    typeof (body as Record<string, unknown>).code === 'string' &&
    SAFE_CODE.test((body as Record<string, string>).code)
  ) {
    return (body as Record<string, string>).code;
  }
  return undefined;
}

export function accessLogLine(
  method: string,
  redactedPath: string,
  statusCode: number,
  durationMs: number,
  responseCode?: string,
): string {
  const codeSuffix = statusCode >= 400 && responseCode ? ` [${responseCode}]` : '';
  return `${method} ${redactedPath} ${statusCode} in ${durationMs}ms${codeSuffix}`;
}

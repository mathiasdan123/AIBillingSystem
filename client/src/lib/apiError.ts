/**
 * The message a failed request should show the user.
 *
 * apiRequest() rejects with `Error("<status>: <body>")`, where the body is
 * usually the server's JSON (`{"message": "..."}`). Shown raw, the user gets
 * `{"message":"Failed to delete claim"}`; stripped of only the status prefix
 * they still get the braces. This digs the server's own message out of
 * either shape and falls back to the given text when there is none.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const withoutStatus = raw.replace(/^\d{3}:\s*/, '').trim();
  if (!withoutStatus) return fallback;
  if (withoutStatus.startsWith('{')) {
    try {
      const parsed = JSON.parse(withoutStatus);
      const msg = parsed?.message ?? parsed?.error;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    } catch {
      // not JSON after all; fall through to the raw text
    }
  }
  return withoutStatus;
}

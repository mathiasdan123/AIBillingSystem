/**
 * Strip likely PHI from clearinghouse / API error strings before they reach
 * any persisted surface (assistant transcript, MCP response, log line).
 *
 * Stedi 270/271/276/277 errors echo the request payload, which contains
 * member ID, DOB, and patient name. The assistant transcript is persisted,
 * so raw error text is HIPAA-relevant.
 *
 * Extracted from server/routes/ai-assistant.ts so MCP services can call it
 * without pulling in the entire route module (and its DB-bound side
 * effects).
 */
export function sanitizeExternalError(raw: string | undefined | null): string {
  if (!raw) return 'unknown error';
  let s = String(raw);
  // SSN-like
  s = s.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[redacted-id]');
  // ISO and US dates (DOB / DOS)
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[redacted-date]');
  s = s.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[redacted-date]');
  // Long alphanumeric tokens (member IDs, policy numbers)
  s = s.replace(/\b[A-Z0-9]{8,}\b/g, '[redacted-id]');
  // Cap length so a verbose error can't dump a full payload into the transcript
  if (s.length > 200) s = s.slice(0, 200) + '…';
  return s;
}

export function sanitizeExternalErrors(arr: string[] | undefined | null, max = 3): string[] {
  if (!arr || arr.length === 0) return [];
  return arr.slice(0, max).map(sanitizeExternalError);
}

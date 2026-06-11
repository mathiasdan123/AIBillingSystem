/**
 * Clear PHI/credential material from browser storage on logout (and idle
 * timeout). Without this, a SOAP-note draft (clinical PHI) and patient-portal
 * access tokens persisted across logout on a shared/kiosk machine and were
 * readable by the next user or any XSS.
 *
 * Preserves non-sensitive UX prefs (e.g. i18nLanguage).
 */
const SENSITIVE_KEYS = [
  'soap-notes-draft',
  'portalToken',
  'patientPortalToken',
];

export function clearSensitiveStorage(): void {
  try {
    for (const key of SENSITIVE_KEYS) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  } catch {
    // storage may be unavailable (private mode) — nothing to clear
  }
}

/**
 * Platform (superadmin) allowlist.
 *
 * Regular practice admins are tenant-scoped: they administer their OWN
 * practice and nothing else. A *platform* admin — the operator of
 * TherapyBill itself — may resolve any practice (cross-practice rollups,
 * support, ops views). This is the ONLY role permitted to honor a
 * client-supplied `?practiceId` for a practice other than their own.
 *
 * Source: PLATFORM_ADMIN_EMAILS (comma-separated, case-insensitive). When
 * unset, defaults to the founder account so existing cross-practice views
 * keep working without a config change. Set the env var in production to
 * change or extend the list.
 */
const DEFAULT_PLATFORM_ADMINS = ['daniel@therapybillai.com'];

function loadAllowlist(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS;
  const emails = raw && raw.trim()
    ? raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_PLATFORM_ADMINS;
  return new Set(emails);
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return loadAllowlist().has(email.toLowerCase());
}

import { describe, it, expect, vi } from 'vitest';

// compliance.ts transitively imports storage/db and auth, which throw at
// import time without a real DATABASE_URL. The function under test doesn't
// touch any of them, so stub each out rather than provisioning a database.
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../middleware/auditMiddleware', () => ({ logAuditEvent: vi.fn() }));
vi.mock('../replitAuth', () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));

import { computeBreachNotificationStatus } from '../routes/compliance';

/**
 * The HIPAA self-assessment's "Breach Notification Tracking" item used to
 * score a clean breach history (zero incidents) as 'not_assessed', worth 0
 * points - identical to 'non_compliant'. That understated the overall
 * score: having nothing to notify anyone about is compliant, not an
 * unassessed gap. Locking in the corrected behavior.
 */
describe('computeBreachNotificationStatus', () => {
  it('is compliant when there are zero recorded incidents', () => {
    const result = computeBreachNotificationStatus(0, 0);
    expect(result.status).toBe('compliant');
    expect(result.nextSteps).toEqual(['No breach incidents recorded — continue monitoring']);
  });

  it('is compliant when incidents exist but none have pending notifications', () => {
    const result = computeBreachNotificationStatus(0, 3);
    expect(result.status).toBe('compliant');
    expect(result.nextSteps).toEqual(['All breach notifications are up to date']);
  });

  it('is non-compliant when any notification is still pending', () => {
    const result = computeBreachNotificationStatus(2, 3);
    expect(result.status).toBe('non_compliant');
    expect(result.nextSteps[0]).toContain('2 pending incident(s)');
  });
});

/**
 * A practice's operational report goes to that practice's own admins.
 *
 * The daily denied-claims and weekly cancellation reports ran for practice 1
 * only and mailed to a single global env-configured list, so every other
 * practice received nothing. The fix iterates practices — which makes
 * recipient resolution safety-critical: sending each practice's claim and
 * patient activity to a global list would mail one customer's data to
 * another's inbox, which is worse than the original bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: { getAdminsByPractice: vi.fn(), getAllPracticeIds: vi.fn(), getDemoPractice: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({ db: {}, getPool: vi.fn(), getDb: () => ({}) }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn(() => ({ stop: vi.fn() })) } }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../email', () => ({
  sendDeniedClaimsReport: vi.fn(),
  isEmailConfigured: () => true,
  sendWeeklyCancellationReport: vi.fn(),
  sendBaaExpirationAlert: vi.fn(),
  sendCoverageChangeAlert: vi.fn(),
  sendBreachNotificationAlert: vi.fn(),
  sendAmendmentDeadlineAlert: vi.fn(),
}));

import { reportRecipientsForPractice, setDailyReportRecipients } from '../scheduler';

beforeEach(() => {
  vi.clearAllMocks();
  setDailyReportRecipients(['ops@therapybillai.com']);
});

describe('reportRecipientsForPractice', () => {
  it("sends a practice's report to that practice's own admins", async () => {
    mockStorage.getAdminsByPractice.mockResolvedValue([
      { email: 'owner@wonderkids.com' },
      { email: 'biller@wonderkids.com' },
    ]);

    const recipients = await reportRecipientsForPractice(7);

    expect(recipients).toEqual(
      expect.arrayContaining(['owner@wonderkids.com', 'biller@wonderkids.com']),
    );
  });

  it("never leaks another practice's report to the global ops list", async () => {
    mockStorage.getAdminsByPractice.mockResolvedValue([{ email: 'owner@otherpractice.com' }]);

    const recipients = await reportRecipientsForPractice(7);

    // The global list belongs to the founder's practice only.
    expect(recipients).not.toContain('ops@therapybillai.com');
  });

  it("keeps the configured list for the founder's own practice", async () => {
    mockStorage.getAdminsByPractice.mockResolvedValue([{ email: 'daniel@therapybillai.com' }]);

    const recipients = await reportRecipientsForPractice(1);

    expect(recipients).toContain('ops@therapybillai.com');
    expect(recipients).toContain('daniel@therapybillai.com');
  });

  it('returns nobody rather than falling back when a practice has no admins', async () => {
    mockStorage.getAdminsByPractice.mockResolvedValue([]);

    const recipients = await reportRecipientsForPractice(7);

    expect(recipients).toEqual([]);
  });

  it('does not throw when the admin lookup fails', async () => {
    mockStorage.getAdminsByPractice.mockRejectedValue(new Error('db down'));

    await expect(reportRecipientsForPractice(7)).resolves.toEqual([]);
  });
});

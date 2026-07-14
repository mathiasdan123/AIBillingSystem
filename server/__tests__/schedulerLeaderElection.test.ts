/**
 * Regression guard for scheduler leader election.
 *
 * Production runs 2+ ECS tasks; without coordination all 24 cron jobs fire on
 * every task (duplicate emails/SMS, double Stedi calls, double PHI purge). The
 * leader acquires a session advisory lock on a dedicated connection and is the
 * only instance that registers jobs. These tests assert:
 *   1. The instance that wins pg_try_advisory_lock registers the cron jobs.
 *   2. An instance that loses the lock registers nothing and releases its probe.
 *   3. DISABLE_SCHEDULER=1 opts a task out entirely.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = { lockAcquired: true, pingFails: false };
  const stopTaskMock = vi.fn();
  const scheduleMock = vi.fn(() => ({ stop: stopTaskMock }));
  const releaseMock = vi.fn();
  const queryMock = vi.fn(async (sql: string) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: state.lockAcquired }] };
    if (sql.trim() === 'SELECT 1' && state.pingFails) throw new Error('connection dead');
    return { rows: [] };
  });
  const fakeClient = { query: queryMock, release: releaseMock, on: vi.fn() };
  const getPoolMock = vi.fn(async () => ({ connect: vi.fn(async () => fakeClient) }));
  return { state, scheduleMock, stopTaskMock, releaseMock, queryMock, getPoolMock };
});
const { scheduleMock, stopTaskMock, releaseMock, getPoolMock } = h;

vi.mock('node-cron', () => ({ default: { schedule: h.scheduleMock } }));
vi.mock('../db', () => ({ getPool: h.getPoolMock }));

// Silence the heavy side-effectful imports pulled in transitively.
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { startScheduler, stopScheduler } from '../scheduler';

// Wait for the async election kicked off by startScheduler() to settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('scheduler leader election', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.lockAcquired = true;
    h.state.pingFails = false;
    delete process.env.DISABLE_SCHEDULER;
  });
  afterEach(() => {
    stopScheduler();
  });

  it('registers cron jobs when it wins the advisory lock (leader)', async () => {
    h.state.lockAcquired = true;
    startScheduler();
    await flush();

    expect(scheduleMock).toHaveBeenCalled();
    // The dedicated leader connection stays open (NOT released) to hold the lock.
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('registers nothing and releases the probe when it loses the lock (standby)', async () => {
    h.state.lockAcquired = false;
    startScheduler();
    await flush();

    expect(scheduleMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalled();
  });

  it('relinquishes leadership (stops jobs) when the liveness ping fails', async () => {
    vi.useFakeTimers();
    try {
      h.state.lockAcquired = true;
      startScheduler();
      await vi.advanceTimersByTimeAsync(0); // settle initial election
      expect(scheduleMock).toHaveBeenCalled();

      // Connection silently died and another task grabbed the freed lock.
      h.state.pingFails = true;
      h.state.lockAcquired = false;

      // Next 60s election tick: ping fails → relinquish (stop jobs), and the
      // re-acquire probe returns false so this task does not resume leadership.
      await vi.advanceTimersByTimeAsync(60_000);

      expect(stopTaskMock).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opts out entirely when DISABLE_SCHEDULER=1', async () => {
    process.env.DISABLE_SCHEDULER = '1';
    startScheduler();
    await flush();

    expect(getPoolMock).not.toHaveBeenCalled();
    expect(scheduleMock).not.toHaveBeenCalled();
  });
});

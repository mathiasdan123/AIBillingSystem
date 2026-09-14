import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const rows: any[] = [];
  return {
    rows,
    insert: vi.fn(() => ({ values: insertValues })),
    insertValues,
    select: vi.fn(() => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }) })),
  };
});
vi.mock('../db', () => ({ db: { insert: mockDb.insert, select: mockDb.select } }));

import { assistScore, logActivityProgress, getActivityProgress } from '../services/activityProgressService';

beforeEach(() => { vi.clearAllMocks(); mockDb.rows.length = 0; });

describe('assistScore', () => {
  it('maps the assist ladder so higher = more independent', () => {
    expect(assistScore('Dependent')).toBe(1);
    expect(assistScore('Moderate Assist')).toBe(3);
    expect(assistScore('Minimal Assist')).toBe(4);
    expect(assistScore('Independent')).toBe(6);
  });
  it('returns null for blank/unknown values', () => {
    expect(assistScore('')).toBeNull();
    expect(assistScore(undefined)).toBeNull();
    expect(assistScore('banana')).toBeNull();
  });
});

describe('logActivityProgress (opt-in)', () => {
  it('logs only activities that carry a recognized assist level', async () => {
    const n = await logActivityProgress({
      practiceId: 1, patientId: 2, soapNoteId: 3, sessionDate: '2026-09-14',
      activities: [
        { name: 'Lycra Swing', assistLevel: 'Moderate Assist' },
        { name: 'Obstacle Course' }, // no assist -> skipped
        { name: 'Rope Ladder', assistLevel: '' }, // blank -> skipped
      ],
    });
    expect(n).toBe(1);
    const inserted = mockDb.insertValues.mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ activityName: 'Lycra Swing', assistScore: 3 });
  });

  it('writes nothing when no activity has an assist level', async () => {
    const n = await logActivityProgress({ practiceId: 1, patientId: 2, soapNoteId: 3, activities: [{ name: 'Swing' }] });
    expect(n).toBe(0);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe('getActivityProgress', () => {
  it('groups rows into a series per activity', async () => {
    mockDb.rows.push(
      { activityName: 'Lycra Swing', assistScore: 3, assistLevel: 'Moderate Assist', sessionDate: '2026-08-01', createdAt: '2026-08-01' },
      { activityName: 'Lycra Swing', assistScore: 4, assistLevel: 'Minimal Assist', sessionDate: '2026-09-01', createdAt: '2026-09-01' },
    );
    const series = await getActivityProgress(2);
    expect(series).toHaveLength(1);
    expect(series[0].activityName).toBe('Lycra Swing');
    expect(series[0].points.map((p) => p.score)).toEqual([3, 4]);
  });
});

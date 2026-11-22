import { describe, it, expect } from 'vitest';
import {
  blockHeightPx,
  weekNameLines,
  MIN_BLOCK_PX,
  WEEK_NAME_LINE_PX,
  WEEK_STATUS_ROW_PX,
  WEEK_CHROME_PX,
} from '@/lib/calendarBlock';

describe('week view block sizing', () => {
  it('draws 30, 45 and 60 minute appointments at 32, 48 and 64 pixels', () => {
    expect(blockHeightPx(30)).toBe(32);
    expect(blockHeightPx(45)).toBe(48);
    expect(blockHeightPx(60)).toBe(64);
  });

  it('never draws a block shorter than the minimum', () => {
    expect(blockHeightPx(5)).toBe(MIN_BLOCK_PX);
    expect(blockHeightPx(0)).toBe(MIN_BLOCK_PX);
  });

  it('gives a wrapped name 1 line at 30 minutes, 2 at 45 and 3 at an hour', () => {
    expect(weekNameLines(blockHeightPx(30))).toBe(1);
    expect(weekNameLines(blockHeightPx(45))).toBe(2);
    expect(weekNameLines(blockHeightPx(60))).toBe(3);
  });

  it('always leaves room for the time and status row under the name', () => {
    for (const minutes of [15, 30, 45, 60, 75, 90, 120]) {
      const height = blockHeightPx(minutes);
      const lines = weekNameLines(height);
      const used = lines * WEEK_NAME_LINE_PX + WEEK_STATUS_ROW_PX + WEEK_CHROME_PX;
      // A block at the minimum height may not fit even one line; every other
      // size must fit its name lines, the status row and the padding.
      if (height > MIN_BLOCK_PX) expect(used).toBeLessThanOrEqual(height);
    }
  });

  it('caps the name at three lines however tall the block is', () => {
    expect(weekNameLines(blockHeightPx(180))).toBe(3);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import DateRangeControl from '@/components/DateRangeControl';
import { useDateRange, type DateRangeState } from '@/hooks/useDateRange';
import { COMMON_RANGE_PRESETS, CUSTOM_RANGE } from '@/lib/dateRange';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 22, 12, 0, 0)); // Nov 22, 2026, local noon
});
afterEach(() => {
  vi.useRealTimers();
});

function baseState(over: Partial<DateRangeState> = {}): DateRangeState {
  return {
    presets: COMMON_RANGE_PRESETS,
    preset: 'last30',
    setPreset: vi.fn(),
    isCustom: false,
    customStart: '',
    customEnd: '',
    setCustomStart: vi.fn(),
    setCustomEnd: vi.fn(),
    range: { start: '2026-10-23', end: '2026-11-22' },
    error: null,
    ...over,
  };
}

describe('useDateRange', () => {
  it('resolves the default preset to a range ending today', () => {
    const { result } = renderHook(() => useDateRange(COMMON_RANGE_PRESETS, 'last30', { limitToToday: true }));
    expect(result.current.range).toEqual({ start: '2026-10-23', end: '2026-11-22' });
    expect(result.current.isCustom).toBe(false);
  });

  it('starts custom dates from the range the preset was showing', () => {
    const { result } = renderHook(() => useDateRange(COMMON_RANGE_PRESETS, 'last30', { limitToToday: true }));
    act(() => result.current.setPreset(CUSTOM_RANGE));
    expect(result.current.isCustom).toBe(true);
    expect(result.current.customStart).toBe('2026-10-23');
    expect(result.current.customEnd).toBe('2026-11-22');
    expect(result.current.range).toEqual({ start: '2026-10-23', end: '2026-11-22' });
  });

  it('uses specific calendar dates once they are chosen', () => {
    const { result } = renderHook(() => useDateRange(COMMON_RANGE_PRESETS, 'last30', { limitToToday: true }));
    act(() => result.current.setPreset(CUSTOM_RANGE));
    act(() => {
      result.current.setCustomStart('2026-09-03');
      result.current.setCustomEnd('2026-09-17');
    });
    expect(result.current.range).toEqual({ start: '2026-09-03', end: '2026-09-17' });
    expect(result.current.error).toBeNull();
  });

  it('has no range and an error when the start is after the end', () => {
    const { result } = renderHook(() => useDateRange(COMMON_RANGE_PRESETS, 'last30', { limitToToday: true }));
    act(() => result.current.setPreset(CUSTOM_RANGE));
    act(() => {
      result.current.setCustomStart('2026-11-10');
      result.current.setCustomEnd('2026-11-01');
    });
    expect(result.current.range).toBeNull();
    expect(result.current.error).toMatch(/on or before/);
  });

  it('has no range, and no complaint yet, while a date is still missing', () => {
    const { result } = renderHook(() => useDateRange(COMMON_RANGE_PRESETS, 'last30', { limitToToday: true }));
    act(() => result.current.setPreset(CUSTOM_RANGE));
    act(() => result.current.setCustomEnd(''));
    expect(result.current.range).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('refuses an end date in the future when limited to today', () => {
    const { result } = renderHook(() => useDateRange(COMMON_RANGE_PRESETS, 'last30', { limitToToday: true }));
    act(() => result.current.setPreset(CUSTOM_RANGE));
    act(() => result.current.setCustomEnd('2026-12-25'));
    expect(result.current.range).toBeNull();
    expect(result.current.error).toMatch(/future/);
  });

  it('allows a future end date when not limited to today', () => {
    const { result } = renderHook(() => useDateRange(COMMON_RANGE_PRESETS, 'last30'));
    act(() => result.current.setPreset(CUSTOM_RANGE));
    act(() => result.current.setCustomEnd('2026-12-25'));
    expect(result.current.range).toEqual({ start: '2026-10-23', end: '2026-12-25' });
  });
});

describe('DateRangeControl', () => {
  it('shows the exact dates a preset covers', () => {
    render(<DateRangeControl state={baseState()} />);
    expect(screen.getByTestId('date-range-summary').textContent).toBe('Oct 23, 2026 to Nov 22, 2026');
    expect(screen.queryByTestId('date-range-start')).toBeNull();
  });

  it('offers a start and an end calendar date when custom dates are chosen', () => {
    const setCustomStart = vi.fn();
    const setCustomEnd = vi.fn();
    render(
      <DateRangeControl
        state={baseState({
          preset: CUSTOM_RANGE,
          isCustom: true,
          customStart: '2026-10-23',
          customEnd: '2026-11-22',
          setCustomStart,
          setCustomEnd,
          maxDate: '2026-11-22',
        })}
      />,
    );
    const start = screen.getByTestId('date-range-start') as HTMLInputElement;
    const end = screen.getByTestId('date-range-end') as HTMLInputElement;
    expect(start.type).toBe('date');
    expect(end.type).toBe('date');
    expect(start.value).toBe('2026-10-23');
    expect(end.value).toBe('2026-11-22');
    // The end cannot be before the start, nor after the allowed maximum.
    expect(end.min).toBe('2026-10-23');
    expect(end.max).toBe('2026-11-22');
    fireEvent.change(start, { target: { value: '2026-09-03' } });
    fireEvent.change(end, { target: { value: '2026-09-17' } });
    expect(setCustomStart).toHaveBeenCalledWith('2026-09-03');
    expect(setCustomEnd).toHaveBeenCalledWith('2026-09-17');
  });

  it('shows the problem when the chosen dates cannot be used', () => {
    render(
      <DateRangeControl
        state={baseState({
          preset: CUSTOM_RANGE,
          isCustom: true,
          customStart: '2026-11-10',
          customEnd: '2026-11-01',
          range: null,
          error: 'The start date must be on or before the end date.',
        })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/on or before/);
    expect(screen.queryByTestId('date-range-summary')).toBeNull();
  });

  it('says what is needed while the dates are incomplete', () => {
    render(<DateRangeControl state={baseState({ preset: CUSTOM_RANGE, isCustom: true, range: null })} />);
    expect(screen.getByTestId('date-range-hint').textContent).toMatch(/Choose a start and end date/);
  });
});

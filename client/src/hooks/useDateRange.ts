import { useMemo, useState } from 'react';
import {
  CUSTOM_RANGE,
  checkCustomRange,
  toIsoDate,
  type DateRange,
  type RangePreset,
} from '@/lib/dateRange';

export interface DateRangeState {
  presets: RangePreset[];
  /** A preset value, or CUSTOM_RANGE. */
  preset: string;
  setPreset: (value: string) => void;
  isCustom: boolean;
  customStart: string;
  customEnd: string;
  setCustomStart: (value: string) => void;
  setCustomEnd: (value: string) => void;
  /** The range to query, or null while custom dates are incomplete or invalid. */
  range: DateRange | null;
  /** A message about the custom dates, or null. */
  error: string | null;
  /** Latest end date a person may pick, or undefined for no limit. */
  maxDate?: string;
}

/**
 * State for a date-range selector: a few presets plus specific calendar dates.
 * Choosing "custom" starts from the range the current preset covers, so a
 * person adjusts a range they can already see instead of typing two dates from
 * scratch.
 */
export function useDateRange(
  presets: RangePreset[],
  defaultPreset: string,
  opts: { limitToToday?: boolean } = {},
): DateRangeState {
  const [preset, setPresetValue] = useState(defaultPreset);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const maxDate = opts.limitToToday ? toIsoDate(new Date()) : undefined;

  const presetRange = useMemo(
    () => presets.find((p) => p.value === preset)?.resolve(new Date()) ?? null,
    // presets are module constants in every caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset],
  );

  const setPreset = (value: string) => {
    if (value === CUSTOM_RANGE && !customStart && !customEnd && presetRange) {
      setCustomStart(presetRange.start);
      setCustomEnd(presetRange.end);
    }
    setPresetValue(value);
  };

  const check = preset === CUSTOM_RANGE ? checkCustomRange(customStart, customEnd, { maxDate }) : null;
  const range = useMemo<DateRange | null>(() => {
    if (preset !== CUSTOM_RANGE) return presetRange;
    const c = checkCustomRange(customStart, customEnd, { maxDate });
    return c.ok ? c.range : null;
  }, [preset, presetRange, customStart, customEnd, maxDate]);

  return {
    presets,
    preset,
    setPreset,
    isCustom: preset === CUSTOM_RANGE,
    customStart,
    customEnd,
    setCustomStart,
    setCustomEnd,
    range,
    error: check && !check.ok ? check.error : null,
    maxDate,
  };
}

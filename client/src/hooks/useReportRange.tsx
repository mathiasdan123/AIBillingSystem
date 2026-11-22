import { useEffect, useRef } from 'react';
import DateRangeControl from '@/components/DateRangeControl';
import { useDateRange } from '@/hooks/useDateRange';
import { COMMON_RANGE_PRESETS, type DateRange } from '@/lib/dateRange';

/**
 * Range selection for the canned report pages: the shared control plus the URL
 * to fetch. The reports default to the last 90 days (the server's default
 * too). While custom dates are being typed and are not yet a valid range, the
 * report keeps showing the last valid one and the control says what is needed.
 */
export function useReportRange(endpoint: string) {
  const state = useDateRange(COMMON_RANGE_PRESETS, 'last90', { limitToToday: true });
  const lastValid = useRef<DateRange | null>(null);
  useEffect(() => {
    if (state.range) lastValid.current = state.range;
  }, [state.range]);

  const effective = state.range ?? lastValid.current ?? COMMON_RANGE_PRESETS[1].resolve(new Date());
  const url = `${endpoint}?start=${effective.start}&end=${effective.end}`;
  const control = <DateRangeControl state={state} testId="report-range" />;
  return { url, range: effective, control };
}

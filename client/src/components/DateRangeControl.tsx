import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CUSTOM_RANGE, parseIsoDate } from '@/lib/dateRange';
import type { DateRangeState } from '@/hooks/useDateRange';

const formatDay = (iso: string) => {
  const d = parseIsoDate(iso);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : iso;
};

/**
 * A range selector: a few quick presets, or "Custom dates" to pick a specific
 * start and end on the calendar. Shows the exact dates being used either way.
 */
export default function DateRangeControl({
  state,
  className = '',
  triggerClassName = 'w-44',
  testId = 'date-range',
}: {
  state: DateRangeState;
  className?: string;
  triggerClassName?: string;
  testId?: string;
}) {
  const { presets, preset, setPreset, isCustom, customStart, customEnd, setCustomStart, setCustomEnd, range, error, maxDate } = state;

  return (
    <div className={`flex flex-col gap-1 ${className}`} data-testid={testId}>
      <div className="flex flex-wrap items-end gap-2">
        <Select value={preset} onValueChange={setPreset}>
          <SelectTrigger className={triggerClassName} aria-label="Date range" data-testid={`${testId}-select`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_RANGE}>Custom dates</SelectItem>
          </SelectContent>
        </Select>

        {isCustom && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`${testId}-start`} className="text-xs">Start date</Label>
              <Input
                id={`${testId}-start`}
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                max={customEnd || maxDate}
                className="w-40"
                data-testid={`${testId}-start`}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${testId}-end`} className="text-xs">End date</Label>
              <Input
                id={`${testId}-end`}
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                min={customStart || undefined}
                max={maxDate}
                className="w-40"
                data-testid={`${testId}-end`}
              />
            </div>
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-600" data-testid={`${testId}-error`}>
          {error}
        </p>
      ) : range ? (
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-summary`}>
          {range.start === range.end ? formatDay(range.start) : `${formatDay(range.start)} to ${formatDay(range.end)}`}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-hint`}>
          Choose a start and end date.
        </p>
      )}
    </div>
  );
}

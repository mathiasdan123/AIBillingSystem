import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

/**
 * GoalProgressChart — visualizes a single treatment goal's progress over time
 * (Fusion-parity: goal-progress trend). Plots two sources on one 0-100 scale:
 *   - SOAP-linked progress (progressPercentage, already 0-100)
 *   - Manual progress notes (progressRating 1-5, normalized to 20-100%)
 * Points are ordered chronologically (oldest → newest). Read-only.
 */

export interface GoalProgressPoint {
  date: string;
  type: 'manual' | 'soap';
  progressRating?: number | null;
  progressPercentage?: number | null;
}

interface GoalProgressChartProps {
  points: GoalProgressPoint[];
  /** Optional current goal % to draw as a target/baseline reference line. */
  currentPercentage?: number | null;
}

function toPercent(p: GoalProgressPoint): number | null {
  if (p.type === 'soap' && typeof p.progressPercentage === 'number') {
    return Math.max(0, Math.min(100, p.progressPercentage));
  }
  if (p.type === 'manual' && typeof p.progressRating === 'number') {
    // 1-5 rating → 20-100% so both series share one axis.
    return Math.max(0, Math.min(100, p.progressRating * 20));
  }
  return null;
}

export function GoalProgressChart({ points, currentPercentage }: GoalProgressChartProps) {
  const data = useMemo(() => {
    return points
      .map((p) => ({ ts: new Date(p.date).getTime(), date: p.date, value: toPercent(p) }))
      .filter((d) => d.value !== null && !Number.isNaN(d.ts))
      .sort((a, b) => a.ts - b.ts)
      .map((d) => ({
        label: new Date(d.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: d.value as number,
      }));
  }, [points]);

  // Need at least 2 points to show a meaningful trend line.
  if (data.length < 2) {
    return (
      <p className="text-xs text-slate-400 italic">
        {data.length === 0
          ? 'No progress data to chart yet.'
          : 'Add another progress entry to see a trend.'}
      </p>
    );
  }

  return (
    <div className="h-40 w-full" data-testid="goal-progress-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            formatter={(v: number) => [`${v}%`, 'Progress']}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          {typeof currentPercentage === 'number' && (
            <ReferenceLine
              y={currentPercentage}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{ value: 'current', fontSize: 10, fill: '#94a3b8', position: 'insideTopRight' }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 3, fill: '#2563eb' }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default GoalProgressChart;

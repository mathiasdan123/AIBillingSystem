/**
 * Scheduling Optimizer Service
 *
 * AI-powered scheduling analysis and optimization for therapist utilization.
 * Identifies gaps, suggests optimal slots, and generates natural language insights.
 */

import Anthropic from '@anthropic-ai/sdk';
import { storage } from '../storage';
import logger from './logger';

// Types

interface DateRange {
  start: Date;
  end: Date;
}

interface GapInfo {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  dayOfWeek: string;
}

interface DayUtilization {
  date: string;
  dayOfWeek: string;
  scheduledMinutes: number;
  availableMinutes: number;
  utilizationRate: number;
  appointmentCount: number;
  gaps: GapInfo[];
}

interface ScheduleAnalysis {
  therapistId: string;
  therapistName: string;
  dateRange: { start: string; end: string };
  totalDays: number;
  totalAppointments: number;
  overallUtilizationRate: number;
  averageDailyAppointments: number;
  peakHours: { hour: number; count: number }[];
  offPeakHours: { hour: number; count: number }[];
  totalGapMinutes: number;
  averageGapMinutes: number;
  gaps: GapInfo[];
  dailyUtilization: DayUtilization[];
  backToBackRisks: { date: string; startTime: string; endTime: string; consecutiveCount: number }[];
  noShowRate: number;
}

interface SlotSuggestion {
  date: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  score: number;
  reason: string;
}

interface ScheduleInsight {
  type: 'gap' | 'utilization' | 'pattern' | 'no_show' | 'overload' | 'suggestion';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

interface UtilizationHeatmapCell {
  dayOfWeek: number;
  hour: number;
  utilizationRate: number;
  appointmentCount: number;
}

// Constants

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 19;
const WORK_HOURS_PER_DAY = WORK_END_HOUR - WORK_START_HOUR;
const WORK_MINUTES_PER_DAY = WORK_HOURS_PER_DAY * 60;
const DEFAULT_BUFFER_MINUTES = 15;
const MAX_CONSECUTIVE_SESSIONS = 4;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Helpers

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getMinutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function groupAppointmentsByDate(appointments: any[]): Map<string, any[]> {
  const groups = new Map<string, any[]>();
  for (const appt of appointments) {
    const dateKey = formatDate(new Date(appt.startTime));
    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(appt);
  }
  return groups;
}

// Core Functions

/**
 * Analyzes a therapist's schedule for a given date range.
 * Identifies gaps, utilization rates, peak hours, and overload risks.
 */
export async function analyzeSchedule(
  practiceId: number,
  therapistId: string,
  dateRange: DateRange
): Promise<ScheduleAnalysis> {
  const allAppointments = await storage.getAppointmentsByDateRange(
    practiceId,
    dateRange.start,
    dateRange.end
  );

  // Filter to this therapist's non-cancelled appointments
  const appointments = allAppointments.filter(
    (a: any) => a.therapistId === therapistId && a.status !== 'cancelled'
  );

  // Also count no-shows separately
  const noShows = appointments.filter((a: any) => a.status === 'no_show');
  const completedOrScheduled = appointments.filter(
    (a: any) => a.status === 'completed' || a.status === 'scheduled'
  );

  // Get therapist info
  let therapistName = 'Unknown';
  try {
    const user = await storage.getUser(therapistId);
    if (user) {
      therapistName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Unknown';
    }
  } catch {
    // ignore
  }

  // Group by date
  const byDate = groupAppointmentsByDate(appointments);

  // Compute daily utilization
  const dailyUtilization: DayUtilization[] = [];
  const allGaps: GapInfo[] = [];
  const backToBackRisks: ScheduleAnalysis['backToBackRisks'] = [];

  // Hour frequency tracking
  const hourCounts = new Map<number, number>();
  for (let h = WORK_START_HOUR; h < WORK_END_HOUR; h++) {
    hourCounts.set(h, 0);
  }

  // Iterate all dates in range
  const currentDate = new Date(dateRange.start);
  const endDate = new Date(dateRange.end);
  let totalDays = 0;

  while (currentDate <= endDate) {
    const dow = currentDate.getDay();
    // Skip weekends
    if (dow !== 0 && dow !== 6) {
      totalDays++;
      const dateKey = formatDate(currentDate);
      const dayAppts = (byDate.get(dateKey) || [])
        .sort((a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      let scheduledMinutes = 0;
      const dayGaps: GapInfo[] = [];

      // Track consecutive sessions for overload detection
      let consecutiveCount = 0;
      let consecutiveStart = '';

      for (let i = 0; i < dayAppts.length; i++) {
        const appt = dayAppts[i];
        const start = new Date(appt.startTime);
        const end = new Date(appt.endTime);
        const duration = getMinutesBetween(start, end);
        scheduledMinutes += duration;

        // Track hour frequency
        const startHour = start.getHours();
        hourCounts.set(startHour, (hourCounts.get(startHour) || 0) + 1);

        // Check gap between this and next appointment
        if (i < dayAppts.length - 1) {
          const nextStart = new Date(dayAppts[i + 1].startTime);
          const gapMinutes = getMinutesBetween(end, nextStart);

          if (gapMinutes > DEFAULT_BUFFER_MINUTES) {
            const gap: GapInfo = {
              date: dateKey,
              startTime: formatTime(end),
              endTime: formatTime(nextStart),
              durationMinutes: gapMinutes,
              dayOfWeek: DAY_NAMES[dow],
            };
            dayGaps.push(gap);
            allGaps.push(gap);
          }

          // Back-to-back detection (less than buffer time between sessions)
          if (gapMinutes < DEFAULT_BUFFER_MINUTES) {
            if (consecutiveCount === 0) {
              consecutiveStart = formatTime(start);
              consecutiveCount = 1;
            }
            consecutiveCount++;
          } else {
            if (consecutiveCount >= MAX_CONSECUTIVE_SESSIONS) {
              backToBackRisks.push({
                date: dateKey,
                startTime: consecutiveStart,
                endTime: formatTime(end),
                consecutiveCount,
              });
            }
            consecutiveCount = 0;
          }
        } else if (consecutiveCount >= MAX_CONSECUTIVE_SESSIONS) {
          // End of day, check final consecutive block
          const end2 = new Date(appt.endTime);
          backToBackRisks.push({
            date: dateKey,
            startTime: consecutiveStart,
            endTime: formatTime(end2),
            consecutiveCount: consecutiveCount + 1,
          });
        }
      }

      const utilizationRate = totalDays > 0 ? scheduledMinutes / WORK_MINUTES_PER_DAY : 0;

      dailyUtilization.push({
        date: dateKey,
        dayOfWeek: DAY_NAMES[dow],
        scheduledMinutes,
        availableMinutes: WORK_MINUTES_PER_DAY,
        utilizationRate: Math.round(utilizationRate * 100) / 100,
        appointmentCount: dayAppts.length,
        gaps: dayGaps,
      });
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Compute peak / off-peak hours
  const hourEntries = Array.from(hourCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  const peakHours = hourEntries
    .filter(([, count]) => count > 0)
    .slice(0, 3)
    .map(([hour, count]) => ({ hour, count }));

  const offPeakHours = hourEntries
    .filter(([, count]) => count === 0 || count <= (hourEntries[0]?.[1] || 0) * 0.3)
    .slice(0, 3)
    .map(([hour, count]) => ({ hour, count }));

  const totalScheduledMinutes = dailyUtilization.reduce((sum, d) => sum + d.scheduledMinutes, 0);
  const totalAvailableMinutes = totalDays * WORK_MINUTES_PER_DAY;
  const overallUtilization = totalAvailableMinutes > 0
    ? Math.round((totalScheduledMinutes / totalAvailableMinutes) * 100) / 100
    : 0;

  const totalGapMinutes = allGaps.reduce((sum, g) => sum + g.durationMinutes, 0);

  return {
    therapistId,
    therapistName,
    dateRange: {
      start: formatDate(dateRange.start),
      end: formatDate(dateRange.end),
    },
    totalDays,
    totalAppointments: appointments.length,
    overallUtilizationRate: overallUtilization,
    averageDailyAppointments: totalDays > 0
      ? Math.round((appointments.length / totalDays) * 10) / 10
      : 0,
    peakHours,
    offPeakHours,
    totalGapMinutes,
    averageGapMinutes: allGaps.length > 0
      ? Math.round(totalGapMinutes / allGaps.length)
      : 0,
    gaps: allGaps,
    dailyUtilization,
    backToBackRisks,
    noShowRate: appointments.length > 0
      ? Math.round((noShows.length / appointments.length) * 100) / 100
      : 0,
  };
}

/**
 * Suggests optimal time slots for a new appointment.
 * Prioritizes filling gaps, respects buffer times, and avoids overloading.
 */
export async function suggestOptimalSlots(
  practiceId: number,
  therapistId: string,
  durationMinutes: number,
  preferences?: {
    bufferMinutes?: number;
    preferredDays?: number[];
    preferredTimeStart?: string;
    preferredTimeEnd?: string;
    lookAheadDays?: number;
  }
): Promise<SlotSuggestion[]> {
  const bufferMinutes = preferences?.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
  const lookAheadDays = preferences?.lookAheadDays ?? 14;
  const prefTimeStart = preferences?.preferredTimeStart
    ? parseTimeToMinutes(preferences.preferredTimeStart)
    : WORK_START_HOUR * 60;
  const prefTimeEnd = preferences?.preferredTimeEnd
    ? parseTimeToMinutes(preferences.preferredTimeEnd)
    : WORK_END_HOUR * 60;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1); // Start from tomorrow
  const end = new Date(start);
  end.setDate(end.getDate() + lookAheadDays);

  const allAppointments = await storage.getAppointmentsByDateRange(practiceId, start, end);
  const appointments = allAppointments.filter(
    (a: any) => a.therapistId === therapistId && a.status !== 'cancelled'
  );

  const byDate = groupAppointmentsByDate(appointments);

  // Compute daily load to avoid overloading
  const dailyLoadMap = new Map<string, number>();
  Array.from(byDate.entries()).forEach(([dateKey, appts]) => {
    dailyLoadMap.set(dateKey, appts.length);
  });
  const avgDailyLoad = dailyLoadMap.size > 0
    ? Array.from(dailyLoadMap.values()).reduce((a, b) => a + b, 0) / dailyLoadMap.size
    : 0;
  const maxDailyLoad = Math.max(Math.ceil(avgDailyLoad * 1.3), 6);

  const suggestions: SlotSuggestion[] = [];
  const currentDate = new Date(start);

  while (currentDate <= end && suggestions.length < 10) {
    const dow = currentDate.getDay();

    // Skip weekends
    if (dow === 0 || dow === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    // Check preferred days
    if (preferences?.preferredDays && !preferences.preferredDays.includes(dow)) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    const dateKey = formatDate(currentDate);
    const dayAppts = (byDate.get(dateKey) || [])
      .sort((a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    const dayLoad = dayAppts.length;

    // Skip overloaded days
    if (dayLoad >= maxDailyLoad) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    // Find available slots in this day
    const daySlots = findAvailableSlots(
      dateKey,
      dayAppts,
      durationMinutes,
      bufferMinutes,
      prefTimeStart,
      prefTimeEnd
    );

    for (const slot of daySlots) {
      let score = 50; // Base score
      let reason = 'Available slot';

      // Boost score for gap-filling slots
      if (slot.fillsGap) {
        score += 30;
        reason = 'Fills a gap between existing appointments';
      }

      // Boost for preferred time range
      const slotStartMinutes = parseTimeToMinutes(slot.startTime);
      if (slotStartMinutes >= prefTimeStart && slotStartMinutes + durationMinutes <= prefTimeEnd) {
        score += 10;
        reason += reason.includes('gap') ? ' within preferred hours' : 'Within preferred time range';
      }

      // Reduce score for overloaded days
      if (dayLoad > avgDailyLoad) {
        score -= 10;
      }

      // Boost for days with consistent patterns (same day of week preference)
      const sameDowCount = Array.from(byDate.entries())
        .filter(([dk]) => new Date(dk).getDay() === dow)
        .length;
      if (sameDowCount > 0) {
        score += 5; // Therapist already works this day of week
      }

      suggestions.push({
        date: dateKey,
        dayOfWeek: DAY_NAMES[dow],
        startTime: slot.startTime,
        endTime: slot.endTime,
        score: Math.min(100, Math.max(0, score)),
        reason,
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Sort by score descending
  suggestions.sort((a, b) => b.score - a.score);
  return suggestions.slice(0, 10);
}

interface AvailableSlot {
  startTime: string;
  endTime: string;
  fillsGap: boolean;
}

function findAvailableSlots(
  dateKey: string,
  dayAppts: any[],
  durationMinutes: number,
  bufferMinutes: number,
  prefTimeStart: number,
  prefTimeEnd: number
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  const totalNeeded = durationMinutes + bufferMinutes;
  const workStart = Math.max(WORK_START_HOUR * 60, prefTimeStart);
  const workEnd = Math.min(WORK_END_HOUR * 60, prefTimeEnd);

  if (dayAppts.length === 0) {
    // Whole day is open - suggest start of working hours
    if (workEnd - workStart >= durationMinutes) {
      slots.push({
        startTime: minutesToTime(workStart),
        endTime: minutesToTime(workStart + durationMinutes),
        fillsGap: false,
      });
    }
    return slots;
  }

  // Check slot before first appointment
  const firstStart = new Date(dayAppts[0].startTime);
  const firstStartMinutes = firstStart.getHours() * 60 + firstStart.getMinutes();
  if (firstStartMinutes - workStart >= totalNeeded) {
    const slotStart = Math.max(workStart, prefTimeStart);
    slots.push({
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotStart + durationMinutes),
      fillsGap: false,
    });
  }

  // Check gaps between appointments
  for (let i = 0; i < dayAppts.length - 1; i++) {
    const endTime = new Date(dayAppts[i].endTime);
    const nextStart = new Date(dayAppts[i + 1].startTime);
    const endMinutes = endTime.getHours() * 60 + endTime.getMinutes();
    const nextStartMinutes = nextStart.getHours() * 60 + nextStart.getMinutes();
    const gapMinutes = nextStartMinutes - endMinutes;

    if (gapMinutes >= totalNeeded) {
      const slotStart = endMinutes + bufferMinutes;
      if (slotStart >= prefTimeStart && slotStart + durationMinutes <= prefTimeEnd) {
        slots.push({
          startTime: minutesToTime(slotStart),
          endTime: minutesToTime(slotStart + durationMinutes),
          fillsGap: true,
        });
      }
    }
  }

  // Check slot after last appointment
  const lastEnd = new Date(dayAppts[dayAppts.length - 1].endTime);
  const lastEndMinutes = lastEnd.getHours() * 60 + lastEnd.getMinutes();
  if (workEnd - (lastEndMinutes + bufferMinutes) >= durationMinutes) {
    const slotStart = lastEndMinutes + bufferMinutes;
    if (slotStart >= prefTimeStart && slotStart + durationMinutes <= prefTimeEnd) {
      slots.push({
        startTime: minutesToTime(slotStart),
        endTime: minutesToTime(slotStart + durationMinutes),
        fillsGap: false,
      });
    }
  }

  return slots;
}

/**
 * Generates AI-powered natural language insights about scheduling patterns.
 * Falls back to rule-based insights when Claude is not configured.
 */
export async function generateScheduleInsights(
  practiceId: number,
  dateRange: DateRange
): Promise<ScheduleInsight[]> {
  // Get all therapists for the practice
  const allAppointments = await storage.getAppointmentsByDateRange(
    practiceId,
    dateRange.start,
    dateRange.end
  );

  const therapistIds = Array.from(new Set(
    allAppointments
      .filter((a: any) => a.therapistId)
      .map((a: any) => a.therapistId)
  ));

  // Build analysis for each therapist
  const analyses: ScheduleAnalysis[] = [];
  for (const tid of therapistIds) {
    try {
      const analysis = await analyzeSchedule(practiceId, tid as string, dateRange);
      analyses.push(analysis);
    } catch (err) {
      logger.warn('Failed to analyze schedule for therapist', { therapistId: tid });
    }
  }

  // Generate rule-based insights first
  const insights = generateRuleBasedInsights(analyses, allAppointments);

  // Try AI-powered insights via Claude
  try {
    const aiInsights = await generateAIInsights(analyses, allAppointments);
    if (aiInsights.length > 0) {
      insights.push(...aiInsights);
    }
  } catch (err) {
    logger.info('Claude not available for scheduling insights, using rule-based only');
  }

  return insights;
}

function generateRuleBasedInsights(
  analyses: ScheduleAnalysis[],
  allAppointments: any[]
): ScheduleInsight[] {
  const insights: ScheduleInsight[] = [];

  for (const analysis of analyses) {
    // Gap detection
    if (analysis.totalGapMinutes > 120) {
      // Group gaps by day of week
      const gapsByDay = new Map<string, number>();
      for (const gap of analysis.gaps) {
        const current = gapsByDay.get(gap.dayOfWeek) || 0;
        gapsByDay.set(gap.dayOfWeek, current + gap.durationMinutes);
      }

      Array.from(gapsByDay.entries()).forEach(([day, minutes]) => {
        if (minutes >= 60) {
          insights.push({
            type: 'gap',
            severity: minutes >= 180 ? 'warning' : 'info',
            title: `Schedule Gaps on ${day}s`,
            message: `${analysis.therapistName} has ${Math.round(minutes / 60 * 10) / 10} hours of gaps on ${day}s. Consider consolidating appointments to reduce wasted time.`,
            data: { therapistId: analysis.therapistId, dayOfWeek: day, gapMinutes: minutes },
          });
        }
      });
    }

    // Low utilization detection
    if (analysis.overallUtilizationRate < 0.4 && analysis.totalAppointments > 0) {
      insights.push({
        type: 'utilization',
        severity: 'warning',
        title: `Low Utilization for ${analysis.therapistName}`,
        message: `${analysis.therapistName}'s utilization rate is ${Math.round(analysis.overallUtilizationRate * 100)}%. There is capacity to add more appointments.`,
        data: { therapistId: analysis.therapistId, rate: analysis.overallUtilizationRate },
      });
    }

    // Back-to-back overload
    for (const risk of analysis.backToBackRisks) {
      insights.push({
        type: 'overload',
        severity: 'warning',
        title: `Back-to-Back Overload`,
        message: `${analysis.therapistName} has ${risk.consecutiveCount} consecutive sessions on ${risk.date} from ${risk.startTime} to ${risk.endTime} with no breaks. Consider adding buffer time.`,
        data: { therapistId: analysis.therapistId, ...risk },
      });
    }

    // High no-show rate
    if (analysis.noShowRate > 0.15 && analysis.totalAppointments >= 5) {
      insights.push({
        type: 'no_show',
        severity: analysis.noShowRate > 0.25 ? 'critical' : 'warning',
        title: `High No-Show Rate`,
        message: `${analysis.therapistName}'s no-show rate is ${Math.round(analysis.noShowRate * 100)}%. Consider enabling appointment reminders or implementing a no-show policy.`,
        data: { therapistId: analysis.therapistId, rate: analysis.noShowRate },
      });
    }
  }

  // Practice-wide insights
  // Find underutilized day-of-week patterns across all therapists
  const dowUtilization = new Map<string, { total: number; count: number }>();
  for (const analysis of analyses) {
    for (const day of analysis.dailyUtilization) {
      const entry = dowUtilization.get(day.dayOfWeek) || { total: 0, count: 0 };
      entry.total += day.utilizationRate;
      entry.count += 1;
      dowUtilization.set(day.dayOfWeek, entry);
    }
  }

  Array.from(dowUtilization.entries()).forEach(([day, data]) => {
    const avgRate = data.count > 0 ? data.total / data.count : 0;
    if (avgRate < 0.3 && data.count >= 2) {
      insights.push({
        type: 'pattern',
        severity: 'info',
        title: `${day}s Underutilized`,
        message: `${day}s are consistently underutilized across providers (avg ${Math.round(avgRate * 100)}% utilization). Consider offering promotions or consolidating schedules.`,
        data: { dayOfWeek: day, avgUtilization: avgRate },
      });
    }
  });

  // No-show patterns by time of day
  const noShowsByHour = new Map<number, { total: number; noShows: number }>();
  for (const appt of allAppointments) {
    if (appt.status === 'completed' || appt.status === 'no_show') {
      const hour = new Date(appt.startTime).getHours();
      const entry = noShowsByHour.get(hour) || { total: 0, noShows: 0 };
      entry.total += 1;
      if (appt.status === 'no_show') entry.noShows += 1;
      noShowsByHour.set(hour, entry);
    }
  }

  Array.from(noShowsByHour.entries()).forEach(([hour, data]) => {
    if (data.total >= 5) {
      const rate = data.noShows / data.total;
      if (rate > 0.2) {
        const dayOfWeekCounts = new Map<number, number>();
        for (const appt of allAppointments) {
          if (appt.status === 'no_show' && new Date(appt.startTime).getHours() === hour) {
            const dow = new Date(appt.startTime).getDay();
            dayOfWeekCounts.set(dow, (dayOfWeekCounts.get(dow) || 0) + 1);
          }
        }
        const peakDow = Array.from(dayOfWeekCounts.entries())
          .sort((a, b) => b[1] - a[1])[0];

        const dayName = peakDow ? DAY_NAMES[peakDow[0]] : '';
        const timeStr = `${hour > 12 ? hour - 12 : hour} ${hour >= 12 ? 'PM' : 'AM'}`;

        insights.push({
          type: 'no_show',
          severity: 'info',
          title: `No-Show Pattern Detected`,
          message: `No-show rate is highest at ${timeStr}${dayName ? ` on ${dayName}s` : ''} (${Math.round(rate * 100)}%). Consider sending extra reminders for these time slots.`,
          data: { hour, rate, dayOfWeek: dayName },
        });
      }
    }
  });

  return insights;
}

async function generateAIInsights(
  analyses: ScheduleAnalysis[],
  allAppointments: any[]
): Promise<ScheduleInsight[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return [];
  }

  const anthropic = new Anthropic({ apiKey });

  // Build a summary for the AI
  const summaryData = analyses.map((a) => ({
    therapist: a.therapistName,
    utilization: `${Math.round(a.overallUtilizationRate * 100)}%`,
    avgDailyAppts: a.averageDailyAppointments,
    totalGapHours: Math.round(a.totalGapMinutes / 60 * 10) / 10,
    noShowRate: `${Math.round(a.noShowRate * 100)}%`,
    peakHours: a.peakHours.map((h) => `${h.hour}:00`),
    backToBackRisks: a.backToBackRisks.length,
    gapsByDay: (() => {
      const gbd: Record<string, number> = {};
      for (const g of a.gaps) {
        gbd[g.dayOfWeek] = (gbd[g.dayOfWeek] || 0) + g.durationMinutes;
      }
      return gbd;
    })(),
  }));

  const totalAppts = allAppointments.length;
  const cancelledCount = allAppointments.filter((a: any) => a.status === 'cancelled').length;
  const noShowCount = allAppointments.filter((a: any) => a.status === 'no_show').length;

  const prompt = `You are a scheduling optimization expert for a therapy practice. Analyze the following scheduling data and provide 3-5 actionable insights. Each insight should be specific and data-driven.

Practice Summary:
- Total appointments in period: ${totalAppts}
- Cancellations: ${cancelledCount} (${totalAppts > 0 ? Math.round(cancelledCount / totalAppts * 100) : 0}%)
- No-shows: ${noShowCount} (${totalAppts > 0 ? Math.round(noShowCount / totalAppts * 100) : 0}%)
- Number of therapists: ${analyses.length}

Therapist Details:
${JSON.stringify(summaryData, null, 2)}

Respond with a JSON array of objects, each with:
- "type": one of "gap", "utilization", "pattern", "no_show", "overload", "suggestion"
- "severity": one of "info", "warning", "critical"
- "title": short title (under 60 chars)
- "message": detailed actionable insight (1-2 sentences)

Return ONLY the JSON array, no markdown or other text.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const content = textBlock?.text?.trim();
    if (!content) return [];

    // Parse JSON, handle potential markdown wrapping
    let jsonStr = content;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item: any) => item.type && item.severity && item.title && item.message)
      .map((item: any) => ({
        type: item.type,
        severity: item.severity,
        title: item.title,
        message: item.message,
        data: { source: 'ai' },
      }));
  } catch (err) {
    logger.warn('Failed to generate AI scheduling insights', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Generates utilization heatmap data (hour x day-of-week grid).
 */
export async function getUtilizationHeatmap(
  practiceId: number,
  dateRange: DateRange,
  therapistId?: string
): Promise<UtilizationHeatmapCell[]> {
  const allAppointments = await storage.getAppointmentsByDateRange(
    practiceId,
    dateRange.start,
    dateRange.end
  );

  const appointments = therapistId
    ? allAppointments.filter((a: any) => a.therapistId === therapistId && a.status !== 'cancelled')
    : allAppointments.filter((a: any) => a.status !== 'cancelled');

  // Count appointments per (dayOfWeek, hour) cell
  const cellCounts = new Map<string, number>();
  // Count how many weeks this day-of-week appears in the range (for averaging)
  const weekCounts = new Map<number, number>();

  const currentDate = new Date(dateRange.start);
  const endDate = new Date(dateRange.end);
  while (currentDate <= endDate) {
    const dow = currentDate.getDay();
    if (dow !== 0 && dow !== 6) {
      weekCounts.set(dow, (weekCounts.get(dow) || 0) + 1);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  for (const appt of appointments) {
    const start = new Date(appt.startTime);
    const end = new Date(appt.endTime);
    const dow = start.getDay();

    // Mark each hour that this appointment spans
    let currentHour = start.getHours();
    const endHour = end.getHours() + (end.getMinutes() > 0 ? 1 : 0);

    while (currentHour < endHour && currentHour < WORK_END_HOUR) {
      if (currentHour >= WORK_START_HOUR) {
        const key = `${dow}-${currentHour}`;
        cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
      }
      currentHour++;
    }
  }

  // Build the grid
  const cells: UtilizationHeatmapCell[] = [];
  for (let dow = 1; dow <= 5; dow++) {
    const numWeeks = weekCounts.get(dow) || 1;
    for (let hour = WORK_START_HOUR; hour < WORK_END_HOUR; hour++) {
      const key = `${dow}-${hour}`;
      const count = cellCounts.get(key) || 0;
      // Utilization = count / numWeeks (how many appointments per week in this slot)
      // Normalize: assume 1 appointment per hour-slot is 100%
      const therapistCount = therapistId ? 1 : Math.max(1,
        new Set(
          allAppointments
            .filter((a: any) => a.therapistId && a.status !== 'cancelled')
            .map((a: any) => a.therapistId)
        ).size
      );
      const maxPerSlot = numWeeks * therapistCount;
      const utilizationRate = maxPerSlot > 0
        ? Math.min(1, Math.round((count / maxPerSlot) * 100) / 100)
        : 0;

      cells.push({
        dayOfWeek: dow,
        hour,
        utilizationRate,
        appointmentCount: count,
      });
    }
  }

  return cells;
}

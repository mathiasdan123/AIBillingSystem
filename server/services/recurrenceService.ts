/**
 * Recurrence Service
 * Handles parsing RRULE strings and generating occurrence dates for recurring appointments
 * Supports common therapy recurrence patterns: weekly and biweekly
 */

export interface RecurrenceRule {
  frequency: 'WEEKLY' | 'MONTHLY';
  interval: number; // 1 = weekly, 2 = biweekly
  byDay?: string[]; // ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
  until?: Date; // End date for recurrence
  count?: number; // Number of occurrences (alternative to until)
}

export interface ParsedRRule {
  frequency: string;
  interval: number;
  byDay?: string[];
  until?: Date;
  count?: number;
}

const DAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const REVERSE_DAY_MAP: Record<number, string> = {
  0: 'SU',
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
};

/**
 * Parse an iCal RRULE string into a RecurrenceRule object
 * Example: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=12"
 */
export function parseRRule(rrule: string): ParsedRRule | null {
  if (!rrule || rrule.trim() === '') {
    return null;
  }

  const result: ParsedRRule = {
    frequency: 'WEEKLY',
    interval: 1,
  };

  // Remove RRULE: prefix if present
  const cleanRule = rrule.replace(/^RRULE:/i, '');
  const parts = cleanRule.split(';');

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (!key || !value) continue;

    switch (key.toUpperCase()) {
      case 'FREQ':
        result.frequency = value.toUpperCase();
        break;
      case 'INTERVAL':
        result.interval = parseInt(value, 10) || 1;
        break;
      case 'BYDAY':
        result.byDay = value.toUpperCase().split(',').map(d => d.trim());
        break;
      case 'UNTIL':
        // Parse ISO date format: 20250315 or 20250315T120000Z
        const year = parseInt(value.substring(0, 4), 10);
        const month = parseInt(value.substring(4, 6), 10) - 1;
        const day = parseInt(value.substring(6, 8), 10);
        result.until = new Date(year, month, day, 23, 59, 59);
        break;
      case 'COUNT':
        result.count = parseInt(value, 10);
        break;
    }
  }

  return result;
}

/**
 * Generate an RRULE string from parameters
 */
export function generateRRule(params: {
  frequency?: 'WEEKLY' | 'MONTHLY';
  interval: number;
  byDay?: string[];
  until?: Date;
  count?: number;
}): string {
  const parts: string[] = [
    `FREQ=${params.frequency || 'WEEKLY'}`,
    `INTERVAL=${params.interval}`,
  ];

  if (params.byDay && params.byDay.length > 0) {
    parts.push(`BYDAY=${params.byDay.join(',')}`);
  }

  if (params.until) {
    // Format as YYYYMMDD
    const year = params.until.getFullYear();
    const month = String(params.until.getMonth() + 1).padStart(2, '0');
    const day = String(params.until.getDate()).padStart(2, '0');
    parts.push(`UNTIL=${year}${month}${day}`);
  } else if (params.count) {
    parts.push(`COUNT=${params.count}`);
  }

  return parts.join(';');
}

/**
 * Generate occurrence dates based on a recurrence rule
 * @param startDate - The first occurrence date
 * @param rrule - The RRULE string or ParsedRRule object
 * @param maxOccurrences - Maximum number of occurrences to generate (safety limit)
 * @returns Array of dates for each occurrence
 */
export function generateOccurrences(
  startDate: Date,
  rrule: string | ParsedRRule,
  maxOccurrences: number = 52 // Default: 1 year of weekly appointments
): Date[] {
  const rule = typeof rrule === 'string' ? parseRRule(rrule) : rrule;

  if (!rule) {
    return [startDate];
  }

  // Support WEEKLY and MONTHLY frequencies
  if (rule.frequency !== 'WEEKLY' && rule.frequency !== 'MONTHLY') {
    console.warn(`Unsupported frequency: ${rule.frequency}. Only WEEKLY and MONTHLY are supported.`);
    return [startDate];
  }

  const occurrences: Date[] = [];

  // Determine end condition
  const maxCount = rule.count || maxOccurrences;
  const untilDate = rule.until;

  if (rule.frequency === 'MONTHLY') {
    // Monthly recurrence: same day-of-month as start date
    const dayOfMonth = startDate.getDate();
    let current = new Date(startDate);
    current.setHours(startDate.getHours(), startDate.getMinutes(), startDate.getSeconds(), 0);

    let monthCount = 0;
    while (occurrences.length < maxCount) {
      if (untilDate && current > untilDate) break;

      occurrences.push(new Date(current));

      // Advance by interval months
      monthCount += rule.interval;
      current = new Date(startDate);
      current.setMonth(startDate.getMonth() + monthCount);
      // Handle months where the day doesn't exist (e.g., Jan 31 -> Feb 28)
      if (current.getDate() !== dayOfMonth) {
        current.setDate(0); // Last day of previous month
      }
      current.setHours(startDate.getHours(), startDate.getMinutes(), startDate.getSeconds(), 0);

      // Safety limit
      if (monthCount > 120) break; // 10 years
    }

    return occurrences;
  }

  // WEEKLY frequency
  const startDayOfWeek = startDate.getDay();

  // Determine which days of the week to generate appointments
  let targetDays: number[];
  if (rule.byDay && rule.byDay.length > 0) {
    targetDays = rule.byDay.map(d => DAY_MAP[d]).filter(d => d !== undefined);
  } else {
    // Default to the same day as the start date
    targetDays = [startDayOfWeek];
  }

  // Start from the beginning of the week containing startDate
  let currentWeekStart = new Date(startDate);
  currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay());
  currentWeekStart.setHours(startDate.getHours(), startDate.getMinutes(), startDate.getSeconds(), 0);

  let weekCount = 0;

  while (occurrences.length < maxCount) {
    // Check if this week should have appointments based on interval
    if (weekCount % rule.interval === 0) {
      for (const dayOfWeek of targetDays) {
        if (occurrences.length >= maxCount) break;

        const occurrenceDate = new Date(currentWeekStart);
        occurrenceDate.setDate(currentWeekStart.getDate() + dayOfWeek);
        occurrenceDate.setHours(startDate.getHours(), startDate.getMinutes(), startDate.getSeconds(), 0);

        // Skip dates before the start date
        if (occurrenceDate < startDate) continue;

        // Check until date
        if (untilDate && occurrenceDate > untilDate) {
          return occurrences;
        }

        occurrences.push(occurrenceDate);
      }
    }

    // Move to next week
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    weekCount++;

    // Safety limit to prevent infinite loops
    if (weekCount > 520) { // ~10 years
      console.warn('Reached maximum week limit in occurrence generation');
      break;
    }
  }

  return occurrences;
}

/**
 * Get a human-readable description of a recurrence rule
 */
export function describeRecurrence(rrule: string | ParsedRRule): string {
  const rule = typeof rrule === 'string' ? parseRRule(rrule) : rrule;

  if (!rule) {
    return 'No recurrence';
  }

  let description = '';

  // Frequency and interval
  if (rule.frequency === 'MONTHLY') {
    if (rule.interval === 1) {
      description = 'Monthly';
    } else {
      description = `Every ${rule.interval} months`;
    }
  } else if (rule.interval === 1) {
    description = 'Weekly';
  } else if (rule.interval === 2) {
    description = 'Biweekly (every 2 weeks)';
  } else {
    description = `Every ${rule.interval} weeks`;
  }

  // Days of week
  if (rule.byDay && rule.byDay.length > 0) {
    const dayNames = rule.byDay.map(d => {
      switch (d) {
        case 'MO': return 'Monday';
        case 'TU': return 'Tuesday';
        case 'WE': return 'Wednesday';
        case 'TH': return 'Thursday';
        case 'FR': return 'Friday';
        case 'SA': return 'Saturday';
        case 'SU': return 'Sunday';
        default: return d;
      }
    });
    description += ` on ${dayNames.join(', ')}`;
  }

  // End condition
  if (rule.until) {
    description += ` until ${rule.until.toLocaleDateString()}`;
  } else if (rule.count) {
    description += ` (${rule.count} sessions)`;
  }

  return description;
}

/**
 * Validate a recurrence rule for therapy scheduling
 * Returns error messages if invalid, empty array if valid
 */
export function validateRecurrenceRule(rrule: string): string[] {
  const errors: string[] = [];
  const rule = parseRRule(rrule);

  if (!rule) {
    errors.push('Invalid recurrence rule format');
    return errors;
  }

  if (rule.frequency !== 'WEEKLY' && rule.frequency !== 'MONTHLY') {
    errors.push('Only weekly and monthly frequencies are supported for therapy appointments');
  }

  if (rule.interval < 1 || rule.interval > 4) {
    errors.push('Interval must be between 1 and 4 weeks');
  }

  if (rule.byDay) {
    const validDays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    for (const day of rule.byDay) {
      if (!validDays.includes(day)) {
        errors.push(`Invalid day: ${day}. Use MO, TU, WE, TH, FR, SA, or SU`);
      }
    }
  }

  if (!rule.until && !rule.count) {
    errors.push('Either until date or count must be specified');
  }

  if (rule.count && (rule.count < 1 || rule.count > 52)) {
    errors.push('Count must be between 1 and 52 sessions');
  }

  if (rule.until) {
    const now = new Date();
    if (rule.until < now) {
      errors.push('Until date must be in the future');
    }
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 1);
    if (rule.until > maxDate) {
      errors.push('Until date cannot be more than 1 year in the future');
    }
  }

  return errors;
}

/**
 * Create a simple weekly recurrence rule
 */
export function createWeeklyRule(options: {
  dayOfWeek?: string; // e.g., 'MO' for Monday
  count?: number;
  until?: Date;
}): string {
  return generateRRule({
    frequency: 'WEEKLY',
    interval: 1,
    byDay: options.dayOfWeek ? [options.dayOfWeek] : undefined,
    count: options.count,
    until: options.until,
  });
}

/**
 * Create a biweekly (every 2 weeks) recurrence rule
 */
export function createBiweeklyRule(options: {
  dayOfWeek?: string;
  count?: number;
  until?: Date;
}): string {
  return generateRRule({
    frequency: 'WEEKLY',
    interval: 2,
    byDay: options.dayOfWeek ? [options.dayOfWeek] : undefined,
    count: options.count,
    until: options.until,
  });
}

/**
 * Get the day code (MO, TU, etc.) from a Date object
 */
export function getDayCode(date: Date): string {
  return REVERSE_DAY_MAP[date.getDay()];
}

export default {
  parseRRule,
  generateRRule,
  generateOccurrences,
  describeRecurrence,
  validateRecurrenceRule,
  createWeeklyRule,
  createBiweeklyRule,
  getDayCode,
};

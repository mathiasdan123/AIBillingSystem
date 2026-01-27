// PHI-safe structured logger with automatic field redaction

const PHI_FIELDS = new Set([
  'firstName', 'first_name', 'lastName', 'last_name',
  'dateOfBirth', 'date_of_birth', 'dob',
  'email', 'phone', 'address',
  'insuranceId', 'insurance_id', 'policyNumber', 'policy_number',
  'groupNumber', 'group_number', 'memberId', 'member_id',
  'ssn', 'socialSecurityNumber',
  'subjective', 'objective', 'assessment', 'plan',
  'progressNotes', 'progress_notes', 'homeProgram', 'home_program',
  'notes', 'originalDocumentText', 'original_document_text',
  'patientName', 'patient_name',
]);

function redactValue(key: string, value: any): any {
  if (PHI_FIELDS.has(key)) {
    if (typeof value === 'string') {
      if (value.length <= 2) return '[REDACTED]';
      return value[0] + '***' + value[value.length - 1];
    }
    return '[REDACTED]';
  }
  return value;
}

function redactObject(obj: any, depth = 0): any {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item, depth + 1));
  }

  const redacted: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !PHI_FIELDS.has(key)) {
      redacted[key] = redactObject(value, depth + 1);
    } else {
      redacted[key] = redactValue(key, value);
    }
  }
  return redacted;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: any;
}

function createLogEntry(level: LogLevel, message: string, data?: Record<string, any>): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (data) {
    const redacted = redactObject(data);
    Object.assign(entry, redacted);
  }

  return entry;
}

function formatLog(entry: LogEntry): string {
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, data?: Record<string, any>) {
    if (process.env.LOG_LEVEL === 'debug') {
      const entry = createLogEntry('debug', message, data);
      console.log(formatLog(entry));
    }
  },

  info(message: string, data?: Record<string, any>) {
    const entry = createLogEntry('info', message, data);
    console.log(formatLog(entry));
  },

  warn(message: string, data?: Record<string, any>) {
    const entry = createLogEntry('warn', message, data);
    console.warn(formatLog(entry));
  },

  error(message: string, data?: Record<string, any>) {
    const entry = createLogEntry('error', message, data);
    console.error(formatLog(entry));
  },

  // Log an audit event (always info level, structured for compliance)
  audit(action: string, data: Record<string, any>) {
    const entry = createLogEntry('info', `AUDIT: ${action}`, {
      audit: true,
      action,
      ...data,
    });
    console.log(formatLog(entry));
  },
};

export default logger;

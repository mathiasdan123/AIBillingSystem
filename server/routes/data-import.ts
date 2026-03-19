/**
 * Data Import Routes
 *
 * Handles:
 * - POST /api/data-import/upload — Accept CSV or JSON file upload
 * - POST /api/data-import/preview — Parse uploaded file and return headers + sample rows
 * - POST /api/data-import/map-columns — Accept column mapping (source → target)
 * - POST /api/data-import/validate — Validate all rows against patient schema, return errors
 * - POST /api/data-import/execute — Run the actual import, creating patients in bulk
 * - GET /api/data-import/history — List past imports with status and counts
 * - GET /api/data-import/history/:id — Get details of a specific import
 * - GET /api/data-import/template — Download a blank CSV template
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { createPatientSchema } from '../validation/schemas';
import logger from '../services/logger';
import { z } from 'zod';

const router = Router();

// ==================== Types ====================

interface UploadedFileData {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  headers: string[];
  rows: Record<string, string>[];
  uploadedAt: Date;
  practiceId: number;
}

interface ColumnMapping {
  [sourceColumn: string]: string; // sourceColumn → targetField
}

interface ImportHistoryEntry {
  id: string;
  practiceId: number;
  filename: string;
  sourceSystem: string;
  totalRows: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  errors: Array<{ row: number; field: string; message: string }>;
  createdAt: Date;
  completedAt?: Date;
}

// In-memory storage for uploaded files and import history
// In production, this would be in the database or a temp file store
const uploadedFiles = new Map<string, UploadedFileData>();
const importHistory = new Map<string, ImportHistoryEntry>();

// ==================== Multer Config ====================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'text/csv',
      'text/plain',
      'application/json',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    // Also allow by extension
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (allowedMimes.includes(file.mimetype) || ['csv', 'json', 'txt', 'tsv'].includes(ext || '')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and JSON files are supported'));
    }
  },
});

// ==================== Helpers ====================

const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  if (userRole === 'admin') {
    return userPracticeId || 1;
  }
  if (!userPracticeId) {
    throw new Error('User not assigned to a practice');
  }
  return userPracticeId;
};

/**
 * Parse CSV text into rows.
 * Handles quoted fields, commas within quotes, and newlines within quotes.
 */
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[]; detectedDelimiter: string } {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === '\n' || (char === '\r' && text[i + 1] === '\n')) && !inQuotes) {
      lines.push(current);
      current = '';
      if (char === '\r') i++; // skip \n after \r
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    lines.push(current);
  }

  if (lines.length < 2) {
    return { headers: [], rows: [], detectedDelimiter: ',' };
  }

  // Auto-detect delimiter by trying each on the header line.
  // Pick whichever gives the most columns from the header.
  // If tie, prefer tab (most common for practice management exports).
  const headerLine = lines[0];
  const candidates: Array<{ d: string; cols: number }> = [
    { d: '\t', cols: parseCsvLine(headerLine, '\t').length },
    { d: ',', cols: parseCsvLine(headerLine, ',').length },
    { d: '|', cols: parseCsvLine(headerLine, '|').length },
    { d: ';', cols: parseCsvLine(headerLine, ';').length },
  ];
  // Sort by column count descending, tab first if tied
  candidates.sort((a, b) => {
    if (b.cols !== a.cols) return b.cols - a.cols;
    return a.d === '\t' ? -1 : 1;
  });
  let delimiter = candidates[0].d;

  // Log for diagnostics
  const debugInfo = candidates.map(c => `${c.d === '\t' ? 'TAB' : c.d}:${c.cols}`).join(', ');
  console.log(`Delimiter detection: ${debugInfo} → picked ${delimiter === '\t' ? 'TAB' : delimiter}`);

  const headers = parseCsvLine(lines[0], delimiter);
  const rows: Record<string, string>[] = [];
  const headerCount = headers.length;

  for (let i = 1; i < lines.length; i++) {
    let values = parseCsvLine(lines[i], delimiter);
    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

    // Fix column mismatch: if data has more columns than header due to unquoted commas
    // in data values (e.g., "Bresler, Keira" or "M62.81 (OT), R27.8 (OT)"),
    // align from the RIGHT since trailing columns (contact, insurance) are always clean.
    const row: Record<string, string> = {};
    if (values.length > headerCount) {
      const excess = values.length - headerCount;
      // Align from the right — map headers[N-1] to values[N-1+excess], etc.
      for (let h = headerCount - 1; h >= 0; h--) {
        row[headers[h]] = values[h + excess]?.trim() || '';
      }
      // The skipped leftmost values (excess) are lost, but they're typically
      // the combined "Patient" field which is redundant with "Patient First Name" + "Patient Last Name"
    } else {
      headers.forEach((header, idx) => {
        row[header] = values[idx]?.trim() || '';
      });
    }
    rows.push(row);
  }

  return { headers, rows, detectedDelimiter: delimiter === '\t' ? 'tab' : delimiter };
}

function parseCsvLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse JSON data into rows.
 * Expects an array of objects.
 */
function parseJSON(text: string): { headers: string[]; rows: Record<string, string>[]; detectedDelimiter: string } {
  const data = JSON.parse(text);
  if (!Array.isArray(data) || data.length === 0) {
    return { headers: [], rows: [], detectedDelimiter: 'json' };
  }

  const headers = Object.keys(data[0]);
  const rows = data.map((item: any) => {
    const row: Record<string, string> = {};
    headers.forEach((header) => {
      row[header] = item[header] != null ? String(item[header]) : '';
    });
    return row;
  });

  return { headers, rows, detectedDelimiter: 'json' };
}

/**
 * Parse a diagnosis string like "M62.81 (OT), R27.8 (OT)" into structured objects.
 */
function parseDiagnoses(value: string): Array<{ code: string; service: string }> {
  if (!value || value.trim() === '') return [];
  // Split on comma, then parse each "CODE (SERVICE)" or just "CODE"
  return value.split(',').map(part => {
    const trimmed = part.trim();
    const match = trimmed.match(/^([A-Z0-9.]+)\s*\(([^)]+)\)\s*$/i);
    if (match) {
      return { code: match[1].trim(), service: match[2].trim() };
    }
    // No parenthetical service — just the code
    if (trimmed.length > 0) {
      return { code: trimmed, service: '' };
    }
    return null;
  }).filter((d): d is { code: string; service: string } => d !== null && d.code.length > 0);
}

/**
 * Parse an active services string like "OT, PT" into an array.
 */
function parseActiveServices(value: string): string[] {
  if (!value || value.trim() === '') return [];
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Parse a "Yes"/"No" string into a boolean.
 */
function parseYesNo(value: string): boolean {
  return value.trim().toLowerCase() === 'yes';
}

/**
 * Source software presets — known column name mappings.
 */
const SOURCE_PRESETS: Record<string, Record<string, string>> = {
  simplepractice: {
    'First Name': 'firstName',
    'Last Name': 'lastName',
    'Date of Birth': 'dateOfBirth',
    'Email': 'email',
    'Phone': 'phone',
    'Phone Number': 'phone',
    'Address': 'address',
    'Insurance Company': 'insuranceProvider',
    'Insurance Provider': 'insuranceProvider',
    'Member ID': 'insuranceId',
    'Policy Number': 'policyNumber',
    'Group Number': 'groupNumber',
    'Diagnosis Codes': 'diagnoses',
    'Notes': 'patientNotes',
    'Client Status': 'patientStatus',
    'Location': 'primaryLocation',
    'Services': 'activeServices',
  },
  therapynotes: {
    'FirstName': 'firstName',
    'First': 'firstName',
    'LastName': 'lastName',
    'Last': 'lastName',
    'DOB': 'dateOfBirth',
    'DateOfBirth': 'dateOfBirth',
    'EmailAddress': 'email',
    'Email': 'email',
    'PhoneNumber': 'phone',
    'Phone': 'phone',
    'StreetAddress': 'address',
    'Address': 'address',
    'InsuranceName': 'insuranceProvider',
    'Insurance': 'insuranceProvider',
    'MemberID': 'insuranceId',
    'PolicyNum': 'policyNumber',
    'GroupNum': 'groupNumber',
    'Diagnoses': 'diagnoses',
    'Diagnosis': 'diagnoses',
    'PatientNotes': 'patientNotes',
    'Alerts': 'patientAlerts',
    'Status': 'patientStatus',
    'Location': 'primaryLocation',
    'ServiceTypes': 'activeServices',
  },
  janeapp: {
    'First Name': 'firstName',
    'Last Name': 'lastName',
    'Date of Birth': 'dateOfBirth',
    'Birth Date': 'dateOfBirth',
    'Email Address': 'email',
    'Email': 'email',
    'Phone Number': 'phone',
    'Mobile Phone': 'phone',
    'Address': 'address',
    'Home Address': 'address',
    'Insurer': 'insuranceProvider',
    'Insurance Company': 'insuranceProvider',
    'Policy Number': 'policyNumber',
    'Member Number': 'insuranceId',
    'Group Number': 'groupNumber',
    'Diagnoses': 'diagnoses',
    'Patient Notes': 'patientNotes',
    'Alerts': 'patientAlerts',
    'Clinic Location': 'primaryLocation',
    'Services': 'activeServices',
    'Status': 'patientStatus',
  },
  webpt: {
    'Patient First Name': 'firstName',
    'Patient Last Name': 'lastName',
    'Birth Date': 'dateOfBirth',
    'Patient DOB': 'dateOfBirth',
    'Email': 'email',
    'Patient Email': 'email',
    'Phone': 'phone',
    'Patient Phone': 'phone',
    'Address': 'address',
    'Patient Address': 'address',
    'Primary Insurance': 'insuranceProvider',
    'Insurance Name': 'insuranceProvider',
    'Subscriber ID': 'insuranceId',
    'Policy Number': 'policyNumber',
    'Group Number': 'groupNumber',
    'Diagnosis Codes': 'diagnoses',
    'Patient Notes': 'patientNotes',
    'Patient Alerts': 'patientAlerts',
    'Facility': 'primaryLocation',
    'Service Type': 'activeServices',
    'Patient Status': 'patientStatus',
  },
  fusion: {
    'Patient': 'lastCommaFirst',
    'Patient Birthdate': 'dateOfBirth',
    'Primary Contact Email': 'email',
    'Primary Contact Cell #': 'phone',
    'Primary Contact Address': 'address',
    'Primary Payer': 'insuranceProvider',
    'Primary Insured ID': 'insuranceId',
    'Diagnoses': 'diagnoses',
    'Patient Alerts': 'patientAlerts',
    'Patient Notes': 'patientNotes',
    'Patient Primary Location': 'primaryLocation',
    'Active Services': 'activeServices',
    'Patient Status': 'patientStatus',
    'Primary Contact Email Reminders': 'emailReminders',
    'Primary Contact Text Reminders': 'textReminders',
    // "Patient First Name" and "Patient Last Name" are intentionally NOT mapped
    // because Fusion/Ensura CSV exports have unquoted commas in name fields
    // that shift all columns. Use the "Patient" column ("Last, First") instead.
  },
  prompthealth: {
    'First Name': 'firstName',
    'Last Name': 'lastName',
    'Patient First Name': 'firstName',
    'Patient Last Name': 'lastName',
    'Date of Birth': 'dateOfBirth',
    'DOB': 'dateOfBirth',
    'Birthdate': 'dateOfBirth',
    'Email': 'email',
    'Email Address': 'email',
    'Phone': 'phone',
    'Phone Number': 'phone',
    'Mobile': 'phone',
    'Cell Phone': 'phone',
    'Address': 'address',
    'Street Address': 'address',
    'Insurance': 'insuranceProvider',
    'Insurance Company': 'insuranceProvider',
    'Insurance Provider': 'insuranceProvider',
    'Primary Insurance': 'insuranceProvider',
    'Payer': 'insuranceProvider',
    'Member ID': 'insuranceId',
    'Subscriber ID': 'insuranceId',
    'Insurance ID': 'insuranceId',
    'Policy Number': 'policyNumber',
    'Policy #': 'policyNumber',
    'Group Number': 'groupNumber',
    'Group #': 'groupNumber',
    'Diagnosis': 'diagnoses',
    'Diagnoses': 'diagnoses',
    'Diagnosis Codes': 'diagnoses',
    'ICD-10': 'diagnoses',
    'Alerts': 'patientAlerts',
    'Patient Alerts': 'patientAlerts',
    'Notes': 'patientNotes',
    'Patient Notes': 'patientNotes',
    'Location': 'primaryLocation',
    'Clinic': 'primaryLocation',
    'Facility': 'primaryLocation',
    'Service Type': 'activeServices',
    'Services': 'activeServices',
    'Active Services': 'activeServices',
    'Status': 'patientStatus',
    'Patient Status': 'patientStatus',
    'Email Reminders': 'emailReminders',
    'Text Reminders': 'textReminders',
    'SMS Reminders': 'textReminders',
  },
  generic: {},
};

// Alias: 'ensura' uses the same preset as 'fusion'
SOURCE_PRESETS['ensura'] = SOURCE_PRESETS['fusion'];

/**
 * Auto-suggest column mappings based on header name similarity.
 */
function autoSuggestMappings(headers: string[], preset?: string): ColumnMapping {
  const targetFields = [
    'firstName', 'lastName', 'dateOfBirth', 'email', 'phone', 'address',
    'insuranceProvider', 'insuranceId', 'policyNumber', 'groupNumber',
    'diagnoses', 'patientAlerts', 'patientNotes', 'primaryLocation',
    'activeServices', 'patientStatus', 'emailReminders', 'textReminders',
  ];

  const mapping: ColumnMapping = {};

  // If a preset is specified, use it first
  if (preset && SOURCE_PRESETS[preset]) {
    const presetMap = SOURCE_PRESETS[preset];
    for (const header of headers) {
      if (presetMap[header]) {
        mapping[header] = presetMap[header];
      }
    }
  }

  // For unmapped headers, try fuzzy matching
  const normalizeForMatch = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, '');

  const matchPatterns: Record<string, string[]> = {
    // Note: 'patient' alone should NOT match — it's often a combined name column
    firstName: ['firstname', 'first', 'fname', 'givenname', 'patientfirstname', 'clientfirstname', 'patientfirst', 'childfirstname', 'childfirst'],
    lastName: ['lastname', 'last', 'lname', 'surname', 'familyname', 'patientlastname', 'clientlastname', 'patientlast', 'childlastname', 'childlast'],
    dateOfBirth: ['dateofbirth', 'dob', 'birthdate', 'birthday', 'birth', 'patientdateofbirth', 'patientdob', 'patientbirthdate'],
    email: ['email', 'emailaddress', 'mail', 'patientemail', 'clientemail', 'primarycontactemail'],
    phone: ['phone', 'phonenumber', 'telephone', 'tel', 'mobile', 'cell', 'mobilephone', 'patientphone', 'clientphone', 'homephone', 'primaryphone', 'primarycontactphone', 'primarycontactcell'],
    address: ['address', 'streetaddress', 'homeaddress', 'mailingaddress', 'street', 'patientaddress', 'clientaddress', 'primarycontactaddress'],
    insuranceProvider: ['insurance', 'insurancecompany', 'insurancename', 'insuranceprovider', 'insurer', 'payer', 'primaryinsurance', 'payername', 'carriername', 'primarypayer'],
    insuranceId: ['memberid', 'subscriberid', 'insuranceid', 'membernum', 'membernumber', 'patientmemberid', 'subscribernumber', 'primaryinsuredid', 'insuredid'],
    fullName: ['primaryguarantor', 'guarantor', 'patientname', 'clientname', 'fullname', 'name'],
    policyNumber: ['policynumber', 'policynum', 'policy', 'policyid'],
    groupNumber: ['groupnumber', 'groupnum', 'group', 'groupid'],
    diagnoses: ['diagnoses', 'diagnosis', 'diagnosiscodes', 'diagcodes', 'icd10', 'icd10codes', 'dxcodes'],
    patientAlerts: ['patientalerts', 'alerts', 'billingalerts', 'clinicalalerts', 'patientalert'],
    patientNotes: ['patientnotes', 'notes', 'clientnotes', 'importnotes', 'patientnote'],
    primaryLocation: ['patientprimarylocation', 'primarylocation', 'location', 'cliniclocation', 'facility', 'officelocation', 'site'],
    activeServices: ['activeservices', 'services', 'servicetypes', 'servicetype', 'therapyservices', 'therapytypes'],
    patientStatus: ['patientstatus', 'status', 'clientstatus', 'accountstatus'],
    emailReminders: ['primarycontactemailreminders', 'emailreminders', 'emailreminder', 'emailnotifications'],
    textReminders: ['primarycontacttextreminders', 'textreminders', 'textreminder', 'smsreminders', 'smsreminder'],
  };

  for (const header of headers) {
    if (mapping[header]) continue; // already mapped by preset
    const normalized = normalizeForMatch(header);
    for (const [field, patterns] of Object.entries(matchPatterns)) {
      if (patterns.includes(normalized)) {
        mapping[header] = field;
        break;
      }
    }
  }

  return mapping;
}

/**
 * Normalize a date string to YYYY-MM-DD format.
 */
function normalizeDateOfBirth(value: string): string | null {
  if (!value || value.trim() === '') return null;

  const trimmed = value.trim();

  // Already in YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // MM-DD-YYYY
  const dashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const [, month, day, year] = dashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try native date parsing as last resort
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

function generateId(): string {
  return `imp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ==================== Routes ====================

/**
 * POST /upload — Upload a CSV or JSON file for import
 */
router.post('/upload', isAuthenticated, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const text = file.buffer.toString('utf-8');
    const ext = file.originalname.toLowerCase().split('.').pop();
    let parsed: { headers: string[]; rows: Record<string, string>[]; detectedDelimiter: string };

    if (ext === 'json') {
      try {
        parsed = parseJSON(text);
      } catch {
        return res.status(400).json({ message: 'Invalid JSON file. Expected an array of objects.' });
      }
    } else {
      // CSV or TXT
      parsed = parseCSV(text);
    }

    if (parsed.headers.length === 0) {
      return res.status(400).json({ message: 'File is empty or has no headers' });
    }

    if (parsed.rows.length === 0) {
      return res.status(400).json({ message: 'File has headers but no data rows' });
    }

    const fileId = generateId();
    const fileData: UploadedFileData = {
      filename: fileId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      headers: parsed.headers,
      rows: parsed.rows,
      uploadedAt: new Date(),
      practiceId,
    };

    uploadedFiles.set(fileId, fileData);

    // Auto-clean old uploads after 1 hour
    setTimeout(() => {
      uploadedFiles.delete(fileId);
    }, 60 * 60 * 1000);

    // Auto-suggest column mappings
    const sourceSystem = (req.body?.sourceSystem || 'generic') as string;
    const suggestedMappings = autoSuggestMappings(parsed.headers, sourceSystem);

    logger.info('Data import file uploaded', {
      fileId,
      practiceId,
      originalName: file.originalname,
      rowCount: parsed.rows.length,
      headerCount: parsed.headers.length,
      detectedDelimiter: parsed.detectedDelimiter,
    });

    res.json({
      fileId,
      filename: file.originalname,
      size: file.size,
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      sampleRows: parsed.rows.slice(0, 5),
      suggestedMappings,
      detectedDelimiter: parsed.detectedDelimiter,
    });
  } catch (error) {
    logger.error('Data import upload failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to process uploaded file' });
  }
});

/**
 * POST /paste — Accept raw text (tab-separated from spreadsheet paste) and parse as TSV
 */
router.post('/paste', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { text, sourceSystem: srcSystem } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ message: 'No text provided. Paste tab-separated data from your spreadsheet.' });
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return res.status(400).json({ message: 'Pasted text is empty' });
    }

    // Parse as TSV — spreadsheet clipboard data is always tab-separated
    const parsed = parseCSV(trimmed);

    if (parsed.headers.length === 0) {
      return res.status(400).json({ message: 'Could not detect any columns. Make sure you copied headers and data rows from your spreadsheet.' });
    }

    if (parsed.rows.length === 0) {
      return res.status(400).json({ message: 'Headers detected but no data rows found' });
    }

    const fileId = generateId();
    const fileData: UploadedFileData = {
      filename: fileId,
      originalName: 'pasted-data.tsv',
      mimeType: 'text/tab-separated-values',
      size: Buffer.byteLength(trimmed, 'utf-8'),
      headers: parsed.headers,
      rows: parsed.rows,
      uploadedAt: new Date(),
      practiceId,
    };

    uploadedFiles.set(fileId, fileData);

    // Auto-clean old uploads after 1 hour
    setTimeout(() => {
      uploadedFiles.delete(fileId);
    }, 60 * 60 * 1000);

    const sourceSystem = (srcSystem || 'generic') as string;
    const suggestedMappings = autoSuggestMappings(parsed.headers, sourceSystem);

    logger.info('Data import paste received', {
      fileId,
      practiceId,
      rowCount: parsed.rows.length,
      headerCount: parsed.headers.length,
      detectedDelimiter: parsed.detectedDelimiter,
    });

    res.json({
      fileId,
      filename: 'pasted-data.tsv',
      size: Buffer.byteLength(trimmed, 'utf-8'),
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      sampleRows: parsed.rows.slice(0, 5),
      suggestedMappings,
      detectedDelimiter: parsed.detectedDelimiter,
    });
  } catch (error) {
    logger.error('Data import paste failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to process pasted data' });
  }
});

/**
 * POST /preview — Parse uploaded file and return column headers + sample rows
 */
router.post('/preview', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { fileId } = req.body;
    if (!fileId) {
      return res.status(400).json({ message: 'fileId is required' });
    }

    const fileData = uploadedFiles.get(fileId);
    if (!fileData) {
      return res.status(404).json({ message: 'File not found. It may have expired. Please re-upload.' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    if (fileData.practiceId !== practiceId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({
      headers: fileData.headers,
      rowCount: fileData.rows.length,
      sampleRows: fileData.rows.slice(0, 10),
    });
  } catch (error) {
    logger.error('Data import preview failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to generate preview' });
  }
});

/**
 * POST /map-columns — Accept column mapping and return auto-suggestions
 */
router.post('/map-columns', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { fileId, sourceSystem } = req.body;
    if (!fileId) {
      return res.status(400).json({ message: 'fileId is required' });
    }

    const fileData = uploadedFiles.get(fileId);
    if (!fileData) {
      return res.status(404).json({ message: 'File not found. Please re-upload.' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    if (fileData.practiceId !== practiceId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const suggestedMappings = autoSuggestMappings(fileData.headers, sourceSystem || 'generic');

    const targetFields = [
      { field: 'firstName', label: 'First Name', required: true },
      { field: 'lastName', label: 'Last Name', required: true },
      { field: 'fullName', label: 'Full Name (First Last → splits into First + Last)', required: false },
      { field: 'lastCommaFirst', label: 'Name as "Last, First" (splits on comma)', required: false },
      { field: 'dateOfBirth', label: 'Date of Birth', required: false },
      { field: 'email', label: 'Email', required: false },
      { field: 'phone', label: 'Phone', required: false },
      { field: 'address', label: 'Address', required: false },
      { field: 'insuranceProvider', label: 'Insurance Provider', required: false },
      { field: 'insuranceId', label: 'Member ID', required: false },
      { field: 'policyNumber', label: 'Policy Number', required: false },
      { field: 'groupNumber', label: 'Group Number', required: false },
      { field: 'diagnoses', label: 'Diagnosis Codes (e.g. "M62.81 (OT), R27.8 (OT)")', required: false },
      { field: 'patientAlerts', label: 'Patient Alerts (billing/clinical)', required: false },
      { field: 'patientNotes', label: 'Patient Notes', required: false },
      { field: 'primaryLocation', label: 'Primary Location / Clinic', required: false },
      { field: 'activeServices', label: 'Active Services (e.g. "OT, PT, ST")', required: false },
      { field: 'patientStatus', label: 'Patient Status (Active/Inactive)', required: false },
      { field: 'emailReminders', label: 'Email Reminders (Yes/No)', required: false },
      { field: 'textReminders', label: 'Text Reminders (Yes/No)', required: false },
    ];

    res.json({
      sourceColumns: fileData.headers,
      targetFields,
      suggestedMappings,
      availablePresets: Object.keys(SOURCE_PRESETS),
    });
  } catch (error) {
    logger.error('Data import map-columns failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to generate column mappings' });
  }
});

/**
 * POST /validate — Validate all rows against the patient schema
 */
router.post('/validate', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { fileId, columnMapping: rawMapping } = req.body;
    if (!fileId || !rawMapping) {
      return res.status(400).json({ message: 'fileId and columnMapping are required' });
    }

    const columnMapping = rawMapping as ColumnMapping;

    const fileData = uploadedFiles.get(fileId);
    if (!fileData) {
      return res.status(404).json({ message: 'File not found. Please re-upload.' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    if (fileData.practiceId !== practiceId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check that names are mapped (either first+last or fullName)
    const mappedFields = Object.values(columnMapping);
    const hasFirstLast = mappedFields.includes('firstName') && mappedFields.includes('lastName');
    const hasFullName = mappedFields.includes('fullName') || mappedFields.includes('lastCommaFirst');
    if (!hasFirstLast && !hasFullName) {
      return res.status(400).json({
        message: 'Map either First Name + Last Name, Full Name, or Name as "Last, First" to proceed',
      });
    }

    // Get existing patients for duplicate detection
    const existingPatients = await storage.getPatients(practiceId);
    const existingSet = new Set(
      existingPatients.map((p: any) =>
        `${(p.firstName || '').toLowerCase()}|${(p.lastName || '').toLowerCase()}|${p.dateOfBirth || ''}`
      )
    );

    const validRows: Array<{ row: number; data: any }> = [];
    const errorRows: Array<{ row: number; errors: Array<{ field: string; message: string }> }> = [];
    const duplicateRows: Array<{ row: number; data: any }> = [];

    // Fields that go into intakeData.importedData instead of the patient record directly
    const extendedFields = new Set([
      'diagnoses', 'patientAlerts', 'patientNotes', 'primaryLocation',
      'activeServices', 'patientStatus', 'emailReminders', 'textReminders',
    ]);

    for (let i = 0; i < fileData.rows.length; i++) {
      const sourceRow = fileData.rows[i];
      const mappedRow: any = { practiceId };
      const importedData: Record<string, any> = {};

      // Apply column mapping
      for (const [sourceCol, targetField] of Object.entries(columnMapping)) {
        if (targetField && sourceRow[sourceCol] !== undefined) {
          let value: any = sourceRow[sourceCol];
          // Normalize date of birth
          if (targetField === 'dateOfBirth' && value) {
            value = normalizeDateOfBirth(value);
          }
          // Handle fullName: split "First Last" into firstName + lastName
          if (targetField === 'fullName' && value) {
            const parts = value.trim().split(/\s+/);
            if (parts.length >= 2) {
              if (!mappedRow.firstName) mappedRow.firstName = parts.slice(0, -1).join(' ');
              if (!mappedRow.lastName) mappedRow.lastName = parts[parts.length - 1];
            } else if (parts.length === 1) {
              if (!mappedRow.firstName) mappedRow.firstName = parts[0];
            }
          } else if (targetField === 'lastCommaFirst' && value) {
            // "Bresler, Keira" → firstName: Keira, lastName: Bresler
            const commaIdx = value.indexOf(',');
            if (commaIdx > 0) {
              if (!mappedRow.lastName) mappedRow.lastName = value.substring(0, commaIdx).trim();
              if (!mappedRow.firstName) mappedRow.firstName = value.substring(commaIdx + 1).trim();
            } else {
              // No comma — treat as last name only
              if (!mappedRow.lastName) mappedRow.lastName = value.trim();
            }
          } else if (extendedFields.has(targetField) && value) {
            // Parse and store extended fields for intakeData
            if (targetField === 'diagnoses') {
              importedData.diagnoses = parseDiagnoses(value);
            } else if (targetField === 'activeServices') {
              importedData.activeServices = parseActiveServices(value);
            } else if (targetField === 'emailReminders') {
              importedData.emailReminders = parseYesNo(value);
            } else if (targetField === 'textReminders') {
              importedData.textReminders = parseYesNo(value);
            } else if (targetField === 'patientAlerts') {
              importedData.alerts = value.trim();
            } else if (targetField === 'patientNotes') {
              importedData.notes = value.trim();
            } else if (targetField === 'primaryLocation') {
              importedData.location = value.trim();
            } else if (targetField === 'patientStatus') {
              importedData.status = value.trim();
            }
          } else {
            mappedRow[targetField] = value || null;
          }
        }
      }

      // Attach importedData to intakeData if any extended fields were mapped
      if (Object.keys(importedData).length > 0) {
        mappedRow.intakeData = { importedData };
      }

      // Validate against schema
      const result = createPatientSchema.safeParse(mappedRow);
      if (!result.success) {
        const errors = result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
        errorRows.push({ row: i + 1, errors });
        continue;
      }

      // Check for duplicates
      const dupeKey = `${(mappedRow.firstName || '').toLowerCase()}|${(mappedRow.lastName || '').toLowerCase()}|${mappedRow.dateOfBirth || ''}`;
      if (existingSet.has(dupeKey)) {
        duplicateRows.push({ row: i + 1, data: mappedRow });
        continue;
      }

      validRows.push({ row: i + 1, data: result.data });
    }

    res.json({
      totalRows: fileData.rows.length,
      validCount: validRows.length,
      errorCount: errorRows.length,
      duplicateCount: duplicateRows.length,
      validRows: validRows.slice(0, 10), // Preview first 10
      errorRows: errorRows.slice(0, 50), // Show up to 50 errors
      duplicateRows: duplicateRows.slice(0, 10),
    });
  } catch (error) {
    logger.error('Data import validation failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to validate import data' });
  }
});

/**
 * POST /execute — Run the actual import, creating patients in bulk
 */
router.post('/execute', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { fileId, columnMapping: rawMapping, skipDuplicates = true, sourceSystem = 'generic' } = req.body;
    const columnMapping = rawMapping as ColumnMapping;
    if (!fileId || !columnMapping) {
      return res.status(400).json({ message: 'fileId and columnMapping are required' });
    }

    const fileData = uploadedFiles.get(fileId);
    if (!fileData) {
      return res.status(404).json({ message: 'File not found. Please re-upload.' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    if (fileData.practiceId !== practiceId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const importId = generateId();
    const historyEntry: ImportHistoryEntry = {
      id: importId,
      practiceId,
      filename: fileData.originalName,
      sourceSystem,
      totalRows: fileData.rows.length,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      status: 'in_progress',
      errors: [],
      createdAt: new Date(),
    };
    importHistory.set(importId, historyEntry);

    // Get existing patients for duplicate detection
    const existingPatients = await storage.getPatients(practiceId);
    const existingSet = new Set(
      existingPatients.map((p: any) =>
        `${(p.firstName || '').toLowerCase()}|${(p.lastName || '').toLowerCase()}|${p.dateOfBirth || ''}`
      )
    );

    const results = {
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: [] as Array<{ row: number; field: string; message: string }>,
    };

    // Process rows in batches
    const BATCH_SIZE = 10;
    for (let batchStart = 0; batchStart < fileData.rows.length; batchStart += BATCH_SIZE) {
      const batch = fileData.rows.slice(batchStart, batchStart + BATCH_SIZE);

      // Fields that go into intakeData.importedData instead of the patient record directly
      const extendedFields = new Set([
        'diagnoses', 'patientAlerts', 'patientNotes', 'primaryLocation',
        'activeServices', 'patientStatus', 'emailReminders', 'textReminders',
      ]);

      for (let j = 0; j < batch.length; j++) {
        const rowIndex = batchStart + j;
        const sourceRow = batch[j];
        const mappedRow: any = { practiceId };
        const importedData: Record<string, any> = {};

        // Apply column mapping
        for (const [sourceCol, targetField] of Object.entries(columnMapping)) {
          if (targetField && sourceRow[sourceCol] !== undefined) {
            let value: any = sourceRow[sourceCol];
            if (targetField === 'dateOfBirth' && value) {
              value = normalizeDateOfBirth(value);
            }
            if (targetField === 'fullName' && value) {
              const parts = value.trim().split(/\s+/);
              if (parts.length >= 2) {
                if (!mappedRow.firstName) mappedRow.firstName = parts.slice(0, -1).join(' ');
                if (!mappedRow.lastName) mappedRow.lastName = parts[parts.length - 1];
              } else if (parts.length === 1) {
                if (!mappedRow.firstName) mappedRow.firstName = parts[0];
              }
            } else if (targetField === 'lastCommaFirst' && value) {
              const commaIdx = value.indexOf(',');
              if (commaIdx > 0) {
                if (!mappedRow.lastName) mappedRow.lastName = value.substring(0, commaIdx).trim();
                if (!mappedRow.firstName) mappedRow.firstName = value.substring(commaIdx + 1).trim();
              } else {
                if (!mappedRow.lastName) mappedRow.lastName = value.trim();
              }
            } else if (extendedFields.has(targetField) && value) {
              // Parse and store extended fields for intakeData
              if (targetField === 'diagnoses') {
                importedData.diagnoses = parseDiagnoses(value);
              } else if (targetField === 'activeServices') {
                importedData.activeServices = parseActiveServices(value);
              } else if (targetField === 'emailReminders') {
                importedData.emailReminders = parseYesNo(value);
              } else if (targetField === 'textReminders') {
                importedData.textReminders = parseYesNo(value);
              } else if (targetField === 'patientAlerts') {
                importedData.alerts = value.trim();
              } else if (targetField === 'patientNotes') {
                importedData.notes = value.trim();
              } else if (targetField === 'primaryLocation') {
                importedData.location = value.trim();
              } else if (targetField === 'patientStatus') {
                importedData.status = value.trim();
              }
            } else {
              mappedRow[targetField] = value || null;
            }
          }
        }

        // Attach importedData to intakeData if any extended fields were mapped
        if (Object.keys(importedData).length > 0) {
          mappedRow.intakeData = { importedData };
        }

        // Validate
        const validation = createPatientSchema.safeParse(mappedRow);
        if (!validation.success) {
          results.failed++;
          for (const issue of validation.error.issues) {
            results.errors.push({
              row: rowIndex + 1,
              field: issue.path.join('.'),
              message: issue.message,
            });
          }
          continue;
        }

        // Check duplicate
        const dupeKey = `${(mappedRow.firstName || '').toLowerCase()}|${(mappedRow.lastName || '').toLowerCase()}|${mappedRow.dateOfBirth || ''}`;
        if (existingSet.has(dupeKey)) {
          if (skipDuplicates) {
            results.skipped++;
            continue;
          }
        }

        // Create patient
        try {
          await storage.createPatient(validation.data);
          results.imported++;
          // Add to existing set to prevent duplicates within the import
          existingSet.add(dupeKey);
        } catch (err) {
          results.failed++;
          results.errors.push({
            row: rowIndex + 1,
            field: 'general',
            message: err instanceof Error ? err.message : 'Unknown error creating patient',
          });
        }
      }
    }

    // Update history
    historyEntry.successCount = results.imported;
    historyEntry.failedCount = results.failed;
    historyEntry.skippedCount = results.skipped;
    historyEntry.errors = results.errors;
    historyEntry.status = 'completed';
    historyEntry.completedAt = new Date();

    // Clean up uploaded file
    uploadedFiles.delete(fileId);

    logger.info('Data import completed', {
      importId,
      practiceId,
      imported: results.imported,
      skipped: results.skipped,
      failed: results.failed,
    });

    res.json({
      importId,
      totalRows: fileData.rows.length,
      imported: results.imported,
      skipped: results.skipped,
      failed: results.failed,
      errors: results.errors,
    });
  } catch (error) {
    logger.error('Data import execution failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to execute import' });
  }
});

/**
 * GET /history — List past imports
 */
router.get('/history', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const entries = Array.from(importHistory.values())
      .filter((e) => e.practiceId === practiceId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json(entries.map(({ errors: _errors, ...rest }) => rest));
  } catch (error) {
    logger.error('Data import history failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch import history' });
  }
});

/**
 * GET /history/:id — Get details of a specific import
 */
router.get('/history/:id', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const entry = importHistory.get(req.params.id);

    if (!entry) {
      return res.status(404).json({ message: 'Import not found' });
    }

    if (entry.practiceId !== practiceId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(entry);
  } catch (error) {
    logger.error('Data import history detail failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch import details' });
  }
});

/**
 * GET /template — Download a blank CSV template with expected columns
 */
router.get('/template', isAuthenticated, (_req: Request, res: Response) => {
  const headers = [
    'First Name',
    'Last Name',
    'Date of Birth',
    'Email',
    'Phone',
    'Address',
    'Insurance Provider',
    'Member ID',
    'Policy Number',
    'Group Number',
    'Diagnosis Codes',
    'Patient Alerts',
    'Patient Notes',
    'Location',
    'Active Services',
    'Patient Status',
    'Email Reminders',
    'Text Reminders',
  ];

  const exampleRow1 = [
    'Keira',
    'Bresler',
    '02/18/2024',
    'parent@email.com',
    '(555) 123-4567',
    '123 Main St, New York, NY 10016',
    'Horizon BCBS NJ',
    'XIR991980301',
    'POL-2024-001',
    'GRP-100',
    'M62.81 (OT), R27.8 (OT)',
    '2026 DED MET',
    'Referred by Dr. Smith',
    'Main Street Clinic',
    'OT',
    'Active',
    'Yes',
    'Yes',
  ];

  const exampleRow2 = [
    'Nava',
    'Eisman',
    '02/26/2019',
    'parent2@email.com',
    '(555) 987-6543',
    '75 Wilbur Rd, Bergenfield, NJ 07621',
    'Private Pay',
    '',
    '',
    '',
    'R62.0 (OT), F84.9 (OT)',
    'INS PAYOUT THEN BALANCE BILL',
    '',
    'North Jersey Office',
    'OT',
    'Active',
    'Yes',
    'No',
  ];

  const csvContent = headers.join(',') + '\n'
    + exampleRow1.map(v => `"${v}"`).join(',') + '\n'
    + exampleRow2.map(v => `"${v}"`).join(',') + '\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="patient-import-template.csv"');
  res.send(csvContent);
});

export default router;

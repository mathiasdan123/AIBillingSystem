import { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Upload,
  FileText,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  Loader2,
  Users,
  FileUp,
  Columns,
  Eye,
  Play,
  History,
  SkipForward,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

// ==================== Types ====================

interface UploadResult {
  fileId: string;
  filename: string;
  size: number;
  headers: string[];
  rowCount: number;
  sampleRows: Record<string, string>[];
  suggestedMappings: Record<string, string>;
}

interface TargetField {
  field: string;
  label: string;
  required: boolean;
}

interface MapColumnsResult {
  sourceColumns: string[];
  targetFields: TargetField[];
  suggestedMappings: Record<string, string>;
  availablePresets: string[];
}

interface ValidationResult {
  totalRows: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  validRows: Array<{ row: number; data: any }>;
  errorRows: Array<{ row: number; errors: Array<{ field: string; message: string }> }>;
  duplicateRows: Array<{ row: number; data: any }>;
}

interface ImportResult {
  importId: string;
  totalRows: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; field: string; message: string }>;
}

interface ImportHistoryEntry {
  id: string;
  filename: string;
  sourceSystem: string;
  totalRows: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  status: string;
  createdAt: string;
  completedAt?: string;
}

// ==================== Source Presets ====================

const SOURCE_SYSTEMS = [
  { value: 'simplepractice', label: 'SimplePractice' },
  { value: 'therapynotes', label: 'TherapyNotes' },
  { value: 'janeapp', label: 'Jane App' },
  { value: 'webpt', label: 'WebPT' },
  { value: 'generic', label: 'Generic CSV' },
];

// ==================== Step Components ====================

function StepUpload({
  onUpload,
  isUploading,
}: {
  onUpload: (file: File, sourceSystem: string) => void;
  isUploading: boolean;
}) {
  const [sourceSystem, setSourceSystem] = useState('generic');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onUpload(file, sourceSystem);
    },
    [onUpload, sourceSystem]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onUpload(file, sourceSystem);
    },
    [onUpload, sourceSystem]
  );

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch('/api/data-import/template', { credentials: 'include' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'patient-import-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Template download failed silently
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium">Source Software</label>
        <Select value={sourceSystem} onValueChange={setSourceSystem}>
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue placeholder="Select source software" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_SYSTEMS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Select the software you are migrating from for automatic column mapping.
        </p>
      </div>

      <div
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          dragActive
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <FileUp className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">
          {isUploading ? 'Uploading...' : 'Drop your file here'}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Supports CSV and JSON files up to 10MB
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Browse Files
          </Button>
          <Button variant="outline" onClick={handleDownloadTemplate}>
            <Download className="mr-2 h-4 w-4" />
            Download Template
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,.txt"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
}

function StepMapColumns({
  uploadResult,
  mappingData,
  columnMapping,
  onMappingChange,
}: {
  uploadResult: UploadResult;
  mappingData: MapColumnsResult | null;
  columnMapping: Record<string, string>;
  onMappingChange: (sourceCol: string, targetField: string) => void;
}) {
  const targetFields = mappingData?.targetFields || [
    { field: 'firstName', label: 'First Name', required: true },
    { field: 'lastName', label: 'Last Name', required: true },
    { field: 'dateOfBirth', label: 'Date of Birth', required: false },
    { field: 'email', label: 'Email', required: false },
    { field: 'phone', label: 'Phone', required: false },
    { field: 'address', label: 'Address', required: false },
    { field: 'insuranceProvider', label: 'Insurance Provider', required: false },
    { field: 'insuranceId', label: 'Member ID', required: false },
    { field: 'policyNumber', label: 'Policy Number', required: false },
    { field: 'groupNumber', label: 'Group Number', required: false },
  ];

  // Check if required fields are mapped
  const requiredFields = targetFields.filter((f) => f.required);
  const mappedTargets = Object.values(columnMapping);
  const missingRequired = requiredFields.filter((f) => !mappedTargets.includes(f.field));

  return (
    <div className="space-y-6">
      {missingRequired.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>
              Required fields not mapped:{' '}
              {missingRequired.map((f) => f.label).join(', ')}
            </span>
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr,auto,1fr] gap-0 bg-muted/50 px-4 py-2 text-sm font-medium border-b">
          <div>Source Column</div>
          <div className="w-8" />
          <div>Maps To</div>
        </div>

        {uploadResult.headers.map((header) => (
          <div
            key={header}
            className="grid grid-cols-[1fr,auto,1fr] gap-0 items-center px-4 py-3 border-b last:border-b-0 hover:bg-muted/30"
          >
            <div className="text-sm font-mono">{header}</div>
            <div className="w-8 flex justify-center">
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <Select
                value={columnMapping[header] || '_unmapped'}
                onValueChange={(value) =>
                  onMappingChange(header, value === '_unmapped' ? '' : value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Skip this column" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_unmapped">-- Skip --</SelectItem>
                  {targetFields.map((tf) => (
                    <SelectItem key={tf.field} value={tf.field}>
                      {tf.label}
                      {tf.required ? ' *' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>

      {uploadResult.sampleRows.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Sample Data (first row)</h4>
          <div className="bg-muted/30 rounded-lg p-3 text-sm font-mono overflow-x-auto">
            {uploadResult.headers.map((header) => (
              <div key={header} className="flex gap-2">
                <span className="text-muted-foreground min-w-[160px]">{header}:</span>
                <span>{uploadResult.sampleRows[0]?.[header] || '(empty)'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StepValidate({
  validationResult,
  isValidating,
}: {
  validationResult: ValidationResult | null;
  isValidating: boolean;
}) {
  if (isValidating) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-sm text-muted-foreground">Validating rows...</p>
      </div>
    );
  }

  if (!validationResult) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Click "Validate" to check your data before importing.
      </div>
    );
  }

  const { totalRows, validCount, errorCount, duplicateCount, validRows, errorRows, duplicateRows } =
    validationResult;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold">{totalRows}</div>
            <div className="text-xs text-muted-foreground">Total Rows</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold text-green-600">{validCount}</div>
            <div className="text-xs text-muted-foreground">Valid</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold text-red-600">{errorCount}</div>
            <div className="text-xs text-muted-foreground">Errors</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold text-amber-600">{duplicateCount}</div>
            <div className="text-xs text-muted-foreground">Duplicates</div>
          </CardContent>
        </Card>
      </div>

      {/* Valid rows preview */}
      {validRows.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            Valid Rows Preview (first {Math.min(validRows.length, 10)})
          </h4>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Row</th>
                  <th className="text-left px-3 py-2 font-medium">First Name</th>
                  <th className="text-left px-3 py-2 font-medium">Last Name</th>
                  <th className="text-left px-3 py-2 font-medium">DOB</th>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Phone</th>
                </tr>
              </thead>
              <tbody>
                {validRows.slice(0, 10).map((r) => (
                  <tr key={r.row} className="border-t">
                    <td className="px-3 py-2 text-muted-foreground">{r.row}</td>
                    <td className="px-3 py-2">{r.data.firstName}</td>
                    <td className="px-3 py-2">{r.data.lastName}</td>
                    <td className="px-3 py-2">{r.data.dateOfBirth || '-'}</td>
                    <td className="px-3 py-2">{r.data.email || '-'}</td>
                    <td className="px-3 py-2">{r.data.phone || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Error rows */}
      {errorRows.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-600" />
            Rows with Errors ({errorCount})
          </h4>
          <div className="border rounded-lg overflow-hidden">
            {errorRows.slice(0, 20).map((r) => (
              <div key={r.row} className="px-3 py-2 border-b last:border-b-0 bg-red-50 dark:bg-red-900/10">
                <span className="font-medium text-sm">Row {r.row}:</span>
                <span className="ml-2 text-sm text-red-700 dark:text-red-400">
                  {r.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}
                </span>
              </div>
            ))}
            {errorRows.length > 20 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                ...and {errorRows.length - 20} more errors
              </div>
            )}
          </div>
        </div>
      )}

      {/* Duplicate rows */}
      {duplicateRows.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <SkipForward className="h-4 w-4 text-amber-600" />
            Potential Duplicates ({duplicateCount})
          </h4>
          <div className="border rounded-lg overflow-hidden">
            {duplicateRows.slice(0, 10).map((r) => (
              <div key={r.row} className="px-3 py-2 border-b last:border-b-0 bg-amber-50 dark:bg-amber-900/10 text-sm">
                <span className="font-medium">Row {r.row}:</span>
                <span className="ml-2">
                  {r.data.firstName} {r.data.lastName}
                  {r.data.dateOfBirth ? ` (${r.data.dateOfBirth})` : ''}
                </span>
                <span className="ml-2 text-amber-700 dark:text-amber-400">
                  - already exists, will be skipped
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StepImport({
  importResult,
  isImporting,
  totalRows,
}: {
  importResult: ImportResult | null;
  isImporting: boolean;
  totalRows: number;
}) {
  if (isImporting) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-medium">Importing patients...</p>
        <p className="text-xs text-muted-foreground">
          Processing {totalRows} rows. This may take a moment.
        </p>
        <Progress value={undefined} className="w-64" />
      </div>
    );
  }

  if (!importResult) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Click "Start Import" to begin importing patients.
      </div>
    );
  }

  const handleDownloadErrors = () => {
    if (!importResult.errors.length) return;
    const headers = 'Row,Field,Error\n';
    const rows = importResult.errors
      .map((e) => `${e.row},"${e.field}","${e.message.replace(/"/g, '""')}"`)
      .join('\n');
    const csv = headers + rows;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-errors-${importResult.importId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="text-center py-6">
        <CheckCircle2 className="mx-auto h-16 w-16 text-green-600 mb-4" />
        <h3 className="text-xl font-semibold mb-2">Import Complete</h3>
        <p className="text-sm text-muted-foreground">
          {importResult.totalRows} rows processed
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="pt-4 pb-4 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-600 mb-2" />
            <div className="text-3xl font-bold text-green-600">{importResult.imported}</div>
            <div className="text-sm text-muted-foreground">Successfully Imported</div>
          </CardContent>
        </Card>

        <Card className="border-amber-200 dark:border-amber-800">
          <CardContent className="pt-4 pb-4 text-center">
            <SkipForward className="mx-auto h-8 w-8 text-amber-600 mb-2" />
            <div className="text-3xl font-bold text-amber-600">{importResult.skipped}</div>
            <div className="text-sm text-muted-foreground">Skipped (Duplicates)</div>
          </CardContent>
        </Card>

        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="pt-4 pb-4 text-center">
            <XCircle className="mx-auto h-8 w-8 text-red-600 mb-2" />
            <div className="text-3xl font-bold text-red-600">{importResult.failed}</div>
            <div className="text-sm text-muted-foreground">Failed</div>
          </CardContent>
        </Card>
      </div>

      {importResult.errors.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium">Error Details</h4>
            <Button variant="outline" size="sm" onClick={handleDownloadErrors}>
              <Download className="mr-2 h-3 w-3" />
              Download Error Report
            </Button>
          </div>
          <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            {importResult.errors.slice(0, 50).map((e, i) => (
              <div
                key={i}
                className="px-3 py-2 border-b last:border-b-0 bg-red-50 dark:bg-red-900/10 text-sm"
              >
                <span className="font-medium">Row {e.row}</span>
                <span className="mx-1 text-muted-foreground">|</span>
                <span className="text-red-700 dark:text-red-400">
                  {e.field}: {e.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== Import History ====================

function ImportHistorySection() {
  const { data: history } = useQuery<ImportHistoryEntry[]>({
    queryKey: ['/api/data-import/history'],
  });

  if (!history || history.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Import History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">File</th>
                <th className="text-left px-3 py-2 font-medium">Source</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Imported</th>
                <th className="text-right px-3 py-2 font-medium">Skipped</th>
                <th className="text-right px-3 py-2 font-medium">Failed</th>
                <th className="text-left px-3 py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{entry.filename}</td>
                  <td className="px-3 py-2">
                    {SOURCE_SYSTEMS.find((s) => s.value === entry.sourceSystem)?.label ||
                      entry.sourceSystem}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        entry.status === 'completed'
                          ? 'default'
                          : entry.status === 'failed'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {entry.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-green-600">{entry.successCount}</td>
                  <td className="px-3 py-2 text-right text-amber-600">{entry.skippedCount}</td>
                  <td className="px-3 py-2 text-right text-red-600">{entry.failedCount}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== Main Component ====================

const STEPS = [
  { key: 'upload', label: 'Upload', icon: Upload },
  { key: 'map', label: 'Map Columns', icon: Columns },
  { key: 'validate', label: 'Validate', icon: Eye },
  { key: 'import', label: 'Import', icon: Play },
];

export default function DataImport() {
  const { toast } = useToast();

  const [currentStep, setCurrentStep] = useState(0);
  const [sourceSystem, setSourceSystem] = useState('generic');

  // Upload state
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Mapping state
  const [mappingData, setMappingData] = useState<MapColumnsResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  // Validation state
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Import state
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // ==================== Handlers ====================

  const handleUpload = useCallback(
    async (file: File, srcSystem: string) => {
      setIsUploading(true);
      setSourceSystem(srcSystem);

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('sourceSystem', srcSystem);

        const res = await fetch('/api/data-import/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/api/login';
            return;
          }
          const err = await res.json().catch(() => ({ message: `Server error (${res.status})` }));
          throw new Error(err.message || 'Upload failed');
        }

        const result: UploadResult = await res.json();
        setUploadResult(result);
        setColumnMapping(result.suggestedMappings || {});

        // Fetch mapping data
        try {
          const mapRes = await fetch('/api/data-import/map-columns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ fileId: result.fileId, sourceSystem: srcSystem }),
          });
          if (mapRes.ok) {
            const mapData: MapColumnsResult = await mapRes.json();
            setMappingData(mapData);
          }
        } catch {
          // Column mapping fetch failed — user can still manually map
        }

        // Auto-advance to mapping step
        setCurrentStep(1);

        toast({
          title: 'File uploaded',
          description: `${result.rowCount} rows detected from ${file.name}`,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Could not process file';
        toast({
          title: 'Upload failed',
          description: msg,
          variant: 'destructive',
        });
        // If session expired, redirect to login
        if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
          setTimeout(() => { window.location.href = '/api/login'; }, 1500);
        }
      } finally {
        setIsUploading(false);
      }
    },
    [toast]
  );

  const handleMappingChange = useCallback((sourceCol: string, targetField: string) => {
    setColumnMapping((prev) => {
      const updated = { ...prev };
      if (targetField) {
        updated[sourceCol] = targetField;
      } else {
        delete updated[sourceCol];
      }
      return updated;
    });
  }, []);

  const handleValidate = useCallback(async () => {
    if (!uploadResult) return;
    setIsValidating(true);
    setValidationResult(null);

    try {
      const res = await apiRequest('POST', '/api/data-import/validate', {
        fileId: uploadResult.fileId,
        columnMapping,
      });
      const result: ValidationResult = await res.json();
      setValidationResult(result);
    } catch (error) {
      toast({
        title: 'Validation failed',
        description: error instanceof Error ? error.message : 'Could not validate data',
        variant: 'destructive',
      });
    } finally {
      setIsValidating(false);
    }
  }, [uploadResult, columnMapping, toast]);

  const handleExecuteImport = useCallback(async () => {
    if (!uploadResult) return;
    setIsImporting(true);
    setImportResult(null);

    try {
      const res = await apiRequest('POST', '/api/data-import/execute', {
        fileId: uploadResult.fileId,
        columnMapping,
        skipDuplicates: true,
        sourceSystem,
      });
      const result: ImportResult = await res.json();
      setImportResult(result);

      toast({
        title: 'Import complete',
        description: `${result.imported} patients imported successfully`,
      });
    } catch (error) {
      toast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Import encountered an error',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  }, [uploadResult, columnMapping, sourceSystem, toast]);

  const handleStartOver = () => {
    setCurrentStep(0);
    setUploadResult(null);
    setMappingData(null);
    setColumnMapping({});
    setValidationResult(null);
    setImportResult(null);
  };

  // ==================== Navigation Helpers ====================

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return !!uploadResult;
      case 1: {
        const mappedTargets = Object.values(columnMapping);
        return mappedTargets.includes('firstName') && mappedTargets.includes('lastName');
      }
      case 2:
        return !!validationResult && validationResult.validCount > 0;
      default:
        return false;
    }
  };

  const handleNext = async () => {
    if (currentStep === 1) {
      // Moving to validate step — trigger validation
      setCurrentStep(2);
      // Run validation after step change
      setTimeout(() => handleValidate(), 100);
    } else if (currentStep === 2) {
      setCurrentStep(3);
    } else {
      setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  };

  const handleBack = () => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  };

  // ==================== Render ====================

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Users className="h-7 w-7" />
          Patient Data Import
        </h1>
        <p className="text-muted-foreground mt-1">
          Import patient records from another system. Upload a CSV or JSON file exported from your
          previous software.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = idx === currentStep;
          const isCompleted = idx < currentStep;
          return (
            <div key={step.key} className="flex items-center">
              {idx > 0 && (
                <div
                  className={`h-px w-8 mx-1 ${
                    isCompleted ? 'bg-primary' : 'bg-muted-foreground/25'
                  }`}
                />
              )}
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : isCompleted
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{step.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {(() => {
              const Icon = STEPS[currentStep].icon;
              return <Icon className="h-5 w-5" />;
            })()}
            {STEPS[currentStep].label}
          </CardTitle>
          <CardDescription>
            {currentStep === 0 && 'Upload a patient data file from your previous system.'}
            {currentStep === 1 &&
              'Map the columns from your file to our patient fields.'}
            {currentStep === 2 &&
              'Review the data and fix any validation errors before importing.'}
            {currentStep === 3 &&
              (importResult
                ? 'Import is complete. Review the results below.'
                : 'Ready to import. Click "Start Import" to begin.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentStep === 0 && (
            <StepUpload onUpload={handleUpload} isUploading={isUploading} />
          )}

          {currentStep === 1 && uploadResult && (
            <StepMapColumns
              uploadResult={uploadResult}
              mappingData={mappingData}
              columnMapping={columnMapping}
              onMappingChange={handleMappingChange}
            />
          )}

          {currentStep === 2 && (
            <StepValidate
              validationResult={validationResult}
              isValidating={isValidating}
            />
          )}

          {currentStep === 3 && (
            <StepImport
              importResult={importResult}
              isImporting={isImporting}
              totalRows={uploadResult?.rowCount || 0}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between">
        <div>
          {currentStep > 0 && !importResult && (
            <Button variant="outline" onClick={handleBack} disabled={isImporting}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          )}
          {importResult && (
            <Button variant="outline" onClick={handleStartOver}>
              Start New Import
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {uploadResult && currentStep > 0 && currentStep < 3 && (
            <div className="text-sm text-muted-foreground mr-4">
              <FileText className="inline h-3 w-3 mr-1" />
              {uploadResult.filename} ({uploadResult.rowCount} rows)
            </div>
          )}
          {currentStep < 3 && currentStep > 0 && (
            <Button onClick={handleNext} disabled={!canProceed()}>
              {currentStep === 2 ? 'Review Complete' : 'Next'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
          {currentStep === 3 && !importResult && (
            <Button
              onClick={handleExecuteImport}
              disabled={isImporting || !validationResult || validationResult.validCount === 0}
            >
              {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Play className="mr-2 h-4 w-4" />
              Start Import
            </Button>
          )}
        </div>
      </div>

      {/* Import history */}
      <ImportHistorySection />
    </div>
  );
}

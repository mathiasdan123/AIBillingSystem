import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Download,
  Users,
  FileText,
  Calendar,
  Receipt,
  ShieldCheck,
  Database,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';

interface ExportType {
  key: string;
  titleKey: string;
  descriptionKey: string;
  endpoint: string;
  icon: React.ElementType;
  method: 'GET' | 'POST';
  isFullBackup?: boolean;
}

const exportTypes: ExportType[] = [
  {
    key: 'patients',
    titleKey: 'dataExport.patients.title',
    descriptionKey: 'dataExport.patients.description',
    endpoint: '/api/export/patients',
    icon: Users,
    method: 'GET',
  },
  {
    key: 'claims',
    titleKey: 'dataExport.claims.title',
    descriptionKey: 'dataExport.claims.description',
    endpoint: '/api/export/claims',
    icon: FileText,
    method: 'GET',
  },
  {
    key: 'appointments',
    titleKey: 'dataExport.appointments.title',
    descriptionKey: 'dataExport.appointments.description',
    endpoint: '/api/export/appointments',
    icon: Calendar,
    method: 'GET',
  },
  {
    key: 'statements',
    titleKey: 'dataExport.statements.title',
    descriptionKey: 'dataExport.statements.description',
    endpoint: '/api/export/statements',
    icon: Receipt,
    method: 'GET',
  },
  {
    key: 'audit-log',
    titleKey: 'dataExport.auditLog.title',
    descriptionKey: 'dataExport.auditLog.description',
    endpoint: '/api/export/audit-log',
    icon: ShieldCheck,
    method: 'GET',
  },
];

const fullBackupExport: ExportType = {
  key: 'full-backup',
  titleKey: 'dataExport.fullBackup.title',
  descriptionKey: 'dataExport.fullBackup.description',
  endpoint: '/api/export/full-backup',
  icon: Database,
  method: 'POST',
  isFullBackup: true,
};

function getLastExportTimestamp(key: string): string | null {
  try {
    return localStorage.getItem(`export-timestamp-${key}`);
  } catch {
    return null;
  }
}

function setLastExportTimestamp(key: string) {
  try {
    localStorage.setItem(`export-timestamp-${key}`, new Date().toISOString());
  } catch {
    // localStorage not available
  }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DataExport() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exportTimestamps, setExportTimestamps] = useState<Record<string, string | null>>(() => {
    const timestamps: Record<string, string | null> = {};
    for (const et of exportTypes) {
      timestamps[et.key] = getLastExportTimestamp(et.key);
    }
    timestamps[fullBackupExport.key] = getLastExportTimestamp(fullBackupExport.key);
    return timestamps;
  });

  const handleExport = async (exportType: ExportType) => {
    setLoadingKey(exportType.key);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const queryString = params.toString();
      const url = queryString ? `${exportType.endpoint}?${queryString}` : exportType.endpoint;

      const response = await fetch(url, {
        method: exportType.method,
        credentials: 'include',
        headers: exportType.method === 'POST' ? { 'Content-Type': 'application/json' } : {},
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Export failed with status ${response.status}`);
      }

      // Get filename from Content-Disposition or generate one
      const disposition = response.headers.get('Content-Disposition');
      let filename = `${exportType.key}-export.csv`;
      if (disposition) {
        const match = disposition.match(/filename="?(.+?)"?$/);
        if (match) filename = match[1];
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      setLastExportTimestamp(exportType.key);
      setExportTimestamps(prev => ({
        ...prev,
        [exportType.key]: new Date().toISOString(),
      }));

      toast({
        title: t('dataExport.exportSuccess'),
        description: t('dataExport.exportSuccessDescription', { type: t(exportType.titleKey) }),
      });
    } catch (error) {
      toast({
        title: t('dataExport.exportError'),
        description: error instanceof Error ? error.message : t('dataExport.exportErrorDescription'),
        variant: 'destructive',
      });
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-8 max-w-5xl">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('dataExport.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('dataExport.subtitle')}
        </p>
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('dataExport.dateRange.title')}</CardTitle>
          <CardDescription>{t('dataExport.dateRange.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Label htmlFor="startDate">{t('dataExport.dateRange.startDate')}</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="endDate">{t('dataExport.dateRange.endDate')}</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => { setStartDate(''); setEndDate(''); }}
              >
                {t('dataExport.dateRange.clear')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Individual Exports */}
      <div>
        <h2 className="text-xl font-semibold mb-4">{t('dataExport.individualExports')}</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {exportTypes.map((exportType) => {
            const Icon = exportType.icon;
            const isLoading = loadingKey === exportType.key;
            const lastExport = exportTimestamps[exportType.key];

            return (
              <Card key={exportType.key} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-base">{t(exportType.titleKey)}</CardTitle>
                  </div>
                  <CardDescription className="text-sm">
                    {t(exportType.descriptionKey)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-auto pt-0">
                  {lastExport && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                      <Clock className="h-3 w-3" />
                      <span>{t('dataExport.lastExported')}: {formatTimestamp(lastExport)}</span>
                    </div>
                  )}
                  <Button
                    className="w-full"
                    onClick={() => handleExport(exportType)}
                    disabled={isLoading || loadingKey !== null}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('dataExport.exporting')}
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        {t('dataExport.exportCsv')}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Full Backup Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4">{t('dataExport.fullBackup.sectionTitle')}</h2>
        <Card className="border-amber-200 dark:border-amber-800">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Database className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <CardTitle>{t(fullBackupExport.titleKey)}</CardTitle>
                <CardDescription>{t(fullBackupExport.descriptionKey)}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{t('dataExport.fullBackup.warning')}</span>
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <p>{t('dataExport.fullBackup.includes')}:</p>
              <ul className="list-disc list-inside ml-2 space-y-0.5">
                <li>{t('dataExport.fullBackup.includesPatients')}</li>
                <li>{t('dataExport.fullBackup.includesClaims')}</li>
                <li>{t('dataExport.fullBackup.includesAppointments')}</li>
                <li>{t('dataExport.fullBackup.includesSoapNotes')}</li>
                <li>{t('dataExport.fullBackup.includesStatements')}</li>
                <li>{t('dataExport.fullBackup.includesPayments')}</li>
              </ul>
            </div>

            {exportTimestamps[fullBackupExport.key] && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <span>{t('dataExport.lastExported')}: {formatTimestamp(exportTimestamps[fullBackupExport.key]!)}</span>
              </div>
            )}

            <Button
              className="w-full"
              variant="outline"
              onClick={() => handleExport(fullBackupExport)}
              disabled={loadingKey !== null}
            >
              {loadingKey === fullBackupExport.key ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('dataExport.generatingBackup')}
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4" />
                  {t('dataExport.generateBackup')}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

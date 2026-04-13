import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import {
  Upload, FileText, CheckCircle, XCircle, Clock, Search,
  DollarSign, ArrowRight, Loader2, RefreshCw, Link2, AlertCircle, FileCode
} from "lucide-react";

// ==================== Types ====================

interface RemittanceRecord {
  id: number;
  practiceId: number;
  receivedDate: string;
  payerName: string;
  payerId: string | null;
  checkNumber: string | null;
  checkDate: string | null;
  totalPaymentAmount: string;
  status: string;
  processedAt: string | null;
  createdAt: string;
  lineItemCount?: number;
  matchedCount?: number;
}

interface RemittanceLineItem {
  id: number;
  remittanceId: number;
  claimId: number | null;
  patientName: string;
  memberId: string | null;
  serviceDate: string | null;
  cptCode: string | null;
  chargedAmount: string | null;
  allowedAmount: string | null;
  paidAmount: string | null;
  adjustmentAmount: string | null;
  adjustmentReasonCodes: Array<{ code: string; description: string }> | null;
  remarkCodes: Array<{ code: string; description: string }> | null;
  status: string;
}

interface RemittanceDetail extends RemittanceRecord {
  lineItems: RemittanceLineItem[];
  rawData: any;
}

interface ClaimSearchResult {
  id: number;
  claimNumber: string | null;
  patientFirstName: string;
  patientLastName: string;
  totalAmount: string;
  status: string;
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

// ==================== Status Badge ====================

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'processed':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100"><CheckCircle className="w-3 h-3 mr-1" /> Processed</Badge>;
    case 'error':
      return <Badge className="bg-red-100 text-red-800 hover:bg-red-100"><XCircle className="w-3 h-3 mr-1" /> Error</Badge>;
    case 'matched':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100"><Link2 className="w-3 h-3 mr-1" /> Matched</Badge>;
    case 'unmatched':
      return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100"><AlertCircle className="w-3 h-3 mr-1" /> Unmatched</Badge>;
    case 'partial':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100"><Clock className="w-3 h-3 mr-1" /> Partial</Badge>;
    case 'pending':
    default:
      return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
  }
}

// ==================== Format Helpers ====================

function formatCurrency(value: string | number | null | undefined): string {
  if (value == null) return '$0.00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// ==================== Sample 835 Data ====================

const SAMPLE_835_DATA = `ISA*00*          *00*          *ZZ*AETNA          *ZZ*HEALINGHANDS   *260401*1200*^*00501*000000001*0*P*:~
GS*HP*AETNA*HEALINGHANDS*20260401*1200*1*X*005010X221A1~
ST*835*0001~
BPR*I*1250.00*C*ACH*CTX*01*999999999*DA*123456789*1234567890**01*999999999*DA*987654321*20260401~
TRN*1*123456789*1234567890~
DTM*405*20260401~
N1*PR*AETNA*XV*60054~
N1*PE*HEALING HANDS OT*XX*1234567890~
CLP*PAT001-20260315*1*200.00*150.00*25.00*12*AETNA123*11~
NM1*QC*1*HARTWELL*MASON****MI*MEM123456~
SVC*HC:97530*200.00*150.00**4~
DTM*472*20260315~
CAS*CO*45*25.00~
CAS*PR*1*25.00~
AMT*B6*175.00~
CLP*PAT002-20260315*1*350.00*300.00*30.00*12*AETNA456~
NM1*QC*1*CHEN*LILY****MI*MEM789012~
SVC*HC:97110:GO*175.00*150.00**2~
DTM*472*20260315~
CAS*CO*45*15.00~
CAS*PR*3*10.00~
SVC*HC:97530*175.00*150.00**2~
DTM*472*20260315~
CAS*CO*45*5.00~
CAS*PR*1*20.00~
AMT*B6*150.00~
SE*26*0001~
GE*1*1~
IEA*1*000000001~`;

// ==================== Main Component ====================

export default function Remittance() {
  const { isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedRemittance, setSelectedRemittance] = useState<RemittanceDetail | null>(null);
  const [uploadMode, setUploadMode] = useState<'edi' | 'json'>('edi');
  const [ediText, setEdiText] = useState('');
  const [jsonData, setJsonData] = useState('');
  const [showManualMatchDialog, setShowManualMatchDialog] = useState(false);
  const [matchingLineItem, setMatchingLineItem] = useState<RemittanceLineItem | null>(null);
  const [claimSearchTerm, setClaimSearchTerm] = useState('');

  // ==================== Queries ====================

  const { data: remittanceList, isLoading: listLoading } = useQuery<PaginatedResponse<RemittanceRecord>>({
    queryKey: ['/api/remittance', `?page=${page}&limit=20&status=${statusFilter}`],
    enabled: !authLoading,
  });

  const { data: claimSearchResults } = useQuery<ClaimSearchResult[]>({
    queryKey: ['/api/remittance/claims/search', `?q=${encodeURIComponent(claimSearchTerm)}`],
    enabled: claimSearchTerm.length >= 2,
  });

  // ==================== Mutations ====================

  const uploadMutation = useMutation({
    mutationFn: async (payload: { mode: string; data: string }) => {
      if (payload.mode === 'edi') {
        const response = await apiRequest('POST', '/api/remittance/upload', { rawEdi: payload.data });
        return response.json();
      } else {
        const parsed = JSON.parse(payload.data);
        const response = await apiRequest('POST', '/api/remittance/upload', parsed);
        return response.json();
      }
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Remittance data uploaded and parsed successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/remittance'] });
      setShowUploadDialog(false);
      setEdiText('');
      setJsonData('');
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) return;
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
    },
  });

  const autoMatchMutation = useMutation({
    mutationFn: async (remittanceId: number) => {
      const response = await apiRequest('POST', `/api/remittance/${remittanceId}/auto-match`);
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Auto-Match Complete", description: data.message });
      queryClient.invalidateQueries({ queryKey: ['/api/remittance'] });
      if (selectedRemittance) {
        loadRemittanceDetail(selectedRemittance.id);
      }
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) return;
      toast({ title: "Auto-Match Failed", description: error.message, variant: "destructive" });
    },
  });

  const manualMatchMutation = useMutation({
    mutationFn: async ({ remittanceId, lineItemId, claimId }: { remittanceId: number; lineItemId: number; claimId: number }) => {
      const response = await apiRequest('POST', `/api/remittance/${remittanceId}/line-items/${lineItemId}/match`, { claimId });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Line item matched to claim" });
      queryClient.invalidateQueries({ queryKey: ['/api/remittance'] });
      setShowManualMatchDialog(false);
      setMatchingLineItem(null);
      if (selectedRemittance) {
        loadRemittanceDetail(selectedRemittance.id);
      }
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) return;
      toast({ title: "Match Failed", description: error.message, variant: "destructive" });
    },
  });

  // ==================== Handlers ====================

  const loadRemittanceDetail = useCallback(async (id: number) => {
    try {
      const response = await apiRequest('GET', `/api/remittance/${id}`);
      const data = await response.json();
      setSelectedRemittance(data);
      setShowDetailDialog(true);
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to load remittance details", variant: "destructive" });
    }
  }, [toast]);

  const handleUpload = () => {
    const data = uploadMode === 'edi' ? ediText : jsonData;
    if (!data.trim()) {
      toast({ title: "Error", description: "Please provide remittance data", variant: "destructive" });
      return;
    }
    if (uploadMode === 'json') {
      try {
        JSON.parse(data);
      } catch {
        toast({ title: "Error", description: "Invalid JSON format", variant: "destructive" });
        return;
      }
    }
    uploadMutation.mutate({ mode: uploadMode, data });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (file.name.endsWith('.json')) {
        setUploadMode('json');
        setJsonData(text);
      } else {
        setUploadMode('edi');
        setEdiText(text);
      }
    };
    reader.readAsText(file);
  };

  const openManualMatch = (lineItem: RemittanceLineItem) => {
    setMatchingLineItem(lineItem);
    setClaimSearchTerm(lineItem.patientName || '');
    setShowManualMatchDialog(true);
  };

  // ==================== Render ====================

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const records = remittanceList?.data || [];
  const pagination = remittanceList?.pagination;

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">ERA / 835 Remittance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Upload and reconcile insurance payment remittance advice
          </p>
        </div>
        <Button onClick={() => setShowUploadDialog(true)}>
          <Upload className="w-4 h-4 mr-2" /> Upload 835
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Total Remittances</p>
                <p className="text-2xl font-bold">{pagination?.total || 0}</p>
              </div>
              <FileText className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Pending</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {records.filter(r => r.status === 'pending').length}
                </p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Processed</p>
                <p className="text-2xl font-bold text-green-600">
                  {records.filter(r => r.status === 'processed').length}
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Total Payments</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(
                    records.reduce((sum, r) => sum + parseFloat(r.totalPaymentAmount || '0'), 0)
                  )}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processed">Processed</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Remittance List */}
      <Card>
        <CardHeader>
          <CardTitle>Remittance Records</CardTitle>
          <CardDescription>Electronic Remittance Advice (ERA) from insurance payers</CardDescription>
        </CardHeader>
        <CardContent>
          {listLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500">No remittance records yet</p>
              <p className="text-sm text-slate-400 mt-1">Upload an 835 file to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-medium text-slate-600">Date</th>
                    <th className="pb-3 font-medium text-slate-600">Payer</th>
                    <th className="pb-3 font-medium text-slate-600">Check #</th>
                    <th className="pb-3 font-medium text-slate-600">Total Payment</th>
                    <th className="pb-3 font-medium text-slate-600">Line Items</th>
                    <th className="pb-3 font-medium text-slate-600">Status</th>
                    <th className="pb-3 font-medium text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-b hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="py-3">{formatDate(record.receivedDate)}</td>
                      <td className="py-3 font-medium">{record.payerName}</td>
                      <td className="py-3">{record.checkNumber || '--'}</td>
                      <td className="py-3 font-medium">{formatCurrency(record.totalPaymentAmount)}</td>
                      <td className="py-3">
                        {record.matchedCount !== undefined && record.lineItemCount !== undefined
                          ? `${record.matchedCount}/${record.lineItemCount} matched`
                          : '--'
                        }
                      </td>
                      <td className="py-3"><StatusBadge status={record.status} /></td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => loadRemittanceDetail(record.id)}
                          >
                            View
                          </Button>
                          {record.status !== 'processed' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => autoMatchMutation.mutate(record.id)}
                              disabled={autoMatchMutation.isPending}
                            >
                              {autoMatchMutation.isPending ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3 mr-1" />
                              )}
                              Auto-Match
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <p className="text-sm text-slate-500">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasMore}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ==================== Upload Dialog ==================== */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload Remittance (835)</DialogTitle>
            <DialogDescription>
              Upload an X12 835 EDI file or paste remittance data in JSON format
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* File upload */}
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center">
              <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-600 mb-2">Drop an 835 file here or click to browse</p>
              <Input
                type="file"
                accept=".835,.edi,.txt,.json"
                onChange={handleFileUpload}
                className="max-w-xs mx-auto"
              />
            </div>

            {/* Format toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant={uploadMode === 'edi' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setUploadMode('edi')}
                >
                  X12 835 (EDI)
                </Button>
                <Button
                  variant={uploadMode === 'json' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setUploadMode('json')}
                >
                  JSON
                </Button>
              </div>
              {uploadMode === 'edi' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEdiText(SAMPLE_835_DATA)}
                  className="text-blue-600 hover:text-blue-700"
                >
                  <FileCode className="w-3 h-3 mr-1" /> Load Sample
                </Button>
              )}
            </div>

            {/* Text area */}
            {uploadMode === 'edi' ? (
              <Textarea
                placeholder={`Paste X12 835 content here...\n\nISA*00*          *00*          *ZZ*SENDER...\nGS*HP*SENDER*RECEIVER*...`}
                value={ediText}
                onChange={(e) => setEdiText(e.target.value)}
                rows={10}
                className="font-mono text-xs"
              />
            ) : (
              <Textarea
                placeholder={`{\n  "payerName": "Aetna",\n  "totalPaymentAmount": "1250.00",\n  "checkNumber": "12345",\n  "lineItems": [\n    {\n      "patientName": "John Smith",\n      "serviceDate": "2025-01-15",\n      "cptCode": "90837",\n      "chargedAmount": "200.00",\n      "paidAmount": "150.00"\n    }\n  ]\n}`}
                value={jsonData}
                onChange={(e) => setJsonData(e.target.value)}
                rows={10}
                className="font-mono text-xs"
              />
            )}

            <Button
              onClick={handleUpload}
              disabled={uploadMutation.isPending}
              className="w-full"
            >
              {uploadMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" /> Upload & Parse</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ==================== Detail Dialog ==================== */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          {selectedRemittance && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span>Remittance Detail</span>
                  <StatusBadge status={selectedRemittance.status} />
                </DialogTitle>
                <DialogDescription>
                  {selectedRemittance.payerName} - {formatDate(selectedRemittance.receivedDate)}
                  {selectedRemittance.checkNumber && ` - Check #${selectedRemittance.checkNumber}`}
                </DialogDescription>
              </DialogHeader>

              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-4">
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Payer</p>
                  <p className="font-medium">{selectedRemittance.payerName}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Total Payment</p>
                  <p className="font-medium text-green-600">{formatCurrency(selectedRemittance.totalPaymentAmount)}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Check #</p>
                  <p className="font-medium">{selectedRemittance.checkNumber || '--'}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Check Date</p>
                  <p className="font-medium">{formatDate(selectedRemittance.checkDate)}</p>
                </div>
              </div>

              {/* Auto-match button */}
              {selectedRemittance.status !== 'processed' && (
                <div className="flex justify-end mb-4">
                  <Button
                    onClick={() => autoMatchMutation.mutate(selectedRemittance.id)}
                    disabled={autoMatchMutation.isPending}
                  >
                    {autoMatchMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Matching...</>
                    ) : (
                      <><RefreshCw className="w-4 h-4 mr-2" /> Auto-Match All</>
                    )}
                  </Button>
                </div>
              )}

              {/* Line Items Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left bg-slate-50 dark:bg-slate-800">
                      <th className="p-2 font-medium text-slate-600">Patient</th>
                      <th className="p-2 font-medium text-slate-600">Service Date</th>
                      <th className="p-2 font-medium text-slate-600">CPT</th>
                      <th className="p-2 font-medium text-slate-600 text-right">Charged</th>
                      <th className="p-2 font-medium text-slate-600 text-right">Allowed</th>
                      <th className="p-2 font-medium text-slate-600 text-right">Paid</th>
                      <th className="p-2 font-medium text-slate-600 text-right">Adj.</th>
                      <th className="p-2 font-medium text-slate-600">Status</th>
                      <th className="p-2 font-medium text-slate-600">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedRemittance.lineItems || []).map((item) => (
                      <tr key={item.id} className="border-b hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="p-2">
                          <div className="font-medium">{item.patientName}</div>
                          {item.memberId && <div className="text-xs text-slate-400">ID: {item.memberId}</div>}
                        </td>
                        <td className="p-2">{formatDate(item.serviceDate)}</td>
                        <td className="p-2">
                          {item.cptCode ? (
                            <Badge variant="outline">{item.cptCode}</Badge>
                          ) : '--'}
                        </td>
                        <td className="p-2 text-right">{formatCurrency(item.chargedAmount)}</td>
                        <td className="p-2 text-right">{formatCurrency(item.allowedAmount)}</td>
                        <td className="p-2 text-right font-medium text-green-600">{formatCurrency(item.paidAmount)}</td>
                        <td className="p-2 text-right text-red-600">{formatCurrency(item.adjustmentAmount)}</td>
                        <td className="p-2"><StatusBadge status={item.status} /></td>
                        <td className="p-2">
                          {item.status === 'unmatched' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openManualMatch(item)}
                            >
                              <Link2 className="w-3 h-3 mr-1" /> Match
                            </Button>
                          )}
                          {item.status === 'matched' && item.claimId && (
                            <span className="text-xs text-green-600">Claim #{item.claimId}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Adjustment Details */}
              {(selectedRemittance.lineItems || []).some(li =>
                (li.adjustmentReasonCodes && li.adjustmentReasonCodes.length > 0)
              ) && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Adjustment Details</h4>
                  <div className="space-y-2">
                    {(selectedRemittance.lineItems || [])
                      .filter(li => li.adjustmentReasonCodes && li.adjustmentReasonCodes.length > 0)
                      .map(li => (
                        <div key={li.id} className="bg-amber-50 dark:bg-amber-900/20 rounded p-2 text-sm">
                          <span className="font-medium">{li.patientName}</span>
                          {li.cptCode && <span className="text-slate-500"> ({li.cptCode})</span>}:
                          <ul className="mt-1 ml-4 list-disc">
                            {(li.adjustmentReasonCodes || []).map((adj, idx) => (
                              <li key={idx} className="text-xs text-slate-600 dark:text-slate-300">
                                {adj.code}: {adj.description}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ==================== Manual Match Dialog ==================== */}
      <Dialog open={showManualMatchDialog} onOpenChange={setShowManualMatchDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Match Line Item to Claim</DialogTitle>
            <DialogDescription>
              Search for a claim to match with this remittance line item
            </DialogDescription>
          </DialogHeader>

          {matchingLineItem && (
            <div className="space-y-4">
              {/* Line item info */}
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-sm">
                <p><span className="font-medium">Patient:</span> {matchingLineItem.patientName}</p>
                <p><span className="font-medium">Service Date:</span> {formatDate(matchingLineItem.serviceDate)}</p>
                <p><span className="font-medium">CPT:</span> {matchingLineItem.cptCode || '--'}</p>
                <p><span className="font-medium">Paid:</span> {formatCurrency(matchingLineItem.paidAmount)}</p>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search by patient name or claim number..."
                  value={claimSearchTerm}
                  onChange={(e) => setClaimSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Search Results */}
              <div className="max-h-60 overflow-y-auto space-y-2">
                {claimSearchResults && claimSearchResults.length > 0 ? (
                  claimSearchResults.map((claim) => (
                    <div
                      key={claim.id}
                      className="border rounded-lg p-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer flex items-center justify-between"
                      onClick={() => {
                        if (selectedRemittance && matchingLineItem) {
                          manualMatchMutation.mutate({
                            remittanceId: selectedRemittance.id,
                            lineItemId: matchingLineItem.id,
                            claimId: claim.id,
                          });
                        }
                      }}
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {claim.patientFirstName} {claim.patientLastName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {claim.claimNumber ? `Claim #${claim.claimNumber}` : `ID: ${claim.id}`}
                          {' - '}
                          {formatCurrency(claim.totalAmount)}
                          {' - '}
                          <StatusBadge status={claim.status} />
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400" />
                    </div>
                  ))
                ) : claimSearchTerm.length >= 2 ? (
                  <p className="text-sm text-slate-500 text-center py-4">No claims found</p>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-4">Type at least 2 characters to search</p>
                )}
              </div>

              {manualMatchMutation.isPending && (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Matching...
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

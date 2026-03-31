import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, Search, Send, CheckCircle, Clock, XCircle, AlertCircle,
  DollarSign, FileText, TrendingUp, Ban, Eye, MoreVertical,
  Copy, RefreshCw, Loader2, Scale, Mail, ShieldAlert, ShieldCheck,
  TriangleAlert, CircleAlert, Info, Lightbulb, Download, Printer
} from "lucide-react";
import { exportToCsv } from "@/lib/exportUtils";
import AiDisclaimerBanner from "@/components/AiDisclaimerBanner";
import PrintLayout from "@/components/PrintLayout";
import SuperbillPrintView from "@/components/SuperbillPrintView";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const claimSchema = z.object({
  patientId: z.string().min(1, "Patient is required"),
  sessionId: z.string().optional(),
  insuranceId: z.string().min(1, "Insurance is required"),
  totalAmount: z.string().min(1, "Amount is required"),
  submittedAmount: z.string().optional(),
});

type ClaimFormData = z.infer<typeof claimSchema>;

interface Claim {
  id: number;
  claimNumber: string;
  patientId: number;
  insuranceId: number;
  totalAmount: string;
  submittedAmount: string | null;
  paidAmount: string | null;
  status: string;
  aiReviewScore: string | null;
  aiReviewNotes: string | null;
  denialReason: string | null;
  createdAt: string;
  submittedAt: string | null;
  paidAt: string | null;
  clearinghouseClaimId?: string | null;
  clearinghouseStatus?: string | null;
  billingOrder?: string | null;
  primaryClaimId?: number | null;
  primaryPaidAmount?: string | null;
  primaryAdjustmentAmount?: string | null;
  cobData?: any;
  denialPrediction?: {
    riskScore: number;
    riskLevel: "low" | "medium" | "high";
    issues: Array<{
      category: string;
      description: string;
      suggestion: string;
      severity: "low" | "medium" | "high" | "critical";
    }>;
    overallRecommendation: string;
    analyzedAt: string;
  } | null;
}

// Comprehensive claim detail component with tabs for billing, payments, and status
function ClaimFullDetail({ claim, lineItems, loadingLineItems, appeals, loadingAppeals, getPatientName, getInsuranceName, getStatusBadge, submitSecondaryMutation, regenerateAppealMutation }: {
  claim: any;
  lineItems: any[];
  loadingLineItems: boolean;
  appeals: any[];
  loadingAppeals: boolean;
  getPatientName: (id: number) => string;
  getInsuranceName: (id: number) => string;
  getStatusBadge: (status: string) => string;
  submitSecondaryMutation: any;
  regenerateAppealMutation: any;
}) {
  const [showAppealLetter, setShowAppealLetter] = useState(false);
  const { toast } = useToast();

  // Fetch payment postings for this claim
  const { data: paymentPostings = [] } = useQuery<any[]>({
    queryKey: [`/api/payment-postings/claim/${claim.id}`],
    enabled: !!claim.id,
  });

  const billed = parseFloat(claim.totalAmount || '0');
  const paid = parseFloat(claim.paidAmount || '0');
  const totalPaymentAmount = paymentPostings.reduce((sum: number, p: any) => sum + parseFloat(p.paymentAmount || '0'), 0);
  const totalAdjustment = paymentPostings.reduce((sum: number, p: any) => sum + parseFloat(p.adjustmentAmount || '0'), 0);
  const totalPatientResp = paymentPostings.reduce((sum: number, p: any) => sum + parseFloat(p.patientResponsibility || '0'), 0);
  const totalDeductible = paymentPostings.reduce((sum: number, p: any) => sum + parseFloat(p.deductibleApplied || '0'), 0);
  const totalCoinsurance = paymentPostings.reduce((sum: number, p: any) => sum + parseFloat(p.coinsuranceAmount || '0'), 0);
  const totalCopay = paymentPostings.reduce((sum: number, p: any) => sum + parseFloat(p.copayAmount || '0'), 0);
  const allowedAmount = paymentPostings.length > 0 ? parseFloat(paymentPostings[0].allowedAmount || '0') : 0;

  const copyAppealLetter = (letter: string) => {
    navigator.clipboard.writeText(letter);
    toast({ title: "Copied", description: "Appeal letter copied to clipboard" });
  };

  return (
    <Tabs defaultValue="billing" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="payments">Payments</TabsTrigger>
        <TabsTrigger value="status">Status</TabsTrigger>
        <TabsTrigger value="appeals">Appeals</TabsTrigger>
      </TabsList>

      {/* TAB 1: Billing Summary */}
      <TabsContent value="billing" className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-slate-500 text-xs">Patient</Label>
            <p className="font-medium">{getPatientName(claim.patientId)}</p>
          </div>
          <div>
            <Label className="text-slate-500 text-xs">Insurance</Label>
            <p className="font-medium">{getInsuranceName(claim.insuranceId)}</p>
          </div>
          <div>
            <Label className="text-slate-500 text-xs">Billed Amount</Label>
            <p className="font-medium text-lg">${billed.toFixed(2)}</p>
          </div>
          <div>
            <Label className="text-slate-500 text-xs">Paid Amount</Label>
            <p className={`font-medium text-lg ${paid > 0 ? 'text-green-600' : 'text-slate-400'}`}>
              {paid > 0 ? `$${paid.toFixed(2)}` : '—'}
            </p>
          </div>
          {claim.aiReviewScore && (
            <div>
              <Label className="text-slate-500 text-xs">AI Review Score</Label>
              <p className="font-medium">{parseFloat(claim.aiReviewScore).toFixed(0)}%</p>
            </div>
          )}
        </div>

        {/* COB Info */}
        {claim.billingOrder === 'secondary' && claim.primaryPaidAmount && (
          <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
            <Label className="text-purple-700 font-semibold text-xs">Coordination of Benefits</Label>
            <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
              <div>
                <span className="text-slate-500">Primary Paid:</span>{' '}
                <span className="font-medium text-green-600">${parseFloat(claim.primaryPaidAmount).toFixed(2)}</span>
              </div>
              {claim.primaryAdjustmentAmount && (
                <div>
                  <span className="text-slate-500">Primary Adjustment:</span>{' '}
                  <span className="font-medium">${parseFloat(claim.primaryAdjustmentAmount).toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Line Items Table */}
        <div className="border-t pt-4">
          <Label className="text-slate-700 font-semibold flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4" />
            Line Items
          </Label>
          {loadingLineItems ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : lineItems.length > 0 ? (
            <div className="bg-slate-50 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="text-left p-2 font-medium text-muted-foreground">CPT</th>
                    <th className="text-left p-2 font-medium text-muted-foreground">Description</th>
                    <th className="text-center p-2 font-medium text-muted-foreground">Mod</th>
                    <th className="text-center p-2 font-medium text-muted-foreground">Units</th>
                    <th className="text-right p-2 font-medium text-muted-foreground">Rate</th>
                    <th className="text-right p-2 font-medium text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item: any, index: number) => (
                    <tr key={index} className="border-t border-slate-200">
                      <td className="p-2">
                        <span className="font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs">
                          {item.cptCode?.code || item.cptCodeId}
                        </span>
                      </td>
                      <td className="p-2 text-muted-foreground text-xs">{item.cptCode?.description || 'N/A'}</td>
                      <td className="p-2 text-center text-xs">{item.modifier || '—'}</td>
                      <td className="p-2 text-center">{item.units || 1}</td>
                      <td className="p-2 text-right text-xs">{item.rate ? `$${parseFloat(item.rate).toFixed(2)}` : '—'}</td>
                      <td className="p-2 text-right font-medium">${parseFloat(item.amount || item.chargeAmount || '0').toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-300 bg-slate-100">
                  <tr>
                    <td colSpan={5} className="p-2 text-right font-semibold">Total Billed:</td>
                    <td className="p-2 text-right font-bold">${billed.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500 text-center py-4 bg-slate-50 rounded-lg">No line items</p>
          )}

          {/* ICD-10 Diagnosis Codes */}
          {lineItems.some((item: any) => item.icd10Code) && (
            <div className="mt-3">
              <Label className="text-slate-500 text-xs">Diagnosis Codes (ICD-10)</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {lineItems.filter((item: any) => item.icd10Code).map((item: any, i: number) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    <span className="font-mono">{item.icd10Code?.code}</span>
                    <span className="ml-1 text-slate-500">- {item.icd10Code?.description}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Secondary Insurance Submit */}
        {claim.status === 'paid' && claim.billingOrder !== 'secondary' && (
          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-700 font-semibold">Secondary Insurance</Label>
                <p className="text-sm text-slate-500">Submit remaining balance to secondary</p>
              </div>
              <Button
                onClick={() => submitSecondaryMutation.mutate(claim.id)}
                disabled={submitSecondaryMutation.isPending}
                className="bg-purple-600 hover:bg-purple-700"
                size="sm"
              >
                {submitSecondaryMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Copy className="w-4 h-4 mr-1" />}
                Submit to Secondary
              </Button>
            </div>
          </div>
        )}
      </TabsContent>

      {/* TAB 2: Payment & Adjustments */}
      <TabsContent value="payments" className="mt-4 space-y-4">
        {/* Payment Summary Bar */}
        <div className="bg-slate-50 rounded-lg p-4 border">
          <Label className="text-slate-700 font-semibold mb-3 block">Payment Breakdown</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <p className="text-xs text-slate-500 uppercase">Billed</p>
              <p className="text-lg font-bold">${billed.toFixed(2)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-500 uppercase">Allowed</p>
              <p className="text-lg font-bold text-blue-600">{allowedAmount > 0 ? `$${allowedAmount.toFixed(2)}` : '—'}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-500 uppercase">Paid</p>
              <p className="text-lg font-bold text-green-600">${(totalPaymentAmount || paid).toFixed(2)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-500 uppercase">Patient Resp.</p>
              <p className="text-lg font-bold text-amber-600">{totalPatientResp > 0 ? `$${totalPatientResp.toFixed(2)}` : '—'}</p>
            </div>
          </div>

          {/* Visual breakdown bar */}
          {billed > 0 && (totalPaymentAmount > 0 || paid > 0) && (
            <div className="w-full h-6 rounded-full overflow-hidden flex bg-slate-200">
              {(totalPaymentAmount || paid) > 0 && (
                <div
                  className="bg-green-500 h-full flex items-center justify-center text-[10px] text-white font-medium"
                  style={{ width: `${Math.min(((totalPaymentAmount || paid) / billed) * 100, 100)}%` }}
                >
                  Paid
                </div>
              )}
              {totalAdjustment > 0 && (
                <div
                  className="bg-orange-400 h-full flex items-center justify-center text-[10px] text-white font-medium"
                  style={{ width: `${Math.min((totalAdjustment / billed) * 100, 50)}%` }}
                >
                  Adj
                </div>
              )}
              {totalPatientResp > 0 && (
                <div
                  className="bg-amber-400 h-full flex items-center justify-center text-[10px] text-white font-medium"
                  style={{ width: `${Math.min((totalPatientResp / billed) * 100, 50)}%` }}
                >
                  Patient
                </div>
              )}
            </div>
          )}
        </div>

        {/* Patient Responsibility Breakdown */}
        {(totalDeductible > 0 || totalCoinsurance > 0 || totalCopay > 0) && (
          <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
            <Label className="text-amber-800 font-semibold text-sm mb-2 block">Patient Responsibility Breakdown</Label>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-slate-500">Deductible:</span>
                <p className="font-medium">${totalDeductible.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-slate-500">Coinsurance:</span>
                <p className="font-medium">${totalCoinsurance.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-slate-500">Copay:</span>
                <p className="font-medium">${totalCopay.toFixed(2)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Payment Postings Timeline */}
        <div className="border-t pt-4">
          <Label className="text-slate-700 font-semibold flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4" />
            Payment History
          </Label>
          {paymentPostings.length > 0 ? (
            <div className="space-y-3">
              {paymentPostings.map((posting: any, index: number) => (
                <div key={posting.id || index} className={`rounded-lg p-3 border ${posting.reversed ? 'bg-red-50 border-red-200' : 'bg-card border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {posting.reversed ? (
                        <Badge className="bg-red-100 text-red-700 text-xs">Reversed</Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-700 text-xs">Posted</Badge>
                      )}
                      <span className="text-sm font-medium">${parseFloat(posting.paymentAmount || '0').toFixed(2)}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {posting.paymentDate ? new Date(posting.paymentDate).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    {posting.payerName && <div><span className="text-slate-400">Payer:</span> {posting.payerName}</div>}
                    {posting.checkNumber && <div><span className="text-slate-400">Check/EFT:</span> {posting.checkNumber}</div>}
                    {posting.allowedAmount && <div><span className="text-slate-400">Allowed:</span> ${parseFloat(posting.allowedAmount).toFixed(2)}</div>}
                    {posting.adjustmentAmount && parseFloat(posting.adjustmentAmount) > 0 && (
                      <div><span className="text-slate-400">Adjustment:</span> ${parseFloat(posting.adjustmentAmount).toFixed(2)}</div>
                    )}
                    {posting.adjustmentReason && <div className="col-span-2"><span className="text-slate-400">Reason:</span> {posting.adjustmentReason}</div>}
                    {posting.remarkCode && <div className="col-span-2"><span className="text-slate-400">Remark:</span> {posting.remarkCode}</div>}
                    {posting.reversed && posting.reversalReason && (
                      <div className="col-span-2 text-red-600"><span className="text-red-400">Reversal Reason:</span> {posting.reversalReason}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 text-center py-6 bg-slate-50 rounded-lg">
              {claim.status === 'paid' ? 'No detailed payment postings recorded' : 'No payments posted yet'}
            </p>
          )}
        </div>

        {/* Adjustment Summary */}
        {totalAdjustment > 0 && (
          <div className="border-t pt-4">
            <Label className="text-slate-700 font-semibold text-sm mb-2 block">Adjustment Summary</Label>
            <div className="bg-orange-50 rounded-lg p-3 border border-orange-200 text-sm">
              <div className="flex justify-between">
                <span>Total Adjustments:</span>
                <span className="font-medium text-orange-700">${totalAdjustment.toFixed(2)}</span>
              </div>
              {billed > 0 && (
                <div className="flex justify-between mt-1">
                  <span>Write-off %:</span>
                  <span className="font-medium">{((totalAdjustment / billed) * 100).toFixed(1)}%</span>
                </div>
              )}
            </div>
          </div>
        )}
      </TabsContent>

      {/* TAB 3: Status & Clearinghouse */}
      <TabsContent value="status" className="mt-4 space-y-4">
        {/* Status Timeline */}
        <div>
          <Label className="text-slate-700 font-semibold mb-3 block">Claim Timeline</Label>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center"><FileText className="w-4 h-4 text-blue-600" /></div>
              <div>
                <p className="text-sm font-medium">Created</p>
                <p className="text-xs text-slate-500">{new Date(claim.createdAt).toLocaleString()}</p>
              </div>
            </div>
            {claim.submittedAt && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center"><Send className="w-4 h-4 text-indigo-600" /></div>
                <div>
                  <p className="text-sm font-medium">Submitted</p>
                  <p className="text-xs text-slate-500">{new Date(claim.submittedAt).toLocaleString()}</p>
                </div>
              </div>
            )}
            {claim.paidAt && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center"><CheckCircle className="w-4 h-4 text-green-600" /></div>
                <div>
                  <p className="text-sm font-medium">Paid</p>
                  <p className="text-xs text-slate-500">{new Date(claim.paidAt).toLocaleString()}</p>
                </div>
              </div>
            )}
            {claim.status === 'denied' && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center"><XCircle className="w-4 h-4 text-red-600" /></div>
                <div>
                  <p className="text-sm font-medium">Denied</p>
                  {claim.denialReason && <p className="text-xs text-red-600">{claim.denialReason}</p>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Clearinghouse Details */}
        {(claim.clearinghouseClaimId || claim.clearinghouseStatus) && (
          <div className="border-t pt-4">
            <Label className="text-slate-700 font-semibold mb-3 block">Clearinghouse</Label>
            <div className="bg-slate-50 rounded-lg p-3 border space-y-2 text-sm">
              {claim.clearinghouseClaimId && (
                <div className="flex justify-between"><span className="text-slate-500">Claim ID:</span><span className="font-mono">{claim.clearinghouseClaimId}</span></div>
              )}
              {claim.clearinghouseStatus && (
                <div className="flex justify-between"><span className="text-slate-500">Status:</span><Badge variant="outline">{claim.clearinghouseStatus}</Badge></div>
              )}
              {claim.clearinghouseSubmittedAt && (
                <div className="flex justify-between"><span className="text-slate-500">Submitted:</span><span>{new Date(claim.clearinghouseSubmittedAt).toLocaleString()}</span></div>
              )}
            </div>
          </div>
        )}

        {/* Clearinghouse Response */}
        {claim.clearinghouseResponse && (
          <div className="border-t pt-4">
            <Label className="text-slate-700 font-semibold mb-2 block">Clearinghouse Response</Label>
            <pre className="text-xs bg-slate-50 p-3 rounded-lg border overflow-x-auto max-h-48 overflow-y-auto">
              {typeof claim.clearinghouseResponse === 'string'
                ? JSON.stringify(JSON.parse(claim.clearinghouseResponse), null, 2)
                : JSON.stringify(claim.clearinghouseResponse, null, 2)}
            </pre>
          </div>
        )}

        {/* Denial Prediction */}
        {claim.denialPrediction && (
          <div className="border-t pt-4">
            <Label className="text-slate-700 font-semibold mb-2 block">AI Denial Prediction</Label>
            <div className={`rounded-lg p-3 border ${
              claim.denialPrediction.riskLevel === 'high' ? 'bg-red-50 border-red-200' :
              claim.denialPrediction.riskLevel === 'medium' ? 'bg-yellow-50 border-yellow-200' :
              'bg-green-50 border-green-200'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Risk Level</span>
                <Badge className={
                  claim.denialPrediction.riskLevel === 'high' ? 'bg-red-100 text-red-700' :
                  claim.denialPrediction.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-green-100 text-green-700'
                }>
                  {claim.denialPrediction.riskLevel?.toUpperCase()} ({claim.denialPrediction.riskScore}%)
                </Badge>
              </div>
              {claim.denialPrediction.issues?.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-1 mt-2">
                  {claim.denialPrediction.issues.map((issue: any, i: number) => (
                    <li key={i} className="flex items-start gap-1">
                      <AlertCircle className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
                      {typeof issue === 'string' ? issue : issue.description || issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* AI Review Notes */}
        {claim.aiReviewNotes && (
          <div className="border-t pt-4">
            <Label className="text-slate-500 text-xs">AI Review Notes</Label>
            <p className="text-sm mt-1 p-3 bg-blue-50 rounded-lg">{claim.aiReviewNotes}</p>
          </div>
        )}
      </TabsContent>

      {/* TAB 4: Appeals */}
      <TabsContent value="appeals" className="mt-4 space-y-4">
        {claim.status === 'denied' ? (
          <>
            <div className="flex items-center justify-between">
              <Label className="text-slate-700 font-semibold flex items-center gap-2">
                <Scale className="w-4 h-4 text-blue-600" />
                AI Appeal Recommendations
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => regenerateAppealMutation.mutate(claim.id)}
                disabled={regenerateAppealMutation.isPending}
              >
                {regenerateAppealMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                <span className="ml-1">Regenerate</span>
              </Button>
            </div>

            {loadingAppeals ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : appeals.length > 0 ? (
              <div className="space-y-4">
                {appeals.map((appeal: any) => (
                  <div key={appeal.id} className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Badge className={
                          appeal.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          appeal.status === 'sent' ? 'bg-blue-100 text-blue-800' :
                          appeal.status === 'completed' ? 'bg-green-100 text-green-800' :
                          'bg-red-100 text-red-800'
                        }>
                          {appeal.status === 'pending' ? 'Pending' : appeal.status === 'sent' ? 'Sent' : appeal.status === 'completed' ? 'Won' : 'Failed'}
                        </Badge>
                        <Badge variant="outline" className="bg-card">
                          {appeal.parsedNotes?.successProbability || 0}% Success Rate
                        </Badge>
                      </div>
                    </div>
                    {appeal.parsedNotes?.keyArguments && (
                      <div className="mb-3">
                        <p className="text-sm font-medium text-slate-700 mb-1">Key Arguments:</p>
                        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                          {appeal.parsedNotes.keyArguments.slice(0, 3).map((arg: string, i: number) => (
                            <li key={i}>{arg}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {appeal.parsedNotes?.appealLetter && (
                      <Button variant="outline" size="sm" className="w-full mb-2" onClick={() => setShowAppealLetter(!showAppealLetter)}>
                        <FileText className="w-4 h-4 mr-2" />
                        {showAppealLetter ? 'Hide' : 'View'} Appeal Letter
                      </Button>
                    )}
                    {showAppealLetter && appeal.parsedNotes?.appealLetter && (
                      <div className="bg-card rounded-lg p-3 border mb-3">
                        <div className="flex justify-end mb-1">
                          <Button variant="ghost" size="sm" onClick={() => copyAppealLetter(appeal.parsedNotes.appealLetter)}>
                            <Copy className="w-3 h-3 mr-1" /> Copy
                          </Button>
                        </div>
                        <pre className="text-xs whitespace-pre-wrap font-mono bg-slate-50 p-3 rounded max-h-48 overflow-y-auto">
                          {appeal.parsedNotes.appealLetter}
                        </pre>
                      </div>
                    )}
                    <p className="text-xs text-slate-400">
                      Generated: {new Date(appeal.parsedNotes?.generatedAt || appeal.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 bg-slate-50 rounded-lg">
                <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No appeal generated yet</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => regenerateAppealMutation.mutate(claim.id)} disabled={regenerateAppealMutation.isPending}>
                  Generate Appeal
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <Scale className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">Appeals are available for denied claims</p>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

export default function Claims() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [practiceId] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSessionsDialog, setShowSessionsDialog] = useState(false);
  const [showSuperbillDialog, setShowSuperbillDialog] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [showDenyDialog, setShowDenyDialog] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [denialReason, setDenialReason] = useState("");
  const [selectedInsuranceForSession, setSelectedInsuranceForSession] = useState("");
  const [claimAppeals, setClaimAppeals] = useState<any[]>([]);
  const [loadingAppeals, setLoadingAppeals] = useState(false);
  const [showAppealLetter, setShowAppealLetter] = useState(false);
  const [claimLineItems, setClaimLineItems] = useState<any[]>([]);
  const [loadingLineItems, setLoadingLineItems] = useState(false);

  // Denial prediction state
  const [showDenialPrediction, setShowDenialPrediction] = useState(false);
  const [denialPredictionResult, setDenialPredictionResult] = useState<Claim["denialPrediction"]>(null);
  const [predictingDenial, setPredictingDenial] = useState(false);
  const [preSubmitClaimId, setPreSubmitClaimId] = useState<number | null>(null); // set when Submit triggers denial check

  // Batch submission state
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<number>>(new Set());
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    show: boolean;
    total: number;
    succeeded: number;
    failed: number;
    errors: Array<{ claimId: number; error: string }>;
    results: Array<{ claimId: number; claimNumber: string; success: boolean; error?: string }>;
  }>({ show: false, total: 0, succeeded: 0, failed: 0, errors: [], results: [] });

  // Superbill creation state
  const [superbillPatient, setSuperbillPatient] = useState("");
  const [superbillInsurance, setSuperbillInsurance] = useState("");
  const [superbillDate, setSuperbillDate] = useState(new Date().toISOString().split('T')[0]);
  const [superbillLineItems, setSuperbillLineItems] = useState<Array<{
    cptCodeId: string;
    units: number;
    icd10CodeId?: string;
  }>>([{ cptCodeId: "", units: 1 }]);

  const isAdmin = (user as any)?.role === 'admin';
  const isBilling = (user as any)?.role === 'billing';
  const canManageClaims = isAdmin || isBilling;

  const form = useForm<ClaimFormData>({
    resolver: zodResolver(claimSchema),
    defaultValues: {
      patientId: "",
      sessionId: "",
      insuranceId: "",
      totalAmount: "",
      submittedAmount: "",
    },
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: claims, isLoading: claimsLoading } = useQuery<Claim[]>({
    queryKey: [`/api/claims?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  });

  const { data: patients } = useQuery<any[]>({
    queryKey: [`/api/patients?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  });

  const { data: insurances } = useQuery<any[]>({
    queryKey: ['/api/insurances'],
    enabled: isAuthenticated,
    retry: false,
  });

  const { data: cptCodes } = useQuery<any[]>({
    queryKey: ['/api/cpt-codes'],
    enabled: isAuthenticated,
    retry: false,
  });

  const { data: icd10Codes } = useQuery<any[]>({
    queryKey: ['/api/icd10-codes'],
    enabled: isAuthenticated,
    retry: false,
  });

  const { data: unbilledSessions, isLoading: sessionsLoading } = useQuery<any[]>({
    queryKey: [`/api/sessions/unbilled?practiceId=${practiceId}`],
    enabled: isAuthenticated && showSessionsDialog,
    retry: false,
  });

  const generateSuperbillMutation = useMutation({
    mutationFn: async ({ sessionId, insuranceId }: { sessionId: number; insuranceId?: number }) => {
      const response = await apiRequest("POST", `/api/sessions/${sessionId}/generate-claim`, {
        insuranceId: insuranceId || null,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/claims?practiceId=${practiceId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/unbilled?practiceId=${practiceId}`] });
      toast({
        title: "Superbill Generated",
        description: `Claim ${data.claim.claimNumber} created for $${data.superbillDetails.totalAmount}`,
      });
      setShowSessionsDialog(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate superbill",
        variant: "destructive",
      });
    },
  });

  const createSuperbillMutation = useMutation({
    mutationFn: async (data: {
      patientId: number;
      insuranceId?: number;
      dateOfService: string;
      lineItems: Array<{ cptCodeId: number; units: number; icd10CodeId?: number }>;
    }) => {
      const response = await apiRequest("POST", "/api/superbills", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/claims?practiceId=${practiceId}`] });
      toast({
        title: "Superbill Created",
        description: `Claim ${data.claim.claimNumber} created for $${data.totalAmount}`,
      });
      setShowSuperbillDialog(false);
      // Reset form
      setSuperbillPatient("");
      setSuperbillInsurance("");
      setSuperbillDate(new Date().toISOString().split('T')[0]);
      setSuperbillLineItems([{ cptCodeId: "", units: 1 }]);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create superbill",
        variant: "destructive",
      });
    },
  });

  const handleCreateSuperbill = () => {
    if (!superbillPatient) {
      toast({ title: "Error", description: "Please select a patient", variant: "destructive" });
      return;
    }
    const validLineItems = superbillLineItems.filter(item => item.cptCodeId);
    if (validLineItems.length === 0) {
      toast({ title: "Error", description: "Please add at least one CPT code", variant: "destructive" });
      return;
    }

    createSuperbillMutation.mutate({
      patientId: parseInt(superbillPatient),
      insuranceId: superbillInsurance ? parseInt(superbillInsurance) : undefined,
      dateOfService: superbillDate,
      lineItems: validLineItems.map(item => ({
        cptCodeId: parseInt(item.cptCodeId),
        units: item.units,
        icd10CodeId: item.icd10CodeId ? parseInt(item.icd10CodeId) : undefined,
      })),
    });
  };

  const addLineItem = () => {
    setSuperbillLineItems([...superbillLineItems, { cptCodeId: "", units: 1 }]);
  };

  const removeLineItem = (index: number) => {
    if (superbillLineItems.length > 1) {
      setSuperbillLineItems(superbillLineItems.filter((_, i) => i !== index));
    }
  };

  const updateLineItem = (index: number, field: string, value: any) => {
    const updated = [...superbillLineItems];
    updated[index] = { ...updated[index], [field]: value };
    setSuperbillLineItems(updated);
  };

  const calculateSuperbillTotal = () => {
    return superbillLineItems.reduce((total, item) => {
      if (!item.cptCodeId || !cptCodes) return total;
      const cptCode = cptCodes.find((c: any) => c.id === parseInt(item.cptCodeId));
      if (!cptCode) return total;
      return total + (parseFloat(cptCode.baseRate || '289') * item.units);
    }, 0);
  };

  const createClaimMutation = useMutation({
    mutationFn: async (data: ClaimFormData) => {
      const response = await apiRequest("POST", "/api/claims", {
        ...data,
        practiceId,
        totalAmount: parseFloat(data.totalAmount),
        submittedAmount: data.submittedAmount ? parseFloat(data.submittedAmount) : null,
        patientId: parseInt(data.patientId),
        sessionId: data.sessionId ? parseInt(data.sessionId) : null,
        insuranceId: parseInt(data.insuranceId),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      toast({
        title: "Success",
        description: "Claim created successfully with AI review",
      });
      setShowCreateDialog(false);
      form.reset();
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to create claim",
        variant: "destructive",
      });
    },
  });

  const submitClaimMutation = useMutation({
    mutationFn: async (claimId: number) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/submit`, {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      toast({
        title: data.success ? "Success" : "Error",
        description: data.submissionMethod === 'stedi'
          ? "Claim submitted to clearinghouse"
          : data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to submit claim",
        variant: "destructive",
      });
    },
  });

  const batchSubmitClaims = async (claimIds: number[]) => {
    setBatchSubmitting(true);
    setBatchProgress({ show: true, total: claimIds.length, succeeded: 0, failed: 0, errors: [], results: [] });
    try {
      const response = await apiRequest("POST", "/api/claims/batch-submit", { claimIds });
      const data = await response.json();
      setBatchProgress({
        show: true,
        total: data.summary.total,
        succeeded: data.summary.succeeded,
        failed: data.summary.failed,
        errors: data.errors || [],
        results: data.results || [],
      });
      queryClient.invalidateQueries({ queryKey: [`/api/claims?practiceId=${practiceId}`] });
      setSelectedClaimIds(new Set());
      toast({
        title: "Batch Submission Complete",
        description: data.message,
        variant: data.summary.failed > 0 ? "destructive" : "default",
      });
    } catch (error: any) {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      setBatchProgress(prev => ({ ...prev, show: false }));
      toast({
        title: "Error",
        description: error.message || "Failed to submit claims batch",
        variant: "destructive",
      });
    } finally {
      setBatchSubmitting(false);
    }
  };

  const checkStatusMutation = useMutation({
    mutationFn: async (claimId: number) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/check-status`, {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      if (data.statusResult) {
        const status = data.statusResult.status;
        toast({
          title: "Status Updated",
          description: status === 'paid'
            ? `Claim paid: $${data.statusResult.paidAmount?.toFixed(2) || '0.00'}`
            : status === 'denied'
            ? `Claim denied: ${data.statusResult.denialReason || 'No reason provided'}`
            : `Claim status: ${status}`,
        });
      } else {
        toast({
          title: "Status Check",
          description: data.message,
        });
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to check claim status",
        variant: "destructive",
      });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ claimId, paidAmount }: { claimId: number; paidAmount: string }) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/paid`, { paidAmount: parseFloat(paidAmount) });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      toast({
        title: "Success",
        description: "Claim marked as paid",
      });
      setShowPayDialog(false);
      setPaidAmount("");
      setSelectedClaim(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to mark claim as paid",
        variant: "destructive",
      });
    },
  });

  const submitSecondaryMutation = useMutation({
    mutationFn: async (claimId: number) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/submit-secondary`, {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      toast({
        title: "Secondary Claim Created",
        description: `Secondary claim ${data.claim?.claimNumber || ''} created for $${parseFloat(data.claim?.totalAmount || '0').toFixed(2)}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to create secondary claim",
        variant: "destructive",
      });
    },
  });

  const denyClaimMutation = useMutation({
    mutationFn: async ({ claimId, denialReason }: { claimId: number; denialReason: string }) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/deny`, { denialReason });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      if (data.appealGenerated) {
        toast({
          title: "Claim Denied - AI Appeal Generated",
          description: `Success probability: ${data.appeal?.successProbability}%`,
        });
      } else {
        toast({
          title: "Success",
          description: "Claim marked as denied",
        });
      }
      setShowDenyDialog(false);
      setDenialReason("");
      setSelectedClaim(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to deny claim",
        variant: "destructive",
      });
    },
  });

  // Fetch line items for a claim
  const fetchLineItems = async (claimId: number) => {
    setLoadingLineItems(true);
    try {
      const response = await apiRequest("GET", `/api/claims/${claimId}/line-items`);
      const data = await response.json();
      setClaimLineItems(data);
    } catch (error) {
      console.error('Error fetching line items:', error);
      setClaimLineItems([]);
    }
    setLoadingLineItems(false);
  };

  // Fetch appeals for a claim
  const fetchAppeals = async (claimId: number) => {
    setLoadingAppeals(true);
    try {
      const response = await apiRequest("GET", `/api/claims/${claimId}/appeals`);
      const data = await response.json();
      setClaimAppeals(data);
    } catch (error) {
      console.error('Error fetching appeals:', error);
      setClaimAppeals([]);
    }
    setLoadingAppeals(false);
  };

  // Predict denial risk for a claim
  const predictDenialRisk = async (claimId: number) => {
    setPredictingDenial(true);
    try {
      const response = await apiRequest("POST", `/api/claims/${claimId}/predict-denial`);
      const data = await response.json();
      setDenialPredictionResult(data);
      setShowDenialPrediction(true);
      // Refresh claims to pick up stored prediction
      queryClient.invalidateQueries({ queryKey: [`/api/claims?practiceId=${practiceId}`] });
      toast({
        title: "Denial Risk Analysis Complete",
        description: `Risk score: ${data.riskScore}/100 (${data.riskLevel})`,
        variant: data.riskLevel === "high" ? "destructive" : "default",
      });
    } catch (error: any) {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to predict denial risk",
        variant: "destructive",
      });
    }
    setPredictingDenial(false);
  };

  // Mark appeal as sent
  const markAppealSentMutation = useMutation({
    mutationFn: async ({ claimId, appealId }: { claimId: number; appealId: number }) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/appeals/${appealId}/sent`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Appeal marked as sent" });
      if (selectedClaim) fetchAppeals(selectedClaim.id);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update appeal", variant: "destructive" });
    },
  });

  // Mark appeal as completed
  const markAppealCompletedMutation = useMutation({
    mutationFn: async ({ claimId, appealId }: { claimId: number; appealId: number }) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/appeals/${appealId}/completed`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Appeal marked as completed (won)" });
      if (selectedClaim) fetchAppeals(selectedClaim.id);
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update appeal", variant: "destructive" });
    },
  });

  // Mark appeal as failed
  const markAppealFailedMutation = useMutation({
    mutationFn: async ({ claimId, appealId }: { claimId: number; appealId: number }) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/appeals/${appealId}/failed`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Appeal Failed", description: "Appeal marked as unsuccessful", variant: "destructive" });
      if (selectedClaim) fetchAppeals(selectedClaim.id);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update appeal", variant: "destructive" });
    },
  });

  // Regenerate appeal
  const regenerateAppealMutation = useMutation({
    mutationFn: async (claimId: number) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/regenerate-appeal`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "New appeal generated" });
      if (selectedClaim) fetchAppeals(selectedClaim.id);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to regenerate appeal", variant: "destructive" });
    },
  });

  // Copy appeal letter to clipboard
  const copyAppealLetter = (letter: string) => {
    navigator.clipboard.writeText(letter);
    toast({ title: "Copied", description: "Appeal letter copied to clipboard" });
  };

  if (isLoading || claimsLoading) {
    return (
      <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-40 bg-muted animate-pulse rounded" />
            <div className="h-4 w-64 bg-muted animate-pulse rounded mt-2" />
          </div>
          <div className="h-10 w-32 bg-muted animate-pulse rounded" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-4 space-y-2">
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
              <div className="h-7 w-16 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
        <div className="border rounded-lg">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-4 border-b last:border-b-0">
              <div className="flex items-center space-x-3">
                <div className="h-4 w-4 bg-muted animate-pulse rounded-full" />
                <div>
                  <div className="h-4 w-24 bg-muted animate-pulse rounded mb-1" />
                  <div className="h-3 w-36 bg-muted animate-pulse rounded" />
                </div>
              </div>
              <div className="h-6 w-16 bg-muted animate-pulse rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const getClaimStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'submitted':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'denied':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-slate-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
      submitted: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100',
      paid: 'bg-green-100 text-green-700 hover:bg-green-100',
      denied: 'bg-red-100 text-red-700 hover:bg-red-100',
    };
    return styles[status] || styles.draft;
  };

  const getAiScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50';
    if (score >= 60) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getDenialRiskColor = (score: number) => {
    if (score < 30) return { bg: 'bg-green-500', text: 'text-green-700', light: 'bg-green-50 border-green-200' };
    if (score < 70) return { bg: 'bg-yellow-500', text: 'text-yellow-700', light: 'bg-yellow-50 border-yellow-200' };
    return { bg: 'bg-red-500', text: 'text-red-700', light: 'bg-red-50 border-red-200' };
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />;
      case 'high':
        return <CircleAlert className="w-4 h-4 text-orange-500 flex-shrink-0" />;
      case 'medium':
        return <TriangleAlert className="w-4 h-4 text-yellow-500 flex-shrink-0" />;
      default:
        return <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />;
    }
  };

  const getSeverityBadgeColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-200';
    }
  };

  const filteredClaims = claims?.filter((claim) => {
    const patient = patients?.find(p => p.id === claim.patientId);
    const matchesSearch = claim.claimNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         patient?.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         patient?.lastName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || claim.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  // Calculate summary stats
  const stats = {
    total: claims?.length || 0,
    draft: claims?.filter(c => c.status === 'draft').length || 0,
    submitted: claims?.filter(c => c.status === 'submitted').length || 0,
    paid: claims?.filter(c => c.status === 'paid').length || 0,
    denied: claims?.filter(c => c.status === 'denied').length || 0,
    totalAmount: claims?.reduce((sum, c) => sum + parseFloat(c.totalAmount || '0'), 0) || 0,
    paidAmount: claims?.filter(c => c.status === 'paid').reduce((sum, c) => sum + parseFloat(c.paidAmount || '0'), 0) || 0,
    pendingAmount: claims?.filter(c => c.status === 'submitted').reduce((sum, c) => sum + parseFloat(c.totalAmount || '0'), 0) || 0,
  };

  const getPatientName = (patientId: number) => {
    const patient = patients?.find(p => p.id === patientId);
    return patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown';
  };

  const getInsuranceName = (insuranceId: number) => {
    const insurance = insurances?.find(i => i.id === insuranceId);
    return insurance?.name || 'Unknown';
  };

  const onSubmit = (data: ClaimFormData) => {
    createClaimMutation.mutate(data);
  };

  // Batch selection helpers
  const draftClaims = filteredClaims.filter(c => c.status === 'draft');
  const allDraftSelected = draftClaims.length > 0 && draftClaims.every(c => selectedClaimIds.has(c.id));
  const someDraftSelected = draftClaims.some(c => selectedClaimIds.has(c.id));

  const toggleClaimSelection = (claimId: number) => {
    setSelectedClaimIds(prev => {
      const next = new Set(prev);
      if (next.has(claimId)) {
        next.delete(claimId);
      } else {
        next.add(claimId);
      }
      return next;
    });
  };

  const toggleSelectAllDraft = () => {
    if (allDraftSelected) {
      // Deselect all draft claims
      setSelectedClaimIds(prev => {
        const next = new Set(prev);
        draftClaims.forEach(c => next.delete(c.id));
        return next;
      });
    } else {
      // Select all draft claims
      setSelectedClaimIds(prev => {
        const next = new Set(prev);
        draftClaims.forEach(c => next.add(c.id));
        return next;
      });
    }
  };

  const handleBatchSubmit = () => {
    const ids = Array.from(selectedClaimIds).filter(id => {
      const claim = filteredClaims.find(c => c.id === id);
      return claim && claim.status === 'draft';
    });
    if (ids.length === 0) {
      toast({ title: "No Draft Claims Selected", description: "Select draft claims to submit", variant: "destructive" });
      return;
    }
    batchSubmitClaims(ids);
  };

  const handleViewClaim = (claim: Claim) => {
    setSelectedClaim(claim);
    setShowDetailDialog(true);
    setShowAppealLetter(false);
    // Always fetch line items
    fetchLineItems(claim.id);
    // Fetch appeals for denied claims
    if (claim.status === 'denied') {
      fetchAppeals(claim.id);
    } else {
      setClaimAppeals([]);
    }
  };

  const handleMarkPaid = (claim: Claim) => {
    setSelectedClaim(claim);
    setPaidAmount(claim.totalAmount);
    setShowPayDialog(true);
  };

  const handleDenyClaim = (claim: Claim) => {
    setSelectedClaim(claim);
    setShowDenyDialog(true);
  };

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 md:mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Claims Management</h1>
          <p className="text-sm md:text-base text-muted-foreground">Create, track, and manage insurance claims</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 -mx-1 px-1">
          <Button
            variant="outline"
            className="min-h-[44px] whitespace-nowrap text-xs md:text-sm flex-shrink-0"
            onClick={() => {
              if (!filteredClaims || filteredClaims.length === 0) {
                toast({ title: "No Claims", description: "No claims to export with current filters.", variant: "destructive" });
                return;
              }
              const rows = filteredClaims.map((c) => ({
                claimNumber: c.claimNumber,
                patient: getPatientName(c.patientId),
                insurance: getInsuranceName(c.insuranceId),
                status: c.status,
                totalAmount: c.totalAmount,
                submittedAmount: c.submittedAmount || "",
                paidAmount: c.paidAmount || "",
                createdAt: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "",
                submittedAt: c.submittedAt ? new Date(c.submittedAt).toLocaleDateString() : "",
                paidAt: c.paidAt ? new Date(c.paidAt).toLocaleDateString() : "",
                denialReason: c.denialReason || "",
                billingOrder: c.billingOrder || "primary",
              }));
              exportToCsv(`claims-export-${new Date().toISOString().split("T")[0]}.csv`, rows);
              toast({ title: "Export Complete", description: `Exported ${rows.length} claims to CSV.` });
            }}
          >
            <Download className="w-4 h-4 mr-1 md:mr-2" />
            <span className="hidden sm:inline">Export Claims</span>
            <span className="sm:hidden">Export</span>
          </Button>
          <Button variant="outline" onClick={() => setShowSessionsDialog(true)} className="min-h-[44px] whitespace-nowrap text-xs md:text-sm flex-shrink-0">
            <FileText className="w-4 h-4 mr-1 md:mr-2" />
            <span className="hidden sm:inline">Generate from Session</span>
            <span className="sm:hidden">From Session</span>
          </Button>
          <Button variant="outline" onClick={() => setShowSuperbillDialog(true)} className="min-h-[44px] whitespace-nowrap text-xs md:text-sm flex-shrink-0">
            <DollarSign className="w-4 h-4 mr-1 md:mr-2" />
            Superbill
          </Button>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button className="min-h-[44px] whitespace-nowrap text-xs md:text-sm flex-shrink-0">
                <Plus className="w-4 h-4 mr-1 md:mr-2" />
                New Claim
              </Button>
            </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Claim</DialogTitle>
              <DialogDescription>
                Create a new insurance claim with AI-powered review
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="patientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Patient</FormLabel>
                      <FormControl>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select patient" />
                          </SelectTrigger>
                          <SelectContent>
                            {patients?.map((patient) => (
                              <SelectItem key={patient.id} value={patient.id.toString()}>
                                {patient.firstName} {patient.lastName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="insuranceId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurance Provider</FormLabel>
                      <FormControl>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select insurance" />
                          </SelectTrigger>
                          <SelectContent>
                            {insurances?.map((insurance) => (
                              <SelectItem key={insurance.id} value={insurance.id.toString()}>
                                {insurance.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="totalAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Amount ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createClaimMutation.isPending}>
                    {createClaimMutation.isPending ? "Creating..." : "Create Claim"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Generate from Session Dialog */}
      <Dialog open={showSessionsDialog} onOpenChange={setShowSessionsDialog}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Superbill from Session</DialogTitle>
            <DialogDescription>
              Select a completed session to automatically generate a claim/superbill
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {sessionsLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
                <p className="text-muted-foreground mt-2">Loading sessions...</p>
              </div>
            ) : unbilledSessions && unbilledSessions.length > 0 ? (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {unbilledSessions.map((session: any) => (
                  <Card key={session.id} className="cursor-pointer hover:border-blue-300 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">
                              {session.patient?.firstName} {session.patient?.lastName}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {new Date(session.sessionDate).toLocaleDateString()}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            <span className="font-mono bg-slate-100 px-1 rounded">
                              {session.cptCode?.code}
                            </span>
                            {" - "}
                            {session.cptCode?.description}
                          </div>
                          <div className="text-sm text-slate-500 mt-1">
                            {session.units || 1} unit(s) × ${session.cptCode?.baseRate || '0'} =
                            <span className="font-medium text-green-600 ml-1">
                              ${((session.units || 1) * parseFloat(session.cptCode?.baseRate || '0')).toFixed(2)}
                            </span>
                          </div>
                          {session.icd10Code && (
                            <div className="text-xs text-slate-400 mt-1">
                              Dx: {session.icd10Code.code} - {session.icd10Code.description}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 ml-4">
                          <Select
                            value={selectedInsuranceForSession}
                            onValueChange={setSelectedInsuranceForSession}
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue placeholder="Insurance" />
                            </SelectTrigger>
                            <SelectContent>
                              {insurances?.map((ins: any) => (
                                <SelectItem key={ins.id} value={ins.id.toString()}>
                                  {ins.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            onClick={() => generateSuperbillMutation.mutate({
                              sessionId: session.id,
                              insuranceId: selectedInsuranceForSession ? parseInt(selectedInsuranceForSession) : undefined,
                            })}
                            disabled={generateSuperbillMutation.isPending}
                          >
                            {generateSuperbillMutation.isPending ? "Generating..." : "Generate"}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                <p className="text-muted-foreground">All sessions have been billed!</p>
                <p className="text-sm text-slate-400 mt-1">
                  Complete a new session to generate a superbill
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Superbill Dialog */}
      <Dialog open={showSuperbillDialog} onOpenChange={setShowSuperbillDialog}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Superbill</DialogTitle>
            <DialogDescription>
              Create a superbill with multiple CPT codes for billing
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Patient and Insurance Selection */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Patient *</Label>
                <Select value={superbillPatient} onValueChange={setSuperbillPatient}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select patient" />
                  </SelectTrigger>
                  <SelectContent>
                    {patients?.map((patient) => (
                      <SelectItem key={patient.id} value={patient.id.toString()}>
                        {patient.firstName} {patient.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Insurance</Label>
                <Select value={superbillInsurance} onValueChange={setSuperbillInsurance}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select insurance (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {insurances?.map((insurance) => (
                      <SelectItem key={insurance.id} value={insurance.id.toString()}>
                        {insurance.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Date of Service</Label>
              <Input
                type="date"
                value={superbillDate}
                onChange={(e) => setSuperbillDate(e.target.value)}
              />
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>CPT Codes (Line Items)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Code
                </Button>
              </div>
              <div className="space-y-3">
                {superbillLineItems.map((item, index) => (
                  <div key={index} className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
                    <div className="flex-1">
                      <Select
                        value={item.cptCodeId}
                        onValueChange={(value) => updateLineItem(index, 'cptCodeId', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select CPT code" />
                        </SelectTrigger>
                        <SelectContent>
                          {cptCodes?.map((cpt) => (
                            <SelectItem key={cpt.id} value={cpt.id.toString()}>
                              {cpt.code} - {cpt.description} (${cpt.baseRate})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20">
                      <Input
                        type="number"
                        min="1"
                        value={item.units}
                        onChange={(e) => updateLineItem(index, 'units', parseInt(e.target.value) || 1)}
                        placeholder="Units"
                      />
                    </div>
                    <div className="flex-1">
                      <Select
                        value={item.icd10CodeId || ""}
                        onValueChange={(value) => updateLineItem(index, 'icd10CodeId', value || undefined)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="ICD-10 (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          {icd10Codes?.map((icd) => (
                            <SelectItem key={icd.id} value={icd.id.toString()}>
                              {icd.code} - {icd.description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24 text-right font-medium">
                      ${item.cptCodeId && cptCodes
                        ? ((cptCodes.find((c: any) => c.id === parseInt(item.cptCodeId))?.baseRate || 0) * item.units).toFixed(2)
                        : '0.00'}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLineItem(index)}
                      disabled={superbillLineItems.length === 1}
                    >
                      <XCircle className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="flex justify-end items-center gap-4 p-4 bg-green-50 rounded-lg">
              <span className="font-medium text-slate-700">Total:</span>
              <span className="text-2xl font-bold text-green-600">
                ${calculateSuperbillTotal().toFixed(2)}
              </span>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSuperbillDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateSuperbill}
                disabled={createSuperbillMutation.isPending}
              >
                {createSuperbillMutation.isPending ? "Creating..." : "Create Superbill"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AiDisclaimerBanner />

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-6">
        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Claims</p>
                <p className="text-xl md:text-2xl font-bold">{stats.total}</p>
              </div>
              <div className="p-2 bg-slate-100 rounded-lg">
                <FileText className="w-5 h-5 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Pending</p>
                <p className="text-xl md:text-2xl font-bold text-yellow-600">{stats.submitted}</p>
              </div>
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="w-5 h-5 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Paid Amount</p>
                <p className="text-lg md:text-2xl font-bold text-green-600">${stats.paidAmount.toFixed(2)}</p>
              </div>
              <div className="p-2 bg-green-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Success Rate</p>
                <p className="text-xl md:text-2xl font-bold text-blue-600">
                  {stats.total > 0 ? ((stats.paid / stats.total) * 100).toFixed(0) : 0}%
                </p>
              </div>
              <div className="p-2 bg-blue-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter - sticky on mobile */}
      <div className="sticky top-14 md:static z-20 bg-background -mx-4 px-4 py-2 md:mx-0 md:px-0 md:py-0 border-b md:border-b-0 border-border mb-3 md:mb-6">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 md:gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="Search claims..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 min-h-[44px]"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-44 min-h-[44px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft ({stats.draft})</SelectItem>
            <SelectItem value="submitted">Submitted ({stats.submitted})</SelectItem>
            <SelectItem value="paid">Paid ({stats.paid})</SelectItem>
            <SelectItem value="denied">Denied ({stats.denied})</SelectItem>
          </SelectContent>
        </Select>
        </div>
      </div>

      {/* Batch Actions Bar - sticky at bottom on mobile when items selected */}
      {draftClaims.length > 0 && (
        <div className={`flex flex-wrap items-center gap-2 md:gap-4 mb-3 md:mb-4 p-3 bg-slate-50 rounded-lg border ${selectedClaimIds.size > 0 ? 'fixed bottom-16 md:bottom-auto left-4 right-4 md:static z-30 shadow-lg md:shadow-none' : ''}`}>
          <div className="flex items-center gap-2">
            <Checkbox
              id="select-all-draft"
              checked={allDraftSelected ? true : someDraftSelected ? "indeterminate" : false}
              onCheckedChange={toggleSelectAllDraft}
            />
            <Label htmlFor="select-all-draft" className="text-sm font-medium cursor-pointer">
              Select All Draft ({draftClaims.length})
            </Label>
          </div>
          {selectedClaimIds.size > 0 && (
            <>
              <span className="text-sm text-slate-500">
                {selectedClaimIds.size} claim{selectedClaimIds.size !== 1 ? 's' : ''} selected
              </span>
              <Button
                size="sm"
                onClick={handleBatchSubmit}
                disabled={batchSubmitting}
              >
                {batchSubmitting ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-1" />
                )}
                Submit Selected ({selectedClaimIds.size})
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedClaimIds(new Set())}
              >
                Clear Selection
              </Button>
            </>
          )}
        </div>
      )}

      {/* Batch Progress */}
      {batchProgress.show && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">Batch Submission Results</h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBatchProgress(prev => ({ ...prev, show: false }))}
              >
                Dismiss
              </Button>
            </div>
            <Progress
              value={batchProgress.total > 0 ? ((batchProgress.succeeded + batchProgress.failed) / batchProgress.total) * 100 : 0}
              className="mb-3"
            />
            <div className="flex gap-4 text-sm">
              <span className="text-muted-foreground">Total: {batchProgress.total}</span>
              <span className="text-green-600">Succeeded: {batchProgress.succeeded}</span>
              <span className="text-red-600">Failed: {batchProgress.failed}</span>
            </div>
            {batchProgress.errors.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-sm font-medium text-red-700">Validation Errors:</p>
                {batchProgress.errors.map((err, idx) => (
                  <p key={idx} className="text-xs text-red-600">
                    Claim #{err.claimId}: {err.error}
                  </p>
                ))}
              </div>
            )}
            {batchProgress.results.filter(r => !r.success).length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-sm font-medium text-red-700">Submission Errors:</p>
                {batchProgress.results.filter(r => !r.success).map((r, idx) => (
                  <p key={idx} className="text-xs text-red-600">
                    {r.claimNumber}: {r.error || 'Submission failed'}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Claims List */}
      <div className="space-y-3">
        {filteredClaims.length > 0 ? (
          filteredClaims.map((claim) => (
            <Card key={claim.id} className={`hover:shadow-md transition-shadow ${selectedClaimIds.has(claim.id) ? 'ring-2 ring-blue-300 bg-blue-50/30' : ''}`}>
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left: Claim Info */}
                  <div className="flex items-start gap-3">
                    {claim.status === 'draft' && (
                      <div className="flex items-center pt-1">
                        <Checkbox
                          checked={selectedClaimIds.has(claim.id)}
                          onCheckedChange={() => toggleClaimSelection(claim.id)}
                        />
                      </div>
                    )}
                    <div className="p-2 bg-slate-100 rounded-lg">
                      {getClaimStatusIcon(claim.status)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">{claim.claimNumber}</h3>
                        <Badge variant="secondary" className={getStatusBadge(claim.status)}>
                          {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                        </Badge>
                        {claim.billingOrder === 'secondary' && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                            Secondary
                          </Badge>
                        )}
                        {claim.billingOrder === 'primary' && claims?.some((c: Claim) => c.primaryClaimId === claim.id) && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            Primary
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {getPatientName(claim.patientId)} • {getInsuranceName(claim.insuranceId)}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Created {new Date(claim.createdAt).toLocaleDateString()}
                        {claim.submittedAt && ` • Submitted ${new Date(claim.submittedAt).toLocaleDateString()}`}
                        {claim.paidAt && ` • Paid ${new Date(claim.paidAt).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>

                  {/* Right: Amount, AI Score, Actions */}
                  <div className="flex items-center gap-4">
                    {/* Amount */}
                    <div className="text-right">
                      <p className="font-semibold text-lg">${parseFloat(claim.totalAmount).toFixed(2)}</p>
                      {claim.paidAmount && (
                        <p className="text-sm text-green-600">
                          Paid: ${parseFloat(claim.paidAmount).toFixed(2)}
                        </p>
                      )}
                    </div>

                    {/* AI Score */}
                    {claim.aiReviewScore && (
                      <div className={`px-3 py-1 rounded-lg text-center ${getAiScoreColor(parseFloat(claim.aiReviewScore))}`}>
                        <p className="font-bold text-lg">{parseFloat(claim.aiReviewScore).toFixed(0)}</p>
                        <p className="text-xs">AI Score</p>
                      </div>
                    )}

                    {/* Denial Risk Badge */}
                    {claim.denialPrediction && (
                      <div
                        className={`px-3 py-1 rounded-lg text-center cursor-pointer ${getDenialRiskColor(claim.denialPrediction.riskScore).light} border`}
                        onClick={() => {
                          setSelectedClaim(claim);
                          setDenialPredictionResult(claim.denialPrediction);
                          setShowDenialPrediction(true);
                        }}
                        title="Click to view denial risk details"
                      >
                        <p className={`font-bold text-lg ${getDenialRiskColor(claim.denialPrediction.riskScore).text}`}>
                          {claim.denialPrediction.riskScore}
                        </p>
                        <p className="text-xs text-muted-foreground">Risk</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {claim.status === 'draft' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedClaim(claim);
                              predictDenialRisk(claim.id);
                            }}
                            disabled={predictingDenial}
                          >
                            {predictingDenial ? (
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            ) : (
                              <ShieldAlert className="w-4 h-4 mr-1" />
                            )}
                            Check Risk
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedClaim(claim);
                              setPreSubmitClaimId(claim.id);
                              predictDenialRisk(claim.id);
                            }}
                            disabled={submitClaimMutation.isPending || predictingDenial}
                          >
                            {predictingDenial && preSubmitClaimId === claim.id ? (
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4 mr-1" />
                            )}
                            Submit
                          </Button>
                        </>
                      )}

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleViewClaim(claim)}>
                            <Eye className="w-4 h-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedClaim(claim);
                              setLoadingLineItems(true);
                              fetch(`/api/claims/${claim.id}/line-items`, { credentials: "include" })
                                .then(r => r.ok ? r.json() : [])
                                .then(items => {
                                  setClaimLineItems(items);
                                  setLoadingLineItems(false);
                                  setTimeout(() => {
                                    const btn = document.getElementById("superbill-print-trigger");
                                    if (btn) btn.click();
                                  }, 100);
                                })
                                .catch(() => setLoadingLineItems(false));
                            }}
                          >
                            <Printer className="w-4 h-4 mr-2" />
                            Print Superbill
                          </DropdownMenuItem>
                          {claim.status === 'submitted' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => checkStatusMutation.mutate(claim.id)}
                                disabled={checkStatusMutation.isPending}
                              >
                                <RefreshCw className={`w-4 h-4 mr-2 ${checkStatusMutation.isPending ? 'animate-spin' : ''}`} />
                                Check Status
                              </DropdownMenuItem>
                              {canManageClaims && (
                                <>
                                  <DropdownMenuItem onClick={() => handleMarkPaid(claim)}>
                                    <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
                                    Mark as Paid
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDenyClaim(claim)}>
                                    <Ban className="w-4 h-4 mr-2 text-red-600" />
                                    Deny Claim
                                  </DropdownMenuItem>
                                </>
                              )}
                            </>
                          )}
                          {claim.status === 'paid' && claim.billingOrder !== 'secondary' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => submitSecondaryMutation.mutate(claim.id)}
                                disabled={submitSecondaryMutation.isPending}
                              >
                                <Copy className="w-4 h-4 mr-2 text-purple-600" />
                                Submit to Secondary
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>

                {/* AI Review Notes */}
                {claim.aiReviewNotes && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <p className="text-sm text-blue-800">
                      <strong>AI Review:</strong> {claim.aiReviewNotes}
                    </p>
                  </div>
                )}

                {/* Denial Reason */}
                {claim.denialReason && (
                  <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-100">
                    <p className="text-sm text-red-800">
                      <strong>Denial Reason:</strong> {claim.denialReason}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="p-12">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                {searchTerm || statusFilter !== "all" ? (
                  <>
                    <h3 className="text-lg font-semibold mb-2">No claims match your filters</h3>
                    <p className="text-muted-foreground mb-6 max-w-md">
                      Try adjusting your search term or status filter to find what you're looking for.
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-semibold mb-2">Create your first claim</h3>
                    <p className="text-muted-foreground mb-4 max-w-md">
                      Claims are how you bill insurance for patient sessions. Once created, you can:
                    </p>
                    <ul className="text-muted-foreground text-sm mb-6 space-y-1">
                      <li>Submit claims electronically to payers</li>
                      <li>Track payment status and denied claims</li>
                    </ul>
                    <Button onClick={() => setShowCreateDialog(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Your First Claim
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Claim Detail Dialog - full-screen on mobile */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              Claim {selectedClaim?.claimNumber}
              {selectedClaim && (
                <Badge className={getStatusBadge(selectedClaim.status)}>
                  {selectedClaim.status.charAt(0).toUpperCase() + selectedClaim.status.slice(1)}
                </Badge>
              )}
              {selectedClaim?.billingOrder === 'secondary' && (
                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Secondary</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedClaim && `${getPatientName(selectedClaim.patientId)} · ${getInsuranceName(selectedClaim.insuranceId)}`}
            </DialogDescription>
          </DialogHeader>
          {selectedClaim && (
            <ClaimFullDetail
              claim={selectedClaim}
              lineItems={claimLineItems}
              loadingLineItems={loadingLineItems}
              appeals={claimAppeals}
              loadingAppeals={loadingAppeals}
              getPatientName={getPatientName}
              getInsuranceName={getInsuranceName}
              getStatusBadge={getStatusBadge}
              submitSecondaryMutation={submitSecondaryMutation}
              regenerateAppealMutation={regenerateAppealMutation}
            />

          )}
        </DialogContent>
      </Dialog>

      {/* Mark as Paid Dialog */}
      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Mark Claim as Paid</DialogTitle>
            <DialogDescription>
              Enter the amount received for {selectedClaim?.claimNumber}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Paid Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPayDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => selectedClaim && markPaidMutation.mutate({ claimId: selectedClaim.id, paidAmount })}
                disabled={markPaidMutation.isPending || !paidAmount}
              >
                {markPaidMutation.isPending ? "Saving..." : "Mark as Paid"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deny Claim Dialog */}
      <Dialog open={showDenyDialog} onOpenChange={setShowDenyDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Deny Claim</DialogTitle>
            <DialogDescription>
              Enter the reason for denying {selectedClaim?.claimNumber}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Denial Reason</Label>
              <Input
                value={denialReason}
                onChange={(e) => setDenialReason(e.target.value)}
                placeholder="Enter reason for denial"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowDenyDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => selectedClaim && denyClaimMutation.mutate({ claimId: selectedClaim.id, denialReason })}
                disabled={denyClaimMutation.isPending || !denialReason}
              >
                {denyClaimMutation.isPending ? "Saving..." : "Deny Claim"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Denial Risk Prediction Dialog */}
      <Dialog open={showDenialPrediction} onOpenChange={(open) => {
        setShowDenialPrediction(open);
        if (!open) setPreSubmitClaimId(null);
      }}>
        <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" />
              {preSubmitClaimId ? 'Pre-Submission Denial Risk Check' : 'Denial Risk Analysis'}
            </DialogTitle>
            <DialogDescription>
              {selectedClaim?.claimNumber} - {preSubmitClaimId ? 'Review risk factors before submitting this claim' : 'AI-powered denial prediction'}
            </DialogDescription>
          </DialogHeader>

          {predictingDenial ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
              <p className="text-sm text-muted-foreground">Analyzing claim for denial risk...</p>
              <p className="text-xs text-slate-400 mt-1">Checking CPT/ICD codes, documentation, and payer patterns</p>
            </div>
          ) : denialPredictionResult ? (
            <div className="space-y-5">
              {/* Pre-submission warning for high risk */}
              {preSubmitClaimId && denialPredictionResult.riskLevel === 'high' && (
                <div className="bg-red-50 border border-red-300 rounded-lg p-3 flex items-start gap-2">
                  <CircleAlert className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-900 text-sm">High denial risk detected</p>
                    <p className="text-xs text-red-700 mt-0.5">
                      This claim has a high likelihood of denial. Review the issues below and consider fixing them before submitting.
                    </p>
                  </div>
                </div>
              )}
              {preSubmitClaimId && denialPredictionResult.riskLevel === 'low' && (
                <div className="bg-green-50 border border-green-300 rounded-lg p-3 flex items-start gap-2">
                  <ShieldCheck className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-green-900 text-sm">Claim looks good to submit</p>
                    <p className="text-xs text-green-700 mt-0.5">
                      No significant denial risks were found. You can proceed with submission.
                    </p>
                  </div>
                </div>
              )}
              {/* Risk Score Gauge */}
              <div className={`rounded-lg border p-4 ${getDenialRiskColor(denialPredictionResult.riskScore).light}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {denialPredictionResult.riskScore < 30 ? (
                      <ShieldCheck className="w-6 h-6 text-green-600" />
                    ) : denialPredictionResult.riskScore < 70 ? (
                      <TriangleAlert className="w-6 h-6 text-yellow-600" />
                    ) : (
                      <ShieldAlert className="w-6 h-6 text-red-600" />
                    )}
                    <div>
                      <p className="font-semibold text-lg">
                        Risk Score: {denialPredictionResult.riskScore}/100
                      </p>
                      <p className="text-sm capitalize">
                        {denialPredictionResult.riskLevel} Risk
                      </p>
                    </div>
                  </div>
                  <div className={`text-3xl font-bold ${getDenialRiskColor(denialPredictionResult.riskScore).text}`}>
                    {denialPredictionResult.riskScore}
                  </div>
                </div>
                {/* Score bar */}
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getDenialRiskColor(denialPredictionResult.riskScore).bg}`}
                    style={{ width: `${denialPredictionResult.riskScore}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>Low Risk</span>
                  <span>Medium</span>
                  <span>High Risk</span>
                </div>
              </div>

              {/* Overall Recommendation */}
              <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
                <div className="flex items-start gap-2">
                  <Lightbulb className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-blue-900 text-sm">Recommendation</p>
                    <p className="text-sm text-blue-800 mt-1">{denialPredictionResult.overallRecommendation}</p>
                  </div>
                </div>
              </div>

              {/* Issues List */}
              {denialPredictionResult.issues.length > 0 ? (
                <div>
                  <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Identified Issues ({denialPredictionResult.issues.length})
                  </h4>
                  <div className="space-y-3">
                    {denialPredictionResult.issues
                      .sort((a, b) => {
                        const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
                        return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
                      })
                      .map((issue, index) => (
                        <div
                          key={index}
                          className="border rounded-lg p-3 bg-card"
                        >
                          <div className="flex items-start gap-2">
                            {getSeverityIcon(issue.severity)}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm text-foreground">
                                  {issue.category}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={`text-xs ${getSeverityBadgeColor(issue.severity)}`}
                                >
                                  {issue.severity}
                                </Badge>
                              </div>
                              <p className="text-sm text-slate-700 mt-1">{issue.description}</p>
                              <div className="mt-2 flex items-start gap-1.5 bg-slate-50 rounded p-2">
                                <Lightbulb className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-muted-foreground">{issue.suggestion}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 bg-green-50 rounded-lg border border-green-200">
                  <ShieldCheck className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-green-800">No issues detected</p>
                  <p className="text-xs text-green-600 mt-1">This claim looks good to submit</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex justify-between items-center pt-2 border-t">
                <p className="text-xs text-slate-400">
                  Analyzed: {new Date(denialPredictionResult.analyzedAt).toLocaleString()}
                </p>
                <div className="flex gap-2">
                  {selectedClaim && !preSubmitClaimId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => predictDenialRisk(selectedClaim.id)}
                      disabled={predictingDenial}
                    >
                      <RefreshCw className={`w-4 h-4 mr-1 ${predictingDenial ? 'animate-spin' : ''}`} />
                      Re-check
                    </Button>
                  )}
                  {preSubmitClaimId ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPreSubmitClaimId(null);
                          setShowDenialPrediction(false);
                        }}
                      >
                        Go Back to Fix
                      </Button>
                      <Button
                        size="sm"
                        variant={denialPredictionResult.riskLevel === 'high' ? 'destructive' : 'default'}
                        onClick={() => {
                          submitClaimMutation.mutate(preSubmitClaimId);
                          setPreSubmitClaimId(null);
                          setShowDenialPrediction(false);
                        }}
                        disabled={submitClaimMutation.isPending}
                      >
                        {submitClaimMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4 mr-1" />
                        )}
                        {denialPredictionResult.riskLevel === 'high' ? 'Submit Anyway' : 'Submit Claim'}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => setShowDenialPrediction(false)}
                    >
                      Close
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <ShieldAlert className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No prediction data available</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hidden Superbill Print Trigger */}
      <div style={{ display: "none" }}>
        <PrintLayout
          trigger={
            <button id="superbill-print-trigger" type="button">Print Superbill</button>
          }
          title="Superbill"
          practiceName="TherapyBill Practice"
        >
          {selectedClaim && (
            <SuperbillPrintView
              claimNumber={selectedClaim.claimNumber}
              serviceDate={selectedClaim.createdAt}
              providerName="Rendering Provider"
              patientName={getPatientName(selectedClaim.patientId)}
              insuranceName={getInsuranceName(selectedClaim.insuranceId)}
              diagnosisCodes={
                claimLineItems
                  .filter((li: any) => li.icd10Code)
                  .map((li: any) => ({
                    code: li.icd10Code || "",
                    description: li.icd10Description || li.icd10Code || "",
                  }))
              }
              lineItems={
                claimLineItems.map((li: any) => ({
                  cptCode: li.cptCode || "",
                  modifier: li.modifier || null,
                  description: li.description || li.cptCode || "",
                  units: li.units || 1,
                  chargeAmount: li.chargeAmount || li.unitCharge || "0",
                  icd10Pointer: li.icd10Pointer || "A",
                }))
              }
              totalAmount={selectedClaim.totalAmount}
            />
          )}
        </PrintLayout>
      </div>
    </div>
  );
}

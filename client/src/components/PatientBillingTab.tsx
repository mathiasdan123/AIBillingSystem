import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DollarSign,
  FileText,
  Send,
  Plus,
  Loader2,
  CreditCard,
  Clock,
  CheckCircle,
  AlertCircle,
  Printer,
  Download,
} from "lucide-react";
import PrintLayout from "@/components/PrintLayout";
import InvoicePrintView from "@/components/InvoicePrintView";

interface PatientBillingTabProps {
  patientId: number;
  patientName: string;
}

interface Statement {
  id: number;
  statementNumber: string;
  statementDate: string;
  dueDate: string | null;
  totalAmount: string;
  paidAmount: string;
  balanceDue: string;
  status: string;
  sentVia: string | null;
  sentAt: string | null;
  lineItems: Array<{
    description: string;
    serviceDate: string | null;
    cptCode: string | null;
    chargeAmount: string;
    insurancePaid: string;
    adjustments: string;
    patientResponsibility: string;
  }>;
}

interface Payment {
  id: number;
  amount: string;
  paymentMethod: string;
  paymentDate: string;
  referenceNumber: string | null;
  notes: string | null;
  statementId: number | null;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "paid":
      return <Badge className="bg-green-100 text-green-700"><CheckCircle className="w-3 h-3 mr-1" />Paid</Badge>;
    case "sent":
      return <Badge className="bg-blue-100 text-blue-700"><Send className="w-3 h-3 mr-1" />Sent</Badge>;
    case "overdue":
      return <Badge className="bg-red-100 text-red-700"><AlertCircle className="w-3 h-3 mr-1" />Overdue</Badge>;
    case "viewed":
      return <Badge className="bg-purple-100 text-purple-700"><FileText className="w-3 h-3 mr-1" />Viewed</Badge>;
    case "pending":
    default:
      return <Badge className="bg-yellow-100 text-yellow-700"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  }
}

export default function PatientBillingTab({ patientId, patientName }: PatientBillingTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentStatementId, setPaymentStatementId] = useState<number | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [expandedStatement, setExpandedStatement] = useState<number | null>(null);

  // Fetch statements
  const { data: statements, isLoading: statementsLoading } = useQuery<Statement[]>({
    queryKey: [`/api/patients/${patientId}/statements`],
    enabled: !!patientId,
  });

  // Fetch payments
  const { data: payments, isLoading: paymentsLoading } = useQuery<Payment[]>({
    queryKey: [`/api/patients/${patientId}/payments`],
    enabled: !!patientId,
  });

  // Fetch balance
  const { data: balanceData } = useQuery<{
    patientId: number;
    balance: { totalCharges: number; totalPayments: number; totalAdjustments: number; currentBalance: number };
  }>({
    queryKey: [`/api/patients/${patientId}/balance`],
    enabled: !!patientId,
  });

  // Generate statement mutation
  const generateStatementMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/patients/${patientId}/statements/generate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/statements`] });
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/balance`] });
      toast({ title: "Statement Generated", description: "A new statement has been created from unpaid claim balances." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to generate statement", variant: "destructive" });
    },
  });

  // Send statement mutation
  const sendStatementMutation = useMutation({
    mutationFn: async ({ statementId, method }: { statementId: number; method: string }) => {
      const res = await apiRequest("POST", `/api/patients/${patientId}/statements/${statementId}/send`, { method });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/statements`] });
      toast({ title: "Statement Sent", description: "Statement has been marked as sent." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to send statement", variant: "destructive" });
    },
  });

  // Record payment mutation
  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/patients/${patientId}/payments`, {
        amount: paymentAmount,
        paymentMethod,
        statementId: paymentStatementId,
        referenceNumber: paymentReference || undefined,
        notes: paymentNotes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/payments`] });
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/statements`] });
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/balance`] });
      setShowPaymentDialog(false);
      setPaymentAmount("");
      setPaymentMethod("card");
      setPaymentReference("");
      setPaymentNotes("");
      setPaymentStatementId(null);
      toast({ title: "Payment Recorded", description: "The payment has been recorded successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to record payment", variant: "destructive" });
    },
  });

  const balance = balanceData?.balance;

  return (
    <div className="space-y-4">
      {/* Balance Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-slate-500 uppercase">Total Charges</p>
            <p className="text-lg font-bold text-slate-900">
              ${balance?.totalCharges?.toFixed(2) || "0.00"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-slate-500 uppercase">Total Payments</p>
            <p className="text-lg font-bold text-green-700">
              ${balance?.totalPayments?.toFixed(2) || "0.00"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-slate-500 uppercase">Adjustments</p>
            <p className="text-lg font-bold text-amber-700">
              ${balance?.totalAdjustments?.toFixed(2) || "0.00"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-slate-500 uppercase">Balance Due</p>
            <p className={`text-lg font-bold ${(balance?.currentBalance || 0) > 0 ? "text-red-700" : "text-green-700"}`}>
              ${balance?.currentBalance?.toFixed(2) || "0.00"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          onClick={() => generateStatementMutation.mutate()}
          disabled={generateStatementMutation.isPending}
        >
          {generateStatementMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <FileText className="w-4 h-4 mr-1" />
          )}
          Generate Statement
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setPaymentStatementId(null);
            setShowPaymentDialog(true);
          }}
        >
          <Plus className="w-4 h-4 mr-1" />
          Record Payment
        </Button>
        {statements && statements.length > 0 && (
          <PrintLayout
            trigger={
              <Button size="sm" variant="outline">
                <Download className="w-4 h-4 mr-1" />
                Download Statement
              </Button>
            }
            title="Patient Statement"
            practiceName="TherapyBill Practice"
          >
            <div>
              <h3 style={{ fontSize: "11pt", fontWeight: 600, marginBottom: "8px" }}>Statement for {patientName}</h3>
              {/* Summary */}
              <div style={{ display: "flex", gap: "24px", marginBottom: "16px", fontSize: "10pt" }}>
                <div>
                  <span style={{ color: "#6b7280" }}>Total Charges: </span>
                  <span style={{ fontWeight: 600 }}>${balance?.totalCharges?.toFixed(2) || "0.00"}</span>
                </div>
                <div>
                  <span style={{ color: "#6b7280" }}>Payments: </span>
                  <span style={{ fontWeight: 600, color: "#16a34a" }}>${balance?.totalPayments?.toFixed(2) || "0.00"}</span>
                </div>
                <div>
                  <span style={{ color: "#6b7280" }}>Adjustments: </span>
                  <span style={{ fontWeight: 600 }}>${balance?.totalAdjustments?.toFixed(2) || "0.00"}</span>
                </div>
                <div>
                  <span style={{ color: "#6b7280" }}>Balance Due: </span>
                  <span style={{ fontWeight: 700, color: (balance?.currentBalance || 0) > 0 ? "#dc2626" : "#16a34a" }}>
                    ${balance?.currentBalance?.toFixed(2) || "0.00"}
                  </span>
                </div>
              </div>

              {/* All statements with line items */}
              {statements.map((stmt) => (
                <div key={stmt.id} style={{ marginBottom: "16px", pageBreakInside: "avoid" }}>
                  <div style={{ fontSize: "9pt", fontWeight: 600, color: "#1e40af", marginBottom: "4px" }}>
                    {stmt.statementNumber} — {new Date(stmt.statementDate).toLocaleDateString()}
                    {stmt.dueDate && <span> (Due: {new Date(stmt.dueDate).toLocaleDateString()})</span>}
                    <span style={{ marginLeft: "12px", color: "#6b7280" }}>Status: {stmt.status}</span>
                  </div>
                  {stmt.lineItems && stmt.lineItems.length > 0 ? (
                    <table className="print-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "9pt", marginBottom: "4px" }}>
                      <thead>
                        <tr style={{ background: "#f3f4f6" }}>
                          <th style={{ border: "1px solid #d1d5db", padding: "4px 8px", textAlign: "left" }}>Date</th>
                          <th style={{ border: "1px solid #d1d5db", padding: "4px 8px", textAlign: "left" }}>Description</th>
                          <th style={{ border: "1px solid #d1d5db", padding: "4px 8px", textAlign: "right" }}>Charge</th>
                          <th style={{ border: "1px solid #d1d5db", padding: "4px 8px", textAlign: "right" }}>Ins. Paid</th>
                          <th style={{ border: "1px solid #d1d5db", padding: "4px 8px", textAlign: "right" }}>Patient Owes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stmt.lineItems.map((li: any, idx: number) => (
                          <tr key={idx}>
                            <td style={{ border: "1px solid #d1d5db", padding: "3px 8px" }}>{li.serviceDate || "-"}</td>
                            <td style={{ border: "1px solid #d1d5db", padding: "3px 8px" }}>{li.description}{li.cptCode ? ` (${li.cptCode})` : ""}</td>
                            <td style={{ border: "1px solid #d1d5db", padding: "3px 8px", textAlign: "right" }}>${parseFloat(li.chargeAmount || "0").toFixed(2)}</td>
                            <td style={{ border: "1px solid #d1d5db", padding: "3px 8px", textAlign: "right" }}>${parseFloat(li.insurancePaid || "0").toFixed(2)}</td>
                            <td style={{ border: "1px solid #d1d5db", padding: "3px 8px", textAlign: "right", fontWeight: 600 }}>${parseFloat(li.patientResponsibility || "0").toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ fontSize: "9pt", color: "#6b7280" }}>No line items</p>
                  )}
                  <div style={{ fontSize: "9pt", textAlign: "right" }}>
                    <span style={{ color: "#6b7280" }}>Statement Total: </span>
                    <span style={{ fontWeight: 600 }}>${parseFloat(stmt.totalAmount || "0").toFixed(2)}</span>
                    <span style={{ marginLeft: "16px", color: "#6b7280" }}>Balance: </span>
                    <span style={{ fontWeight: 700, color: "#dc2626" }}>${parseFloat(stmt.balanceDue || "0").toFixed(2)}</span>
                  </div>
                </div>
              ))}

              <div style={{ background: "#eff6ff", border: "1px solid #dbeafe", borderRadius: "4px", padding: "8px 12px", fontSize: "8pt", color: "#1e40af", marginTop: "12px" }}>
                Payment due within 30 days of statement date. Please contact our office with any questions regarding your balance.
              </div>
            </div>
          </PrintLayout>
        )}
      </div>

      {/* Statements List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Statements
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statementsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : !statements || statements.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No statements yet</p>
          ) : (
            <div className="space-y-2">
              {statements.map((stmt) => (
                <div key={stmt.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        className="text-sm font-medium text-blue-600 hover:underline"
                        onClick={() => setExpandedStatement(expandedStatement === stmt.id ? null : stmt.id)}
                      >
                        {stmt.statementNumber}
                      </button>
                      {getStatusBadge(stmt.status)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        ${parseFloat(stmt.balanceDue || "0").toFixed(2)}
                      </span>
                      {stmt.status !== "paid" && stmt.status !== "sent" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => sendStatementMutation.mutate({ statementId: stmt.id, method: "email" })}
                          disabled={sendStatementMutation.isPending}
                        >
                          <Send className="w-3 h-3" />
                        </Button>
                      )}
                      {stmt.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => {
                            setPaymentStatementId(stmt.id);
                            setPaymentAmount(parseFloat(stmt.balanceDue || "0").toFixed(2));
                            setShowPaymentDialog(true);
                          }}
                        >
                          <DollarSign className="w-3 h-3" />
                        </Button>
                      )}
                      <PrintLayout
                        trigger={
                          <Button size="sm" variant="ghost" className="h-7 px-2" title="Generate Invoice PDF">
                            <Printer className="w-3 h-3" />
                          </Button>
                        }
                        title="Invoice"
                        practiceName="TherapyBill Practice"
                      >
                        <InvoicePrintView
                          statementNumber={stmt.statementNumber}
                          statementDate={stmt.statementDate}
                          dueDate={stmt.dueDate}
                          patientName={patientName}
                          lineItems={
                            stmt.lineItems && Array.isArray(stmt.lineItems)
                              ? stmt.lineItems.map((li: any) => ({
                                  serviceDate: li.serviceDate,
                                  cptCode: li.cptCode,
                                  description: li.description,
                                  units: 1,
                                  chargeAmount: li.chargeAmount || "0",
                                  insurancePaid: li.insurancePaid || "0",
                                  adjustments: li.adjustments || "0",
                                  patientResponsibility: li.patientResponsibility || "0",
                                }))
                              : []
                          }
                          totalAmount={stmt.totalAmount}
                          paidAmount={stmt.paidAmount}
                          balanceDue={stmt.balanceDue}
                        />
                      </PrintLayout>
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs text-slate-500 mt-1">
                    <span>Date: {new Date(stmt.statementDate).toLocaleDateString()}</span>
                    {stmt.dueDate && <span>Due: {new Date(stmt.dueDate).toLocaleDateString()}</span>}
                    <span>Total: ${parseFloat(stmt.totalAmount || "0").toFixed(2)}</span>
                    <span>Paid: ${parseFloat(stmt.paidAmount || "0").toFixed(2)}</span>
                  </div>

                  {/* Expanded line items */}
                  {expandedStatement === stmt.id && stmt.lineItems && Array.isArray(stmt.lineItems) && stmt.lineItems.length > 0 && (
                    <div className="mt-2 border-t pt-2">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500">
                            <th className="text-left pb-1">Description</th>
                            <th className="text-right pb-1">Charge</th>
                            <th className="text-right pb-1">Ins. Paid</th>
                            <th className="text-right pb-1">Patient Owes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stmt.lineItems.map((li: any, idx: number) => (
                            <tr key={idx} className="border-t border-slate-100">
                              <td className="py-1">
                                {li.description}
                                {li.serviceDate && <span className="text-slate-400 ml-1">({li.serviceDate})</span>}
                              </td>
                              <td className="text-right">${parseFloat(li.chargeAmount || "0").toFixed(2)}</td>
                              <td className="text-right">${parseFloat(li.insurancePaid || "0").toFixed(2)}</td>
                              <td className="text-right font-medium">${parseFloat(li.patientResponsibility || "0").toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payments List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            Payment History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {paymentsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : !payments || payments.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No payments recorded</p>
          ) : (
            <div className="space-y-2">
              {payments.map((pmt) => (
                <div key={pmt.id} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium">${parseFloat(pmt.amount).toFixed(2)}</p>
                    <p className="text-xs text-slate-500">
                      {pmt.paymentMethod.toUpperCase()} - {new Date(pmt.paymentDate).toLocaleDateString()}
                      {pmt.referenceNumber && ` - Ref: ${pmt.referenceNumber}`}
                    </p>
                    {pmt.notes && <p className="text-xs text-slate-400 mt-0.5">{pmt.notes}</p>}
                  </div>
                  <Badge className="bg-green-100 text-green-700">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Recorded
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Record a payment for {patientName}
              {paymentStatementId && " against the selected statement"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="card">Credit/Debit Card</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="ach">ACH/Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference Number (optional)</Label>
              <Input
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="Check number, transaction ID, etc."
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="Payment notes..."
              />
            </div>
            <Button
              className="w-full"
              onClick={() => recordPaymentMutation.mutate()}
              disabled={!paymentAmount || parseFloat(paymentAmount) <= 0 || recordPaymentMutation.isPending}
            >
              {recordPaymentMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <DollarSign className="w-4 h-4 mr-2" />
              )}
              Record Payment
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Download, FileText, TrendingUp, TrendingDown, CreditCard, Receipt, Filter, Plus, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface PaymentTransaction {
  id: number;
  practiceId: number;
  patientId?: number;
  claimId?: number;
  amount: string;
  paymentType: "insurance" | "patient" | "copay" | "coinsurance" | "deductible";
  paymentMethod: "credit_card" | "debit_card" | "ach" | "check" | "cash" | "eft";
  status: "pending" | "completed" | "failed" | "refunded" | "voided";
  transactionDate: string;
  processedAt?: string;
  stripePaymentIntentId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  patient?: { firstName: string; lastName: string };
}

interface PaymentStats {
  totalRevenue: number;
  pendingPayments: number;
  insuranceRevenue: number;
  patientRevenue: number;
  transactionCount: number;
  completedCount: number;
  pendingCount: number;
}

export default function AccountingPage() {
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [showNewInvoice, setShowNewInvoice] = useState(false);

  // Fetch payment transactions from API
  const { data: transactions = [], isLoading: loadingTransactions } = useQuery<PaymentTransaction[]>({
    queryKey: ['/api/payment-transactions', dateRange.start, dateRange.end],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.start,
        endDate: dateRange.end,
      });
      const response = await apiRequest('GET', `/api/payment-transactions?${params}`);
      if (!response.ok) throw new Error('Failed to fetch transactions');
      return response.json();
    },
  });

  // Fetch payment stats from API
  const { data: stats, isLoading: loadingStats } = useQuery<PaymentStats>({
    queryKey: ['/api/payment-transactions/stats', dateRange.start, dateRange.end],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.start,
        endDate: dateRange.end,
      });
      const response = await apiRequest('GET', `/api/payment-transactions/stats?${params}`);
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
  });

  // Calculate local stats if API stats not available
  const totalRevenue = stats?.totalRevenue ?? transactions.filter(t => t.status === "completed").reduce((sum, t) => sum + parseFloat(t.amount || "0"), 0);
  const pendingPayments = stats?.pendingPayments ?? transactions.filter(t => t.status === "pending").reduce((sum, t) => sum + parseFloat(t.amount || "0"), 0);
  const insuranceRevenue = stats?.insuranceRevenue ?? transactions.filter(t => t.paymentType === "insurance" && t.status === "completed").reduce((sum, t) => sum + parseFloat(t.amount || "0"), 0);
  const patientRevenue = stats?.patientRevenue ?? transactions.filter(t => ["patient", "copay", "coinsurance", "deductible"].includes(t.paymentType) && t.status === "completed").reduce((sum, t) => sum + parseFloat(t.amount || "0"), 0);

  const exportToCSV = () => {
    const headers = ["Date", "Patient", "Amount", "Type", "Status", "Method"];
    const rows = transactions.map(t => [
      t.transactionDate,
      t.patient ? `${t.patient.firstName} ${t.patient.lastName}` : "Unknown",
      parseFloat(t.amount || "0").toFixed(2),
      t.paymentType,
      t.status,
      t.paymentMethod
    ]);
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-${dateRange.start}-to-${dateRange.end}.csv`;
    a.click();
    toast({ title: "Export Complete", description: "CSV file downloaded successfully" });
  };

  const exportToQuickBooks = () => {
    const header = "!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n!ENDTRNS\n";
    const rows = transactions.filter(t => t.status === "completed").map(t => {
      const patientName = t.patient ? `${t.patient.firstName} ${t.patient.lastName}` : "Unknown";
      const date = t.transactionDate.replace(/-/g, "/");
      const amount = parseFloat(t.amount || "0").toFixed(2);
      return `TRNS\tDEPOSIT\t${date}\tChecking\t${patientName}\t${amount}\t${t.paymentType} payment\n` +
        `SPL\tDEPOSIT\t${date}\tTherapy Revenue\t${patientName}\t-${amount}\t${t.paymentType} payment\n` +
        "ENDTRNS";
    }).join("\n");
    const iifContent = header + rows;
    const blob = new Blob([iifContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quickbooks-import-${dateRange.start}-to-${dateRange.end}.iif`;
    a.click();
    toast({ title: "Export Complete", description: "QuickBooks IIF file downloaded successfully" });
  };

  const exportTaxSummary = () => {
    const summary = `TAX SUMMARY REPORT
Period: ${dateRange.start} to ${dateRange.end}
Generated: ${new Date().toISOString().split("T")[0]}

REVENUE SUMMARY
===============
Total Revenue: $${totalRevenue.toFixed(2)}
  - Insurance Payments: $${insuranceRevenue.toFixed(2)}
  - Patient Payments: $${patientRevenue.toFixed(2)}

Pending Payments: $${pendingPayments.toFixed(2)}

TRANSACTION COUNT
=================
Total Transactions: ${transactions.length}
Completed: ${transactions.filter(t => t.status === "completed").length}
Pending: ${transactions.filter(t => t.status === "pending").length}

---
This report is for informational purposes only.
Consult with a tax professional for tax filing.`;
    const blob = new Blob([summary], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tax-summary-${dateRange.start}-to-${dateRange.end}.txt`;
    a.click();
    toast({ title: "Export Complete", description: "Tax summary report downloaded successfully" });
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case "completed": case "paid": return "bg-green-100 text-green-800";
      case "pending": case "sent": return "bg-yellow-100 text-yellow-800";
      case "failed": case "overdue": case "refunded": case "voided": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getTypeColor = (t: string) => {
    switch (t) {
      case "insurance": return "bg-blue-100 text-blue-800";
      case "patient": return "bg-purple-100 text-purple-800";
      case "copay": case "coinsurance": return "bg-teal-100 text-teal-800";
      case "deductible": return "bg-orange-100 text-orange-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const formatPaymentMethod = (method: string) => {
    return method.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const isLoading = loadingTransactions || loadingStats;

  return (
    <div className="md:ml-64 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Accounting</h1>
            <p className="text-slate-600">Track revenue, payments, and financial reports</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportToCSV} disabled={isLoading}>
              <Download className="w-4 h-4 mr-2" />Export CSV
            </Button>
            <Button variant="outline" onClick={exportToQuickBooks} disabled={isLoading}>
              <FileText className="w-4 h-4 mr-2" />QuickBooks
            </Button>
            <Button variant="outline" onClick={exportTaxSummary} disabled={isLoading}>
              <Receipt className="w-4 h-4 mr-2" />Tax Summary
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total Revenue</p>
                  {isLoading ? (
                    <Loader2 className="w-6 h-6 animate-spin mt-2" />
                  ) : (
                    <p className="text-2xl font-bold text-slate-900">${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  )}
                </div>
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-green-600" />
                </div>
              </div>
              <div className="flex items-center mt-2 text-sm text-green-600">
                <TrendingUp className="w-4 h-4 mr-1" />
                {transactions.length} transactions
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Pending</p>
                  {isLoading ? (
                    <Loader2 className="w-6 h-6 animate-spin mt-2" />
                  ) : (
                    <p className="text-2xl font-bold text-slate-900">${pendingPayments.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  )}
                </div>
                <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
                  <CreditCard className="w-6 h-6 text-yellow-600" />
                </div>
              </div>
              <div className="text-sm text-slate-500 mt-2">
                {transactions.filter(t => t.status === "pending").length} pending payments
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Insurance</p>
                  {isLoading ? (
                    <Loader2 className="w-6 h-6 animate-spin mt-2" />
                  ) : (
                    <p className="text-2xl font-bold text-slate-900">${insuranceRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  )}
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
              </div>
              <div className="text-sm text-slate-500 mt-2">
                {totalRevenue > 0 ? Math.round((insuranceRevenue / totalRevenue) * 100) : 0}% of revenue
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Patient Pay</p>
                  {isLoading ? (
                    <Loader2 className="w-6 h-6 animate-spin mt-2" />
                  ) : (
                    <p className="text-2xl font-bold text-slate-900">${patientRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  )}
                </div>
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                  <Receipt className="w-6 h-6 text-purple-600" />
                </div>
              </div>
              <div className="text-sm text-slate-500 mt-2">
                {totalRevenue > 0 ? Math.round((patientRevenue / totalRevenue) * 100) : 0}% of revenue
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center gap-4 flex-wrap">
              <Filter className="w-4 h-4 text-slate-500" />
              <div className="flex items-center gap-2">
                <Label>From:</Label>
                <Input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  className="w-40"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label>To:</Label>
                <Input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  className="w-40"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const now = new Date();
                  setDateRange({
                    start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
                    end: now.toISOString().split('T')[0]
                  });
                }}
              >
                This Month
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const now = new Date();
                  const quarter = Math.floor(now.getMonth() / 3);
                  setDateRange({
                    start: new Date(now.getFullYear(), quarter * 3, 1).toISOString().split('T')[0],
                    end: now.toISOString().split('T')[0]
                  });
                }}
              >
                This Quarter
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const now = new Date();
                  setDateRange({
                    start: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0],
                    end: now.toISOString().split('T')[0]
                  });
                }}
              >
                This Year
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="payments">
          <TabsList className="mb-4">
            <TabsTrigger value="payments">Payment History</TabsTrigger>
            <TabsTrigger value="reports">Financial Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <CardTitle>Payment History</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    No transactions found for this period
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-4 font-medium text-slate-600">Date</th>
                          <th className="text-left py-3 px-4 font-medium text-slate-600">Patient</th>
                          <th className="text-left py-3 px-4 font-medium text-slate-600">Amount</th>
                          <th className="text-left py-3 px-4 font-medium text-slate-600">Type</th>
                          <th className="text-left py-3 px-4 font-medium text-slate-600">Method</th>
                          <th className="text-left py-3 px-4 font-medium text-slate-600">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((t) => (
                          <tr key={t.id} className="border-b hover:bg-slate-50">
                            <td className="py-3 px-4">{new Date(t.transactionDate).toLocaleDateString()}</td>
                            <td className="py-3 px-4 font-medium">
                              {t.patient ? `${t.patient.firstName} ${t.patient.lastName}` : "—"}
                            </td>
                            <td className="py-3 px-4">${parseFloat(t.amount || "0").toFixed(2)}</td>
                            <td className="py-3 px-4">
                              <Badge className={getTypeColor(t.paymentType)}>{t.paymentType}</Badge>
                            </td>
                            <td className="py-3 px-4">{formatPaymentMethod(t.paymentMethod)}</td>
                            <td className="py-3 px-4">
                              <Badge className={getStatusColor(t.status)}>{t.status}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <div className="font-medium">Total Revenue</div>
                        <div className="text-sm text-slate-500">Selected period</div>
                      </div>
                      <div className="text-xl font-bold text-green-600">
                        ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <div className="font-medium">Insurance Payments</div>
                        <div className="text-sm text-slate-500">EFT, Check</div>
                      </div>
                      <div className="text-xl font-bold text-blue-600">
                        ${insuranceRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <div className="font-medium">Patient Payments</div>
                        <div className="text-sm text-slate-500">Copays, Self-pay</div>
                      </div>
                      <div className="text-xl font-bold text-purple-600">
                        ${patientRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                      <div>
                        <div className="font-medium">Pending Payments</div>
                        <div className="text-sm text-slate-500">Awaiting processing</div>
                      </div>
                      <div className="text-xl font-bold text-yellow-600">
                        ${pendingPayments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Transaction Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <span className="font-medium">Total Transactions</span>
                      <span className="text-xl font-bold">{transactions.length}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                      <span className="font-medium">Completed</span>
                      <span className="text-xl font-bold text-green-600">
                        {transactions.filter(t => t.status === "completed").length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                      <span className="font-medium">Pending</span>
                      <span className="text-xl font-bold text-yellow-600">
                        {transactions.filter(t => t.status === "pending").length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                      <span className="font-medium">Failed/Refunded</span>
                      <span className="text-xl font-bold text-red-600">
                        {transactions.filter(t => ["failed", "refunded", "voided"].includes(t.status)).length}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>Export Options</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center gap-3 mb-2">
                        <FileText className="w-8 h-8 text-green-600" />
                        <div>
                          <h3 className="font-medium">CSV Export</h3>
                          <p className="text-sm text-slate-500">Compatible with Excel, Google Sheets</p>
                        </div>
                      </div>
                      <Button className="w-full" variant="outline" onClick={exportToCSV} disabled={isLoading}>
                        <Download className="w-4 h-4 mr-2" />Download CSV
                      </Button>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center gap-3 mb-2">
                        <FileText className="w-8 h-8 text-blue-600" />
                        <div>
                          <h3 className="font-medium">QuickBooks IIF</h3>
                          <p className="text-sm text-slate-500">Import directly into QuickBooks</p>
                        </div>
                      </div>
                      <Button className="w-full" variant="outline" onClick={exportToQuickBooks} disabled={isLoading}>
                        <Download className="w-4 h-4 mr-2" />Download IIF
                      </Button>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center gap-3 mb-2">
                        <Receipt className="w-8 h-8 text-purple-600" />
                        <div>
                          <h3 className="font-medium">Tax Summary</h3>
                          <p className="text-sm text-slate-500">Summary report for tax filing</p>
                        </div>
                      </div>
                      <Button className="w-full" variant="outline" onClick={exportTaxSummary} disabled={isLoading}>
                        <Download className="w-4 h-4 mr-2" />Download Report
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

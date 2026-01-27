import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Download, FileText, TrendingUp, TrendingDown, CreditCard, Receipt, Filter, Plus } from "lucide-react";

interface Payment { id: number; date: string; patientName: string; amount: number; type: "insurance" | "patient" | "copay"; status: "pending" | "completed" | "failed"; claimId?: number; method: string; }
interface Invoice { id: number; date: string; patientName: string; amount: number; status: "draft" | "sent" | "paid" | "overdue"; dueDate: string; items: { description: string; amount: number }[]; }

const mockPayments: Payment[] = [
  { id: 1, date: "2026-01-20", patientName: "John Smith", amount: 1156, type: "insurance", status: "completed", claimId: 101, method: "EFT" },
  { id: 2, date: "2026-01-19", patientName: "Sarah Johnson", amount: 50, type: "copay", status: "completed", method: "Credit Card" },
  { id: 3, date: "2026-01-18", patientName: "Michael Brown", amount: 867, type: "insurance", status: "pending", claimId: 102, method: "Check" },
  { id: 4, date: "2026-01-15", patientName: "Emily Davis", amount: 289, type: "patient", status: "completed", method: "Cash" },
  { id: 5, date: "2026-01-10", patientName: "John Smith", amount: 1156, type: "insurance", status: "completed", claimId: 100, method: "EFT" },
];

const mockInvoices: Invoice[] = [
  { id: 1, date: "2026-01-20", patientName: "John Smith", amount: 1156, status: "paid", dueDate: "2026-02-05", items: [{ description: "Individual Therapy (4 units)", amount: 1156 }] },
  { id: 2, date: "2026-01-18", patientName: "Sarah Johnson", amount: 867, status: "sent", dueDate: "2026-02-02", items: [{ description: "Individual Therapy (3 units)", amount: 867 }] },
  { id: 3, date: "2026-01-15", patientName: "Michael Brown", amount: 578, status: "overdue", dueDate: "2026-01-25", items: [{ description: "Individual Therapy (2 units)", amount: 578 }] },
];

export default function AccountingPage() {
  const { toast } = useToast();
  const [payments] = useState<Payment[]>(mockPayments);
  const [invoices] = useState<Invoice[]>(mockInvoices);
  const [dateRange, setDateRange] = useState({ start: "2026-01-01", end: "2026-01-31" });
  const [showNewInvoice, setShowNewInvoice] = useState(false);

  const totalRevenue = payments.filter(p => p.status === "completed").reduce((sum, p) => sum + p.amount, 0);
  const pendingPayments = payments.filter(p => p.status === "pending").reduce((sum, p) => sum + p.amount, 0);
  const insuranceRevenue = payments.filter(p => p.type === "insurance" && p.status === "completed").reduce((sum, p) => sum + p.amount, 0);
  const patientRevenue = payments.filter(p => (p.type === "patient" || p.type === "copay") && p.status === "completed").reduce((sum, p) => sum + p.amount, 0);

  const exportToCSV = () => {
    const headers = ["Date", "Patient", "Amount", "Type", "Status", "Method"];
    const rows = payments.map(p => [p.date, p.patientName, p.amount.toFixed(2), p.type, p.status, p.method]);
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "payments-" + dateRange.start + "-to-" + dateRange.end + ".csv"; a.click();
    toast({ title: "Export Complete", description: "CSV file downloaded successfully" });
  };

  const exportToQuickBooks = () => {
    const header = "!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n!ENDTRNS\n";
    const rows = payments.filter(p => p.status === "completed").map(p => 
      "TRNS\tDEPOSIT\t" + p.date.replace(/-/g, "/") + "\tChecking\t" + p.patientName + "\t" + p.amount.toFixed(2) + "\t" + p.type + " payment\n" +
      "SPL\tDEPOSIT\t" + p.date.replace(/-/g, "/") + "\tTherapy Revenue\t" + p.patientName + "\t-" + p.amount.toFixed(2) + "\t" + p.type + " payment\n" +
      "ENDTRNS"
    ).join("\n");
    const iifContent = header + rows;
    const blob = new Blob([iifContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "quickbooks-import-" + dateRange.start + "-to-" + dateRange.end + ".iif"; a.click();
    toast({ title: "Export Complete", description: "QuickBooks IIF file downloaded successfully" });
  };

  const exportTaxSummary = () => {
    const summary = "TAX SUMMARY REPORT\nPeriod: " + dateRange.start + " to " + dateRange.end + "\nGenerated: " + new Date().toISOString().split("T")[0] + "\n\nREVENUE SUMMARY\n===============\nTotal Revenue: $" + totalRevenue.toFixed(2) + "\n  - Insurance Payments: $" + insuranceRevenue.toFixed(2) + "\n  - Patient Payments: $" + patientRevenue.toFixed(2) + "\n\nPending Payments: $" + pendingPayments.toFixed(2) + "\n\nTRANSACTION COUNT\n=================\nTotal Transactions: " + payments.length + "\nCompleted: " + payments.filter(p => p.status === "completed").length + "\nPending: " + payments.filter(p => p.status === "pending").length + "\n\n---\nThis report is for informational purposes only.\nConsult with a tax professional for tax filing.";
    const blob = new Blob([summary], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "tax-summary-" + dateRange.start + "-to-" + dateRange.end + ".txt"; a.click();
    toast({ title: "Export Complete", description: "Tax summary report downloaded successfully" });
  };

  const getStatusColor = (s: string) => s === "completed" || s === "paid" ? "bg-green-100 text-green-800" : s === "pending" || s === "sent" ? "bg-yellow-100 text-yellow-800" : s === "failed" || s === "overdue" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800";
  const getTypeColor = (t: string) => t === "insurance" ? "bg-blue-100 text-blue-800" : t === "patient" ? "bg-purple-100 text-purple-800" : t === "copay" ? "bg-teal-100 text-teal-800" : "bg-gray-100 text-gray-800";

  return (
    <div className="md:ml-64 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div><h1 className="text-2xl font-bold text-slate-900">Accounting</h1><p className="text-slate-600">Track revenue, payments, and financial reports</p></div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportToCSV}><Download className="w-4 h-4 mr-2" />Export CSV</Button>
            <Button variant="outline" onClick={exportToQuickBooks}><FileText className="w-4 h-4 mr-2" />QuickBooks</Button>
            <Button variant="outline" onClick={exportTaxSummary}><Receipt className="w-4 h-4 mr-2" />Tax Summary</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-600">Total Revenue</p><p className="text-2xl font-bold text-slate-900">${totalRevenue.toLocaleString()}</p></div><div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center"><DollarSign className="w-6 h-6 text-green-600" /></div></div><div className="flex items-center mt-2 text-sm text-green-600"><TrendingUp className="w-4 h-4 mr-1" />+12% from last month</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-600">Pending</p><p className="text-2xl font-bold text-slate-900">${pendingPayments.toLocaleString()}</p></div><div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center"><CreditCard className="w-6 h-6 text-yellow-600" /></div></div><div className="text-sm text-slate-500 mt-2">{payments.filter(p => p.status === "pending").length} pending payments</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-600">Insurance</p><p className="text-2xl font-bold text-slate-900">${insuranceRevenue.toLocaleString()}</p></div><div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center"><FileText className="w-6 h-6 text-blue-600" /></div></div><div className="text-sm text-slate-500 mt-2">{Math.round((insuranceRevenue / totalRevenue) * 100)}% of revenue</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-600">Patient Pay</p><p className="text-2xl font-bold text-slate-900">${patientRevenue.toLocaleString()}</p></div><div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center"><Receipt className="w-6 h-6 text-purple-600" /></div></div><div className="text-sm text-slate-500 mt-2">{Math.round((patientRevenue / totalRevenue) * 100)}% of revenue</div></CardContent></Card>
        </div>

        <Card className="mb-6"><CardContent className="py-4"><div className="flex items-center gap-4"><Filter className="w-4 h-4 text-slate-500" /><div className="flex items-center gap-2"><Label>From:</Label><Input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} className="w-40" /></div><div className="flex items-center gap-2"><Label>To:</Label><Input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} className="w-40" /></div><Button variant="outline" size="sm" onClick={() => setDateRange({ start: "2026-01-01", end: "2026-01-31" })}>This Month</Button><Button variant="outline" size="sm" onClick={() => setDateRange({ start: "2026-01-01", end: "2026-03-31" })}>This Quarter</Button><Button variant="outline" size="sm" onClick={() => setDateRange({ start: "2026-01-01", end: "2026-12-31" })}>This Year</Button></div></CardContent></Card>

        <Tabs defaultValue="payments">
          <TabsList className="mb-4"><TabsTrigger value="payments">Payment History</TabsTrigger><TabsTrigger value="invoices">Invoices</TabsTrigger><TabsTrigger value="reports">Financial Reports</TabsTrigger></TabsList>
          <TabsContent value="payments"><Card><CardHeader><CardTitle>Payment History</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b"><th className="text-left py-3 px-4 font-medium text-slate-600">Date</th><th className="text-left py-3 px-4 font-medium text-slate-600">Patient</th><th className="text-left py-3 px-4 font-medium text-slate-600">Amount</th><th className="text-left py-3 px-4 font-medium text-slate-600">Type</th><th className="text-left py-3 px-4 font-medium text-slate-600">Method</th><th className="text-left py-3 px-4 font-medium text-slate-600">Status</th></tr></thead><tbody>{payments.map((p) => (<tr key={p.id} className="border-b hover:bg-slate-50"><td className="py-3 px-4">{p.date}</td><td className="py-3 px-4 font-medium">{p.patientName}</td><td className="py-3 px-4">${p.amount.toFixed(2)}</td><td className="py-3 px-4"><Badge className={getTypeColor(p.type)}>{p.type}</Badge></td><td className="py-3 px-4">{p.method}</td><td className="py-3 px-4"><Badge className={getStatusColor(p.status)}>{p.status}</Badge></td></tr>))}</tbody></table></div></CardContent></Card></TabsContent>
          <TabsContent value="invoices"><Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Invoices</CardTitle><Dialog open={showNewInvoice} onOpenChange={setShowNewInvoice}><DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Invoice</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Create New Invoice</DialogTitle><DialogDescription>Create a new invoice for a patient.</DialogDescription></DialogHeader><div className="space-y-4 py-4"><div className="space-y-2"><Label>Patient</Label><Select><SelectTrigger><SelectValue placeholder="Select a patient" /></SelectTrigger><SelectContent><SelectItem value="1">John Smith</SelectItem><SelectItem value="2">Sarah Johnson</SelectItem><SelectItem value="3">Michael Brown</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Description</Label><Input placeholder="Service description" /></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Amount</Label><Input type="number" placeholder="0.00" /></div><div className="space-y-2"><Label>Due Date</Label><Input type="date" /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setShowNewInvoice(false)}>Cancel</Button><Button onClick={() => { setShowNewInvoice(false); toast({ title: "Invoice Created", description: "Invoice has been created and saved as draft." }); }}>Create Invoice</Button></DialogFooter></DialogContent></Dialog></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b"><th className="text-left py-3 px-4 font-medium text-slate-600">Invoice #</th><th className="text-left py-3 px-4 font-medium text-slate-600">Date</th><th className="text-left py-3 px-4 font-medium text-slate-600">Patient</th><th className="text-left py-3 px-4 font-medium text-slate-600">Amount</th><th className="text-left py-3 px-4 font-medium text-slate-600">Due Date</th><th className="text-left py-3 px-4 font-medium text-slate-600">Status</th><th className="text-left py-3 px-4 font-medium text-slate-600">Actions</th></tr></thead><tbody>{invoices.map((inv) => (<tr key={inv.id} className="border-b hover:bg-slate-50"><td className="py-3 px-4">INV-{String(inv.id).padStart(4, "0")}</td><td className="py-3 px-4">{inv.date}</td><td className="py-3 px-4 font-medium">{inv.patientName}</td><td className="py-3 px-4">${inv.amount.toFixed(2)}</td><td className="py-3 px-4">{inv.dueDate}</td><td className="py-3 px-4"><Badge className={getStatusColor(inv.status)}>{inv.status}</Badge></td><td className="py-3 px-4"><div className="flex gap-2"><Button variant="outline" size="sm">View</Button><Button variant="outline" size="sm">Send</Button></div></td></tr>))}</tbody></table></div></CardContent></Card></TabsContent>
          <TabsContent value="reports"><div className="grid grid-cols-1 md:grid-cols-2 gap-6"><Card><CardHeader><CardTitle>Revenue by Month</CardTitle></CardHeader><CardContent><div className="space-y-4">{[{ month: "January 2026", amount: 4518, change: 12 }, { month: "December 2025", amount: 4032, change: 8 }, { month: "November 2025", amount: 3734, change: -3 }, { month: "October 2025", amount: 3850, change: 15 }].map((item) => (<div key={item.month} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"><div><div className="font-medium">{item.month}</div><div className="text-sm text-slate-500">${item.amount.toLocaleString()}</div></div><div className={"flex items-center " + (item.change >= 0 ? "text-green-600" : "text-red-600")}>{item.change >= 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}{Math.abs(item.change)}%</div></div>))}</div></CardContent></Card><Card><CardHeader><CardTitle>Revenue by Payer</CardTitle></CardHeader><CardContent><div className="space-y-4">{[{ payer: "Blue Cross Blue Shield", amount: 2312, percentage: 51 }, { payer: "Aetna", amount: 1156, percentage: 26 }, { payer: "Patient Self-Pay", amount: 711, percentage: 16 }, { payer: "United Healthcare", amount: 339, percentage: 7 }].map((item) => (<div key={item.payer}><div className="flex items-center justify-between mb-1"><span className="text-sm font-medium">{item.payer}</span><span className="text-sm text-slate-500">${item.amount.toLocaleString()}</span></div><div className="w-full bg-slate-200 rounded-full h-2"><div className="bg-blue-600 h-2 rounded-full" style={{ width: item.percentage + "%" }} /></div></div>))}</div></CardContent></Card><Card className="md:col-span-2"><CardHeader><CardTitle>Export Options</CardTitle></CardHeader><CardContent><div className="grid grid-cols-1 md:grid-cols-3 gap-4"><div className="p-4 border rounded-lg"><div className="flex items-center gap-3 mb-2"><FileText className="w-8 h-8 text-green-600" /><div><h3 className="font-medium">CSV Export</h3><p className="text-sm text-slate-500">Compatible with Excel, Google Sheets</p></div></div><Button className="w-full" variant="outline" onClick={exportToCSV}><Download className="w-4 h-4 mr-2" />Download CSV</Button></div><div className="p-4 border rounded-lg"><div className="flex items-center gap-3 mb-2"><FileText className="w-8 h-8 text-blue-600" /><div><h3 className="font-medium">QuickBooks IIF</h3><p className="text-sm text-slate-500">Import directly into QuickBooks</p></div></div><Button className="w-full" variant="outline" onClick={exportToQuickBooks}><Download className="w-4 h-4 mr-2" />Download IIF</Button></div><div className="p-4 border rounded-lg"><div className="flex items-center gap-3 mb-2"><Receipt className="w-8 h-8 text-purple-600" /><div><h3 className="font-medium">Tax Summary</h3><p className="text-sm text-slate-500">Summary report for tax filing</p></div></div><Button className="w-full" variant="outline" onClick={exportTaxSummary}><Download className="w-4 h-4 mr-2" />Download Report</Button></div></div></CardContent></Card></div></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

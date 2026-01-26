import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ban, Download, FileText, XCircle, AlertTriangle, CheckCircle, Clock, Send } from "lucide-react";
import { Link } from "wouter";

export default function Reports() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [period, setPeriod] = useState("month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // Redirect to login if not authenticated
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

  const queryParams = period === 'custom'
    ? { period, startDate: customStartDate, endDate: customEndDate }
    : { period };

  const { data: report, isLoading: reportLoading, refetch } = useQuery({
    queryKey: ['/api/reports/denied-claims', queryParams],
    enabled: isAuthenticated && (period !== 'custom' || (customStartDate && customEndDate)),
    retry: false,
  });

  const handleExport = () => {
    const params = new URLSearchParams({ period });
    if (period === 'custom' && customStartDate && customEndDate) {
      params.set('startDate', customStartDate);
      params.set('endDate', customEndDate);
    }
    window.open(`/api/reports/denied-claims/export?${params.toString()}`, '_blank');
    toast({
      title: "Export Started",
      description: "Your CSV file is being downloaded.",
    });
  };

  const getAppealStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </span>
        );
      case 'sent':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            <Send className="w-3 h-3 mr-1" />
            Sent
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Won
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            <AlertTriangle className="w-3 h-3 mr-1" />
            No Appeal
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          Reports
        </h1>
        <p className="text-slate-600">
          View and export detailed reports for your practice.
        </p>
      </div>

      {/* Denied Claims Report */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center space-x-2">
              <Ban className="w-5 h-5 text-red-600" />
              <div>
                <CardTitle>Denied Claims Report</CardTitle>
                <CardDescription>Track and manage denied claims and appeals</CardDescription>
              </div>
            </div>
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="period" className="text-sm whitespace-nowrap">Period:</Label>
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="week">Last 7 Days</SelectItem>
                    <SelectItem value="month">Last 30 Days</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {period === 'custom' && (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-36"
                  />
                  <span className="text-slate-500">to</span>
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-36"
                  />
                </div>
              )}
              <Button variant="outline" onClick={handleExport} disabled={!report}>
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {reportLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : report ? (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="text-center p-4 bg-red-50 rounded-lg border border-red-100">
                  <p className="text-3xl font-bold text-red-600">{report.summary?.totalDenied || 0}</p>
                  <p className="text-sm text-slate-600">Total Denied</p>
                </div>
                <div className="text-center p-4 bg-red-50 rounded-lg border border-red-100">
                  <p className="text-3xl font-bold text-red-600">
                    ${(report.summary?.totalAmountAtRisk || 0).toLocaleString()}
                  </p>
                  <p className="text-sm text-slate-600">Amount at Risk</p>
                </div>
                <div className="text-center p-4 bg-yellow-50 rounded-lg border border-yellow-100">
                  <p className="text-3xl font-bold text-yellow-600">{report.summary?.appealsGenerated || 0}</p>
                  <p className="text-sm text-slate-600">Appeals Generated</p>
                </div>
                <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-3xl font-bold text-blue-600">{report.summary?.appealsSent || 0}</p>
                  <p className="text-sm text-slate-600">Appeals Sent</p>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg border border-green-100">
                  <p className="text-3xl font-bold text-green-600">{report.summary?.appealsWon || 0}</p>
                  <p className="text-sm text-slate-600">Appeals Won</p>
                </div>
              </div>

              {/* Top Denial Reasons */}
              {report.topDenialReasons?.length > 0 && (
                <div className="mb-6 p-4 bg-slate-50 rounded-lg">
                  <h3 className="font-semibold text-slate-900 mb-3">Top Denial Reasons</h3>
                  <div className="flex flex-wrap gap-2">
                    {report.topDenialReasons.slice(0, 5).map((reason: { reason: string; count: number }, index: number) => (
                      <span key={index} className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-white border border-slate-200">
                        <span className="font-medium text-slate-700">{reason.reason}</span>
                        <span className="ml-2 text-xs text-slate-500">({reason.count})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Claims Table */}
              {report.claims?.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead>Claim #</TableHead>
                        <TableHead>Patient</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Denial Reason</TableHead>
                        <TableHead>Denied Date</TableHead>
                        <TableHead>Appeal Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.claims.map((claim: any) => (
                        <TableRow key={claim.id}>
                          <TableCell className="font-medium">{claim.claimNumber}</TableCell>
                          <TableCell>{claim.patientName}</TableCell>
                          <TableCell className="font-medium text-red-600">${claim.amount}</TableCell>
                          <TableCell className="max-w-xs truncate" title={claim.denialReason}>
                            {claim.denialReason || 'Unknown'}
                          </TableCell>
                          <TableCell>
                            {claim.deniedAt ? new Date(claim.deniedAt).toLocaleDateString() : '-'}
                          </TableCell>
                          <TableCell>{getAppealStatusBadge(claim.appealStatus)}</TableCell>
                          <TableCell className="text-right">
                            <Link href={`/claims?view=${claim.id}`}>
                              <Button size="sm" variant="ghost">
                                <FileText className="w-4 h-4" />
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                  <p className="text-lg font-medium text-slate-900">No Denied Claims</p>
                  <p className="text-slate-500">Great news! No claims were denied in this period.</p>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
              <p className="text-lg font-medium text-slate-900">Select a Period</p>
              <p className="text-slate-500">Choose a date range to view denied claims.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

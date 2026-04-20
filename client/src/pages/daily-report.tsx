import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DollarSign, FileText, AlertTriangle, CheckCircle, TrendingUp,
  TrendingDown, Send, Mail, Calendar, Printer, Clock,
  ArrowUpRight, ArrowDownRight,
} from "lucide-react";

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return value.toFixed(1) + '%';
}

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: 'good' | 'bad' | 'neutral';
}

function MetricCard({ title, value, subtitle, icon, trend }: MetricCardProps) {
  const trendColors = {
    good: 'text-green-600 dark:text-green-400',
    bad: 'text-red-600 dark:text-red-400',
    neutral: 'text-slate-600 dark:text-slate-400',
  };
  const bgColors = {
    good: 'bg-green-50 dark:bg-green-950/30',
    bad: 'bg-red-50 dark:bg-red-950/30',
    neutral: 'bg-slate-50 dark:bg-slate-800/50',
  };

  return (
    <Card className={trend ? bgColors[trend] : ''}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold ${trend ? trendColors[trend] : ''}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="text-muted-foreground">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DailyReport() {
  const { isAuthenticated, isAdmin } = useAuth();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [subscribeEmail, setSubscribeEmail] = useState('');

  const { data: report, isLoading, error } = useQuery<any>({
    queryKey: [`/api/daily-report?date=${selectedDate}`],
    enabled: isAuthenticated,
    retry: false,
  });

  const sendReportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('GET', `/api/daily-report/send?date=${selectedDate}`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: 'Report Sent', description: `Email sent to ${data.results?.length || 0} recipient(s).` });
      } else {
        toast({ title: 'Not Sent', description: data.message, variant: 'destructive' });
      }
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to send report email.', variant: 'destructive' });
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/daily-report/subscribe', {
        email: subscribeEmail,
        subscribe: true,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: 'Subscribed', description: `${data.email} will receive daily reports.` });
      setSubscribeEmail('');
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to subscribe.', variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <AlertTriangle className="w-12 h-12 mx-auto text-red-500 mb-4" />
        <h2 className="text-lg font-semibold">Failed to load report</h2>
        <p className="text-sm text-muted-foreground">Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64 max-w-7xl mx-auto space-y-6 print:p-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Daily Billing Summary</h1>
          <p className="text-muted-foreground">
            {report?.practiceName || 'Practice'} &mdash; {selectedDate}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-44"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendReportMutation.mutate()}
            disabled={sendReportMutation.isPending}
          >
            <Send className="w-4 h-4 mr-2" />
            {sendReportMutation.isPending ? 'Sending...' : 'Send Report'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
          >
            <Printer className="w-4 h-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      {/* Top Summary Banner */}
      {report && (
        <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
          <CardContent className="p-4">
            <p className="text-base">
              Today you collected{' '}
              <span className="font-bold text-green-700 dark:text-green-400">
                {formatCurrency(report.payments?.insurancePosted?.totalAmount || 0)}
              </span>{' '}
              from insurance and{' '}
              <span className="font-bold text-green-700 dark:text-green-400">
                {formatCurrency(report.payments?.patientReceived?.totalAmount || 0)}
              </span>{' '}
              from patients (total:{' '}
              <span className="font-bold">
                {formatCurrency(report.payments?.totalCashCollected || 0)}
              </span>).
            </p>
          </CardContent>
        </Card>
      )}

      {/* Section A: Claims Summary */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          Claims Summary
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <MetricCard
            title="New Claims"
            value={String(report?.claims?.newCreated?.count || 0)}
            subtitle={formatCurrency(report?.claims?.newCreated?.totalAmount || 0)}
            icon={<FileText className="w-5 h-5" />}
            trend="neutral"
          />
          <MetricCard
            title="Submitted"
            value={String(report?.claims?.submitted?.count || 0)}
            subtitle={formatCurrency(report?.claims?.submitted?.totalAmount || 0)}
            icon={<ArrowUpRight className="w-5 h-5" />}
            trend="neutral"
          />
          <MetricCard
            title="Paid"
            value={String(report?.claims?.paid?.count || 0)}
            subtitle={formatCurrency(report?.claims?.paid?.totalPaid || 0)}
            icon={<CheckCircle className="w-5 h-5" />}
            trend="good"
          />
          <MetricCard
            title="Denied"
            value={String(report?.claims?.denied?.count || 0)}
            subtitle={formatCurrency(report?.claims?.denied?.totalAmount || 0)}
            icon={<AlertTriangle className="w-5 h-5" />}
            trend={(report?.claims?.denied?.count || 0) > 0 ? 'bad' : 'good'}
          />
          <MetricCard
            title="Pending"
            value={String(report?.claims?.pending?.count || 0)}
            subtitle={formatCurrency(report?.claims?.pending?.totalOutstanding || 0)}
            icon={<Clock className="w-5 h-5" />}
            trend="neutral"
          />
        </div>
      </div>

      {/* Section B: Payment Activity */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          Payment Activity
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <MetricCard
            title="Insurance Payments"
            value={String(report?.payments?.insurancePosted?.count || 0)}
            subtitle={formatCurrency(report?.payments?.insurancePosted?.totalAmount || 0)}
            icon={<DollarSign className="w-5 h-5" />}
            trend="good"
          />
          <MetricCard
            title="Patient Payments"
            value={String(report?.payments?.patientReceived?.count || 0)}
            subtitle={formatCurrency(report?.payments?.patientReceived?.totalAmount || 0)}
            icon={<DollarSign className="w-5 h-5" />}
            trend="good"
          />
          <MetricCard
            title="Total Collected"
            value={formatCurrency(report?.payments?.totalCashCollected || 0)}
            icon={<TrendingUp className="w-5 h-5" />}
            trend="good"
          />
          <MetricCard
            title="Adjustments"
            value={formatCurrency(report?.payments?.adjustments || 0)}
            icon={<ArrowDownRight className="w-5 h-5" />}
            trend={(report?.payments?.adjustments || 0) > 0 ? 'bad' : 'neutral'}
          />
          <MetricCard
            title="Collection Rate"
            value={formatPercent(report?.payments?.netCollectionRate || 0)}
            subtitle="Charges vs Collections today"
            icon={<TrendingUp className="w-5 h-5" />}
            trend={(report?.payments?.netCollectionRate || 0) >= 80 ? 'good' : 'bad'}
          />
        </div>
      </div>

      {/* Section C: Patient Billing */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Mail className="w-5 h-5 text-purple-600" />
          Patient Billing
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            title="Statements Generated"
            value={String(report?.patientBilling?.statementsGenerated || 0)}
            icon={<FileText className="w-5 h-5" />}
            trend="neutral"
          />
          <MetricCard
            title="Statements Sent"
            value={String(report?.patientBilling?.statementsSent || 0)}
            icon={<Send className="w-5 h-5" />}
            trend="neutral"
          />
          <MetricCard
            title="Outstanding Balance"
            value={formatCurrency(report?.patientBilling?.outstandingBalance || 0)}
            icon={<DollarSign className="w-5 h-5" />}
            trend={(report?.patientBilling?.outstandingBalance || 0) > 0 ? 'bad' : 'good'}
          />
          <MetricCard
            title="Overdue Statements"
            value={String(report?.patientBilling?.overdueStatements?.count || 0)}
            subtitle={formatCurrency(report?.patientBilling?.overdueStatements?.totalAmount || 0)}
            icon={<AlertTriangle className="w-5 h-5" />}
            trend={(report?.patientBilling?.overdueStatements?.count || 0) > 0 ? 'bad' : 'good'}
          />
        </div>

        {/* AR Aging */}
        <Card className="mt-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">AR Aging Snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950/30">
                <p className="text-xs text-muted-foreground mb-1">Current</p>
                <p className="text-lg font-bold text-green-700 dark:text-green-400">
                  {formatCurrency(report?.patientBilling?.arAging?.current || 0)}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30">
                <p className="text-xs text-muted-foreground mb-1">30-60 Days</p>
                <p className="text-lg font-bold text-yellow-700 dark:text-yellow-400">
                  {formatCurrency(report?.patientBilling?.arAging?.thirtyToSixty || 0)}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30">
                <p className="text-xs text-muted-foreground mb-1">60-90 Days</p>
                <p className="text-lg font-bold text-orange-700 dark:text-orange-400">
                  {formatCurrency(report?.patientBilling?.arAging?.sixtyToNinety || 0)}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950/30">
                <p className="text-xs text-muted-foreground mb-1">90+ Days</p>
                <p className="text-lg font-bold text-red-700 dark:text-red-400">
                  {formatCurrency(report?.patientBilling?.arAging?.ninetyPlus || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section D: Key Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          Key Metrics (30-Day Trailing)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            title="Avg Days in AR"
            value={`${report?.keyMetrics?.averageDaysInAR || 0} days`}
            icon={<Calendar className="w-5 h-5" />}
            trend={(report?.keyMetrics?.averageDaysInAR || 0) <= 35 ? 'good' : 'bad'}
          />
          <MetricCard
            title="Collection Rate"
            value={formatPercent(report?.keyMetrics?.collectionRate30Day || 0)}
            icon={<TrendingUp className="w-5 h-5" />}
            trend={(report?.keyMetrics?.collectionRate30Day || 0) >= 90 ? 'good' : 'bad'}
          />
          <MetricCard
            title="Denial Rate"
            value={formatPercent(report?.keyMetrics?.denialRate30Day || 0)}
            icon={<TrendingDown className="w-5 h-5" />}
            trend={(report?.keyMetrics?.denialRate30Day || 0) <= 5 ? 'good' : 'bad'}
          />
          <MetricCard
            title="Clean Claim Rate"
            value={formatPercent(report?.keyMetrics?.cleanClaimRate30Day || 0)}
            icon={<CheckCircle className="w-5 h-5" />}
            trend={(report?.keyMetrics?.cleanClaimRate30Day || 0) >= 95 ? 'good' : 'bad'}
          />
        </div>
      </div>

      {/* Section E: Front Desk */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-600" />
          Front Desk
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricCard
            title="Avg Wait Today"
            value={(report?.frontDesk?.appointments || 0) > 0
              ? `${report?.frontDesk?.avgWaitMinutes || 0} min`
              : '—'}
            subtitle={`${report?.frontDesk?.appointments || 0} appointments measured`}
            icon={<Clock className="w-5 h-5" />}
            trend={(report?.frontDesk?.appointments || 0) === 0
              ? 'neutral'
              : (report?.frontDesk?.avgWaitMinutes || 0) <= 10 ? 'good' : 'bad'}
          />
          <MetricCard
            title="Longest Wait Today"
            value={(report?.frontDesk?.appointments || 0) > 0
              ? `${report?.frontDesk?.maxWaitMinutes || 0} min`
              : '—'}
            icon={<AlertTriangle className="w-5 h-5" />}
            trend={(report?.frontDesk?.appointments || 0) === 0
              ? 'neutral'
              : (report?.frontDesk?.maxWaitMinutes || 0) <= 20 ? 'good' : 'bad'}
          />
          <MetricCard
            title="Appointments Measured"
            value={String(report?.frontDesk?.appointments || 0)}
            subtitle="Check-in → session start"
            icon={<CheckCircle className="w-5 h-5" />}
            trend="neutral"
          />
        </div>
      </div>

      {/* Email Subscription (admin only) */}
      {isAdmin && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">Subscribe to Daily Report Emails</CardTitle>
            <CardDescription>Enter an email address to receive this report every morning.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Input
                type="email"
                placeholder="admin@practice.com"
                value={subscribeEmail}
                onChange={(e) => setSubscribeEmail(e.target.value)}
                className="max-w-sm"
              />
              <Button
                onClick={() => subscribeMutation.mutate()}
                disabled={!subscribeEmail || subscribeMutation.isPending}
              >
                <Mail className="w-4 h-4 mr-2" />
                Subscribe
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white; }
          .print\\:hidden { display: none !important; }
          .print\\:p-0 { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}

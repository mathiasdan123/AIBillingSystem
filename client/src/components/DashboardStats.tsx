import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, DollarSign, Clock, TrendingUp, ShieldCheck, ShieldAlert } from "lucide-react";
import { Link } from "wouter";

interface DashboardStatsProps {
  stats: {
    totalClaims: number;
    /** Claims sent at least once, including rejected and reopened ones. */
    transmittedClaims?: number;
    /** Percent of those claims that are currently paid. A current-status snapshot. */
    successRate: number;
    totalRevenue: number;
    /** Null until it can be computed from real submitted and paid dates. */
    avgDaysToPayment?: number | null;
    monthlyClaimsCount: number;
    monthlyRevenue: number;
    /** Percent of those claims that are currently in denied status. */
    denialRate: number;
    pendingClaims: number;
    claimsAtComplianceRisk?: number;
  };
}

export default function DashboardStats({ stats }: DashboardStatsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Label the revenue figure with the period it covers so it can be compared
  // with the Accounting and Claims pages, which use different periods.
  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const kpis = [
    {
      title: 'Monthly Revenue',
      value: formatCurrency(stats?.monthlyRevenue ?? 0),
      icon: DollarSign,
      iconBg: 'bg-emerald-100 dark:bg-emerald-950',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      description: `Claim payments received, ${monthLabel}`,
    },
    {
      title: 'Claims This Month',
      value: String(stats?.monthlyClaimsCount ?? 0),
      icon: FileText,
      iconBg: 'bg-blue-100 dark:bg-blue-950',
      iconColor: 'text-blue-600 dark:text-blue-400',
      description: `${stats?.pendingClaims ?? 0} pending`,
    },
    {
      // Both rates are current-status snapshots of the same set of claims
      // (those sent at least once, including rejected and reopened ones), so
      // paid, denied and still-open claims add up to one base. The icon is
      // neutral: a paid rate is not an alarm while claims are still pending.
      title: 'Paid Rate',
      value: `${(stats?.successRate ?? 0).toFixed(1)}%`,
      icon: TrendingUp,
      iconBg: 'bg-blue-100 dark:bg-blue-950',
      iconColor: 'text-blue-600 dark:text-blue-400',
      description: `currently paid, of sent claims · ${(stats?.denialRate ?? 0).toFixed(1)}% currently denied`,
    },
    {
      // There is no computed value yet (the stats query returns null), so this
      // says so instead of showing a made-up number.
      title: 'Avg. Days to Payment',
      value: stats?.avgDaysToPayment == null ? 'Unavailable' : String(stats.avgDaysToPayment),
      icon: Clock,
      iconBg: 'bg-slate-100 dark:bg-slate-800',
      iconColor: 'text-slate-500 dark:text-slate-400',
      description: stats?.avgDaysToPayment == null ? 'Not calculated yet' : 'Submitted to paid',
    },
    {
      // Phase C: pre-submission audit-readiness. Counts not-yet-submitted
      // claims the denial predictor flagged high-risk. Clickable → claims list.
      title: 'Compliance Risk',
      value: String(stats?.claimsAtComplianceRisk ?? 0),
      icon: (stats?.claimsAtComplianceRisk ?? 0) === 0 ? ShieldCheck : ShieldAlert,
      iconBg: (stats?.claimsAtComplianceRisk ?? 0) === 0
        ? 'bg-emerald-100 dark:bg-emerald-950'
        : 'bg-red-100 dark:bg-red-950',
      iconColor: (stats?.claimsAtComplianceRisk ?? 0) === 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-red-600 dark:text-red-400',
      description: (stats?.claimsAtComplianceRisk ?? 0) === 0
        ? 'No at-risk claims pending'
        : 'Unsubmitted claims to review',
      href: '/claims',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        const card = (
          <Card className={`relative overflow-hidden h-full ${kpi.href ? 'transition-shadow hover:shadow-md cursor-pointer' : ''}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 md:px-6 pt-4 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <div className={`p-1.5 md:p-2 rounded-lg ${kpi.iconBg}`}>
                <Icon className={`h-3.5 w-3.5 md:h-4 md:w-4 ${kpi.iconColor}`} />
              </div>
            </CardHeader>
            <CardContent className="px-4 md:px-6 pb-4 md:pb-6">
              <div className={`${kpi.value === 'Unavailable' ? 'text-base md:text-lg text-muted-foreground' : 'text-xl md:text-2xl text-foreground'} font-bold`}>{kpi.value}</div>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
                {kpi.description}
              </p>
            </CardContent>
          </Card>
        );
        return kpi.href ? (
          <Link key={kpi.title} href={kpi.href}>{card}</Link>
        ) : (
          <div key={kpi.title}>{card}</div>
        );
      })}
    </div>
  );
}

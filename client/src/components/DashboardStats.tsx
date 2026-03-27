import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, CheckCircle, DollarSign, Clock, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

interface DashboardStatsProps {
  stats: {
    totalClaims: number;
    successRate: number;
    totalRevenue: number;
    avgDaysToPayment: number;
    monthlyClaimsCount: number;
    monthlyRevenue: number;
    denialRate: number;
    pendingClaims: number;
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

  const kpis = [
    {
      title: 'Monthly Revenue',
      value: formatCurrency(stats?.monthlyRevenue ?? 0),
      icon: DollarSign,
      iconBg: 'bg-emerald-100 dark:bg-emerald-950',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      description: 'Total payments this month',
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
      title: 'Success Rate',
      value: `${(stats?.successRate ?? 0).toFixed(1)}%`,
      icon: (stats?.successRate ?? 0) >= 90 ? CheckCircle : (stats?.successRate ?? 0) >= 75 ? TrendingUp : AlertTriangle,
      iconBg: (stats?.successRate ?? 0) >= 90
        ? 'bg-emerald-100 dark:bg-emerald-950'
        : (stats?.successRate ?? 0) >= 75
          ? 'bg-amber-100 dark:bg-amber-950'
          : 'bg-red-100 dark:bg-red-950',
      iconColor: (stats?.successRate ?? 0) >= 90
        ? 'text-emerald-600 dark:text-emerald-400'
        : (stats?.successRate ?? 0) >= 75
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400',
      description: `${(stats?.denialRate ?? 0).toFixed(1)}% denial rate`,
    },
    {
      title: 'Avg. Days to Payment',
      value: String(stats?.avgDaysToPayment ?? 0),
      icon: Clock,
      iconBg: (stats?.avgDaysToPayment ?? 0) <= 30
        ? 'bg-emerald-100 dark:bg-emerald-950'
        : (stats?.avgDaysToPayment ?? 0) <= 45
          ? 'bg-amber-100 dark:bg-amber-950'
          : 'bg-red-100 dark:bg-red-950',
      iconColor: (stats?.avgDaysToPayment ?? 0) <= 30
        ? 'text-emerald-600 dark:text-emerald-400'
        : (stats?.avgDaysToPayment ?? 0) <= 45
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400',
      description: 'Average processing time',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <Card key={kpi.title} className="relative overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 md:px-6 pt-4 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <div className={`p-1.5 md:p-2 rounded-lg ${kpi.iconBg}`}>
                <Icon className={`h-3.5 w-3.5 md:h-4 md:w-4 ${kpi.iconColor}`} />
              </div>
            </CardHeader>
            <CardContent className="px-4 md:px-6 pb-4 md:pb-6">
              <div className="text-xl md:text-2xl font-bold text-foreground">{kpi.value}</div>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
                {kpi.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

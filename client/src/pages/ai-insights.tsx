import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import {
  Brain,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  Clock,
  RefreshCw,
  Loader2,
  X,
  Database,
  BarChart3,
  ShieldAlert,
  Zap,
  CheckCircle,
  XCircle,
  Activity,
} from "lucide-react";

interface AiInsight {
  id: number;
  practiceId: number;
  insightType: string;
  payerName: string | null;
  cptCode: string | null;
  title: string;
  description: string;
  confidence: string;
  dataPoints: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface InsightsSummary {
  totalInsights: number;
  denialPatterns: number;
  optimizationTips: number;
  underpaymentPatterns: number;
  payerTrends: number;
  dataPointsAnalyzed: number;
}

interface InsightsResponse {
  insights: AiInsight[];
  summary: InsightsSummary;
}

interface DenialByPayer {
  payerName: string | null;
  denialReason: string | null;
  totalDenied: number;
}

interface PayerPattern {
  payerName: string | null;
  totalClaims: number;
  paidClaims: number;
  deniedClaims: number;
  avgProcessingDays: string | null;
  avgPaidAmount: string | null;
  approvalRate: string | null;
}

interface AiOptimizationRate {
  followedAi: {
    totalClaims: number;
    paidClaims: number;
    deniedClaims: number;
    successRate: number;
  };
  didNotFollowAi: {
    totalClaims: number;
    paidClaims: number;
    deniedClaims: number;
    successRate: number;
  };
}

interface DashboardResponse {
  topDenialsByPayer: DenialByPayer[];
  aiOptimizationRate: AiOptimizationRate;
  payerPatterns: PayerPattern[];
  overallStats: {
    totalClaims: number;
    paidClaims: number;
    deniedClaims: number;
    partialClaims: number;
    avgProcessingDays: string | null;
  };
}

function getInsightIcon(type: string) {
  switch (type) {
    case "denial_pattern":
      return ShieldAlert;
    case "underpayment_pattern":
      return TrendingDown;
    case "optimization_tip":
      return Lightbulb;
    case "payer_trend":
      return Clock;
    default:
      return Brain;
  }
}

function getInsightColor(type: string): string {
  switch (type) {
    case "denial_pattern":
      return "destructive";
    case "underpayment_pattern":
      return "secondary";
    case "optimization_tip":
      return "default";
    case "payer_trend":
      return "outline";
    default:
      return "secondary";
  }
}

function getInsightLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case "denial_pattern":
      return t("aiInsights.denialPattern");
    case "underpayment_pattern":
      return t("aiInsights.underpaymentPattern");
    case "optimization_tip":
      return t("aiInsights.optimizationTip");
    case "payer_trend":
      return t("aiInsights.payerTrend");
    default:
      return type;
  }
}

function getConfidenceBadge(confidence: string) {
  const value = parseFloat(confidence);
  if (value >= 0.8) {
    return { label: "High", variant: "default" as const };
  }
  if (value >= 0.6) {
    return { label: "Medium", variant: "secondary" as const };
  }
  return { label: "Low", variant: "outline" as const };
}

export default function AiInsightsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data, isLoading, error } = useQuery<InsightsResponse>({
    queryKey: ["/api/ai-insights"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/ai-insights");
      return res.json();
    },
  });

  const { data: dashboardData } = useQuery<DashboardResponse>({
    queryKey: ["/api/ai-insights/dashboard"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/ai-insights/dashboard");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-insights/generate");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] });
      toast({
        title: t("aiInsights.insightsGenerated"),
        description: `${result.generated} ${t("aiInsights.newInsightsFound")}`,
      });
    },
    onError: () => {
      toast({
        title: t("common.error"),
        description: t("aiInsights.generateError"),
        variant: "destructive",
      });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (insightId: number) => {
      await apiRequest("DELETE", `/api/ai-insights/${insightId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] });
      toast({
        title: t("aiInsights.insightDismissed"),
      });
    },
    onError: () => {
      toast({
        title: t("common.error"),
        description: t("aiInsights.dismissError"),
        variant: "destructive",
      });
    },
  });

  const insights = data?.insights || [];
  const summary = data?.summary || {
    totalInsights: 0,
    denialPatterns: 0,
    optimizationTips: 0,
    underpaymentPatterns: 0,
    payerTrends: 0,
    dataPointsAnalyzed: 0,
  };

  // Group insights by type
  const groupedInsights = new Map<string, AiInsight[]>();
  for (const insight of insights) {
    const group = groupedInsights.get(insight.insightType) || [];
    group.push(insight);
    groupedInsights.set(insight.insightType, group);
  }

  const insightTypeOrder = ["denial_pattern", "underpayment_pattern", "optimization_tip", "payer_trend"];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="md:ml-64 p-4 md:p-6 pt-20 md:pt-6 pb-24 md:pb-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="w-7 h-7" aria-hidden="true" />
            {t("aiInsights.title")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("aiInsights.subtitle")}
          </p>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          {t("aiInsights.generateInsights")}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("aiInsights.totalInsights")}</p>
                <p className="text-2xl font-bold">{summary.totalInsights}</p>
              </div>
              <Brain className="w-8 h-8 text-primary opacity-50" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("aiInsights.denialPatterns")}</p>
                <p className="text-2xl font-bold">{summary.denialPatterns}</p>
              </div>
              <ShieldAlert className="w-8 h-8 text-destructive opacity-50" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("aiInsights.optimizationTips")}</p>
                <p className="text-2xl font-bold">{summary.optimizationTips}</p>
              </div>
              <Zap className="w-8 h-8 text-yellow-500 opacity-50" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("aiInsights.dataPointsAnalyzed")}</p>
                <p className="text-2xl font-bold">{summary.dataPointsAnalyzed}</p>
              </div>
              <Database className="w-8 h-8 text-blue-500 opacity-50" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Dashboard Section */}
      {dashboardData && (dashboardData.overallStats.totalClaims > 0 || dashboardData.topDenialsByPayer.length > 0) && (
        <div className="space-y-6 mb-6">
          {/* Overall outcome stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Total Tracked</p>
                  <p className="text-2xl font-bold">{dashboardData.overallStats.totalClaims}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Paid</p>
                  <p className="text-2xl font-bold text-green-600">{dashboardData.overallStats.paidClaims}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Denied</p>
                  <p className="text-2xl font-bold text-red-600">{dashboardData.overallStats.deniedClaims}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Partial</p>
                  <p className="text-2xl font-bold text-yellow-600">{dashboardData.overallStats.partialClaims}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Avg Days to Pay</p>
                  <p className="text-2xl font-bold">{dashboardData.overallStats.avgProcessingDays || "N/A"}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* AI Optimization Success Rate */}
          {(dashboardData.aiOptimizationRate.followedAi.totalClaims > 0 ||
            dashboardData.aiOptimizationRate.didNotFollowAi.totalClaims > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="w-5 h-5" aria-hidden="true" />
                  AI Optimization Success Rate
                </CardTitle>
                <CardDescription>
                  Comparing outcomes of claims that followed AI suggestions vs those that did not
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle className="w-5 h-5 text-green-600" aria-hidden="true" />
                      <h4 className="font-medium">Followed AI Suggestions</h4>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Claims</span>
                        <span className="font-medium">{dashboardData.aiOptimizationRate.followedAi.totalClaims}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Success Rate</span>
                        <span className="font-medium text-green-600">
                          {dashboardData.aiOptimizationRate.followedAi.successRate}%
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5 mt-2">
                        <div
                          className="bg-green-600 h-2.5 rounded-full"
                          style={{ width: `${dashboardData.aiOptimizationRate.followedAi.successRate}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <XCircle className="w-5 h-5 text-red-500" aria-hidden="true" />
                      <h4 className="font-medium">Did Not Follow AI</h4>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Claims</span>
                        <span className="font-medium">{dashboardData.aiOptimizationRate.didNotFollowAi.totalClaims}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Success Rate</span>
                        <span className="font-medium text-red-500">
                          {dashboardData.aiOptimizationRate.didNotFollowAi.successRate}%
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5 mt-2">
                        <div
                          className="bg-red-500 h-2.5 rounded-full"
                          style={{ width: `${dashboardData.aiOptimizationRate.didNotFollowAi.successRate}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Denial Reasons by Payer */}
          {dashboardData.topDenialsByPayer.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5" aria-hidden="true" />
                  Top Denial Reasons by Payer
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dashboardData.topDenialsByPayer.slice(0, 10).map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between border-b pb-2 last:border-0">
                      <div className="flex-1">
                        <span className="font-medium text-sm">{item.payerName || "Unknown Payer"}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.denialReason}</p>
                      </div>
                      <Badge variant="destructive" className="ml-2">
                        {item.totalDenied} denied
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Payer Patterns */}
          {dashboardData.payerPatterns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" aria-hidden="true" />
                  Payer Performance Patterns
                </CardTitle>
                <CardDescription>
                  Outcome patterns and processing times by insurance payer
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 font-medium">Payer</th>
                        <th className="text-right py-2 font-medium">Claims</th>
                        <th className="text-right py-2 font-medium">Approval Rate</th>
                        <th className="text-right py-2 font-medium">Avg Paid</th>
                        <th className="text-right py-2 font-medium">Avg Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardData.payerPatterns.map((payer, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="py-2 font-medium">{payer.payerName || "Unknown"}</td>
                          <td className="text-right py-2">{payer.totalClaims}</td>
                          <td className="text-right py-2">
                            <span
                              className={
                                parseFloat(payer.approvalRate || "0") >= 80
                                  ? "text-green-600"
                                  : parseFloat(payer.approvalRate || "0") >= 60
                                  ? "text-yellow-600"
                                  : "text-red-600"
                              }
                            >
                              {payer.approvalRate || "0"}%
                            </span>
                          </td>
                          <td className="text-right py-2">${payer.avgPaidAmount || "0.00"}</td>
                          <td className="text-right py-2">{payer.avgProcessingDays || "N/A"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Insights by type */}
      {insights.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Brain className="w-16 h-16 text-muted-foreground/30 mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {t("aiInsights.noInsightsTitle")}
            </h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              {t("aiInsights.noInsightsDescription")}
            </p>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
              )}
              {t("aiInsights.generateInsights")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {insightTypeOrder.map((type) => {
            const group = groupedInsights.get(type);
            if (!group || group.length === 0) return null;
            const Icon = getInsightIcon(type);
            return (
              <div key={type}>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Icon className="w-5 h-5" aria-hidden="true" />
                  {getInsightLabel(type, t)} ({group.length})
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {group.map((insight) => {
                    const confidenceBadge = getConfidenceBadge(insight.confidence);
                    return (
                      <Card key={insight.id}>
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <CardTitle className="text-base">{insight.title}</CardTitle>
                              <div className="flex items-center gap-2 mt-2">
                                <Badge variant={getInsightColor(insight.insightType) as any}>
                                  {getInsightLabel(insight.insightType, t)}
                                </Badge>
                                <Badge variant={confidenceBadge.variant}>
                                  {confidenceBadge.label} {t("aiInsights.confidence")}
                                </Badge>
                                {insight.dataPoints > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    {insight.dataPoints} {t("aiInsights.dataPoints")}
                                  </span>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 shrink-0"
                              onClick={() => dismissMutation.mutate(insight.id)}
                              disabled={dismissMutation.isPending}
                              aria-label={t("aiInsights.dismiss")}
                            >
                              <X className="w-4 h-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">{insight.description}</p>
                          {(insight.payerName || insight.cptCode) && (
                            <div className="flex gap-2 mt-3">
                              {insight.payerName && (
                                <Badge variant="outline" className="text-xs">
                                  {insight.payerName}
                                </Badge>
                              )}
                              {insight.cptCode && (
                                <Badge variant="outline" className="text-xs">
                                  CPT {insight.cptCode}
                                </Badge>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

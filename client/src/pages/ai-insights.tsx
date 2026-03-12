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

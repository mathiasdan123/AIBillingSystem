import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  FileWarning,
  Lock,
  Monitor,
  Server,
} from "lucide-react";
import { useState } from "react";

// Types matching the server response
type SafeguardStatus = "compliant" | "non_compliant" | "partially_compliant" | "not_assessed";

interface SafeguardItem {
  id: string;
  name: string;
  description: string;
  status: SafeguardStatus;
  details: Record<string, unknown>;
  nextSteps: string[];
  regulation: string;
}

interface SafeguardCategory {
  label: string;
  description: string;
  items: SafeguardItem[];
}

interface HipaaAssessment {
  overallScore: number;
  totalItems: number;
  compliant: number;
  partiallyCompliant: number;
  nonCompliant: number;
  notAssessed: number;
  lastAssessedAt: string;
  categories: {
    administrativeSafeguards: SafeguardCategory;
    physicalSafeguards: SafeguardCategory;
    technicalSafeguards: SafeguardCategory;
    breachManagement: SafeguardCategory;
  };
}

// Status display helpers
const statusConfig: Record<SafeguardStatus, { label: string; icon: typeof CheckCircle2; colorClass: string; badgeClass: string }> = {
  compliant: {
    label: "Compliant",
    icon: CheckCircle2,
    colorClass: "text-green-600",
    badgeClass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  },
  partially_compliant: {
    label: "Partially Compliant",
    icon: AlertTriangle,
    colorClass: "text-yellow-600",
    badgeClass: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  },
  non_compliant: {
    label: "Non-Compliant",
    icon: XCircle,
    colorClass: "text-red-600",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  },
  not_assessed: {
    label: "Not Assessed",
    icon: HelpCircle,
    colorClass: "text-gray-400",
    badgeClass: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  },
};

const categoryIcons: Record<string, typeof Shield> = {
  administrativeSafeguards: FileWarning,
  physicalSafeguards: Monitor,
  technicalSafeguards: Lock,
  breachManagement: ShieldAlert,
};

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
}

function getProgressColor(score: number): string {
  if (score >= 80) return "[&>div]:bg-green-500";
  if (score >= 50) return "[&>div]:bg-yellow-500";
  return "[&>div]:bg-red-500";
}

function getScoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Needs Improvement";
  return "At Risk";
}

function StatusBadge({ status }: { status: SafeguardStatus }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.badgeClass}`}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}

function SafeguardItemCard({ item, isExpanded, onToggle }: { item: SafeguardItem; isExpanded: boolean; onToggle: () => void }) {
  const config = statusConfig[item.status];
  const StatusIcon = config.icon;

  return (
    <div className="border rounded-lg bg-card">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-3 min-w-0">
          <StatusIcon className={`h-5 w-5 flex-shrink-0 ${config.colorClass}`} />
          <div className="min-w-0">
            <div className="font-medium text-sm">{item.name}</div>
            <div className="text-xs text-muted-foreground truncate">{item.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <StatusBadge status={item.status} />
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-0 border-t space-y-3">
          {/* Regulation reference */}
          <div className="pt-3">
            <span className="text-xs font-medium text-muted-foreground">Regulation: </span>
            <span className="text-xs text-muted-foreground">{item.regulation}</span>
          </div>

          {/* Details */}
          {item.details && Object.keys(item.details).length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground block mb-1">Current Status Details:</span>
              <div className="bg-muted/50 rounded p-2 text-xs space-y-0.5">
                {Object.entries(item.details).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-muted-foreground">{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:</span>
                    <span className="font-medium">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next Steps */}
          {item.nextSteps.length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground block mb-1">
                {item.status === 'compliant' ? 'Maintenance:' : 'Action Required:'}
              </span>
              <ul className="space-y-1">
                {item.nextSteps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                      item.status === 'compliant' ? 'bg-green-500' : item.status === 'partially_compliant' ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CategorySection({
  categoryKey,
  category,
  expandedItems,
  toggleItem,
}: {
  categoryKey: string;
  category: SafeguardCategory;
  expandedItems: Set<string>;
  toggleItem: (id: string) => void;
}) {
  const Icon = categoryIcons[categoryKey] || Shield;
  const compliantCount = category.items.filter(i => i.status === "compliant").length;
  const totalCount = category.items.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">{category.label}</CardTitle>
              <CardDescription className="text-xs">{category.description}</CardDescription>
            </div>
          </div>
          <span className="text-sm font-medium text-muted-foreground">
            {compliantCount}/{totalCount} compliant
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {category.items.map((item) => (
          <SafeguardItemCard
            key={item.id}
            item={item}
            isExpanded={expandedItems.has(item.id)}
            onToggle={() => toggleItem(item.id)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export default function HipaaCompliancePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const { data: assessment, isLoading } = useQuery<HipaaAssessment>({
    queryKey: ["/api/compliance/hipaa-assessment"],
  });

  const runAssessment = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/compliance/hipaa-assessment");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/hipaa-assessment"] });
      toast({ title: "Assessment Complete", description: "HIPAA compliance assessment has been refreshed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to run HIPAA assessment.", variant: "destructive" });
    },
  });

  const toggleItem = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (!assessment) return;
    const allIds = Object.values(assessment.categories).flatMap(cat => cat.items.map(i => i.id));
    setExpandedItems(new Set(allIds));
  };

  const collapseAll = () => {
    setExpandedItems(new Set());
  };

  const score = assessment?.overallScore ?? 0;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" />
            HIPAA Compliance Self-Assessment
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review your practice's compliance posture across all HIPAA safeguard categories
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={expandAll}>
            Expand All
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            Collapse All
          </Button>
          <Button onClick={() => runAssessment.mutate()} disabled={runAssessment.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${runAssessment.isPending ? "animate-spin" : ""}`} />
            {runAssessment.isPending ? "Running..." : "Run Assessment"}
          </Button>
        </div>
      </div>

      {/* Overall Score Section */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overall Score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-6">
                <div className="text-4xl font-bold text-muted-foreground">--</div>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center justify-center py-2">
                  <div className={`text-4xl font-bold ${getScoreColor(score)}`}>{score}%</div>
                  <div className={`text-sm font-medium mt-1 ${getScoreColor(score)}`}>
                    {getScoreLabel(score)}
                  </div>
                  <Progress value={score} className={`mt-3 w-full h-2.5 ${getProgressColor(score)}`} />
                </div>
                {assessment?.lastAssessedAt && (
                  <p className="text-xs text-muted-foreground text-center">
                    Last assessed: {new Date(assessment.lastAssessedAt).toLocaleString()}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Summary cards */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{assessment?.compliant ?? 0}</div>
                <div className="text-xs text-muted-foreground">Compliant</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-yellow-100 dark:bg-yellow-900 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{assessment?.partiallyCompliant ?? 0}</div>
                <div className="text-xs text-muted-foreground">Partially Compliant</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900 flex items-center justify-center">
                <ShieldX className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{(assessment?.nonCompliant ?? 0) + (assessment?.notAssessed ?? 0)}</div>
                <div className="text-xs text-muted-foreground">Needs Attention</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Category Sections */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-3 opacity-50" />
          Loading compliance assessment...
        </div>
      ) : assessment ? (
        <div className="space-y-6">
          {Object.entries(assessment.categories).map(([key, category]) => (
            <CategorySection
              key={key}
              categoryKey={key}
              category={category}
              expandedItems={expandedItems}
              toggleItem={toggleItem}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Click "Run Assessment" to generate your HIPAA compliance report.</p>
          </CardContent>
        </Card>
      )}

      {/* Disclaimer */}
      <div className="text-xs text-muted-foreground border rounded-lg p-4 bg-muted/30">
        <strong>Disclaimer:</strong> This self-assessment tool provides a high-level overview of HIPAA compliance status
        based on available system data and manual attestations. It does not constitute legal advice or a formal audit.
        Consult with a qualified HIPAA compliance officer or attorney for a comprehensive compliance assessment.
      </div>
    </div>
  );
}

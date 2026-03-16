import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Target,
  Plus,
  ArrowLeft,
  Calendar,
  CheckCircle,
  Clock,
  Edit2,
  Trash2,
  TrendingUp,
  Loader2,
  AlertCircle,
  ChevronRight,
  FileText,
} from "lucide-react";

// Types matching the schema
interface TreatmentPlan {
  id: number;
  patientId: number;
  practiceId: number;
  therapistId: string | null;
  title: string;
  diagnosis: string | null;
  diagnosisCodes: any;
  clinicalSummary: string | null;
  treatmentModality: string | null;
  frequency: string | null;
  estimatedDuration: string | null;
  status: string | null;
  startDate: string | null;
  targetEndDate: string | null;
  actualEndDate: string | null;
  nextReviewDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TreatmentGoal {
  id: number;
  treatmentPlanId: number;
  patientId: number;
  practiceId: number;
  goalNumber: number;
  category: string | null;
  description: string;
  targetDate: string | null;
  status: string | null;
  progressPercentage: number | null;
  baselineMeasure: string | null;
  targetMeasure: string | null;
  currentMeasure: string | null;
  achievedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface GoalProgressNote {
  id: number;
  goalId: number;
  sessionId: number | null;
  therapistId: string | null;
  progressRating: number | null;
  notes: string;
  interventionsUsed: any;
  homeworkAssigned: string | null;
  nextSessionFocus: string | null;
  createdAt: string;
}

interface SoapGoalProgressEntry {
  id: number;
  soapNoteId: number;
  goalId: number;
  progressNote: string | null;
  progressPercentage: number | null;
  createdAt: string;
  soapNoteDate: string | null;
  soapNoteAssessment: string | null;
}

interface Patient {
  id: number;
  firstName: string;
  lastName: string;
}

interface ProgressSummary {
  planId: number;
  planStatus: string;
  totalGoals: number;
  achievedGoals: number;
  inProgressGoals: number;
  averageProgress: number;
  goals: {
    goalId: number;
    goalNumber: number;
    description: string;
    status: string;
    progressPercentage: number;
    targetDate: string | null;
    totalProgressNotes: number;
    totalSoapLinks: number;
    latestProgressNote: GoalProgressNote | null;
  }[];
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  draft: "bg-gray-100 text-gray-800",
  completed: "bg-blue-100 text-blue-800",
  discontinued: "bg-red-100 text-red-800",
  not_started: "bg-gray-100 text-gray-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  achieved: "bg-green-100 text-green-800",
  modified: "bg-purple-100 text-purple-800",
};

const GOAL_CATEGORIES = [
  "symptom_reduction",
  "skill_building",
  "behavioral",
  "relational",
  "coping_strategies",
  "functional_improvement",
  "cognitive",
  "emotional_regulation",
];

const GOAL_STATUSES = [
  "not_started",
  "in_progress",
  "achieved",
  "modified",
  "discontinued",
];

const PLAN_STATUSES = ["draft", "active", "completed", "discontinued"];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString();
}

function formatStatus(status: string | null): string {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function TreatmentPlansPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // View state
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [showCreateGoal, setShowCreateGoal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<TreatmentGoal | null>(null);
  const [showProgressTimeline, setShowProgressTimeline] = useState<number | null>(null);

  // Form state for new plan
  const [planForm, setPlanForm] = useState({
    title: "",
    diagnosis: "",
    clinicalSummary: "",
    treatmentModality: "",
    frequency: "",
    estimatedDuration: "",
    status: "active",
    startDate: new Date().toISOString().split("T")[0],
    targetEndDate: "",
    nextReviewDate: "",
    notes: "",
  });

  // Form state for new/edit goal
  const [goalForm, setGoalForm] = useState({
    description: "",
    category: "",
    targetDate: "",
    status: "not_started",
    baselineMeasure: "",
    targetMeasure: "",
  });

  // Progress note form
  const [progressForm, setProgressForm] = useState({
    notes: "",
    progressRating: 3,
  });

  // Queries
  const { data: patients, isLoading: patientsLoading } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
    retry: false,
  });

  const { data: plans, isLoading: plansLoading } = useQuery<TreatmentPlan[]>({
    queryKey: ["/api/patients", selectedPatientId, "treatment-plans"],
    enabled: !!selectedPatientId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/patients/${selectedPatientId}/treatment-plans`);
      return res.json();
    },
  });

  const { data: planDetails, isLoading: planDetailsLoading } = useQuery({
    queryKey: ["/api/treatment-plans", selectedPlanId],
    enabled: !!selectedPlanId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/treatment-plans/${selectedPlanId}`);
      return res.json();
    },
  });

  const { data: progressSummary } = useQuery<ProgressSummary>({
    queryKey: ["/api/treatment-plans", selectedPlanId, "progress-summary"],
    enabled: !!selectedPlanId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/treatment-plans/${selectedPlanId}/progress-summary`);
      return res.json();
    },
  });

  const { data: goalProgressNotes } = useQuery<GoalProgressNote[]>({
    queryKey: ["/api/treatment-plans", selectedPlanId, "goals", showProgressTimeline, "progress"],
    enabled: !!showProgressTimeline && !!selectedPlanId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/treatment-plans/${selectedPlanId}/goals/${showProgressTimeline}/progress`);
      return res.json();
    },
  });

  const { data: soapGoalProgress } = useQuery<SoapGoalProgressEntry[]>({
    queryKey: ["/api/treatment-plans", selectedPlanId, "goals", showProgressTimeline, "soap-progress"],
    enabled: !!showProgressTimeline && !!selectedPlanId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/treatment-plans/${selectedPlanId}/goals/${showProgressTimeline}/soap-progress`);
      return res.json();
    },
  });

  // Mutations
  const createPlanMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPatientId) return;
      const res = await apiRequest("POST", `/api/patients/${selectedPatientId}/treatment-plans`, planForm);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Treatment Plan Created", description: "The treatment plan has been created successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/patients", selectedPatientId, "treatment-plans"] });
      setShowCreatePlan(false);
      resetPlanForm();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create treatment plan.", variant: "destructive" });
    },
  });

  const updatePlanMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<TreatmentPlan> }) => {
      const res = await apiRequest("PUT", `/api/treatment-plans/${data.id}`, data.updates);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Plan Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/treatment-plans", selectedPlanId] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients", selectedPatientId, "treatment-plans"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update plan.", variant: "destructive" });
    },
  });

  const createGoalMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPlanId) return;
      const res = await apiRequest("POST", `/api/treatment-plans/${selectedPlanId}/goals`, goalForm);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Goal Created", description: "Treatment goal has been added." });
      queryClient.invalidateQueries({ queryKey: ["/api/treatment-plans", selectedPlanId] });
      queryClient.invalidateQueries({ queryKey: ["/api/treatment-plans", selectedPlanId, "progress-summary"] });
      setShowCreateGoal(false);
      resetGoalForm();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create goal.", variant: "destructive" });
    },
  });

  const updateGoalMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPlanId || !editingGoal) return;
      const res = await apiRequest("PUT", `/api/treatment-plans/${selectedPlanId}/goals/${editingGoal.id}`, goalForm);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Goal Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/treatment-plans", selectedPlanId] });
      queryClient.invalidateQueries({ queryKey: ["/api/treatment-plans", selectedPlanId, "progress-summary"] });
      setEditingGoal(null);
      resetGoalForm();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update goal.", variant: "destructive" });
    },
  });

  const deleteGoalMutation = useMutation({
    mutationFn: async (goalId: number) => {
      if (!selectedPlanId) return;
      await apiRequest("DELETE", `/api/treatment-plans/${selectedPlanId}/goals/${goalId}`);
    },
    onSuccess: () => {
      toast({ title: "Goal Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/treatment-plans", selectedPlanId] });
      queryClient.invalidateQueries({ queryKey: ["/api/treatment-plans", selectedPlanId, "progress-summary"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete goal.", variant: "destructive" });
    },
  });

  const addProgressMutation = useMutation({
    mutationFn: async (goalId: number) => {
      if (!selectedPlanId) return;
      const res = await apiRequest("POST", `/api/treatment-plans/${selectedPlanId}/goals/${goalId}/progress`, progressForm);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Progress Note Added" });
      queryClient.invalidateQueries({ queryKey: ["/api/treatment-plans", selectedPlanId, "goals", showProgressTimeline, "progress"] });
      queryClient.invalidateQueries({ queryKey: ["/api/treatment-plans", selectedPlanId] });
      queryClient.invalidateQueries({ queryKey: ["/api/treatment-plans", selectedPlanId, "progress-summary"] });
      setProgressForm({ notes: "", progressRating: 3 });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add progress note.", variant: "destructive" });
    },
  });

  // Helpers
  function resetPlanForm() {
    setPlanForm({
      title: "",
      diagnosis: "",
      clinicalSummary: "",
      treatmentModality: "",
      frequency: "",
      estimatedDuration: "",
      status: "active",
      startDate: new Date().toISOString().split("T")[0],
      targetEndDate: "",
      nextReviewDate: "",
      notes: "",
    });
  }

  function resetGoalForm() {
    setGoalForm({
      description: "",
      category: "",
      targetDate: "",
      status: "not_started",
      baselineMeasure: "",
      targetMeasure: "",
    });
  }

  function openEditGoal(goal: TreatmentGoal) {
    setEditingGoal(goal);
    setGoalForm({
      description: goal.description,
      category: goal.category || "",
      targetDate: goal.targetDate || "",
      status: goal.status || "not_started",
      baselineMeasure: goal.baselineMeasure || "",
      targetMeasure: goal.targetMeasure || "",
    });
  }

  const selectedPatient = patients?.find(p => p.id === selectedPatientId);
  const goals: TreatmentGoal[] = planDetails?.goals || [];

  // ==================== RENDER ====================

  // Loading state
  if (patientsLoading) {
    return (
      <div className="md:ml-64 min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="md:ml-64 min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {selectedPlanId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPlanId(null)}
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
            <Target className="w-6 h-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Treatment Plans</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {selectedPlanId
                  ? "Plan details and goals"
                  : selectedPatientId
                  ? `Plans for ${selectedPatient?.firstName} ${selectedPatient?.lastName}`
                  : "Track treatment goals and progress"}
              </p>
            </div>
          </div>

          {selectedPatientId && !selectedPlanId && (
            <Button onClick={() => setShowCreatePlan(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Plan
            </Button>
          )}

          {selectedPlanId && (
            <Button onClick={() => setShowCreateGoal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Goal
            </Button>
          )}
        </div>

        {/* Patient Selection */}
        {!selectedPatientId && (
          <Card>
            <CardHeader>
              <CardTitle>Select Patient</CardTitle>
              <CardDescription>Choose a patient to view or create treatment plans</CardDescription>
            </CardHeader>
            <CardContent>
              <Select onValueChange={(v) => setSelectedPatientId(parseInt(v))}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder="Select a patient..." />
                </SelectTrigger>
                <SelectContent>
                  {patients?.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

        {/* Treatment Plans List */}
        {selectedPatientId && !selectedPlanId && (
          <div className="space-y-4">
            {plansLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : !plans || plans.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Target className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                  <p className="text-slate-500">No treatment plans yet.</p>
                  <Button className="mt-4" onClick={() => setShowCreatePlan(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Plan
                  </Button>
                </CardContent>
              </Card>
            ) : (
              plans.map((plan) => (
                <Card
                  key={plan.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setSelectedPlanId(plan.id)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{plan.title}</h3>
                          <Badge className={STATUS_COLORS[plan.status || "draft"]}>
                            {formatStatus(plan.status)}
                          </Badge>
                        </div>
                        {plan.diagnosis && (
                          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{plan.diagnosis}</p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Started: {formatDate(plan.startDate)}
                          </span>
                          {plan.nextReviewDate && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Review: {formatDate(plan.nextReviewDate)}
                            </span>
                          )}
                          {plan.treatmentModality && (
                            <span>{plan.treatmentModality}</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        {/* Plan Detail View */}
        {selectedPlanId && (
          <div className="space-y-6">
            {planDetailsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <>
                {/* Plan Info Card */}
                {planDetails?.plan && (
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle>{planDetails.plan.title}</CardTitle>
                          {planDetails.plan.diagnosis && (
                            <CardDescription className="mt-1">{planDetails.plan.diagnosis}</CardDescription>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={STATUS_COLORS[planDetails.plan.status || "draft"]}>
                            {formatStatus(planDetails.plan.status)}
                          </Badge>
                          <Select
                            value={planDetails.plan.status || "draft"}
                            onValueChange={(v) =>
                              updatePlanMutation.mutate({ id: selectedPlanId, updates: { status: v } })
                            }
                          >
                            <SelectTrigger className="w-32 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PLAN_STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>{formatStatus(s)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-slate-500">Start Date</span>
                          <p className="font-medium">{formatDate(planDetails.plan.startDate)}</p>
                        </div>
                        <div>
                          <span className="text-slate-500">Target End</span>
                          <p className="font-medium">{formatDate(planDetails.plan.targetEndDate)}</p>
                        </div>
                        <div>
                          <span className="text-slate-500">Modality</span>
                          <p className="font-medium">{planDetails.plan.treatmentModality || "N/A"}</p>
                        </div>
                        <div>
                          <span className="text-slate-500">Frequency</span>
                          <p className="font-medium">{planDetails.plan.frequency || "N/A"}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Progress Summary */}
                {progressSummary && (
                  <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-blue-600" />
                        Progress Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-slate-900 dark:text-white">{progressSummary.totalGoals}</p>
                          <p className="text-xs text-slate-500">Total Goals</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-green-600">{progressSummary.achievedGoals}</p>
                          <p className="text-xs text-slate-500">Achieved</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-yellow-600">{progressSummary.inProgressGoals}</p>
                          <p className="text-xs text-slate-500">In Progress</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-blue-600">{progressSummary.averageProgress}%</p>
                          <p className="text-xs text-slate-500">Avg Progress</p>
                        </div>
                      </div>
                      <Progress value={progressSummary.averageProgress} className="h-2" />
                    </CardContent>
                  </Card>
                )}

                {/* Goals List */}
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    Goals ({goals.length})
                  </h2>

                  {goals.length === 0 ? (
                    <Card>
                      <CardContent className="py-8 text-center">
                        <AlertCircle className="w-8 h-8 mx-auto mb-3 text-slate-300" />
                        <p className="text-slate-500">No goals defined yet. Add goals to track progress.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    goals.map((goal: TreatmentGoal) => (
                      <Card key={goal.id} className="overflow-hidden">
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-bold text-slate-400">GOAL {goal.goalNumber}</span>
                                <Badge className={STATUS_COLORS[goal.status || "not_started"]} variant="outline">
                                  {formatStatus(goal.status)}
                                </Badge>
                                {goal.category && (
                                  <Badge variant="secondary" className="text-xs">
                                    {formatStatus(goal.category)}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm font-medium text-slate-900 dark:text-white">{goal.description}</p>
                            </div>
                            <div className="flex items-center gap-1 ml-4">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditGoal(goal)}
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm("Delete this goal? This action cannot be undone.")) {
                                    deleteGoalMutation.mutate(goal.id);
                                  }
                                }}
                              >
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </Button>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="mb-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-slate-500">Progress</span>
                              <span className="text-xs font-medium">{goal.progressPercentage || 0}%</span>
                            </div>
                            <Progress value={goal.progressPercentage || 0} className="h-2" />
                          </div>

                          {/* Goal metadata */}
                          <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
                            {goal.targetDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                Target: {formatDate(goal.targetDate)}
                              </span>
                            )}
                            {goal.baselineMeasure && (
                              <span>Baseline: {goal.baselineMeasure}</span>
                            )}
                            {goal.targetMeasure && (
                              <span>Target: {goal.targetMeasure}</span>
                            )}
                            {progressSummary && (() => {
                              const goalSummary = progressSummary.goals.find(g => g.goalId === goal.id);
                              if (goalSummary && goalSummary.totalSoapLinks > 0) {
                                return (
                                  <span className="flex items-center gap-1 text-indigo-600">
                                    <FileText className="w-3 h-3" />
                                    {goalSummary.totalSoapLinks} SOAP {goalSummary.totalSoapLinks === 1 ? "note" : "notes"} linked
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>

                          <Separator className="my-3" />

                          {/* Progress timeline toggle */}
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setShowProgressTimeline(
                                  showProgressTimeline === goal.id ? null : goal.id
                                )
                              }
                            >
                              <TrendingUp className="w-3 h-3 mr-1" />
                              {showProgressTimeline === goal.id ? "Hide" : "Show"} Progress Timeline
                            </Button>
                          </div>

                          {/* Progress Timeline */}
                          {showProgressTimeline === goal.id && (
                            <div className="mt-4 space-y-3">
                              {/* Add progress note */}
                              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 space-y-2">
                                <Label className="text-xs font-medium">Add Progress Note</Label>
                                <Textarea
                                  placeholder="Note progress observed during session..."
                                  value={progressForm.notes}
                                  onChange={(e) => setProgressForm(prev => ({ ...prev, notes: e.target.value }))}
                                  className="min-h-[60px] text-sm"
                                />
                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-2">
                                    <Label className="text-xs">Rating (1-5):</Label>
                                    <Select
                                      value={progressForm.progressRating.toString()}
                                      onValueChange={(v) => setProgressForm(prev => ({ ...prev, progressRating: parseInt(v) }))}
                                    >
                                      <SelectTrigger className="w-16 h-7 text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {[1, 2, 3, 4, 5].map(n => (
                                          <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <Button
                                    size="sm"
                                    disabled={!progressForm.notes.trim() || addProgressMutation.isPending}
                                    onClick={() => addProgressMutation.mutate(goal.id)}
                                  >
                                    {addProgressMutation.isPending ? (
                                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                    ) : (
                                      <Plus className="w-3 h-3 mr-1" />
                                    )}
                                    Add Note
                                  </Button>
                                </div>
                              </div>

                              {/* Timeline entries - merged manual progress notes + SOAP-linked progress */}
                              {(() => {
                                // Build unified timeline from both sources
                                const timelineItems: Array<{
                                  id: string;
                                  type: "manual" | "soap";
                                  date: string;
                                  notes: string;
                                  progressRating?: number | null;
                                  progressPercentage?: number | null;
                                  soapNoteId?: number;
                                }> = [];

                                if (goalProgressNotes) {
                                  goalProgressNotes.forEach((note) => {
                                    timelineItems.push({
                                      id: `manual-${note.id}`,
                                      type: "manual",
                                      date: note.createdAt,
                                      notes: note.notes,
                                      progressRating: note.progressRating,
                                    });
                                  });
                                }

                                if (soapGoalProgress) {
                                  soapGoalProgress.forEach((entry) => {
                                    timelineItems.push({
                                      id: `soap-${entry.id}`,
                                      type: "soap",
                                      date: entry.soapNoteDate || entry.createdAt,
                                      notes: entry.progressNote || "Progress tracked via SOAP note",
                                      progressPercentage: entry.progressPercentage,
                                      soapNoteId: entry.soapNoteId,
                                    });
                                  });
                                }

                                // Sort by date descending
                                timelineItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                                if (timelineItems.length === 0) {
                                  return <p className="text-xs text-slate-400 italic">No progress notes yet.</p>;
                                }

                                return (
                                  <div className="border-l-2 border-blue-200 pl-4 space-y-3">
                                    {timelineItems.map((item) => (
                                      <div key={item.id} className="relative">
                                        <div className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white ${
                                          item.type === "soap" ? "bg-indigo-400" : "bg-blue-400"
                                        }`} />
                                        <div className={`rounded-lg p-3 shadow-sm ${
                                          item.type === "soap"
                                            ? "bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100"
                                            : "bg-white dark:bg-slate-800"
                                        }`}>
                                          <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                              {item.type === "soap" && (
                                                <Badge variant="outline" className="text-xs bg-indigo-100 text-indigo-700 border-indigo-200">
                                                  <FileText className="w-3 h-3 mr-1" />
                                                  SOAP Note
                                                </Badge>
                                              )}
                                              <span className="text-xs text-slate-500">
                                                {new Date(item.date).toLocaleDateString()} at{" "}
                                                {new Date(item.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              {item.progressRating && (
                                                <Badge variant="secondary" className="text-xs">
                                                  Rating: {item.progressRating}/5
                                                </Badge>
                                              )}
                                              {item.progressPercentage != null && (
                                                <Badge variant="secondary" className="text-xs bg-indigo-100 text-indigo-700">
                                                  {item.progressPercentage}% achieved
                                                </Badge>
                                              )}
                                            </div>
                                          </div>
                                          <p className="text-sm text-slate-700 dark:text-slate-300">{item.notes}</p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Plan Dialog */}
      <Dialog open={showCreatePlan} onOpenChange={setShowCreatePlan}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Treatment Plan</DialogTitle>
            <DialogDescription>
              Define a new treatment plan for {selectedPatient?.firstName} {selectedPatient?.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Title <span className="text-red-500">*</span></Label>
              <Input
                value={planForm.title}
                onChange={(e) => setPlanForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="e.g., Anxiety Treatment Plan"
              />
            </div>
            <div>
              <Label>Diagnosis</Label>
              <Input
                value={planForm.diagnosis}
                onChange={(e) => setPlanForm(prev => ({ ...prev, diagnosis: e.target.value }))}
                placeholder="Primary diagnosis or presenting problem"
              />
            </div>
            <div>
              <Label>Clinical Summary</Label>
              <Textarea
                value={planForm.clinicalSummary}
                onChange={(e) => setPlanForm(prev => ({ ...prev, clinicalSummary: e.target.value }))}
                placeholder="Current clinical presentation..."
                className="min-h-[60px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Treatment Modality</Label>
                <Input
                  value={planForm.treatmentModality}
                  onChange={(e) => setPlanForm(prev => ({ ...prev, treatmentModality: e.target.value }))}
                  placeholder="e.g., CBT, EMDR"
                />
              </div>
              <div>
                <Label>Frequency</Label>
                <Select
                  value={planForm.frequency}
                  onValueChange={(v) => setPlanForm(prev => ({ ...prev, frequency: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="as_needed">As Needed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={planForm.startDate}
                  onChange={(e) => setPlanForm(prev => ({ ...prev, startDate: e.target.value }))}
                />
              </div>
              <div>
                <Label>Target End Date</Label>
                <Input
                  type="date"
                  value={planForm.targetEndDate}
                  onChange={(e) => setPlanForm(prev => ({ ...prev, targetEndDate: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Next Review Date</Label>
              <Input
                type="date"
                value={planForm.nextReviewDate}
                onChange={(e) => setPlanForm(prev => ({ ...prev, nextReviewDate: e.target.value }))}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={planForm.status}
                onValueChange={(v) => setPlanForm(prev => ({ ...prev, status: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{formatStatus(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={planForm.notes}
                onChange={(e) => setPlanForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional notes..."
                className="min-h-[60px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatePlan(false)}>Cancel</Button>
            <Button
              onClick={() => createPlanMutation.mutate()}
              disabled={!planForm.title.trim() || createPlanMutation.isPending}
            >
              {createPlanMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Goal Dialog */}
      <Dialog
        open={showCreateGoal || !!editingGoal}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateGoal(false);
            setEditingGoal(null);
            resetGoalForm();
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingGoal ? "Edit Goal" : "Add Goal"}</DialogTitle>
            <DialogDescription>
              {editingGoal ? "Update the treatment goal" : "Define a new treatment goal"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Goal Description <span className="text-red-500">*</span></Label>
              <Textarea
                value={goalForm.description}
                onChange={(e) => setGoalForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Describe the long-term goal..."
                className="min-h-[80px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select
                  value={goalForm.category}
                  onValueChange={(v) => setGoalForm(prev => ({ ...prev, category: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {GOAL_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{formatStatus(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={goalForm.status}
                  onValueChange={(v) => setGoalForm(prev => ({ ...prev, status: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GOAL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{formatStatus(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Target Date</Label>
              <Input
                type="date"
                value={goalForm.targetDate}
                onChange={(e) => setGoalForm(prev => ({ ...prev, targetDate: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Baseline Measure</Label>
                <Input
                  value={goalForm.baselineMeasure}
                  onChange={(e) => setGoalForm(prev => ({ ...prev, baselineMeasure: e.target.value }))}
                  placeholder="Starting point"
                />
              </div>
              <div>
                <Label>Target Measure</Label>
                <Input
                  value={goalForm.targetMeasure}
                  onChange={(e) => setGoalForm(prev => ({ ...prev, targetMeasure: e.target.value }))}
                  placeholder="Goal criteria"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateGoal(false);
                setEditingGoal(null);
                resetGoalForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => editingGoal ? updateGoalMutation.mutate() : createGoalMutation.mutate()}
              disabled={
                !goalForm.description.trim() ||
                (editingGoal ? updateGoalMutation.isPending : createGoalMutation.isPending)
              }
            >
              {(editingGoal ? updateGoalMutation.isPending : createGoalMutation.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {editingGoal ? "Update Goal" : "Add Goal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

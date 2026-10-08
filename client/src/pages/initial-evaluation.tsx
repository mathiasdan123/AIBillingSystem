/**
 * Initial Evaluation page (Wonder Kids pilot — Megan's #1 request).
 *
 * Entry: "New Evaluation" on the patient detail page → /evaluations/new?patientId=N
 * (creates a draft prefilled from the patient record, then redirects to
 * /evaluations/:id).
 *
 * Three stages on one page:
 *  1. Structured input sections ("boxes to input") the therapist fills in.
 *  2. AI-composed SOAP-style write-up — a DRAFT, fully editable.
 *  3. AI-proposed plan of care + goals — Accept / Edit / Reject per card.
 *     Accepted items land in the existing treatment plan + goal model, so
 *     accepted goals chart on the patient's Progress tab.
 *
 * The AI assists with documentation accuracy only; the therapist reviews,
 * edits, and approves every clinical decision.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, Check, ClipboardList, Loader2, Lock, Pencil, Sparkles, X,
} from "lucide-react";

interface ProposedPlan {
  sessionsPerWeek: number;
  durationWeeks: number;
  startDate: string;
  endDate: string;
  rationale: string;
  status: "proposed" | "accepted" | "rejected";
}

interface ProposedGoal extends Omit<ProposedPlan, "sessionsPerWeek"> {
  skillArea: string;
  goalText: string;
  term: "short_term" | "long_term";
  acceptedGoalId?: number;
}

interface Evaluation {
  id: number;
  patientId: number;
  status: "draft" | "composed" | "finalized";
  evaluationDate: string | null;
  personalInfo: Record<string, string> | null;
  healthHistory: Record<string, string> | null;
  caregiverConcerns: Record<string, string> | null;
  subjectiveComments: string | null;
  objectiveActivities: string | null;
  assessmentResults: string | null;
  skillAreas: string | null;
  aiWriteUp: Record<string, string> | null;
  proposedPlan: ProposedPlan | null;
  proposedGoals: ProposedGoal[] | null;
  treatmentPlanId: number | null;
}

const PERSONAL_FIELDS: Array<[string, string]> = [
  ["childName", "Child's name"],
  ["dateOfBirth", "Date of birth"],
  ["age", "Age"],
  ["caregiverPresent", "Parent/caregiver present"],
  ["referringPhysician", "Referring physician"],
  ["primaryDiagnosis", "Primary diagnosis / reason for referral"],
  ["school", "School/daycare"],
  ["gradeClassroom", "Grade/classroom"],
];

const HEALTH_FIELDS: Array<[string, string]> = [
  ["medicalHistory", "Relevant medical/developmental history"],
  ["birthHistory", "Birth history (if applicable)"],
  ["developmentalMilestones", "Developmental milestones"],
  ["diagnoses", "Relevant diagnoses"],
  ["medications", "Current medications"],
  ["allergies", "Allergies"],
  ["visionHearing", "Vision/hearing concerns"],
  ["previousTherapies", "Previous/current therapies"],
  ["hospitalizations", "Hospitalizations, surgeries, or injuries"],
  ["dailyFunction", "Sleep, feeding, toileting, or other areas affecting daily function"],
  ["other", "Other pertinent health information"],
];

const CAREGIVER_FIELDS: Array<[string, string]> = [
  ["primaryConcerns", "Primary concerns about development or daily functioning"],
  ["difficultActivities", "Activities that are difficult at home or school"],
  ["sensoryResponses", "Response to movement, touch, noise, or other sensory experiences"],
  ["attentionConcerns", "Concerns with attention, following directions, transitions, or completing tasks"],
  ["fineMotorConcerns", "Concerns with handwriting, drawing, cutting, dressing, utensil use, or other fine-motor tasks"],
  ["enjoysAndStrengths", "Activities the child enjoys or does well"],
  ["otGoalsForChild", "What they most want OT to help with"],
];

const WRITE_UP_SECTIONS: Array<[string, string]> = [
  ["patientHistory", "Patient history"],
  ["reasonForEvaluation", "Reason for evaluation"],
  ["observations", "Observations and clinical judgments"],
  ["assessmentResults", "Assessment results and explanation"],
  ["proposedPlanOfCare", "Proposed plan of care"],
  ["goals", "Goals"],
];

function getQueryParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

export default function InitialEvaluationPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/evaluations/:id");
  const rawId = params?.id ?? "new";
  const isNew = rawId === "new";
  const evaluationId = isNew ? null : parseInt(rawId);

  // ---- create-on-entry for /evaluations/new?patientId=N ----
  const creatingRef = useRef(false);
  const patientIdParam = getQueryParam("patientId");
  const createMutation = useMutation({
    mutationFn: async (patientId: string) => {
      const res = await apiRequest("POST", `/api/patients/${patientId}/evaluations`, {});
      return res.json();
    },
    onSuccess: (data: Evaluation) => {
      setLocation(`/evaluations/${data.id}`, { replace: true });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not start evaluation",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });
  useEffect(() => {
    if (isNew && patientIdParam && !creatingRef.current) {
      creatingRef.current = true;
      createMutation.mutate(patientIdParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, patientIdParam]);

  // ---- load the evaluation ----
  const { data: evaluation, isLoading } = useQuery<Evaluation>({
    queryKey: [`/api/evaluations/${evaluationId}`],
    enabled: evaluationId != null && Number.isFinite(evaluationId),
  });

  const finalized = evaluation?.status === "finalized";
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/evaluations/${evaluationId}`] });

  // ---- local form state for the input sections ----
  const [personalInfo, setPersonalInfo] = useState<Record<string, string>>({});
  const [healthHistory, setHealthHistory] = useState<Record<string, string>>({});
  const [caregiverConcerns, setCaregiverConcerns] = useState<Record<string, string>>({});
  const [evaluationDate, setEvaluationDate] = useState("");
  const [subjectiveComments, setSubjectiveComments] = useState("");
  const [objectiveActivities, setObjectiveActivities] = useState("");
  const [assessmentResults, setAssessmentResults] = useState("");
  const [skillAreas, setSkillAreas] = useState("");
  const [writeUp, setWriteUp] = useState<Record<string, string>>({});
  const loadedIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!evaluation || loadedIdRef.current === evaluation.id) return;
    loadedIdRef.current = evaluation.id;
    setPersonalInfo((evaluation.personalInfo ?? {}) as Record<string, string>);
    setHealthHistory((evaluation.healthHistory ?? {}) as Record<string, string>);
    setCaregiverConcerns((evaluation.caregiverConcerns ?? {}) as Record<string, string>);
    setEvaluationDate(evaluation.evaluationDate ?? "");
    setSubjectiveComments(evaluation.subjectiveComments ?? "");
    setObjectiveActivities(evaluation.objectiveActivities ?? "");
    setAssessmentResults(evaluation.assessmentResults ?? "");
    setSkillAreas(evaluation.skillAreas ?? "");
    setWriteUp((evaluation.aiWriteUp ?? {}) as Record<string, string>);
  }, [evaluation]);

  // Keep the editable write-up in sync after compose
  useEffect(() => {
    if (evaluation?.aiWriteUp) setWriteUp(evaluation.aiWriteUp as Record<string, string>);
  }, [evaluation?.aiWriteUp]);

  // ---- mutations ----
  const saveSectionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/evaluations/${evaluationId}`, {
        evaluationDate: evaluationDate || undefined,
        personalInfo,
        healthHistory,
        caregiverConcerns,
        subjectiveComments,
        objectiveActivities,
        assessmentResults,
        skillAreas,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Evaluation saved" });
    },
    onError: (err: unknown) => {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const composeMutation = useMutation({
    mutationFn: async () => {
      // Persist the sections first so the AI composes from exactly what is on screen.
      await apiRequest("PATCH", `/api/evaluations/${evaluationId}`, {
        evaluationDate: evaluationDate || undefined,
        personalInfo, healthHistory, caregiverConcerns,
        subjectiveComments, objectiveActivities, assessmentResults, skillAreas,
      });
      const res = await apiRequest("POST", `/api/evaluations/${evaluationId}/compose`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Write-up drafted", description: "Review and edit every section before finalizing." });
    },
    onError: (err: unknown) => {
      toast({ title: "Compose failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const saveWriteUpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/evaluations/${evaluationId}/write-up`, writeUp);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Write-up saved" });
    },
    onError: (err: unknown) => {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const proposeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/evaluations/${evaluationId}/propose`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Plan and goals proposed", description: "Accept, edit, or reject each proposal below." });
    },
    onError: (err: unknown) => {
      toast({ title: "Proposal failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const planDecisionMutation = useMutation({
    mutationFn: async (body: { action: "accept" | "reject"; edits?: Partial<ProposedPlan> }) => {
      const res = await apiRequest("POST", `/api/evaluations/${evaluationId}/plan/decision`, body);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidate();
      setEditingPlan(false);
      toast({ title: vars.action === "accept" ? "Plan of care accepted" : "Plan proposal rejected" });
    },
    onError: (err: unknown) => {
      toast({ title: "Plan decision failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const goalDecisionMutation = useMutation({
    mutationFn: async (vars: { index: number; action: "accept" | "reject"; edits?: Partial<ProposedGoal> }) => {
      const res = await apiRequest("POST", `/api/evaluations/${evaluationId}/goals/${vars.index}/decision`, {
        action: vars.action,
        edits: vars.edits,
      });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidate();
      setEditingGoalIndex(null);
      toast({
        title: vars.action === "accept" ? "Goal accepted" : "Goal rejected",
        description: vars.action === "accept"
          ? "Added to the treatment plan — it will chart on the Progress tab as sessions record progress."
          : undefined,
      });
    },
    onError: (err: unknown) => {
      toast({ title: "Goal decision failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/evaluations/${evaluationId}/finalize`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Evaluation finalized" });
    },
    onError: (err: unknown) => {
      toast({ title: "Finalize failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  // ---- per-card edit state for proposals ----
  const [editingPlan, setEditingPlan] = useState(false);
  const [planEdits, setPlanEdits] = useState<Partial<ProposedPlan>>({});
  const [editingGoalIndex, setEditingGoalIndex] = useState<number | null>(null);
  const [goalEdits, setGoalEdits] = useState<Partial<ProposedGoal>>({});

  if (isNew && !patientIdParam) {
    return (
      <div className="container mx-auto p-6" data-testid="initial-evaluation-page">
        <p className="text-sm text-muted-foreground">
          Open a patient and choose "New Evaluation" to start an initial evaluation.
        </p>
      </div>
    );
  }

  if (isNew || isLoading || !evaluation) {
    return (
      <div className="container mx-auto p-6 flex items-center gap-2" data-testid="initial-evaluation-page">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm text-muted-foreground">
          {isNew ? "Starting evaluation…" : "Loading evaluation…"}
        </span>
      </div>
    );
  }

  const plan = evaluation.proposedPlan;
  const goals = evaluation.proposedGoals ?? [];

  const textField = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    rows = 3,
  ) => (
    <div key={id}>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        data-testid={id}
        value={value}
        rows={rows}
        disabled={finalized}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-4xl" data-testid="initial-evaluation-page">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/patients")} data-testid="button-back-to-patients">
            <ArrowLeft className="w-4 h-4 mr-1" /> Patients
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="w-6 h-6" />
              Initial Evaluation
            </h1>
            <p className="text-sm text-muted-foreground">
              {(evaluation.personalInfo as any)?.childName || `Patient #${evaluation.patientId}`}
              {evaluation.evaluationDate ? ` — ${evaluation.evaluationDate}` : ""}
            </p>
          </div>
        </div>
        <Badge data-testid="evaluation-status" variant={finalized ? "default" : "secondary"}>
          {finalized ? "Finalized" : evaluation.status === "composed" ? "Draft write-up ready" : "Draft"}
        </Badge>
      </div>

      {/* Compliance framing: the AI drafts for accuracy; the therapist decides. */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800" data-testid="ai-disclaimer">
        <CardContent className="pt-4 pb-4 text-sm text-blue-900 dark:text-blue-100">
          TherapyBill AI assists with documentation accuracy by drafting from the information you
          enter below. It only uses what you entered — it never adds observations, scores, or
          history. You review, edit, and approve every write-up, plan, and goal; all clinical
          decisions are made by the treating therapist.
        </CardContent>
      </Card>

      {/* ==================== 1. INPUT SECTIONS ==================== */}
      <Card data-testid="section-personal-info">
        <CardHeader>
          <CardTitle>1. Personal information</CardTitle>
          <CardDescription>Prefilled from the patient record — edit anything that changed.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="evaluationDate">Date of evaluation</Label>
            <Input
              id="evaluationDate"
              data-testid="input-evaluation-date"
              type="date"
              value={evaluationDate}
              disabled={finalized}
              onChange={(e) => setEvaluationDate(e.target.value)}
            />
          </div>
          {PERSONAL_FIELDS.map(([key, label]) => (
            <div key={key}>
              <Label htmlFor={`pi-${key}`}>{label}</Label>
              <Input
                id={`pi-${key}`}
                data-testid={`input-personal-${key}`}
                value={personalInfo[key] ?? ""}
                disabled={finalized}
                onChange={(e) => setPersonalInfo({ ...personalInfo, [key]: e.target.value })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card data-testid="section-health-history">
        <CardHeader>
          <CardTitle>2. Health history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {HEALTH_FIELDS.map(([key, label]) =>
            textField(`hh-${key}`, label, healthHistory[key] ?? "", (v) =>
              setHealthHistory({ ...healthHistory, [key]: v }), 2),
          )}
        </CardContent>
      </Card>

      <Card data-testid="section-caregiver-concerns">
        <CardHeader>
          <CardTitle>3. Parent/caregiver concerns</CardTitle>
          <CardDescription>The caregiver interview, question by question.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {CAREGIVER_FIELDS.map(([key, label]) =>
            textField(`cc-${key}`, label, caregiverConcerns[key] ?? "", (v) =>
              setCaregiverConcerns({ ...caregiverConcerns, [key]: v }), 2),
          )}
        </CardContent>
      </Card>

      <Card data-testid="section-free-text">
        <CardHeader>
          <CardTitle>4-7. Session documentation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {textField("subjectiveComments", "4. Subjective comments from patient and parents", subjectiveComments, setSubjectiveComments)}
          {textField("objectiveActivities", "5. Objective activities (what was done; ability, skills, and deficits observed)", objectiveActivities, setObjectiveActivities, 5)}
          {textField("assessmentResults", "6. Assessment results and explanation", assessmentResults, setAssessmentResults, 4)}
          {textField("skillAreas", "7. Overall skill areas and areas of growth/concern", skillAreas, setSkillAreas, 4)}
        </CardContent>
      </Card>

      {!finalized && (
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => saveSectionsMutation.mutate()}
            disabled={saveSectionsMutation.isPending}
            data-testid="button-save-sections"
          >
            {saveSectionsMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Save draft
          </Button>
          <Button
            onClick={() => composeMutation.mutate()}
            disabled={composeMutation.isPending}
            data-testid="button-compose"
          >
            {composeMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Drafting…</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-1" /> {evaluation.aiWriteUp ? "Recompose write-up (AI draft)" : "Compose write-up (AI draft)"}</>
            )}
          </Button>
        </div>
      )}

      {/* ==================== 2. WRITE-UP (AI STEP 1) ==================== */}
      {evaluation.aiWriteUp && (
        <Card data-testid="section-write-up">
          <CardHeader>
            <CardTitle>Evaluation write-up</CardTitle>
            <CardDescription>
              AI-drafted from your entered data only. Edit freely — this is your report.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {WRITE_UP_SECTIONS.map(([key, label]) => (
              <div key={key}>
                <Label htmlFor={`wu-${key}`}>{label}</Label>
                <Textarea
                  id={`wu-${key}`}
                  data-testid={`write-up-${key}`}
                  value={writeUp[key] ?? ""}
                  rows={4}
                  disabled={finalized}
                  onChange={(e) => setWriteUp({ ...writeUp, [key]: e.target.value })}
                />
              </div>
            ))}
            {!finalized && (
              <Button
                variant="outline"
                onClick={() => saveWriteUpMutation.mutate()}
                disabled={saveWriteUpMutation.isPending}
                data-testid="button-save-write-up"
              >
                {saveWriteUpMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Save write-up
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ==================== 3. PROPOSALS (AI STEP 2) ==================== */}
      {evaluation.aiWriteUp && (
        <Card data-testid="section-proposals">
          <CardHeader>
            <CardTitle>Proposed plan of care and goals</CardTitle>
            <CardDescription>
              Drafted from the documented concerns, observations, and milestones (assessment
              scores as supporting rationale only). All sessions are individual (1:1). Accept,
              edit, or reject each proposal — only accepted items become part of the treatment
              plan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!finalized && (
              <Button
                onClick={() => proposeMutation.mutate()}
                disabled={proposeMutation.isPending}
                data-testid="button-propose"
              >
                {proposeMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Proposing…</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-1" /> {plan ? "Re-propose plan & goals (AI draft)" : "Propose plan & goals (AI draft)"}</>
                )}
              </Button>
            )}

            {/* ----- Plan card ----- */}
            {plan && (
              <Card className="border-amber-200" data-testid="plan-card">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Plan of care (individual, 1:1)</p>
                    <Badge variant={plan.status === "accepted" ? "default" : plan.status === "rejected" ? "destructive" : "secondary"} data-testid="plan-status">
                      {plan.status}
                    </Badge>
                  </div>
                  {editingPlan ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Sessions per week</Label>
                        <Input type="number" min={1} max={7} data-testid="edit-plan-sessions"
                          value={String(planEdits.sessionsPerWeek ?? plan.sessionsPerWeek)}
                          onChange={(e) => setPlanEdits({ ...planEdits, sessionsPerWeek: Number(e.target.value) })} />
                      </div>
                      <div>
                        <Label>Duration (weeks)</Label>
                        <Input type="number" min={1} data-testid="edit-plan-duration"
                          value={String(planEdits.durationWeeks ?? plan.durationWeeks)}
                          onChange={(e) => setPlanEdits({ ...planEdits, durationWeeks: Number(e.target.value) })} />
                      </div>
                      <div>
                        <Label>Start date</Label>
                        <Input type="date" data-testid="edit-plan-start"
                          value={planEdits.startDate ?? plan.startDate}
                          onChange={(e) => setPlanEdits({ ...planEdits, startDate: e.target.value })} />
                      </div>
                      <div>
                        <Label>End date</Label>
                        <Input type="date" data-testid="edit-plan-end"
                          value={planEdits.endDate ?? plan.endDate}
                          onChange={(e) => setPlanEdits({ ...planEdits, endDate: e.target.value })} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm" data-testid="plan-summary">
                      {plan.sessionsPerWeek}x per week for {plan.durationWeeks} weeks
                      {" "}({plan.startDate} to {plan.endDate})
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{plan.rationale}</p>
                  {plan.status === "proposed" && !finalized && (
                    <div className="flex gap-2">
                      <Button size="sm" data-testid="button-accept-plan"
                        disabled={planDecisionMutation.isPending}
                        onClick={() => planDecisionMutation.mutate({ action: "accept", edits: editingPlan ? planEdits : undefined })}>
                        <Check className="w-3 h-3 mr-1" /> Accept{editingPlan ? " with edits" : ""}
                      </Button>
                      <Button size="sm" variant="outline" data-testid="button-edit-plan"
                        onClick={() => { setEditingPlan(!editingPlan); setPlanEdits({}); }}>
                        <Pencil className="w-3 h-3 mr-1" /> {editingPlan ? "Cancel edit" : "Edit"}
                      </Button>
                      <Button size="sm" variant="ghost" data-testid="button-reject-plan"
                        disabled={planDecisionMutation.isPending}
                        onClick={() => planDecisionMutation.mutate({ action: "reject" })}>
                        <X className="w-3 h-3 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                  {plan.status === "accepted" && (
                    <p className="text-xs text-green-700 dark:text-green-400">
                      Added to the patient's treatment plans.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ----- Goal cards ----- */}
            {goals.map((goal, i) => (
              <Card key={i} className="border-amber-200" data-testid={`goal-card-${i}`}>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      Goal {i + 1}: {goal.skillArea}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {goal.term === "short_term" ? "Short-term" : "Long-term"} · {goal.durationWeeks} wks · {goal.startDate} to {goal.endDate}
                      </span>
                    </p>
                    <Badge variant={goal.status === "accepted" ? "default" : goal.status === "rejected" ? "destructive" : "secondary"} data-testid={`goal-status-${i}`}>
                      {goal.status}
                    </Badge>
                  </div>
                  {editingGoalIndex === i ? (
                    <div className="space-y-2">
                      <div>
                        <Label>Goal text</Label>
                        <Textarea rows={3} data-testid={`edit-goal-text-${i}`}
                          value={goalEdits.goalText ?? goal.goalText}
                          onChange={(e) => setGoalEdits({ ...goalEdits, goalText: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label>Skill area</Label>
                          <Input data-testid={`edit-goal-skill-${i}`}
                            value={goalEdits.skillArea ?? goal.skillArea}
                            onChange={(e) => setGoalEdits({ ...goalEdits, skillArea: e.target.value })} />
                        </div>
                        <div>
                          <Label>Duration (weeks)</Label>
                          <Input type="number" min={1} data-testid={`edit-goal-duration-${i}`}
                            value={String(goalEdits.durationWeeks ?? goal.durationWeeks)}
                            onChange={(e) => setGoalEdits({ ...goalEdits, durationWeeks: Number(e.target.value) })} />
                        </div>
                        <div>
                          <Label>Start date</Label>
                          <Input type="date" data-testid={`edit-goal-start-${i}`}
                            value={goalEdits.startDate ?? goal.startDate}
                            onChange={(e) => setGoalEdits({ ...goalEdits, startDate: e.target.value })} />
                        </div>
                        <div>
                          <Label>End date</Label>
                          <Input type="date" data-testid={`edit-goal-end-${i}`}
                            value={goalEdits.endDate ?? goal.endDate}
                            onChange={(e) => setGoalEdits({ ...goalEdits, endDate: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm" data-testid={`goal-text-${i}`}>{goal.goalText}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Grounding: {goal.rationale}</p>
                  {goal.status === "proposed" && !finalized && (
                    <div className="flex gap-2">
                      <Button size="sm" data-testid={`button-accept-goal-${i}`}
                        disabled={goalDecisionMutation.isPending}
                        onClick={() => goalDecisionMutation.mutate({ index: i, action: "accept", edits: editingGoalIndex === i ? goalEdits : undefined })}>
                        <Check className="w-3 h-3 mr-1" /> Accept{editingGoalIndex === i ? " with edits" : ""}
                      </Button>
                      <Button size="sm" variant="outline" data-testid={`button-edit-goal-${i}`}
                        onClick={() => {
                          setEditingGoalIndex(editingGoalIndex === i ? null : i);
                          setGoalEdits({});
                        }}>
                        <Pencil className="w-3 h-3 mr-1" /> {editingGoalIndex === i ? "Cancel edit" : "Edit"}
                      </Button>
                      <Button size="sm" variant="ghost" data-testid={`button-reject-goal-${i}`}
                        disabled={goalDecisionMutation.isPending}
                        onClick={() => goalDecisionMutation.mutate({ index: i, action: "reject" })}>
                        <X className="w-3 h-3 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                  {goal.status === "accepted" && (
                    <p className="text-xs text-green-700 dark:text-green-400">
                      Added to the treatment plan — progress charts on the Progress tab (starts at 0%).
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}

            {plan && goals.some((g) => g.status === "proposed") && !evaluation.treatmentPlanId && (
              <p className="text-xs text-muted-foreground">
                Accept the plan of care first — accepted goals are filed under it.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ==================== FINALIZE ==================== */}
      {evaluation.aiWriteUp && !finalized && (
        <div className="flex justify-end">
          <Button
            variant="default"
            onClick={() => finalizeMutation.mutate()}
            disabled={finalizeMutation.isPending}
            data-testid="button-finalize"
          >
            {finalizeMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Lock className="w-4 h-4 mr-1" />}
            Finalize evaluation
          </Button>
        </div>
      )}
    </div>
  );
}

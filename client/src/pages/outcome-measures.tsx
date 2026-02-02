import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ClipboardList,
  TrendingUp,
  TrendingDown,
  Minus,
  Plus,
  User,
  Calendar,
  BarChart3,
  AlertCircle,
  CheckCircle,
  Clock,
  FileText,
} from "lucide-react";

interface OutcomeMeasureTemplate {
  id: number;
  name: string;
  abbreviation: string;
  description?: string;
  category: string;
  questions: { id: number; text: string; options: { value: number; label: string }[] }[];
  scoringRanges: { min: number; max: number; label: string; severity: string }[];
  maxScore: number;
  isActive: boolean;
}

interface PatientAssessment {
  id: number;
  patientId: number;
  templateId: number;
  templateName?: string;
  totalScore: number;
  maxScore: number;
  severity?: string;
  responses: Record<string, number>;
  administeredBy?: string;
  assessmentDate: string;
  notes?: string;
  scoreChange?: number;
  percentChange?: number;
  trend?: string;
}

interface Patient {
  id: number;
  firstName: string;
  lastName: string;
}

interface AssessmentWithTrend {
  assessment: PatientAssessment;
  previousScore?: number;
  scoreChange?: number;
  percentChange?: number;
  trend: 'improving' | 'stable' | 'worsening';
  isSignificant: boolean;
}

export default function OutcomeMeasures() {
  const [selectedPatient, setSelectedPatient] = useState<number | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<OutcomeMeasureTemplate | null>(null);
  const [showNewAssessment, setShowNewAssessment] = useState(false);
  const [assessmentResponses, setAssessmentResponses] = useState<Record<string, number>>({});
  const [assessmentNotes, setAssessmentNotes] = useState("");
  const [detailSheet, setDetailSheet] = useState<PatientAssessment | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch templates
  const { data: templates = [] } = useQuery<OutcomeMeasureTemplate[]>({
    queryKey: ["/api/outcome-measures/templates"],
  });

  // Fetch patients
  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
  });

  // Fetch assessments for selected patient
  const { data: patientAssessments = [] } = useQuery<PatientAssessment[]>({
    queryKey: ["/api/patients", selectedPatient, "assessments"],
    queryFn: async () => {
      if (!selectedPatient) return [];
      const res = await fetch(`/api/patients/${selectedPatient}/assessments`);
      return res.json();
    },
    enabled: !!selectedPatient,
  });

  // Fetch trend analysis
  const { data: trendData } = useQuery<{
    assessments: AssessmentWithTrend[];
    summary: { averageChange: number; trend: string; significantImprovement: boolean };
  }>({
    queryKey: ["/api/patients", selectedPatient, "assessments/trends"],
    queryFn: async () => {
      if (!selectedPatient || !selectedTemplate) return null;
      const res = await fetch(
        `/api/patients/${selectedPatient}/assessments/trends?templateId=${selectedTemplate.id}`
      );
      return res.json();
    },
    enabled: !!selectedPatient && !!selectedTemplate,
  });

  // Submit assessment mutation
  const submitAssessment = useMutation({
    mutationFn: async (data: {
      patientId: number;
      templateId: number;
      responses: Record<string, number>;
      notes?: string;
    }) => {
      const res = await apiRequest("POST", "/api/assessments", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Assessment Saved", description: "The assessment has been recorded." });
      setShowNewAssessment(false);
      setAssessmentResponses({});
      setAssessmentNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/patients", selectedPatient, "assessments"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save assessment.", variant: "destructive" });
    },
  });

  const calculateScore = () => {
    return Object.values(assessmentResponses).reduce((sum, val) => sum + (val || 0), 0);
  };

  const getSeverity = (score: number, template: OutcomeMeasureTemplate) => {
    const range = template.scoringRanges.find(r => score >= r.min && score <= r.max);
    return range || { label: "Unknown", severity: "unknown" };
  };

  const getSeverityColor = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case "minimal":
      case "none":
        return "bg-green-100 text-green-800";
      case "mild":
        return "bg-yellow-100 text-yellow-800";
      case "moderate":
        return "bg-orange-100 text-orange-800";
      case "moderately severe":
      case "severe":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case "improving":
        return <TrendingDown className="w-4 h-4 text-green-600" />;
      case "worsening":
        return <TrendingUp className="w-4 h-4 text-red-600" />;
      default:
        return <Minus className="w-4 h-4 text-gray-500" />;
    }
  };

  const handleStartAssessment = (template: OutcomeMeasureTemplate) => {
    if (!selectedPatient) {
      toast({ title: "Select Patient", description: "Please select a patient first.", variant: "destructive" });
      return;
    }
    setSelectedTemplate(template);
    setAssessmentResponses({});
    setShowNewAssessment(true);
  };

  const handleSubmitAssessment = () => {
    if (!selectedPatient || !selectedTemplate) return;

    const unanswered = selectedTemplate.questions.filter(
      q => assessmentResponses[q.id] === undefined
    );

    if (unanswered.length > 0) {
      toast({
        title: "Incomplete Assessment",
        description: `Please answer all questions. ${unanswered.length} remaining.`,
        variant: "destructive",
      });
      return;
    }

    submitAssessment.mutate({
      patientId: selectedPatient,
      templateId: selectedTemplate.id,
      responses: assessmentResponses,
      notes: assessmentNotes || undefined,
    });
  };

  // Default templates if none exist
  const defaultTemplates: OutcomeMeasureTemplate[] = [
    {
      id: 1,
      name: "Patient Health Questionnaire",
      abbreviation: "PHQ-9",
      description: "Screens for depression severity",
      category: "depression",
      maxScore: 27,
      isActive: true,
      questions: [
        { id: 1, text: "Little interest or pleasure in doing things", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 2, text: "Feeling down, depressed, or hopeless", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 3, text: "Trouble falling or staying asleep, or sleeping too much", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 4, text: "Feeling tired or having little energy", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 5, text: "Poor appetite or overeating", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 6, text: "Feeling bad about yourself - or that you are a failure", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 7, text: "Trouble concentrating on things", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 8, text: "Moving or speaking slowly, or being fidgety/restless", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 9, text: "Thoughts of self-harm or being better off dead", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
      ],
      scoringRanges: [
        { min: 0, max: 4, label: "Minimal", severity: "minimal" },
        { min: 5, max: 9, label: "Mild", severity: "mild" },
        { min: 10, max: 14, label: "Moderate", severity: "moderate" },
        { min: 15, max: 19, label: "Moderately Severe", severity: "moderately severe" },
        { min: 20, max: 27, label: "Severe", severity: "severe" },
      ],
    },
    {
      id: 2,
      name: "Generalized Anxiety Disorder",
      abbreviation: "GAD-7",
      description: "Screens for anxiety severity",
      category: "anxiety",
      maxScore: 21,
      isActive: true,
      questions: [
        { id: 1, text: "Feeling nervous, anxious, or on edge", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 2, text: "Not being able to stop or control worrying", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 3, text: "Worrying too much about different things", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 4, text: "Trouble relaxing", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 5, text: "Being so restless that it's hard to sit still", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 6, text: "Becoming easily annoyed or irritable", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
        { id: 7, text: "Feeling afraid as if something awful might happen", options: [{ value: 0, label: "Not at all" }, { value: 1, label: "Several days" }, { value: 2, label: "More than half the days" }, { value: 3, label: "Nearly every day" }] },
      ],
      scoringRanges: [
        { min: 0, max: 4, label: "Minimal", severity: "minimal" },
        { min: 5, max: 9, label: "Mild", severity: "mild" },
        { min: 10, max: 14, label: "Moderate", severity: "moderate" },
        { min: 15, max: 21, label: "Severe", severity: "severe" },
      ],
    },
  ];

  const displayTemplates = templates.length > 0 ? templates : defaultTemplates;

  return (
    <div className="md:ml-64 p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Outcome Measures</h1>
        <p className="text-muted-foreground mt-1">
          Track patient progress with standardized clinical assessments
        </p>
      </div>

      {/* Patient Selection */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label>Select Patient</Label>
              <Select
                value={selectedPatient?.toString() || ""}
                onValueChange={(v) => setSelectedPatient(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a patient..." />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id.toString()}>
                      {patient.firstName} {patient.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedPatient && (
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">{patientAssessments.length}</span> assessments on file
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="administer" className="space-y-6">
        <TabsList>
          <TabsTrigger value="administer">
            <ClipboardList className="w-4 h-4 mr-2" />
            Administer
          </TabsTrigger>
          <TabsTrigger value="history">
            <FileText className="w-4 h-4 mr-2" />
            History
          </TabsTrigger>
          <TabsTrigger value="trends">
            <BarChart3 className="w-4 h-4 mr-2" />
            Trends
          </TabsTrigger>
        </TabsList>

        {/* Administer Tab */}
        <TabsContent value="administer">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {displayTemplates.map((template) => (
              <Card key={template.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{template.abbreviation}</Badge>
                    <Badge className={
                      template.category === "depression" ? "bg-blue-100 text-blue-800" :
                      template.category === "anxiety" ? "bg-purple-100 text-purple-800" :
                      "bg-gray-100 text-gray-800"
                    }>
                      {template.category}
                    </Badge>
                  </div>
                  <CardTitle className="text-lg mt-2">{template.name}</CardTitle>
                  <CardDescription>{template.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground mb-4">
                    {template.questions.length} questions · Max score: {template.maxScore}
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => handleStartAssessment(template)}
                    disabled={!selectedPatient}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Start Assessment
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          {!selectedPatient ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <User className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select a patient to view assessment history</p>
              </CardContent>
            </Card>
          ) : patientAssessments.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No assessments recorded for this patient</p>
                <Button className="mt-4" variant="outline" onClick={() => {}}>
                  Administer First Assessment
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {patientAssessments.map((assessment) => {
                const template = displayTemplates.find(t => t.id === assessment.templateId);
                const severity = template ? getSeverity(assessment.totalScore, template) : null;

                return (
                  <Card
                    key={assessment.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setDetailSheet(assessment)}
                  >
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-lg font-bold text-primary">
                              {assessment.totalScore}
                            </span>
                          </div>
                          <div>
                            <div className="font-medium">
                              {template?.abbreviation || "Assessment"} - {template?.name}
                            </div>
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                              <Calendar className="w-3 h-3" />
                              {new Date(assessment.assessmentDate).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {assessment.trend && (
                            <div className="flex items-center gap-1">
                              {getTrendIcon(assessment.trend)}
                              <span className="text-sm">
                                {assessment.scoreChange !== undefined && assessment.scoreChange !== 0 && (
                                  <span className={assessment.scoreChange < 0 ? "text-green-600" : "text-red-600"}>
                                    {assessment.scoreChange > 0 ? "+" : ""}{assessment.scoreChange}
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                          {severity && (
                            <Badge className={getSeverityColor(severity.severity)}>
                              {severity.label}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Trends Tab */}
        <TabsContent value="trends">
          {!selectedPatient ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <User className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select a patient to view trends</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                        <ClipboardList className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold">{patientAssessments.length}</div>
                        <div className="text-sm text-muted-foreground">Total Assessments</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                        <TrendingDown className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold">
                          {trendData?.summary?.averageChange !== undefined
                            ? `${trendData.summary.averageChange > 0 ? "+" : ""}${trendData.summary.averageChange.toFixed(1)}`
                            : "—"
                          }
                        </div>
                        <div className="text-sm text-muted-foreground">Avg Score Change</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        trendData?.summary?.significantImprovement
                          ? "bg-green-100"
                          : "bg-gray-100"
                      }`}>
                        {trendData?.summary?.significantImprovement ? (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        ) : (
                          <Clock className="w-5 h-5 text-gray-500" />
                        )}
                      </div>
                      <div>
                        <div className="text-lg font-semibold">
                          {trendData?.summary?.significantImprovement
                            ? "Significant Improvement"
                            : "Monitoring Progress"
                          }
                        </div>
                        <div className="text-sm text-muted-foreground">Clinical Status</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Score Timeline */}
              <Card>
                <CardHeader>
                  <CardTitle>Score Timeline</CardTitle>
                  <CardDescription>Assessment scores over time</CardDescription>
                </CardHeader>
                <CardContent>
                  {patientAssessments.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No assessment data to display
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {patientAssessments.slice(0, 10).map((assessment, index) => {
                        const template = displayTemplates.find(t => t.id === assessment.templateId);
                        const severity = template ? getSeverity(assessment.totalScore, template) : null;
                        const maxScore = template?.maxScore || 27;
                        const percentage = (assessment.totalScore / maxScore) * 100;

                        return (
                          <div key={assessment.id} className="flex items-center gap-4">
                            <div className="w-24 text-sm text-muted-foreground">
                              {new Date(assessment.assessmentDate).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric"
                              })}
                            </div>
                            <div className="w-16 text-sm font-medium">
                              {template?.abbreviation}
                            </div>
                            <div className="flex-1">
                              <div className="h-6 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    severity?.severity === "minimal" ? "bg-green-500" :
                                    severity?.severity === "mild" ? "bg-yellow-500" :
                                    severity?.severity === "moderate" ? "bg-orange-500" :
                                    "bg-red-500"
                                  }`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                            <div className="w-12 text-right font-medium">
                              {assessment.totalScore}
                            </div>
                            <Badge className={getSeverityColor(severity?.severity || "")}>
                              {severity?.label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Assessment Dialog */}
      <Dialog open={showNewAssessment} onOpenChange={setShowNewAssessment}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedTemplate?.abbreviation}: {selectedTemplate?.name}
            </DialogTitle>
            <DialogDescription>
              Over the last 2 weeks, how often have you been bothered by any of the following problems?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {selectedTemplate?.questions.map((question, qIndex) => (
              <div key={question.id} className="space-y-3">
                <Label className="text-base">
                  {qIndex + 1}. {question.text}
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {question.options.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant={assessmentResponses[question.id] === option.value ? "default" : "outline"}
                      className="justify-start h-auto py-3 px-4"
                      onClick={() => setAssessmentResponses(prev => ({
                        ...prev,
                        [question.id]: option.value
                      }))}
                    >
                      <span className="w-6 h-6 rounded-full border flex items-center justify-center mr-2 text-xs">
                        {option.value}
                      </span>
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}

            <div className="space-y-2">
              <Label>Clinical Notes (optional)</Label>
              <Input
                placeholder="Add any relevant observations..."
                value={assessmentNotes}
                onChange={(e) => setAssessmentNotes(e.target.value)}
              />
            </div>

            {/* Live Score */}
            <Card className="bg-muted/50">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Current Score</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold">{calculateScore()}</span>
                    <span className="text-muted-foreground">/ {selectedTemplate?.maxScore}</span>
                    {selectedTemplate && (
                      <Badge className={getSeverityColor(getSeverity(calculateScore(), selectedTemplate).severity)}>
                        {getSeverity(calculateScore(), selectedTemplate).label}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewAssessment(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitAssessment} disabled={submitAssessment.isPending}>
              {submitAssessment.isPending ? "Saving..." : "Save Assessment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assessment Detail Sheet */}
      <Sheet open={!!detailSheet} onOpenChange={() => setDetailSheet(null)}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle>Assessment Details</SheetTitle>
            <SheetDescription>
              {detailSheet && new Date(detailSheet.assessmentDate).toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </SheetDescription>
          </SheetHeader>

          {detailSheet && (
            <div className="mt-6 space-y-6">
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <div className="text-sm text-muted-foreground">Total Score</div>
                  <div className="text-3xl font-bold">{detailSheet.totalScore}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Severity</div>
                  <Badge className={getSeverityColor(detailSheet.severity || "")}>
                    {detailSheet.severity || "Unknown"}
                  </Badge>
                </div>
              </div>

              {detailSheet.notes && (
                <div>
                  <Label className="text-muted-foreground">Clinical Notes</Label>
                  <p className="mt-1">{detailSheet.notes}</p>
                </div>
              )}

              <div>
                <Label className="text-muted-foreground">Responses</Label>
                <div className="mt-2 space-y-2">
                  {Object.entries(detailSheet.responses || {}).map(([qId, value]) => {
                    const template = displayTemplates.find(t => t.id === detailSheet.templateId);
                    const question = template?.questions.find(q => q.id === parseInt(qId));
                    const option = question?.options.find(o => o.value === value);

                    return (
                      <div key={qId} className="flex justify-between text-sm py-1 border-b">
                        <span className="text-muted-foreground truncate flex-1 mr-2">
                          {question?.text}
                        </span>
                        <span className="font-medium">{option?.label} ({value})</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ClipboardList,
  Plus,
  Send,
  TrendingUp,
  TrendingDown,
  Minus,
  User,
  Calendar,
  BarChart3,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react";

interface SurveyQuestion {
  id: string;
  text: string;
  type: "scale" | "text" | "multiple_choice";
  options?: string[];
  required: boolean;
}

interface SurveyTemplate {
  id: number;
  practiceId: number;
  name: string;
  description: string | null;
  type: string;
  questions: SurveyQuestion[];
  isActive: boolean;
  isBuiltIn: boolean;
  createdAt: string;
}

interface SurveyResponse {
  id: number;
  surveyTemplateId: number;
  patientId: number;
  totalScore: number | null;
  severity: string | null;
  completedAt: string | null;
  templateName: string;
  templateType: string;
  patientName: string;
  responses: Array<{ questionId: string; answer: number | string }>;
}

interface SurveyAssignment {
  id: number;
  surveyTemplateId: number;
  patientId: number;
  status: string;
  dueDate: string | null;
  createdAt: string;
  templateName: string;
  templateType: string;
  patientName: string;
}

interface Patient {
  id: number;
  firstName: string;
  lastName: string;
}

interface TrendDataPoint {
  id: number;
  score: number | null;
  severity: string | null;
  completedAt: string | null;
  templateName: string | null;
}

function severityColor(severity: string | null): string {
  switch (severity) {
    case "minimal": return "bg-green-100 text-green-800";
    case "mild": return "bg-yellow-100 text-yellow-800";
    case "moderate": return "bg-orange-100 text-orange-800";
    case "moderately_severe": return "bg-red-100 text-red-700";
    case "severe": return "bg-red-200 text-red-900";
    default: return "bg-gray-100 text-gray-800";
  }
}

function severityLabel(severity: string | null): string {
  switch (severity) {
    case "minimal": return "Minimal";
    case "mild": return "Mild";
    case "moderate": return "Moderate";
    case "moderately_severe": return "Moderately Severe";
    case "severe": return "Severe";
    default: return severity || "N/A";
  }
}

function maxScoreForType(type: string): number {
  switch (type) {
    case "phq9": return 27;
    case "gad7": return 21;
    default: return 0;
  }
}

// Simple SVG line chart for score trends
function TrendChart({ data, type }: { data: TrendDataPoint[]; type: string }) {
  if (!data || data.length < 2) return null;
  const sorted = [...data].reverse(); // chronological order
  const maxScore = maxScoreForType(type) || Math.max(...sorted.map(d => d.score || 0));
  if (maxScore === 0) return null;

  const width = 400;
  const height = 150;
  const padding = 30;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  const points = sorted.map((d, i) => {
    const x = padding + (i / (sorted.length - 1)) * chartW;
    const y = padding + chartH - ((d.score || 0) / maxScore) * chartH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-md mx-auto" style={{ minWidth: 300 }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const y = padding + chartH - frac * chartH;
          return (
            <g key={frac}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#e5e7eb" strokeWidth="1" />
              <text x={padding - 5} y={y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">
                {Math.round(frac * maxScore)}
              </text>
            </g>
          );
        })}
        {/* Line */}
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2" />
        {/* Points */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="#3b82f6" stroke="white" strokeWidth="2" />
        ))}
        {/* Date labels */}
        {points.map((p, i) => {
          if (sorted.length > 6 && i % 2 !== 0) return null;
          return (
            <text key={`label-${i}`} x={p.x} y={height - 5} textAnchor="middle" fontSize="8" fill="#9ca3af">
              {p.completedAt ? new Date(p.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default function SurveysPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("templates");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<SurveyTemplate | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [patientHistoryId, setPatientHistoryId] = useState<string>("");

  // Custom template form state
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customType, setCustomType] = useState("custom");
  const [customQuestions, setCustomQuestions] = useState<SurveyQuestion[]>([
    { id: "q1", text: "", type: "scale", options: ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], required: true },
  ]);

  // Assign form state
  const [assignPatientIds, setAssignPatientIds] = useState<number[]>([]);
  const [assignDueDate, setAssignDueDate] = useState("");

  // Queries
  const { data: templates = [], isLoading: loadingTemplates } = useQuery<SurveyTemplate[]>({
    queryKey: ["/api/surveys/templates"],
  });

  const { data: responses = [], isLoading: loadingResponses } = useQuery<SurveyResponse[]>({
    queryKey: ["/api/surveys/responses"],
  });

  const { data: assignments = [], isLoading: loadingAssignments } = useQuery<SurveyAssignment[]>({
    queryKey: ["/api/surveys/assignments"],
  });

  const { data: patientsList = [] } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
    select: (data: any) => {
      if (Array.isArray(data)) return data;
      if (data?.patients) return data.patients;
      return [];
    },
  });

  const { data: patientHistory } = useQuery<{
    history: SurveyResponse[];
    trends: Record<string, TrendDataPoint[]>;
  }>({
    queryKey: ["/api/surveys/patient", patientHistoryId, "history"],
    queryFn: async () => {
      const res = await fetch(`/api/surveys/patient/${patientHistoryId}/history`, { credentials: 'include' });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!patientHistoryId,
  });

  // Mutations
  const createTemplate = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/surveys/templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/surveys/templates"] });
      setShowCreateDialog(false);
      setCustomName("");
      setCustomDescription("");
      setCustomQuestions([{ id: "q1", text: "", type: "scale", options: ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], required: true }]);
      toast({ title: "Template Created", description: "Custom survey template created successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create template.", variant: "destructive" });
    },
  });

  const assignSurvey = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/surveys/assign", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/surveys/assignments"] });
      setShowAssignDialog(false);
      setSelectedTemplate(null);
      setAssignPatientIds([]);
      setAssignDueDate("");
      toast({ title: "Survey Assigned", description: "Survey has been assigned to the selected patient(s)." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to assign survey.", variant: "destructive" });
    },
  });

  const handleCreateTemplate = () => {
    const validQuestions = customQuestions.filter(q => q.text.trim());
    if (!customName.trim() || validQuestions.length === 0) {
      toast({ title: "Validation Error", description: "Name and at least one question are required.", variant: "destructive" });
      return;
    }
    createTemplate.mutate({
      name: customName,
      description: customDescription || null,
      type: customType,
      questions: validQuestions,
    });
  };

  const handleAssignSurvey = () => {
    if (!selectedTemplate || assignPatientIds.length === 0) {
      toast({ title: "Validation Error", description: "Select a template and at least one patient.", variant: "destructive" });
      return;
    }
    assignSurvey.mutate({
      surveyTemplateId: selectedTemplate.id,
      patientIds: assignPatientIds,
      dueDate: assignDueDate || null,
    });
  };

  const addQuestion = () => {
    setCustomQuestions([...customQuestions, {
      id: `q${customQuestions.length + 1}`,
      text: "",
      type: "scale",
      options: ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"],
      required: true,
    }]);
  };

  const removeQuestion = (index: number) => {
    setCustomQuestions(customQuestions.filter((_, i) => i !== index));
  };

  const updateQuestion = (index: number, field: string, value: any) => {
    const updated = [...customQuestions];
    (updated[index] as any)[field] = value;
    setCustomQuestions(updated);
  };

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Patient Outcome Surveys
          </h1>
          <p className="text-muted-foreground mt-1">
            Send standardized assessments (PHQ-9, GAD-7) and custom satisfaction surveys to patients
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Custom Survey
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="responses">Responses</TabsTrigger>
          <TabsTrigger value="trends">Patient Trends</TabsTrigger>
        </TabsList>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-4">
          {loadingTemplates ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : templates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <ClipboardList className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold">No Survey Templates</h3>
                <p className="text-muted-foreground">Create your first custom survey or built-in templates will appear automatically.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map(template => (
                <Card key={template.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{template.name}</CardTitle>
                        <CardDescription className="mt-1">{template.description}</CardDescription>
                      </div>
                      <Badge variant={template.isBuiltIn ? "default" : "outline"}>
                        {template.isBuiltIn ? template.type.toUpperCase() : "Custom"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
                      <span>{(template.questions as SurveyQuestion[]).length} questions</span>
                      {template.type === 'phq9' && <span>Score: 0-27</span>}
                      {template.type === 'gad7' && <span>Score: 0-21</span>}
                    </div>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setSelectedTemplate(template);
                        setShowAssignDialog(true);
                      }}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Assign to Patient
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Assignments Tab */}
        <TabsContent value="assignments" className="space-y-4">
          {loadingAssignments ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : assignments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Send className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold">No Assignments</h3>
                <p className="text-muted-foreground">Assign a survey template to a patient to get started.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {assignments.map(assignment => (
                <Card key={assignment.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-full ${assignment.status === 'completed' ? 'bg-green-100' : assignment.status === 'expired' ? 'bg-red-100' : 'bg-blue-100'}`}>
                        {assignment.status === 'completed' ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : assignment.status === 'expired' ? (
                          <AlertCircle className="h-5 w-5 text-red-600" />
                        ) : (
                          <Clock className="h-5 w-5 text-blue-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{assignment.templateName}</p>
                        <p className="text-sm text-muted-foreground flex items-center gap-2">
                          <User className="h-3 w-3" />
                          {assignment.patientName}
                          {assignment.dueDate && (
                            <>
                              <Calendar className="h-3 w-3 ml-2" />
                              Due: {new Date(assignment.dueDate).toLocaleDateString()}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <Badge variant={assignment.status === 'completed' ? 'default' : assignment.status === 'expired' ? 'destructive' : 'secondary'}>
                      {assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1)}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Responses Tab */}
        <TabsContent value="responses" className="space-y-4">
          {loadingResponses ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : responses.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold">No Responses Yet</h3>
                <p className="text-muted-foreground">Responses will appear here once patients complete their surveys.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {responses.map(response => (
                <Card key={response.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{response.templateName}</p>
                        <p className="text-sm text-muted-foreground flex items-center gap-2">
                          <User className="h-3 w-3" />
                          {response.patientName}
                          <Calendar className="h-3 w-3 ml-2" />
                          {response.completedAt ? new Date(response.completedAt).toLocaleDateString() : 'N/A'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {response.totalScore !== null && (
                          <div className="text-right">
                            <p className="text-lg font-bold">{response.totalScore}/{maxScoreForType(response.templateType) || '?'}</p>
                          </div>
                        )}
                        {response.severity && (
                          <Badge className={severityColor(response.severity)}>
                            {severityLabel(response.severity)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Patient Trends Tab */}
        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Patient Assessment Trends</CardTitle>
              <CardDescription>Select a patient to view their assessment score history over time</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={patientHistoryId} onValueChange={setPatientHistoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a patient..." />
                </SelectTrigger>
                <SelectContent>
                  {patientsList.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {patientHistory && patientHistory.history.length > 0 ? (
                <div className="space-y-6">
                  {Object.entries(patientHistory.trends).map(([type, dataPoints]) => {
                    if (dataPoints.length === 0) return null;
                    const latest = dataPoints[0];
                    const prev = dataPoints.length > 1 ? dataPoints[1] : null;
                    const scoreChange = prev && latest.score !== null && prev.score !== null
                      ? latest.score - prev.score
                      : null;

                    return (
                      <Card key={type}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">
                              {latest.templateName || type.toUpperCase()}
                            </CardTitle>
                            <div className="flex items-center gap-2">
                              {latest.severity && (
                                <Badge className={severityColor(latest.severity)}>
                                  {severityLabel(latest.severity)}
                                </Badge>
                              )}
                              {scoreChange !== null && scoreChange !== 0 && (
                                <span className={`flex items-center text-sm ${scoreChange < 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {scoreChange < 0 ? <TrendingDown className="h-4 w-4 mr-1" /> : <TrendingUp className="h-4 w-4 mr-1" />}
                                  {Math.abs(scoreChange)} pts
                                </span>
                              )}
                              {scoreChange === 0 && (
                                <span className="flex items-center text-sm text-muted-foreground">
                                  <Minus className="h-4 w-4 mr-1" />
                                  No change
                                </span>
                              )}
                            </div>
                          </div>
                          <CardDescription>
                            Latest score: {latest.score ?? 'N/A'}/{maxScoreForType(type) || '?'} -- {dataPoints.length} assessment{dataPoints.length !== 1 ? 's' : ''} recorded
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <TrendChart data={dataPoints} type={type} />
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : patientHistoryId ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No assessment history for this patient.</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Custom Survey Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Custom Survey</DialogTitle>
            <DialogDescription>
              Create a custom satisfaction or assessment survey for your patients.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="survey-name">Survey Name</Label>
              <Input
                id="survey-name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g., Patient Satisfaction Survey"
              />
            </div>

            <div>
              <Label htmlFor="survey-description">Description</Label>
              <Textarea
                id="survey-description"
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="Brief description of this survey..."
              />
            </div>

            <div>
              <Label htmlFor="survey-type">Type</Label>
              <Select value={customType} onValueChange={setCustomType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom Assessment</SelectItem>
                  <SelectItem value="satisfaction">Patient Satisfaction</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Questions</Label>
                <Button variant="outline" size="sm" onClick={addQuestion}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Question
                </Button>
              </div>

              {customQuestions.map((q, i) => (
                <Card key={i}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">Q{i + 1}</span>
                      <Input
                        value={q.text}
                        onChange={(e) => updateQuestion(i, 'text', e.target.value)}
                        placeholder="Enter question text..."
                        className="flex-1"
                      />
                      <Select
                        value={q.type}
                        onValueChange={(val) => updateQuestion(i, 'type', val)}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="scale">Scale (Likert)</SelectItem>
                          <SelectItem value="text">Free Text</SelectItem>
                          <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                        </SelectContent>
                      </Select>
                      {customQuestions.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeQuestion(i)}>
                          &times;
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateTemplate} disabled={createTemplate.isPending}>
              {createTemplate.isPending ? "Creating..." : "Create Survey"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Survey Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Survey</DialogTitle>
            <DialogDescription>
              {selectedTemplate ? `Assign "${selectedTemplate.name}" to a patient` : 'Select patients to assign this survey to'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Patient</Label>
              <Select
                value={selectedPatientId}
                onValueChange={(val) => {
                  setSelectedPatientId(val);
                  setAssignPatientIds([parseInt(val)]);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a patient..." />
                </SelectTrigger>
                <SelectContent>
                  {patientsList.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="due-date">Due Date (optional)</Label>
              <Input
                id="due-date"
                type="date"
                value={assignDueDate}
                onChange={(e) => setAssignDueDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button onClick={handleAssignSurvey} disabled={assignSurvey.isPending || assignPatientIds.length === 0}>
              <Send className="h-4 w-4 mr-2" />
              {assignSurvey.isPending ? "Assigning..." : "Assign Survey"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

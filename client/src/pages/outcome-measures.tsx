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

  // Default OT-specific outcome measure templates
  const fimOptions = [
    { value: 1, label: "Total Assistance" },
    { value: 2, label: "Maximal Assistance" },
    { value: 3, label: "Moderate Assistance" },
    { value: 4, label: "Minimal Assistance" },
    { value: 5, label: "Supervision" },
    { value: 6, label: "Modified Independence" },
    { value: 7, label: "Complete Independence" },
  ];

  const barthelOptions = [
    { value: 0, label: "Unable" },
    { value: 5, label: "Needs Help" },
    { value: 10, label: "Independent" },
  ];

  const bergOptions = [
    { value: 0, label: "Unable/Lowest" },
    { value: 1, label: "Needs Assistance" },
    { value: 2, label: "Needs Supervision" },
    { value: 3, label: "Minimal Difficulty" },
    { value: 4, label: "Independent/Safe" },
  ];

  const defaultTemplates: OutcomeMeasureTemplate[] = [
    {
      id: 1,
      name: "Barthel Index",
      abbreviation: "BI",
      description: "Measures performance in basic activities of daily living",
      category: "ADL",
      maxScore: 100,
      isActive: true,
      questions: [
        { id: 1, text: "Feeding", options: [{ value: 0, label: "Unable" }, { value: 5, label: "Needs Help" }, { value: 10, label: "Independent" }] },
        { id: 2, text: "Bathing", options: [{ value: 0, label: "Dependent" }, { value: 5, label: "Independent" }] },
        { id: 3, text: "Grooming", options: [{ value: 0, label: "Needs Help" }, { value: 5, label: "Independent" }] },
        { id: 4, text: "Dressing", options: [{ value: 0, label: "Dependent" }, { value: 5, label: "Needs Help" }, { value: 10, label: "Independent" }] },
        { id: 5, text: "Bowel Control", options: [{ value: 0, label: "Incontinent" }, { value: 5, label: "Occasional Accident" }, { value: 10, label: "Continent" }] },
        { id: 6, text: "Bladder Control", options: [{ value: 0, label: "Incontinent" }, { value: 5, label: "Occasional Accident" }, { value: 10, label: "Continent" }] },
        { id: 7, text: "Toilet Use", options: [{ value: 0, label: "Dependent" }, { value: 5, label: "Needs Help" }, { value: 10, label: "Independent" }] },
        { id: 8, text: "Transfers (bed to chair)", options: [{ value: 0, label: "Unable" }, { value: 5, label: "Major Help" }, { value: 10, label: "Minor Help" }, { value: 15, label: "Independent" }] },
        { id: 9, text: "Mobility", options: [{ value: 0, label: "Immobile" }, { value: 5, label: "Wheelchair Independent" }, { value: 10, label: "Walks with Help" }, { value: 15, label: "Independent" }] },
        { id: 10, text: "Stairs", options: [{ value: 0, label: "Unable" }, { value: 5, label: "Needs Help" }, { value: 10, label: "Independent" }] },
      ],
      scoringRanges: [
        { min: 0, max: 20, label: "Total Dependence", severity: "severe" },
        { min: 21, max: 60, label: "Severe Dependence", severity: "moderately severe" },
        { min: 61, max: 90, label: "Moderate Dependence", severity: "moderate" },
        { min: 91, max: 99, label: "Slight Dependence", severity: "mild" },
        { min: 100, max: 100, label: "Independent", severity: "minimal" },
      ],
    },
    {
      id: 2,
      name: "Berg Balance Scale",
      abbreviation: "BBS",
      description: "Assesses balance and fall risk in adults",
      category: "Balance",
      maxScore: 56,
      isActive: true,
      questions: [
        { id: 1, text: "Sitting to standing", options: bergOptions },
        { id: 2, text: "Standing unsupported", options: bergOptions },
        { id: 3, text: "Sitting unsupported", options: bergOptions },
        { id: 4, text: "Standing to sitting", options: bergOptions },
        { id: 5, text: "Transfers", options: bergOptions },
        { id: 6, text: "Standing with eyes closed", options: bergOptions },
        { id: 7, text: "Standing with feet together", options: bergOptions },
        { id: 8, text: "Reaching forward with outstretched arm", options: bergOptions },
        { id: 9, text: "Retrieving object from floor", options: bergOptions },
        { id: 10, text: "Turning to look behind", options: bergOptions },
        { id: 11, text: "Turning 360 degrees", options: bergOptions },
        { id: 12, text: "Placing alternate foot on stool", options: bergOptions },
        { id: 13, text: "Standing with one foot in front", options: bergOptions },
        { id: 14, text: "Standing on one foot", options: bergOptions },
      ],
      scoringRanges: [
        { min: 0, max: 20, label: "High Fall Risk", severity: "severe" },
        { min: 21, max: 40, label: "Medium Fall Risk", severity: "moderate" },
        { min: 41, max: 56, label: "Low Fall Risk", severity: "minimal" },
      ],
    },
    {
      id: 3,
      name: "Lawton IADL Scale",
      abbreviation: "IADL",
      description: "Measures instrumental activities of daily living",
      category: "IADL",
      maxScore: 8,
      isActive: true,
      questions: [
        { id: 1, text: "Ability to use telephone", options: [{ value: 0, label: "Unable" }, { value: 1, label: "Independent" }] },
        { id: 2, text: "Shopping", options: [{ value: 0, label: "Unable" }, { value: 1, label: "Independent" }] },
        { id: 3, text: "Food preparation", options: [{ value: 0, label: "Unable" }, { value: 1, label: "Independent" }] },
        { id: 4, text: "Housekeeping", options: [{ value: 0, label: "Unable" }, { value: 1, label: "Independent" }] },
        { id: 5, text: "Laundry", options: [{ value: 0, label: "Unable" }, { value: 1, label: "Independent" }] },
        { id: 6, text: "Transportation", options: [{ value: 0, label: "Unable" }, { value: 1, label: "Independent" }] },
        { id: 7, text: "Medication management", options: [{ value: 0, label: "Unable" }, { value: 1, label: "Independent" }] },
        { id: 8, text: "Finances", options: [{ value: 0, label: "Unable" }, { value: 1, label: "Independent" }] },
      ],
      scoringRanges: [
        { min: 0, max: 2, label: "Severe Impairment", severity: "severe" },
        { min: 3, max: 5, label: "Moderate Impairment", severity: "moderate" },
        { min: 6, max: 7, label: "Mild Impairment", severity: "mild" },
        { min: 8, max: 8, label: "Independent", severity: "minimal" },
      ],
    },
    {
      id: 4,
      name: "Quick DASH",
      abbreviation: "QuickDASH",
      description: "Upper extremity functional outcome measure",
      category: "Upper Extremity",
      maxScore: 100,
      isActive: true,
      questions: [
        { id: 1, text: "Open a tight or new jar", options: [{ value: 1, label: "No Difficulty" }, { value: 2, label: "Mild" }, { value: 3, label: "Moderate" }, { value: 4, label: "Severe" }, { value: 5, label: "Unable" }] },
        { id: 2, text: "Do heavy household chores", options: [{ value: 1, label: "No Difficulty" }, { value: 2, label: "Mild" }, { value: 3, label: "Moderate" }, { value: 4, label: "Severe" }, { value: 5, label: "Unable" }] },
        { id: 3, text: "Carry a shopping bag or briefcase", options: [{ value: 1, label: "No Difficulty" }, { value: 2, label: "Mild" }, { value: 3, label: "Moderate" }, { value: 4, label: "Severe" }, { value: 5, label: "Unable" }] },
        { id: 4, text: "Wash your back", options: [{ value: 1, label: "No Difficulty" }, { value: 2, label: "Mild" }, { value: 3, label: "Moderate" }, { value: 4, label: "Severe" }, { value: 5, label: "Unable" }] },
        { id: 5, text: "Use a knife to cut food", options: [{ value: 1, label: "No Difficulty" }, { value: 2, label: "Mild" }, { value: 3, label: "Moderate" }, { value: 4, label: "Severe" }, { value: 5, label: "Unable" }] },
        { id: 6, text: "Recreational activities with arm force/impact", options: [{ value: 1, label: "No Difficulty" }, { value: 2, label: "Mild" }, { value: 3, label: "Moderate" }, { value: 4, label: "Severe" }, { value: 5, label: "Unable" }] },
        { id: 7, text: "Arm/shoulder/hand problem interfering with social activities", options: [{ value: 1, label: "Not at All" }, { value: 2, label: "Slightly" }, { value: 3, label: "Moderately" }, { value: 4, label: "Quite a Bit" }, { value: 5, label: "Extremely" }] },
        { id: 8, text: "Limited in work or daily activities", options: [{ value: 1, label: "Not at All" }, { value: 2, label: "Slightly" }, { value: 3, label: "Moderately" }, { value: 4, label: "Quite a Bit" }, { value: 5, label: "Extremely" }] },
        { id: 9, text: "Arm/shoulder/hand pain severity", options: [{ value: 1, label: "None" }, { value: 2, label: "Mild" }, { value: 3, label: "Moderate" }, { value: 4, label: "Severe" }, { value: 5, label: "Extreme" }] },
        { id: 10, text: "Tingling (pins and needles) in arm/shoulder/hand", options: [{ value: 1, label: "None" }, { value: 2, label: "Mild" }, { value: 3, label: "Moderate" }, { value: 4, label: "Severe" }, { value: 5, label: "Extreme" }] },
        { id: 11, text: "Difficulty sleeping due to pain", options: [{ value: 1, label: "No Difficulty" }, { value: 2, label: "Mild" }, { value: 3, label: "Moderate" }, { value: 4, label: "Severe" }, { value: 5, label: "Unable" }] },
      ],
      scoringRanges: [
        { min: 0, max: 25, label: "No/Minimal Disability", severity: "minimal" },
        { min: 26, max: 50, label: "Mild Disability", severity: "mild" },
        { min: 51, max: 75, label: "Moderate Disability", severity: "moderate" },
        { min: 76, max: 100, label: "Severe Disability", severity: "severe" },
      ],
    },
    {
      id: 5,
      name: "Montreal Cognitive Assessment",
      abbreviation: "MoCA",
      description: "Cognitive screening for mild cognitive impairment",
      category: "Cognitive",
      maxScore: 30,
      isActive: true,
      questions: [
        { id: 1, text: "Visuospatial/Executive (Trail Making)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 2, text: "Visuospatial/Executive (Cube Copy)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 3, text: "Visuospatial/Executive (Clock Drawing - Contour)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 4, text: "Visuospatial/Executive (Clock Drawing - Numbers)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 5, text: "Visuospatial/Executive (Clock Drawing - Hands)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 6, text: "Naming (Lion)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 7, text: "Naming (Rhinoceros)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 8, text: "Naming (Camel)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 9, text: "Attention (Digit Span Forward)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 10, text: "Attention (Digit Span Backward)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 11, text: "Attention (Vigilance)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 12, text: "Attention (Serial 7s)", options: [{ value: 0, label: "0-1 Correct" }, { value: 1, label: "2-3 Correct" }, { value: 2, label: "4-5 Correct" }, { value: 3, label: "All Correct" }] },
        { id: 13, text: "Language (Sentence Repetition 1)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 14, text: "Language (Sentence Repetition 2)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 15, text: "Language (Verbal Fluency)", options: [{ value: 0, label: "<11 words" }, { value: 1, label: "11+ words" }] },
        { id: 16, text: "Abstraction (Similarity 1)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 17, text: "Abstraction (Similarity 2)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 18, text: "Delayed Recall (Word 1)", options: [{ value: 0, label: "Not Recalled" }, { value: 1, label: "Recalled" }] },
        { id: 19, text: "Delayed Recall (Word 2)", options: [{ value: 0, label: "Not Recalled" }, { value: 1, label: "Recalled" }] },
        { id: 20, text: "Delayed Recall (Word 3)", options: [{ value: 0, label: "Not Recalled" }, { value: 1, label: "Recalled" }] },
        { id: 21, text: "Delayed Recall (Word 4)", options: [{ value: 0, label: "Not Recalled" }, { value: 1, label: "Recalled" }] },
        { id: 22, text: "Delayed Recall (Word 5)", options: [{ value: 0, label: "Not Recalled" }, { value: 1, label: "Recalled" }] },
        { id: 23, text: "Orientation (Date)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 24, text: "Orientation (Month)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 25, text: "Orientation (Year)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 26, text: "Orientation (Day)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 27, text: "Orientation (Place)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
        { id: 28, text: "Orientation (City)", options: [{ value: 0, label: "Incorrect" }, { value: 1, label: "Correct" }] },
      ],
      scoringRanges: [
        { min: 0, max: 17, label: "Moderate Impairment", severity: "severe" },
        { min: 18, max: 25, label: "Mild Cognitive Impairment", severity: "moderate" },
        { min: 26, max: 30, label: "Normal", severity: "minimal" },
      ],
    },
  ];

  const displayTemplates = templates.length > 0 ? templates : defaultTemplates;

  return (
    <div className="md:ml-64 p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Outcome Measures</h1>
        <p className="text-muted-foreground mt-1">
          Track patient functional progress with standardized OT assessments
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
                      template.category === "ADL" ? "bg-blue-100 text-blue-800" :
                      template.category === "IADL" ? "bg-purple-100 text-purple-800" :
                      template.category === "Balance" ? "bg-orange-100 text-orange-800" :
                      template.category === "Upper Extremity" ? "bg-green-100 text-green-800" :
                      template.category === "Cognitive" ? "bg-pink-100 text-pink-800" :
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

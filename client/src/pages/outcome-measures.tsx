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
      case "none":
        return "bg-emerald-100 text-emerald-800";
      case "minimal":
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

  // Standard score options for recording subtest standard scores (mean=10, SD=3)
  const standardScoreOptions = [
    { value: 1, label: "1 - Very Poor" },
    { value: 2, label: "2 - Very Poor" },
    { value: 3, label: "3 - Poor" },
    { value: 4, label: "4 - Below Average" },
    { value: 5, label: "5 - Below Average" },
    { value: 6, label: "6 - Below Average" },
    { value: 7, label: "7 - Average" },
    { value: 8, label: "8 - Average" },
    { value: 9, label: "9 - Average" },
    { value: 10, label: "10 - Average" },
    { value: 11, label: "11 - Average" },
    { value: 12, label: "12 - Above Average" },
    { value: 13, label: "13 - Above Average" },
    { value: 14, label: "14 - Above Average" },
    { value: 15, label: "15 - Superior" },
    { value: 16, label: "16 - Superior" },
    { value: 17, label: "17 - Very Superior" },
    { value: 18, label: "18 - Very Superior" },
    { value: 19, label: "19 - Very Superior" },
    { value: 20, label: "20 - Very Superior" },
  ];

  // BOT composite score options (mean=50, SD=10)
  const compositeScoreOptions = [
    { value: 20, label: "20 - Well-Below Average" },
    { value: 25, label: "25 - Well-Below Average" },
    { value: 30, label: "30 - Below Average" },
    { value: 35, label: "35 - Below Average" },
    { value: 40, label: "40 - Below Average" },
    { value: 45, label: "45 - Average" },
    { value: 50, label: "50 - Average" },
    { value: 55, label: "55 - Average" },
    { value: 60, label: "60 - Above Average" },
    { value: 65, label: "65 - Above Average" },
    { value: 70, label: "70 - Above Average" },
    { value: 75, label: "75 - Well-Above Average" },
    { value: 80, label: "80 - Well-Above Average" },
  ];

  // Peabody quotient score options (mean=100, SD=15)
  const quotientScoreOptions = [
    { value: 55, label: "55 - Very Poor" },
    { value: 60, label: "60 - Very Poor" },
    { value: 65, label: "65 - Very Poor" },
    { value: 70, label: "70 - Poor" },
    { value: 75, label: "75 - Poor" },
    { value: 80, label: "80 - Below Average" },
    { value: 85, label: "85 - Below Average" },
    { value: 90, label: "90 - Average" },
    { value: 95, label: "95 - Average" },
    { value: 100, label: "100 - Average" },
    { value: 105, label: "105 - Average" },
    { value: 110, label: "110 - Average" },
    { value: 115, label: "115 - Above Average" },
    { value: 120, label: "120 - Above Average" },
    { value: 125, label: "125 - Superior" },
    { value: 130, label: "130 - Superior" },
    { value: 135, label: "135 - Very Superior" },
    { value: 140, label: "140 - Very Superior" },
    { value: 145, label: "145 - Very Superior" },
  ];

  // Default pediatric OT outcome measure templates
  const defaultTemplates: OutcomeMeasureTemplate[] = [
    {
      id: 1,
      name: "Peabody Developmental Motor Scales (PDMS-2)",
      abbreviation: "PDMS-2",
      description: "Assesses gross and fine motor skills in children birth through 5 years. Record subtest standard scores after administering the test.",
      category: "Motor Development",
      maxScore: 120,
      isActive: true,
      questions: [
        { id: 1, text: "Reflexes (birth-11 months only, enter 0 if N/A)", options: standardScoreOptions },
        { id: 2, text: "Stationary (body control & equilibrium)", options: standardScoreOptions },
        { id: 3, text: "Locomotion (crawling, walking, running, hopping)", options: standardScoreOptions },
        { id: 4, text: "Object Manipulation (catching, throwing, kicking)", options: standardScoreOptions },
        { id: 5, text: "Grasping (hand & finger use)", options: standardScoreOptions },
        { id: 6, text: "Visual-Motor Integration (eye-hand coordination, copying, drawing)", options: standardScoreOptions },
      ],
      scoringRanges: [
        { min: 0, max: 30, label: "Very Poor", severity: "severe" },
        { min: 31, max: 48, label: "Poor", severity: "moderately severe" },
        { min: 49, max: 60, label: "Below Average", severity: "moderate" },
        { min: 61, max: 78, label: "Average", severity: "minimal" },
        { min: 79, max: 96, label: "Above Average", severity: "none" },
        { min: 97, max: 120, label: "Superior", severity: "none" },
      ],
    },
    {
      id: 2,
      name: "Peabody Developmental Motor Scales - Gross Motor Quotient",
      abbreviation: "PDMS-GMQ",
      description: "Gross Motor Quotient from PDMS-2: combines Reflexes, Stationary, Locomotion, and Object Manipulation subtest scores.",
      category: "Gross Motor",
      maxScore: 145,
      isActive: true,
      questions: [
        { id: 1, text: "Gross Motor Quotient (GMQ)", options: quotientScoreOptions },
      ],
      scoringRanges: [
        { min: 55, max: 69, label: "Very Poor", severity: "severe" },
        { min: 70, max: 79, label: "Poor", severity: "moderately severe" },
        { min: 80, max: 89, label: "Below Average", severity: "moderate" },
        { min: 90, max: 110, label: "Average", severity: "minimal" },
        { min: 111, max: 120, label: "Above Average", severity: "none" },
        { min: 121, max: 145, label: "Superior", severity: "none" },
      ],
    },
    {
      id: 3,
      name: "Peabody Developmental Motor Scales - Fine Motor Quotient",
      abbreviation: "PDMS-FMQ",
      description: "Fine Motor Quotient from PDMS-2: combines Grasping and Visual-Motor Integration subtest scores.",
      category: "Fine Motor",
      maxScore: 145,
      isActive: true,
      questions: [
        { id: 1, text: "Fine Motor Quotient (FMQ)", options: quotientScoreOptions },
      ],
      scoringRanges: [
        { min: 55, max: 69, label: "Very Poor", severity: "severe" },
        { min: 70, max: 79, label: "Poor", severity: "moderately severe" },
        { min: 80, max: 89, label: "Below Average", severity: "moderate" },
        { min: 90, max: 110, label: "Average", severity: "minimal" },
        { min: 111, max: 120, label: "Above Average", severity: "none" },
        { min: 121, max: 145, label: "Superior", severity: "none" },
      ],
    },
    {
      id: 4,
      name: "Peabody Developmental Motor Scales - Total Motor Quotient",
      abbreviation: "PDMS-TMQ",
      description: "Total Motor Quotient from PDMS-2: overall motor composite combining all subtests.",
      category: "Motor Development",
      maxScore: 145,
      isActive: true,
      questions: [
        { id: 1, text: "Total Motor Quotient (TMQ)", options: quotientScoreOptions },
      ],
      scoringRanges: [
        { min: 55, max: 69, label: "Very Poor", severity: "severe" },
        { min: 70, max: 79, label: "Poor", severity: "moderately severe" },
        { min: 80, max: 89, label: "Below Average", severity: "moderate" },
        { min: 90, max: 110, label: "Average", severity: "minimal" },
        { min: 111, max: 120, label: "Above Average", severity: "none" },
        { min: 121, max: 145, label: "Superior", severity: "none" },
      ],
    },
    {
      id: 5,
      name: "Bruininks-Oseretsky Test of Motor Proficiency (BOT-2)",
      abbreviation: "BOT-2",
      description: "Assesses fine and gross motor proficiency in individuals ages 4-21. Record subtest scale scores after administering the test.",
      category: "Motor Proficiency",
      maxScore: 160,
      isActive: true,
      questions: [
        { id: 1, text: "Fine Motor Precision (drawing, cutting, coloring within lines)", options: standardScoreOptions },
        { id: 2, text: "Fine Motor Integration (copying shapes, reproducing drawings)", options: standardScoreOptions },
        { id: 3, text: "Manual Dexterity (goal-directed hand activities, pegboard, bead stringing)", options: standardScoreOptions },
        { id: 4, text: "Bilateral Coordination (sequential & simultaneous bilateral movements)", options: standardScoreOptions },
        { id: 5, text: "Balance (static & dynamic balance activities)", options: standardScoreOptions },
        { id: 6, text: "Running Speed & Agility (shuttle run, stepping, hopping)", options: standardScoreOptions },
        { id: 7, text: "Upper-Limb Coordination (catching, throwing, dribbling)", options: standardScoreOptions },
        { id: 8, text: "Strength (push-ups, sit-ups, standing long jump)", options: standardScoreOptions },
      ],
      scoringRanges: [
        { min: 0, max: 40, label: "Well-Below Average", severity: "severe" },
        { min: 41, max: 64, label: "Below Average", severity: "moderate" },
        { min: 65, max: 96, label: "Average", severity: "minimal" },
        { min: 97, max: 120, label: "Above Average", severity: "none" },
        { min: 121, max: 160, label: "Well-Above Average", severity: "none" },
      ],
    },
    {
      id: 6,
      name: "BOT-2 Fine Manual Control Composite",
      abbreviation: "BOT-2 FMC",
      description: "Fine Manual Control composite from BOT-2: combines Fine Motor Precision and Fine Motor Integration.",
      category: "Fine Motor",
      maxScore: 80,
      isActive: true,
      questions: [
        { id: 1, text: "Fine Manual Control Composite Score", options: compositeScoreOptions },
      ],
      scoringRanges: [
        { min: 20, max: 30, label: "Well-Below Average", severity: "severe" },
        { min: 31, max: 40, label: "Below Average", severity: "moderate" },
        { min: 41, max: 59, label: "Average", severity: "minimal" },
        { min: 60, max: 69, label: "Above Average", severity: "none" },
        { min: 70, max: 80, label: "Well-Above Average", severity: "none" },
      ],
    },
    {
      id: 7,
      name: "BOT-2 Manual Coordination Composite",
      abbreviation: "BOT-2 MC",
      description: "Manual Coordination composite from BOT-2: combines Manual Dexterity and Upper-Limb Coordination.",
      category: "Motor Proficiency",
      maxScore: 80,
      isActive: true,
      questions: [
        { id: 1, text: "Manual Coordination Composite Score", options: compositeScoreOptions },
      ],
      scoringRanges: [
        { min: 20, max: 30, label: "Well-Below Average", severity: "severe" },
        { min: 31, max: 40, label: "Below Average", severity: "moderate" },
        { min: 41, max: 59, label: "Average", severity: "minimal" },
        { min: 60, max: 69, label: "Above Average", severity: "none" },
        { min: 70, max: 80, label: "Well-Above Average", severity: "none" },
      ],
    },
    {
      id: 8,
      name: "BOT-2 Body Coordination Composite",
      abbreviation: "BOT-2 BC",
      description: "Body Coordination composite from BOT-2: combines Bilateral Coordination and Balance.",
      category: "Gross Motor",
      maxScore: 80,
      isActive: true,
      questions: [
        { id: 1, text: "Body Coordination Composite Score", options: compositeScoreOptions },
      ],
      scoringRanges: [
        { min: 20, max: 30, label: "Well-Below Average", severity: "severe" },
        { min: 31, max: 40, label: "Below Average", severity: "moderate" },
        { min: 41, max: 59, label: "Average", severity: "minimal" },
        { min: 60, max: 69, label: "Above Average", severity: "none" },
        { min: 70, max: 80, label: "Well-Above Average", severity: "none" },
      ],
    },
    {
      id: 9,
      name: "BOT-2 Strength & Agility Composite",
      abbreviation: "BOT-2 SA",
      description: "Strength & Agility composite from BOT-2: combines Running Speed & Agility and Strength.",
      category: "Gross Motor",
      maxScore: 80,
      isActive: true,
      questions: [
        { id: 1, text: "Strength & Agility Composite Score", options: compositeScoreOptions },
      ],
      scoringRanges: [
        { min: 20, max: 30, label: "Well-Below Average", severity: "severe" },
        { min: 31, max: 40, label: "Below Average", severity: "moderate" },
        { min: 41, max: 59, label: "Average", severity: "minimal" },
        { min: 60, max: 69, label: "Above Average", severity: "none" },
        { min: 70, max: 80, label: "Well-Above Average", severity: "none" },
      ],
    },
    {
      id: 10,
      name: "BOT-2 Total Motor Composite",
      abbreviation: "BOT-2 TMC",
      description: "Total Motor Composite from BOT-2: overall motor proficiency combining all 8 subtests.",
      category: "Motor Proficiency",
      maxScore: 80,
      isActive: true,
      questions: [
        { id: 1, text: "Total Motor Composite Score", options: compositeScoreOptions },
      ],
      scoringRanges: [
        { min: 20, max: 30, label: "Well-Below Average", severity: "severe" },
        { min: 31, max: 40, label: "Below Average", severity: "moderate" },
        { min: 41, max: 59, label: "Average", severity: "minimal" },
        { min: 60, max: 69, label: "Above Average", severity: "none" },
        { min: 70, max: 80, label: "Well-Above Average", severity: "none" },
      ],
    },
    // ==================== BOT-3 ====================
    {
      id: 11,
      name: "Bruininks-Oseretsky Test of Motor Proficiency (BOT-3)",
      abbreviation: "BOT-3",
      description: "Updated 2023 edition. Assesses fine and gross motor proficiency in individuals ages 4-25. Record subtest scale scores after administering the test.",
      category: "Motor Proficiency",
      maxScore: 160,
      isActive: true,
      questions: [
        { id: 1, text: "Fine Motor Precision (drawing, cutting, coloring within lines)", options: standardScoreOptions },
        { id: 2, text: "Fine Motor Integration (copying shapes, reproducing drawings)", options: standardScoreOptions },
        { id: 3, text: "Manual Dexterity (goal-directed hand activities, pegboard, bead stringing)", options: standardScoreOptions },
        { id: 4, text: "Bilateral Coordination (sequential & simultaneous bilateral movements)", options: standardScoreOptions },
        { id: 5, text: "Balance (static & dynamic balance activities)", options: standardScoreOptions },
        { id: 6, text: "Running Speed & Agility (shuttle run, stepping, hopping)", options: standardScoreOptions },
        { id: 7, text: "Upper-Limb Coordination (catching, throwing, dribbling)", options: standardScoreOptions },
        { id: 8, text: "Strength (push-ups, sit-ups, standing long jump)", options: standardScoreOptions },
      ],
      scoringRanges: [
        { min: 0, max: 40, label: "Well-Below Average", severity: "severe" },
        { min: 41, max: 64, label: "Below Average", severity: "moderate" },
        { min: 65, max: 96, label: "Average", severity: "minimal" },
        { min: 97, max: 120, label: "Above Average", severity: "none" },
        { min: 121, max: 160, label: "Well-Above Average", severity: "none" },
      ],
    },
    {
      id: 12,
      name: "BOT-3 Fine Manual Control Composite",
      abbreviation: "BOT-3 FMC",
      description: "Fine Manual Control composite from BOT-3: combines Fine Motor Precision and Fine Motor Integration.",
      category: "Fine Motor",
      maxScore: 80,
      isActive: true,
      questions: [
        { id: 1, text: "Fine Manual Control Composite Score", options: compositeScoreOptions },
      ],
      scoringRanges: [
        { min: 20, max: 30, label: "Well-Below Average", severity: "severe" },
        { min: 31, max: 40, label: "Below Average", severity: "moderate" },
        { min: 41, max: 59, label: "Average", severity: "minimal" },
        { min: 60, max: 69, label: "Above Average", severity: "none" },
        { min: 70, max: 80, label: "Well-Above Average", severity: "none" },
      ],
    },
    {
      id: 13,
      name: "BOT-3 Manual Coordination Composite",
      abbreviation: "BOT-3 MC",
      description: "Manual Coordination composite from BOT-3: combines Manual Dexterity and Upper-Limb Coordination.",
      category: "Motor Proficiency",
      maxScore: 80,
      isActive: true,
      questions: [
        { id: 1, text: "Manual Coordination Composite Score", options: compositeScoreOptions },
      ],
      scoringRanges: [
        { min: 20, max: 30, label: "Well-Below Average", severity: "severe" },
        { min: 31, max: 40, label: "Below Average", severity: "moderate" },
        { min: 41, max: 59, label: "Average", severity: "minimal" },
        { min: 60, max: 69, label: "Above Average", severity: "none" },
        { min: 70, max: 80, label: "Well-Above Average", severity: "none" },
      ],
    },
    {
      id: 14,
      name: "BOT-3 Body Coordination Composite",
      abbreviation: "BOT-3 BC",
      description: "Body Coordination composite from BOT-3: combines Bilateral Coordination and Balance.",
      category: "Gross Motor",
      maxScore: 80,
      isActive: true,
      questions: [
        { id: 1, text: "Body Coordination Composite Score", options: compositeScoreOptions },
      ],
      scoringRanges: [
        { min: 20, max: 30, label: "Well-Below Average", severity: "severe" },
        { min: 31, max: 40, label: "Below Average", severity: "moderate" },
        { min: 41, max: 59, label: "Average", severity: "minimal" },
        { min: 60, max: 69, label: "Above Average", severity: "none" },
        { min: 70, max: 80, label: "Well-Above Average", severity: "none" },
      ],
    },
    {
      id: 15,
      name: "BOT-3 Strength & Agility Composite",
      abbreviation: "BOT-3 SA",
      description: "Strength & Agility composite from BOT-3: combines Running Speed & Agility and Strength.",
      category: "Gross Motor",
      maxScore: 80,
      isActive: true,
      questions: [
        { id: 1, text: "Strength & Agility Composite Score", options: compositeScoreOptions },
      ],
      scoringRanges: [
        { min: 20, max: 30, label: "Well-Below Average", severity: "severe" },
        { min: 31, max: 40, label: "Below Average", severity: "moderate" },
        { min: 41, max: 59, label: "Average", severity: "minimal" },
        { min: 60, max: 69, label: "Above Average", severity: "none" },
        { min: 70, max: 80, label: "Well-Above Average", severity: "none" },
      ],
    },
    {
      id: 16,
      name: "BOT-3 Total Motor Composite",
      abbreviation: "BOT-3 TMC",
      description: "Total Motor Composite from BOT-3: overall motor proficiency combining all 8 subtests. Updated 2023 norms, ages 4-25.",
      category: "Motor Proficiency",
      maxScore: 80,
      isActive: true,
      questions: [
        { id: 1, text: "Total Motor Composite Score", options: compositeScoreOptions },
      ],
      scoringRanges: [
        { min: 20, max: 30, label: "Well-Below Average", severity: "severe" },
        { min: 31, max: 40, label: "Below Average", severity: "moderate" },
        { min: 41, max: 59, label: "Average", severity: "minimal" },
        { min: 60, max: 69, label: "Above Average", severity: "none" },
        { min: 70, max: 80, label: "Well-Above Average", severity: "none" },
      ],
    },
  ];

  const displayTemplates = templates.length > 0 ? templates : defaultTemplates;

  return (
    <div className="md:ml-64 p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Outcome Measures</h1>
        <p className="text-muted-foreground mt-1">
          Track patient motor development with Peabody (PDMS-2) and BOT-2 assessments
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
                      template.category === "Motor Development" ? "bg-blue-100 text-blue-800" :
                      template.category === "Motor Proficiency" ? "bg-indigo-100 text-indigo-800" :
                      template.category === "Fine Motor" ? "bg-green-100 text-green-800" :
                      template.category === "Gross Motor" ? "bg-orange-100 text-orange-800" :
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

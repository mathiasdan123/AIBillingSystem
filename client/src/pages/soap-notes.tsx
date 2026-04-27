import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import AiDisclaimerBanner from "@/components/AiDisclaimerBanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText, Brain, CheckCircle, Clock, Lightbulb, Sparkles,
  Plus, X, ChevronDown, ChevronUp, Loader2, Mic, ChevronsUpDown, Check
} from "lucide-react";
import { VoiceInput } from "@/components/VoiceInput";
import { TextToSpeech } from "@/components/TextToSpeech";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { type SoapNote, type Patient, type CptCode, type TherapyBank, type ExerciseBank } from "@shared/schema";

// ============================================
// FEATURE FLAGS
// ============================================

/**
 * Show the standalone "Interventions" card under the Objective tab.
 *
 * Disabled April 2026 — the library duplicated activity-level items now
 * living in (O) Activities Performed. Flip back to true to re-enable;
 * the API, schema, and seed are all still in place.
 */
const SHOW_INTERVENTIONS_CARD = false;

// ============================================
// OT-SPECIFIC DROPDOWN OPTIONS (from OT template)
// ============================================

const MOOD_OPTIONS = [
  "Calm", "Energetic", "Distracted", "Resistant", "Cooperative",
  "Anxious", "Avoidant", "Oppositional", "Tearful", "Engaged"
];

const TARGETED_SKILLS = [
  "Postural Control", "Bilateral Coordination", "Crossing Midline",
  "Fine Motor Precision", "Grasp Strength", "Hand Endurance",
  "Visual Motor Integration", "Ocular Motor Control",
  "Sensory Regulation (calming)", "Sensory Regulation (alerting)",
  "Core Strength", "Attention / Focus", "Motor Planning",
  "Body Awareness", "Balance / Equilibrium", "ADL Independence",
  "Graphomotor", "Tool Use", "Praxis / Sequencing", "Self-Advocacy / Interoception"
];

// All activities organized by category (NO CPT codes shown - AI determines optimal billing)
// Seeded from the practice's existing OT + ST exercise library (April 2026).
// AI billing logic infers the right CPT family from the activity suffix
// (- Strength → 97110, - Coordination → 97112, - Functional → 97530,
//  - ADL → 97535, ST - … → 92507/92521-26).
const ACTIVITY_CATEGORIES = [
  {
    name: "Strengthening Activities",
    activities: [
      "WK Core / Gross Motor Play - Strength",
      "WK Feeding / Oral-Motor - Strengthening",
      "WK Fine Motor Tabletop Activities - Strenghtening",
      "WK Lycra swing - Strength/ Endurance",
      "WK Obstacle Course - Strength/ Endurance",
      "WK Platform Swing - Strength / Endurance",
      "WK Pre-Writing / Handwriting - Hand Strength/Endurance",
      "WK Pumpkin / Moon Swing - Strength",
      "WK Rope Ladder - Strengthening",
      "WK Thera-Putty - Strengthening",
      "WK Trampoline - Strengthening",
    ],
  },
  {
    name: "Balance & Motor Planning",
    activities: [
      "WK Core / Gross Motor Play - Coordination",
      "WK Fine Motor Tabletop Activities - Coordination",
      "WK Lycra swing - Neuromuscular",
      "WK Obstacle Course- Balance/Coordination",
      "WK Platform Swing - Balance",
      "WK Pre-Writing / Handwriting - Stability",
      "WK Pumpkin / Moon Swing - Core",
      "WK Rope Ladder- Postural Control",
      "WK Trampoline - Coordination",
      "WK Trampoline - Motor Planning",
      "WK Trapeze Swing - Coordination",
    ],
  },
  {
    name: "Fine Motor & ADL",
    activities: [
      "WK ADLs (Dressing / Self-Care)",
      "WK Core / Gross Motor Play - Functional",
      "WK Executive Function / Structured Play",
      "WK Feeding / Oral-Motor - ADL",
      "WK Feeding / Oral-Motor - Functional",
      "WK Fine Motor Tabletop Activities - Handwriting",
      "WK Lycra swing - Therapeutic",
      "WK Obstacle Course - Functional",
      "WK Platform Swing - Functional",
      "WK Pre-Writing / Handwriting - Functional Fine Motor",
      "WK Pumpkin / Moon Swing - Functional",
      "WK Rope Ladder - Functional",
      "WK Social Play / Turn-Taking",
      "WK Thera-Putty - Functional",
      "WK Thera-Putty - Hand manipulation",
    ],
  },
  {
    name: "Sensory & Regulation",
    activities: [
      "WK Sensory Bin / Tactile Play",
      "WK Sensory Brushing - Joint Compressions",
      "WK Sensory Brushing - Regulation to support function",
      "WK Sensory Regulation Activities - Functional",
      "WK Sensory Regulation Activities - Neuro",
    ],
  },
  {
    name: "Speech Therapy",
    activities: [
      "ST - Eval of speech sound production with evaluation of language comprehension",
      "ST - Evaluation of speech fluency",
      "ST - Evaluation of speech sound production",
      "ST - Speech, language, voice, communication therapy",
      "ST - Swallowing therapy",
    ],
  },
];

// Default rate per 15-minute unit
const DEFAULT_UNIT_RATE = 289;

// CPT Code definitions with reimbursement rates (all use $289/unit by default)
const CPT_CODE_INFO = {
  "97530": { name: "Therapeutic Activities", rate: DEFAULT_UNIT_RATE, description: "Dynamic activities to improve functional performance" },
  "97533": { name: "Sensory Integration", rate: DEFAULT_UNIT_RATE, description: "Sensory integrative techniques to enhance sensory processing" },
  "97112": { name: "Neuromuscular Re-education", rate: DEFAULT_UNIT_RATE, description: "Movement, balance, coordination, kinesthetic sense" },
  "97110": { name: "Therapeutic Exercise", rate: DEFAULT_UNIT_RATE, description: "Exercises to develop strength, endurance, flexibility" },
};

const ASSESSMENT_OPTIONS = {
  performance: ["Improved", "Stable", "Regression"],
  assistance: ["Independent", "Verbal Cues Only", "Minimal Assist", "Moderate Assist", "Maximal Assist", "Dependent"],
  strength: ["Strong", "Adequate", "Fatigued", "Weak"],
  motorPlanning: ["Intact", "Mild Difficulty", "Moderate Difficulty", "Severe Difficulty"],
  sensoryRegulation: ["Well-Regulated", "Needed Minimal Supports", "Required Frequent Supports", "Unable to Regulate"]
};

// Type for activity with full assessment
interface ActivityAssessment {
  performance: string;
  assistance: string;
  strength: string;
  motorPlanning: string;
  sensoryRegulation: string;
}

interface ActivityWithAssessment {
  name: string;
  assessment: ActivityAssessment;
}

const DEFAULT_ACTIVITY_ASSESSMENT: ActivityAssessment = {
  performance: "",
  assistance: "",
  strength: "",
  motorPlanning: "",
  sensoryRegulation: ""
};

const PLAN_OPTIONS = [
  "Continue Current Goals", "Modify Goals", "Add New Strategies",
  "Trial New Equipment", "Increase Home Program"
];

// ============================================
// MAIN COMPONENT
// ============================================

export default function SoapNotes() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();

  // Voice input toggle
  const [showVoiceInput, setShowVoiceInput] = useState(false);

  // Session info
  const [selectedPatient, setSelectedPatient] = useState<number | null>(null);
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [newPatientData, setNewPatientData] = useState({ firstName: "", lastName: "" });
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [duration, setDuration] = useState(60); // Default to 1 hour sessions
  const [sessionType, setSessionType] = useState("treatment"); // treatment, initial_eval, re_eval
  const [location, setLocation] = useState("Sensory Gym");
  const [ratePerUnit, setRatePerUnit] = useState(DEFAULT_UNIT_RATE); // $289 per 15-min unit

  // Subjective
  const [mood, setMood] = useState("");
  const [caregiverReport, setCaregiverReport] = useState("");
  const [selectedTherapies, setSelectedTherapies] = useState<string[]>([]);
  const [newTherapyInput, setNewTherapyInput] = useState("");

  // Objective - Selected activities with individual assessments
  const [selectedActivities, setSelectedActivities] = useState<ActivityWithAssessment[]>([]);
  // Intervention templates (newer system — categorized library shared
  // across practices, with practice-custom overrides). Lives alongside
  // the existing Activities picker; therapists can use either.
  const [selectedInterventions, setSelectedInterventions] = useState<string[]>([]);
  const [expandedInterventionCategories, setExpandedInterventionCategories] = useState<string[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(["Strengthening Activities"]);
  const [newExerciseInputs, setNewExerciseInputs] = useState<Record<string, string>>({});
  const [applyToAllAssessment, setApplyToAllAssessment] = useState<ActivityAssessment>({ ...DEFAULT_ACTIVITY_ASSESSMENT });

  // Assessment selections
  const [assessment, setAssessment] = useState({
    performance: "",
    assistance: "",
    strength: "",
    motorPlanning: "",
    sensoryRegulation: ""
  });

  // Plan
  const [planNextSteps, setPlanNextSteps] = useState("");
  const [nextSessionFocus, setNextSessionFocus] = useState("");
  const [homeProgram, setHomeProgram] = useState("");

  // Goal Progress tracking for SOAP note linking
  const [goalProgressEntries, setGoalProgressEntries] = useState<Array<{
    goalId: number;
    goalDescription: string;
    progressNote: string;
    progressPercentage: number;
  }>>([]);

  // AI Generated content
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedNote, setGeneratedNote] = useState<{
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    cptCodes: Array<{
      code: string;
      name: string;
      units: number;
      rationale: string;
      reimbursement: number;
      activitiesAssigned?: string[];
    }>;
    timeBlocks?: Array<{
      blockNumber: number;
      startMinute: number;
      endMinute: number;
      code: string;
      codeName: string;
      rate: number;
      activities: string[];
    }>;
    billingRationale?: string;
    auditNotes?: string[];
    totalReimbursement?: number;
  } | null>(null);

  // Post-save state: tracks the just-saved note so we can show a confirmation
  // banner with "View saved note" + "Start new note" actions instead of
  // auto-clearing. Cleared when the user starts a new note.
  const [savedNoteInfo, setSavedNoteInfo] = useState<{
    soapNoteId: number | null;
    claimNumber: string | null;
    claimAmount: string | null;
    patientName: string | null;
  } | null>(null);

  // Persist form data to localStorage
  const STORAGE_KEY = "soap-notes-draft";

  // Restore form data from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.selectedPatient) setSelectedPatient(data.selectedPatient);
        if (data.sessionDate) setSessionDate(data.sessionDate);
        if (data.duration) setDuration(data.duration);
        if (data.location) setLocation(data.location);
        if (data.mood) setMood(data.mood);
        if (data.caregiverReport) setCaregiverReport(data.caregiverReport);
        if (data.selectedActivities) setSelectedActivities(data.selectedActivities);
        if (data.selectedTherapies) setSelectedTherapies(data.selectedTherapies);
        if (Array.isArray(data.selectedInterventions)) setSelectedInterventions(data.selectedInterventions);
        if (data.assessment) setAssessment(data.assessment);
        if (data.planNextSteps) setPlanNextSteps(data.planNextSteps);
        if (data.nextSessionFocus) setNextSessionFocus(data.nextSessionFocus);
        if (data.homeProgram) setHomeProgram(data.homeProgram);
      } catch (e) {
        // Invalid saved data, ignore
      }
    }
  }, []);

  // Save form data to localStorage when it changes
  useEffect(() => {
    const data = {
      selectedPatient,
      sessionDate,
      duration,
      location,
      mood,
      caregiverReport,
      selectedActivities,
      selectedTherapies,
      selectedInterventions,
      assessment,
      planNextSteps,
      nextSessionFocus,
      homeProgram,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [selectedPatient, sessionDate, duration, location, mood, caregiverReport, selectedActivities, selectedTherapies, selectedInterventions, assessment, planNextSteps, nextSessionFocus, homeProgram]);

  const { data: patients, isLoading: patientsLoading } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
    retry: false,
  });

  const { data: cptCodes } = useQuery<CptCode[]>({
    queryKey: ["/api/cpt-codes"],
    retry: false,
  });

  const { data: existingSoapNotes } = useQuery<SoapNote[]>({
    queryKey: ["/api/soap-notes"],
    retry: false,
  });

  // Therapy Bank - practice-wide saved therapies
  const { data: therapyBank, isLoading: therapyBankLoading } = useQuery<TherapyBank[]>({
    queryKey: ["/api/therapy-bank"],
    retry: false,
  });

  // Intervention templates — system defaults + practice custom rows,
  // grouped by category. Categories come back in seed order.
  const { data: interventionTemplates } = useQuery<{
    categories: Array<{ category: string; items: Array<{ id: number; name: string; isCustom: boolean }> }>;
  }>({
    queryKey: ["/api/soap-intervention-templates"],
    retry: false,
  });
  const toggleInterventionCategory = (cat: string) => {
    setExpandedInterventionCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };
  const toggleIntervention = (name: string) => {
    setSelectedInterventions((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  // Active treatment plan with goals for selected patient
  const { data: activePlanData } = useQuery<{
    plan: any;
    goals: Array<{ id: number; goalNumber: number; description: string; status: string; progressPercentage: number | null; targetDate: string | null; objectives: any[] }>;
    interventions: any[];
  } | null>({
    queryKey: ["/api/patients", selectedPatient, "active-treatment-plan"],
    enabled: !!selectedPatient,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/patients/${selectedPatient}/active-treatment-plan`);
      return res.json();
    },
  });

  // Mutation to add new therapy to the bank
  const addTherapyMutation = useMutation({
    mutationFn: async (therapyName: string) => {
      const response = await apiRequest("POST", "/api/therapy-bank", { therapyName });
      return response.json();
    },
    onSuccess: (newTherapy: TherapyBank) => {
      queryClient.invalidateQueries({ queryKey: ["/api/therapy-bank"] });
      // Auto-select the newly added therapy
      setSelectedTherapies(prev => [...prev, newTherapy.therapyName]);
      setNewTherapyInput("");
      toast({
        title: "Therapy Added",
        description: `"${newTherapy.therapyName}" has been added to the therapy bank.`,
      });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to add therapy";
      if (message.includes("already exists")) {
        toast({
          title: "Therapy Already Exists",
          description: "This therapy is already in the bank. You can select it from the list.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });
      }
    },
  });

  // Handle adding a new therapy (typed in by user)
  const handleAddNewTherapy = () => {
    const trimmed = newTherapyInput.trim();
    if (!trimmed) return;

    // Check if already in local selection
    if (selectedTherapies.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
      toast({
        title: "Already Selected",
        description: "This therapy is already selected.",
      });
      return;
    }

    // Check if already in the bank
    const existsInBank = therapyBank?.some(t => t.therapyName.toLowerCase() === trimmed.toLowerCase());
    if (existsInBank) {
      // Just select it
      setSelectedTherapies(prev => [...prev, trimmed]);
      setNewTherapyInput("");
      return;
    }

    // Add to bank (which will auto-select on success)
    addTherapyMutation.mutate(trimmed);
  };

  // Toggle therapy selection
  const toggleTherapy = (therapyName: string) => {
    setSelectedTherapies(prev =>
      prev.includes(therapyName)
        ? prev.filter(t => t !== therapyName)
        : [...prev, therapyName]
    );
  };

  // Exercise Bank - practice-wide saved exercises for activities
  const { data: exerciseBank, isLoading: exerciseBankLoading } = useQuery<ExerciseBank[]>({
    queryKey: ["/api/exercise-bank"],
    retry: false,
  });

  // Fetch current user's signature for SOAP note signing
  const { data: therapistSignature } = useQuery<{ signature: string; name: string; credentials: string } | null>({
    queryKey: ["/api/therapists", user?.id, "signature"],
    queryFn: async () => {
      if (!user?.id) return null;
      try {
        const response = await apiRequest("GET", `/api/therapists/${user.id}/signature`);
        if (!response.ok) return null;
        return response.json();
      } catch {
        return null;
      }
    },
    enabled: !!user?.id,
    retry: false,
  });

  // Mutation to add new exercise to the bank
  const addExerciseMutation = useMutation({
    mutationFn: async ({ exerciseName, category }: { exerciseName: string; category: string }) => {
      const response = await apiRequest("POST", "/api/exercise-bank", { exerciseName, category });
      return response.json();
    },
    onSuccess: (newExercise: ExerciseBank) => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercise-bank"] });
      // Auto-select the newly added exercise
      setSelectedActivities(prev => [...prev, { name: newExercise.exerciseName, assessment: { ...DEFAULT_ACTIVITY_ASSESSMENT } }]);
      // Clear the input for that category
      setNewExerciseInputs(prev => ({ ...prev, [newExercise.category]: "" }));
      toast({
        title: "Exercise Added",
        description: `"${newExercise.exerciseName}" has been added to ${newExercise.category}.`,
      });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to add exercise";
      if (message.includes("already exists")) {
        toast({
          title: "Exercise Already Exists",
          description: "This exercise is already in the bank. You can select it from the list.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });
      }
    },
  });

  // Handle adding a new exercise to a category
  const handleAddNewExercise = (category: string) => {
    const trimmed = (newExerciseInputs[category] || "").trim();
    if (!trimmed) return;

    // Check if already in local selection
    if (selectedActivities.some(a => a.name.toLowerCase() === trimmed.toLowerCase())) {
      toast({
        title: "Already Selected",
        description: "This exercise is already selected.",
      });
      return;
    }

    // Check if already in the bank for this category
    const existsInBank = exerciseBank?.some(
      e => e.category === category && e.exerciseName.toLowerCase() === trimmed.toLowerCase()
    );
    if (existsInBank) {
      // Just select it
      setSelectedActivities(prev => [...prev, { name: trimmed, assessment: { ...DEFAULT_ACTIVITY_ASSESSMENT } }]);
      setNewExerciseInputs(prev => ({ ...prev, [category]: "" }));
      return;
    }

    // Add to bank (which will auto-select on success)
    addExerciseMutation.mutate({ exerciseName: trimmed, category });
  };

  // Get custom exercises for a category from the exercise bank
  const getCustomExercisesForCategory = (categoryName: string): string[] => {
    if (!exerciseBank) return [];
    return exerciseBank
      .filter(e => e.category === categoryName)
      .map(e => e.exerciseName);
  };

  // Handle voice/document transcription - populates structured fields
  const handleTranscription = (text: string, method: "voice" | "upload") => {
    const lowerText = text.toLowerCase();

    // Try to detect mood from transcription
    const detectedMood = MOOD_OPTIONS.find(m => lowerText.includes(m.toLowerCase()));
    if (detectedMood) {
      setMood(detectedMood);
    }

    // Try to match activities mentioned in transcription
    const allActivities = ACTIVITY_CATEGORIES.flatMap(cat => cat.activities);
    const matchedActivities = allActivities.filter(activity =>
      lowerText.includes(activity.toLowerCase().split(' – ')[0].toLowerCase())
    );
    if (matchedActivities.length > 0) {
      setSelectedActivities(prev => {
        const existingNames = prev.map(a => a.name);
        const newActivities = matchedActivities
          .filter(name => !existingNames.includes(name))
          .map(name => ({ name, assessment: { ...DEFAULT_ACTIVITY_ASSESSMENT } }));
        return [...prev, ...newActivities];
      });
    }

    // Try to detect assessment keywords
    if (lowerText.includes('improved') || lowerText.includes('progress')) {
      setAssessment(prev => ({ ...prev, performance: 'Improved' }));
    } else if (lowerText.includes('stable') || lowerText.includes('maintained')) {
      setAssessment(prev => ({ ...prev, performance: 'Stable' }));
    }

    if (lowerText.includes('independent')) {
      setAssessment(prev => ({ ...prev, assistance: 'Independent' }));
    } else if (lowerText.includes('minimal assist')) {
      setAssessment(prev => ({ ...prev, assistance: 'Minimal Assist' }));
    } else if (lowerText.includes('verbal cue')) {
      setAssessment(prev => ({ ...prev, assistance: 'Verbal Cues Only' }));
    }

    // Put any unstructured content in caregiver report
    setCaregiverReport(prev => prev ? `${prev}\n\n[${method} input]: ${text}` : `[${method} input]: ${text}`);

    toast({
      title: "Content Imported",
      description: `Extracted ${matchedActivities.length} activities and populated fields from ${method} input.`,
    });

    setShowVoiceInput(false);
  };

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories(prev =>
      prev.includes(categoryName)
        ? prev.filter(c => c !== categoryName)
        : [...prev, categoryName]
    );
  };

  const toggleActivity = (activity: string) => {
    setSelectedActivities(prev => {
      const exists = prev.find(a => a.name === activity);
      if (exists) {
        return prev.filter(a => a.name !== activity);
      } else {
        return [...prev, { name: activity, assessment: { ...DEFAULT_ACTIVITY_ASSESSMENT } }];
      }
    });
  };

  // Update a specific assessment field for an activity
  const updateActivityAssessment = (activityName: string, field: keyof ActivityAssessment, value: string) => {
    setSelectedActivities(prev =>
      prev.map(a => a.name === activityName
        ? { ...a, assessment: { ...a.assessment, [field]: value } }
        : a
      )
    );
  };

  // Apply assessment to all activities
  const applyAssessmentToAll = () => {
    // Check if at least one field is set
    const hasValue = Object.values(applyToAllAssessment).some(v => v !== "");
    if (!hasValue) return;
    setSelectedActivities(prev =>
      prev.map(a => ({ ...a, assessment: { ...applyToAllAssessment } }))
    );
  };

  // Helper to check if activity is selected
  const isActivitySelected = (activity: string) => {
    return selectedActivities.some(a => a.name === activity);
  };

  // Get patient info
  const patient = patients?.find(p => p.id === selectedPatient);

  // AI Generation - Calls the real AI backend service
  const generateNoteAndCodes = async () => {
    const hasPatient = selectedPatient || (isNewPatient && newPatientData.firstName.trim());
    if (!hasPatient || selectedActivities.length === 0) {
      toast({
        title: "Missing Information",
        description: "Please select a patient and at least one activity.",
        variant: "destructive",
      });
      return;
    }

    if (duration < 15) {
      toast({
        title: "Invalid Duration",
        description: "Session duration must be at least 15 minutes.",
        variant: "destructive",
      });
      return;
    }

    if (!nextSessionFocus.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter the Next Session Focus.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);

    try {
      // Call the AI backend service
      const response = await apiRequest("POST", "/api/ai/generate-soap-billing", {
        patientId: selectedPatient || 0,
        activities: selectedActivities.map(a => a.name), // Activity names for backward compatibility
        activityAssessments: selectedActivities, // Full activity objects with assessments
        additionalTherapies: selectedTherapies.length > 0 ? selectedTherapies : undefined,
        interventions: selectedInterventions.length > 0 ? selectedInterventions : undefined,
        mood: mood || "Cooperative",
        caregiverReport: caregiverReport || undefined,
        duration,
        sessionType,
        location,
        assessment: {
          performance: assessment.performance || "Stable",
          assistance: assessment.assistance || "Minimal Assist",
          strength: assessment.strength || "Adequate",
          motorPlanning: assessment.motorPlanning || "Mild Difficulty",
          sensoryRegulation: assessment.sensoryRegulation || "Needed Minimal Supports"
        },
        planNextSteps: planNextSteps || "Continue Current Goals",
        nextSessionFocus: nextSessionFocus,
        homeProgram: homeProgram || undefined,
        ratePerUnit: ratePerUnit // Manual rate override
      });

      const aiResponse = await response.json() as {
        subjective: string;
        objective: string;
        assessment: string;
        plan: string;
        cptCodes: Array<{
          code: string;
          name: string;
          units: number;
          rationale: string;
          reimbursement: number;
          activitiesAssigned?: string[];
        }>;
        timeBlocks: Array<{
          blockNumber: number;
          startMinute: number;
          endMinute: number;
          code: string;
          codeName: string;
          rate: number;
          activities: string[];
        }>;
        totalReimbursement: number;
        billingRationale: string;
        auditNotes: string[];
      };

      setGeneratedNote({
        subjective: aiResponse.subjective || "",
        objective: aiResponse.objective || "",
        assessment: aiResponse.assessment || "",
        plan: aiResponse.plan || "",
        cptCodes: aiResponse.cptCodes || [],
        timeBlocks: aiResponse.timeBlocks || [],
        totalReimbursement: aiResponse.totalReimbursement || 0,
        billingRationale: aiResponse.billingRationale || "",
        auditNotes: aiResponse.auditNotes || []
      });

      toast({
        title: "AI Generated Note & Codes",
        description: isAdmin
          ? `Generated SOAP note with ${(aiResponse.cptCodes || []).length} suggested CPT codes. Est. reimbursement: $${(aiResponse.totalReimbursement || 0).toFixed(2)}`
          : `Generated SOAP note with ${(aiResponse.cptCodes || []).length} suggested CPT codes.`,
      });

    } catch (error) {
      console.error("AI generation error:", error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Unable to generate note. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const createSoapNoteMutation = useMutation({
    mutationFn: async () => {
      if (!generatedNote || (!selectedPatient && !isNewPatient)) return;

      let patientId = selectedPatient;

      // If creating a new patient, do that first
      if (isNewPatient && newPatientData.firstName.trim() && newPatientData.lastName.trim()) {
        const res = await apiRequest("POST", "/api/patients", {
          firstName: newPatientData.firstName.trim(),
          lastName: newPatientData.lastName.trim(),
          dateOfBirth: "2000-01-01",
          practiceId: 1,
        });
        const newPatient = await res.json();
        patientId = newPatient.id;
        setSelectedPatient(patientId);
        setIsNewPatient(false);
        setNewPatientData({ firstName: "", lastName: "" });
        queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      }

      if (!patientId) return;

      const primaryCode = generatedNote.cptCodes[0]?.code || "97530";

      const sessionData = {
        practiceId: 1,
        patientId,
        therapistId: user?.id || "",
        sessionDate,
        duration,
        cptCodeId: cptCodes?.find(c => c.code === primaryCode)?.id || 1,
        icd10CodeId: 1,
        units: (generatedNote.cptCodes || []).reduce((sum, c) => sum + c.units, 0),
        notes: `SUBJECTIVE:\n${generatedNote.subjective}\n\nOBJECTIVE:\n${generatedNote.objective}\n\nASSESSMENT:\n${generatedNote.assessment}\n\nPLAN:\n${generatedNote.plan}`,
        status: "completed",
        dataSource: "ai_generated",
      };

      const sessionResponse = await apiRequest("POST", "/api/sessions", sessionData);
      const session = await sessionResponse.json();

      const soapNoteData = {
        patientId,
        sessionId: session.id,
        subjective: generatedNote.subjective,
        objective: generatedNote.objective,
        assessment: generatedNote.assessment,
        plan: generatedNote.plan,
        location,
        sessionType: "individual",
        dataSource: "ai_generated",
        aiSuggestedCptCodes: generatedNote.cptCodes || [],
        // Persist the picked intervention names alongside the note so the
        // chart history shows them and analytics can later count usage.
        interventions: selectedInterventions.length > 0 ? selectedInterventions : undefined,
      };

      const soapNoteResponse = await apiRequest("POST", "/api/soap-notes", soapNoteData);
      const savedSoapNote = await soapNoteResponse.json();

      // Link goal progress entries to the SOAP note if any were tracked
      if (goalProgressEntries.length > 0 && savedSoapNote?.id) {
        try {
          await apiRequest("POST", `/api/soap-notes/${savedSoapNote.id}/goal-progress`, {
            goalProgressEntries: goalProgressEntries.map(e => ({
              goalId: e.goalId,
              progressNote: e.progressNote,
              progressPercentage: e.progressPercentage,
            })),
          });
        } catch (goalError) {
          console.error("Failed to save goal progress entries:", goalError);
        }
      }

      // Auto-generate claim for the session
      try {
        const claimResponse = await apiRequest("POST", `/api/sessions/${session.id}/generate-claim`, {});
        const claim = await claimResponse.json();
        return { session, claim, savedSoapNote };
      } catch (claimError) {
        // Claim generation failed but SOAP note saved - return session only
        console.error("Auto-claim generation failed:", claimError);
        return { session, claim: null, savedSoapNote };
      }
    },
    onSuccess: (result) => {
      const hasClaim = result?.claim && !result.claim.error;
      toast({
        title: hasClaim ? "SOAP Note Saved & Claim Created" : "SOAP Note Saved",
        description: hasClaim
          ? `Claim ${result.claim.claimNumber} created for $${result.claim.totalAmount}. Ready for submission.`
          : "Session documented. Claim can be generated from the Claims page.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/soap-notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      // Clear saved draft so a future refresh doesn't re-populate old data.
      localStorage.removeItem(STORAGE_KEY);
      // Record the saved-note info so the confirmation banner can render.
      // Form state is intentionally kept populated so the therapist can
      // review what they just saved; "Start new note" explicitly clears it.
      const patientName = patients?.find(p => p.id === selectedPatient);
      setSavedNoteInfo({
        soapNoteId: result?.savedSoapNote?.id ?? null,
        claimNumber: hasClaim ? result.claim.claimNumber : null,
        claimAmount: hasClaim ? result.claim.totalAmount : null,
        patientName: patientName ? `${patientName.firstName} ${patientName.lastName}` : null,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save SOAP note.",
        variant: "destructive",
      });
    },
  });

  if (patientsLoading) {
    return (
      <div className="md:ml-64 min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!patients || patients.length === 0) {
    return (
      <div className="md:ml-64 min-h-screen bg-slate-50 p-8">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>No Patients Found</CardTitle>
            <CardDescription>Add patients before creating SOAP notes.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.href = '/intake'} className="w-full">
              Add New Patient
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalReimbursement = generatedNote?.cptCodes?.reduce((sum, c) => sum + c.reimbursement, 0) || 0;

  return (
    <div className="md:ml-64 min-h-screen bg-slate-50">
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <FileText className="w-6 h-6 text-blue-600" />
              Pediatric OT Documentation
            </h1>
            <p className="text-muted-foreground mt-1">
              Select activities performed &rarr; AI generates notes & optimal billing codes
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowVoiceInput(!showVoiceInput)}
            data-testid="button-toggle-voice-input"
          >
            <Mic className="w-4 h-4 mr-2" />
            Voice & Upload
          </Button>
        </div>

        <AiDisclaimerBanner />

        {/* Post-save confirmation banner */}
        {savedNoteInfo && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-[220px]">
                <div className="text-sm font-semibold text-green-800">
                  SOAP Note Saved
                  {savedNoteInfo.patientName ? ` — ${savedNoteInfo.patientName}` : ""}
                </div>
                <div className="text-xs text-green-700 mt-0.5">
                  {savedNoteInfo.claimNumber
                    ? `Claim ${savedNoteInfo.claimNumber} created for $${savedNoteInfo.claimAmount}. Ready for submission.`
                    : "Session documented. Claim can be generated from the Claims page."}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    document
                      .getElementById("generated-note-section")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  data-testid="button-view-saved-note"
                >
                  View saved note
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setSelectedPatient(null);
                    setMood("");
                    setCaregiverReport("");
                    setSelectedActivities([]);
                    setSelectedTherapies([]);
                    setAssessment({
                      performance: "",
                      assistance: "",
                      strength: "",
                      motorPlanning: "",
                      sensoryRegulation: "",
                    });
                    setPlanNextSteps("");
                    setNextSessionFocus("");
                    setHomeProgram("");
                    setGoalProgressEntries([]);
                    setGeneratedNote(null);
                    setSavedNoteInfo(null);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  data-testid="button-start-new-note"
                >
                  Start new note
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Voice Input Section */}
        {showVoiceInput && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Voice Dictation & Document Upload</CardTitle>
              <CardDescription>
                Dictate session notes or upload documents. AI will extract activities, mood, and assessment data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VoiceInput
                onTranscription={handleTranscription}
                disabled={!selectedPatient && !(isNewPatient && newPatientData.firstName.trim())}
              />
              {!selectedPatient && !(isNewPatient && newPatientData.firstName.trim()) && (
                <p className="text-sm text-amber-600 mt-2">Please select a patient first.</p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Input */}
          <div className="lg:col-span-2 space-y-4">

            {/* Session Info Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Session Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Patient</Label>
                    {isNewPatient ? (
                      <div className="mt-1 space-y-1">
                        <div className="flex gap-1">
                          <Input
                            placeholder="First"
                            value={newPatientData.firstName}
                            onChange={(e) => setNewPatientData({ ...newPatientData, firstName: e.target.value })}
                            className="h-9 text-sm"
                          />
                          <Input
                            placeholder="Last"
                            value={newPatientData.lastName}
                            onChange={(e) => setNewPatientData({ ...newPatientData, lastName: e.target.value })}
                            className="h-9 text-sm"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs h-6 px-1"
                          onClick={() => {
                            setIsNewPatient(false);
                            setNewPatientData({ firstName: "", lastName: "" });
                          }}
                        >
                          Select existing
                        </Button>
                      </div>
                    ) : (
                      <Popover open={patientSearchOpen} onOpenChange={setPatientSearchOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={patientSearchOpen}
                            className="w-full justify-between font-normal mt-1 h-9 text-sm"
                          >
                            {selectedPatient
                              ? (() => {
                                  const p = patients?.find((p: any) => p.id === selectedPatient);
                                  return p ? `${p.firstName} ${p.lastName}` : "Select";
                                })()
                              : "Search patient..."}
                            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command>
                            <CommandInput
                              placeholder="Type a name to search..."
                              value={patientSearch}
                              onValueChange={setPatientSearch}
                            />
                            <CommandList>
                              <CommandEmpty>
                                <div className="text-center py-2 space-y-2">
                                  {patientSearch.trim() && (
                                    <Button
                                      type="button"
                                      variant="default"
                                      size="sm"
                                      className="w-full"
                                      onClick={() => {
                                        const parts = patientSearch.trim().split(/\s+/);
                                        const firstName = parts[0] || "";
                                        const lastName = parts.slice(1).join(" ") || "";
                                        setIsNewPatient(true);
                                        setNewPatientData({ firstName, lastName });
                                        setSelectedPatient(null);
                                        setPatientSearchOpen(false);
                                        setPatientSearch("");
                                      }}
                                    >
                                      <Plus className="mr-1 h-3 w-3" />
                                      Create new patient: "{patientSearch.trim()}"
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setIsNewPatient(true);
                                      setPatientSearchOpen(false);
                                      setPatientSearch("");
                                    }}
                                  >
                                    <Plus className="mr-1 h-3 w-3" />
                                    Add New Patient Manually
                                  </Button>
                                </div>
                              </CommandEmpty>
                              <CommandGroup>
                                {patients?.map((p: any) => (
                                  <CommandItem
                                    key={p.id}
                                    value={`${p.firstName} ${p.lastName}`}
                                    onSelect={() => {
                                      setSelectedPatient(p.id);
                                      setPatientSearchOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={`mr-2 h-4 w-4 ${
                                        selectedPatient === p.id ? "opacity-100" : "opacity-0"
                                      }`}
                                    />
                                    {p.firstName} {p.lastName}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Date</Label>
                    <Input
                      type="date"
                      value={sessionDate}
                      onChange={(e) => setSessionDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Duration</Label>
                    <Select value={duration.toString()} onValueChange={(v) => setDuration(parseInt(v))}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 min (2 units)</SelectItem>
                        <SelectItem value="45">45 min (3 units)</SelectItem>
                        <SelectItem value="60">60 min (4 units)</SelectItem>
                        <SelectItem value="90">90 min (6 units)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Session Type</Label>
                    <Select value={sessionType} onValueChange={(v) => {
                      setSessionType(v);
                      if (v === 'initial_eval') setRatePerUnit(550);
                      else if (v === 're_eval') setRatePerUnit(400);
                      else setRatePerUnit(DEFAULT_UNIT_RATE);
                    }}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="treatment">Treatment Session</SelectItem>
                        <SelectItem value="initial_eval">Initial Evaluation ($550)</SelectItem>
                        <SelectItem value="re_eval">Re-Evaluation ($400)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Location</Label>
                    <Select value={location} onValueChange={setLocation}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Sensory Gym">Sensory Gym</SelectItem>
                        <SelectItem value="Clinic Room">Clinic Room</SelectItem>
                        <SelectItem value="Home Visit">Home Visit</SelectItem>
                        <SelectItem value="School">School</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {isAdmin && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Rate/Unit ($)</Label>
                      <Input
                        type="number"
                        value={ratePerUnit}
                        onChange={(e) => setRatePerUnit(parseFloat(e.target.value) || DEFAULT_UNIT_RATE)}
                        className="mt-1"
                        min={0}
                        step={0.01}
                      />
                    </div>
                  )}
                </div>

                {/* Billing Summary - Admin Only */}
                {isAdmin && (
                  <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {Math.floor(duration / 15)} units × ${ratePerUnit.toFixed(2)}/unit
                      </span>
                      <span className="font-bold text-green-700">
                        Est. Total: ${(Math.floor(duration / 15) * ratePerUnit).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {patient && (
                  <div className="mt-3 p-2 bg-blue-50 rounded-lg flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {patient.insuranceProvider}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Policy: {patient.policyNumber}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Subjective Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold">S</span>
                  Subjective
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Mood/Behavior</Label>
                  <Select value={mood} onValueChange={setMood}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select mood observed" />
                    </SelectTrigger>
                    <SelectContent>
                      {MOOD_OPTIONS.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Additional Comments */}
                <div>
                  <Label className="text-xs text-muted-foreground">Additional Comments</Label>
                  <Textarea
                    placeholder="Any additional observations or comments about the session..."
                    value={selectedTherapies.join('\n')}
                    onChange={(e) => setSelectedTherapies(e.target.value ? [e.target.value] : [])}
                    className="mt-1 min-h-[60px]"
                  />
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Caregiver Report (optional)</Label>
                  <Textarea
                    placeholder="Any specific concerns or updates from caregiver..."
                    value={caregiverReport}
                    onChange={(e) => setCaregiverReport(e.target.value)}
                    className="mt-1 min-h-[60px]"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Objective - Activity Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-green-100 text-green-700 flex items-center justify-center text-sm font-bold">O</span>
                    Activities Performed
                  </div>
                  {selectedActivities.length > 0 && (
                    <Badge className="bg-green-600">{selectedActivities.length} selected</Badge>
                  )}
                </CardTitle>
                <CardDescription>Select all activities performed during this session</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {ACTIVITY_CATEGORIES.map((category) => (
                    <div key={category.name} className="border rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleCategory(category.name)}
                        className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{category.name}</span>
                          {(() => {
                            const customExercises = getCustomExercisesForCategory(category.name);
                            const allCategoryActivities = [...category.activities, ...customExercises];
                            const selectedCount = selectedActivities.filter(a => allCategoryActivities.includes(a.name)).length;
                            return selectedCount > 0 && (
                              <Badge className="bg-green-100 text-green-700 text-xs">
                                {selectedCount}
                              </Badge>
                            );
                          })()}
                        </div>
                        {expandedCategories.includes(category.name) ? (
                          <ChevronUp className="w-4 h-4 text-muted-foreground/70" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted-foreground/70" />
                        )}
                      </button>

                      {expandedCategories.includes(category.name) && (
                        <div className="p-3">
                          {/* Built-in activities */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-48 overflow-y-auto">
                            {category.activities.map((activity) => (
                              <label
                                key={activity}
                                className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm transition-colors ${
                                  isActivitySelected(activity)
                                    ? "bg-green-50 text-green-800"
                                    : "hover:bg-slate-50"
                                }`}
                              >
                                <Checkbox
                                  checked={isActivitySelected(activity)}
                                  onCheckedChange={() => toggleActivity(activity)}
                                />
                                <span className="text-xs">{activity}</span>
                              </label>
                            ))}
                            {/* Custom exercises from exercise bank */}
                            {getCustomExercisesForCategory(category.name).map((exercise) => (
                              <label
                                key={`custom-${exercise}`}
                                className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm transition-colors ${
                                  isActivitySelected(exercise)
                                    ? "bg-blue-50 text-blue-800"
                                    : "hover:bg-slate-50"
                                }`}
                              >
                                <Checkbox
                                  checked={isActivitySelected(exercise)}
                                  onCheckedChange={() => toggleActivity(exercise)}
                                />
                                <span className="text-xs">{exercise}</span>
                                <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto">Custom</Badge>
                              </label>
                            ))}
                          </div>

                          {/* Add new exercise input */}
                          <div className="mt-3 pt-3 border-t">
                            <Label className="text-xs text-muted-foreground mb-1 block">Add Custom Exercise</Label>
                            <div className="flex gap-2">
                              <Input
                                placeholder="Type exercise name..."
                                value={newExerciseInputs[category.name] || ""}
                                onChange={(e) => setNewExerciseInputs(prev => ({
                                  ...prev,
                                  [category.name]: e.target.value
                                }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddNewExercise(category.name);
                                  }
                                }}
                                className="flex-1 h-8 text-xs"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleAddNewExercise(category.name)}
                                disabled={!(newExerciseInputs[category.name] || "").trim() || addExerciseMutation.isPending}
                                className="h-8"
                              >
                                {addExerciseMutation.isPending ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Plus className="w-3 h-3" />
                                )}
                              </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground/70 mt-1">
                              Added exercises will be saved and available for future sessions
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {selectedActivities.length > 0 && (
                  <div className="mt-4 space-y-4">
                    {/* Apply to All Section */}
                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium text-blue-800">Apply Same Assessment to All Exercises</Label>
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs"
                          onClick={applyAssessmentToAll}
                        >
                          Apply to All
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        <div>
                          <Label className="text-[10px] text-blue-600">Performance</Label>
                          <Select value={applyToAllAssessment.performance} onValueChange={(v) => setApplyToAllAssessment(prev => ({ ...prev, performance: v }))}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {ASSESSMENT_OPTIONS.performance.map((o) => (
                                <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px] text-blue-600">Assistance</Label>
                          <Select value={applyToAllAssessment.assistance} onValueChange={(v) => setApplyToAllAssessment(prev => ({ ...prev, assistance: v }))}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {ASSESSMENT_OPTIONS.assistance.map((o) => (
                                <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px] text-blue-600">Strength</Label>
                          <Select value={applyToAllAssessment.strength} onValueChange={(v) => setApplyToAllAssessment(prev => ({ ...prev, strength: v }))}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {ASSESSMENT_OPTIONS.strength.map((o) => (
                                <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px] text-blue-600">Motor Planning</Label>
                          <Select value={applyToAllAssessment.motorPlanning} onValueChange={(v) => setApplyToAllAssessment(prev => ({ ...prev, motorPlanning: v }))}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {ASSESSMENT_OPTIONS.motorPlanning.map((o) => (
                                <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px] text-blue-600">Sensory Reg.</Label>
                          <Select value={applyToAllAssessment.sensoryRegulation} onValueChange={(v) => setApplyToAllAssessment(prev => ({ ...prev, sensoryRegulation: v }))}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {ASSESSMENT_OPTIONS.sensoryRegulation.map((o) => (
                                <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    {/* Individual Exercise Assessments */}
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-foreground">Individual Exercise Assessments</Label>
                      {selectedActivities.map((activity) => (
                        <div
                          key={activity.name}
                          className="p-3 bg-green-50 rounded-lg border border-green-200"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-green-800">{activity.name}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => toggleActivity(activity.name)}
                            >
                              <X className="w-3 h-3 mr-1" />
                              <span className="text-xs">Remove</span>
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            <div>
                              <Label className="text-[10px] text-green-600">Performance</Label>
                              <Select value={activity.assessment.performance} onValueChange={(v) => updateActivityAssessment(activity.name, 'performance', v)}>
                                <SelectTrigger className="h-7 text-xs bg-card">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSESSMENT_OPTIONS.performance.map((o) => (
                                    <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-[10px] text-green-600">Assistance</Label>
                              <Select value={activity.assessment.assistance} onValueChange={(v) => updateActivityAssessment(activity.name, 'assistance', v)}>
                                <SelectTrigger className="h-7 text-xs bg-card">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSESSMENT_OPTIONS.assistance.map((o) => (
                                    <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-[10px] text-green-600">Strength</Label>
                              <Select value={activity.assessment.strength} onValueChange={(v) => updateActivityAssessment(activity.name, 'strength', v)}>
                                <SelectTrigger className="h-7 text-xs bg-card">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSESSMENT_OPTIONS.strength.map((o) => (
                                    <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-[10px] text-green-600">Motor Planning</Label>
                              <Select value={activity.assessment.motorPlanning} onValueChange={(v) => updateActivityAssessment(activity.name, 'motorPlanning', v)}>
                                <SelectTrigger className="h-7 text-xs bg-card">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSESSMENT_OPTIONS.motorPlanning.map((o) => (
                                    <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-[10px] text-green-600">Sensory Reg.</Label>
                              <Select value={activity.assessment.sensoryRegulation} onValueChange={(v) => updateActivityAssessment(activity.name, 'sensoryRegulation', v)}>
                                <SelectTrigger className="h-7 text-xs bg-card">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSESSMENT_OPTIONS.sensoryRegulation.map((o) => (
                                    <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Interventions Library — HIDDEN April 2026.
             *
             * The library duplicated activity-level items that now live
             * exclusively in (O) Activities Performed. We're keeping the
             * JSX, the API endpoint, the schema table, and the seed in
             * place so this card can be re-enabled later (e.g. for
             * higher-level templates: caregiver education, HEP, AAC
             * setup) by flipping SHOW_INTERVENTIONS_CARD back to true.
             * Don't delete this block — it's the cheapest way to bring
             * the feature back if/when needed.
             */}
            {SHOW_INTERVENTIONS_CARD && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold">+</span>
                    Interventions
                  </div>
                  {selectedInterventions.length > 0 && (
                    <Badge className="bg-emerald-600">{selectedInterventions.length} selected</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Higher-level intervention library. Practice admins can add custom items in Settings.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {interventionTemplates?.categories?.length ? (
                  <div className="space-y-2">
                    {interventionTemplates.categories.map((cat) => {
                      const expanded = expandedInterventionCategories.includes(cat.category);
                      const selectedCount = cat.items.filter((i) => selectedInterventions.includes(i.name)).length;
                      return (
                        <div key={cat.category} className="border rounded-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => toggleInterventionCategory(cat.category)}
                            className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{cat.category}</span>
                              {selectedCount > 0 && (
                                <Badge className="bg-emerald-100 text-emerald-700 text-xs">
                                  {selectedCount}
                                </Badge>
                              )}
                            </div>
                            {expanded ? (
                              <ChevronUp className="w-4 h-4 text-muted-foreground/70" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-muted-foreground/70" />
                            )}
                          </button>
                          {expanded && (
                            <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-1">
                              {cat.items.map((item) => {
                                const checked = selectedInterventions.includes(item.name);
                                return (
                                  <label
                                    key={item.id}
                                    className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm transition-colors ${
                                      checked ? "bg-emerald-50 text-emerald-800" : "hover:bg-slate-50"
                                    }`}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => toggleIntervention(item.name)}
                                    />
                                    <span className="text-xs flex-1">{item.name}</span>
                                    {item.isCustom && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0">Custom</Badge>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Loading intervention library…</p>
                )}
              </CardContent>
            </Card>
            )}

            {/* Assessment Quick Selections */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-bold">A</span>
                  Assessment
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Performance</Label>
                    <Select value={assessment.performance} onValueChange={(v) => setAssessment({...assessment, performance: v})}>
                      <SelectTrigger className="mt-1 text-xs">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSESSMENT_OPTIONS.performance.map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Assistance</Label>
                    <Select value={assessment.assistance} onValueChange={(v) => setAssessment({...assessment, assistance: v})}>
                      <SelectTrigger className="mt-1 text-xs">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSESSMENT_OPTIONS.assistance.map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Strength</Label>
                    <Select value={assessment.strength} onValueChange={(v) => setAssessment({...assessment, strength: v})}>
                      <SelectTrigger className="mt-1 text-xs">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSESSMENT_OPTIONS.strength.map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Motor Planning</Label>
                    <Select value={assessment.motorPlanning} onValueChange={(v) => setAssessment({...assessment, motorPlanning: v})}>
                      <SelectTrigger className="mt-1 text-xs">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSESSMENT_OPTIONS.motorPlanning.map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs text-muted-foreground">Sensory Regulation</Label>
                    <Select value={assessment.sensoryRegulation} onValueChange={(v) => setAssessment({...assessment, sensoryRegulation: v})}>
                      <SelectTrigger className="mt-1 text-xs">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSESSMENT_OPTIONS.sensoryRegulation.map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Plan */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-bold">P</span>
                  Plan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Plan Next Steps</Label>
                  <Select value={planNextSteps} onValueChange={setPlanNextSteps}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select next steps" />
                    </SelectTrigger>
                    <SelectContent>
                      {PLAN_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Next Session Focus <span className="text-red-500">*</span></Label>
                  <Textarea
                    placeholder="Areas to target next session..."
                    value={nextSessionFocus}
                    onChange={(e) => setNextSessionFocus(e.target.value)}
                    className="mt-1 min-h-[50px]"
                    required
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Home Program (optional)</Label>
                  <Textarea
                    placeholder="Recommendations for caregiver/home activities..."
                    value={homeProgram}
                    onChange={(e) => setHomeProgram(e.target.value)}
                    className="mt-1 min-h-[50px]"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Goal Progress Section */}
            {activePlanData && activePlanData.goals && activePlanData.goals.length > 0 && (
              <Card className="border-indigo-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold">G</span>
                    Goal Progress
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Track progress on treatment goals for this session
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {activePlanData.goals.map((goal) => {
                    const existingEntry = goalProgressEntries.find(e => e.goalId === goal.id);
                    const isTracked = !!existingEntry;

                    return (
                      <div
                        key={goal.id}
                        className={`border rounded-lg p-3 transition-colors ${
                          isTracked ? "border-indigo-300 bg-indigo-50 dark:bg-indigo-950/20" : "border-slate-200"
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-muted-foreground/70">GOAL {goal.goalNumber}</span>
                              <Badge variant="outline" className="text-xs">
                                {goal.status ? goal.status.replace(/_/g, " ") : "not started"}
                              </Badge>
                            </div>
                            <p className="text-sm text-foreground dark:text-muted-foreground">{goal.description}</p>
                          </div>
                          <Button
                            variant={isTracked ? "default" : "outline"}
                            size="sm"
                            className="ml-2 shrink-0"
                            onClick={() => {
                              if (isTracked) {
                                setGoalProgressEntries(prev => prev.filter(e => e.goalId !== goal.id));
                              } else {
                                setGoalProgressEntries(prev => [
                                  ...prev,
                                  {
                                    goalId: goal.id,
                                    goalDescription: goal.description,
                                    progressNote: "",
                                    progressPercentage: goal.progressPercentage || 0,
                                  },
                                ]);
                              }
                            }}
                          >
                            {isTracked ? (
                              <><CheckCircle className="w-3 h-3 mr-1" /> Tracking</>
                            ) : (
                              <><Plus className="w-3 h-3 mr-1" /> Track</>
                            )}
                          </Button>
                        </div>

                        {isTracked && existingEntry && (
                          <div className="mt-2 space-y-2 pt-2 border-t border-indigo-200">
                            <div>
                              <Label className="text-xs text-muted-foreground">Progress Note</Label>
                              <Textarea
                                placeholder="Describe progress observed this session..."
                                value={existingEntry.progressNote}
                                onChange={(e) => {
                                  setGoalProgressEntries(prev =>
                                    prev.map(entry =>
                                      entry.goalId === goal.id
                                        ? { ...entry, progressNote: e.target.value }
                                        : entry
                                    )
                                  );
                                }}
                                className="mt-1 min-h-[40px] text-sm"
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">
                                Progress: {existingEntry.progressPercentage}%
                              </Label>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                value={existingEntry.progressPercentage}
                                onChange={(e) => {
                                  setGoalProgressEntries(prev =>
                                    prev.map(entry =>
                                      entry.goalId === goal.id
                                        ? { ...entry, progressPercentage: parseInt(e.target.value) }
                                        : entry
                                    )
                                  );
                                }}
                                className="w-full mt-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                              />
                              <div className="flex justify-between text-xs text-muted-foreground/70 mt-0.5">
                                <span>0%</span>
                                <span>50%</span>
                                <span>100%</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Generate Button */}
            <Button
              onClick={generateNoteAndCodes}
              disabled={isGenerating || (!selectedPatient && !(isNewPatient && newPatientData.firstName.trim())) || selectedActivities.length === 0}
              className="w-full h-12 text-base bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Generating Note & Codes...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  Generate SOAP Note & Billing Codes
                </>
              )}
            </Button>
          </div>

          {/* Right Column - Generated Output */}
          <div className="space-y-4" id="generated-note-section">
            {generatedNote ? (
              <>
                {/* CPT Codes Card */}
                <Card className="border-green-200 bg-green-50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Brain className="w-5 h-5 text-green-600" />
                      Optimized Billing
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {isAdmin ? "AI-selected codes for maximum reimbursement (audit-defensible)" : "AI-selected billing codes (audit-defensible)"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(generatedNote.cptCodes || []).map((code, index) => (
                      <div key={code.code} className={`p-3 rounded-lg border ${index === 0 ? 'bg-green-100 border-green-300' : 'bg-card'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Badge className={`font-mono ${index === 0 ? 'bg-green-600' : ''}`}>{code.code}</Badge>
                            <span className="text-xs text-muted-foreground">{code.units} unit(s)</span>
                          </div>
                          {isAdmin && (
                            <span className={`text-sm font-semibold ${index === 0 ? 'text-green-700' : 'text-green-600'}`}>
                              ${code.reimbursement.toFixed(2)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium">{code.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{code.rationale}</p>
                      </div>
                    ))}

                    <Separator className="my-2" />

                    {isAdmin && (
                      <div className="flex items-center justify-between font-semibold">
                        <span>Session Total</span>
                        <span className="text-green-700 text-lg">${totalReimbursement.toFixed(2)}</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {(generatedNote.cptCodes || []).reduce((sum, c) => sum + c.units, 0)} units × {duration} min session
                    </p>

                    {/* AI Billing Rationale */}
                    {generatedNote.billingRationale && (
                      <>
                        <Separator className="my-2" />
                        <div className="p-2 bg-blue-50 rounded-lg">
                          <div className="flex items-center gap-1 mb-1">
                            <Lightbulb className="w-3 h-3 text-blue-600" />
                            <span className="text-xs font-medium text-blue-700">AI Billing Strategy</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{generatedNote.billingRationale}</p>
                        </div>
                      </>
                    )}

                    {/* Audit Notes */}
                    {generatedNote.auditNotes && generatedNote.auditNotes.length > 0 && (
                      <div className="p-2 bg-amber-50 rounded-lg">
                        <div className="flex items-center gap-1 mb-1">
                          <CheckCircle className="w-3 h-3 text-amber-600" />
                          <span className="text-xs font-medium text-amber-700">Audit Support</span>
                        </div>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          {generatedNote.auditNotes.map((note, i) => (
                            <li key={i}>• {note}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* TimeBlocks - Per-15-minute billing for insurers that require it */}
                {generatedNote.timeBlocks && generatedNote.timeBlocks.length > 0 && (
                  <Card className="border-purple-200">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Clock className="w-5 h-5 text-purple-600" />
                        Billing by Time Block
                      </CardTitle>
                      <CardDescription className="text-xs">
                        For insurers requiring separate codes per 15-minute unit
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {generatedNote.timeBlocks.map((block) => (
                          <div
                            key={block.blockNumber}
                            className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg border"
                          >
                            <div className="w-16 text-center">
                              <span className="text-xs font-mono text-muted-foreground">
                                {block.startMinute}-{block.endMinute} min
                              </span>
                            </div>
                            <Select
                              value={block.code}
                              onValueChange={(newCode) => {
                                // Update the timeblock code
                                const updatedBlocks = generatedNote.timeBlocks!.map(b =>
                                  b.blockNumber === block.blockNumber
                                    ? { ...b, code: newCode, codeName: CPT_CODE_INFO[newCode as keyof typeof CPT_CODE_INFO]?.name || newCode }
                                    : b
                                );
                                setGeneratedNote({
                                  ...generatedNote,
                                  timeBlocks: updatedBlocks,
                                  totalReimbursement: updatedBlocks.reduce((sum, b) => sum + b.rate, 0)
                                });
                              }}
                            >
                              <SelectTrigger className="w-28 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(CPT_CODE_INFO).map(([code, info]) => (
                                  <SelectItem key={code} value={code}>
                                    {code}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <span className="text-xs text-muted-foreground flex-1">{block.codeName}</span>
                            {isAdmin && (
                              <span className="text-xs font-semibold text-green-600">${block.rate.toFixed(2)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                      {isAdmin && (
                        <>
                          <Separator className="my-3" />
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              {generatedNote.timeBlocks.length} blocks × ${ratePerUnit.toFixed(2)}
                            </span>
                            <span className="font-bold text-green-700">
                              Total: ${(generatedNote.timeBlocks.length * ratePerUnit).toFixed(2)}
                            </span>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Generated SOAP Note */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="w-5 h-5 text-blue-600" />
                        Generated SOAP Note
                      </CardTitle>
                      <TextToSpeech
                        text={`Subjective: ${generatedNote.subjective}\n\nObjective: ${generatedNote.objective}\n\nAssessment: ${generatedNote.assessment}\n\nPlan: ${generatedNote.plan}`}
                        label="Listen"
                        showVoiceSelector
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div>
                      <Label className="text-xs font-semibold text-blue-600">SUBJECTIVE</Label>
                      <p className="mt-1 text-foreground">{generatedNote.subjective}</p>
                    </div>
                    <Separator />
                    <div>
                      <Label className="text-xs font-semibold text-green-600">OBJECTIVE</Label>
                      <p className="mt-1 text-foreground whitespace-pre-line">{generatedNote.objective}</p>
                    </div>
                    <Separator />
                    <div>
                      <Label className="text-xs font-semibold text-purple-600">ASSESSMENT</Label>
                      <p className="mt-1 text-foreground whitespace-pre-line">{generatedNote.assessment}</p>
                    </div>
                    <Separator />
                    <div>
                      <Label className="text-xs font-semibold text-orange-600">PLAN</Label>
                      <p className="mt-1 text-foreground">{generatedNote.plan}</p>
                    </div>
                    <Separator />
                    <div>
                      <Label className="text-xs font-semibold text-muted-foreground">SIGNATURES</Label>
                      <div className="mt-3 p-4 border rounded-lg bg-slate-50">
                        <div className="flex items-start gap-6">
                          {/* Signature Image or Placeholder */}
                          <div className="flex-1">
                            <p className="text-xs text-muted-foreground mb-2">Therapist Signature</p>
                            {therapistSignature?.signature ? (
                              <div className="border-b-2 border-slate-300 pb-2 mb-2">
                                <img
                                  src={therapistSignature.signature}
                                  alt="Therapist Signature"
                                  className="h-16 max-w-[200px] object-contain"
                                />
                              </div>
                            ) : (
                              <div className="border-b-2 border-slate-300 pb-2 mb-2 h-16 flex items-end">
                                <p className="text-muted-foreground/70 italic text-sm">
                                  {user?.firstName} {user?.lastName}
                                </p>
                              </div>
                            )}
                            <p className="text-sm font-medium text-foreground">
                              {therapistSignature?.name || `${user?.firstName} ${user?.lastName}`}
                              {(therapistSignature?.credentials || (user as any)?.credentials) && (
                                <span className="text-muted-foreground font-normal">
                                  , {therapistSignature?.credentials || (user as any)?.credentials}
                                </span>
                              )}
                            </p>
                          </div>

                          {/* Date */}
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground mb-2">Date</p>
                            <p className="text-lg font-medium text-foreground">
                              {new Date().toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        {!therapistSignature?.signature && (
                          <p className="text-xs text-orange-600 mt-3 flex items-center gap-1">
                            <span className="inline-block w-2 h-2 bg-orange-500 rounded-full"></span>
                            No signature on file. Upload your signature in Settings → Therapists.
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Save Button */}
                <Button
                  onClick={() => createSoapNoteMutation.mutate()}
                  disabled={createSoapNoteMutation.isPending || savedNoteInfo !== null}
                  className="w-full h-12 text-base"
                >
                  {createSoapNoteMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : savedNoteInfo ? (
                    <>
                      <CheckCircle className="w-5 h-5 mr-2" />
                      Saved
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5 mr-2" />
                      Save Note & Create Claim
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Brain className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-medium text-muted-foreground mb-2">AI-Generated Output</h3>
                  <p className="text-sm text-muted-foreground/70">
                    Select activities and click generate to create your SOAP note and billing codes
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Recent Notes */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Recent Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                {existingSoapNotes && existingSoapNotes.length > 0 ? (
                  <div className="space-y-2">
                    {existingSoapNotes.slice(0, 3).map((note) => (
                      <div key={note.id} className="p-2 bg-slate-50 rounded text-xs">
                        <div className="flex justify-between">
                          <span className="font-medium">Session #{note.sessionId}</span>
                          <span className="text-muted-foreground/70">
                            {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/70">No recent notes</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

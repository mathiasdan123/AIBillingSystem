import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText, Brain, CheckCircle, Clock, Lightbulb, Sparkles,
  Plus, X, ChevronDown, ChevronUp, Loader2, Mic
} from "lucide-react";
import { VoiceInput } from "@/components/VoiceInput";
import { TextToSpeech } from "@/components/TextToSpeech";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { type SoapNote, type Patient, type CptCode, type TherapyBank, type ExerciseBank } from "@shared/schema";

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
const ACTIVITY_CATEGORIES = [
  {
    name: "Strengthening Activities",
    activities: [
      "Resistive Putty – Squeeze", "Resistive Putty – Pinch/Pinch-Drag",
      "Theraband – Shoulder Flex/Abd", "Theraband – Rows",
      "Grip Strengthener (Hand Gripper)", "Finger Web / Digi-Flex",
      "Wall Push-Ups", "Table Push-Ups", "Chair/Bench Dips (assisted)",
      "Plank Hold (front)", "Side Plank (assisted)",
      "Prone Extension (Superman holds)", "Bridging / Hip Raises",
      "Sit-to-Stand Reps", "Medicine Ball Press (light)",
      "Thera-egg Squeezes", "Finger Isolation Taps",
      "Clothespin Pinch Lines", "Pinch-Flip Coins / Chips",
      "Rice Scoop with Weighted Spoon"
    ]
  },
  {
    name: "Balance & Motor Planning",
    activities: [
      "Balance Board – Static", "Balance Board – Dynamic Reaching",
      "Foam Beam – Tandem Walk", "Cross-Crawl (standing)",
      "Animal Walks – Bunny Hops", "Animal Walks – Bear Walk",
      "Animal Walks – Crab Walk", "Crab Walk (distance reps)",
      "Bear Walk (distance reps)", "Wheelbarrow Walk (assisted)",
      "Bilateral Ball Toss (over/under)", "Balloon Volleyball (postural control)",
      "Ladder Drills (in/out)", "Step-Stool Up/Down Sequencing",
      "Prone on Scooter Board – Pulls", "Supine Flexion Tucks (egg)",
      "Swing – Prone Superman (control)", "Swing – Seated Linear (timing)",
      "Target Toss While Balancing", "Midline Crossing – Bean Bag Sort",
      "Finger-to-Nose Alternation", "Simon Says Sequencing",
      "Theraband Isometrics with Balance", "Yoga Flow (child-cat-cow)",
      "One-Leg Stance (eyes open/closed)"
    ]
  },
  {
    name: "Fine Motor & ADL",
    activities: [
      "Obstacle Course (multi-step)", "Pegboard – Pattern Copy",
      "Puzzles – 12–24 pieces", "Mazes – Finger then Pencil",
      "Cutting – Straight/Curved Lines", "Coloring – In-the-Lines",
      "Block Design – 2D/3D", "Lacing – Cards/Shoes",
      "Buttoning / Zipping Practice", "Feeding – Spoon/Fork Practice",
      "Writing – Name/Letters", "Drawing – Pre-writing Shapes",
      "Coin Bank – In/Sort", "Tweezers – Pom Transfer",
      "Stickers – Precision Placement", "Playdough – Roll/Snake/Cut",
      "Beading – Sequence/Pattern", "Puzzle Lite – Matching Cards",
      "ADL – Handwashing Sequence", "ADL – Coat On/Off",
      "ADL – Shoes/Socks", "UT Pencil Grasp Practice"
    ]
  },
  {
    name: "Sensory & Regulation",
    activities: [
      "Rice Bin – Bury/Find", "Beans/Lentils Bin – Scoop/Pour",
      "Kinetic Sand – Mold/Smash", "Brushing (Wilbarger) – Protocol",
      "Joint Compressions – Protocol", "Crash Pad – Jumps/Deep Pressure",
      "Weighted Vest – Trial", "Body Sock – Stretch/Push",
      "Sensory Swing – Platform", "Sensory Swing – Lycra/Cuddle",
      "Sensory Swing – Bolster", "Trampoline – Regulated Jumps",
      "Deep Pressure – Roller/Steamroller", "Oral Motor – Chewelry",
      "Oral Motor – Crunchy Snacks", "Fidgets – Heavy Work",
      "Proprioceptive Carry (heavy)", "Tactile Play – Shaving Cream",
      "Vibration – Z-vibe Trial", "Auditory – Headphones/Break",
      "Visual – Low Lighting/Timers", "Calming Corner – Choice Chart"
    ]
  }
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

// Exercise-level assessment options
const EXERCISE_ASSESSMENT_OPTIONS = [
  "Independent",
  "Verbal Cues Only",
  "Minimal Assist",
  "Moderate Assist",
  "Maximal Assist",
  "Unable to Complete"
];

// Type for activity with assessment
interface ActivityWithAssessment {
  name: string;
  assessment: string;
}

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
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [duration, setDuration] = useState(60); // Default to 1 hour sessions
  const [location, setLocation] = useState("Sensory Gym");
  const [ratePerUnit, setRatePerUnit] = useState(DEFAULT_UNIT_RATE); // $289 per 15-min unit

  // Subjective
  const [mood, setMood] = useState("");
  const [caregiverReport, setCaregiverReport] = useState("");
  const [selectedTherapies, setSelectedTherapies] = useState<string[]>([]);
  const [newTherapyInput, setNewTherapyInput] = useState("");

  // Objective - Selected activities with individual assessments
  const [selectedActivities, setSelectedActivities] = useState<ActivityWithAssessment[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(["Strengthening Activities"]);
  const [newExerciseInputs, setNewExerciseInputs] = useState<Record<string, string>>({});
  const [applyToAllAssessment, setApplyToAllAssessment] = useState("");

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
      assessment,
      planNextSteps,
      nextSessionFocus,
      homeProgram,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [selectedPatient, sessionDate, duration, location, mood, caregiverReport, selectedActivities, selectedTherapies, assessment, planNextSteps, nextSessionFocus, homeProgram]);

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

  // Mutation to add new exercise to the bank
  const addExerciseMutation = useMutation({
    mutationFn: async ({ exerciseName, category }: { exerciseName: string; category: string }) => {
      const response = await apiRequest("POST", "/api/exercise-bank", { exerciseName, category });
      return response.json();
    },
    onSuccess: (newExercise: ExerciseBank) => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercise-bank"] });
      // Auto-select the newly added exercise
      setSelectedActivities(prev => [...prev, { name: newExercise.exerciseName, assessment: "" }]);
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
      setSelectedActivities(prev => [...prev, { name: trimmed, assessment: "" }]);
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
          .map(name => ({ name, assessment: "" }));
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
        return [...prev, { name: activity, assessment: "" }];
      }
    });
  };

  // Update assessment for a specific activity
  const updateActivityAssessment = (activityName: string, assessment: string) => {
    setSelectedActivities(prev =>
      prev.map(a => a.name === activityName ? { ...a, assessment } : a)
    );
  };

  // Apply assessment to all activities
  const applyAssessmentToAll = () => {
    if (!applyToAllAssessment) return;
    setSelectedActivities(prev =>
      prev.map(a => ({ ...a, assessment: applyToAllAssessment }))
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
    if (!selectedPatient || selectedActivities.length === 0) {
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

    setIsGenerating(true);

    try {
      // Call the AI backend service
      const response = await apiRequest("POST", "/api/ai/generate-soap-billing", {
        patientId: selectedPatient,
        activities: selectedActivities.map(a => a.name), // Activity names for backward compatibility
        activityAssessments: selectedActivities, // Full activity objects with assessments
        additionalTherapies: selectedTherapies.length > 0 ? selectedTherapies : undefined,
        mood: mood || "Cooperative",
        caregiverReport: caregiverReport || undefined,
        duration,
        location,
        assessment: {
          performance: assessment.performance || "Stable",
          assistance: assessment.assistance || "Minimal Assist",
          strength: assessment.strength || "Adequate",
          motorPlanning: assessment.motorPlanning || "Mild Difficulty",
          sensoryRegulation: assessment.sensoryRegulation || "Needed Minimal Supports"
        },
        planNextSteps: planNextSteps || "Continue Current Goals",
        nextSessionFocus: nextSessionFocus || undefined,
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
          ? `Generated SOAP note with ${(aiResponse.cptCodes || []).length} optimized CPT codes. Est. reimbursement: $${(aiResponse.totalReimbursement || 0).toFixed(2)}`
          : `Generated SOAP note with ${(aiResponse.cptCodes || []).length} optimized CPT codes.`,
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
      if (!generatedNote || !selectedPatient) return;

      const primaryCode = generatedNote.cptCodes[0]?.code || "97530";

      const sessionData = {
        practiceId: 1,
        patientId: selectedPatient,
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
        patientId: selectedPatient,
        sessionId: session.id,
        subjective: generatedNote.subjective,
        objective: generatedNote.objective,
        assessment: generatedNote.assessment,
        plan: generatedNote.plan,
        location,
        sessionType: "individual",
        dataSource: "ai_generated",
        aiSuggestedCptCodes: generatedNote.cptCodes || [],
      };

      await apiRequest("POST", "/api/soap-notes", soapNoteData);

      // Auto-generate claim for the session
      try {
        const claimResponse = await apiRequest("POST", `/api/sessions/${session.id}/generate-claim`, {});
        const claim = await claimResponse.json();
        return { session, claim };
      } catch (claimError) {
        // Claim generation failed but SOAP note saved - return session only
        console.error("Auto-claim generation failed:", claimError);
        return { session, claim: null };
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
      // Clear saved draft
      localStorage.removeItem(STORAGE_KEY);
      // Reset form
      setSelectedPatient(null);
      setMood("");
      setCaregiverReport("");
      setSelectedActivities([]);
      setSelectedTherapies([]);
      setAssessment({ performance: "", assistance: "", strength: "", motorPlanning: "", sensoryRegulation: "" });
      setPlanNextSteps("");
      setNextSessionFocus("");
      setHomeProgram("");
      setGeneratedNote(null);
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
          <p className="text-slate-600">Loading...</p>
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
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-6 h-6 text-blue-600" />
              Pediatric OT Documentation
            </h1>
            <p className="text-slate-600 mt-1">
              Select activities performed → AI generates notes & optimal billing codes
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
                disabled={!selectedPatient}
              />
              {!selectedPatient && (
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
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div>
                    <Label className="text-xs text-slate-500">Patient</Label>
                    <Select
                      value={selectedPatient?.toString() || ""}
                      onValueChange={(v) => setSelectedPatient(parseInt(v))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {patients?.map((p) => (
                          <SelectItem key={p.id} value={p.id.toString()}>
                            {p.firstName} {p.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500">Date</Label>
                    <Input
                      type="date"
                      value={sessionDate}
                      onChange={(e) => setSessionDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500">Duration</Label>
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
                    <Label className="text-xs text-slate-500">Location</Label>
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
                      <Label className="text-xs text-slate-500">Rate/Unit ($)</Label>
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
                      <span className="text-slate-600">
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
                    <span className="text-xs text-slate-600">
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
                  <Label className="text-xs text-slate-500">Mood/Behavior</Label>
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
                  <Label className="text-xs text-slate-500">Additional Comments</Label>
                  <Textarea
                    placeholder="Any additional observations or comments about the session..."
                    value={selectedTherapies.join('\n')}
                    onChange={(e) => setSelectedTherapies(e.target.value ? [e.target.value] : [])}
                    className="mt-1 min-h-[60px]"
                  />
                </div>

                <div>
                  <Label className="text-xs text-slate-500">Caregiver Report (optional)</Label>
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
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
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
                            <Label className="text-xs text-slate-500 mb-1 block">Add Custom Exercise</Label>
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
                            <p className="text-[10px] text-slate-400 mt-1">
                              Added exercises will be saved and available for future sessions
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {selectedActivities.length > 0 && (
                  <div className="mt-3 p-3 bg-green-50 rounded-lg space-y-3">
                    {/* Apply to All option */}
                    <div className="flex items-center gap-2 pb-2 border-b border-green-200">
                      <Label className="text-xs text-green-700 whitespace-nowrap">Apply to all:</Label>
                      <Select value={applyToAllAssessment} onValueChange={setApplyToAllAssessment}>
                        <SelectTrigger className="h-7 text-xs flex-1 max-w-[200px]">
                          <SelectValue placeholder="Select assessment" />
                        </SelectTrigger>
                        <SelectContent>
                          {EXERCISE_ASSESSMENT_OPTIONS.map((opt) => (
                            <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={applyAssessmentToAll}
                        disabled={!applyToAllAssessment}
                      >
                        Apply
                      </Button>
                    </div>

                    {/* Individual activities with assessments */}
                    <div className="space-y-2">
                      {selectedActivities.map((activity) => (
                        <div
                          key={activity.name}
                          className="flex items-center gap-2 bg-white rounded p-2"
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => toggleActivity(activity.name)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                          <span className="text-xs flex-1 min-w-0 truncate">{activity.name}</span>
                          <Select
                            value={activity.assessment}
                            onValueChange={(v) => updateActivityAssessment(activity.name, v)}
                          >
                            <SelectTrigger className="h-7 text-xs w-[160px]">
                              <SelectValue placeholder="Assessment" />
                            </SelectTrigger>
                            <SelectContent>
                              {EXERCISE_ASSESSMENT_OPTIONS.map((opt) => (
                                <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

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
                    <Label className="text-xs text-slate-500">Performance</Label>
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
                    <Label className="text-xs text-slate-500">Assistance</Label>
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
                    <Label className="text-xs text-slate-500">Strength</Label>
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
                    <Label className="text-xs text-slate-500">Motor Planning</Label>
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
                    <Label className="text-xs text-slate-500">Sensory Regulation</Label>
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
                  <Label className="text-xs text-slate-500">Plan Next Steps</Label>
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
                  <Label className="text-xs text-slate-500">Next Session Focus (optional)</Label>
                  <Textarea
                    placeholder="Areas to target next session..."
                    value={nextSessionFocus}
                    onChange={(e) => setNextSessionFocus(e.target.value)}
                    className="mt-1 min-h-[50px]"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Home Program (optional)</Label>
                  <Textarea
                    placeholder="Recommendations for caregiver/home activities..."
                    value={homeProgram}
                    onChange={(e) => setHomeProgram(e.target.value)}
                    className="mt-1 min-h-[50px]"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Generate Button */}
            <Button
              onClick={generateNoteAndCodes}
              disabled={isGenerating || !selectedPatient || selectedActivities.length === 0}
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
          <div className="space-y-4">
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
                      <div key={code.code} className={`p-3 rounded-lg border ${index === 0 ? 'bg-green-100 border-green-300' : 'bg-white'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Badge className={`font-mono ${index === 0 ? 'bg-green-600' : ''}`}>{code.code}</Badge>
                            <span className="text-xs text-slate-500">{code.units} unit(s)</span>
                          </div>
                          {isAdmin && (
                            <span className={`text-sm font-semibold ${index === 0 ? 'text-green-700' : 'text-green-600'}`}>
                              ${code.reimbursement.toFixed(2)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium">{code.name}</p>
                        <p className="text-xs text-slate-500 mt-1">{code.rationale}</p>
                      </div>
                    ))}

                    <Separator className="my-2" />

                    {isAdmin && (
                      <div className="flex items-center justify-between font-semibold">
                        <span>Session Total</span>
                        <span className="text-green-700 text-lg">${totalReimbursement.toFixed(2)}</span>
                      </div>
                    )}
                    <p className="text-xs text-slate-500">
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
                          <p className="text-xs text-slate-600">{generatedNote.billingRationale}</p>
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
                        <ul className="text-xs text-slate-600 space-y-1">
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
                              <span className="text-xs font-mono text-slate-500">
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
                            <span className="text-xs text-slate-600 flex-1">{block.codeName}</span>
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
                            <span className="text-slate-600">
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
                      <p className="mt-1 text-slate-700">{generatedNote.subjective}</p>
                    </div>
                    <Separator />
                    <div>
                      <Label className="text-xs font-semibold text-green-600">OBJECTIVE</Label>
                      <p className="mt-1 text-slate-700 whitespace-pre-line">{generatedNote.objective}</p>
                    </div>
                    <Separator />
                    <div>
                      <Label className="text-xs font-semibold text-purple-600">ASSESSMENT</Label>
                      <p className="mt-1 text-slate-700 whitespace-pre-line">{generatedNote.assessment}</p>
                    </div>
                    <Separator />
                    <div>
                      <Label className="text-xs font-semibold text-orange-600">PLAN</Label>
                      <p className="mt-1 text-slate-700">{generatedNote.plan}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Save Button */}
                <Button
                  onClick={() => createSoapNoteMutation.mutate()}
                  disabled={createSoapNoteMutation.isPending}
                  className="w-full h-12 text-base"
                >
                  {createSoapNoteMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Saving...
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
                  <Brain className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                  <h3 className="font-medium text-slate-600 mb-2">AI-Generated Output</h3>
                  <p className="text-sm text-slate-400">
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
                          <span className="text-slate-400">
                            {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No recent notes</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

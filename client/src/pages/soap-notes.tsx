import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { FileText, Brain, CheckCircle, AlertCircle, Clock, Lightbulb, Mic, Upload } from "lucide-react";
import { VoiceInput } from "@/components/VoiceInput";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { insertSoapNoteSchema, type SoapNote, type TreatmentSession, type Patient, type CptCode } from "@shared/schema";

const soapNoteFormSchema = insertSoapNoteSchema.extend({
  patientId: z.number().min(1, "Patient is required"),
  sessionDate: z.string().min(1, "Session date is required"),
  duration: z.number().min(15, "Minimum session duration is 15 minutes"),
});

type SoapNoteForm = z.infer<typeof soapNoteFormSchema>;

interface CptSuggestion {
  code: string;
  description: string;
  reason: string;
  confidence: number;
  reimbursementRate: number;
  preferredByInsurance: boolean;
}

interface AiOptimization {
  suggestedCodes: CptSuggestion[];
  optimizationReason: string;
  estimatedIncrease: number;
}

export default function SoapNotes() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [selectedPatient, setSelectedPatient] = useState<number | null>(null);
  const [aiOptimization, setAiOptimization] = useState<AiOptimization | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Check if user can see financial data (admin or billing roles only)
  const canSeeFinancialData = isAdmin || (user as any)?.role === 'billing';
  const [showVoiceInput, setShowVoiceInput] = useState(false);

  const form = useForm<SoapNoteForm>({
    resolver: zodResolver(soapNoteFormSchema),
    defaultValues: {
      subjective: "",
      objective: "",
      assessment: "",
      plan: "",
      location: "Sensory Gym",
      sessionType: "individual",
      dataSource: "manual",
      patientId: 0,
      sessionDate: new Date().toISOString().split('T')[0],
      duration: 45,
    }
  });

  const { data: patients, isLoading: patientsLoading, error: patientsError } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
    retry: false,
  });

  const { data: cptCodes, isLoading: cptCodesLoading, error: cptCodesError } = useQuery<CptCode[]>({
    queryKey: ["/api/cpt-codes"],
    retry: false,
  });

  const { data: existingSoapNotes, isLoading: soapNotesLoading } = useQuery<SoapNote[]>({
    queryKey: ["/api/soap-notes"],
    retry: false,
  });

  // Handle voice/document input
  const handleTranscription = (text: string, method: "voice" | "upload") => {
    // Parse the text intelligently into SOAP sections
    const parseText = (fullText: string) => {
      const lines = fullText.split('\n').filter(line => line.trim());
      let subjective = "";
      let objective = "";
      let assessment = "";
      let plan = "";

      let currentSection = "";
      
      for (const line of lines) {
        const lowerLine = line.toLowerCase().trim();
        
        // Check for section headers
        if (lowerLine.startsWith('subjective:') || lowerLine.includes('patient reports') || lowerLine.includes('patient states')) {
          currentSection = "subjective";
          subjective += line.replace(/^subjective:\s*/i, '') + " ";
        } else if (lowerLine.startsWith('objective:') || lowerLine.includes('observed') || lowerLine.includes('demonstrated')) {
          currentSection = "objective";
          objective += line.replace(/^objective:\s*/i, '') + " ";
        } else if (lowerLine.startsWith('assessment:') || lowerLine.includes('assessment') || lowerLine.includes('progress')) {
          currentSection = "assessment";
          assessment += line.replace(/^assessment:\s*/i, '') + " ";
        } else if (lowerLine.startsWith('plan:') || lowerLine.includes('plan') || lowerLine.includes('continue')) {
          currentSection = "plan";
          plan += line.replace(/^plan:\s*/i, '') + " ";
        } else if (currentSection) {
          // Add to current section
          switch (currentSection) {
            case "subjective": subjective += line + " "; break;
            case "objective": objective += line + " "; break;
            case "assessment": assessment += line + " "; break;
            case "plan": plan += line + " "; break;
          }
        } else if (!currentSection) {
          // If no section identified yet, add to objective
          objective += line + " ";
        }
      }

      return {
        subjective: subjective.trim() || "Information extracted from " + method,
        objective: objective.trim() || fullText,
        assessment: assessment.trim() || "Progress documented during session",
        plan: plan.trim() || "Continue current treatment approach"
      };
    };

    const parsed = parseText(text);
    
    // Populate the form
    form.setValue("subjective", parsed.subjective);
    form.setValue("objective", parsed.objective);
    form.setValue("assessment", parsed.assessment);
    form.setValue("plan", parsed.plan);
    form.setValue("dataSource", method);

    toast({
      title: "Content Imported",
      description: `Successfully imported and organized content from ${method} input.`,
    });

    setShowVoiceInput(false);
  };

  const createSoapNoteMutation = useMutation({
    mutationFn: async (data: SoapNoteForm) => {
      // First create the treatment session
      const sessionData = {
        practiceId: 1, // This should come from user context
        patientId: data.patientId,
        therapistId: "current-user-id", // This should come from auth
        sessionDate: data.sessionDate,
        duration: data.duration,
        cptCodeId: aiOptimization?.suggestedCodes[0] ? 
          cptCodes?.find(c => c.code === aiOptimization.suggestedCodes[0].code)?.id || 1 : 1,
        icd10CodeId: 1, // This should be selected based on patient diagnosis
        units: Math.ceil(data.duration / 15), // 15-minute billing units
        notes: `${data.subjective}\n\n${data.objective}\n\n${data.assessment}\n\n${data.plan}`,
        status: "completed",
        dataSource: data.dataSource,
      };

      const session = await apiRequest("POST", "/api/sessions", sessionData);
      
      // Then create the SOAP note
      const soapNoteData = {
        ...data,
        sessionId: (session as any).id,
        aiSuggestedCptCodes: aiOptimization?.suggestedCodes || [],
        optimizedCptCode: aiOptimization?.suggestedCodes[0] ? 
          cptCodes?.find(c => c.code === aiOptimization.suggestedCodes[0].code)?.id : null,
        cptOptimizationReason: aiOptimization?.optimizationReason || null,
      };

      return apiRequest("POST", "/api/soap-notes", soapNoteData);
    },
    onSuccess: () => {
      toast({
        title: "SOAP Note Created",
        description: "Session documented successfully with AI-optimized billing codes",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/soap-notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      form.reset();
      setAiOptimization(null);
      setSelectedPatient(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create SOAP note",
        variant: "destructive",
      });
    },
  });

  const analyzeSoapNote = async (formData: SoapNoteForm) => {
    if (!selectedPatient || !formData.objective || !formData.assessment) {
      toast({
        title: "Missing Information",
        description: "Please select a patient and fill in objective and assessment sections for AI analysis",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);

    try {
      // Get patient insurance information
      const patient = patients?.find(p => p.id === selectedPatient);
      
      // Simulate AI analysis based on SOAP content
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call

      // AI analysis based on the provided SOAP note structure
      const suggestedCodes: CptSuggestion[] = [];
      
      // Analyze content for appropriate CPT codes
      const objectiveText = formData.objective.toLowerCase();
      const assessmentText = formData.assessment.toLowerCase();
      
      // Core strengthening and sensory integration (common OT codes)
      if (objectiveText.includes('core strengthen') || objectiveText.includes('postural control') || 
          objectiveText.includes('trunk stability')) {
        suggestedCodes.push({
          code: "97530",
          description: "Therapeutic activities to improve functional performance",
          reason: "Core strengthening and postural activities documented",
          confidence: 0.92,
          reimbursementRate: 58.50,
          preferredByInsurance: patient?.insuranceProvider === "Anthem" || patient?.insuranceProvider === "BCBS"
        });
      }

      // Motor planning and coordination
      if (objectiveText.includes('motor planning') || objectiveText.includes('coordination') ||
          objectiveText.includes('bilateral coordination')) {
        suggestedCodes.push({
          code: "97533",
          description: "Sensory integrative techniques to enhance sensory processing",
          reason: "Motor planning and sensory integration activities documented",
          confidence: 0.89,
          reimbursementRate: 62.25,
          preferredByInsurance: patient?.insuranceProvider === "UnitedHealth" || patient?.insuranceProvider === "Cigna"
        });
      }

      // ADL training
      if (objectiveText.includes('dressing') || objectiveText.includes('adl') || 
          objectiveText.includes('self-care') || objectiveText.includes('activities of daily living')) {
        suggestedCodes.push({
          code: "97535",
          description: "Self-care/home management training",
          reason: "Activities of daily living training documented",
          confidence: 0.88,
          reimbursementRate: 55.75,
          preferredByInsurance: patient?.insuranceProvider === "Aetna" || patient?.insuranceProvider === "Medicaid"
        });
      }

      // Therapeutic exercise (if no specific codes above apply)
      if (suggestedCodes.length === 0) {
        suggestedCodes.push({
          code: "97110",
          description: "Therapeutic procedure, 1 or more areas, each 15 minutes; therapeutic exercises",
          reason: "General therapeutic activities and exercises documented",
          confidence: 0.75,
          reimbursementRate: 48.00,
          preferredByInsurance: true
        });
      }

      // Sort by reimbursement rate and insurance preference
      suggestedCodes.sort((a, b) => {
        if (a.preferredByInsurance && !b.preferredByInsurance) return -1;
        if (!a.preferredByInsurance && b.preferredByInsurance) return 1;
        return b.reimbursementRate - a.reimbursementRate;
      });

      const optimization: AiOptimization = {
        suggestedCodes: suggestedCodes.slice(0, 3), // Top 3 recommendations
        optimizationReason: `Based on documented interventions and ${patient?.insuranceProvider || 'insurance'} preferences, using ${suggestedCodes[0]?.code} provides optimal reimbursement while maintaining clinical accuracy.`,
        estimatedIncrease: suggestedCodes[0] ? Math.round((suggestedCodes[0].reimbursementRate - 45) * 100) / 100 : 0
      };

      setAiOptimization(optimization);
      
      toast({
        title: "AI Analysis Complete",
        description: `Found ${suggestedCodes.length} optimized billing codes based on your documentation`,
      });

    } catch (error) {
      toast({
        title: "Analysis Failed",
        description: "Unable to analyze SOAP note. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const onSubmit = (data: SoapNoteForm) => {
    if (!aiOptimization) {
      toast({
        title: "Missing AI Analysis",
        description: "Please run AI analysis first to optimize billing codes",
        variant: "destructive",
      });
      return;
    }
    
    createSoapNoteMutation.mutate(data);
  };

  // Show loading state while data is being fetched
  if (patientsLoading || cptCodesLoading || soapNotesLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 pt-20 md:pt-0 md:ml-64">
        <div className="p-6">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-center h-64">
              <div>
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-slate-600 mb-2">Loading SOAP Notes system...</p>
                {patientsError && <p className="text-red-500 text-sm">Patients error: {String(patientsError)}</p>}
                {cptCodesError && <p className="text-red-500 text-sm">CPT error: {String(cptCodesError)}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // If no patients exist yet, show a helpful message
  if (!patients || patients.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 pt-20 md:pt-0 md:ml-64">
        <div className="p-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-slate-900 mb-2">SOAP Notes</h1>
              <p className="text-slate-600">
                Document therapy sessions with AI-powered CPT code optimization for maximum reimbursement
              </p>
            </div>
            <Card className="max-w-md mx-auto">
              <CardHeader>
                <CardTitle>No Patients Found</CardTitle>
                <CardDescription>
                  You need to add patients before creating SOAP notes. 
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  onClick={() => window.location.href = '/intake'}
                  className="w-full"
                >
                  Add New Patient
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="md:ml-64 min-h-screen bg-white pt-20 md:pt-0">
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <div className="flex items-center gap-3 mb-8">
          <FileText className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold">SOAP Notes</h1>
            <p className="text-muted-foreground">Document therapy sessions with AI-powered billing optimization</p>
          </div>
        </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main SOAP Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  New SOAP Note
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowVoiceInput(!showVoiceInput)}
                    data-testid="button-toggle-voice-input"
                  >
                    <Mic className="w-4 h-4 mr-2" />
                    Voice & Upload
                  </Button>
                </div>
              </CardTitle>
              <CardDescription>
                Document your therapy session following SOAP format. Use voice dictation or document upload for faster entry.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Voice and Upload Input */}
              {showVoiceInput && (
                <div className="mb-6">
                  <VoiceInput 
                    onTranscription={handleTranscription}
                    disabled={!selectedPatient}
                  />
                </div>
              )}

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  {/* Session Details */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="patientId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Patient</FormLabel>
                          <Select 
                            onValueChange={(value) => {
                              field.onChange(parseInt(value));
                              setSelectedPatient(parseInt(value));
                            }}
                            value={field.value?.toString() || ""}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-patient">
                                <SelectValue placeholder="Select patient" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {patients?.map((patient) => (
                                <SelectItem key={patient.id} value={patient.id.toString()}>
                                  {patient.firstName} {patient.lastName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="sessionDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Session Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} data-testid="input-session-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="duration"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Duration (minutes)</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              min="15" 
                              max="120" 
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                              data-testid="input-duration"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="location"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-location">
                                <SelectValue placeholder="Session location" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Sensory Gym">Sensory Gym</SelectItem>
                              <SelectItem value="Clinic Room">Clinic Room</SelectItem>
                              <SelectItem value="Home Visit">Home Visit</SelectItem>
                              <SelectItem value="School">School</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="sessionType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Session Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-session-type">
                                <SelectValue placeholder="Type of session" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="individual">Individual (1:1)</SelectItem>
                              <SelectItem value="group">Group</SelectItem>
                              <SelectItem value="consultation">Consultation</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <Separator />

                  {/* SOAP Sections */}
                  <Tabs defaultValue="subjective" className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                      <TabsTrigger value="subjective">Subjective</TabsTrigger>
                      <TabsTrigger value="objective">Objective</TabsTrigger>
                      <TabsTrigger value="assessment">Assessment</TabsTrigger>
                      <TabsTrigger value="plan">Plan</TabsTrigger>
                    </TabsList>

                    <TabsContent value="subjective" className="space-y-4">
                      <FormField
                        control={form.control}
                        name="subjective"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Subjective</FormLabel>
                            <FormControl>
                              <Textarea 
                                placeholder="Patient/parent reports, child's mood, motivation, concerns..."
                                className="min-h-[120px]"
                                {...field}
                                data-testid="textarea-subjective"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </TabsContent>

                    <TabsContent value="objective" className="space-y-4">
                      <FormField
                        control={form.control}
                        name="objective"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Objective</FormLabel>
                            <FormControl>
                              <Textarea 
                                placeholder="Activities performed, interventions used, patient response, measurable observations..."
                                className="min-h-[120px]"
                                {...field}
                                data-testid="textarea-objective"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </TabsContent>

                    <TabsContent value="assessment" className="space-y-4">
                      <FormField
                        control={form.control}
                        name="assessment"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Assessment</FormLabel>
                            <FormControl>
                              <Textarea 
                                placeholder="Clinical reasoning, progress toward goals, areas of need, medical necessity..."
                                className="min-h-[120px]"
                                {...field}
                                data-testid="textarea-assessment"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </TabsContent>

                    <TabsContent value="plan" className="space-y-4">
                      <FormField
                        control={form.control}
                        name="plan"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Plan</FormLabel>
                            <FormControl>
                              <Textarea 
                                placeholder="Treatment frequency, goals for next session, home program updates..."
                                className="min-h-[120px]"
                                {...field}
                                data-testid="textarea-plan"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </TabsContent>
                  </Tabs>

                  <div className="flex gap-3">
                    <Button 
                      type="button" 
                      onClick={() => analyzeSoapNote(form.getValues())}
                      disabled={isAnalyzing}
                      variant="outline"
                      className="flex items-center gap-2"
                      data-testid="button-analyze"
                    >
                      <Brain className="w-4 h-4" />
                      {isAnalyzing ? "Analyzing..." : "AI Analysis"}
                    </Button>
                    
                    <Button 
                      type="submit" 
                      disabled={createSoapNoteMutation.isPending || !aiOptimization}
                      className="flex items-center gap-2"
                      data-testid="button-submit"
                    >
                      <CheckCircle className="w-4 h-4" />
                      {createSoapNoteMutation.isPending ? "Saving..." : "Save SOAP Note"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* AI Optimization Panel */}
        <div className="space-y-6">
          {aiOptimization && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-purple-600" />
                  AI Billing Optimization
                </CardTitle>
                <CardDescription>
                  Recommended CPT codes based on your documentation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {aiOptimization.suggestedCodes.map((suggestion, index) => (
                  <div key={suggestion.code} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant={index === 0 ? "default" : "secondary"}>
                        {suggestion.code}
                      </Badge>
                      <div className="flex items-center gap-1">
                        {suggestion.preferredByInsurance && (
                          <Badge variant="outline" className="text-green-600">
                            Insurance Preferred
                          </Badge>
                        )}
                        {canSeeFinancialData && (
                          <span className="text-sm font-medium">
                            ${suggestion.reimbursementRate}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm font-medium">{suggestion.description}</p>
                    <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                        <span className="text-xs">
                          {Math.round(suggestion.confidence * 100)}% confidence
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

                <Alert>
                  <Lightbulb className="h-4 w-4" />
                  <AlertDescription>
                    {aiOptimization.optimizationReason}
                    {canSeeFinancialData && aiOptimization.estimatedIncrease > 0 && (
                      <span className="block mt-1 font-medium text-green-600">
                        Estimated increase: +${aiOptimization.estimatedIncrease} per session
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          )}

          {/* Recent SOAP Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Recent Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {existingSoapNotes && existingSoapNotes.length > 0 ? (
                <div className="space-y-3">
                  {existingSoapNotes.slice(0, 5).map((note) => (
                    <div key={note.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">
                          Patient ID: {note.sessionId}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : 'No date'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {note.location || 'Unknown'} • {note.sessionType || 'individual'}
                      </p>
                      {note.optimizedCptCode && (
                        <Badge variant="outline" className="mt-1">
                          AI Optimized
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No recent SOAP notes</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </div>
  );
}
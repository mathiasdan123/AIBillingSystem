import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Mic, MicOff, Square, Play, Pause, Loader2, FileText,
  DollarSign, Clock, CheckCircle, AlertCircle, Save, RefreshCw,
  Volume2, Wand2
} from "lucide-react";

interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

interface BillingRecommendation {
  lineItems: Array<{
    cptCode: string;
    description: string;
    units: number;
    reasoning: string;
  }>;
  totalUnits: number;
  estimatedAmount: number;
  complianceScore: number;
  notes: string;
}

interface ProcessingResult {
  success: boolean;
  transcription: string;
  soapNote: SoapNote;
  interventions: string[];
  patientMood: string;
  progressNotes: string;
  homeProgram: string;
  billingRecommendation?: BillingRecommendation;
}

export default function SessionRecorder() {
  const { toast } = useToast();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  // Form state
  const [consentGiven, setConsentGiven] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState("");
  const [sessionDuration, setSessionDuration] = useState("45");
  const [sessionType, setSessionType] = useState("occupational therapy");
  const [manualTranscription, setManualTranscription] = useState("");

  // Results state
  const [processingResult, setProcessingResult] = useState<ProcessingResult | null>(null);
  const [editedSoapNote, setEditedSoapNote] = useState<SoapNote | null>(null);

  // Fetch patients
  const { data: patients } = useQuery<any[]>({
    queryKey: ['/api/patients?practiceId=1'],
  });

  // Fetch recorder status
  const { data: recorderStatus } = useQuery<any>({
    queryKey: ['/api/session-recorder/status'],
  });

  // Recording timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording, isPaused]);

  // Process recording mutation
  const processRecordingMutation = useMutation({
    mutationFn: async (data: { audioBase64: string; mimeType: string }) => {
      const patient = patients?.find(p => p.id === parseInt(selectedPatient));
      const response = await apiRequest("POST", "/api/session-recorder/process", {
        audioBase64: data.audioBase64,
        mimeType: data.mimeType,
        patientId: patient?.id || 0,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Patient",
        therapistName: "Therapist",
        sessionDuration: parseInt(sessionDuration),
        insuranceName: patient?.insuranceProvider || "Unknown",
        sessionType,
      });
      return response.json();
    },
    onSuccess: (result) => {
      setProcessingResult(result);
      setEditedSoapNote(result.soapNote);
      toast({
        title: "Processing Complete",
        description: "SOAP note and billing recommendations generated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Processing Failed",
        description: error.message || "Failed to process recording",
        variant: "destructive",
      });
    },
  });

  // Process text mutation
  const processTextMutation = useMutation({
    mutationFn: async (transcription: string) => {
      const patient = patients?.find(p => p.id === parseInt(selectedPatient));
      const response = await apiRequest("POST", "/api/session-recorder/process-text", {
        transcription,
        patientId: patient?.id || 0,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Patient",
        therapistName: "Therapist",
        sessionDuration: parseInt(sessionDuration),
        insuranceName: patient?.insuranceProvider || "Unknown",
        sessionType,
      });
      return response.json();
    },
    onSuccess: (result) => {
      setProcessingResult(result);
      setEditedSoapNote(result.soapNote);
      toast({
        title: "Processing Complete",
        description: "SOAP note and billing recommendations generated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Processing Failed",
        description: error.message || "Failed to process transcription",
        variant: "destructive",
      });
    },
  });

  // Save SOAP note mutation
  const saveSoapNoteMutation = useMutation({
    mutationFn: async () => {
      if (!editedSoapNote || !selectedPatient) {
        throw new Error("Missing required data");
      }

      // First create a session
      const patient = patients?.find(p => p.id === parseInt(selectedPatient));
      const sessionResponse = await apiRequest("POST", "/api/sessions", {
        practiceId: 1,
        patientId: parseInt(selectedPatient),
        therapistId: "session-recorder",
        sessionDate: new Date().toISOString().split('T')[0],
        duration: parseInt(sessionDuration),
        cptCodeId: 1, // Default CPT code
        units: Math.floor(parseInt(sessionDuration) / 15),
        status: "completed",
        dataSource: "voice",
      });
      const session = await sessionResponse.json();

      // Then create the SOAP note
      const soapResponse = await apiRequest("POST", "/api/soap-notes", {
        sessionId: session.id,
        subjective: editedSoapNote.subjective,
        objective: editedSoapNote.objective,
        assessment: editedSoapNote.assessment,
        plan: editedSoapNote.plan,
        interventions: processingResult?.interventions || [],
        progressNotes: processingResult?.progressNotes || "",
        homeProgram: processingResult?.homeProgram || "",
        dataSource: "voice",
      });

      return soapResponse.json();
    },
    onSuccess: (result) => {
      toast({
        title: "SOAP Note Saved",
        description: result.generatedClaim
          ? `Superbill ${result.generatedClaim.claimNumber} auto-generated`
          : "SOAP note saved successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save SOAP note",
        variant: "destructive",
      });
    },
  });

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);

    } catch (error) {
      toast({
        title: "Microphone Access Denied",
        description: "Please allow microphone access to record sessions",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
    }
  };

  const togglePause = () => {
    if (mediaRecorderRef.current) {
      if (isPaused) {
        mediaRecorderRef.current.resume();
      } else {
        mediaRecorderRef.current.pause();
      }
      setIsPaused(!isPaused);
    }
  };

  const processRecording = async () => {
    if (!audioBlob) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      processRecordingMutation.mutate({
        audioBase64: base64,
        mimeType: audioBlob.type,
      });
    };
    reader.readAsDataURL(audioBlob);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const selectedPatientData = patients?.find(p => p.id === parseInt(selectedPatient));

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Mic className="h-6 w-6" />
          Session Recorder
        </h1>
        <p className="text-slate-600">
          Record therapy sessions and auto-generate SOAP notes with AI
        </p>
      </div>

      {/* Status Banner */}
      {recorderStatus && (
        <div className={`mb-6 p-3 rounded-lg flex items-center gap-2 ${
          recorderStatus.available ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800'
        }`}>
          {recorderStatus.available ? (
            <>
              <CheckCircle className="h-5 w-5" />
              <span>AI transcription and SOAP generation ready</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-5 w-5" />
              <span>Voice transcription requires OpenAI API key</span>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Recording */}
        <div className="space-y-6">
          {/* Patient Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Session Setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Patient</Label>
                <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select patient" />
                  </SelectTrigger>
                  <SelectContent>
                    {patients?.map((patient) => (
                      <SelectItem key={patient.id} value={patient.id.toString()}>
                        {patient.firstName} {patient.lastName}
                        {patient.insuranceProvider && (
                          <span className="text-slate-400 ml-2">({patient.insuranceProvider})</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Session Duration (min)</Label>
                  <Select value={sessionDuration} onValueChange={setSessionDuration}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="45">45 minutes</SelectItem>
                      <SelectItem value="60">60 minutes</SelectItem>
                      <SelectItem value="90">90 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Session Type</Label>
                  <Select value={sessionType} onValueChange={setSessionType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="occupational therapy">Occupational Therapy</SelectItem>
                      <SelectItem value="physical therapy">Physical Therapy</SelectItem>
                      <SelectItem value="speech therapy">Speech Therapy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Patient Consent */}
              <div className="flex items-start space-x-3 p-4 bg-blue-50 rounded-lg">
                <Checkbox
                  id="consent"
                  checked={consentGiven}
                  onCheckedChange={(checked) => setConsentGiven(checked as boolean)}
                />
                <div className="space-y-1">
                  <label htmlFor="consent" className="text-sm font-medium text-blue-900 cursor-pointer">
                    Patient consent obtained for recording
                  </label>
                  <p className="text-xs text-blue-700">
                    I confirm the patient/guardian has given verbal consent to record this session
                    for documentation purposes only.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recording Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="h-5 w-5" />
                Record Session
              </CardTitle>
              <CardDescription>
                Record the therapy session audio for AI transcription
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Recording Timer */}
              <div className="text-center py-6 bg-slate-50 rounded-lg">
                <div className={`text-5xl font-mono font-bold ${isRecording ? 'text-red-600' : 'text-slate-400'}`}>
                  {formatTime(recordingTime)}
                </div>
                {isRecording && (
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span className={`w-3 h-3 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
                    <span className="text-sm text-slate-600">
                      {isPaused ? 'Paused' : 'Recording...'}
                    </span>
                  </div>
                )}
              </div>

              {/* Recording Buttons */}
              <div className="flex justify-center gap-3">
                {!isRecording ? (
                  <Button
                    size="lg"
                    onClick={startRecording}
                    disabled={!consentGiven || !selectedPatient}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    <Mic className="mr-2 h-5 w-5" />
                    Start Recording
                  </Button>
                ) : (
                  <>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={togglePause}
                    >
                      {isPaused ? (
                        <>
                          <Play className="mr-2 h-5 w-5" />
                          Resume
                        </>
                      ) : (
                        <>
                          <Pause className="mr-2 h-5 w-5" />
                          Pause
                        </>
                      )}
                    </Button>
                    <Button
                      size="lg"
                      onClick={stopRecording}
                      className="bg-slate-800 hover:bg-slate-900"
                    >
                      <Square className="mr-2 h-5 w-5" />
                      Stop
                    </Button>
                  </>
                )}
              </div>

              {/* Process Recording Button */}
              {audioBlob && !isRecording && (
                <div className="pt-4 border-t">
                  <Button
                    className="w-full"
                    onClick={processRecording}
                    disabled={processRecordingMutation.isPending}
                  >
                    {processRecordingMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Processing with AI...
                      </>
                    ) : (
                      <>
                        <Wand2 className="mr-2 h-5 w-5" />
                        Generate SOAP Note from Recording
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Manual Transcription Option */}
          <Card>
            <CardHeader>
              <CardTitle>Or Paste Transcription</CardTitle>
              <CardDescription>
                If you have session notes or a transcription from another source
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={manualTranscription}
                onChange={(e) => setManualTranscription(e.target.value)}
                placeholder="Paste session transcription or notes here..."
                rows={6}
              />
              <Button
                className="w-full"
                variant="outline"
                onClick={() => processTextMutation.mutate(manualTranscription)}
                disabled={!manualTranscription || !selectedPatient || processTextMutation.isPending}
              >
                {processTextMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 h-4 w-4" />
                    Generate SOAP from Text
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Results */}
        <div className="space-y-6">
          {processingResult ? (
            <>
              {/* Transcription */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Transcription
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-slate-50 rounded-lg p-4 max-h-40 overflow-y-auto">
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">
                      {processingResult.transcription}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* SOAP Note */}
              <Card>
                <CardHeader>
                  <CardTitle>Generated SOAP Note</CardTitle>
                  <CardDescription>
                    Review and edit before saving
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="subjective">
                    <TabsList className="grid grid-cols-4 w-full">
                      <TabsTrigger value="subjective">S</TabsTrigger>
                      <TabsTrigger value="objective">O</TabsTrigger>
                      <TabsTrigger value="assessment">A</TabsTrigger>
                      <TabsTrigger value="plan">P</TabsTrigger>
                    </TabsList>

                    <TabsContent value="subjective" className="mt-4">
                      <Label>Subjective</Label>
                      <Textarea
                        value={editedSoapNote?.subjective || ""}
                        onChange={(e) => setEditedSoapNote(prev => prev ? {...prev, subjective: e.target.value} : null)}
                        rows={5}
                        className="mt-2"
                      />
                    </TabsContent>

                    <TabsContent value="objective" className="mt-4">
                      <Label>Objective</Label>
                      <Textarea
                        value={editedSoapNote?.objective || ""}
                        onChange={(e) => setEditedSoapNote(prev => prev ? {...prev, objective: e.target.value} : null)}
                        rows={5}
                        className="mt-2"
                      />
                    </TabsContent>

                    <TabsContent value="assessment" className="mt-4">
                      <Label>Assessment</Label>
                      <Textarea
                        value={editedSoapNote?.assessment || ""}
                        onChange={(e) => setEditedSoapNote(prev => prev ? {...prev, assessment: e.target.value} : null)}
                        rows={5}
                        className="mt-2"
                      />
                    </TabsContent>

                    <TabsContent value="plan" className="mt-4">
                      <Label>Plan</Label>
                      <Textarea
                        value={editedSoapNote?.plan || ""}
                        onChange={(e) => setEditedSoapNote(prev => prev ? {...prev, plan: e.target.value} : null)}
                        rows={5}
                        className="mt-2"
                      />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              {/* Billing Recommendation */}
              {processingResult.billingRecommendation && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <DollarSign className="h-5 w-5" />
                      AI Billing Recommendation
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                      <div>
                        <p className="text-sm text-green-700">Estimated Amount</p>
                        <p className="text-2xl font-bold text-green-800">
                          ${processingResult.billingRecommendation.estimatedAmount.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-green-700">Compliance Score</p>
                        <Badge className="bg-green-600">
                          {processingResult.billingRecommendation.complianceScore}%
                        </Badge>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {processingResult.billingRecommendation.lineItems.map((item, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                          <div>
                            <Badge variant="outline" className="font-mono">
                              {item.cptCode}
                            </Badge>
                            <span className="ml-2 text-sm">{item.description}</span>
                          </div>
                          <span className="text-sm text-slate-600">{item.units} unit(s)</span>
                        </div>
                      ))}
                    </div>

                    <p className="text-xs text-slate-500 italic">
                      {processingResult.billingRecommendation.notes}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Save Button */}
              <Button
                className="w-full"
                size="lg"
                onClick={() => saveSoapNoteMutation.mutate()}
                disabled={saveSoapNoteMutation.isPending || !selectedPatient}
              >
                {saveSoapNoteMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-5 w-5" />
                    Save SOAP Note & Generate Superbill
                  </>
                )}
              </Button>
            </>
          ) : (
            <Card>
              <CardContent className="py-12">
                <div className="text-center text-slate-500">
                  <Mic className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>Record a session or paste transcription text</p>
                  <p className="text-sm mt-2">AI will generate SOAP notes and billing recommendations</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

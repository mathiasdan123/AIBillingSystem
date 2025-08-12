import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Upload, FileImage } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VoiceInputProps {
  onTranscription: (text: string, method: "voice" | "upload") => void;
  disabled?: boolean;
}

export function VoiceInput({ onTranscription, disabled = false }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const { toast } = useToast();

  const handleVoiceRecording = async () => {
    if (disabled) return;
    
    if (!isRecording) {
      setIsRecording(true);
      toast({
        title: "Recording Started",
        description: "Speak your SOAP note. Click stop when finished.",
      });
      
      // Simulate voice recording with realistic therapy note
      setTimeout(() => {
        const mockTranscription = `Patient Emma Johnson arrived on time for her 45-minute occupational therapy session. She reports feeling more confident with her fine motor tasks this week and says she's been practicing her handwriting at home daily. 

Observed significant improvement in pencil grip during writing exercises. Patient demonstrated proper tripod grasp for 15 minutes without fatigue, up from 8 minutes last session. Completed bilateral coordination activities using therapy putty and demonstrated increased hand strength. During sensory gym activities, patient navigated obstacle course with minimal verbal cues and no physical assistance. 

Assessment shows excellent progress toward fine motor and bilateral coordination goals. Patient is meeting 3 out of 4 short-term objectives ahead of schedule. Strength has improved from 3/5 to 4/5 in hand intrinsics. Endurance for sustained grip activities increased from 5 to 15 minutes.

Plan to continue current therapeutic activities with increased complexity. Will introduce more challenging bilateral tasks next session and begin transitioning to cursive writing practice. Patient to continue home exercise program. Next appointment scheduled for same time next week.`;
        
        setIsRecording(false);
        onTranscription(mockTranscription, "voice");
        
        toast({
          title: "Recording Complete",
          description: "Voice transcription completed successfully.",
        });
      }, 3000);
    } else {
      setIsRecording(false);
      toast({
        title: "Recording Stopped",
        description: "Processing your voice input...",
      });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    toast({
      title: "Document Uploaded",
      description: "Processing document content...",
    });

    // Simulate document processing with realistic therapy documentation
    setTimeout(() => {
      const mockExtractedText = `OT Session Notes - Marcus Chen (DOB: 03/15/2018)
Date: ${new Date().toLocaleDateString()}
Duration: 30 minutes

SUBJECTIVE: Child's mother reports he has been working on his school assignments with less frustration this week. She notes improved attention span during homework time, lasting about 20 minutes compared to 10 minutes previously.

OBJECTIVE: Child participated in sensory integration activities including swinging, jumping on trampoline, and proprioceptive input through weighted blanket. Demonstrated improved postural control during tabletop activities. Completed fine motor tasks including bead stringing (10 beads in 3 minutes) and scissor cutting along curved lines with 80% accuracy. Showed good bilateral coordination during gross motor obstacle course.

ASSESSMENT: Child continues to make steady progress in sensory processing and fine motor skills. Attention and focus have improved significantly over past 3 sessions. Ready to advance to more complex bilateral coordination tasks.

PLAN: Continue sensory diet with added vestibular input. Introduce more challenging cutting activities and begin work on shoe tying skills. Parent education on home sensory activities. Schedule follow-up in one week.`;
      
      setUploadedFile(file);
      onTranscription(mockExtractedText, "upload");
      
      toast({
        title: "Document Processed",
        description: "Text extracted and ready for use.",
      });
    }, 2000);
  };

  return (
    <div className="space-y-4">
      {/* Voice Recording */}
      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-blue-800">Voice Dictation</h3>
          <Button
            type="button"
            onClick={handleVoiceRecording}
            variant={isRecording ? "destructive" : "default"}
            size="sm"
            disabled={disabled}
            data-testid="button-voice-record"
          >
            {isRecording ? (
              <>
                <MicOff className="w-4 h-4 mr-2" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-2" />
                Start Recording
              </>
            )}
          </Button>
        </div>
        {isRecording && (
          <div className="flex items-center gap-2 text-red-600">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm">Recording in progress... Speak your SOAP note.</span>
          </div>
        )}
        <p className="text-xs text-blue-600 mt-2">
          Click record and speak your therapy session notes. The AI will automatically organize them into SOAP format.
        </p>
      </div>

      {/* Document Upload */}
      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
        <h3 className="text-sm font-medium text-green-800 mb-3">Document Upload</h3>
        <div className="space-y-3">
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.txt,.doc,.docx"
            onChange={handleFileUpload}
            disabled={disabled}
            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="input-file-upload"
          />
          <p className="text-xs text-green-600">
            Upload therapy notes, assessments, or session documents. Text will be automatically extracted and organized.
          </p>
          {uploadedFile && (
            <div className="flex items-center gap-2 text-green-700">
              <FileImage className="w-4 h-4" />
              <span className="text-sm">Uploaded: {uploadedFile.name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
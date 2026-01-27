import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Upload, FileImage, AlertCircle, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface VoiceInputProps {
  onTranscription: (text: string, method: "voice" | "upload") => void;
  disabled?: boolean;
}

// Check if browser supports Web Speech API
const hasBrowserSpeechRecognition = () => {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
};

export function VoiceInput({ onTranscription, disabled = false }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [whisperAvailable, setWhisperAvailable] = useState<boolean | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const { toast } = useToast();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);

  // Check if Whisper API is available on mount
  useEffect(() => {
    fetch('/api/voice/status')
      .then(res => res.json())
      .then(data => setWhisperAvailable(data.available))
      .catch(() => setWhisperAvailable(false));
  }, []);

  const startBrowserSpeechRecognition = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      toast({
        title: "Not Supported",
        description: "Speech recognition is not supported in your browser.",
        variant: "destructive",
      });
      return false;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + ' ';
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      stopRecording();
      toast({
        title: "Recognition Error",
        description: `Error: ${event.error}`,
        variant: "destructive",
      });
    };

    recognition.onend = () => {
      if (finalTranscript.trim()) {
        onTranscription(finalTranscript.trim(), "voice");
        toast({
          title: "Transcription Complete",
          description: "Your speech has been transcribed using browser recognition.",
        });
      }
      setIsRecording(false);
      setRecordingTime(0);
    };

    recognitionRef.current = recognition;
    recognition.start();
    return true;
  };

  const startWhisperRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1];

          toast({
            title: "Processing",
            description: "Sending audio to Whisper for transcription...",
          });

          try {
            const response = await fetch('/api/voice/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audio: base64Audio,
                mimeType: 'audio/webm',
                language: 'en'
              })
            });

            const data = await response.json();

            if (response.ok && data.text) {
              onTranscription(data.text, "voice");
              toast({
                title: "Transcription Complete",
                description: "Your speech has been transcribed using OpenAI Whisper.",
              });
            } else {
              throw new Error(data.error || 'Transcription failed');
            }
          } catch (error) {
            console.error('Whisper transcription error:', error);
            toast({
              title: "Transcription Failed",
              description: error instanceof Error ? error.message : "Failed to transcribe audio",
              variant: "destructive",
            });
          }
        };
        reader.readAsDataURL(audioBlob);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      return true;
    } catch (error) {
      console.error('Microphone access error:', error);
      toast({
        title: "Microphone Error",
        description: "Could not access microphone. Please check permissions.",
        variant: "destructive",
      });
      return false;
    }
  };

  const startRecording = async () => {
    if (disabled) return;

    setIsRecording(true);
    setRecordingTime(0);

    // Start timer
    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);

    // Use Whisper if available, otherwise fall back to browser speech recognition
    if (whisperAvailable) {
      const started = await startWhisperRecording();
      if (!started) {
        stopRecording();
      }
    } else if (hasBrowserSpeechRecognition()) {
      const started = startBrowserSpeechRecognition();
      if (!started) {
        stopRecording();
      }
    } else {
      stopRecording();
      toast({
        title: "Not Available",
        description: "No speech recognition available. Please configure OpenAI API key for Whisper.",
        variant: "destructive",
      });
    }

    toast({
      title: "Recording Started",
      description: whisperAvailable
        ? "Speak your SOAP note. Click stop when finished. Using Whisper AI."
        : "Speak your SOAP note. Click stop when finished. Using browser recognition.",
    });
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    setIsRecording(false);
    setRecordingTime(0);
  };

  const handleVoiceRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;

    const file = event.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);

    // For audio files, try to transcribe with Whisper
    if (file.type.startsWith('audio/') && whisperAvailable) {
      toast({
        title: "Processing Audio",
        description: "Transcribing audio file with Whisper...",
      });

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];

        try {
          const response = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audio: base64Audio,
              mimeType: file.type,
              language: 'en'
            })
          });

          const data = await response.json();

          if (response.ok && data.text) {
            onTranscription(data.text, "upload");
            toast({
              title: "Audio Transcribed",
              description: "Audio file has been transcribed successfully.",
            });
          } else {
            throw new Error(data.error || 'Transcription failed');
          }
        } catch (error) {
          toast({
            title: "Transcription Failed",
            description: error instanceof Error ? error.message : "Failed to transcribe audio",
            variant: "destructive",
          });
        }
      };
      reader.readAsDataURL(file);
    } else {
      // For text/document files, show a placeholder message
      toast({
        title: "Document Uploaded",
        description: "Document processing requires OCR integration. Audio files are transcribed automatically.",
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Voice Recording */}
      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-blue-800">Voice Dictation</h3>
            {whisperAvailable !== null && (
              <Badge variant="outline" className={whisperAvailable ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}>
                {whisperAvailable ? (
                  <>
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Whisper AI
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Browser Only
                  </>
                )}
              </Badge>
            )}
          </div>
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
                Stop ({formatTime(recordingTime)})
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
          {whisperAvailable
            ? "Click record and speak your therapy session notes. OpenAI Whisper will transcribe with high accuracy."
            : "Click record and speak. Add OPENAI_API_KEY to .env for enhanced Whisper transcription."}
        </p>
      </div>

      {/* Document Upload */}
      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
        <h3 className="text-sm font-medium text-green-800 mb-3">Audio/Document Upload</h3>
        <div className="space-y-3">
          <input
            type="file"
            accept=".mp3,.wav,.webm,.m4a,.pdf,.jpg,.jpeg,.png,.txt,.doc,.docx"
            onChange={handleFileUpload}
            disabled={disabled}
            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="input-file-upload"
          />
          <p className="text-xs text-green-600">
            Upload audio files (.mp3, .wav, .webm) for automatic transcription, or documents for reference.
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

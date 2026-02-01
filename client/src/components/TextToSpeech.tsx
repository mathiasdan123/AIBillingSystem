import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Loader2, Square, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TextToSpeechProps {
  text: string;
  label?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  voiceId?: string;
  showVoiceSelector?: boolean;
  disabled?: boolean;
  className?: string;
}

interface VoicePresets {
  professional: string;
  friendly: string;
  authoritative: string;
  calm: string;
}

export function TextToSpeech({
  text,
  label = "Listen",
  variant = "outline",
  size = "sm",
  voiceId,
  showVoiceSelector = false,
  disabled = false,
  className = "",
}: TextToSpeechProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState<boolean | null>(null);
  const [selectedVoice, setSelectedVoice] = useState(voiceId || "professional");
  const [voicePresets, setVoicePresets] = useState<VoicePresets | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  // Check TTS availability on mount
  useEffect(() => {
    fetch('/api/tts/status')
      .then(res => res.json())
      .then(data => {
        setTtsAvailable(data.available);
        if (data.voicePresets) {
          setVoicePresets(data.voicePresets);
        }
      })
      .catch(() => setTtsAvailable(false));
  }, []);

  const handleSpeak = async () => {
    if (!text || isLoading || disabled) return;

    // If already playing, stop
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      return;
    }

    setIsLoading(true);

    try {
      const voiceIdToUse = voicePresets
        ? voicePresets[selectedVoice as keyof VoicePresets]
        : voiceId;

      const response = await fetch('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceId: voiceIdToUse,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Text-to-speech failed');
      }

      // Create audio from base64
      const audioBlob = base64ToBlob(data.audioBase64, data.contentType);
      const audioUrl = URL.createObjectURL(audioBlob);

      // Clean up previous audio
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }

      // Create and play new audio
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setIsPlaying(false);
        toast({
          title: "Playback Error",
          description: "Failed to play audio",
          variant: "destructive",
        });
      };

      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      console.error('TTS error:', error);
      toast({
        title: "Text-to-Speech Error",
        description: error instanceof Error ? error.message : "Failed to generate speech",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, []);

  if (ttsAvailable === false) {
    return (
      <Badge variant="outline" className="text-yellow-600 bg-yellow-50">
        <AlertCircle className="w-3 h-3 mr-1" />
        TTS unavailable
      </Badge>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {showVoiceSelector && voicePresets && (
        <Select value={selectedVoice} onValueChange={setSelectedVoice}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue placeholder="Voice" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="professional">Professional</SelectItem>
            <SelectItem value="friendly">Friendly</SelectItem>
            <SelectItem value="authoritative">Authoritative</SelectItem>
            <SelectItem value="calm">Calm</SelectItem>
          </SelectContent>
        </Select>
      )}

      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={isPlaying ? handleStop : handleSpeak}
        disabled={disabled || isLoading || !text}
        className={isPlaying ? "bg-red-50 hover:bg-red-100 text-red-600 border-red-200" : ""}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            Loading...
          </>
        ) : isPlaying ? (
          <>
            <Square className="w-4 h-4 mr-1" />
            Stop
          </>
        ) : (
          <>
            <Volume2 className="w-4 h-4 mr-1" />
            {label}
          </>
        )}
      </Button>
    </div>
  );
}

// Helper to convert base64 to Blob
function base64ToBlob(base64: string, contentType: string): Blob {
  const byteCharacters = atob(base64);
  const byteArrays: Uint8Array[] = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);

    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays, { type: contentType });
}

export default TextToSpeech;

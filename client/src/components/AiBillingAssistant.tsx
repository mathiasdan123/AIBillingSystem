import { useState, useRef, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestedActions?: { label: string; path: string }[];
  timestamp: number;
}

interface AssistantStatus {
  available: boolean;
  message: string;
}

const STORAGE_KEY = "ai-assistant-chat-history";
const DISMISSED_KEY = "ai-assistant-dismissed";
const GREETED_KEY = "ai-assistant-greeted";
const GREETED_VERSION_KEY = "ai-assistant-greeted-version";

/**
 * Bump this whenever we want every user to see Blanche again (e.g. after
 * a feature launch worth announcing). Users who already dismissed a
 * previous version will see the fresh greeting on their next page load.
 *
 * Convention: YYYY.MM.N where N increments per release in that month.
 * Keep the history in comments so we know what each bump corresponded to.
 *
 * 2026.04.1 — Stedi remediation Phases 1-5 + Help sidebar
 */
const GREETING_VERSION = "2026.04.1";

function loadHistory(): ChatMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveHistory(messages: ChatMessage[]) {
  try {
    // Keep only last 50 messages to avoid bloating localStorage
    const trimmed = messages.slice(-50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

export default function AiBillingAssistant() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Drag state
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, elX: 0, elY: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    // Ignore if clicking a button inside the header
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    isDraggingRef.current = true;

    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      elX: rect.left,
      elY: rect.top,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = ev.clientX - dragStartRef.current.mouseX;
      const dy = ev.clientY - dragStartRef.current.mouseY;
      let newX = dragStartRef.current.elX + dx;
      let newY = dragStartRef.current.elY + dy;

      // Clamp within viewport
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      newX = Math.max(0, Math.min(window.innerWidth - pw, newX));
      newY = Math.max(0, Math.min(window.innerHeight - ph, newY));

      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  const handleHeaderDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setPosition({ x: 0, y: 0 });
  }, []);

  // Auto-show greeting popup. Shows when:
  //   (a) user has never seen a greeting, OR
  //   (b) the last greeting they saw was for an older GREETING_VERSION
  //       (bumped after feature launches worth announcing).
  // Legacy GREETED_KEY + DISMISSED_KEY are ignored for new version bumps —
  // once we're on versioning, they're effectively "<initial-release>".
  useEffect(() => {
    const lastSeenVersion = localStorage.getItem(GREETED_VERSION_KEY);
    if (lastSeenVersion !== GREETING_VERSION && !isOpen) {
      const timer = setTimeout(() => setShowGreeting(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, isOpen]);

  const handleDismissGreeting = () => {
    setShowGreeting(false);
    // Mark this version as seen so we don't pester them again until we
    // bump GREETING_VERSION for the next announcement.
    localStorage.setItem(GREETED_VERSION_KEY, GREETING_VERSION);
  };

  const handleAcceptGreeting = () => {
    setShowGreeting(false);
    localStorage.setItem(GREETED_VERSION_KEY, GREETING_VERSION);
    setIsOpen(true);
  };

  // Check assistant availability on first open
  useEffect(() => {
    if (isOpen && !statusChecked) {
      fetch("/api/ai/assistant/status", { credentials: "include" })
        .then((r) => r.json())
        .then((data) => {
          setStatus(data);
          setStatusChecked(true);
        })
        .catch(() => {
          setStatus({ available: false, message: "Unable to reach the AI assistant service." });
          setStatusChecked(true);
        });
    }
  }, [isOpen, statusChecked]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Save history when messages change
  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // Stop speech recognition when chat is closed
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
        setIsListening(false);
      }
    }
  }, [isOpen]);

  // Cleanup speech recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  const handleSend = useCallback(async (overrideText?: string) => {
    // Allow callers (e.g., welcome suggestion buttons) to send a specific
    // message without first setting input state — avoids the async-setState
    // race where reading `input` right after `setInput()` sees the old value.
    const trimmed = (overrideText ?? input).trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      // Build conversation history for context (exclude timestamps and actions)
      const conversationHistory = messages.slice(-18).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await apiRequest("POST", "/api/ai/assistant", {
        message: trimmed,
        conversationHistory,
      });

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.response,
        suggestedActions: data.suggestedActions,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error && err.message.includes("503")
          ? "The AI assistant requires an OpenAI API key to be configured. Please contact your administrator."
          : err instanceof Error && err.message.includes("429")
            ? "Too many requests. Please wait a moment and try again."
            : "Sorry, something went wrong. Please try again.";

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: errorMessage,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearHistory = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      toast({ title: "Not supported", description: "Voice input requires Chrome, Edge, or Safari." });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      if (event.error === "not-allowed") {
        toast({ title: "Microphone blocked", description: "Allow microphone access in your browser settings." });
      } else if (event.error === "no-speech") {
        toast({ title: "No speech detected", description: "Please try again and speak into your microphone." });
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [toast]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const handleActionClick = (path: string) => {
    window.location.href = path;
  };

  // Pre-login greeting text and suggestion chips
  const preLoginGreeting = "Hi, I'm Blanche! I can answer questions about TherapyBill. Want to know about pricing, features, or how we handle HIPAA compliance?";
  const preLoginSuggestions = [
    { label: "View Pricing", anchor: "#pricing" },
    { label: "See Features", anchor: "#features" },
    { label: "HIPAA Compliance", anchor: "#compliance" },
    { label: "Contact Us", anchor: "#contact" },
    { label: "Start Free Trial", anchor: "/signup" },
  ];

  return (
    <>
      {/* Greeting Popup — shows once on first visit */}
      {showGreeting && !isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-5 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center flex-shrink-0 text-lg font-bold">B</div>
            <div className="flex-1">
              <h4 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">Hi, I'm Blanche!</h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                {isAuthenticated
                  ? "I'm your TherapyBill assistant. I can help you set up your practice, check insurance eligibility, write SOAP notes, and manage billing. Want me to help you get started?"
                  : "I can answer questions about TherapyBill AI. Want to know about pricing, features, or how we handle HIPAA compliance?"
                }
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-500 mt-2 italic">
                You can always find me here in the bottom-right whenever you need me — just click my bubble.
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleAcceptGreeting}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  {isAuthenticated ? "Yes, help me!" : "Tell me more!"}
                </button>
                <button
                  onClick={handleDismissGreeting}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  I'll explore on my own
                </button>
              </div>
            </div>
            <button
              onClick={handleDismissGreeting}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 -mt-1"
              aria-label="Dismiss"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* Floating Chat Bubble */}
      {!isOpen && (
        <button
          onClick={() => {
            setShowGreeting(false);
            localStorage.setItem(GREETED_VERSION_KEY, GREETING_VERSION);
            setIsOpen(true);
          }}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 hover:shadow-xl transition-all duration-200 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          aria-label="Open AI billing assistant"
          title="Blanche"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M8 10h.01" />
            <path d="M12 10h.01" />
            <path d="M16 10h.01" />
          </svg>
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className={`fixed z-50 w-[400px] max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden ${isMinimized ? "" : "h-[600px] max-h-[calc(100vh-4rem)]"}`}
          style={
            position.x === 0 && position.y === 0
              ? { bottom: "1.5rem", right: "1.5rem" }
              : { top: position.y, left: position.x }
          }
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white rounded-t-xl flex-shrink-0 select-none"
            style={{ cursor: isDraggingRef.current ? "grabbing" : "grab" }}
            onMouseDown={handleHeaderMouseDown}
            onDoubleClick={handleHeaderDoubleClick}
          >
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <div>
                <h3 className="text-sm font-semibold">Blanche</h3>
                <p className="text-xs text-blue-100">{isAuthenticated ? "Ask about billing, coding, or your practice" : "Learn about TherapyBill AI"}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="p-1.5 hover:bg-blue-500 rounded-md transition-colors"
                  title="Clear chat history"
                  aria-label="Clear chat history"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => setIsMinimized((prev) => !prev)}
                className="p-1.5 hover:bg-blue-500 rounded-md transition-colors"
                title={isMinimized ? "Expand" : "Minimize"}
                aria-label={isMinimized ? "Expand chat" : "Minimize chat"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {isMinimized ? (
                    <polyline points="17 11 12 6 7 11" />
                  ) : (
                    <path d="M5 12h14" />
                  )}
                </svg>
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-blue-500 rounded-md transition-colors"
                title="Close"
                aria-label="Close chat"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages Area */}
          {!isMinimized && <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Status warning */}
            {statusChecked && status && !status.available && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-200">
                {status.message}
              </div>
            )}

            {/* Welcome message */}
            {messages.length === 0 && (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-blue-600 dark:text-blue-400"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <path d="M12 17h.01" />
                  </svg>
                </div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                  Hi, I'm Blanche!
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  {isAuthenticated
                    ? "I'm your TherapyBill assistant. I can help you set up your practice, answer billing questions, manage claims, and more. What would you like to do?"
                    : preLoginGreeting
                  }
                </p>
                {isAuthenticated ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {[
                      "Help me get started",
                      "Add my first patient",
                      "How does billing work?",
                      "Explain 97530 vs 97110",
                      "What's my denial rate?",
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => handleSend(suggestion)}
                        disabled={isLoading}
                        className="text-xs px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap justify-center gap-2">
                    {preLoginSuggestions.map((item) => (
                      <a
                        key={item.label}
                        href={item.anchor}
                        onClick={() => setIsOpen(false)}
                        className="text-xs px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors"
                      >
                        {item.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Message bubbles */}
            {messages.map((msg, i) => (
              <div
                key={`${msg.timestamp}-${i}`}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words leading-relaxed">
                    {msg.content}
                  </div>

                  {/* Suggested action buttons */}
                  {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-1.5">
                      {msg.suggestedActions.map((action, j) => (
                        <button
                          key={j}
                          onClick={() => handleActionClick(action.path)}
                          className="text-xs px-2.5 py-1 rounded-md bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-slate-600 transition-colors"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-4 py-3">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>}

          {/* Input Area */}
          {!isMinimized && <div className="border-t border-slate-200 dark:border-slate-700 p-3 flex-shrink-0">
            {isAuthenticated ? (
              <>
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about billing, coding, or your practice..."
                    rows={1}
                    className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent max-h-24"
                    style={{ minHeight: "38px" }}
                    disabled={isLoading || (statusChecked && status !== null && !status.available)}
                  />
                  <button
                    onClick={isListening ? stopListening : startListening}
                    disabled={isLoading || (statusChecked && status !== null && !status.available)}
                    className={`flex-shrink-0 p-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:cursor-not-allowed ${
                      isListening
                        ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
                        : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
                    }`}
                    aria-label={isListening ? "Stop listening" : "Voice input"}
                    title={isListening ? "Stop listening" : "Voice input"}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || isLoading || (statusChecked && status !== null && !status.available)}
                    className="flex-shrink-0 p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="Send message"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 2 11 13" />
                      <path d="M22 2 15 22l-4-9-9-4z" />
                    </svg>
                  </button>
                </div>
                {isListening && (
                  <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    Listening... click the microphone to stop
                  </p>
                )}
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 text-center">
                  TherapyBill AI assists with billing accuracy by suggesting codes based on clinical documentation. All coding decisions must be reviewed and approved by the treating provider. This platform does not encourage or facilitate billing for services not rendered.
                </p>
              </>
            ) : (
              <div className="text-center py-2">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Sign up for a free trial to access the full AI assistant!
                </p>
                <a
                  href="/signup"
                  className="inline-block px-4 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  Start Free Trial
                </a>
              </div>
            )}
          </div>}
        </div>
      )}
    </>
  );
}

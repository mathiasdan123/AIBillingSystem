import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  Plus,
  Search,
  Archive,
  Check,
  CheckCheck,
  Clock,
  User,
  ArrowLeft,
  MoreVertical,
  Copy,
  Link,
  RefreshCw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Patient {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

interface Message {
  id: number;
  conversationId: number;
  senderId: string | null;
  senderType: "therapist" | "patient";
  senderName: string | null;
  content: string;
  attachments: any[];
  readAt: string | null;
  readByRecipient: boolean;
  deliveredAt: string | null;
  createdAt: string;
}

interface Conversation {
  id: number;
  practiceId: number;
  patientId: number;
  therapistId: string | null;
  subject: string | null;
  status: string;
  patientAccessToken: string | null;
  lastMessageAt: string | null;
  unreadByTherapist: number;
  unreadByPatient: number;
  createdAt: string;
  patient: Patient | null;
}

export default function MessagesPage() {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [initialMessage, setInitialMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch conversations
  const { data: conversations = [], isLoading: loadingConversations } = useQuery<Conversation[]>({
    queryKey: ["/api/messages/conversations"],
  });

  // Fetch patients for new conversation
  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
  });

  // Fetch messages for selected conversation
  const { data: conversationData, refetch: refetchMessages } = useQuery<{
    conversation: Conversation;
    messages: Message[];
    patient: Patient | null;
  }>({
    queryKey: ["/api/messages/conversations", selectedConversation?.id],
    enabled: !!selectedConversation,
  });

  // Fetch unread count
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-count"],
    refetchInterval: 30000, // Poll every 30 seconds
  });

  // Send message mutation
  const sendMessage = useMutation({
    mutationFn: async ({ conversationId, content }: { conversationId: number; content: string }) => {
      const res = await fetch(`/api/messages/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
    onSuccess: () => {
      setNewMessage("");
      refetchMessages();
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive",
      });
    },
  });

  // Create conversation mutation
  const createConversation = useMutation({
    mutationFn: async ({ patientId, initialMessage }: { patientId: number; initialMessage?: string }) => {
      const res = await fetch("/api/messages/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, initialMessage }),
      });
      if (!res.ok) throw new Error("Failed to create conversation");
      return res.json();
    },
    onSuccess: (data) => {
      setShowNewConversation(false);
      setSelectedPatientId("");
      setInitialMessage("");
      setSelectedConversation(data.conversation);
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      if (data.isExisting) {
        toast({
          title: "Existing Conversation",
          description: "Opened existing conversation with this patient",
        });
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create conversation",
        variant: "destructive",
      });
    },
  });

  // Archive conversation mutation
  const archiveConversation = useMutation({
    mutationFn: async (conversationId: number) => {
      const res = await fetch(`/api/messages/conversations/${conversationId}/archive`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("Failed to archive conversation");
      return res.json();
    },
    onSuccess: () => {
      setSelectedConversation(null);
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      toast({
        title: "Conversation Archived",
        description: "The conversation has been archived",
      });
    },
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationData?.messages]);

  // Poll for new messages when conversation is selected
  useEffect(() => {
    if (!selectedConversation) return;
    const interval = setInterval(() => {
      refetchMessages();
    }, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, [selectedConversation, refetchMessages]);

  const filteredConversations = conversations.filter((conv) => {
    if (!searchQuery) return true;
    const patientName = conv.patient
      ? `${conv.patient.firstName} ${conv.patient.lastName}`.toLowerCase()
      : "";
    return patientName.includes(searchQuery.toLowerCase());
  });

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return date.toLocaleDateString("en-US", { weekday: "short" });
    } else {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  };

  const getInitials = (name: string | null) => {
    if (!name) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const copyPatientLink = (token: string) => {
    const url = `${window.location.origin}/messages/${token}`;
    navigator.clipboard.writeText(url);
    toast({
      title: "Link Copied",
      description: "Patient messaging link copied to clipboard",
    });
  };

  const handleSendMessage = () => {
    if (!selectedConversation || !newMessage.trim()) return;
    sendMessage.mutate({ conversationId: selectedConversation.id, content: newMessage });
  };

  return (
    <div className="md:ml-64 min-h-screen bg-slate-50">
      <div className="h-screen flex">
        {/* Conversations List */}
        <div
          className={`w-full md:w-96 bg-white border-r flex flex-col ${
            selectedConversation ? "hidden md:flex" : "flex"
          }`}
        >
          {/* Header */}
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-6 w-6 text-primary" />
                <h1 className="text-xl font-bold">Messages</h1>
                {unreadData && unreadData.count > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {unreadData.count}
                  </Badge>
                )}
              </div>
              <Dialog open={showNewConversation} onOpenChange={setShowNewConversation}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    New
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>New Conversation</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Select Patient</label>
                      <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a patient" />
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
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Initial Message (optional)</label>
                      <Textarea
                        value={initialMessage}
                        onChange={(e) => setInitialMessage(e.target.value)}
                        placeholder="Type your first message..."
                        rows={3}
                      />
                    </div>
                    <Button
                      className="w-full"
                      disabled={!selectedPatientId || createConversation.isPending}
                      onClick={() =>
                        createConversation.mutate({
                          patientId: parseInt(selectedPatientId),
                          initialMessage: initialMessage || undefined,
                        })
                      }
                    >
                      Start Conversation
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="pl-9"
              />
            </div>
          </div>

          {/* Conversations */}
          <ScrollArea className="flex-1">
            {loadingConversations ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No conversations yet</p>
                <Button variant="link" onClick={() => setShowNewConversation(true)}>
                  Start a new conversation
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                {filteredConversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConversation(conv)}
                    className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors ${
                      selectedConversation?.id === conv.id ? "bg-blue-50" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar>
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {conv.patient ? getInitials(`${conv.patient.firstName} ${conv.patient.lastName}`) : "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium truncate">
                            {conv.patient
                              ? `${conv.patient.firstName} ${conv.patient.lastName}`
                              : "Unknown Patient"}
                          </p>
                          {conv.lastMessageAt && (
                            <span className="text-xs text-muted-foreground">
                              {formatTime(conv.lastMessageAt)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {conv.subject || "No subject"}
                        </p>
                        {conv.unreadByTherapist > 0 && (
                          <Badge variant="default" className="mt-1">
                            {conv.unreadByTherapist} new
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Message View */}
        <div
          className={`flex-1 flex flex-col bg-white ${
            selectedConversation ? "flex" : "hidden md:flex"
          }`}
        >
          {selectedConversation ? (
            <>
              {/* Conversation Header */}
              <div className="p-4 border-b flex items-center justify-between bg-white">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="md:hidden"
                    onClick={() => setSelectedConversation(null)}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <Avatar>
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {conversationData?.patient
                        ? getInitials(
                            `${conversationData.patient.firstName} ${conversationData.patient.lastName}`
                          )
                        : "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">
                      {conversationData?.patient
                        ? `${conversationData.patient.firstName} ${conversationData.patient.lastName}`
                        : "Patient"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {conversationData?.patient?.email || "No email"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => refetchMessages()}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-5 w-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {selectedConversation.patientAccessToken && (
                        <DropdownMenuItem
                          onClick={() => copyPatientLink(selectedConversation.patientAccessToken!)}
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copy Patient Link
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => archiveConversation.mutate(selectedConversation.id)}
                      >
                        <Archive className="h-4 w-4 mr-2" />
                        Archive Conversation
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4 max-w-3xl mx-auto">
                  {conversationData?.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.senderType === "therapist" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-3 ${
                          msg.senderType === "therapist"
                            ? "bg-primary text-white"
                            : "bg-slate-100 text-slate-900"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <div
                          className={`flex items-center gap-1 mt-1 text-xs ${
                            msg.senderType === "therapist" ? "text-white/70" : "text-muted-foreground"
                          }`}
                        >
                          <span>{formatTime(msg.createdAt)}</span>
                          {msg.senderType === "therapist" && (
                            <>
                              {msg.readByRecipient ? (
                                <CheckCheck className="h-3 w-3" />
                              ) : msg.deliveredAt ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Clock className="h-3 w-3" />
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Message Input */}
              <div className="p-4 border-t bg-white">
                <div className="flex gap-2 max-w-3xl mx-auto">
                  <Textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type your message..."
                    className="min-h-[44px] max-h-32 resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!newMessage.trim() || sendMessage.isPending}
                  >
                    <Send className="h-5 w-5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Press Enter to send, Shift+Enter for new line
                </p>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <h2 className="text-xl font-medium mb-2">Select a conversation</h2>
                <p>Choose a conversation from the list or start a new one</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface PatientPortalMessagesProps {
  token: string;
}

export default function PatientPortalMessages({ token }: PatientPortalMessagesProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [newMessageText, setNewMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversations
  const { data: conversations = [], isLoading, error } = useQuery<any[]>({
    queryKey: ["/api/public/portal", token, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/public/portal/${token}/messages`);
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Fetch selected conversation with messages
  const { data: conversationData, isLoading: isLoadingConversation } = useQuery<{
    conversation: any;
    messages: any[];
    patient: any;
  }>({
    queryKey: ["/api/public/portal", token, "messages", selectedConversationId],
    queryFn: async () => {
      const res = await fetch(`/api/public/portal/${token}/messages/${selectedConversationId}`);
      if (!res.ok) throw new Error("Failed to fetch conversation");
      return res.json();
    },
    enabled: !!selectedConversationId,
    refetchInterval: 15000,
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ conversationId, content }: { conversationId: number; content: string }) => {
      const res = await fetch(`/api/public/portal/${token}/messages/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to send message");
      }
      return res.json();
    },
    onSuccess: () => {
      setNewMessageText("");
      queryClient.invalidateQueries({ queryKey: ["/api/public/portal", token, "messages", selectedConversationId] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/portal", token, "messages"] });
    },
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    if (conversationData?.messages) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [conversationData?.messages]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">{t('portal.messages', 'Messages')}</h2>
          <p className="text-muted-foreground">{t('portal.messagesDesc', 'View and respond to messages from your provider')}</p>
        </div>
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-8">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <p className="text-lg font-medium">{t('portal.failedLoadMessages', 'Failed to load messages')}</p>
          <p className="text-muted-foreground">{t('portal.tryRefreshing', 'Please try refreshing the page.')}</p>
        </CardContent>
      </Card>
    );
  }

  // Conversation detail view
  if (selectedConversationId && conversationData) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedConversationId(null);
                  setNewMessageText("");
                }}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                {t('portal.back', 'Back')}
              </Button>
              <div>
                <CardTitle className="text-base">
                  {conversationData.conversation.subject || t('portal.conversation', 'Conversation')}
                </CardTitle>
                <CardDescription>
                  {conversationData.conversation.status === "active"
                    ? t('portal.activeConversation', 'Active conversation')
                    : conversationData.conversation.status}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Messages list */}
            <div className="border rounded-lg bg-slate-50 p-4 max-h-[500px] overflow-y-auto space-y-4 mb-4">
              {isLoadingConversation ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : conversationData.messages.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  {t('portal.noMessagesYet', 'No messages yet. Start the conversation below.')}
                </p>
              ) : (
                conversationData.messages.map((msg: any) => {
                  const isPatient = msg.senderType === "patient";
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isPatient ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-lg p-3 ${
                          isPatient
                            ? "bg-primary text-primary-foreground"
                            : "bg-white border"
                        }`}
                      >
                        <p className={`text-xs font-medium mb-1 ${isPatient ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {msg.senderName || (isPatient ? t('portal.you', 'You') : t('portal.therapist', 'Therapist'))}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <p className={`text-xs mt-1 ${isPatient ? "text-primary-foreground/50" : "text-muted-foreground"}`}>
                          {new Date(msg.createdAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply input */}
            {conversationData.conversation.status === "active" && (
              <div className="flex gap-2">
                <Textarea
                  placeholder={t('portal.typeMessage', 'Type your message...')}
                  value={newMessageText}
                  onChange={(e) => setNewMessageText(e.target.value)}
                  className="min-h-[80px] resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (newMessageText.trim() && !sendMessageMutation.isPending) {
                        sendMessageMutation.mutate({
                          conversationId: selectedConversationId,
                          content: newMessageText.trim(),
                        });
                      }
                    }
                  }}
                />
                <Button
                  className="self-end"
                  disabled={!newMessageText.trim() || sendMessageMutation.isPending}
                  onClick={() => {
                    if (newMessageText.trim()) {
                      sendMessageMutation.mutate({
                        conversationId: selectedConversationId,
                        content: newMessageText.trim(),
                      });
                    }
                  }}
                >
                  {sendMessageMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}
            {sendMessageMutation.isError && (
              <p className="text-sm text-destructive mt-2">
                {sendMessageMutation.error?.message || t('portal.failedSendMessage', 'Failed to send message')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Conversations list view
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-primary" />
          {t('portal.messages', 'Messages')}
        </h2>
        <p className="text-muted-foreground mt-1">
          {t('portal.messagesDesc', 'View and respond to messages from your provider')}
        </p>
      </div>

      {conversations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="h-8 w-8 text-primary" />
            </div>
            <p className="text-lg font-medium text-center">
              {t('portal.noConversations', 'No conversations yet')}
            </p>
            <p className="text-muted-foreground text-center mt-2 max-w-md">
              {t('portal.noConversationsDesc', 'Your provider will start a conversation when needed.')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv: any) => (
            <Card
              key={conv.id}
              className="cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => setSelectedConversationId(conv.id)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    (conv.unreadByPatient || 0) > 0 ? "bg-primary/10" : "bg-slate-100"
                  }`}>
                    <MessageSquare className={`h-6 w-6 ${
                      (conv.unreadByPatient || 0) > 0 ? "text-primary" : "text-slate-500"
                    }`} />
                  </div>
                  <div>
                    <p className="font-medium">{conv.subject || t('portal.conversation', 'Conversation')}</p>
                    <p className="text-sm text-muted-foreground">
                      {conv.lastMessageAt
                        ? new Date(conv.lastMessageAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : t('portal.noMessagesYet', 'No messages yet')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(conv.unreadByPatient || 0) > 0 && (
                    <Badge variant="destructive">{conv.unreadByPatient}</Badge>
                  )}
                  <Badge variant="outline">{conv.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

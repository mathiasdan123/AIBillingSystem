import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Bot, Send, Sparkles, Trash2, User as UserIcon } from "lucide-react";

/**
 * Admin queue for support tickets — the human side of 24/7 support.
 *
 * The triage agent files draft replies (authorType 'agent', status 'draft');
 * they surface here highlighted, and nothing reaches a reporter until an
 * admin publishes it. Staff replies and status changes also happen here.
 */

interface Ticket {
  id: number;
  practiceId: number;
  userId: string | null;
  userRole: string | null;
  severity: string;
  description: string;
  page: string | null;
  release: string | null;
  source: string;
  status: string;
  notes: string | null;
  triageCategory: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
}

interface Reply {
  id: number;
  ticketId: number;
  authorType: "user" | "staff" | "agent";
  body: string;
  status: "draft" | "published";
  createdAt: string | null;
  publishedAt: string | null;
}

const SEVERITY_BADGE: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  normal: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  low: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100",
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function SupportTicketsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);
  const [draftEditText, setDraftEditText] = useState("");

  const listKey = ["/api/support/reports", statusFilter];
  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: listKey,
    queryFn: async () => {
      const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const res = await apiRequest("GET", `/api/support/reports${qs}`);
      return res.json();
    },
  });

  const detailKey = ["/api/support/reports", selectedId, "replies"];
  const { data: detail } = useQuery<{ ticket: Ticket; replies: Reply[] }>({
    queryKey: detailKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/support/reports/${selectedId}/replies`);
      return res.json();
    },
    enabled: selectedId != null,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/support/reports"] });
  };

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/support/reports/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Ticket updated" });
    },
    onError: (err: unknown) =>
      toast({ title: "Update failed", description: String(err), variant: "destructive" }),
  });

  const replyMutation = useMutation({
    mutationFn: async () => {
      if (selectedId == null) throw new Error("No ticket selected");
      const res = await apiRequest("POST", `/api/support/reports/${selectedId}/replies`, {
        body: replyText,
      });
      return res.json();
    },
    onSuccess: () => {
      setReplyText("");
      invalidate();
      toast({ title: "Reply sent" });
    },
    onError: (err: unknown) =>
      toast({ title: "Reply failed", description: String(err), variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: async ({ replyId, body }: { replyId: number; body?: string }) => {
      const res = await apiRequest("POST", `/api/support/replies/${replyId}/publish`, body != null ? { body } : {});
      return res.json();
    },
    onSuccess: () => {
      setEditingDraftId(null);
      invalidate();
      toast({ title: "Draft published — the reporter can now see it" });
    },
    onError: (err: unknown) =>
      toast({ title: "Publish failed", description: String(err), variant: "destructive" }),
  });

  const discardMutation = useMutation({
    mutationFn: async (replyId: number) => {
      const res = await apiRequest("DELETE", `/api/support/replies/${replyId}`);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Draft discarded" });
    },
    onError: (err: unknown) =>
      toast({ title: "Discard failed", description: String(err), variant: "destructive" }),
  });

  const selected = detail?.ticket;
  const replies = detail?.replies ?? [];

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="support-tickets-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Support Tickets</h1>
          <p className="text-sm text-muted-foreground">
            Problem reports from your team — filed via the bug button or Blanche.
            Agent-drafted replies wait here for your approval before the reporter sees them.
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {statusFilter === "all" ? "All tickets" : `${statusFilter.replace("_", " ")} tickets`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tickets here. Quiet is good.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Filed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(t.id)}
                    data-testid={`row-ticket-${t.id}`}
                  >
                    <TableCell className="font-mono">{t.id}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[t.status] ?? ""}>{t.status.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={SEVERITY_BADGE[t.severity] ?? ""}>{t.severity}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate" title={t.description}>
                      {t.description}
                    </TableCell>
                    <TableCell>
                      {t.triageCategory ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Sparkles className="h-3 w-3" />
                          {t.triageCategory.replace("_", " ")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.source}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(t.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={selectedId != null} onOpenChange={(open) => { if (!open) { setSelectedId(null); setEditingDraftId(null); setReplyText(""); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  Ticket #{selected.id}
                  <Badge className={SEVERITY_BADGE[selected.severity] ?? ""}>{selected.severity}</Badge>
                  <Badge className={STATUS_BADGE[selected.status] ?? ""}>{selected.status.replace("_", " ")}</Badge>
                </DialogTitle>
                <DialogDescription>
                  Filed {formatDateTime(selected.createdAt)} via {selected.source}
                  {selected.userRole ? ` · reporter role: ${selected.userRole}` : ""}
                  {selected.page ? ` · page: ${selected.page}` : ""}
                  {selected.release ? ` · release: ${selected.release.slice(0, 7)}` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap bg-muted/30">
                {selected.description}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Status:</span>
                <Select
                  value={selected.status}
                  onValueChange={(v) => statusMutation.mutate({ id: selected.id, status: v })}
                >
                  <SelectTrigger className="w-40" data-testid="select-ticket-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">Replies</h3>
                {replies.length === 0 && (
                  <p className="text-sm text-muted-foreground">No replies yet.</p>
                )}
                {replies.map((r) => (
                  <div
                    key={r.id}
                    className={`rounded-lg border p-3 text-sm space-y-2 ${
                      r.status === "draft"
                        ? "border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800"
                        : ""
                    }`}
                    data-testid={`reply-${r.id}`}
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {r.authorType === "agent" ? (
                        <Bot className="h-3.5 w-3.5" />
                      ) : (
                        <UserIcon className="h-3.5 w-3.5" />
                      )}
                      <span className="font-medium">
                        {r.authorType === "agent"
                          ? "Support agent (AI)"
                          : r.authorType === "staff"
                            ? "Staff"
                            : "Reporter"}
                      </span>
                      <span>· {formatDateTime(r.createdAt)}</span>
                      {r.status === "draft" && (
                        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">
                          Draft — not visible to reporter
                        </Badge>
                      )}
                    </div>
                    {editingDraftId === r.id ? (
                      <>
                        <Textarea
                          value={draftEditText}
                          onChange={(e) => setDraftEditText(e.target.value)}
                          rows={5}
                          data-testid={`input-edit-draft-${r.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => publishMutation.mutate({ replyId: r.id, body: draftEditText })}
                            disabled={publishMutation.isPending}
                            data-testid={`button-publish-edited-${r.id}`}
                          >
                            <Send className="h-3.5 w-3.5 mr-1" /> Publish edited
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingDraftId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap">{r.body}</p>
                        {r.status === "draft" && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => publishMutation.mutate({ replyId: r.id })}
                              disabled={publishMutation.isPending}
                              data-testid={`button-publish-${r.id}`}
                            >
                              <Send className="h-3.5 w-3.5 mr-1" /> Publish
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingDraftId(r.id);
                                setDraftEditText(r.body);
                              }}
                              data-testid={`button-edit-${r.id}`}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => discardMutation.mutate(r.id)}
                              disabled={discardMutation.isPending}
                              data-testid={`button-discard-${r.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}

                <div className="space-y-2">
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Reply to the reporter… (visible to them immediately)"
                    rows={3}
                    data-testid="input-reply"
                  />
                  <Button
                    size="sm"
                    onClick={() => replyMutation.mutate()}
                    disabled={replyMutation.isPending || replyText.trim().length < 2}
                    data-testid="button-send-reply"
                  >
                    <Send className="h-3.5 w-3.5 mr-1" /> Send reply
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

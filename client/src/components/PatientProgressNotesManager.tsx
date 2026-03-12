import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FileText,
  Plus,
  Eye,
  EyeOff,
  Sparkles,
  Calendar,
  Target,
  BookOpen,
  ArrowRight,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";

interface ProgressNote {
  id: number;
  patientId: number;
  practiceId: number;
  sessionId: number | null;
  sessionDate: string;
  therapistName: string;
  summary: string;
  goalsDiscussed: string[] | null;
  homework: string | null;
  nextSessionFocus: string | null;
  sharedAt: string | null;
  sharedBy: string | null;
  createdAt: string;
}

interface PatientProgressNotesManagerProps {
  patientId: number;
  sessionId?: number; // If provided, pre-fill for this session
  sessionDate?: string;
}

export default function PatientProgressNotesManager({
  patientId,
  sessionId,
  sessionDate,
}: PatientProgressNotesManagerProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [previewNote, setPreviewNote] = useState<ProgressNote | null>(null);

  // Form state
  const [summary, setSummary] = useState("");
  const [goalsInput, setGoalsInput] = useState("");
  const [homework, setHomework] = useState("");
  const [nextSessionFocus, setNextSessionFocus] = useState("");
  const [noteSessionDate, setNoteSessionDate] = useState(sessionDate || new Date().toISOString().split("T")[0]);
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const { data: notes, isLoading } = useQuery<ProgressNote[]>({
    queryKey: [`/api/patients/${patientId}/progress-notes`],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/progress-notes`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch progress notes");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/patients/${patientId}/progress-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create progress note");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/progress-notes`] });
      toast({ title: t('progressNotes.created'), description: t('progressNotes.createdDesc') });
      resetForm();
      setCreateDialogOpen(false);
    },
    onError: () => {
      toast({ title: t('progressNotes.createFailed'), variant: "destructive" });
    },
  });

  const shareMutation = useMutation({
    mutationFn: async ({ noteId, share }: { noteId: number; share: boolean }) => {
      const action = share ? "share" : "unshare";
      const res = await fetch(`/api/patients/${patientId}/progress-notes/${noteId}/${action}`, {
        method: "PUT",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to ${action} progress note`);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${patientId}/progress-notes`] });
      const action = variables.share ? t('progressNotes.shared') : t('progressNotes.unshared');
      toast({ title: action, description: variables.share ? t('progressNotes.sharedDesc') : t('progressNotes.unsharedDesc') });
    },
    onError: () => {
      toast({ title: t('progressNotes.shareFailed'), variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSummary("");
    setGoalsInput("");
    setHomework("");
    setNextSessionFocus("");
    setNoteSessionDate(sessionDate || new Date().toISOString().split("T")[0]);
    setAutoGenerate(false);
    setIsCreating(false);
  };

  const handleCreate = async () => {
    setIsCreating(true);
    const goalsDiscussed = goalsInput
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);

    createMutation.mutate({
      sessionId: sessionId || null,
      sessionDate: noteSessionDate,
      summary: autoGenerate ? "" : summary,
      goalsDiscussed: autoGenerate ? [] : goalsDiscussed,
      homework: autoGenerate ? "" : homework || null,
      nextSessionFocus: autoGenerate ? "" : nextSessionFocus || null,
      autoGenerate: autoGenerate && !!sessionId,
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {t('progressNotes.title')}
            </CardTitle>
            <CardDescription>{t('progressNotes.description')}</CardDescription>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                {t('progressNotes.create')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t('progressNotes.createTitle')}</DialogTitle>
                <DialogDescription>{t('progressNotes.createDesc')}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                {/* Session Date */}
                <div className="space-y-2">
                  <Label>{t('progressNotes.sessionDate')}</Label>
                  <Input
                    type="date"
                    value={noteSessionDate}
                    onChange={(e) => setNoteSessionDate(e.target.value)}
                  />
                </div>

                {/* Auto-generate toggle */}
                {sessionId && (
                  <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-blue-600" />
                      <div>
                        <p className="text-sm font-medium">{t('progressNotes.autoGenerate')}</p>
                        <p className="text-xs text-muted-foreground">{t('progressNotes.autoGenerateDesc')}</p>
                      </div>
                    </div>
                    <Switch checked={autoGenerate} onCheckedChange={setAutoGenerate} />
                  </div>
                )}

                {!autoGenerate && (
                  <>
                    {/* Summary */}
                    <div className="space-y-2">
                      <Label>{t('progressNotes.summary')}</Label>
                      <Textarea
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        placeholder={t('progressNotes.summaryPlaceholder')}
                        rows={4}
                      />
                    </div>

                    {/* Goals */}
                    <div className="space-y-2">
                      <Label>{t('progressNotes.goals')}</Label>
                      <Input
                        value={goalsInput}
                        onChange={(e) => setGoalsInput(e.target.value)}
                        placeholder={t('progressNotes.goalsPlaceholder')}
                      />
                      <p className="text-xs text-muted-foreground">{t('progressNotes.goalsHint')}</p>
                    </div>

                    {/* Homework */}
                    <div className="space-y-2">
                      <Label>{t('progressNotes.homeworkLabel')}</Label>
                      <Textarea
                        value={homework}
                        onChange={(e) => setHomework(e.target.value)}
                        placeholder={t('progressNotes.homeworkPlaceholder')}
                        rows={2}
                      />
                    </div>

                    {/* Next Session Focus */}
                    <div className="space-y-2">
                      <Label>{t('progressNotes.nextFocusLabel')}</Label>
                      <Textarea
                        value={nextSessionFocus}
                        onChange={(e) => setNextSessionFocus(e.target.value)}
                        placeholder={t('progressNotes.nextFocusPlaceholder')}
                        rows={2}
                      />
                    </div>
                  </>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { resetForm(); setCreateDialogOpen(false); }}>
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={isCreating || createMutation.isPending || (!autoGenerate && !summary.trim())}
                >
                  {(isCreating || createMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {autoGenerate ? t('progressNotes.generateAndCreate') : t('progressNotes.createNote')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          {(!notes || notes.length === 0) ? (
            <div className="text-center py-6">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t('progressNotes.noNotes')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="flex items-start justify-between p-3 bg-slate-50 rounded-lg border"
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">{formatDate(note.sessionDate)}</span>
                      {note.sharedAt ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                          <Eye className="h-3 w-3 mr-1" />
                          {t('progressNotes.sharedWithPatient')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          <EyeOff className="h-3 w-3 mr-1" />
                          {t('progressNotes.draft')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {note.summary}
                    </p>
                    {note.goalsDiscussed && note.goalsDiscussed.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(note.goalsDiscussed as string[]).map((goal, i) => (
                          <Badge key={i} variant="secondary" className="text-xs font-normal">
                            {goal}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreviewNote(note)}
                      title={t('progressNotes.preview')}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={note.sharedAt ? "outline" : "default"}
                      size="sm"
                      onClick={() => shareMutation.mutate({ noteId: note.id, share: !note.sharedAt })}
                      disabled={shareMutation.isPending}
                    >
                      {note.sharedAt ? (
                        <>
                          <EyeOff className="h-4 w-4 mr-1" />
                          {t('progressNotes.unshare')}
                        </>
                      ) : (
                        <>
                          <Eye className="h-4 w-4 mr-1" />
                          {t('progressNotes.share')}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={!!previewNote} onOpenChange={() => setPreviewNote(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              {t('progressNotes.patientPreview')}
            </DialogTitle>
            <DialogDescription>
              {t('progressNotes.patientPreviewDesc')}
            </DialogDescription>
          </DialogHeader>

          {previewNote && (
            <div className="space-y-4 py-2">
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span className="font-medium">{formatDate(previewNote.sessionDate)}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('portal.withTherapist', { name: previewNote.therapistName })}
                </p>
              </div>

              {/* Summary */}
              <div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{previewNote.summary}</p>
              </div>

              {/* Goals */}
              {previewNote.goalsDiscussed && (previewNote.goalsDiscussed as string[]).length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                    <Target className="h-4 w-4" />
                    {t('portal.goalsDiscussed')}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {(previewNote.goalsDiscussed as string[]).map((goal, i) => (
                      <Badge key={i} variant="secondary" className="bg-blue-50 text-blue-700 font-normal">
                        {goal}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Homework */}
              {previewNote.homework && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-green-700">
                    <BookOpen className="h-4 w-4" />
                    {t('portal.homework')}
                  </h4>
                  <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                    <p className="text-sm text-green-800 whitespace-pre-wrap">{previewNote.homework}</p>
                  </div>
                </div>
              )}

              {/* Next Session */}
              {previewNote.nextSessionFocus && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-purple-700">
                    <ArrowRight className="h-4 w-4" />
                    {t('portal.nextSessionFocus')}
                  </h4>
                  <div className="bg-purple-50 rounded-lg p-3 border border-purple-100">
                    <p className="text-sm text-purple-800 whitespace-pre-wrap">{previewNote.nextSessionFocus}</p>
                  </div>
                </div>
              )}

              {/* Share status */}
              <div className="flex items-center gap-2 pt-2 border-t">
                {previewNote.sharedAt ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-green-700">{t('progressNotes.currentlyShared')}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{t('progressNotes.notSharedYet')}</span>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  Calendar,
  Target,
  BookOpen,
  ArrowRight,
  AlertCircle,
  Heart,
} from "lucide-react";

interface ProgressNote {
  id: number;
  sessionDate: string;
  therapistName: string;
  summary: string;
  goalsDiscussed: string[] | null;
  homework: string | null;
  nextSessionFocus: string | null;
  sharedAt: string;
  createdAt: string;
}

interface PatientPortalProgressNotesProps {
  token: string;
}

export default function PatientPortalProgressNotes({ token }: PatientPortalProgressNotesProps) {
  const { t } = useTranslation();

  const { data: notes, isLoading, error } = useQuery<ProgressNote[]>({
    queryKey: ["/api/patient-portal/progress-notes", token],
    queryFn: async () => {
      const res = await fetch("/api/patient-portal/progress-notes", {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error("Failed to fetch progress notes");
      }
      return res.json();
    },
    refetchInterval: 120000, // Refresh every 2 minutes
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">{t('portal.progressNotes')}</h2>
          <p className="text-muted-foreground">{t('portal.progressNotesDesc')}</p>
        </div>
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
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
          <p className="text-lg font-medium">{t('portal.failedLoadProgressNotes')}</p>
          <p className="text-muted-foreground">{t('portal.tryRefreshing')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          {t('portal.progressNotes')}
        </h2>
        <p className="text-muted-foreground mt-1">
          {t('portal.progressNotesDesc')}
        </p>
      </div>

      {/* Empty State */}
      {(!notes || notes.length === 0) && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Heart className="h-8 w-8 text-primary" />
            </div>
            <p className="text-lg font-medium text-center">
              {t('portal.noProgressNotes')}
            </p>
            <p className="text-muted-foreground text-center mt-2 max-w-md">
              {t('portal.noProgressNotesDesc')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Notes List */}
      {notes && notes.length > 0 && (
        <div className="space-y-4">
          {notes.map((note) => (
            <Card key={note.id} className="overflow-hidden">
              {/* Note Header */}
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-primary" />
                      {formatDate(note.sessionDate)}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {t('portal.withTherapist', { name: note.therapistName })}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-4 space-y-4">
                {/* Summary */}
                <div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {note.summary}
                  </p>
                </div>

                {/* Goals Discussed */}
                {note.goalsDiscussed && note.goalsDiscussed.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                      <Target className="h-4 w-4" />
                      {t('portal.goalsDiscussed')}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {note.goalsDiscussed.map((goal, index) => (
                        <Badge
                          key={index}
                          variant="secondary"
                          className="bg-blue-50 text-blue-700 hover:bg-blue-100 font-normal"
                        >
                          {goal}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Homework */}
                {note.homework && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-green-700">
                      <BookOpen className="h-4 w-4" />
                      {t('portal.homework')}
                    </h4>
                    <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                      <p className="text-sm text-green-800 whitespace-pre-wrap">
                        {note.homework}
                      </p>
                    </div>
                  </div>
                )}

                {/* Next Session Focus */}
                {note.nextSessionFocus && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-purple-700">
                      <ArrowRight className="h-4 w-4" />
                      {t('portal.nextSessionFocus')}
                    </h4>
                    <div className="bg-purple-50 rounded-lg p-3 border border-purple-100">
                      <p className="text-sm text-purple-800 whitespace-pre-wrap">
                        {note.nextSessionFocus}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Privacy note */}
      {notes && notes.length > 0 && (
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground text-center">
              {t('portal.progressNotesPrivacy')}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

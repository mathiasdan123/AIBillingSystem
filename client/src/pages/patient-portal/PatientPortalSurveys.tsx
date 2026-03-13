import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList,
  CheckCircle,
  Clock,
  ChevronRight,
  ArrowLeft,
  Send,
  Calendar,
} from "lucide-react";

interface SurveyQuestion {
  id: string;
  text: string;
  type: "scale" | "text" | "multiple_choice";
  options?: string[];
  required: boolean;
}

interface SurveyTemplate {
  id: number;
  name: string;
  description: string | null;
  type: string;
  questions: SurveyQuestion[];
}

interface PendingSurvey {
  assignmentId: number;
  template: SurveyTemplate;
  dueDate: string | null;
  createdAt: string;
}

interface CompletedSurvey {
  id: number;
  surveyTemplateId: number;
  totalScore: number | null;
  severity: string | null;
  completedAt: string | null;
  templateName: string;
  templateType: string;
}

interface PatientPortalSurveysProps {
  token: string;
}

function severityColor(severity: string | null): string {
  switch (severity) {
    case "minimal": return "bg-green-100 text-green-800";
    case "mild": return "bg-yellow-100 text-yellow-800";
    case "moderate": return "bg-orange-100 text-orange-800";
    case "moderately_severe": return "bg-red-100 text-red-700";
    case "severe": return "bg-red-200 text-red-900";
    default: return "bg-gray-100 text-gray-800";
  }
}

function severityLabel(severity: string | null): string {
  switch (severity) {
    case "minimal": return "Minimal";
    case "mild": return "Mild";
    case "moderate": return "Moderate";
    case "moderately_severe": return "Moderately Severe";
    case "severe": return "Severe";
    default: return severity || "N/A";
  }
}

export default function PatientPortalSurveys({ token }: PatientPortalSurveysProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<"list" | "form">("list");
  const [selectedSurvey, setSelectedSurvey] = useState<PendingSurvey | null>(null);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});

  const { data: surveyData, isLoading } = useQuery<{
    pending: PendingSurvey[];
    completed: CompletedSurvey[];
  }>({
    queryKey: ["/api/patient-portal/surveys", token],
    queryFn: async () => {
      const res = await fetch("/api/patient-portal/surveys", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch surveys");
      return res.json();
    },
    refetchInterval: 120000,
  });

  const submitSurvey = useMutation({
    mutationFn: async ({ assignmentId, responses }: { assignmentId: number; responses: Array<{ questionId: string; answer: number | string }> }) => {
      const res = await fetch(`/api/patient-portal/surveys/${assignmentId}/respond`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ responses }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/patient-portal/surveys"] });
      setActiveView("list");
      setSelectedSurvey(null);
      setAnswers({});
      toast({
        title: t('portal.surveys.submitted', 'Survey Submitted'),
        description: data.totalScore !== null
          ? t('portal.surveys.submittedWithScore', `Thank you! Your score: ${data.totalScore}`)
          : t('portal.surveys.submittedSuccess', 'Thank you for completing the survey.'),
      });
    },
    onError: () => {
      toast({
        title: t('portal.surveys.error', 'Error'),
        description: t('portal.surveys.submitFailed', 'Failed to submit survey. Please try again.'),
        variant: "destructive",
      });
    },
  });

  const handleStartSurvey = (survey: PendingSurvey) => {
    setSelectedSurvey(survey);
    setAnswers({});
    setActiveView("form");
  };

  const handleSubmit = () => {
    if (!selectedSurvey) return;
    const questions = selectedSurvey.template.questions;
    const requiredMissing = questions
      .filter(q => q.required)
      .some(q => answers[q.id] === undefined || answers[q.id] === "");

    if (requiredMissing) {
      toast({
        title: t('portal.surveys.incomplete', 'Incomplete Survey'),
        description: t('portal.surveys.answerRequired', 'Please answer all required questions.'),
        variant: "destructive",
      });
      return;
    }

    const responses = questions.map(q => ({
      questionId: q.id,
      answer: answers[q.id] ?? (q.type === "text" ? "" : 0),
    }));

    submitSurvey.mutate({
      assignmentId: selectedSurvey.assignmentId,
      responses,
    });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="h-6 bg-muted animate-pulse rounded w-2/3 mb-2" />
              <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const pending = surveyData?.pending || [];
  const completed = surveyData?.completed || [];

  // Survey form view
  if (activeView === "form" && selectedSurvey) {
    const questions = selectedSurvey.template.questions;
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => { setActiveView("list"); setSelectedSurvey(null); }}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('portal.surveys.backToSurveys', 'Back to Surveys')}
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>{selectedSurvey.template.name}</CardTitle>
            {selectedSurvey.template.description && (
              <CardDescription>{selectedSurvey.template.description}</CardDescription>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              {t('portal.surveys.overPastWeeks', 'Over the last 2 weeks, how often have you been bothered by the following problems?')}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {questions.map((question, idx) => (
              <div key={question.id} className="space-y-3 pb-4 border-b last:border-0">
                <Label className="text-base font-medium">
                  {idx + 1}. {question.text}
                  {question.required && <span className="text-red-500 ml-1">*</span>}
                </Label>

                {question.type === "scale" && question.options && (
                  <RadioGroup
                    value={answers[question.id] !== undefined ? String(answers[question.id]) : undefined}
                    onValueChange={(val) => setAnswers({ ...answers, [question.id]: parseInt(val) })}
                    className="space-y-2"
                  >
                    {question.options.map((option, optIdx) => (
                      <div key={optIdx} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50">
                        <RadioGroupItem value={String(optIdx)} id={`${question.id}-${optIdx}`} />
                        <Label htmlFor={`${question.id}-${optIdx}`} className="flex-1 cursor-pointer">
                          <span className="text-sm font-medium text-muted-foreground mr-2">({optIdx})</span>
                          {option}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}

                {question.type === "text" && (
                  <Textarea
                    value={answers[question.id] as string || ""}
                    onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
                    placeholder={t('portal.surveys.typeAnswer', 'Type your answer here...')}
                    rows={3}
                  />
                )}

                {question.type === "multiple_choice" && question.options && (
                  <RadioGroup
                    value={answers[question.id] !== undefined ? String(answers[question.id]) : undefined}
                    onValueChange={(val) => setAnswers({ ...answers, [question.id]: val })}
                    className="space-y-2"
                  >
                    {question.options.map((option, optIdx) => (
                      <div key={optIdx} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50">
                        <RadioGroupItem value={option} id={`${question.id}-mc-${optIdx}`} />
                        <Label htmlFor={`${question.id}-mc-${optIdx}`} className="flex-1 cursor-pointer">
                          {option}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              </div>
            ))}

            <Button
              onClick={handleSubmit}
              disabled={submitSurvey.isPending}
              className="w-full"
              size="lg"
            >
              <Send className="h-4 w-4 mr-2" />
              {submitSurvey.isPending
                ? t('portal.surveys.submitting', 'Submitting...')
                : t('portal.surveys.submitSurvey', 'Submit Survey')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          {t('portal.surveys.title', 'Surveys')}
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          {t('portal.surveys.subtitle', 'Complete assigned assessments and view your history')}
        </p>
      </div>

      {/* Pending Surveys */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-600" />
            {t('portal.surveys.pending', 'Pending Surveys')} ({pending.length})
          </h3>
          {pending.map(survey => (
            <Card key={survey.assignmentId} className="border-blue-200 bg-blue-50/30">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{survey.template?.name || 'Survey'}</p>
                  <p className="text-sm text-muted-foreground">
                    {survey.template?.description}
                  </p>
                  {survey.dueDate && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Due: {formatDate(survey.dueDate)}
                    </p>
                  )}
                </div>
                <Button onClick={() => handleStartSurvey(survey)} size="sm">
                  {t('portal.surveys.start', 'Start')}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Completed Surveys */}
      <div className="space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-green-600" />
          {t('portal.surveys.completed', 'Completed Surveys')} ({completed.length})
        </h3>
        {completed.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>{t('portal.surveys.noCompleted', 'No completed surveys yet.')}</p>
            </CardContent>
          </Card>
        ) : (
          completed.map(response => (
            <Card key={response.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{response.templateName}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('portal.surveys.completedOn', 'Completed')}: {formatDate(response.completedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {response.totalScore !== null && (
                    <span className="text-sm font-semibold">
                      Score: {response.totalScore}
                    </span>
                  )}
                  {response.severity && (
                    <Badge className={severityColor(response.severity)}>
                      {severityLabel(response.severity)}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Empty state when no surveys at all */}
      {pending.length === 0 && completed.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ClipboardList className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">{t('portal.surveys.noSurveys', 'No Surveys')}</h3>
            <p className="text-muted-foreground">
              {t('portal.surveys.noSurveysDesc', 'Your therapist hasn\'t assigned any surveys yet. Check back later.')}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

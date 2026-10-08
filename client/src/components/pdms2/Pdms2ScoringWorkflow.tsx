/**
 * PDMS-2 structured scoring workflow (outcome-measures feature).
 *
 * Item-level entry per subtest with live basal/ceiling automation, credited
 * raw scores, manual normative-table entry fields, auto-computed quotient
 * lookup sums, and an AI-drafted (therapist-edited) narrative.
 *
 * COPYRIGHT BOUNDARY: this workflow contains NO PDMS-2 Examiner's Manual
 * content — no normative tables, no item text, no mastery criteria. The
 * therapist scores each item against the criteria in their own manual and
 * looks up every conversion (standard score, percentile, age equivalent,
 * quotient) in their own normative tables.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, BookOpen, CheckCircle2, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import {
  PDMS2_SUBTESTS,
  PDMS2_SUBTEST_ORDER,
  computeDomainSums,
  quotientBand,
  scoreSubtest,
  standardScoreBand,
  validateSubtestAge,
  type Pdms2ItemScore,
  type Pdms2StandardScores,
  type Pdms2SubtestKey,
} from "@shared/pdms2";

interface SubtestFormState {
  itemScores: Record<number, Pdms2ItemScore>;
  standardScore: string;
  percentileRank: string;
  ageEquivalentMonths: string;
}

export interface Pdms2AssessmentRecord {
  id: number;
  patientId: number;
  ageInMonths: number;
  subtests: Partial<Record<Pdms2SubtestKey, {
    itemScores?: Record<string, Pdms2ItemScore>;
    standardScore?: number | null;
    percentileRank?: string | null;
    ageEquivalentMonths?: number | null;
  }>>;
  grossMotorQuotient?: number | null;
  fineMotorQuotient?: number | null;
  totalMotorQuotient?: number | null;
  tasksWentWell?: string | null;
  tasksChallenging?: string | null;
  narrative?: string | null;
  status?: string | null;
  assessmentDate?: string | null;
}

interface Props {
  patientId: number;
  patientName?: string;
  existing?: Pdms2AssessmentRecord | null;
  onClose: () => void;
}

const emptySubtest = (): SubtestFormState => ({
  itemScores: {},
  standardScore: "",
  percentileRank: "",
  ageEquivalentMonths: "",
});

function initialSubtests(existing?: Pdms2AssessmentRecord | null) {
  const state = {} as Record<Pdms2SubtestKey, SubtestFormState>;
  for (const key of PDMS2_SUBTEST_ORDER) {
    const entry = existing?.subtests?.[key];
    state[key] = entry
      ? {
          itemScores: Object.fromEntries(
            Object.entries(entry.itemScores ?? {}).map(([k, v]) => [Number(k), v]),
          ) as Record<number, Pdms2ItemScore>,
          standardScore: entry.standardScore != null ? String(entry.standardScore) : "",
          percentileRank: entry.percentileRank ?? "",
          ageEquivalentMonths: entry.ageEquivalentMonths != null ? String(entry.ageEquivalentMonths) : "",
        }
      : emptySubtest();
  }
  return state;
}

const intOrNull = (s: string): number | null => {
  const n = parseInt(s, 10);
  return Number.isInteger(n) ? n : null;
};

export default function Pdms2ScoringWorkflow({ patientId, patientName, existing, onClose }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [assessmentId, setAssessmentId] = useState<number | null>(existing?.id ?? null);
  const [ageInMonths, setAgeInMonths] = useState<string>(
    existing ? String(existing.ageInMonths) : "",
  );
  const [subtests, setSubtests] = useState<Record<Pdms2SubtestKey, SubtestFormState>>(() =>
    initialSubtests(existing),
  );
  const [gmq, setGmq] = useState(existing?.grossMotorQuotient != null ? String(existing.grossMotorQuotient) : "");
  const [fmq, setFmq] = useState(existing?.fineMotorQuotient != null ? String(existing.fineMotorQuotient) : "");
  const [tmq, setTmq] = useState(existing?.totalMotorQuotient != null ? String(existing.totalMotorQuotient) : "");
  const [tasksWentWell, setTasksWentWell] = useState(existing?.tasksWentWell ?? "");
  const [tasksChallenging, setTasksChallenging] = useState(existing?.tasksChallenging ?? "");
  const [narrative, setNarrative] = useState(existing?.narrative ?? "");
  const itemRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const age = intOrNull(ageInMonths);

  // Live scoring preview — the server recomputes authoritatively on save.
  const liveScoring = useMemo(() => {
    const out = {} as Record<Pdms2SubtestKey, ReturnType<typeof scoreSubtest>>;
    for (const key of PDMS2_SUBTEST_ORDER) {
      try {
        out[key] = scoreSubtest(subtests[key].itemScores, PDMS2_SUBTESTS[key].itemCount);
      } catch {
        out[key] = scoreSubtest({}, PDMS2_SUBTESTS[key].itemCount);
      }
    }
    return out;
  }, [subtests]);

  const standardScores = useMemo(() => {
    const out: Pdms2StandardScores = {};
    for (const key of PDMS2_SUBTEST_ORDER) {
      const ss = intOrNull(subtests[key].standardScore);
      if (ss !== null && ss >= 1 && ss <= 20) out[key] = ss;
    }
    return out;
  }, [subtests]);

  const domainSums = useMemo(() => {
    if (age === null || age < 0) return null;
    try {
      return computeDomainSums(standardScores, age);
    } catch {
      return null;
    }
  }, [standardScores, age]);

  const setItemScore = (key: Pdms2SubtestKey, item: number, score: Pdms2ItemScore | null) => {
    setSubtests((prev) => {
      const itemScores = { ...prev[key].itemScores };
      if (score === null) delete itemScores[item];
      else itemScores[item] = score;
      return { ...prev, [key]: { ...prev[key], itemScores } };
    });
  };

  const setManualField = (
    key: Pdms2SubtestKey,
    field: "standardScore" | "percentileRank" | "ageEquivalentMonths",
    value: string,
  ) => {
    setSubtests((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const handleItemKeyDown = (key: Pdms2SubtestKey, item: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "0" || e.key === "1" || e.key === "2") {
      e.preventDefault();
      setItemScore(key, item, Number(e.key) as Pdms2ItemScore);
      const next = itemRefs.current[`${key}-${item + 1}`];
      if (next) next.focus();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      setItemScore(key, item, null);
    } else if (e.key === "ArrowRight") {
      itemRefs.current[`${key}-${item + 1}`]?.focus();
    } else if (e.key === "ArrowLeft") {
      itemRefs.current[`${key}-${item - 1}`]?.focus();
    }
  };

  const buildPayload = () => ({
    patientId,
    ageInMonths: age ?? 0,
    subtests: Object.fromEntries(
      PDMS2_SUBTEST_ORDER.map((key) => {
        const s = subtests[key];
        return [
          key,
          {
            itemScores: Object.fromEntries(
              Object.entries(s.itemScores).map(([k, v]) => [String(k), v]),
            ),
            standardScore: intOrNull(s.standardScore),
            percentileRank: s.percentileRank.trim() || null,
            ageEquivalentMonths: intOrNull(s.ageEquivalentMonths),
          },
        ];
      }),
    ),
    grossMotorQuotient: intOrNull(gmq),
    fineMotorQuotient: intOrNull(fmq),
    totalMotorQuotient: intOrNull(tmq),
    tasksWentWell: tasksWentWell.trim() || null,
    tasksChallenging: tasksChallenging.trim() || null,
    narrative: narrative.trim() || null,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      const res = assessmentId
        ? await apiRequest("PATCH", `/api/pdms2-assessments/${assessmentId}`, payload)
        : await apiRequest("POST", "/api/pdms2-assessments", payload);
      return res.json();
    },
    onSuccess: (saved: Pdms2AssessmentRecord) => {
      if (saved?.id) setAssessmentId(saved.id);
      toast({ title: "PDMS-2 Assessment Saved", description: "Scores and basal/ceiling state recorded." });
      queryClient.invalidateQueries({ queryKey: ["/api/pdms2-assessments", patientId] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save the assessment.", variant: "destructive" });
    },
  });

  const narrativeMutation = useMutation({
    mutationFn: async () => {
      // Narrative generation needs the saved assessment — save first if new.
      let id = assessmentId;
      if (!id) {
        const res = await apiRequest("POST", "/api/pdms2-assessments", buildPayload());
        const saved = await res.json();
        id = saved.id;
        setAssessmentId(saved.id);
      }
      const res = await apiRequest("POST", `/api/pdms2-assessments/${id}/narrative`, {});
      return res.json();
    },
    onSuccess: (result: { narrative?: string }) => {
      if (result?.narrative) {
        setNarrative(result.narrative);
        toast({
          title: "Narrative Drafted",
          description: "Review and edit the draft — the therapist's clinical judgment decides what stands.",
        });
      } else {
        toast({ title: "Error", description: "Narrative generation returned no draft.", variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Could not draft the narrative.", variant: "destructive" });
    },
  });

  const canSave = age !== null && age >= 0 && age <= 120;

  return (
    <div className="space-y-6" data-testid="pdms2-workflow">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-pdms2-back">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <h2 className="text-2xl font-bold">PDMS-2 Structured Scoring</h2>
          </div>
          <p className="text-muted-foreground mt-1">
            {patientName ? `${patientName} — ` : ""}item-level scoring with basal/ceiling automation
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!canSave || saveMutation.isPending}
          data-testid="button-pdms2-save"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {assessmentId ? "Save Changes" : "Save Assessment"}
        </Button>
      </div>

      <Alert data-testid="pdms2-manual-notice">
        <BookOpen className="h-4 w-4" />
        <AlertDescription>
          Score each item (2 = meets the mastery criterion, 1 = emerging, 0 = cannot/will not) against the
          criteria in your own PDMS-2 Examiner's Manual. All score conversions — standard scores, percentile
          ranks, age equivalents, and quotients — come from the normative tables in your manual; this system
          does not contain or reproduce them. It automates the arithmetic: basal/ceiling detection, credited
          raw scores, and the sums you look up.
        </AlertDescription>
      </Alert>

      {/* Age */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label htmlFor="pdms2-age">Chronological age at testing (months)</Label>
              <Input
                id="pdms2-age"
                data-testid="input-pdms2-age"
                className="w-40 mt-1"
                inputMode="numeric"
                value={ageInMonths}
                onChange={(e) => setAgeInMonths(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="e.g. 30"
              />
            </div>
            <p className="text-sm text-muted-foreground pb-2">
              Drives the Gross Motor composition (Reflexes under 12 months, Object Manipulation at 12+)
              and age-applicability checks. Choose each subtest's age-appropriate entry point from your manual.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Subtest item entry */}
      <Tabs defaultValue="stationary">
        <TabsList className="flex-wrap h-auto">
          {PDMS2_SUBTEST_ORDER.map((key) => {
            const def = PDMS2_SUBTESTS[key];
            const scoring = liveScoring[key];
            return (
              <TabsTrigger key={key} value={key} data-testid={`tab-pdms2-${key}`}>
                {def.name}
                {scoring.administeredCount > 0 && (
                  <Badge variant="secondary" className="ml-2">{scoring.rawScore}</Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {PDMS2_SUBTEST_ORDER.map((key) => {
          const def = PDMS2_SUBTESTS[key];
          const s = subtests[key];
          const scoring = liveScoring[key];
          const ageWarning =
            age !== null && Object.keys(s.itemScores).length > 0 ? validateSubtestAge(key, age) : null;
          const ss = intOrNull(s.standardScore);
          const band = ss !== null && ss >= 1 && ss <= 20 ? standardScoreBand(ss) : null;

          return (
            <TabsContent key={key} value={key} className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <CardTitle className="text-lg">{def.name}</CardTitle>
                      <CardDescription>
                        {def.measures} · {def.itemCount} items
                        {def.ageNote ? ` · ${def.ageNote}` : ""}
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Raw score (credited)</div>
                      <div className="text-2xl font-bold" data-testid={`pdms2-raw-${key}`}>
                        {scoring.rawScore}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {ageWarning && (
                    <Alert variant="destructive" data-testid={`pdms2-age-warning-${key}`}>
                      <TriangleAlert className="h-4 w-4" />
                      <AlertDescription>{ageWarning}</AlertDescription>
                    </Alert>
                  )}

                  {/* Live basal/ceiling indicators */}
                  <div className="flex flex-wrap gap-2 text-sm">
                    {scoring.basalEstablished ? (
                      <Badge className="bg-green-100 text-green-800" data-testid={`pdms2-basal-${key}`}>
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Basal established at item {scoring.basalStartItem}
                        {scoring.basalCreditedItems > 0 &&
                          ` — items 1–${scoring.basalCreditedItems} auto-credited as 2 (+${scoring.basalCreditPoints} pts)`}
                      </Badge>
                    ) : (
                      scoring.administeredCount > 0 && (
                        <Badge variant="outline" data-testid={`pdms2-basal-${key}`}>
                          No basal yet — need 3 consecutive scores of 2
                        </Badge>
                      )
                    )}
                    {scoring.ceilingReached ? (
                      <Badge className="bg-blue-100 text-blue-800" data-testid={`pdms2-ceiling-${key}`}>
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Ceiling reached at item {scoring.ceilingItem} — subtest complete
                      </Badge>
                    ) : (
                      scoring.administeredCount > 0 &&
                      !scoring.complete && (
                        <Badge variant="outline" data-testid={`pdms2-ceiling-${key}`}>
                          No ceiling yet — continue until 3 consecutive scores of 0
                        </Badge>
                      )
                    )}
                  </div>

                  {scoring.warnings.length > 0 && (
                    <ul className="text-sm text-amber-700 dark:text-amber-400 list-disc pl-5 space-y-1">
                      {scoring.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}

                  {/* Item grid — keyboard-fast 0/1/2 entry */}
                  <div>
                    <Label className="text-sm text-muted-foreground">
                      Item scores — type 0, 1, or 2 (focus advances automatically); start at the
                      age-appropriate entry point from your manual
                    </Label>
                    <div className="mt-2 grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                      {Array.from({ length: def.itemCount }, (_, i) => i + 1).map((item) => {
                        const value = s.itemScores[item];
                        const credited =
                          scoring.basalEstablished && item < (scoring.basalStartItem ?? 0) && value === undefined;
                        const uncounted = scoring.ceilingItem !== null && item > scoring.ceilingItem;
                        return (
                          <div key={item} className="flex flex-col items-center">
                            <span className="text-[10px] text-muted-foreground">{item}</span>
                            <input
                              ref={(el) => {
                                itemRefs.current[`${key}-${item}`] = el;
                              }}
                              data-testid={`pdms2-item-${key}-${item}`}
                              className={`w-8 h-8 text-center text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary bg-background ${
                                credited
                                  ? "border-green-300 text-green-700 bg-green-50 dark:bg-green-950"
                                  : uncounted && value !== undefined
                                    ? "border-dashed opacity-50"
                                    : value !== undefined
                                      ? "border-primary font-semibold"
                                      : "border-input"
                              }`}
                              value={credited ? "2" : value ?? ""}
                              placeholder={credited ? "2" : ""}
                              onKeyDown={(e) => handleItemKeyDown(key, item, e)}
                              onChange={() => {}}
                              inputMode="numeric"
                              aria-label={`${def.name} item ${item} score`}
                              title={
                                credited
                                  ? "Auto-credited as 2 (below basal)"
                                  : uncounted
                                    ? "Above ceiling — not counted"
                                    : undefined
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Manual normative-table entries */}
                  <div className="border-t pt-4">
                    <Label className="font-medium">
                      From your PDMS-2 Examiner's Manual (look up by raw score {scoring.rawScore} and
                      chronological age)
                    </Label>
                    <div className="grid gap-4 sm:grid-cols-3 mt-2">
                      <div>
                        <Label htmlFor={`ss-${key}`} className="text-sm text-muted-foreground">
                          Standard score (1–20)
                        </Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            id={`ss-${key}`}
                            data-testid={`input-pdms2-ss-${key}`}
                            className="w-20"
                            inputMode="numeric"
                            value={s.standardScore}
                            onChange={(e) =>
                              setManualField(key, "standardScore", e.target.value.replace(/[^0-9]/g, ""))
                            }
                          />
                          {band && (
                            <Badge variant="secondary" data-testid={`pdms2-band-${key}`}>
                              {band}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <Label htmlFor={`pr-${key}`} className="text-sm text-muted-foreground">
                          Percentile rank
                        </Label>
                        <Input
                          id={`pr-${key}`}
                          data-testid={`input-pdms2-percentile-${key}`}
                          className="w-24 mt-1"
                          value={s.percentileRank}
                          onChange={(e) => setManualField(key, "percentileRank", e.target.value)}
                          placeholder="e.g. 16"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`ae-${key}`} className="text-sm text-muted-foreground">
                          Age equivalent (months)
                        </Label>
                        <Input
                          id={`ae-${key}`}
                          data-testid={`input-pdms2-ae-${key}`}
                          className="w-24 mt-1"
                          inputMode="numeric"
                          value={s.ageEquivalentMonths}
                          onChange={(e) =>
                            setManualField(key, "ageEquivalentMonths", e.target.value.replace(/[^0-9]/g, ""))
                          }
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Quotients */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Motor Quotients</CardTitle>
          <CardDescription>
            Sums of standard scores are computed below — look each sum up in your manual's quotient
            normative tables and enter the quotient.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-3">
          {(
            [
              {
                label: "Gross Motor Quotient (GMQ)",
                sumKey: "grossMotor" as const,
                value: gmq,
                set: setGmq,
                testid: "gmq",
              },
              {
                label: "Fine Motor Quotient (FMQ)",
                sumKey: "fineMotor" as const,
                value: fmq,
                set: setFmq,
                testid: "fmq",
              },
              {
                label: "Total Motor Quotient (TMQ)",
                sumKey: "totalMotor" as const,
                value: tmq,
                set: setTmq,
                testid: "tmq",
              },
            ]
          ).map(({ label, sumKey, value, set, testid }) => {
            const sum = domainSums?.[sumKey];
            const q = intOrNull(value);
            const qBand = q !== null && q >= 1 && q <= 200 ? quotientBand(q) : null;
            return (
              <div key={sumKey} className="space-y-2">
                <Label className="font-medium">{label}</Label>
                <div className="text-sm text-muted-foreground" data-testid={`pdms2-sum-${testid}`}>
                  {sum?.sum != null ? (
                    <>
                      Sum of standard scores to look up: <span className="font-semibold text-foreground">{sum.sum}</span>
                      <span className="block text-xs mt-0.5">
                        ({sum.components.map((c) => PDMS2_SUBTESTS[c].name).join(" + ")})
                      </span>
                    </>
                  ) : sum ? (
                    <>
                      Awaiting standard scores for: {sum.missing.map((c) => PDMS2_SUBTESTS[c].name).join(", ")}
                    </>
                  ) : (
                    "Enter the child's age to compute sums"
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    data-testid={`input-pdms2-${testid}`}
                    className="w-24"
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => set(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="From manual"
                  />
                  {qBand && (
                    <Badge variant="secondary" data-testid={`pdms2-band-${testid}`}>
                      {qBand}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Therapist notes + narrative */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Observations & Narrative</CardTitle>
          <CardDescription>
            AI drafts the narrative from the entered scores and your notes only — it never invents clinical
            detail. You review, edit, and decide what stands.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="pdms2-went-well">Tasks that went well</Label>
              <Textarea
                id="pdms2-went-well"
                data-testid="input-pdms2-went-well"
                className="mt-1"
                rows={3}
                value={tasksWentWell}
                onChange={(e) => setTasksWentWell(e.target.value)}
                placeholder="e.g. transitions in/out of sitting, ball catch at close range..."
              />
            </div>
            <div>
              <Label htmlFor="pdms2-challenging">Tasks that were challenging</Label>
              <Textarea
                id="pdms2-challenging"
                data-testid="input-pdms2-challenging"
                className="mt-1"
                rows={3}
                value={tasksChallenging}
                onChange={(e) => setTasksChallenging(e.target.value)}
                placeholder="e.g. single-leg balance, pencil grasp during copying tasks..."
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="pdms2-narrative">Narrative summary (editable draft)</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => narrativeMutation.mutate()}
                disabled={!canSave || narrativeMutation.isPending}
                data-testid="button-pdms2-generate-narrative"
              >
                {narrativeMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                Draft with AI
              </Button>
            </div>
            <Textarea
              id="pdms2-narrative"
              data-testid="input-pdms2-narrative"
              className="mt-2"
              rows={6}
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder="Generate a draft from the entered scores and notes, or write the summary yourself."
            />
            <p className="text-xs text-muted-foreground mt-1">
              AI assists; the treating therapist reviews, edits, and approves all clinical documentation.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

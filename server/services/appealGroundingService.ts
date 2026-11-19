/**
 * Appeal letter grounding, readiness and deadline basis.
 *
 * QA sweep 2026-11-18 (demo, Ava Sample DEMO-2-1006 / Ethan Example
 * DEMO-2-1005): Create Appeal produced a letter labeled "Ready" that asserted
 * urgent/emergent services, a retroactive authorization request "being
 * submitted", medical necessity, AOTA-conformant treatment, a comprehensive
 * evaluation, a measurable treatment plan and progress notes demonstrating
 * skilled intervention -- for a patient with no authorizations, no documents
 * and no clinical notes on file. The letter also carried placeholder practice
 * address / "Provider Name" lines while labeled Ready.
 *
 * Same rule as the SOAP generator: every assertion in a payer-facing letter
 * must be backed by (a) a record that exists, (b) a fact the biller entered
 * in the appeal flow, or (c) it is omitted. This module:
 *
 *   - buildAppealGrounding: looks up what actually exists for the patient /
 *     claim (treatment authorizations, clinical notes, evaluation, treatment
 *     plan, documents) and merges the biller's explicit inputs.
 *   - stripUnsupportedAppealAssertions: deterministic backstop applied to
 *     every generated letter (template or model) -- removes sentences that
 *     assert a record or event the grounding does not support.
 *   - assessAppealReadiness: "ready" requires real letterhead (no
 *     placeholders), identifiers, some clinical documentation on file, a
 *     recorded denial date, and no unsupported assertion left in the text.
 *   - computeAppealDeadline: denial date + a policy window with a recorded
 *     source (payer plan document, practice default, or a labeled estimate),
 *     never "creation + 60 days" with nothing behind it.
 */
import { addDaysToDateOnly, parseDateOnly, toDateOnlyString } from '../utils/dateOnly';
import logger from './logger';

/** What the biller tells us in the Create Appeal flow. Nothing here is derivable from records. */
export interface AppealGroundingInputs {
  /** The service was urgent/emergent (explains a missing prior authorization). */
  urgentService?: boolean;
  /** A retroactive authorization request has been (or is being) filed with the payer. */
  retroAuthRequested?: boolean;
  /** Payer reference / confirmation number for that retro-auth request, if any. */
  retroAuthReference?: string | null;
  /** Free-text grounds the biller wants included, verbatim. */
  additionalGrounds?: string | null;
  /** Date the payer denied the claim (YYYY-MM-DD), from the EOB/835. */
  denialDate?: string | null;
}

/** Facts the letter may rely on. Every boolean is "a record exists", not "the record says X". */
export interface AppealGrounding {
  inputs: AppealGroundingInputs;
  /** An approved/active treatment authorization is on file for this patient (or the claim carries an auth number). */
  hasPriorAuthorization: boolean;
  authorizationNumbers: string[];
  hasEvaluation: boolean;
  hasTreatmentPlan: boolean;
  hasProgressNotes: boolean;
  progressNoteCount: number;
  hasSoapNotes: boolean;
  soapNoteCount: number;
  /** Any of: evaluation, treatment plan, progress notes, SOAP notes. */
  hasClinicalDocumentation: boolean;
  hasSupportingDocs: boolean;
  supportingDocNames: string[];
}

export function emptyAppealGrounding(inputs: AppealGroundingInputs = {}): AppealGrounding {
  return {
    inputs,
    hasPriorAuthorization: false,
    authorizationNumbers: [],
    hasEvaluation: false,
    hasTreatmentPlan: false,
    hasProgressNotes: false,
    progressNoteCount: 0,
    hasSoapNotes: false,
    soapNoteCount: 0,
    hasClinicalDocumentation: false,
    hasSupportingDocs: false,
    supportingDocNames: [],
  };
}

/** Normalize the biller's inputs from a request body: only the known keys, typed. */
export function normalizeGroundingInputs(body: any): AppealGroundingInputs {
  const b = body ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
  const denialDate = str(b.denialDate);
  return {
    urgentService: b.urgentService === true,
    retroAuthRequested: b.retroAuthRequested === true,
    retroAuthReference: str(b.retroAuthReference),
    additionalGrounds: str(b.additionalGrounds),
    denialDate: denialDate && parseDateOnly(denialDate) ? denialDate.slice(0, 10) : null,
  };
}

/**
 * Lookups the grounding needs. Injected so route tests can stub them and so a
 * missing storage method (older storage mocks) degrades to "nothing on file"
 * instead of a crash. Each lookup is independently try/caught: a failed
 * lookup must never produce a letter that claims the record exists.
 */
export interface AppealGroundingLookups {
  getAuthorizations?: (practiceId: number, patientId: number) => Promise<any[]>;
  getPatientInitialEvaluations?: (patientId: number, practiceId: number) => Promise<any[]>;
  getActiveTreatmentPlan?: (patientId: number) => Promise<any | undefined>;
  getProgressNotesForPatient?: (patientId: number, practiceId: number) => Promise<any[]>;
  getRecentSoapNotesForPatient?: (patientId: number, practiceId: number, limit?: number) => Promise<any[]>;
  getPatientDocuments?: (patientId: number) => Promise<any[]>;
}

/** Default lookups backed by storage + the authorization service. */
export function defaultAppealGroundingLookups(storage: any): AppealGroundingLookups {
  const fn = (name: string) => (typeof storage?.[name] === 'function' ? storage[name].bind(storage) : undefined);
  return {
    getAuthorizations: async (practiceId, patientId) => {
      const { getAuthorizations } = await import('./authorizationService');
      return getAuthorizations(practiceId, { patientId });
    },
    getPatientInitialEvaluations: fn('getPatientInitialEvaluations'),
    getActiveTreatmentPlan: fn('getActiveTreatmentPlan'),
    getProgressNotesForPatient: fn('getProgressNotesForPatient'),
    getRecentSoapNotesForPatient: fn('getRecentSoapNotesForPatient'),
    getPatientDocuments: fn('getPatientDocuments'),
  };
}

async function safely<T>(label: string, run: (() => Promise<T>) | undefined, fallback: T): Promise<T> {
  if (!run) return fallback;
  try {
    return await run();
  } catch (error) {
    logger.warn('Appeal grounding lookup failed; treating as not on file', {
      lookup: label,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export async function buildAppealGrounding(
  params: {
    practiceId: number;
    patientId: number | null | undefined;
    claim: { authorizationNumber?: string | null } | null | undefined;
    inputs?: AppealGroundingInputs;
  },
  lookups: AppealGroundingLookups,
): Promise<AppealGrounding> {
  const g = emptyAppealGrounding(params.inputs ?? {});
  const { practiceId, patientId, claim } = params;
  if (claim?.authorizationNumber && String(claim.authorizationNumber).trim()) {
    g.authorizationNumbers.push(String(claim.authorizationNumber).trim());
  }
  if (!patientId) {
    g.hasPriorAuthorization = g.authorizationNumbers.length > 0;
    return g;
  }

  const [auths, evaluations, plan, progressNotes, soapNotes, documents] = await Promise.all([
    safely('authorizations', lookups.getAuthorizations && (() => lookups.getAuthorizations!(practiceId, patientId)), [] as any[]),
    safely('evaluations', lookups.getPatientInitialEvaluations && (() => lookups.getPatientInitialEvaluations!(patientId, practiceId)), [] as any[]),
    safely('treatmentPlan', lookups.getActiveTreatmentPlan && (() => lookups.getActiveTreatmentPlan!(patientId)), undefined as any),
    safely('progressNotes', lookups.getProgressNotesForPatient && (() => lookups.getProgressNotesForPatient!(patientId, practiceId)), [] as any[]),
    safely('soapNotes', lookups.getRecentSoapNotesForPatient && (() => lookups.getRecentSoapNotesForPatient!(patientId, practiceId, 50)), [] as any[]),
    safely('documents', lookups.getPatientDocuments && (() => lookups.getPatientDocuments!(patientId)), [] as any[]),
  ]);

  for (const a of Array.isArray(auths) ? auths : []) {
    const status = String(a?.status ?? '').toLowerCase();
    // Pending/denied requests are not an authorization the letter can cite.
    if (['active', 'approved', 'exhausted', 'expired'].includes(status) && a?.authorizationNumber) {
      g.authorizationNumbers.push(String(a.authorizationNumber));
    }
  }
  g.authorizationNumbers = Array.from(new Set(g.authorizationNumbers));
  g.hasPriorAuthorization = g.authorizationNumbers.length > 0;
  g.hasEvaluation = Array.isArray(evaluations) && evaluations.length > 0;
  g.hasTreatmentPlan = !!plan;
  g.progressNoteCount = Array.isArray(progressNotes) ? progressNotes.length : 0;
  g.hasProgressNotes = g.progressNoteCount > 0;
  g.soapNoteCount = Array.isArray(soapNotes) ? soapNotes.length : 0;
  g.hasSoapNotes = g.soapNoteCount > 0;
  g.hasClinicalDocumentation = g.hasEvaluation || g.hasTreatmentPlan || g.hasProgressNotes || g.hasSoapNotes;
  g.supportingDocNames = (Array.isArray(documents) ? documents : [])
    .map((d: any) => d?.fileName ?? d?.name)
    .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
  g.hasSupportingDocs = g.supportingDocNames.length > 0;
  return g;
}

// ---------------------------------------------------------------------------
// Unsupported-assertion backstop
// ---------------------------------------------------------------------------

interface AssertionRule {
  key: string;
  pattern: RegExp;
  supported: (g: AppealGrounding) => boolean;
}

/**
 * Sentences matching `pattern` are removed unless `supported(grounding)`.
 * Keyed to the phrases QA found in the repro letter, plus the generic shapes
 * the template and the model produce for the same claims. "AOTA-conformant"
 * has no record anywhere in the system, so it is never supported.
 */
export const APPEAL_ASSERTION_RULES: AssertionRule[] = [
  {
    key: 'urgent_service',
    pattern: /\b(?:urgent|emergent|emergency)\b/i,
    supported: (g) => g.inputs.urgentService === true,
  },
  {
    key: 'retro_authorization',
    pattern: /\bretro(?:active|-active)?\s+(?:authori[sz]ation|auth)\b/i,
    supported: (g) => g.inputs.retroAuthRequested === true,
  },
  {
    key: 'prior_authorization_obtained',
    pattern: /\bauthori[sz]ation\s+(?:was|had been|has been)\s+(?:obtained|secured|approved|on file)\b/i,
    supported: (g) => g.hasPriorAuthorization,
  },
  {
    key: 'aota_conformance',
    pattern: /\bAOTA\b|American Occupational Therapy Association/i,
    supported: () => false,
  },
  {
    key: 'comprehensive_evaluation',
    pattern: /\b(?:comprehensive|initial|formal)\s+evaluation\b|\bevaluation\s+(?:notes?|findings|results)\b/i,
    supported: (g) => g.hasEvaluation,
  },
  {
    key: 'treatment_plan',
    pattern: /\btreatment\s+plan\b|\bplan\s+of\s+care\b|\bmeasurable\s+goals?\b/i,
    supported: (g) => g.hasTreatmentPlan,
  },
  {
    key: 'progress_notes',
    pattern: /\bprogress\s+notes?\b|\bmeasurable\s+progress\b|\bdemonstrated\s+(?:measurable\s+)?progress\b/i,
    supported: (g) => g.hasProgressNotes,
  },
  {
    key: 'clinical_documentation',
    pattern: /\bclinical\s+(?:documentation|records?|notes?)\b|\btreatment\s+(?:records?|notes?)\b|\bdocumentation\s+(?:supports|demonstrates|establishes)\b/i,
    supported: (g) => g.hasClinicalDocumentation,
  },
  {
    key: 'medical_necessity',
    pattern: /\bmedical(?:ly)?\s+necess(?:ary|ity)\b/i,
    supported: (g) => g.hasClinicalDocumentation,
  },
  {
    key: 'skilled_intervention',
    pattern: /\bskilled\s+(?:therapeutic\s+)?intervention\b/i,
    supported: (g) => g.hasClinicalDocumentation,
  },
];

// A sentence ends at . ! ? or a line break; numbered/bulleted list lines are
// whole sentences by themselves. The RE/letterhead block lines have no
// terminal punctuation and are matched as lines.
//
// Implemented as a single left-to-right scan rather than the regex
// /[^.!?\n]+(?:[.!?]+|(?=\n)|$)/g it replaces: CodeQL flagged that pattern as
// polynomial (js/polynomial-redos) on biller-edited letter text. Boundaries
// are identical: a sentence is a run of non-terminator characters followed by
// its terminal punctuation run, or ending just before a line break / at the
// end of the text. Bare terminators (a line break, or punctuation with no text
// before it) are not sentences and are left in place by replaceSentences.
const SENTENCE_TERMINATORS = new Set(['.', '!', '?']);

/** [start, end) spans of each sentence in `text`, in order. Linear in text length. */
function sentenceSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '\n' || SENTENCE_TERMINATORS.has(ch)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n && text[j] !== '\n' && !SENTENCE_TERMINATORS.has(text[j])) j++;
    while (j < n && SENTENCE_TERMINATORS.has(text[j])) j++;
    spans.push([i, j]);
    i = j;
  }
  return spans;
}

/** The sentences of `text`, in order (what the regex match() used to return). */
export function splitSentences(text: string): string[] {
  return sentenceSpans(text).map(([s, e]) => text.slice(s, e));
}

/** Rebuild `text` with each sentence passed through `fn`; non-sentence characters are kept as-is. */
function replaceSentences(text: string, fn: (sentence: string) => string): string {
  let out = '';
  let cursor = 0;
  for (const [s, e] of sentenceSpans(text)) {
    out += text.slice(cursor, s) + fn(text.slice(s, e));
    cursor = e;
  }
  return out + text.slice(cursor);
}

function unsupportedRulesIn(sentence: string, g: AppealGrounding): AssertionRule[] {
  return APPEAL_ASSERTION_RULES.filter((r) => r.pattern.test(sentence) && !r.supported(g));
}

/** Detection only: does `text` still assert something the grounding does not support? */
export function hasUnsupportedAppealAssertion(text: string | null | undefined, g: AppealGrounding): boolean {
  if (!text) return false;
  for (const sentence of splitSentences(text)) {
    if (unsupportedRulesIn(sentence, g).length > 0) return true;
  }
  return false;
}

/** Names of the rules that fire on `text`, for readiness messages. */
export function unsupportedAppealAssertionKeys(text: string | null | undefined, g: AppealGrounding): string[] {
  if (!text) return [];
  const keys = new Set<string>();
  for (const sentence of splitSentences(text)) {
    for (const r of unsupportedRulesIn(sentence, g)) keys.add(r.key);
  }
  return Array.from(keys);
}

function tidyLetter(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')        // trailing spaces left by removed sentences
    .replace(/\n{3,}/g, '\n\n')         // collapse blank runs
    .replace(/^(\s*\d+)\.\s*$/gm, '')   // a numbered item whose text was removed
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Remove every sentence that asserts something the grounding does not
 * support, then renumber any "GROUNDS FOR APPEAL" list that lost items so the
 * letter does not read "1. ... 3. ...".
 */
export function stripUnsupportedAppealAssertions(text: string | null | undefined, g: AppealGrounding): string {
  if (!text || !hasUnsupportedAppealAssertion(text, g)) return text ?? '';
  const stripped = replaceSentences(text, (sentence) => (unsupportedRulesIn(sentence, g).length > 0 ? '' : sentence));
  // Renumber consecutive "N. " lines so removed arguments leave no gaps.
  let counter = 0;
  let lastWasItem = false;
  const renumbered = tidyLetter(stripped)
    .split('\n')
    .map((line) => {
      const m = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
      if (m) {
        counter = lastWasItem ? counter + 1 : 1;
        lastWasItem = true;
        return `${m[1]}${counter}. ${m[3]}`;
      }
      if (line.trim().length > 0) lastWasItem = false;
      return line;
    })
    .join('\n');
  logger.warn('Stripped appeal letter assertion(s) the record does not support', {
    originalLength: text.length,
    strippedLength: renumbered.length,
  });
  return renumbered;
}

/** Same rule for the structured key arguments stored next to the letter. */
export function filterUnsupportedKeyArguments(args: unknown, g: AppealGrounding): string[] {
  if (!Array.isArray(args)) return [];
  return args.filter((a): a is string => typeof a === 'string' && a.trim().length > 0 && unsupportedRulesIn(a, g).length === 0);
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/** Bracketed or literal placeholders the generators emit when a field is missing. */
const PLACEHOLDER_PATTERNS: Array<[RegExp, string]> = [
  [/\[Practice Address\]/i, 'Practice address is missing from the letterhead'],
  [/\[Practice Phone\]|\[Phone\]/i, 'Practice phone is missing from the letterhead'],
  [/\[NPI Number\]|\[NPI\]/i, 'Practice NPI is missing from the letterhead'],
  [/\[Insurance Company\]/i, 'Payer name is missing'],
  [/\[Insurance Address\]|\[Payer (?:mailing )?address[^\]]*\]/i, 'Payer mailing address must be filled in'],
  [/^\s*Provider Name\s*$/im, 'Signer name is a placeholder ("Provider Name")'],
  [/\[Provider Name\]|\[Signer\]/i, 'Signer name is a placeholder'],
  [/\[(?:[A-Z][A-Za-z ]+)\]/, 'The letter still contains a bracketed placeholder'],
];

export interface ReadinessContext {
  letter: string | null | undefined;
  practice: { name?: string | null; npi?: string | null; address?: string | null; phone?: string | null } | null | undefined;
  patient: { firstName?: string | null; lastName?: string | null } | null | undefined;
  claim: { claimNumber?: string | null } | null | undefined;
  grounding: AppealGrounding;
  denialDate?: string | null;
}

/**
 * A letter is "ready" only when nothing on this list applies. The issues are
 * shown in the drawer so the biller knows exactly what to fix.
 */
export function assessAppealReadiness(ctx: ReadinessContext): { ready: boolean; issues: string[] } {
  const issues: string[] = [];
  const letter = ctx.letter ?? '';
  if (!letter.trim()) issues.push('No appeal letter yet');
  if (!ctx.practice?.address?.trim()) issues.push('Practice address not on file (Settings → Practice)');
  if (!ctx.practice?.npi?.trim()) issues.push('Practice NPI not on file (Settings → Practice)');
  if (!ctx.patient?.firstName || !ctx.patient?.lastName || ctx.patient.firstName === 'Unknown') {
    issues.push('Patient name not on the claim');
  }
  if (!ctx.claim?.claimNumber) issues.push('Claim number missing');
  if (!ctx.denialDate) issues.push('Denial date not recorded (needed for the filing deadline)');
  if (!ctx.grounding.hasClinicalDocumentation) {
    issues.push('No clinical documentation on file for this patient (evaluation, treatment plan, SOAP or progress notes) — attach records before sending');
  }
  // Specific placeholders first; the generic bracket rule only sees what the
  // specific ones did not already name, so one "[Insurance Address]" is one
  // issue, not two.
  let remaining = letter;
  const [genericPattern, genericMessage] = PLACEHOLDER_PATTERNS[PLACEHOLDER_PATTERNS.length - 1];
  for (const [pattern, message] of PLACEHOLDER_PATTERNS.slice(0, -1)) {
    if (pattern.test(remaining)) {
      if (!issues.includes(message)) issues.push(message);
      remaining = remaining.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'), '');
    }
  }
  if (genericPattern.test(remaining) && !issues.includes(genericMessage)) issues.push(genericMessage);
  for (const key of unsupportedAppealAssertionKeys(letter, ctx.grounding)) {
    issues.push(`Letter asserts something not on record: ${key.replace(/_/g, ' ')}`);
  }
  return { ready: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Deadline
// ---------------------------------------------------------------------------

export type DeadlineSource = 'payer_policy' | 'practice_default' | 'estimated' | 'manual';

/**
 * The code's conservative fallback when neither the plan documents nor the
 * practice state a window. Short on purpose: an early reminder costs
 * nothing, a late one forfeits the appeal. Always labeled "estimated".
 */
export const ESTIMATED_APPEAL_WINDOW_DAYS = 60;

export interface DeadlineBasis {
  deadlineDate: string | null;
  denialDate: string | null;
  policyDays: number | null;
  source: DeadlineSource;
}

/** Days from the member's parsed plan document, if it states a first-level appeal window. */
export function policyDaysFromPlanBenefits(benefits: any): number | null {
  const raw = benefits?.rawExtractedData ?? {};
  const days = Number(raw?.appeal_rights?.first_level_days);
  return Number.isFinite(days) && days > 0 ? Math.round(days) : null;
}

export function computeAppealDeadline(params: {
  denialDate: string | null | undefined;
  planBenefits?: any;
  practice?: { appealWindowDays?: number | null } | null;
  /** Used only when no denial date is known: the deadline is estimated from today. */
  today?: Date;
}): DeadlineBasis {
  const denialDate = params.denialDate && parseDateOnly(params.denialDate) ? params.denialDate.slice(0, 10) : null;
  const fromPlan = policyDaysFromPlanBenefits(params.planBenefits);
  const fromPractice = params.practice?.appealWindowDays && params.practice.appealWindowDays > 0 ? params.practice.appealWindowDays : null;
  let policyDays: number;
  let source: DeadlineSource;
  if (fromPlan) {
    policyDays = fromPlan;
    source = 'payer_policy';
  } else if (fromPractice) {
    policyDays = fromPractice;
    source = 'practice_default';
  } else {
    policyDays = ESTIMATED_APPEAL_WINDOW_DAYS;
    source = 'estimated';
  }
  // Without a denial date the whole thing is an estimate anchored on today,
  // whatever the window's source; the readiness check flags the missing date.
  const anchor = denialDate ?? toDateOnlyString(params.today ?? new Date());
  if (!denialDate) source = 'estimated';
  return {
    deadlineDate: addDaysToDateOnly(anchor, policyDays),
    denialDate,
    policyDays,
    source,
  };
}

/** Human label for the drawer, e.g. "Denial date + 180 days (payer plan appeal rights)". */
export function describeDeadlineBasis(appeal: {
  deadlineSource?: string | null;
  deadlinePolicyDays?: number | null;
  denialDate?: string | null;
}): string {
  const days = appeal.deadlinePolicyDays;
  switch (appeal.deadlineSource) {
    case 'manual':
      return 'Set manually';
    case 'payer_policy':
      return `Denial date + ${days} days (payer plan appeal rights)`;
    case 'practice_default':
      return `Denial date + ${days} days (practice default — verify with payer)`;
    case 'estimated':
      return appeal.denialDate
        ? `Denial date + ${days} days (estimated — verify with payer)`
        : `Estimated: ${days} days from creation — no denial date recorded; verify with payer`;
    default:
      return 'Basis not recorded';
  }
}

/** Date-only validation for PATCHed deadlines: YYYY-MM-DD and a real calendar day. */
export function isValidDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDateOnly(value) !== null;
}

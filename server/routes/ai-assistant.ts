/**
 * AI Assistant Routes
 *
 * Handles:
 * - POST /api/ai/assistant - Chat with AI billing assistant
 * - GET /api/ai/assistant/status - Check if AI assistant is available
 */

import { Router, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { getUserPracticeContext } from '../services/practiceContext';
import { generateSoapNoteAndBilling } from '../services/aiSoapBillingService';
import { assessUnderpayment, analyzeAdjustment } from '../services/underpaymentAnalyzer';
import { db } from '../db';
import {
  remittanceAdvice,
  remittanceLineItems,
  claims,
  feeSchedules,
  patients,
} from '@shared/schema';
import { eq, and, desc, sql, ilike, lte, isNotNull } from 'drizzle-orm';
import logger from '../services/logger';

const router = Router();

// ---------------------------------------------------------------------------
// Cost Optimization #1: Smart Model Routing
// Use cheaper Haiku for simple queries, Sonnet for complex ones
// ---------------------------------------------------------------------------
const MODEL_HAIKU = 'claude-3-5-haiku-20241022';
const MODEL_SONNET = 'claude-sonnet-4-20250514';

// Tools that require Sonnet's stronger reasoning capabilities
const SONNET_TOOLS = new Set([
  'create_patient',
  'submit_claim',
  'generate_soap_note',
  'draft_appeal_letter',
  'suggest_claim_correction',
  'create_appointment',
  'batch_eligibility_check',
  'review_underpayments',
  'draft_underpayment_dispute',
]);

// Keywords that indicate a complex query requiring Sonnet
const SONNET_KEYWORDS = [
  'soap', 'appeal', 'denial', 'denied', 'generate', 'draft', 'write',
  'create claim', 'submit claim', 'analyze', 'review denied',
  'appeal letter', 'correction', 'medical necessity',
  'underpay', 'underpaid', 'underpayment', 'dispute', 'short pay', 'short paid',
  'paid less', 'below contracted', 'partial payment',
];

/**
 * Determine which model to use based on message complexity.
 * Returns MODEL_HAIKU for simple lookups/questions, MODEL_SONNET for complex tasks.
 */
function selectModel(message: string, conversationHistory?: Array<{ role: string; content: string }>): string {
  const normalizedMsg = message.toLowerCase().trim();
  const wordCount = message.split(/\s+/).length;

  // Check for Sonnet keywords regardless of length
  for (const keyword of SONNET_KEYWORDS) {
    if (normalizedMsg.includes(keyword)) {
      return MODEL_SONNET;
    }
  }

  // Long messages (50+ words) are more likely complex
  if (wordCount >= 50) {
    return MODEL_SONNET;
  }

  // Check conversation history for ongoing complex tasks
  if (conversationHistory && conversationHistory.length > 0) {
    const lastFewMessages = conversationHistory.slice(-4);
    for (const msg of lastFewMessages) {
      const content = (msg.content || '').toLowerCase();
      for (const keyword of SONNET_KEYWORDS) {
        if (content.includes(keyword)) {
          return MODEL_SONNET;
        }
      }
    }
  }

  // Default to Haiku for simple queries
  return MODEL_HAIKU;
}

// ---------------------------------------------------------------------------
// Cost Optimization #2: Response Caching for Common Questions
// Cache pure knowledge questions that don't use tool calls
// ---------------------------------------------------------------------------
interface CachedResponse {
  content: string;
  suggestedActions: { label: string; path: string }[];
  timestamp: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MAX_SIZE = 500;
const responseCache = new Map<string, CachedResponse>();

/** Normalize a message for cache key lookup (lowercase, collapse whitespace, strip punctuation) */
function normalizeCacheKey(message: string): string {
  return message
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

/** Check if a message is a cacheable knowledge question (no practice-specific data needed) */
function isCacheableQuestion(message: string): boolean {
  const normalized = message.toLowerCase().trim();

  // Questions that reference practice-specific data are NOT cacheable
  const practiceSpecificPatterns = [
    'my patient', 'my claim', 'my practice', 'my revenue', 'my denial',
    'how many patient', 'how many claim', 'how many appointment',
    'patient named', 'claim number', 'dashboard', 'statistics', 'stats',
    'eligibility', 'schedule', 'appointment', 'create', 'submit', 'add',
    'generate', 'draft', 'appeal', 'denied claim',
  ];
  for (const pattern of practiceSpecificPatterns) {
    if (normalized.includes(pattern)) return false;
  }

  // Questions about general billing knowledge ARE cacheable
  const cacheablePatterns = [
    /what is cpt/i, /what('s| is) the 8.minute/i, /what('s| is) (a |the )?modifier/i,
    /what does cpt/i, /explain.*cpt/i, /tell me about.*cpt/i,
    /what('s| is) (the )?difference between/i, /how do(es)? (i |you )?bill/i,
    /what modifiers/i, /telehealth modifier/i, /8.minute rule/i,
    /what is icd/i, /what('s| is) (a |the )?place of service/i,
    /units? (for|per|in)/i, /how to navigate/i, /how do i (find|go|get to)/i,
    /what('s| is) (a |the )?(go|gp|gn|kx) modifier/i,
  ];
  for (const pattern of cacheablePatterns) {
    if (pattern.test(normalized)) return true;
  }

  return false;
}

/** Store a response in the cache, evicting oldest entries if at capacity */
function cacheResponse(key: string, content: string, suggestedActions: { label: string; path: string }[]): void {
  // Evict oldest entries if at capacity
  if (responseCache.size >= CACHE_MAX_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    responseCache.forEach((v, k) => {
      if (v.timestamp < oldestTime) {
        oldestTime = v.timestamp;
        oldestKey = k;
      }
    });
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { content, suggestedActions, timestamp: Date.now() });
}

/** Get a cached response if available and not expired */
function getCachedResponse(key: string): CachedResponse | null {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Cost Optimization #3: Rate Limiting per Practice
// Prevent any single practice from running up excessive API costs
// ---------------------------------------------------------------------------
interface PracticeUsage {
  count: number;
  resetDate: string; // YYYY-MM-DD
}

const practiceUsageMap = new Map<number, PracticeUsage>();

/** Get the daily message limit for a billing plan */
function getPlanLimit(billingPlan: string | null | undefined): number {
  switch (billingPlan) {
    case 'practice': return Infinity; // Unlimited
    case 'professional': return 300;
    case 'starter': return 100;
    default: return 50; // Free/trial
  }
}

/** Get today's date string in YYYY-MM-DD format */
function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

/** Check if a practice has exceeded its daily message limit. Returns the limit and current count. */
function checkPracticeRateLimit(practiceId: number, billingPlan: string | null | undefined): { allowed: boolean; limit: number; used: number } {
  const today = getTodayString();
  const limit = getPlanLimit(billingPlan);

  let usage = practiceUsageMap.get(practiceId);
  if (!usage || usage.resetDate !== today) {
    // New day — reset counter
    usage = { count: 0, resetDate: today };
    practiceUsageMap.set(practiceId, usage);
  }

  return { allowed: usage.count < limit, limit, used: usage.count };
}

/** Increment the usage counter for a practice */
function incrementPracticeUsage(practiceId: number): void {
  const today = getTodayString();
  let usage = practiceUsageMap.get(practiceId);
  if (!usage || usage.resetDate !== today) {
    usage = { count: 0, resetDate: today };
  }
  usage.count++;
  practiceUsageMap.set(practiceId, usage);
}

let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

// OT billing knowledge base embedded in the system prompt
const BILLING_KNOWLEDGE = `
## Common OT CPT Codes
- 97165: OT Evaluation, Low Complexity (typically 30 min)
- 97166: OT Evaluation, Moderate Complexity (typically 45 min)
- 97167: OT Evaluation, High Complexity (typically 60 min)
- 97168: OT Re-evaluation
- 97110: Therapeutic Exercises (per 15 min unit)
- 97112: Neuromuscular Re-education (per 15 min unit)
- 97116: Gait Training (per 15 min unit)
- 97140: Manual Therapy (per 15 min unit)
- 97530: Therapeutic Activities (per 15 min unit) - functional task training
- 97535: Self-care/Home Management Training (per 15 min unit)
- 97542: Wheelchair Management Training (per 15 min unit)
- 97750: Physical Performance Test (per 15 min unit)
- 97761: Prosthetic Training (per 15 min unit)
- 97763: Orthotic Management/Training (per 15 min unit)
- 92526: Treatment of Swallowing Dysfunction (when performed by OT)
- 97010: Hot/Cold Packs (no charge - usually bundled)
- 97032: Electrical Stimulation (per 15 min unit)
- 97033: Iontophoresis (per 15 min unit)
- 97034: Contrast Bath (per 15 min unit)
- 97035: Ultrasound (per 15 min unit)
- 97039: Unlisted Modality
- 97150: Group Therapy (per 15 min unit)

## Key Differences
- 97530 (Therapeutic Activities): Dynamic, functional activities (e.g., reaching into a cabinet, simulated meal prep). Focuses on functional task performance.
- 97110 (Therapeutic Exercises): Isolated movement patterns to improve strength, ROM, flexibility (e.g., resistive band exercises, stretching). Focuses on body structure/function.
- 97140 (Manual Therapy): Hands-on techniques by therapist (joint mobilization, soft tissue mobilization, manual traction).
- 97112 (Neuromuscular Re-ed): Balance, coordination, posture, proprioception, kinesthetic sense training.

## Common Modifiers
- GO: OT services (required by many payers for OT-specific billing)
- GP: PT services
- GN: SLP services
- 59: Distinct procedural service (use when billing multiple similar codes same session)
- 76: Repeat procedure by same physician
- KX: Requirements specified in the medical policy have been met (Medicare therapy cap)
- GA: Waiver of liability on file (ABN)
- CQ: Outpatient services furnished under arrangement to a provider of services (COTA)
- CO: OT services furnished in whole or in part by a COTA

## 8-Minute Rule (Medicare)
Units are based on total timed treatment minutes:
- 8-22 min = 1 unit
- 23-37 min = 2 units
- 38-52 min = 3 units
- 53-67 min = 4 units
- Each additional 15 min = 1 additional unit
- Minimum 8 minutes to bill 1 unit

## Telehealth Modifiers
- 95: Synchronous telemedicine service via real-time audio/video
- GT: Interactive audio/video telecommunications (older, some payers still require)
- Place of Service 02: Telehealth (patient location other than home)
- Place of Service 10: Telehealth in patient's home
- CR: Catastrophe/disaster modifier (COVID-related telehealth flexibilities)

## Common ICD-10 Codes for OT
- F82: Specific developmental disorder of motor function (Developmental Coordination Disorder)
- F84.0: Autistic disorder
- F84.5: Asperger's syndrome
- F90.0-F90.9: ADHD codes
- G80.0-G80.9: Cerebral palsy codes
- R27.8: Other lack of coordination
- R27.9: Unspecified lack of coordination
- R29.3: Abnormal posture
- R62.50: Unspecified lack of expected normal physiological development in childhood
- Z71.3: Dietary counseling and surveillance

## Payer-Specific Tips
- **Medicare**: Requires KX modifier when therapy threshold exceeded. Must document medical necessity. Functional Limitation Reporting (G-codes) no longer required since 2019.
- **Medicaid**: Rules vary by state. Many require prior authorization. Some states have visit limits.
- **UHC/Optum**: Often requires GO modifier. May have visit limits (e.g., 30 visits/year). Authorization often required after initial eval.
- **Aetna**: Commonly requires pre-certification. Often allows 12-20 visits per authorization.
- **BCBS**: Varies by plan. Many require GO modifier. Check specific plan for auth requirements.
- **Cigna**: Usually requires pre-authorization after evaluation. Typical authorization periods of 60-90 days.
- **Tricare**: Requires referral from PCM. No visit limits for active duty. Family members may have limits.

## HIPAA Compliance Reminders
- Never include full patient identifiers (SSN, full DOB, insurance member ID) in chat responses.
- Always refer to patients by first name only or use initials in AI responses.
- When discussing specific patient data, remind users to handle PHI appropriately.
- Chat history should be treated as potentially containing PHI.
`;

const SYSTEM_PROMPT = `Your name is Blanche. You are a friendly, expert AI billing assistant for TherapyBill, a therapy practice management platform. You specialize in occupational therapy (OT), physical therapy (PT), and speech-language pathology (SLP) billing, coding, and practice management. Always introduce yourself as Blanche when greeting a user for the first time. Be warm, encouraging, and helpful — especially with new users who may not be technical.

Your role:
1. Answer billing and coding questions accurately
2. Help with claim accuracy review and denial prevention
3. Provide practice management advice
4. Query practice data when asked about specific metrics (patients, claims, revenue, etc.)
5. Suggest actionable next steps when appropriate
6. Detect new practices and guide them through setup

${BILLING_KNOWLEDGE}

## Onboarding Guidance
When a user first messages you, call get_practice_setup_status to understand their practice state. If they are a new practice (few or no patients, onboarding incomplete), proactively offer to guide them through setup:

1. "Add your first patient" - suggest navigating to /patients and clicking Add Patient. Use [Action: Add Patient]
2. "Set up your schedule" - suggest navigating to /calendar. Use [Action: View Calendar]
3. "Submit a test claim" - explain they are in sandbox mode and can safely test. Use [Action: Create Claim]
4. "Go live with real claims" - direct to Settings > Clearinghouse to toggle sandbox mode off. Use [Action: View Settings]
5. "Connect Claude Desktop" - mention that they can also manage their practice from Claude Desktop on their computer, and offer to walk them through the 2-minute setup. Use [Action: MCP Setup Guide]

Always be encouraging and guide them step-by-step. When the practice has no patients, claims, or appointments, focus on getting them started rather than showing analytics.

IMPORTANT: After helping a user complete their first few tasks (adding a patient, creating a claim, etc.), proactively suggest Claude Desktop: "By the way, did you know you can do all of this from Claude Desktop on your computer? It takes about 2 minutes to set up, and then you can manage billing, check eligibility, and write SOAP notes just by chatting with me. Want me to walk you through it?" This is a key differentiator for TherapyBill — always look for natural moments to mention it.

## Claude Desktop Integration (MCP)
If a user asks about Claude Desktop, MCP, connecting Claude, or using AI on their desktop, walk them through the setup step by step:

1. "First, you'll need Claude Desktop installed. You can download it free at claude.ai/download"
2. "Next, generate an API key. Go to Settings > MCP Integration in TherapyBill and click Generate Key. Give it a name like 'My Claude Desktop' and copy the key."
3. "Now open Claude Desktop, go to Settings (gear icon) > Connectors > Add custom connector"
4. "For the name, type: TherapyBill AI"
5. "For the URL, type: https://app.therapybillai.com/mcp"
6. "Click Add, then click Connect"
7. "A browser page will open asking for your API key. Paste the key you copied from step 2 and click Authorize"
8. "That's it! Go back to Claude Desktop, start a new chat, and try asking 'Show me my dashboard stats'"

If they seem confused at any step, slow down and explain in more detail. Offer to navigate them to the MCP Integration settings page using [Action: MCP Setup]. You can also direct them to the full setup guide at /mcp-setup using [Action: MCP Setup Guide].

If they ask "what is MCP?" or "what is Claude Desktop?", explain simply: "Claude Desktop is an app from Anthropic that lets you chat with Claude AI on your computer. With the TherapyBill connection, you can manage your billing, check patient eligibility, write SOAP notes, and more — all by just talking to Claude. It's like having me available on your desktop at all times."

Guidelines:
- Be concise but thorough. Use bullet points for clarity.
- When discussing specific billing codes, always include the code number AND description.
- If you're unsure about a payer-specific rule, say so and recommend verifying with the payer.
- When you have access to practice data through function calls, use it to give specific, data-driven answers.
- For HIPAA compliance, refer to patients by first name only in responses.
- If asked about something outside your expertise, be honest about limitations.
- When suggesting actions, format them as clear next steps the user can take.
- Keep responses focused and practical — therapists are busy.
- Important: TherapyBill AI assists with billing accuracy by suggesting codes based on clinical documentation. All coding decisions must be reviewed and approved by the treating provider. This platform does not encourage or facilitate billing for services not rendered. Never suggest billing for services that were not documented or performed.

When a user asks about denied claims or denial follow-up, proactively review all denied claims using review_denied_claims, then offer to draft appeal letters or suggest corrections for each one.`;

// Tool definitions for Claude function calling
const assistantTools: Anthropic.Tool[] = [
  {
    name: 'get_dashboard_stats',
    description: 'Get practice dashboard statistics including total claims, success rate, revenue, denial rate, pending claims, and monthly metrics.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_claims_by_status',
      description: 'Get a breakdown of claims grouped by their status (submitted, paid, denied, etc.).',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'get_top_denial_reasons',
      description: 'Get the most common reasons for claim denials.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'get_patient_count',
      description: 'Get the total number of active patients in the practice.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'search_patient',
      description: 'Search for a patient by name to get their information including visit counts and insurance details.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description: 'The patient name or partial name to search for.',
          },
        },
        required: ['name'],
    },
  },
  {
    name: 'get_revenue_by_month',
      description: 'Get monthly revenue data for a date range. Defaults to the last 6 months if no range specified.',
      input_schema: {
        type: 'object' as const,
        properties: {
          months: {
            type: 'number',
            description: 'Number of months to look back. Defaults to 6.',
          },
        },
        required: [],
    },
  },
  {
    name: 'get_overdue_claims',
      description: 'Get claims that have been submitted but not paid for more than 30 days.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'get_collection_rate',
      description: 'Get the practice collection rate including breakdown by insurance provider.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'get_ar_aging',
      description: 'Get accounts receivable aging data showing outstanding amounts by age bucket (0-30, 31-60, 61-90, 90+ days).',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'get_practice_setup_status',
    description: 'Get the current setup and onboarding status for the practice. Call this when a user first messages you to understand if they are a new practice that needs setup guidance. Returns onboarding progress, patient/claim/appointment counts, sandbox mode status, and setup suggestions.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_patient',
    description: 'Create a new patient in the practice. Use this when a user wants to add their first patient or add a new patient through the assistant.',
    input_schema: {
      type: 'object' as const,
      properties: {
        firstName: { type: 'string' as const, description: 'Patient first name' },
        lastName: { type: 'string' as const, description: 'Patient last name' },
        dateOfBirth: { type: 'string' as const, description: 'Date of birth in YYYY-MM-DD format' },
        email: { type: 'string' as const, description: 'Patient or guardian email' },
        phone: { type: 'string' as const, description: 'Phone number' },
        insuranceProvider: { type: 'string' as const, description: 'Insurance company name' },
      },
      required: ['firstName', 'lastName'],
    },
  },
  {
    name: 'create_appointment',
    description: 'Schedule an appointment for a patient. Use this when a user wants to create their first appointment or schedule a session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID to schedule for' },
        date: { type: 'string' as const, description: 'Appointment date in YYYY-MM-DD format' },
        time: { type: 'string' as const, description: 'Start time in HH:MM format (24h)' },
        duration: { type: 'number' as const, description: 'Duration in minutes (default 60)' },
        type: { type: 'string' as const, description: 'Appointment type (default "Therapy Session")' },
      },
      required: ['patientId', 'date', 'time'],
    },
  },
  {
    name: 'navigate_user',
    description: 'Direct the user to a specific page in the app. Use this to help them find the right place for what they want to do.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page: {
          type: 'string' as const,
          enum: ['patients', 'calendar', 'claims', 'settings', 'soap-notes', 'analytics', 'mcp-setup', 'onboarding'],
          description: 'The page to navigate to',
        },
      },
      required: ['page'],
    },
  },
  {
    name: 'submit_claim',
    description: 'Create and submit an insurance claim for a patient session. Use when a therapist wants to bill for a completed session. Requires patient, CPT codes, diagnosis code, and service date. The claim is created in draft status for the therapist to review before submission.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID to bill for' },
        patientName: { type: 'string' as const, description: 'Patient name (if ID not known)' },
        serviceDate: { type: 'string' as const, description: 'Date of service in YYYY-MM-DD format' },
        cptCodes: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'CPT codes for services rendered (e.g., ["97530", "97110"])',
        },
        diagnosisCode: { type: 'string' as const, description: 'ICD-10 diagnosis code' },
        units: { type: 'number' as const, description: 'Number of units (default based on CPT code)' },
        totalAmount: { type: 'number' as const, description: 'Total billed amount in dollars' },
      },
      required: ['patientId', 'serviceDate', 'cptCodes'],
    },
  },
  {
    name: 'check_eligibility',
    description: 'Check if a patient has active insurance coverage by running a real-time eligibility verification through the clearinghouse. Use this when a user asks about eligibility, insurance status, or coverage for a patient. Requires a patient ID or patient name to look up.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID to check eligibility for' },
        patientName: { type: 'string' as const, description: 'Patient name to search for (if ID not known)' },
      },
      required: [],
    },
  },
  {
    name: 'generate_soap_note',
    description: 'Generate a SOAP note with billing codes for a therapy session. Use when a therapist describes a session and wants documentation generated. Collects session details and produces subjective, objective, assessment, and plan sections with CPT code recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID' },
        patientName: { type: 'string' as const, description: 'Patient name (if ID not known)' },
        sessionDuration: { type: 'number' as const, description: 'Session duration in minutes (default 60)' },
        activities: { type: 'array' as const, items: { type: 'string' as const }, description: 'Activities performed during session' },
        mood: { type: 'string' as const, description: 'Patient mood/presentation' },
        performance: { type: 'string' as const, description: 'Overall performance level' },
        assistanceLevel: { type: 'string' as const, description: 'Level of assistance needed' },
        planNextSteps: { type: 'string' as const, description: 'Plan for next session' },
        location: { type: 'string' as const, description: 'Treatment location (clinic, telehealth, home)' },
      },
      required: ['patientId', 'activities'],
    },
  },
  {
    name: 'review_denied_claims',
    description: 'Review all denied claims for the practice. Returns a list of denied claims with claim number, patient name, amount, denial reason, service date, and suggested action. Use this when a user asks about denied claims, denials, or denial follow-up.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'draft_appeal_letter',
    description: 'Draft an appeal letter for a denied claim. Looks up the claim details, denial reason, patient info, and service details, then generates a professional appeal letter with arguments for overturning the denial. Returns claim context and the generated appeal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        claimId: {
          type: 'number' as const,
          description: 'The ID of the denied claim to draft an appeal for.',
        },
      },
      required: ['claimId'],
    },
  },
  {
    name: 'suggest_claim_correction',
    description: 'Analyze a denied claim and suggest specific corrections to fix the issue and get it paid. Examines the denial reason and recommends next steps such as resubmitting with corrections, obtaining prior authorization, or appealing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        claimId: {
          type: 'number' as const,
          description: 'The ID of the denied claim to analyze for corrections.',
        },
      },
      required: ['claimId'],
    },
  },
  {
    name: 'batch_eligibility_check',
    description: 'Check insurance eligibility for all patients with upcoming appointments in the next 7 days. No parameters needed. Returns a summary of how many patients were checked, how many are eligible, ineligible, or had errors, plus per-patient details.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'review_underpayments',
    description: 'Review all claims where insurance paid less than the expected reimbursement (from the fee schedule). Analyzes CAS adjustment reason codes to determine whether underpayments are standard contractual adjustments, patient responsibility, or true underpayments worth disputing. Use when a user asks about underpayments, short pays, insurance paying less than expected, or wants to review ERA adjustments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        daysBack: {
          type: 'number' as const,
          description: 'Number of days to look back for underpayments. Defaults to 90.',
        },
      },
      required: [],
    },
  },
  {
    name: 'draft_underpayment_dispute',
    description: 'Draft a dispute letter for an underpaid claim. Looks up the claim, ERA/remittance data, adjustment reason codes, and fee schedule expected rate, then generates a professional dispute letter requesting reprocessing at the contracted rate. Use when a user wants to dispute an underpayment or fight a short pay from insurance.',
    input_schema: {
      type: 'object' as const,
      properties: {
        claimId: {
          type: 'number' as const,
          description: 'The ID of the underpaid claim to draft a dispute for.',
        },
      },
      required: ['claimId'],
    },
  },
];

// Execute tool calls against the database
async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  practiceId: number,
  userId?: string,
): Promise<string> {
  try {
    switch (toolName) {
      case 'get_dashboard_stats': {
        const stats = await storage.getDashboardStats(practiceId);
        return JSON.stringify(stats);
      }

      case 'get_claims_by_status': {
        const statusData = await storage.getClaimsByStatus(practiceId);
        return JSON.stringify(statusData);
      }

      case 'get_top_denial_reasons': {
        const reasons = await storage.getTopDenialReasons(practiceId);
        return JSON.stringify(reasons);
      }

      case 'get_patient_count': {
        const patients = await storage.getPatients(practiceId);
        return JSON.stringify({ totalPatients: patients.length });
      }

      case 'search_patient': {
        const searchName = String(args.name || '').toLowerCase();
        const allPatients = await storage.getPatients(practiceId);
        const matches = allPatients.filter(
          (p) =>
            p.firstName.toLowerCase().includes(searchName) ||
            p.lastName.toLowerCase().includes(searchName) ||
            `${p.firstName} ${p.lastName}`.toLowerCase().includes(searchName),
        );

        if (matches.length === 0) {
          return JSON.stringify({ message: 'No patients found matching that name.' });
        }

        // Return limited info (HIPAA-conscious: no full DOB, SSN, or member IDs)
        const results = await Promise.all(
          matches.slice(0, 5).map(async (p) => {
            // Get eligibility/visit info if available
            let visitInfo = null;
            try {
              const eligibility = await storage.getEligibilityHistory(p.id);
              if (eligibility && eligibility.length > 0) {
                const latest = eligibility[0];
                visitInfo = {
                  visitsAllowed: latest.visitsAllowed,
                  visitsUsed: latest.visitsUsed,
                  visitsRemaining:
                    latest.visitsAllowed && latest.visitsUsed
                      ? latest.visitsAllowed - latest.visitsUsed
                      : null,
                  coverageStatus: latest.status,
                  coverageType: latest.coverageType,
                  copay: latest.copay,
                  authRequired: latest.authRequired,
                };
              }
            } catch {
              // Non-blocking
            }

            return {
              id: p.id,
              firstName: p.firstName,
              lastName: p.lastName,
              insuranceProvider: p.insuranceProvider,
              visitInfo,
            };
          }),
        );

        return JSON.stringify({ patients: results, totalMatches: matches.length });
      }

      case 'get_revenue_by_month': {
        const months = Number(args.months) || 6;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - months);
        const revenue = await storage.getRevenueByMonth(practiceId, startDate, endDate);
        return JSON.stringify(revenue);
      }

      case 'get_overdue_claims': {
        const allClaims = await storage.getClaimsByStatus(practiceId);
        const submittedCount =
          allClaims.find((c) => c.status === 'submitted')?.count || 0;
        // Also get dashboard stats for context
        const stats = await storage.getDashboardStats(practiceId);
        return JSON.stringify({
          pendingClaims: stats.pendingClaims,
          submittedCount,
          avgDaysToPayment: stats.avgDaysToPayment,
          note: 'Overdue claims are those submitted but not yet paid. Check the Claims page for detailed aging.',
        });
      }

      case 'get_collection_rate': {
        const collectionData = await storage.getCollectionRate(practiceId);
        return JSON.stringify(collectionData);
      }

      case 'get_ar_aging': {
        const arData = await storage.getDaysInAR(practiceId);
        return JSON.stringify(arData);
      }

      case 'get_practice_setup_status': {
        const practice = await storage.getPractice(practiceId);
        const patients = await storage.getPatients(practiceId);
        const claims = await storage.getClaims(practiceId);
        const appointments = await storage.getAppointments(practiceId);

        const totalPatients = patients.length;
        const totalClaims = claims.length;
        const totalAppointments = appointments.length;
        const hasStediKey = !!(practice?.stediApiKey || process.env.STEDI_API_KEY);

        // Check MFA status if we have a userId
        let mfaEnabled = false;
        if (userId) {
          try {
            const user = await storage.getUser(userId);
            if (user) {
              mfaEnabled = !!user.mfaEnabled;
            }
          } catch {
            // Non-blocking
          }
        }

        // Build setup suggestions based on what's missing
        const setupSuggestions: string[] = [];
        if (totalPatients === 0) {
          setupSuggestions.push('Add your first patient');
        }
        if (totalAppointments === 0) {
          setupSuggestions.push('Create an appointment');
        }
        if (totalClaims === 0 && totalPatients > 0) {
          setupSuggestions.push('Submit a test claim');
        }
        if (!mfaEnabled) {
          setupSuggestions.push('Enable MFA for HIPAA compliance');
        }
        if (!hasStediKey) {
          setupSuggestions.push('Configure clearinghouse API key in Settings');
        }

        return JSON.stringify({
          onboardingCompleted: practice?.onboardingCompleted ?? false,
          onboardingStep: practice?.onboardingStep ?? 0,
          totalPatients,
          totalClaims,
          totalAppointments,
          hasStediKey,
          mfaEnabled,
          setupSuggestions,
        });
      }

      case 'create_patient': {
        const patientData: any = {
          practiceId,
          firstName: args.firstName as string,
          lastName: args.lastName as string,
        };
        if (args.dateOfBirth) patientData.dateOfBirth = args.dateOfBirth;
        if (args.email) patientData.email = args.email;
        if (args.phone) patientData.phone = args.phone;
        if (args.insuranceProvider) patientData.insuranceProvider = args.insuranceProvider;
        const patient = await storage.createPatient(patientData);
        return JSON.stringify({ success: true, patient: { id: patient.id, firstName: patient.firstName, lastName: patient.lastName }, message: `Patient ${patient.firstName} ${patient.lastName} created successfully.` });
      }

      case 'create_appointment': {
        const duration = (args.duration as number) || 60;
        const startTime = new Date(`${args.date}T${args.time}:00`);
        const endTime = new Date(startTime.getTime() + duration * 60000);
        const appt = await storage.createAppointment({
          practiceId,
          patientId: args.patientId as number,
          startTime,
          endTime,
          title: (args.type as string) || 'Therapy Session',
          status: 'scheduled',
        });
        return JSON.stringify({ success: true, appointment: { id: appt.id, date: args.date, time: args.time, duration }, message: 'Appointment scheduled successfully.' });
      }

      case 'navigate_user': {
        const pageMap: Record<string, string> = {
          patients: '/patients',
          calendar: '/calendar',
          claims: '/claims',
          settings: '/settings',
          'soap-notes': '/soap-notes',
          analytics: '/analytics',
          'mcp-setup': '/mcp-setup',
          onboarding: '/onboarding',
        };
        const path = pageMap[args.page as string] || '/';
        return JSON.stringify({ action: 'navigate', path, label: `Go to ${args.page}` });
      }

      case 'submit_claim': {
        let patientId = args.patientId as number | undefined;

        // If name provided instead of ID, search for patient
        if (!patientId && args.patientName) {
          const patients = await storage.getPatients(practiceId);
          const match = patients.find((p: any) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes((args.patientName as string).toLowerCase()),
          );
          if (!match) return JSON.stringify({ error: `Patient "${args.patientName}" not found. Please check the name or provide a patient ID.` });
          patientId = match.id;
        }

        if (!patientId) return JSON.stringify({ error: 'Please provide a patient name or ID.' });

        const patient = await storage.getPatient(patientId);
        if (!patient) return JSON.stringify({ error: 'Patient not found.' });

        const cptCodes = args.cptCodes as string[];
        if (!cptCodes || cptCodes.length === 0) {
          return JSON.stringify({ error: 'At least one CPT code is required.' });
        }

        const serviceDate = args.serviceDate as string;
        if (!serviceDate) return JSON.stringify({ error: 'Service date is required (YYYY-MM-DD).' });

        // Calculate total amount: use provided amount or default based on units
        const units = (args.units as number) || cptCodes.length;
        const totalAmount = (args.totalAmount as number) || units * 75; // Default $75/unit if not specified

        // Generate a claim number
        const claimNumber = `CLM-${Date.now()}-${patientId}`;

        // Create the claim in draft status
        const claim = await storage.createClaim({
          practiceId,
          patientId,
          claimNumber,
          totalAmount: String(totalAmount),
          status: 'draft',
        });

        return JSON.stringify({
          success: true,
          claim: {
            id: claim.id,
            claimNumber: claim.claimNumber,
            patientName: `${patient.firstName} ${patient.lastName}`,
            serviceDate,
            cptCodes,
            diagnosisCode: (args.diagnosisCode as string) || 'Not specified',
            units,
            totalAmount: `$${totalAmount.toFixed(2)}`,
            status: 'draft',
          },
          message: `Claim ${claim.claimNumber} created for ${patient.firstName} ${patient.lastName}. The claim is in draft status — please review it in the Claims page and submit when ready. [Action: View Claims]`,
        });
      }

      case 'check_eligibility': {
        let patientId = args.patientId as number | undefined;

        // If name provided, search for patient
        if (!patientId && args.patientName) {
          const patients = await storage.getPatients(practiceId);
          const match = patients.find((p: any) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes((args.patientName as string).toLowerCase()),
          );
          if (!match) return JSON.stringify({ error: `Patient "${args.patientName}" not found` });
          patientId = match.id;
        }

        if (!patientId) return JSON.stringify({ error: 'Please provide a patient name or ID' });

        const patient = await storage.getPatient(patientId);
        if (!patient) return JSON.stringify({ error: 'Patient not found' });

        const practice = await storage.getPractice(practiceId);

        // Resolve payer ID from insurance provider name
        const { checkEligibility, PAYER_IDS } = await import('../services/stediService');
        const insuranceName = (patient.insuranceProvider || '').toLowerCase();
        const payerId = PAYER_IDS[insuranceName] || patient.insuranceId || '60054';

        const result = await checkEligibility({
          payer: { id: payerId, name: patient.insuranceProvider || 'Unknown' },
          provider: {
            npi: practice?.npi || '',
            organizationName: practice?.name || undefined,
          },
          subscriber: {
            memberId: patient.insuranceId || patient.policyNumber || '',
            firstName: patient.firstName,
            lastName: patient.lastName,
            dateOfBirth: patient.dateOfBirth || '',
          },
          serviceTypeCodes: ['30'],
        }, practiceId);

        return JSON.stringify({
          patient: `${patient.firstName} ${patient.lastName}`,
          insurance: patient.insuranceProvider,
          status: result.status,
          planName: result.planName,
          groupNumber: result.groupNumber,
          effectiveDate: result.effectiveDate,
          copay: result.copay,
          deductible: result.deductible,
          outOfPocketMax: result.outOfPocketMax,
          coinsurance: result.coinsurance,
          coverageActive: result.status === 'active',
          errors: result.errors,
        });
      }

      case 'generate_soap_note': {
        let patientId = args.patientId as number | undefined;

        // If name provided instead of ID, search for patient
        if (!patientId && args.patientName) {
          const patients = await storage.getPatients(practiceId);
          const searchName = (args.patientName as string).toLowerCase();
          const match = patients.find((p) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes(searchName),
          );
          if (!match) return JSON.stringify({ error: `Patient "${args.patientName}" not found. Please provide a valid patient name or ID.` });
          patientId = match.id;
        }

        if (!patientId) return JSON.stringify({ error: 'Please provide a patient name or ID to generate a SOAP note.' });

        const soapPatient = await storage.getPatient(patientId);
        if (!soapPatient) return JSON.stringify({ error: 'Patient not found.' });

        const activities = (args.activities as string[]) || [];
        if (activities.length === 0) return JSON.stringify({ error: 'Please provide at least one activity performed during the session.' });

        const soapDuration = (args.sessionDuration as number) || 60;
        const soapMood = (args.mood as string) || 'cooperative and engaged';
        const soapLocation = (args.location as string) || 'clinic';
        const soapPerformance = (args.performance as string) || 'fair';
        const soapAssistanceLevel = (args.assistanceLevel as string) || 'moderate assistance';
        const soapPlanNextSteps = (args.planNextSteps as string) || 'Continue current treatment goals';

        // Call the AI SOAP note + billing generation service
        const soapResult = await generateSoapNoteAndBilling({
          patientId,
          activities,
          mood: soapMood,
          duration: soapDuration,
          location: soapLocation,
          assessment: {
            performance: soapPerformance,
            assistance: soapAssistanceLevel,
            strength: 'see assessment details',
            motorPlanning: 'see assessment details',
            sensoryRegulation: 'see assessment details',
          },
          planNextSteps: soapPlanNextSteps,
        });

        // Save the SOAP note to the database by creating a treatment session first
        let savedNoteId: number | null = null;
        try {
          // Get a default CPT code for the session record
          const cptCodes = await storage.getCptCodes();
          const defaultCptCode = cptCodes.length > 0 ? cptCodes[0] : null;

          if (defaultCptCode && userId) {
            const session = await storage.createTreatmentSession({
              practiceId,
              patientId,
              therapistId: userId,
              sessionDate: new Date().toISOString().split('T')[0],
              duration: soapDuration,
              cptCodeId: defaultCptCode.id,
              status: 'completed',
              dataSource: 'ai_extracted',
            });

            const savedNote = await storage.createSoapNote({
              sessionId: session.id,
              subjective: soapResult.subjective,
              objective: soapResult.objective,
              assessment: soapResult.assessment,
              plan: soapResult.plan,
              location: soapLocation,
              interventions: activities,
              aiSuggestedCptCodes: soapResult.cptCodes,
              therapistId: userId,
              dataSource: 'ai_extracted',
            });
            savedNoteId = savedNote.id;
          }
        } catch (saveError) {
          logger.error('Error saving AI-generated SOAP note', {
            error: saveError instanceof Error ? saveError.message : String(saveError),
          });
          // Continue - we still return the generated content even if save fails
        }

        return JSON.stringify({
          success: true,
          patient: `${soapPatient.firstName} ${soapPatient.lastName}`,
          savedNoteId,
          subjective: soapResult.subjective,
          objective: soapResult.objective,
          assessment: soapResult.assessment,
          plan: soapResult.plan,
          cptCodes: soapResult.cptCodes.map((c) => ({
            code: c.code,
            name: c.name,
            units: c.units,
            rationale: c.rationale,
          })),
          timeBlocks: soapResult.timeBlocks,
          totalReimbursement: soapResult.totalReimbursement,
          billingRationale: soapResult.billingRationale,
          disclaimer: 'All coding decisions must be reviewed and approved by the treating provider.',
        });
      }

      case 'review_denied_claims': {
        const allClaims = await storage.getClaims(practiceId);
        const deniedClaims = allClaims.filter((c: any) => c.status === 'denied');

        if (deniedClaims.length === 0) {
          return JSON.stringify({ message: 'No denied claims found for this practice.', deniedClaims: [] });
        }

        // Get patient names and line items for each denied claim
        const deniedDetails = await Promise.all(
          deniedClaims.slice(0, 20).map(async (claim: any) => {
            let patientName = 'Unknown';
            if (claim.patientId) {
              try {
                const patient = await storage.getPatient(claim.patientId);
                if (patient) patientName = `${patient.firstName} ${patient.lastName}`;
              } catch { /* non-blocking */ }
            }

            // Determine a suggested action based on denial reason
            const reason = (claim.denialReason || '').toLowerCase();
            let suggestedAction = 'Review denial reason and consider filing an appeal';
            if (reason.includes('authorization') || reason.includes('prior auth')) {
              suggestedAction = 'Obtain prior authorization and resubmit the claim';
            } else if (reason.includes('duplicate')) {
              suggestedAction = 'Check for duplicate claims and void if necessary';
            } else if (reason.includes('missing') || reason.includes('incomplete') || reason.includes('information')) {
              suggestedAction = 'Identify missing information, correct the claim, and resubmit';
            } else if (reason.includes('not covered') || reason.includes('coverage') || reason.includes('non-covered')) {
              suggestedAction = 'Review coverage terms; consider alternative CPT codes or filing an appeal';
            } else if (reason.includes('timely') || reason.includes('filing')) {
              suggestedAction = 'Gather proof of original submission and file a timely filing appeal';
            } else if (reason.includes('medical necessity') || reason.includes('not medically necessary')) {
              suggestedAction = 'Strengthen clinical documentation and file a medical necessity appeal';
            } else if (reason.includes('coding') || reason.includes('modifier') || reason.includes('bundl')) {
              suggestedAction = 'Review CPT/modifier coding and resubmit with corrections';
            }

            return {
              claimId: claim.id,
              claimNumber: claim.claimNumber,
              patientName,
              amount: `$${claim.totalAmount}`,
              denialReason: claim.denialReason || 'Not specified',
              serviceDate: claim.submittedAt || claim.createdAt,
              suggestedAction,
            };
          }),
        );

        return JSON.stringify({
          totalDenied: deniedClaims.length,
          deniedClaims: deniedDetails,
          message: `Found ${deniedClaims.length} denied claim(s). I can draft appeal letters or suggest corrections for any of them.`,
        });
      }

      case 'draft_appeal_letter': {
        const claimId = args.claimId as number;
        if (!claimId) return JSON.stringify({ error: 'Please provide a claim ID.' });

        const claim = await storage.getClaim(claimId);
        if (!claim) return JSON.stringify({ error: `Claim ${claimId} not found.` });
        if (claim.practiceId !== practiceId) return JSON.stringify({ error: 'Claim does not belong to this practice.' });

        // Get patient info
        let patientData = { firstName: 'Unknown', lastName: 'Patient', dateOfBirth: null as string | null, insuranceProvider: null as string | null, insuranceId: null as string | null };
        if (claim.patientId) {
          const patient = await storage.getPatient(claim.patientId);
          if (patient) {
            patientData = {
              firstName: patient.firstName,
              lastName: patient.lastName,
              dateOfBirth: patient.dateOfBirth,
              insuranceProvider: patient.insuranceProvider,
              insuranceId: patient.insuranceId || patient.policyNumber || null,
            };
          }
        }

        // Get practice info
        const practice = await storage.getPractice(practiceId);
        const practiceData = {
          name: practice?.name || 'Practice',
          npi: practice?.npi || null,
          address: practice?.address || null,
          phone: practice?.phone || null,
        };

        // Get line items with CPT/ICD codes
        const lineItems = await storage.getClaimLineItems(claimId);
        const lineItemDetails = await Promise.all(
          lineItems.map(async (li: any) => {
            let cptCode = null;
            let icd10Code = null;
            try {
              if (li.cptCodeId) {
                const codes = await storage.getCptCodes();
                cptCode = codes.find((c: any) => c.id === li.cptCodeId) || null;
              }
              if (li.icd10CodeId) {
                const codes = await storage.getIcd10Codes();
                icd10Code = codes.find((c: any) => c.id === li.icd10CodeId) || null;
              }
            } catch { /* non-blocking */ }
            return {
              cptCode: cptCode ? { code: cptCode.code, description: cptCode.description } : undefined,
              icd10Code: icd10Code ? { code: icd10Code.code, description: icd10Code.description } : undefined,
              units: li.units || 1,
              amount: li.amount || '0',
            };
          }),
        );

        const denialReason = claim.denialReason || 'Reason not specified';

        // Try to use the Claude appeal service if available
        try {
          const { generateClaudeAppeal, isClaudeAppealAvailable } = await import('../services/claudeAppealService');
          if (isClaudeAppealAvailable()) {
            const appealResult = await generateClaudeAppeal({
              claim: {
                id: claim.id,
                claimNumber: claim.claimNumber,
                totalAmount: claim.totalAmount,
                denialReason: claim.denialReason,
                submittedAt: claim.submittedAt,
              },
              lineItems: lineItemDetails,
              patient: patientData,
              practice: practiceData,
              denialReason,
            });

            return JSON.stringify({
              claimId: claim.id,
              claimNumber: claim.claimNumber,
              patientName: `${patientData.firstName} ${patientData.lastName}`,
              denialReason,
              amount: `$${claim.totalAmount}`,
              appealLetter: appealResult.appealLetter,
              denialCategory: appealResult.denialCategory,
              successProbability: appealResult.successProbability,
              suggestedActions: appealResult.suggestedActions,
              keyArguments: appealResult.keyArguments,
              message: 'Appeal letter generated successfully. Review and customize before sending to the payer.',
            });
          }
        } catch (appealError) {
          logger.error('Failed to generate appeal via Claude service, returning claim details for manual drafting', {
            error: appealError instanceof Error ? appealError.message : String(appealError),
          });
        }

        // Fallback: return structured claim details so Blanche can write the appeal in her response
        return JSON.stringify({
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          patientName: `${patientData.firstName} ${patientData.lastName}`,
          patientDOB: patientData.dateOfBirth,
          insuranceProvider: patientData.insuranceProvider,
          memberId: patientData.insuranceId,
          practiceName: practiceData.name,
          practiceNPI: practiceData.npi,
          practiceAddress: practiceData.address,
          practicePhone: practiceData.phone,
          denialReason,
          amount: `$${claim.totalAmount}`,
          serviceDate: claim.submittedAt || claim.createdAt,
          lineItems: lineItemDetails,
          message: 'I have the claim details. I will draft an appeal letter based on this information.',
        });
      }

      case 'suggest_claim_correction': {
        const corrClaimId = args.claimId as number;
        if (!corrClaimId) return JSON.stringify({ error: 'Please provide a claim ID.' });

        const corrClaim = await storage.getClaim(corrClaimId);
        if (!corrClaim) return JSON.stringify({ error: `Claim ${corrClaimId} not found.` });
        if (corrClaim.practiceId !== practiceId) return JSON.stringify({ error: 'Claim does not belong to this practice.' });

        const denialText = (corrClaim.denialReason || '').toLowerCase();
        const corrections: { issue: string; correction: string; priority: string }[] = [];
        let overallStrategy = 'appeal';

        // Analyze denial reason and suggest corrections
        if (denialText.includes('authorization') || denialText.includes('prior auth') || denialText.includes('pre-cert')) {
          corrections.push({
            issue: 'Prior authorization required',
            correction: 'Obtain retroactive authorization from the payer if possible. Contact the insurance company to request a retroactive auth, citing clinical necessity and any documentation of the referral process. Then resubmit the claim with the authorization number.',
            priority: 'high',
          });
          overallStrategy = 'resubmit_with_auth';
        }

        if (denialText.includes('duplicate')) {
          corrections.push({
            issue: 'Duplicate claim detected',
            correction: 'Check your claims list for duplicate submissions for the same patient, date of service, and CPT codes. If a true duplicate exists, void the extra claim. If the services were distinct (e.g., different times or codes), add modifier 59 (Distinct Procedural Service) or modifier XE/XS/XP/XU and resubmit with documentation explaining why the services are separate.',
            priority: 'high',
          });
          overallStrategy = 'correct_and_resubmit';
        }

        if (denialText.includes('missing') || denialText.includes('incomplete') || denialText.includes('invalid') || denialText.includes('information')) {
          corrections.push({
            issue: 'Missing or incomplete information',
            correction: 'Review the claim for missing fields: patient demographics, insurance member ID, group number, referring provider NPI, diagnosis codes, or modifiers. Correct the missing data and resubmit. Common missing items include: GO/GP modifier on therapy codes, rendering provider NPI, and place of service code.',
            priority: 'high',
          });
          overallStrategy = 'correct_and_resubmit';
        }

        if (denialText.includes('not covered') || denialText.includes('non-covered') || denialText.includes('coverage') || denialText.includes('benefit')) {
          corrections.push({
            issue: 'Service not covered under plan',
            correction: 'Verify the patient\'s specific plan benefits for therapy services. Consider: (1) Using an alternative CPT code that is covered (e.g., 97530 instead of 97110 if functionally appropriate), (2) Adding appropriate modifiers, (3) Checking if a different diagnosis code better supports medical necessity, (4) Filing an appeal with clinical documentation showing the service was medically necessary.',
            priority: 'medium',
          });
          overallStrategy = 'appeal_or_recode';
        }

        if (denialText.includes('timely') || denialText.includes('filing') || denialText.includes('deadline')) {
          corrections.push({
            issue: 'Timely filing deadline exceeded',
            correction: 'Gather proof of original submission (clearinghouse confirmation, submission logs, or screenshots). File a timely filing appeal with this evidence. If the delay was due to incorrect payer information or a payer processing error, include documentation of the initial submission attempt.',
            priority: 'critical',
          });
          overallStrategy = 'timely_filing_appeal';
        }

        if (denialText.includes('medical necessity') || denialText.includes('not medically necessary') || denialText.includes('not necessary')) {
          corrections.push({
            issue: 'Medical necessity not established',
            correction: 'Strengthen clinical documentation by: (1) Ensuring SOAP notes clearly document functional deficits and skilled intervention need, (2) Including measurable treatment goals and progress data, (3) Referencing clinical practice guidelines (e.g., AOTA, APA), (4) Documenting why services require the skill of a licensed therapist. File an appeal with updated documentation.',
            priority: 'high',
          });
          overallStrategy = 'appeal_with_documentation';
        }

        if (denialText.includes('coding') || denialText.includes('modifier') || denialText.includes('bundl') || denialText.includes('unbundl')) {
          corrections.push({
            issue: 'Coding or modifier error',
            correction: 'Review CPT code selection and modifiers: (1) Ensure the correct therapy modifier is applied (GO for OT, GP for PT, GN for SLP), (2) Check for bundling conflicts (e.g., 97140 and 97530 billed same session may require modifier 59), (3) Verify units match documented treatment time per the 8-minute rule, (4) Correct any code-to-diagnosis mismatches. Resubmit with corrected codes.',
            priority: 'high',
          });
          overallStrategy = 'correct_and_resubmit';
        }

        if (denialText.includes('eligib') || denialText.includes('not eligible') || denialText.includes('inactive') || denialText.includes('terminated')) {
          corrections.push({
            issue: 'Patient eligibility issue',
            correction: 'Verify patient insurance eligibility for the date of service. Check: (1) Was the policy active on the service date? (2) Is the member ID correct? (3) Is there a coordination of benefits issue (secondary insurance)? Run an eligibility check and resubmit to the correct payer if needed.',
            priority: 'high',
          });
          overallStrategy = 'verify_eligibility_and_resubmit';
        }

        // If no specific patterns matched, provide general guidance
        if (corrections.length === 0) {
          corrections.push({
            issue: 'Denial reason requires manual review',
            correction: `The denial reason "${corrClaim.denialReason || 'not specified'}" does not match a common pattern. Recommended steps: (1) Contact the payer to clarify the exact denial reason and required corrections, (2) Review the EOB/ERA for specific remark codes, (3) Consider filing a formal appeal with supporting clinical documentation.`,
            priority: 'medium',
          });
          overallStrategy = 'contact_payer';
        }

        // Get line items for additional context
        let lineItemSummary: any[] = [];
        try {
          const lineItems = await storage.getClaimLineItems(corrClaimId);
          lineItemSummary = lineItems.map((li: any) => ({
            units: li.units,
            amount: li.amount,
            modifier: li.modifier,
          }));
        } catch { /* non-blocking */ }

        return JSON.stringify({
          claimId: corrClaim.id,
          claimNumber: corrClaim.claimNumber,
          amount: `$${corrClaim.totalAmount}`,
          denialReason: corrClaim.denialReason || 'Not specified',
          overallStrategy,
          corrections,
          lineItems: lineItemSummary,
          message: `Found ${corrections.length} suggested correction(s) for this denied claim. ${overallStrategy === 'appeal' ? 'I recommend filing an appeal.' : overallStrategy === 'correct_and_resubmit' ? 'I recommend correcting and resubmitting the claim.' : 'Review the corrections above and take action.'}`,
        });
      }

      case 'batch_eligibility_check': {
        const { checkEligibility: stediCheckEligibility, isStediConfigured, PAYER_IDS: payerIds } = await import('../services/stediService');

        if (!isStediConfigured()) {
          return JSON.stringify({ error: 'Stedi API is not configured. Please set the STEDI_API_KEY.' });
        }

        const practice = await storage.getPractice(practiceId);

        // Get appointments for the next 7 days
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const upcomingAppts = await storage.getAppointmentsByDateRange(practiceId, now, sevenDaysFromNow);

        // Get unique patient IDs from non-cancelled appointments
        const uniquePatientIds = Array.from(new Set(
          upcomingAppts
            .filter((a: any) => a.status !== 'cancelled' && a.patientId)
            .map((a: any) => a.patientId!)
        ));

        if (uniquePatientIds.length === 0) {
          return JSON.stringify({
            checked: 0,
            eligible: 0,
            ineligible: 0,
            errors: 0,
            results: [],
            message: 'No upcoming appointments found in the next 7 days.',
          });
        }

        const batchResults: Array<{ patientName: string; insurance: string | null; status: string; eligible: boolean | null; error?: string }> = [];
        let batchEligible = 0;
        let batchIneligible = 0;
        let batchErrors = 0;

        for (let i = 0; i < uniquePatientIds.length; i++) {
          if (i > 0) await new Promise((resolve) => setTimeout(resolve, 200));
          const pid = uniquePatientIds[i];
          try {
            const pat = await storage.getPatient(pid);
            if (!pat) { batchErrors++; batchResults.push({ patientName: 'Unknown', insurance: null, status: 'error', eligible: null, error: 'Patient not found' }); continue; }
            if (!pat.insuranceProvider && !pat.insuranceId && !pat.policyNumber) {
              batchErrors++;
              batchResults.push({ patientName: `${pat.firstName} ${pat.lastName}`, insurance: null, status: 'skipped', eligible: null, error: 'No insurance info' });
              continue;
            }

            const insName = (pat.insuranceProvider || '').toLowerCase();
            const pId = payerIds[insName] || pat.insuranceId || '60054';
            const eligRes = await stediCheckEligibility({
              payer: { id: pId, name: pat.insuranceProvider || 'Unknown' },
              provider: { npi: practice?.npi || '', organizationName: practice?.name || undefined },
              subscriber: { memberId: pat.insuranceId || pat.policyNumber || '', firstName: pat.firstName, lastName: pat.lastName, dateOfBirth: pat.dateOfBirth || '' },
              serviceTypeCodes: ['30'],
            }, practiceId);

            const isElig = eligRes.status === 'active';
            if (isElig) batchEligible++;
            else if (eligRes.status === 'inactive') batchIneligible++;
            else batchErrors++;

            batchResults.push({
              patientName: `${pat.firstName} ${pat.lastName}`,
              insurance: pat.insuranceProvider || null,
              status: eligRes.status,
              eligible: isElig,
            });
          } catch (batchErr) {
            batchErrors++;
            batchResults.push({ patientName: 'Unknown', insurance: null, status: 'error', eligible: null, error: batchErr instanceof Error ? batchErr.message : String(batchErr) });
          }
        }

        return JSON.stringify({
          checked: uniquePatientIds.length,
          eligible: batchEligible,
          ineligible: batchIneligible,
          errors: batchErrors,
          results: batchResults,
          message: `Checked ${uniquePatientIds.length} patient(s) with upcoming appointments. ${batchEligible} eligible, ${batchIneligible} ineligible, ${batchErrors} error(s)/skipped.`,
        });
      }

      case 'review_underpayments': {
        const daysBack = Number(args.daysBack) || 90;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysBack);

        // Find matched remittance line items with their claims for this practice
        const matchedLineItems = await db
          .select({
            lineItemId: remittanceLineItems.id,
            claimId: remittanceLineItems.claimId,
            cptCode: remittanceLineItems.cptCode,
            chargedAmount: remittanceLineItems.chargedAmount,
            allowedAmount: remittanceLineItems.allowedAmount,
            paidAmount: remittanceLineItems.paidAmount,
            adjustmentAmount: remittanceLineItems.adjustmentAmount,
            adjustmentReasonCodes: remittanceLineItems.adjustmentReasonCodes,
            patientName: remittanceLineItems.patientName,
            serviceDate: remittanceLineItems.serviceDate,
            payerName: remittanceAdvice.payerName,
            claimNumber: claims.claimNumber,
            claimTotalAmount: claims.totalAmount,
            claimExpectedAmount: claims.expectedAmount,
            claimStatus: claims.status,
            remittanceDate: remittanceAdvice.receivedDate,
          })
          .from(remittanceLineItems)
          .innerJoin(remittanceAdvice, eq(remittanceLineItems.remittanceId, remittanceAdvice.id))
          .innerJoin(claims, eq(remittanceLineItems.claimId, claims.id))
          .where(
            and(
              eq(remittanceAdvice.practiceId, practiceId),
              eq(remittanceLineItems.status, 'matched'),
              isNotNull(remittanceLineItems.claimId),
            )
          )
          .orderBy(desc(remittanceAdvice.receivedDate))
          .limit(100);

        if (matchedLineItems.length === 0) {
          return JSON.stringify({
            message: 'No matched remittance line items found. Upload and auto-match ERA/835 files first to enable underpayment detection.',
            underpayments: [],
            totalUnderpaid: 0,
          });
        }

        // For each matched line item, look up fee schedule and assess underpayment
        const underpayments: Array<{
          claimId: number;
          claimNumber: string | null;
          patientName: string;
          cptCode: string | null;
          payerName: string;
          serviceDate: string | null;
          billedAmount: number;
          expectedReimbursement: number | null;
          paidAmount: number;
          underpaymentAmount: number;
          adjustmentAnalysis: Array<{ code: string; description: string; amount: number; category: string; disputable: boolean; explanation: string }>;
          worthDisputing: boolean;
          recommendation: string;
        }> = [];

        let totalUnderpaidAmount = 0;
        let totalWorthDisputing = 0;

        for (const li of matchedLineItems) {
          const paidAmt = parseFloat(String(li.paidAmount || '0'));
          const billedAmt = parseFloat(String(li.chargedAmount || '0'));

          // Look up expected reimbursement from fee schedule
          let expectedReimbursement: number | null = null;

          // First check if claim already has expectedAmount set
          if (li.claimExpectedAmount) {
            expectedReimbursement = parseFloat(String(li.claimExpectedAmount));
          }

          // Otherwise look up from fee schedule
          if (expectedReimbursement === null && li.cptCode && li.payerName) {
            try {
              const today = new Date().toISOString().split('T')[0];
              const feeEntries = await db
                .select()
                .from(feeSchedules)
                .where(
                  and(
                    eq(feeSchedules.practiceId, practiceId),
                    eq(feeSchedules.cptCode, li.cptCode),
                    ilike(feeSchedules.payerName, `%${li.payerName}%`),
                    lte(feeSchedules.effectiveDate, today),
                  )
                )
                .orderBy(desc(feeSchedules.effectiveDate))
                .limit(1);

              if (feeEntries.length > 0) {
                expectedReimbursement = parseFloat(String(feeEntries[0].expectedReimbursement));
              }
            } catch {
              // Non-blocking
            }
          }

          // Parse adjustment reason codes from stored JSON
          const adjustmentCodes = Array.isArray(li.adjustmentReasonCodes)
            ? (li.adjustmentReasonCodes as Array<{ code: string; description?: string; amount?: number }>)
            : [];

          // Build adjustments with amounts - if individual amounts not stored, distribute total
          const totalAdjustmentAmount = parseFloat(String(li.adjustmentAmount || '0'));
          const adjustmentsWithAmounts = adjustmentCodes.map((adj, idx) => {
            const adjAmount = typeof adj.amount === 'number' ? adj.amount : (
              adjustmentCodes.length > 0 ? totalAdjustmentAmount / adjustmentCodes.length : 0
            );
            return { code: adj.code || '', amount: adjAmount };
          });

          const assessment = assessUnderpayment({
            adjustments: adjustmentsWithAmounts,
            billedAmount: billedAmt,
            paidAmount: paidAmt,
            expectedReimbursement,
            claimId: li.claimId || undefined,
            cptCode: li.cptCode || undefined,
          });

          if (assessment.isUnderpaid) {
            totalUnderpaidAmount += assessment.underpaymentAmount;
            if (assessment.worthDisputing) totalWorthDisputing++;

            underpayments.push({
              claimId: li.claimId!,
              claimNumber: li.claimNumber,
              patientName: li.patientName,
              cptCode: li.cptCode,
              payerName: li.payerName,
              serviceDate: li.serviceDate,
              billedAmount: billedAmt,
              expectedReimbursement,
              paidAmount: paidAmt,
              underpaymentAmount: assessment.underpaymentAmount,
              adjustmentAnalysis: assessment.adjustmentAnalyses.map((a) => ({
                code: a.code,
                description: a.description,
                amount: a.amount,
                category: a.category,
                disputable: a.disputable,
                explanation: a.explanation,
              })),
              worthDisputing: assessment.worthDisputing,
              recommendation: assessment.recommendation,
            });
          }
        }

        return JSON.stringify({
          totalLineItemsReviewed: matchedLineItems.length,
          totalUnderpayments: underpayments.length,
          totalUnderpaidAmount: `$${totalUnderpaidAmount.toFixed(2)}`,
          totalWorthDisputing,
          underpayments: underpayments.slice(0, 20), // Limit to 20 for response size
          message: underpayments.length > 0
            ? `Found ${underpayments.length} underpaid claim(s) totaling $${totalUnderpaidAmount.toFixed(2)}. ${totalWorthDisputing} appear(s) worth disputing. I can draft dispute letters for any of them.`
            : 'No underpayments detected in matched remittance data. All payments appear to be in line with expected reimbursement rates.',
        });
      }

      case 'draft_underpayment_dispute': {
        const disputeClaimId = args.claimId as number;
        if (!disputeClaimId) return JSON.stringify({ error: 'Please provide a claim ID.' });

        const disputeClaim = await storage.getClaim(disputeClaimId);
        if (!disputeClaim) return JSON.stringify({ error: `Claim ${disputeClaimId} not found.` });
        if (disputeClaim.practiceId !== practiceId) return JSON.stringify({ error: 'Claim does not belong to this practice.' });

        // Get patient info
        let disputePatient = { firstName: 'Unknown', lastName: 'Patient', dateOfBirth: null as string | null, insuranceProvider: null as string | null, insuranceId: null as string | null };
        if (disputeClaim.patientId) {
          const pat = await storage.getPatient(disputeClaim.patientId);
          if (pat) {
            disputePatient = {
              firstName: pat.firstName,
              lastName: pat.lastName,
              dateOfBirth: pat.dateOfBirth,
              insuranceProvider: pat.insuranceProvider,
              insuranceId: pat.insuranceId || pat.policyNumber || null,
            };
          }
        }

        // Get practice info
        const disputePractice = await storage.getPractice(practiceId);

        // Find the remittance line item(s) matched to this claim
        const matchedRemitItems = await db
          .select({
            lineItemId: remittanceLineItems.id,
            cptCode: remittanceLineItems.cptCode,
            chargedAmount: remittanceLineItems.chargedAmount,
            allowedAmount: remittanceLineItems.allowedAmount,
            paidAmount: remittanceLineItems.paidAmount,
            adjustmentAmount: remittanceLineItems.adjustmentAmount,
            adjustmentReasonCodes: remittanceLineItems.adjustmentReasonCodes,
            remarkCodes: remittanceLineItems.remarkCodes,
            serviceDate: remittanceLineItems.serviceDate,
            payerName: remittanceAdvice.payerName,
            payerId: remittanceAdvice.payerId,
            checkNumber: remittanceAdvice.checkNumber,
            checkDate: remittanceAdvice.checkDate,
          })
          .from(remittanceLineItems)
          .innerJoin(remittanceAdvice, eq(remittanceLineItems.remittanceId, remittanceAdvice.id))
          .where(eq(remittanceLineItems.claimId, disputeClaimId));

        if (matchedRemitItems.length === 0) {
          return JSON.stringify({
            error: 'No remittance/ERA data found for this claim. Upload and match an ERA file first, then try again.',
          });
        }

        const remitItem = matchedRemitItems[0];
        const paidAmt = parseFloat(String(remitItem.paidAmount || '0'));
        const billedAmt = parseFloat(String(remitItem.chargedAmount || '0'));
        const payerName = remitItem.payerName || disputePatient.insuranceProvider || 'Insurance Company';

        // Look up expected reimbursement from fee schedule
        let expectedReimbursement: number | null = null;
        let feeScheduleSource = '';

        if (disputeClaim.expectedAmount) {
          expectedReimbursement = parseFloat(String(disputeClaim.expectedAmount));
          feeScheduleSource = 'claim expected amount';
        }

        if (expectedReimbursement === null && remitItem.cptCode) {
          try {
            const today = new Date().toISOString().split('T')[0];
            const feeEntries = await db
              .select()
              .from(feeSchedules)
              .where(
                and(
                  eq(feeSchedules.practiceId, practiceId),
                  eq(feeSchedules.cptCode, remitItem.cptCode),
                  ilike(feeSchedules.payerName, `%${payerName}%`),
                  lte(feeSchedules.effectiveDate, today),
                )
              )
              .orderBy(desc(feeSchedules.effectiveDate))
              .limit(1);

            if (feeEntries.length > 0) {
              expectedReimbursement = parseFloat(String(feeEntries[0].expectedReimbursement));
              feeScheduleSource = `fee schedule (effective ${feeEntries[0].effectiveDate})`;
            }
          } catch {
            // Non-blocking
          }
        }

        // Analyze adjustment codes
        const adjustmentCodes = Array.isArray(remitItem.adjustmentReasonCodes)
          ? (remitItem.adjustmentReasonCodes as Array<{ code: string; description?: string; amount?: number }>)
          : [];

        const totalAdjustmentAmount = parseFloat(String(remitItem.adjustmentAmount || '0'));
        const adjustmentsWithAmounts = adjustmentCodes.map((adj) => {
          const adjAmount = typeof adj.amount === 'number' ? adj.amount : (
            adjustmentCodes.length > 0 ? totalAdjustmentAmount / adjustmentCodes.length : 0
          );
          return { code: adj.code || '', amount: adjAmount };
        });

        const assessment = assessUnderpayment({
          adjustments: adjustmentsWithAmounts,
          billedAmount: billedAmt,
          paidAmount: paidAmt,
          expectedReimbursement,
          claimId: disputeClaimId,
          cptCode: remitItem.cptCode || undefined,
        });

        // Build the dispute context for Blanche to draft a letter
        const underpaymentAmount = expectedReimbursement ? (expectedReimbursement - paidAmt) : (billedAmt - paidAmt);

        const disputeContext = {
          claimId: disputeClaim.id,
          claimNumber: disputeClaim.claimNumber,
          patientName: `${disputePatient.firstName} ${disputePatient.lastName}`,
          patientDOB: disputePatient.dateOfBirth,
          memberId: disputePatient.insuranceId,
          payerName,
          payerId: remitItem.payerId,
          checkNumber: remitItem.checkNumber,
          checkDate: remitItem.checkDate,
          serviceDate: remitItem.serviceDate,
          cptCode: remitItem.cptCode,
          billedAmount: `$${billedAmt.toFixed(2)}`,
          allowedAmount: remitItem.allowedAmount ? `$${parseFloat(String(remitItem.allowedAmount)).toFixed(2)}` : null,
          paidAmount: `$${paidAmt.toFixed(2)}`,
          expectedReimbursement: expectedReimbursement ? `$${expectedReimbursement.toFixed(2)}` : 'Not available — no fee schedule entry found',
          feeScheduleSource,
          underpaymentAmount: `$${underpaymentAmount.toFixed(2)}`,
          adjustmentAnalysis: assessment.adjustmentAnalyses.map((a) => ({
            code: a.code,
            description: a.description,
            amount: `$${a.amount.toFixed(2)}`,
            category: a.category,
            disputable: a.disputable,
            explanation: a.explanation,
            recommendedAction: a.recommendedAction,
          })),
          patientResponsibilityTotal: `$${assessment.patientResponsibilityTotal.toFixed(2)}`,
          contractualAdjustmentTotal: `$${assessment.contractualAdjustmentTotal.toFixed(2)}`,
          payerInitiatedTotal: `$${assessment.payerInitiatedTotal.toFixed(2)}`,
          worthDisputing: assessment.worthDisputing,
          practiceName: disputePractice?.name || 'Practice',
          practiceNPI: disputePractice?.npi || null,
          practiceAddress: disputePractice?.address || null,
          practicePhone: disputePractice?.phone || null,
        };

        // Generate the dispute letter text
        const disputeLetter = generateDisputeLetterText(disputeContext);

        return JSON.stringify({
          ...disputeContext,
          disputeLetter,
          recommendedActions: [
            assessment.worthDisputing ? 'Submit this dispute letter to the payer via their provider dispute process' : 'This may not be worth disputing — the adjustments appear standard',
            'Keep a copy of the dispute letter and all supporting documentation',
            'Follow up with the payer in 30 days if no response received',
            expectedReimbursement ? 'Reference the contracted rate from your fee schedule as evidence' : 'Consider adding fee schedule entries for this payer/CPT combination to enable better tracking',
          ],
          message: assessment.worthDisputing
            ? 'Dispute letter drafted. Review and customize before sending to the payer. The letter references your contracted rate and identifies the specific adjustment codes that appear incorrect.'
            : 'I\'ve drafted a dispute letter, but note that the adjustments on this claim may be standard contractual adjustments. Review the analysis carefully before deciding to dispute.',
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (error) {
    logger.error('AI assistant tool execution error', {
      tool: toolName,
      error: error instanceof Error ? error.message : String(error),
    });
    return JSON.stringify({
      error: `Failed to retrieve data: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

/**
 * Generate a dispute letter for an underpaid claim.
 */
function generateDisputeLetterText(context: {
  claimNumber: string | null;
  patientName: string;
  patientDOB: string | null;
  memberId: string | null;
  payerName: string;
  serviceDate: string | null;
  cptCode: string | null;
  billedAmount: string;
  paidAmount: string;
  expectedReimbursement: string;
  underpaymentAmount: string;
  adjustmentAnalysis: Array<{ code: string; description: string; amount: string; disputable: boolean; explanation: string }>;
  practiceName: string;
  practiceNPI: string | null;
  practiceAddress: string | null;
  practicePhone: string | null;
}): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const disputableAdj = context.adjustmentAnalysis.filter((a) => a.disputable);
  const adjSection = disputableAdj.length > 0
    ? disputableAdj.map((a) =>
        `  - Adjustment ${a.code} (${a.description}): ${a.amount} — ${a.explanation}`
      ).join('\n')
    : '  - No specific disputable adjustment codes identified, but the total payment is below the contracted rate.';

  return `${today}

${context.payerName}
Provider Dispute Department

RE: Underpayment Dispute
Claim Number: ${context.claimNumber || 'N/A'}
Patient: ${context.patientName}
Date of Birth: ${context.patientDOB || 'On file'}
Member ID: ${context.memberId || 'On file'}
Date of Service: ${context.serviceDate || 'See claim'}
CPT Code: ${context.cptCode || 'See claim'}

Dear Claims Department,

I am writing to dispute the reimbursement amount for the above-referenced claim. Our records indicate that the payment received does not reflect the contracted reimbursement rate for this service.

PAYMENT DETAILS:
- Billed Amount: ${context.billedAmount}
- Expected Reimbursement (Contracted Rate): ${context.expectedReimbursement}
- Amount Paid: ${context.paidAmount}
- Underpayment Amount: ${context.underpaymentAmount}

ADJUSTMENT CODES IN QUESTION:
${adjSection}

Based on our provider agreement, the expected reimbursement for CPT code ${context.cptCode || '[code]'} is ${context.expectedReimbursement}. The payment of ${context.paidAmount} represents an underpayment of ${context.underpaymentAmount} below the contracted rate.

We respectfully request that this claim be reprocessed at the correct contracted rate. Please review the applicable fee schedule and provider agreement on file for verification.

If there has been a change to the fee schedule or contracted rates, please provide written notification of the effective date and updated rates as required under our provider agreement.

Please process this dispute within 30 business days per applicable state prompt-payment regulations. If you require additional information, please contact our office.

Sincerely,

${context.practiceName}
NPI: ${context.practiceNPI || '[NPI]'}
${context.practiceAddress || '[Address]'}
${context.practicePhone || '[Phone]'}`;
}

// POST /api/ai/assistant - Chat with the AI assistant
router.post('/assistant', isAuthenticated, async (req: any, res: Response) => {
  try {
    const client = getAnthropicClient();
    if (!client) {
      return res.status(503).json({
        message:
          'AI assistant requires a Claude API key to be configured. Please set the ANTHROPIC_API_KEY environment variable.',
        requiresConfig: true,
      });
    }

    const { message, conversationHistory } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message is too long. Please keep it under 2000 characters.' });
    }

    // Get practice context for data queries
    const context = await getUserPracticeContext(req);
    const practiceId = context?.practiceId || 1;
    const userId = context?.userId;

    // --- Cost Optimization #3: Check per-practice rate limit ---
    let billingPlan: string | null = null;
    try {
      const practice = await storage.getPractice(practiceId);
      billingPlan = practice?.billingPlan || null;
    } catch {
      // Non-blocking — default to free tier limit
    }

    const rateCheck = checkPracticeRateLimit(practiceId, billingPlan);
    if (!rateCheck.allowed) {
      return res.json({
        response: "You've reached your daily assistant limit. Upgrade your plan for more, or try again tomorrow.",
        suggestedActions: [{ label: 'View Plans', path: '/settings' }],
        tokensUsed: 0,
        rateLimited: true,
      });
    }

    // --- Cost Optimization #2: Check response cache ---
    const cacheKey = normalizeCacheKey(message);
    if (isCacheableQuestion(message)) {
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        // Still count toward rate limit
        incrementPracticeUsage(practiceId);
        return res.json({
          response: cached.content,
          suggestedActions: cached.suggestedActions,
          tokensUsed: 0,
          cached: true,
        });
      }
    }

    // --- Cost Optimization #1: Select model based on complexity ---
    const selectedModel = selectModel(message, conversationHistory);

    // Build conversation messages for Claude
    const messages: Anthropic.MessageParam[] = [];

    // Add conversation history (limit to last 20 messages to control token usage)
    if (Array.isArray(conversationHistory)) {
      const recentHistory = conversationHistory.slice(-20);
      for (const msg of recentHistory) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({
            role: msg.role,
            content: String(msg.content || ''),
          });
        }
      }
    }

    // Add the current user message
    messages.push({ role: 'user', content: message.trim() });

    // Track which model is actually used (may upgrade mid-conversation)
    let currentModel = selectedModel;

    // First API call - may include tool use
    let response = await client.messages.create({
      model: currentModel,
      system: SYSTEM_PROMPT,
      messages,
      tools: assistantTools,
      max_tokens: 1500,
      temperature: 0.4,
    });

    // Handle tool use (up to 3 rounds to avoid infinite loops)
    let toolRounds = 0;
    while (response.stop_reason === 'tool_use' && toolRounds < 3) {
      toolRounds++;

      // Add assistant response with tool use blocks
      messages.push({ role: 'assistant', content: response.content });

      // Execute all tool calls and build tool results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          // Smart model routing: upgrade to Sonnet if a complex tool is invoked
          if (currentModel === MODEL_HAIKU && SONNET_TOOLS.has(block.name)) {
            currentModel = MODEL_SONNET;
          }

          const toolResult = await executeTool(block.name, (block.input as Record<string, unknown>) || {}, practiceId, userId);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult,
          });
        }
      }

      // Add tool results as user message
      messages.push({ role: 'user', content: toolResults });

      // Get next response (may now be upgraded to Sonnet)
      response = await client.messages.create({
        model: currentModel,
        system: SYSTEM_PROMPT,
        messages,
        tools: assistantTools,
        max_tokens: 1500,
        temperature: 0.4,
      });
    }

    // Extract text content from response
    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    const content = textBlocks.map(b => b.text).join('\n') || 'I apologize, but I was unable to generate a response. Please try again.';

    // Parse for suggested actions (look for patterns like "[Action: ...]")
    const actionPattern = /\[Action:\s*([^\]]+)\]/g;
    const suggestedActions: { label: string; path: string }[] = [];
    const actionMap: Record<string, string> = {
      'check eligibility': '/patients',
      'view claims': '/claims',
      'view denied claims': '/claims',
      'view analytics': '/analytics',
      'view patients': '/patients',
      'add patient': '/patients',
      'view calendar': '/calendar',
      'view reports': '/reports',
      'view denial reasons': '/analytics',
      'create claim': '/claims',
      'view revenue': '/analytics',
      'view ar aging': '/analytics',
      'submit claim': '/claims',
      'check authorization': '/patients',
      'view settings': '/settings',
      'enable mfa': '/settings',
      'mcp setup': '/settings',
      'mcp setup guide': '/mcp-setup',
      'mcp integration': '/settings',
      'claude desktop': '/mcp-setup',
      'connect claude': '/mcp-setup',
    };

    let match;
    while ((match = actionPattern.exec(content)) !== null) {
      const actionLabel = match[1].trim();
      const actionLower = actionLabel.toLowerCase();
      for (const [key, path] of Object.entries(actionMap)) {
        if (actionLower.includes(key)) {
          suggestedActions.push({ label: actionLabel, path });
          break;
        }
      }
    }

    // Clean content of action tags for display
    const cleanContent = content.replace(/\[Action:\s*[^\]]+\]/g, '').trim();

    // Increment rate limit counter on successful response
    incrementPracticeUsage(practiceId);

    // Cache the response if it was a cacheable question and no tools were used
    const usedTools = toolRounds > 0;
    if (!usedTools && isCacheableQuestion(message)) {
      cacheResponse(cacheKey, cleanContent, suggestedActions);
    }

    res.json({
      response: cleanContent,
      suggestedActions,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      model: currentModel,
    });
  } catch (error) {
    logger.error('AI assistant error', {
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Error) {
      if (error.message.includes('401') || error.message.includes('authentication') || error.message.includes('api_key')) {
        return res.status(503).json({
          message: 'The Claude API key appears to be invalid. Please check your configuration.',
          requiresConfig: true,
        });
      }
      if (error.message.includes('429') || error.message.includes('rate_limit')) {
        return res.status(429).json({
          message: 'Too many requests to the AI service. Please wait a moment and try again.',
        });
      }
      if (error.message.includes('overloaded') || error.message.includes('529')) {
        return res.status(503).json({
          message: "Blanche is experiencing high demand right now. Please try again in a moment — it usually clears up within a minute or two!",
        });
      }
    }

    res.status(500).json({
      message: 'An error occurred while processing your request. Please try again.',
    });
  }
});

// GET /api/ai/assistant/status - Check if AI assistant is available
router.get('/assistant/status', (req, res) => {
  const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  res.json({
    available: hasApiKey,
    message: hasApiKey
      ? 'AI assistant is ready (powered by Claude).'
      : 'AI assistant requires ANTHROPIC_API_KEY to be configured.',
  });
});

export default router;

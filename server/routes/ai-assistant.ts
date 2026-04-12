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
import logger from '../services/logger';

const router = Router();

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

const SYSTEM_PROMPT = `You are an expert AI billing assistant for a therapy practice management platform. You specialize in occupational therapy (OT), physical therapy (PT), and speech-language pathology (SLP) billing, coding, and practice management.

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

Always be encouraging and guide them step-by-step. When the practice has no patients, claims, or appointments, focus on getting them started rather than showing analytics.

Guidelines:
- Be concise but thorough. Use bullet points for clarity.
- When discussing specific billing codes, always include the code number AND description.
- If you're unsure about a payer-specific rule, say so and recommend verifying with the payer.
- When you have access to practice data through function calls, use it to give specific, data-driven answers.
- For HIPAA compliance, refer to patients by first name only in responses.
- If asked about something outside your expertise, be honest about limitations.
- When suggesting actions, format them as clear next steps the user can take.
- Keep responses focused and practical — therapists are busy.
- Important: TherapyBill AI assists with billing accuracy by suggesting codes based on clinical documentation. All coding decisions must be reviewed and approved by the treating provider. This platform does not encourage or facilitate billing for services not rendered. Never suggest billing for services that were not documented or performed.`;

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

    // First API call - may include tool use
    let response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
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

      // Get next response
      response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
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

    res.json({
      response: cleanContent,
      suggestedActions,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
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
      if (error.message.includes('overloaded')) {
        return res.status(503).json({
          message: 'The AI service is temporarily overloaded. Please try again in a moment.',
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

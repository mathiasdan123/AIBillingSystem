import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateSoapNoteAndBilling } from '../../services/aiSoapBillingService';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

export function registerSoapTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const generateSoapNote = withAudit(
    'generate_soap_note',
    'soap_note',
    true,
    async (input: {
      patientId: number;
      activities: string[];
      mood: string;
      caregiverReport?: string;
      duration: number;
      location: string;
      assessment: {
        performance: string;
        assistance: string;
        strength: string;
        motorPlanning: string;
        sensoryRegulation: string;
      };
      planNextSteps: string;
      ratePerUnit?: number;
      therapistName?: string;
    }) => {
      return generateSoapNoteAndBilling({
        patientId: input.patientId,
        activities: input.activities,
        mood: input.mood,
        caregiverReport: input.caregiverReport,
        duration: input.duration,
        location: input.location,
        assessment: input.assessment,
        planNextSteps: input.planNextSteps,
        ratePerUnit: input.ratePerUnit,
        therapistName: input.therapistName,
      });
    },
  );

  server.tool(
    'generate_soap_note',
    'Generate an AI-powered SOAP note with CPT billing codes from session details. Returns subjective, objective, assessment, plan sections plus recommended CPT codes, time blocks, and billing rationale. IMPORTANT: All coding decisions must be reviewed and approved by the treating provider.',
    {
      patientId: z.number().describe('Patient ID'),
      activities: z
        .array(z.string())
        .describe('Activities performed during session'),
      mood: z.string().describe('Patient mood/presentation'),
      caregiverReport: z.string().optional().describe('Caregiver report'),
      duration: z.number().describe('Session duration in minutes'),
      location: z.string().describe('Treatment location'),
      assessment: z
        .object({
          performance: z.string().describe('Overall performance level'),
          assistance: z.string().describe('Level of assistance needed'),
          strength: z.string().describe('Strength observations'),
          motorPlanning: z.string().describe('Motor planning observations'),
          sensoryRegulation: z
            .string()
            .describe('Sensory regulation observations'),
        })
        .describe('Clinical assessment observations'),
      planNextSteps: z.string().describe('Plan for next session'),
      ratePerUnit: z
        .number()
        .optional()
        .describe('Reimbursement rate per 15-min unit'),
      therapistName: z.string().optional().describe('Therapist name'),
    },
    (input) => generateSoapNote(input, context),
  );
}

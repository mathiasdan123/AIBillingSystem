import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../../storage';
import { withAudit } from '../audit';
import { withMcpMutationGate } from '../confirmation';
import type { McpPracticeContext } from '../types';

const ALLOWED_TYPES = new Set([
  'appointment_reminder',
  'appointment_confirmation',
  'appointment_cancellation',
]);
const ALLOWED_CHANNELS = new Set(['email', 'sms']);

export function registerNotificationTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  // ── update_notification_template ──────────────────────────────────────
  // Mirror of the in-app dispatcher case + POST /api/notification-templates
  // upsert. Same allowlist + tenant guard + body validation.
  const updateNotificationTemplate = withAudit(
    'update_notification_template',
    'notification_template',
    false,
    withMcpMutationGate(
      async (
        input: {
          notificationType: string;
          channel: string;
          body: string;
          subject?: string;
          isActive?: boolean;
        },
        ctx: McpPracticeContext,
      ) => {
        if (!ALLOWED_TYPES.has(input.notificationType)) {
          throw new Error(
            `notificationType must be one of: ${Array.from(ALLOWED_TYPES).join(', ')}`,
          );
        }
        if (!ALLOWED_CHANNELS.has(input.channel)) {
          throw new Error(
            `channel must be one of: ${Array.from(ALLOWED_CHANNELS).join(', ')}`,
          );
        }
        if (typeof input.body !== 'string' || !input.body.trim()) {
          throw new Error('body is required');
        }
        const upserted = await storage.upsertNotificationTemplate({
          practiceId: ctx.practiceId,
          notificationType: input.notificationType,
          channel: input.channel,
          subject: input.channel === 'email' ? (input.subject ?? null) : null,
          body: input.body,
          isActive: input.isActive !== false,
        } as any);
        return {
          template: {
            id: upserted.id,
            notificationType: upserted.notificationType,
            channel: upserted.channel,
            isActive: upserted.isActive,
          },
        };
      },
    ),
  );

  server.tool(
    'update_notification_template',
    "Customize the email or SMS template for an automated patient notification (appointment reminders, confirmations, cancellations) for this practice. Supports {{variable}} substitution at send time. Upserts — calling again with the same (notificationType, channel) updates the existing row.",
    {
      notificationType: z
        .enum(['appointment_reminder', 'appointment_confirmation', 'appointment_cancellation'])
        .describe('Which notification this template controls'),
      channel: z.enum(['email', 'sms']).describe('Which channel — email or sms'),
      body: z.string().describe('Template body. {{variable}} placeholders are substituted at send time.'),
      subject: z.string().optional().describe('Email subject line. Ignored for SMS.'),
      isActive: z.boolean().optional().describe('Default true. Set false to fall back to the default template without losing your custom body.'),
    },
    (input) => updateNotificationTemplate(input, context),
  );

  // ── list_notification_templates ──────────────────────────────────────
  const listNotificationTemplates = withAudit(
    'list_notification_templates',
    'notification_template',
    false,
    async () => {
      const templates = await storage.getNotificationTemplates(context.practiceId);
      return {
        count: templates.length,
        templates: templates.map((t: any) => ({
          id: t.id,
          notificationType: t.notificationType,
          channel: t.channel,
          subject: t.subject,
          body: t.body,
          isActive: t.isActive,
          updatedAt: t.updatedAt,
        })),
      };
    },
  );

  server.tool(
    'list_notification_templates',
    'List all custom notification templates configured for this practice. Returns notification type, channel, subject (for email), body, and active flag.',
    {},
    (input) => listNotificationTemplates(input as any, context),
  );
}

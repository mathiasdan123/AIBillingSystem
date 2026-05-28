/**
 * Renders practice-customizable notification templates with simple
 * {{variable}} substitution, falling back to a caller-supplied default
 * when no active custom template exists for the (practice, type, channel).
 *
 * Variables available per notification_type:
 *
 *   appointment_reminder:
 *     patientName, appointmentDate, appointmentTime, practiceName,
 *     practicePhone, providerName
 *
 *   appointment_confirmation:
 *     patientName, appointmentDate, appointmentTime, practiceName
 *
 *   appointment_cancellation:
 *     patientName, appointmentDate, appointmentTime, practiceName,
 *     practicePhone
 *
 * Anything else is ignored silently — the template either uses it or doesn't.
 */

import { storage } from '../storage';

export type NotificationChannel = 'email' | 'sms';
export type NotificationType =
  | 'appointment_reminder'
  | 'appointment_confirmation'
  | 'appointment_cancellation';

export interface RenderedNotification {
  subject?: string;
  body: string;
  /** True if a custom practice template was used; false if the default was. */
  customTemplateUsed: boolean;
}

function substitute(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/**
 * Render a notification using the practice's custom template if active,
 * otherwise the supplied default. Variables are interpolated either way.
 */
export async function renderNotification(opts: {
  practiceId: number;
  type: NotificationType;
  channel: NotificationChannel;
  defaultSubject?: string;
  defaultBody: string;
  variables: Record<string, string | undefined>;
}): Promise<RenderedNotification> {
  const custom = await storage
    .getNotificationTemplate(opts.practiceId, opts.type, opts.channel)
    .catch(() => undefined);

  if (custom && custom.isActive && custom.body) {
    return {
      subject: custom.subject
        ? substitute(custom.subject, opts.variables)
        : opts.defaultSubject
          ? substitute(opts.defaultSubject, opts.variables)
          : undefined,
      body: substitute(custom.body, opts.variables),
      customTemplateUsed: true,
    };
  }

  return {
    subject: opts.defaultSubject ? substitute(opts.defaultSubject, opts.variables) : undefined,
    body: substitute(opts.defaultBody, opts.variables),
    customTemplateUsed: false,
  };
}

/** Exported for tests only. */
export const __test_substitute = substitute;

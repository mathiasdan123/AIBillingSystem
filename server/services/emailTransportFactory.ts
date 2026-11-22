/**
 * Shared email transport factory for server/email.ts and
 * server/services/emailService.ts - two independent nodemailer-based email
 * modules that both built their own transporter the same way.
 *
 * Set EMAIL_PROVIDER=aws to send via Amazon SES instead of raw SMTP - HIPAA-
 * eligible under the AWS BAA this practice already has, using the ECS task
 * role's credentials (no SMTP_USER/SMTP_PASS needed). Defaults to SMTP so
 * behavior is unchanged until explicitly opted in - same cutover pattern as
 * AI_PROVIDER / VOICE_PROVIDER / TTS_PROVIDER.
 *
 * Nodemailer has first-class SES support (`createTransport({ SES: {...} })`,
 * see https://nodemailer.com/transports/ses/), so every existing
 * `transporter.sendMail(...)` call site in both files works unchanged -
 * only transporter construction needs to branch.
 */

import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import logger from "./logger";
import { getOutboundEmailBlock } from "./notificationPreferencesService";

export function useAwsSes(): boolean {
  return (process.env.EMAIL_PROVIDER || "").toLowerCase() === "aws";
}

/**
 * True if email sending is configured and ready to use, regardless of
 * provider - SES needs no SMTP_USER/SMTP_PASS (auth is the task role),
 * raw SMTP needs both.
 */
export function isEmailTransportConfigured(): boolean {
  if (useAwsSes()) return true;
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

type Transporter = ReturnType<typeof nodemailer.createTransport>;

function toRecipientList(to: unknown): string[] {
  if (!to) return [];
  const raw = Array.isArray(to) ? to : String(to).split(",");
  return raw
    .map((r) => (typeof r === "string" ? r : (r as any)?.address ?? ""))
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Wrap a transporter so EVERY send - whichever module built the
 * transporter - drops recipients the app must not email:
 *   - addresses suppressed after an SES hard bounce / complaint
 *     (notification_preferences.email_enabled = false, written by
 *     server/routes/sesNotifications.ts), and
 *   - patients of the isolated demo practice (practices.is_demo), whose
 *     seeded addresses are fake or belong to strangers.
 *
 * Why here and not in emailService.sendEmail: three modules send mail
 * (emailService.ts, email.ts, and ten route-level transporters), and
 * before 2026-11-04 the suppression flag was written by the webhook but
 * read by NOTHING - sendEmailWithPreferenceCheck had zero callers. While
 * the SES account was sandboxed that gap was masked (only verified
 * recipients could receive mail at all); once SES granted production
 * access it became a live deliverability and complaint-rate problem.
 * Putting the check at transporter construction covers all three paths
 * with one implementation.
 *
 * Fails OPEN on lookup errors: a database hiccup must not silently stop
 * password resets and appointment reminders for everyone.
 */
function withOutboundGuard(real: Transporter): Transporter {
  const guarded = Object.create(real) as Transporter;
  guarded.sendMail = (async (mailOptions: any, callback?: any) => {
    const recipients = toRecipientList(mailOptions?.to);
    const allowed: string[] = [];
    const blocked: Array<{ reason: string }> = [];
    for (const address of recipients) {
      let block: { blocked: boolean; reason?: string } = { blocked: false };
      try {
        block = await getOutboundEmailBlock(address);
      } catch (error) {
        logger.warn("Outbound email guard lookup failed; sending anyway", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (block.blocked) blocked.push({ reason: block.reason ?? "unknown" });
      else allowed.push(address);
    }

    if (blocked.length > 0) {
      logger.warn("Outbound email: recipient(s) dropped by guard", {
        subject: mailOptions?.subject,
        dropped: blocked.length,
        reasons: blocked.map((b) => b.reason),
        remaining: allowed.length,
      });
    }

    if (recipients.length > 0 && allowed.length === 0) {
      // Nothing left to send. Mimic nodemailer's resolved shape so callers
      // that read `info.messageId`/`accepted` don't crash; `rejected` makes
      // the outcome visible to anyone who looks.
      const info = { messageId: null, accepted: [], rejected: recipients, response: "suppressed" };
      if (typeof callback === "function") callback(null, info);
      return info;
    }

    const options = allowed.length === recipients.length
      ? mailOptions
      : { ...mailOptions, to: allowed };
    // Preserve the exact call shape callers used (promise vs callback style).
    return typeof callback === "function"
      ? real.sendMail(options, callback)
      : real.sendMail(options);
  }) as Transporter["sendMail"];
  return guarded;
}

export function createEmailTransporter(
  smtpConfig: SMTPTransport.Options
): Transporter {
  if (useAwsSes()) {
    return withOutboundGuard(nodemailer.createTransport({
      SES: {
        sesClient: new SESv2Client({ region: process.env.AWS_REGION || "us-east-1" }),
        SendEmailCommand,
      },
    } as any));
  }
  return withOutboundGuard(nodemailer.createTransport(smtpConfig));
}

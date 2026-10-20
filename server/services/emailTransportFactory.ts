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

export function createEmailTransporter(
  smtpConfig: SMTPTransport.Options
): ReturnType<typeof nodemailer.createTransport> {
  if (useAwsSes()) {
    return nodemailer.createTransport({
      SES: {
        sesClient: new SESv2Client({ region: process.env.AWS_REGION || "us-east-1" }),
        SendEmailCommand,
      },
    } as any);
  }
  return nodemailer.createTransport(smtpConfig);
}

/**
 * Centralized Email Service
 * Handles all outbound email with rate limiting, queuing, and retry logic.
 * Uses nodemailer with SMTP configuration from environment variables.
 */

import nodemailer from 'nodemailer';
import logger from './logger';
import { shouldSendNotification, type NotificationType } from './notificationPreferencesService';

// ==================== CONFIGURATION ====================

const smtpConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
};

const fromAddress = process.env.EMAIL_FROM || 'noreply@therapybill.ai';

const RATE_LIMIT_MAX = 10; // max emails per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000; // exponential backoff base

// ==================== TRANSPORTER ====================

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport(smtpConfig);
  }
  return transporter;
}

export function isSmtpConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

// ==================== RATE LIMITER ====================

const sendTimestamps: number[] = [];

function canSendNow(): boolean {
  const now = Date.now();
  // Remove timestamps outside the window
  while (sendTimestamps.length > 0 && sendTimestamps[0] <= now - RATE_LIMIT_WINDOW_MS) {
    sendTimestamps.shift();
  }
  return sendTimestamps.length < RATE_LIMIT_MAX;
}

function recordSend(): void {
  sendTimestamps.push(Date.now());
}

function msUntilNextSlot(): number {
  if (sendTimestamps.length < RATE_LIMIT_MAX) return 0;
  const oldest = sendTimestamps[0];
  return Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - Date.now());
}

// ==================== QUEUE ====================

interface QueuedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  replyTo?: string;
  retries: number;
  resolve: (result: SendResult) => void;
}

const emailQueue: QueuedEmail[] = [];
let processingQueue = false;

async function processQueue(): Promise<void> {
  if (processingQueue) return;
  processingQueue = true;

  try {
    while (emailQueue.length > 0) {
      if (!canSendNow()) {
        const waitMs = msUntilNextSlot();
        logger.info(`Email rate limit reached, waiting ${waitMs}ms before next send`);
        await sleep(waitMs + 50); // small buffer
        continue;
      }

      const item = emailQueue.shift();
      if (!item) break;

      const result = await attemptSend(item);
      item.resolve(result);
    }
  } finally {
    processingQueue = false;
  }
}

async function attemptSend(item: QueuedEmail): Promise<SendResult> {
  const transport = getTransporter();
  const from = item.fromName
    ? `"${item.fromName}" <${fromAddress}>`
    : `"TherapyBill AI" <${fromAddress}>`;

  for (let attempt = 0; attempt <= item.retries; attempt++) {
    try {
      await transport.sendMail({
        from,
        to: item.to,
        subject: item.subject,
        html: item.html,
        text: item.text,
        replyTo: item.replyTo,
      });

      recordSend();
      logger.info('Email sent successfully', { to: '[REDACTED]', subject: item.subject });
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isTransient = isTransientError(errMsg);

      if (isTransient && attempt < item.retries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`Transient email error, retrying in ${delay}ms (attempt ${attempt + 1}/${item.retries})`, {
          subject: item.subject,
          error: errMsg,
        });
        await sleep(delay);
        continue;
      }

      logger.error('Failed to send email', { subject: item.subject, error: errMsg, attempt });
      return { success: false, error: errMsg };
    }
  }

  return { success: false, error: 'Max retries exceeded' };
}

function isTransientError(message: string): boolean {
  const transientPatterns = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ESOCKET',
    'rate limit',
    'try again',
    'temporarily',
    '421',
    '450',
    '451',
    '452',
  ];
  const lower = message.toLowerCase();
  return transientPatterns.some(p => lower.includes(p.toLowerCase()));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== PUBLIC API ====================

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  replyTo?: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
}

/**
 * Send an email. If SMTP is not configured, logs a warning and returns a no-op result.
 * Emails are queued and rate-limited (max 10/minute).
 * Transient failures are retried up to 3 times with exponential backoff.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendResult> {
  if (!isSmtpConfigured()) {
    logger.info('SMTP not configured, email would have been sent', {
      subject: params.subject,
    });
    return { success: false, error: 'SMTP not configured' };
  }

  return new Promise<SendResult>((resolve) => {
    emailQueue.push({
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      fromName: params.fromName,
      replyTo: params.replyTo,
      retries: MAX_RETRIES,
      resolve,
    });

    // Kick off queue processing (non-blocking if already running)
    processQueue();
  });
}

/**
 * Send an email immediately, bypassing the queue.
 * Still respects SMTP configuration check but skips rate limiting.
 * Use sparingly - primarily for time-critical transactional emails.
 */
export async function sendEmailImmediate(params: SendEmailParams): Promise<SendResult> {
  if (!isSmtpConfigured()) {
    logger.info('SMTP not configured, email would have been sent', {
      subject: params.subject,
    });
    return { success: false, error: 'SMTP not configured' };
  }

  return attemptSend({
    ...params,
    retries: MAX_RETRIES,
    resolve: () => {},
  });
}

/**
 * Send an email with notification preference checking.
 * If patientId and notificationType are provided, checks preferences first.
 */
export async function sendEmailWithPreferenceCheck(
  params: SendEmailParams,
  patientId?: number,
  notificationType?: NotificationType,
): Promise<SendResult> {
  if (patientId && notificationType) {
    const prefResult = await shouldSendNotification(patientId, notificationType);
    if (!prefResult.channels.email) {
      logger.info('Email skipped due to notification preference', {
        subject: params.subject,
        notificationType,
      });
      return { success: true };
    }
    if (prefResult.inQuietHours) {
      logger.info('Email deferred due to quiet hours', {
        subject: params.subject,
        notificationType,
      });
      return { success: true };
    }
  }
  return sendEmail(params);
}

export default {
  sendEmail,
  sendEmailImmediate,
  sendEmailWithPreferenceCheck,
  isSmtpConfigured,
};

/**
 * Contact Form Route
 *
 * Public endpoint for the landing page contact form.
 * Sends an email to the practice owner via the email service.
 * Rate limited to prevent spam (5 per IP per hour).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sendEmail, isSmtpConfigured } from '../services/emailService';
import logger from '../services/logger';

const router = Router();

// Simple in-memory rate limiter for contact form (5 per IP per hour)
const contactRateMap = new Map<string, { count: number; resetAt: number }>();
const CONTACT_RATE_LIMIT = 5;
const CONTACT_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isContactRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = contactRateMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    contactRateMap.set(ip, { count: 1, resetAt: now + CONTACT_RATE_WINDOW_MS });
    return false;
  }

  if (entry.count >= CONTACT_RATE_LIMIT) {
    return true;
  }

  entry.count += 1;
  return false;
}

// Periodically clean up expired entries (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  contactRateMap.forEach((entry, key) => {
    if (now >= entry.resetAt) {
      contactRateMap.delete(key);
    }
  });
}, 10 * 60 * 1000);

const contactSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Valid email is required').max(200),
  message: z.string().min(1, 'Message is required').max(5000),
});

router.post('/contact', async (req: Request, res: Response) => {
  try {
    // Rate limit check
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (isContactRateLimited(clientIp)) {
      return res.status(429).json({
        success: false,
        error: 'Too many contact requests. Please try again later.',
      });
    }

    // Validate input
    const result = contactSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error.errors[0]?.message || 'Invalid input',
      });
    }

    const { name, email, message } = result.data;

    // Send email
    const emailResult = await sendEmail({
      to: 'daniel@therapybillai.com',
      subject: `TherapyBill Contact Form: ${name}`,
      replyTo: email,
      fromName: 'TherapyBill AI Contact Form',
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
        <hr>
        <p style="color: #666; font-size: 12px;">Sent from the TherapyBill AI contact form</p>
      `,
      text: `New Contact Form Submission\n\nName: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
    });

    if (!emailResult.success && isSmtpConfigured()) {
      logger.error('Contact form email failed', { error: emailResult.error, name, email });
      return res.status(500).json({
        success: false,
        error: 'Failed to send message. Please try again or email us directly at daniel@therapybillai.com.',
      });
    }

    // Log the contact form submission (even if SMTP is not configured, we log it)
    logger.info('Contact form submission', { name, email, smtpConfigured: isSmtpConfigured() });

    return res.json({ success: true });
  } catch (error) {
    logger.error('Contact form error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred. Please try again.',
    });
  }
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default router;

/**
 * Notification & Reminder Routes
 *
 * Handles:
 * - /api/reminders/status - Reminder configuration status
 * - /api/reminders/upcoming - Upcoming appointments needing reminders
 * - /api/reminders/trigger - Manually trigger reminders
 * - /api/reminders/test - Send test reminder
 * - /api/reports/denied-claims - Denied claims report
 * - /api/reports/denied-claims/export - Export denied claims CSV
 * - /api/reports/email-settings - Email settings CRUD
 * - /api/reports/send-test-email - Send test email
 * - /api/reports/send-report-now - Send report immediately
 * - /api/reports/weekly-cancellation - Trigger weekly cancellation report
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import { isEmailConfigured, sendTestEmail, sendDeniedClaimsReport, type DeniedClaimsReportInput } from '../email';
import { setDailyReportRecipients, getDailyReportRecipients, generateAndSendWeeklyCancellationReport } from '../scheduler';
import { exportLimiter } from '../middleware/rate-limiter';

const router = Router();

const isAdminOrBilling = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || (user.role !== 'admin' && user.role !== 'billing')) {
      return res.status(403).json({ message: "Access denied. Admin or billing role required." });
    }
    next();
  } catch (error) {
    logger.error("Error checking user role", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) return userPracticeId;
  return requestedPracticeId || userPracticeId;
};

// Helper for date range calculation
const getDateRange = (period: string, customStartDate?: string, customEndDate?: string) => {
  let startDate: Date;
  let endDate: Date = new Date();
  endDate.setHours(23, 59, 59, 999);

  switch (period) {
    case 'today':
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'month':
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'custom':
      if (!customStartDate || !customEndDate) throw new Error('Custom date range requires startDate and endDate');
      startDate = new Date(customStartDate);
      endDate = new Date(customEndDate);
      endDate.setHours(23, 59, 59, 999);
      break;
    default:
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
  }
  return { startDate, endDate };
};

// ==================== APPOINTMENT REMINDERS ====================

router.get('/reminders/status', isAuthenticated, async (req: any, res) => {
  try {
    const { getReminderStatus } = await import('../services/appointmentReminderService');
    const status = getReminderStatus();
    res.json(status);
  } catch (error) {
    logger.error('Error getting reminder status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get reminder status' });
  }
});

router.get('/reminders/upcoming', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const hours = parseInt(req.query.hours as string) || 48;
    const appointments = await storage.getUpcomingAppointments(practiceId, hours);
    res.json(appointments);
  } catch (error) {
    logger.error('Error fetching upcoming appointments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch upcoming appointments' });
  }
});

router.post('/reminders/trigger', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const { processAppointmentReminders } = await import('../services/appointmentReminderService');
    const practiceId = getAuthorizedPracticeId(req);
    const hoursBeforeAppointment = parseInt(req.body.hours as string) || 24;
    const results = await processAppointmentReminders(practiceId, hoursBeforeAppointment);
    res.json({ message: `Processed ${results.length} appointment reminders`, results });
  } catch (error) {
    logger.error('Error triggering reminders', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to trigger reminders' });
  }
});

router.post('/reminders/test', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const { email, phone, patientName, practiceName } = req.body;
    const results: { emailSent?: boolean; smsSent?: boolean; errors: string[] } = { errors: [] };

    if (email) {
      const { isEmailConfigured } = await import('../email');
      if (isEmailConfigured()) {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' },
        });

        try {
          await transporter.sendMail({
            from: `"${practiceName || 'Test Practice'}" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
            to: email,
            subject: 'Test Appointment Reminder',
            text: `This is a test reminder from ${practiceName || 'Your Practice'}. If you received this, email reminders are working!`,
          });
          results.emailSent = true;
        } catch (err) {
          results.errors.push(`Email failed: ${(err as Error).message}`);
        }
      } else {
        results.errors.push('Email not configured');
      }
    }

    if (phone) {
      const { sendSMS, isSMSConfigured } = await import('../services/smsService');
      if (isSMSConfigured()) {
        const smsResult = await sendSMS(phone, `Test reminder from ${practiceName || 'Your Practice'}. If you received this, SMS reminders are working!`);
        results.smsSent = smsResult.success;
        if (!smsResult.success) results.errors.push(`SMS failed: ${smsResult.error}`);
      } else {
        results.errors.push('SMS not configured (Twilio credentials missing)');
      }
    }

    res.json(results);
  } catch (error) {
    logger.error('Error sending test reminder', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to send test reminder' });
  }
});

// ==================== DENIED CLAIMS REPORTS ====================

router.get('/reports/denied-claims', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const period = req.query.period || 'today';
    const { startDate, endDate } = getDateRange(period, req.query.startDate, req.query.endDate);

    const deniedClaimsWithDetails = await storage.getDeniedClaimsWithDetails(practiceId, startDate, endDate);
    const denialReasons = await storage.getTopDenialReasons(practiceId);

    const totalAmount = deniedClaimsWithDetails.reduce((sum, item) => sum + parseFloat(item.claim.totalAmount || '0'), 0);
    const appealsGenerated = deniedClaimsWithDetails.filter(item => item.appeal !== null).length;
    const appealsSent = deniedClaimsWithDetails.filter(item => item.appeal && item.appeal.status === 'sent').length;
    const appealsWon = deniedClaimsWithDetails.filter(item => item.appeal && item.appeal.status === 'completed').length;

    res.json({
      period, startDate: startDate.toISOString(), endDate: endDate.toISOString(),
      summary: { totalDenied: deniedClaimsWithDetails.length, totalAmountAtRisk: totalAmount, appealsGenerated, appealsSent, appealsWon },
      topDenialReasons: denialReasons,
      claims: deniedClaimsWithDetails.map(item => ({
        id: item.claim.id, claimNumber: item.claim.claimNumber,
        patientName: item.patient ? `${item.patient.firstName} ${item.patient.lastName}` : 'Unknown',
        patientId: item.claim.patientId, amount: item.claim.totalAmount,
        denialReason: item.claim.denialReason, deniedAt: item.claim.updatedAt,
        appealStatus: item.appeal?.status || 'none', appealId: item.appeal?.id || null,
      })),
    });
  } catch (error) {
    logger.error('Error fetching denied claims report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch denied claims report' });
  }
});

router.get('/reports/denied-claims/export', exportLimiter, isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const period = req.query.period || 'month';
    const { startDate, endDate } = getDateRange(period, req.query.startDate, req.query.endDate);

    const deniedClaimsWithDetails = await storage.getDeniedClaimsWithDetails(practiceId, startDate, endDate);

    const csvHeader = 'Claim Number,Patient Name,Amount,Denial Reason,Denied Date,Appeal Status\n';
    const csvRows = deniedClaimsWithDetails.map(item => {
      const patientName = item.patient ? `${item.patient.firstName} ${item.patient.lastName}` : 'Unknown';
      const amount = item.claim.totalAmount || '0';
      const denialReason = (item.claim.denialReason || 'Unknown').replace(/,/g, ';').replace(/\n/g, ' ');
      const deniedAt = item.claim.updatedAt ? new Date(item.claim.updatedAt).toLocaleDateString() : '';
      const appealStatus = item.appeal?.status || 'none';
      return `${item.claim.claimNumber},"${patientName}",${amount},"${denialReason}",${deniedAt},${appealStatus}`;
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="denied-claims-${period}-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvHeader + csvRows);
  } catch (error) {
    logger.error('Error exporting denied claims report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to export denied claims report' });
  }
});

// ==================== EMAIL SETTINGS ====================

router.get('/reports/email-settings', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    res.json({ configured: isEmailConfigured(), recipients: getDailyReportRecipients() });
  } catch (error) {
    logger.error('Error fetching email settings', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch email settings' });
  }
});

router.post('/reports/email-settings', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const { recipients } = req.body;
    if (!Array.isArray(recipients)) return res.status(400).json({ message: 'Recipients must be an array of email addresses' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = recipients.filter((email: string) => !emailRegex.test(email));
    if (invalidEmails.length > 0) return res.status(400).json({ message: `Invalid email addresses: ${invalidEmails.join(', ')}` });

    setDailyReportRecipients(recipients);
    res.json({ message: 'Email settings updated successfully', recipients: getDailyReportRecipients() });
  } catch (error) {
    logger.error('Error updating email settings', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update email settings' });
  }
});

router.post('/reports/send-test-email', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email address is required' });
    const result = await sendTestEmail(email);
    if (result.success) {
      res.json({ message: 'Test email sent successfully' });
    } else {
      res.status(500).json({ message: result.error || 'Failed to send test email' });
    }
  } catch (error) {
    logger.error('Error sending test email', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to send test email' });
  }
});

router.post('/reports/send-report-now', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { period = 'today', email } = req.body;
    const { startDate, endDate } = getDateRange(period);

    const deniedClaimsWithDetails = await storage.getDeniedClaimsWithDetails(practiceId, startDate, endDate);
    const denialReasons = await storage.getTopDenialReasons(practiceId);
    const practice = await storage.getPractice(practiceId);

    const totalAmount = deniedClaimsWithDetails.reduce((sum, item) => sum + parseFloat(item.claim.totalAmount || '0'), 0);
    const appealsGenerated = deniedClaimsWithDetails.filter(item => item.appeal !== null).length;
    const appealsSent = deniedClaimsWithDetails.filter(item => item.appeal && item.appeal.status === 'sent').length;
    const appealsWon = deniedClaimsWithDetails.filter(item => item.appeal && item.appeal.status === 'completed').length;

    const reportData: DeniedClaimsReportInput = {
      practiceName: practice?.name || 'Your Practice',
      reportDate: new Date(),
      period: period === 'today' ? 'Today' : period === 'week' ? 'Last 7 Days' : 'Last 30 Days',
      summary: { totalDenied: deniedClaimsWithDetails.length, totalAmountAtRisk: totalAmount, appealsGenerated, appealsSent, appealsWon },
      topDenialReasons: denialReasons,
      claims: deniedClaimsWithDetails.map(item => ({
        claimNumber: item.claim.claimNumber || 'Unknown',
        patientName: item.patient ? `${item.patient.firstName} ${item.patient.lastName}` : 'Unknown',
        amount: item.claim.totalAmount || '0',
        denialReason: item.claim.denialReason,
        deniedAt: item.claim.updatedAt,
        appealStatus: item.appeal?.status || 'none',
      })),
      reportUrl: process.env.APP_URL ? `${process.env.APP_URL}/reports` : undefined,
    };

    const recipients = email ? [email] : getDailyReportRecipients();
    if (recipients.length === 0) return res.status(400).json({ message: 'No email recipients configured' });

    const result = await sendDeniedClaimsReport(recipients, reportData);
    if (result.success) {
      res.json({ message: `Report sent successfully to ${recipients.join(', ')}` });
    } else {
      res.status(500).json({ message: result.error || 'Failed to send report' });
    }
  } catch (error) {
    logger.error('Error sending report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to send report' });
  }
});

router.post('/reports/weekly-cancellation', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    await generateAndSendWeeklyCancellationReport(practiceId);
    res.json({ message: 'Weekly cancellation report triggered successfully' });
  } catch (error) {
    logger.error('Error triggering weekly cancellation report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to trigger weekly cancellation report' });
  }
});

export default router;

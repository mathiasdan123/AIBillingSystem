import cron from 'node-cron';
import { storage } from './storage';
import { sendDeniedClaimsReport, isEmailConfigured, type DeniedClaimsReportInput } from './email';

// Store scheduled tasks for management
const scheduledTasks: Map<string, cron.ScheduledTask> = new Map();

// Email recipients for daily reports (could be stored in DB per practice)
let dailyReportRecipients: string[] = [];

export function setDailyReportRecipients(emails: string[]) {
  dailyReportRecipients = emails;
  console.log('Daily report recipients updated:', emails);
}

export function getDailyReportRecipients(): string[] {
  return dailyReportRecipients;
}

async function generateAndSendDailyDeniedClaimsReport(practiceId: number = 1) {
  console.log('Running daily denied claims report for practice:', practiceId);

  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping daily report');
    return;
  }

  if (dailyReportRecipients.length === 0) {
    console.log('No recipients configured for daily report');
    return;
  }

  try {
    // Get yesterday's denied claims
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 1);

    const deniedClaimsWithDetails = await storage.getDeniedClaimsWithDetails(
      practiceId,
      startDate,
      endDate
    );
    const denialReasons = await storage.getTopDenialReasons(practiceId);
    const practice = await storage.getPractice(practiceId);

    // Calculate summary
    const totalAmount = deniedClaimsWithDetails.reduce(
      (sum, item) => sum + parseFloat(item.claim.totalAmount || '0'),
      0
    );
    const appealsGenerated = deniedClaimsWithDetails.filter(
      (item) => item.appeal !== null
    ).length;
    const appealsSent = deniedClaimsWithDetails.filter(
      (item) => item.appeal && item.appeal.status === 'sent'
    ).length;
    const appealsWon = deniedClaimsWithDetails.filter(
      (item) => item.appeal && item.appeal.status === 'completed'
    ).length;

    const reportData: DeniedClaimsReportInput = {
      practiceName: practice?.name || 'Your Practice',
      reportDate: new Date(),
      period: 'Yesterday',
      summary: {
        totalDenied: deniedClaimsWithDetails.length,
        totalAmountAtRisk: totalAmount,
        appealsGenerated,
        appealsSent,
        appealsWon,
      },
      topDenialReasons: denialReasons,
      claims: deniedClaimsWithDetails.map((item) => ({
        claimNumber: item.claim.claimNumber || 'Unknown',
        patientName: item.patient
          ? `${item.patient.firstName} ${item.patient.lastName}`
          : 'Unknown',
        amount: item.claim.totalAmount || '0',
        denialReason: item.claim.denialReason,
        deniedAt: item.claim.updatedAt,
        appealStatus: item.appeal?.status || 'none',
      })),
      reportUrl: process.env.APP_URL ? `${process.env.APP_URL}/reports` : undefined,
    };

    const result = await sendDeniedClaimsReport(dailyReportRecipients, reportData);

    if (result.success) {
      console.log('Daily denied claims report sent successfully');
    } else {
      console.error('Failed to send daily denied claims report:', result.error);
    }
  } catch (error) {
    console.error('Error generating daily denied claims report:', error);
  }
}

export function startScheduler() {
  // Schedule daily report at 8:00 AM
  // Cron format: minute hour day-of-month month day-of-week
  const dailyReportTask = cron.schedule('0 8 * * *', () => {
    generateAndSendDailyDeniedClaimsReport();
  }, {
    timezone: process.env.TIMEZONE || 'America/New_York',
  });

  scheduledTasks.set('dailyDeniedClaimsReport', dailyReportTask);
  console.log('Scheduler started: Daily denied claims report scheduled for 8:00 AM');
}

export function stopScheduler() {
  scheduledTasks.forEach((task, name) => {
    task.stop();
    console.log(`Stopped scheduled task: ${name}`);
  });
  scheduledTasks.clear();
}

// Manual trigger for testing
export async function triggerDailyReportNow(practiceId: number = 1) {
  console.log('Manually triggering daily denied claims report');
  await generateAndSendDailyDeniedClaimsReport(practiceId);
}

// Export for route handlers
export { generateAndSendDailyDeniedClaimsReport };

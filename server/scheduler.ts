import cron from 'node-cron';
import { storage } from './storage';
import { sendDeniedClaimsReport, isEmailConfigured, type DeniedClaimsReportInput } from './email';
import logger from './services/logger';

// Store scheduled tasks for management
const scheduledTasks: Map<string, ReturnType<typeof cron.schedule>> = new Map();

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

  // BAA expiration check - daily at 9:00 AM
  const baaExpirationTask = cron.schedule('0 9 * * *', async () => {
    try {
      const expiringRecords = await storage.getExpiringBaaRecords(30);
      if (expiringRecords.length > 0) {
        logger.warn('BAA records expiring within 30 days', {
          count: expiringRecords.length,
          vendors: expiringRecords.map(r => r.vendorName),
        });
        // TODO: Send email notification to admin about expiring BAAs
      }
    } catch (error: any) {
      logger.error('BAA expiration check failed', { error: error.message });
    }
  }, {
    timezone: process.env.TIMEZONE || 'America/New_York',
  });
  scheduledTasks.set('baaExpirationCheck', baaExpirationTask);

  // Automated eligibility refresh - daily at 2:00 AM
  const eligibilityRefreshTask = cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('Starting automated eligibility refresh');
      const stalePatients = await storage.getPatientsWithStaleEligibility(7);
      logger.info('Found patients with stale eligibility', { count: stalePatients.length });

      for (const patient of stalePatients) {
        try {
          // Get Stedi credentials
          const practiceId = patient.practiceId;
          const cred = await storage.getPayerCredentials(practiceId, 'stedi');
          if (!cred || !cred.apiKey) continue;

          const { decryptField } = await import('./services/phiEncryptionService');
          const apiKey = decryptField(cred.apiKey);
          if (!apiKey) continue;

          const practice = await storage.getPractice(practiceId);
          if (!practice) continue;

          const { StediAdapter } = await import('./payer-integrations/adapters/payers/StediAdapter');
          const adapter = new StediAdapter(apiKey);
          const result = await adapter.checkEligibility({
            providerNpi: practice.npi || '',
            providerName: practice.name,
            memberFirstName: patient.firstName,
            memberLastName: patient.lastName,
            memberDob: patient.dateOfBirth || '',
            memberId: patient.insuranceId || '',
            groupNumber: patient.groupNumber || undefined,
            payerName: patient.insuranceProvider || '',
          });

          // Compare with cached data for coverage change detection
          const previousCache = await storage.getCachedInsuranceData(patient.id);
          const previousStatus = (previousCache?.eligibilityData as any)?.status;
          const newStatus = result.eligibility.status;

          if (previousStatus && previousStatus !== newStatus) {
            logger.warn('Coverage change detected', {
              patientId: patient.id,
              previousStatus,
              newStatus,
            });
            // TODO: Send alert to therapist about coverage change
          }

          // Cache the new result
          await storage.cacheInsuranceData({
            patientId: patient.id,
            practiceId,
            payerName: patient.insuranceProvider || null,
            eligibilityData: result.eligibility as any,
            benefitsData: result.benefits as any,
            rawResponse: result.raw,
            status: 'valid',
            verifiedAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          });

          logger.info('Eligibility refreshed for patient', { patientId: patient.id });
        } catch (err: any) {
          logger.error('Failed to refresh eligibility for patient', {
            patientId: patient.id,
            error: err.message,
          });
        }
      }
    } catch (error: any) {
      logger.error('Automated eligibility refresh failed', { error: error.message });
    }
  }, {
    timezone: process.env.TIMEZONE || 'America/New_York',
  });
  scheduledTasks.set('eligibilityRefresh', eligibilityRefreshTask);

  logger.info('Scheduler started', {
    tasks: ['dailyDeniedClaimsReport', 'baaExpirationCheck', 'eligibilityRefresh'],
  });
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

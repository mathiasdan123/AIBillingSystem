import cron from 'node-cron';
import { storage } from './storage';
import { sendDeniedClaimsReport, isEmailConfigured, type DeniedClaimsReportInput, sendWeeklyCancellationReport, type WeeklyCancellationReportInput, sendBaaExpirationAlert, sendCoverageChangeAlert, sendBreachNotificationAlert, sendAmendmentDeadlineAlert } from './email';
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

async function generateAndSendWeeklyCancellationReport(practiceId: number = 1) {
  console.log('Running weekly cancellation report for practice:', practiceId);

  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping weekly cancellation report');
    return;
  }

  if (dailyReportRecipients.length === 0) {
    console.log('No recipients configured for weekly cancellation report');
    return;
  }

  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);

    const practice = await storage.getPractice(practiceId);
    const stats = await storage.getCancellationStats(practiceId, start, end);
    const byPatient = await storage.getCancellationsByPatient(practiceId, start, end);

    // Get cancelled appointments for reason/cancelledBy breakdown
    const appts = await storage.getAppointmentsByDateRange(practiceId, start, end);
    const cancelled = appts.filter((a: any) => a.status === 'cancelled');

    // Group by reason
    const reasonMap: Record<string, number> = {};
    for (const a of cancelled) {
      const reason = (a as any).cancellationReason || 'unknown';
      reasonMap[reason] = (reasonMap[reason] || 0) + 1;
    }
    const byReason = Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // Group by cancelledBy
    const byMap: Record<string, number> = {};
    for (const a of cancelled) {
      const who = (a as any).cancelledBy || 'unknown';
      byMap[who] = (byMap[who] || 0) + 1;
    }
    const byCancelledBy = Object.entries(byMap)
      .map(([who, count]) => ({ who, count }))
      .sort((a, b) => b.count - a.count);

    // Repeat cancellers (2+ cancellations)
    const repeatCancellers = byPatient
      .filter(p => p.cancellations >= 2)
      .map(p => ({ patientName: p.patientName, cancellations: p.cancellations, noShows: p.noShows }));

    const reportData: WeeklyCancellationReportInput = {
      practiceName: practice?.name || 'Your Practice',
      reportDate: new Date(),
      totalCancellations: stats.totalCancelled,
      totalScheduled: stats.totalScheduled,
      cancellationRate: stats.cancellationRate,
      lateCancellations: stats.lateCancellations,
      byReason,
      byCancelledBy,
      repeatCancellers,
      reportUrl: process.env.APP_URL ? `${process.env.APP_URL}/calendar` : undefined,
    };

    const result = await sendWeeklyCancellationReport(dailyReportRecipients, reportData);
    if (result.success) {
      console.log('Weekly cancellation report sent successfully');
    } else {
      console.error('Failed to send weekly cancellation report:', result.error);
    }
  } catch (error) {
    console.error('Error generating weekly cancellation report:', error);
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

        // Group expiring records by practiceId and send alerts
        const byPractice: Record<number, typeof expiringRecords> = {};
        for (const record of expiringRecords) {
          const pid = record.practiceId;
          if (!byPractice[pid]) byPractice[pid] = [];
          byPractice[pid].push(record);
        }

        for (const [practiceIdStr, records] of Object.entries(byPractice)) {
          const practiceId = Number(practiceIdStr);
          const admins = await storage.getAdminsByPractice(practiceId);
          if (admins.length === 0) continue;

          const practice = await storage.getPractice(practiceId);
          const emails = admins.map(a => a.email);
          const now = new Date();

          await sendBaaExpirationAlert(emails, {
            practiceName: practice?.name || 'Your Practice',
            records: records.map(r => ({
              vendorName: r.vendorName,
              baaType: r.vendorType || 'Standard',
              expirationDate: r.expirationDate || 'Unknown',
              daysRemaining: r.expirationDate
                ? Math.max(0, Math.ceil((new Date(r.expirationDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
                : 0,
            })),
          });

          logger.info('BAA expiration alert sent', { practiceId, adminCount: admins.length, recordCount: records.length });
        }
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
          const previousStatus = (previousCache?.rawResponse as any)?.status;
          const newStatus = result.eligibility.isEligible ? 'active' : 'inactive';

          if (previousStatus && previousStatus !== newStatus) {
            logger.warn('Coverage change detected', {
              patientId: patient.id,
              previousStatus,
              newStatus,
            });

            // Send coverage change alert to practice admins
            const admins = await storage.getAdminsByPractice(patient.practiceId);
            if (admins.length > 0) {
              const practiceName = practice?.name || 'Your Practice';
              const patientName = `${patient.firstName} ${patient.lastName}`;
              let recommendedAction = 'Review the patient\'s insurance information and update records accordingly.';
              if (newStatus === 'inactive') {
                recommendedAction = 'Coverage has been terminated. Contact the patient to obtain updated insurance information before the next session. Consider pausing scheduled appointments until coverage is confirmed.';
              } else if (newStatus === 'active' && previousStatus === 'inactive') {
                recommendedAction = 'Coverage has been reinstated. Verify benefits and any changes to copay, deductible, or authorized visits before the next session.';
              }

              await sendCoverageChangeAlert(admins.map(a => a.email), {
                practiceName,
                patientName,
                previousStatus,
                newStatus,
                recommendedAction,
              });

              logger.info('Coverage change alert sent', { patientId: patient.id, practiceId: patient.practiceId });
            }
          }

          // Cache the new result
          const auth = await storage.getPatientInsuranceAuth(patient.id);
          await storage.cacheInsuranceData({
            patientId: patient.id,
            practiceId,
            authorizationId: auth?.id || 0,
            dataType: 'eligibility',
            normalizedData: result.eligibility as any,
            rawResponse: result.raw,
            status: 'success',
            fetchedAt: new Date(),
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

  // Weekly cancellation report - Monday 8:00 AM
  const weeklyCancellationTask = cron.schedule('0 8 * * 1', () => {
    generateAndSendWeeklyCancellationReport();
  }, {
    timezone: process.env.TIMEZONE || 'America/New_York',
  });
  scheduledTasks.set('weeklyCancellationReport', weeklyCancellationTask);

  // Hard deletion of expired soft-deleted patients - daily at 3:00 AM
  const hardDeletionTask = cron.schedule('0 3 * * *', async () => {
    try {
      logger.info('Starting hard deletion of expired soft-deleted patients');
      const retentionDays = 365;
      const expiredPatients = await storage.getExpiredSoftDeletedPatients(retentionDays);
      logger.info('Found expired soft-deleted patients', { count: expiredPatients.length });

      for (const patient of expiredPatients) {
        try {
          await storage.hardDeletePatient(patient.id);
          await storage.createAuditLog({
            userId: 'system',
            eventType: 'delete',
            eventCategory: 'data_retention',
            resourceType: 'patient',
            resourceId: patient.id.toString(),
            details: { reason: `Retention period of ${retentionDays} days exceeded`, deletedAt: patient.deletedAt },
            ipAddress: '0.0.0.0',
          });
          logger.info('Hard deleted patient', { patientId: patient.id });
        } catch (err: any) {
          logger.error('Failed to hard delete patient', { patientId: patient.id, error: err.message });
        }
      }

      logger.info('Hard deletion job completed', { deletedCount: expiredPatients.length });
    } catch (error: any) {
      logger.error('Hard deletion job failed', { error: error.message });
    }
  }, {
    timezone: process.env.TIMEZONE || 'America/New_York',
  });
  scheduledTasks.set('hardDeletion', hardDeletionTask);

  // Breach notification deadline check - daily at 8:30 AM
  const breachDeadlineTask = cron.schedule('30 8 * * *', async () => {
    try {
      const breaches = await storage.getBreachesRequiringNotification();
      for (const breach of breaches) {
        const daysSinceDiscovery = Math.floor(
          (Date.now() - new Date(breach.discoveredAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceDiscovery >= 50) {
          const practice = await storage.getPractice(breach.practiceId);
          const adminEmail = practice?.email;
          if (adminEmail) {
            await sendBreachNotificationAlert(adminEmail, {
              practiceName: practice?.name || 'Practice',
              breachDescription: `[DEADLINE ALERT - ${60 - daysSinceDiscovery} days remaining] ${breach.description}`,
              discoveredAt: breach.discoveredAt,
              phiInvolved: breach.phiInvolved || 'Not specified',
              remediationSteps: breach.remediationSteps || 'Not specified',
              affectedCount: breach.affectedIndividualsCount || 0,
              breachType: breach.breachType,
            });
          }
          logger.warn('Breach approaching 60-day notification deadline', {
            breachId: breach.id,
            daysSinceDiscovery,
            daysRemaining: 60 - daysSinceDiscovery,
          });
        }
      }
    } catch (error: any) {
      logger.error('Breach deadline check failed', { error: error.message });
    }
  }, {
    timezone: process.env.TIMEZONE || 'America/New_York',
  });
  scheduledTasks.set('breachDeadlineCheck', breachDeadlineTask);

  // Amendment request deadline check - daily at 8:45 AM
  const amendmentDeadlineTask = cron.schedule('45 8 * * *', async () => {
    try {
      const practices = [1];
      for (const practiceId of practices) {
        const pending = await storage.getPendingAmendmentRequests(practiceId);
        for (const request of pending) {
          const daysUntilDeadline = Math.floor(
            (new Date(request.responseDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );
          if (daysUntilDeadline <= 7 && daysUntilDeadline >= 0) {
            const practice = await storage.getPractice(practiceId);
            const patient = await storage.getPatient(request.patientId);
            const adminEmail = practice?.email;
            if (adminEmail && patient) {
              await sendAmendmentDeadlineAlert(adminEmail, {
                patientName: `${patient.firstName} ${patient.lastName}`,
                fieldToAmend: request.fieldToAmend,
                deadline: request.responseDeadline,
                daysRemaining: daysUntilDeadline,
                practiceName: practice?.name || 'Practice',
              });
            }
            logger.warn('Amendment request deadline approaching', {
              requestId: request.id,
              daysRemaining: daysUntilDeadline,
            });
          }
        }
      }
    } catch (error: any) {
      logger.error('Amendment deadline check failed', { error: error.message });
    }
  }, {
    timezone: process.env.TIMEZONE || 'America/New_York',
  });
  scheduledTasks.set('amendmentDeadlineCheck', amendmentDeadlineTask);

  logger.info('Scheduler started', {
    tasks: ['dailyDeniedClaimsReport', 'baaExpirationCheck', 'eligibilityRefresh', 'weeklyCancellationReport', 'hardDeletion', 'breachDeadlineCheck', 'amendmentDeadlineCheck'],
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

// Manual trigger for hard deletion of expired patients
export async function triggerHardDeletionNow(): Promise<{ deletedCount: number; errors: string[] }> {
  const retentionDays = 365;
  const errors: string[] = [];
  const expiredPatients = await storage.getExpiredSoftDeletedPatients(retentionDays);

  for (const patient of expiredPatients) {
    try {
      await storage.hardDeletePatient(patient.id);
      await storage.createAuditLog({
        userId: 'system-manual',
        eventType: 'delete',
        eventCategory: 'data_retention',
        resourceType: 'patient',
        resourceId: patient.id.toString(),
        details: { reason: `Manual trigger - retention period of ${retentionDays} days exceeded`, deletedAt: patient.deletedAt },
        ipAddress: '0.0.0.0',
      });
    } catch (err: any) {
      errors.push(`Patient ${patient.id}: ${err.message}`);
    }
  }

  return { deletedCount: expiredPatients.length - errors.length, errors };
}

// Export for route handlers
export { generateAndSendDailyDeniedClaimsReport, generateAndSendWeeklyCancellationReport };

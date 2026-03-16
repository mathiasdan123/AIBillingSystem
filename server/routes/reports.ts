/**
 * Reports Routes - Custom Report Builder
 *
 * Handles:
 * - POST /api/reports/generate - Generate report data based on filters/grouping
 * - GET /api/reports/saved - List saved reports
 * - POST /api/reports/saved - Save a report configuration
 * - DELETE /api/reports/saved/:id - Delete saved report
 * - GET /api/reports/saved/:id/run - Run a saved report with current data
 * - GET /api/reports/export/:format - Export report as CSV
 */

import { Router } from 'express';
import { db } from '../db';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import {
  claims,
  claimLineItems,
  patients,
  appointments,
  treatmentSessions,
  payments,
  users,
  insurances,
  cptCodes,
  savedReports,
  soapNotes,
  auditLog,
  patientConsents,
} from '@shared/schema';
import { eq, and, gte, lte, sql, count, sum, avg, desc } from 'drizzle-orm';
import logger from '../services/logger';

const router = Router();

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }

  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === 'admin') {
    return requestedPracticeId || userPracticeId || 1;
  }

  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }

  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

// Helper to parse date range from filters
const parseDateRange = (filters: any): { startDate: Date; endDate: Date } => {
  const now = new Date();
  const preset = filters?.datePreset || 'this_month';

  if (preset === 'custom' && filters?.dateRange?.start && filters?.dateRange?.end) {
    return {
      startDate: new Date(filters.dateRange.start),
      endDate: new Date(filters.dateRange.end),
    };
  }

  let startDate = new Date();
  const endDate = new Date();

  switch (preset) {
    case 'this_month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'last_month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate.setDate(0); // Last day of previous month
      break;
    case 'this_quarter': {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      startDate = new Date(now.getFullYear(), quarterMonth, 1);
      break;
    }
    case 'last_quarter': {
      const prevQuarterMonth = Math.floor(now.getMonth() / 3) * 3 - 3;
      const year = prevQuarterMonth < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const month = prevQuarterMonth < 0 ? prevQuarterMonth + 12 : prevQuarterMonth;
      startDate = new Date(year, month, 1);
      endDate.setTime(new Date(year, month + 3, 0).getTime());
      break;
    }
    case 'ytd':
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return { startDate, endDate };
};

// ==================== GENERATE REPORT ====================

router.post('/generate', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { reportType, filters, groupBy, columns } = req.body;

    if (!reportType) {
      return res.status(400).json({ message: 'Report type is required' });
    }

    const { startDate, endDate } = parseDateRange(filters);
    let result: { data: any[]; summary: any; chartData: any[] };

    switch (reportType) {
      case 'claims':
        result = await generateClaimsReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'revenue':
        result = await generateRevenueReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'patients':
        result = await generatePatientsReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'appointments':
        result = await generateAppointmentsReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'payer_performance':
        result = await generatePayerPerformanceReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'clinical':
        result = await generateClinicalReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'operational':
        result = await generateOperationalReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'compliance':
        result = await generateComplianceReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      default:
        return res.status(400).json({ message: `Unknown report type: ${reportType}` });
    }

    res.json(result);
  } catch (error) {
    logger.error('Error generating report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to generate report' });
  }
});

// ==================== SAVED REPORTS ====================

// List saved reports
router.get('/saved', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { db: database } = await import('../db');
    const results = await database.select().from(savedReports)
      .where(eq(savedReports.practiceId, practiceId))
      .orderBy(desc(savedReports.updatedAt));
    res.json(results);
  } catch (error) {
    logger.error('Error listing saved reports', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to list saved reports' });
  }
});

// Save a report configuration
router.post('/saved', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { name, description, reportType, filters, groupBy, columns, chartType } = req.body;
    if (!name || !reportType) {
      return res.status(400).json({ message: 'Name and report type are required' });
    }

    const { db: database } = await import('../db');
    const [saved] = await database.insert(savedReports).values({
      practiceId,
      createdBy: userId,
      name,
      description: description || null,
      reportType,
      filters: filters || null,
      groupBy: groupBy || null,
      columns: columns || null,
      chartType: chartType || 'bar',
    }).returning();

    res.status(201).json(saved);
  } catch (error) {
    logger.error('Error saving report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to save report' });
  }
});

// Delete saved report
router.delete('/saved/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const reportId = parseInt(req.params.id);
    if (isNaN(reportId)) {
      return res.status(400).json({ message: 'Invalid report ID' });
    }

    const { db: database } = await import('../db');
    const [existing] = await database.select().from(savedReports)
      .where(and(eq(savedReports.id, reportId), eq(savedReports.practiceId, practiceId)));

    if (!existing) {
      return res.status(404).json({ message: 'Report not found' });
    }

    await database.delete(savedReports)
      .where(and(eq(savedReports.id, reportId), eq(savedReports.practiceId, practiceId)));

    res.json({ message: 'Report deleted' });
  } catch (error) {
    logger.error('Error deleting saved report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete report' });
  }
});

// Run a saved report with current data
router.get('/saved/:id/run', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const reportId = parseInt(req.params.id);
    if (isNaN(reportId)) {
      return res.status(400).json({ message: 'Invalid report ID' });
    }

    const { db: database } = await import('../db');
    const [report] = await database.select().from(savedReports)
      .where(and(eq(savedReports.id, reportId), eq(savedReports.practiceId, practiceId)));

    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    const { startDate, endDate } = parseDateRange(report.filters);
    let result: { data: any[]; summary: any; chartData: any[] };

    switch (report.reportType) {
      case 'claims':
        result = await generateClaimsReport(practiceId, startDate, endDate, report.filters as any, report.groupBy || undefined);
        break;
      case 'revenue':
        result = await generateRevenueReport(practiceId, startDate, endDate, report.filters as any, report.groupBy || undefined);
        break;
      case 'patients':
        result = await generatePatientsReport(practiceId, startDate, endDate, report.filters as any, report.groupBy || undefined);
        break;
      case 'appointments':
        result = await generateAppointmentsReport(practiceId, startDate, endDate, report.filters as any, report.groupBy || undefined);
        break;
      case 'payer_performance':
        result = await generatePayerPerformanceReport(practiceId, startDate, endDate, report.filters as any, report.groupBy || undefined);
        break;
      case 'clinical':
        result = await generateClinicalReport(practiceId, startDate, endDate, report.filters as any, report.groupBy || undefined);
        break;
      case 'operational':
        result = await generateOperationalReport(practiceId, startDate, endDate, report.filters as any, report.groupBy || undefined);
        break;
      case 'compliance':
        result = await generateComplianceReport(practiceId, startDate, endDate, report.filters as any, report.groupBy || undefined);
        break;
      default:
        return res.status(400).json({ message: `Unknown report type: ${report.reportType}` });
    }

    res.json({ ...result, reportConfig: report });
  } catch (error) {
    logger.error('Error running saved report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to run saved report' });
  }
});

// ==================== EXPORT ====================

router.get('/export/:format', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const format = req.params.format;

    if (format !== 'csv') {
      return res.status(400).json({ message: 'Only CSV format is supported' });
    }

    const reportType = req.query.reportType as string;
    const filtersJson = req.query.filters as string;
    const groupBy = req.query.groupBy as string;

    if (!reportType) {
      return res.status(400).json({ message: 'Report type is required' });
    }

    let filters: any = {};
    if (filtersJson) {
      try {
        filters = JSON.parse(filtersJson);
      } catch {
        return res.status(400).json({ message: 'Invalid filters JSON' });
      }
    }

    const { startDate, endDate } = parseDateRange(filters);
    let result: { data: any[]; summary: any; chartData: any[] };

    switch (reportType) {
      case 'claims':
        result = await generateClaimsReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'revenue':
        result = await generateRevenueReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'patients':
        result = await generatePatientsReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'appointments':
        result = await generateAppointmentsReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'payer_performance':
        result = await generatePayerPerformanceReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'clinical':
        result = await generateClinicalReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'operational':
        result = await generateOperationalReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      case 'compliance':
        result = await generateComplianceReport(practiceId, startDate, endDate, filters, groupBy);
        break;
      default:
        return res.status(400).json({ message: `Unknown report type: ${reportType}` });
    }

    // Build CSV
    const data = result.data;
    if (!data || data.length === 0) {
      return res.status(200).send('No data');
    }

    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];
    for (const row of data) {
      const values = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvRows.push(values.join(','));
    }

    const csv = csvRows.join('\n');
    const filename = `${reportType}-report-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting report', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to export report' });
  }
});

// ==================== REPORT GENERATORS ====================

async function generateClaimsReport(
  practiceId: number,
  startDate: Date,
  endDate: Date,
  filters: any,
  groupBy?: string,
): Promise<{ data: any[]; summary: any; chartData: any[] }> {
  const { db: database } = await import('../db');

  // Build conditions
  const conditions = [
    eq(claims.practiceId, practiceId),
    gte(claims.createdAt, startDate),
    lte(claims.createdAt, endDate),
  ];

  if (filters?.status) {
    conditions.push(eq(claims.status, filters.status));
  }
  if (filters?.payer) {
    conditions.push(eq(claims.insuranceId, parseInt(filters.payer)));
  }

  // Get all claims with joined data
  const rows = await database
    .select({
      id: claims.id,
      claimNumber: claims.claimNumber,
      status: claims.status,
      totalAmount: claims.totalAmount,
      paidAmount: claims.paidAmount,
      submittedAmount: claims.submittedAmount,
      createdAt: claims.createdAt,
      submittedAt: claims.submittedAt,
      paidAt: claims.paidAt,
      denialReason: claims.denialReason,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      insuranceName: insurances.name,
    })
    .from(claims)
    .leftJoin(patients, eq(claims.patientId, patients.id))
    .leftJoin(insurances, eq(claims.insuranceId, insurances.id))
    .where(and(...conditions))
    .orderBy(desc(claims.createdAt));

  // Filter by therapist if specified (via sessions)
  let data = rows.map((r: any) => ({
    ...r,
    patientName: `${r.patientFirstName || ''} ${r.patientLastName || ''}`.trim(),
    totalAmount: Number(r.totalAmount) || 0,
    paidAmount: Number(r.paidAmount) || 0,
    submittedAmount: Number(r.submittedAmount) || 0,
  }));

  // Summary
  const totalClaims = data.length;
  const totalBilled = data.reduce((s: number, d: any) => s + d.totalAmount, 0);
  const totalPaid = data.reduce((s: number, d: any) => s + d.paidAmount, 0);
  const totalSubmitted = data.reduce((s: number, d: any) => s + d.submittedAmount, 0);
  const statusCounts: Record<string, number> = {};
  for (const d of data) {
    const st = d.status || 'unknown';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  }

  const summary = {
    totalClaims,
    totalBilled: totalBilled.toFixed(2),
    totalPaid: totalPaid.toFixed(2),
    totalSubmitted: totalSubmitted.toFixed(2),
    collectionRate: totalBilled > 0 ? ((totalPaid / totalBilled) * 100).toFixed(1) : '0',
    statusCounts,
  };

  // Chart data based on groupBy
  let chartData: any[] = [];
  if (groupBy === 'month') {
    const monthMap: Record<string, { name: string; count: number; amount: number; paid: number }> = {};
    for (const d of data) {
      const dateStr = d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 7) : 'Unknown';
      if (!monthMap[dateStr]) monthMap[dateStr] = { name: dateStr, count: 0, amount: 0, paid: 0 };
      monthMap[dateStr].count++;
      monthMap[dateStr].amount += d.totalAmount;
      monthMap[dateStr].paid += d.paidAmount;
    }
    chartData = Object.values(monthMap).sort((a, b) => a.name.localeCompare(b.name));
  } else if (groupBy === 'status') {
    chartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
  } else if (groupBy === 'payer') {
    const payerMap: Record<string, { name: string; count: number; amount: number }> = {};
    for (const d of data) {
      const payer = d.insuranceName || 'Unknown';
      if (!payerMap[payer]) payerMap[payer] = { name: payer, count: 0, amount: 0 };
      payerMap[payer].count++;
      payerMap[payer].amount += d.totalAmount;
    }
    chartData = Object.values(payerMap).sort((a, b) => b.amount - a.amount);
  } else if (groupBy === 'therapist') {
    // Group by therapist requires session join - simplified
    chartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
  } else {
    // Default: group by status
    chartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
  }

  return { data, summary, chartData };
}

async function generateRevenueReport(
  practiceId: number,
  startDate: Date,
  endDate: Date,
  filters: any,
  groupBy?: string,
): Promise<{ data: any[]; summary: any; chartData: any[] }> {
  const { db: database } = await import('../db');

  const conditions = [
    eq(payments.practiceId, practiceId),
    gte(payments.createdAt, startDate),
    lte(payments.createdAt, endDate),
  ];

  if (filters?.status) {
    conditions.push(eq(payments.status, filters.status));
  }

  const rows = await database
    .select({
      id: payments.id,
      amount: payments.amount,
      paymentMethod: payments.paymentMethod,
      paymentType: payments.paymentType,
      paymentDate: payments.paymentDate,
      status: payments.status,
      referenceNumber: payments.referenceNumber,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .leftJoin(patients, eq(payments.patientId, patients.id))
    .where(and(...conditions))
    .orderBy(desc(payments.createdAt));

  const data = rows.map((r: any) => ({
    ...r,
    patientName: `${r.patientFirstName || ''} ${r.patientLastName || ''}`.trim(),
    amount: Number(r.amount) || 0,
  }));

  const totalRevenue = data.reduce((s: number, d: any) => s + d.amount, 0);
  const avgPayment = data.length > 0 ? totalRevenue / data.length : 0;
  const methodCounts: Record<string, number> = {};
  for (const d of data) {
    const m = d.paymentMethod || 'unknown';
    methodCounts[m] = (methodCounts[m] || 0) + 1;
  }

  const summary = {
    totalRevenue: totalRevenue.toFixed(2),
    totalPayments: data.length,
    averagePayment: avgPayment.toFixed(2),
    paymentMethodBreakdown: methodCounts,
  };

  let chartData: any[] = [];
  if (groupBy === 'month') {
    const monthMap: Record<string, { name: string; revenue: number; count: number }> = {};
    for (const d of data) {
      const dateStr = d.paymentDate ? new Date(d.paymentDate).toISOString().slice(0, 7) : 'Unknown';
      if (!monthMap[dateStr]) monthMap[dateStr] = { name: dateStr, revenue: 0, count: 0 };
      monthMap[dateStr].revenue += d.amount;
      monthMap[dateStr].count++;
    }
    chartData = Object.values(monthMap).sort((a, b) => a.name.localeCompare(b.name));
  } else if (groupBy === 'payer') {
    const payerMap: Record<string, { name: string; revenue: number; count: number }> = {};
    for (const d of data) {
      const method = d.paymentMethod || 'Unknown';
      if (!payerMap[method]) payerMap[method] = { name: method, revenue: 0, count: 0 };
      payerMap[method].revenue += d.amount;
      payerMap[method].count++;
    }
    chartData = Object.values(payerMap).sort((a, b) => b.revenue - a.revenue);
  } else {
    // Default: by month
    const monthMap: Record<string, { name: string; revenue: number; count: number }> = {};
    for (const d of data) {
      const dateStr = d.paymentDate ? new Date(d.paymentDate).toISOString().slice(0, 7) : 'Unknown';
      if (!monthMap[dateStr]) monthMap[dateStr] = { name: dateStr, revenue: 0, count: 0 };
      monthMap[dateStr].revenue += d.amount;
      monthMap[dateStr].count++;
    }
    chartData = Object.values(monthMap).sort((a, b) => a.name.localeCompare(b.name));
  }

  return { data, summary, chartData };
}

async function generatePatientsReport(
  practiceId: number,
  startDate: Date,
  endDate: Date,
  filters: any,
  groupBy?: string,
): Promise<{ data: any[]; summary: any; chartData: any[] }> {
  const { db: database } = await import('../db');

  const conditions = [
    eq(patients.practiceId, practiceId),
    gte(patients.createdAt, startDate),
    lte(patients.createdAt, endDate),
  ];

  const rows = await database
    .select({
      id: patients.id,
      firstName: patients.firstName,
      lastName: patients.lastName,
      email: patients.email,
      phone: patients.phone,
      dateOfBirth: patients.dateOfBirth,
      insuranceProvider: patients.insuranceProvider,
      createdAt: patients.createdAt,
    })
    .from(patients)
    .where(and(...conditions))
    .orderBy(desc(patients.createdAt));

  const data = rows.map((r: any) => ({
    ...r,
    patientName: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
  }));

  const insuranceBreakdown: Record<string, number> = {};
  for (const d of data) {
    const ins = d.insuranceProvider || 'No Insurance';
    insuranceBreakdown[ins] = (insuranceBreakdown[ins] || 0) + 1;
  }

  const summary = {
    totalNewPatients: data.length,
    insuranceBreakdown,
  };

  let chartData: any[] = [];
  if (groupBy === 'month') {
    const monthMap: Record<string, { name: string; count: number }> = {};
    for (const d of data) {
      const dateStr = d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 7) : 'Unknown';
      if (!monthMap[dateStr]) monthMap[dateStr] = { name: dateStr, count: 0 };
      monthMap[dateStr].count++;
    }
    chartData = Object.values(monthMap).sort((a, b) => a.name.localeCompare(b.name));
  } else if (groupBy === 'payer') {
    chartData = Object.entries(insuranceBreakdown).map(([name, value]) => ({ name, value }));
  } else {
    // Default: insurance breakdown
    chartData = Object.entries(insuranceBreakdown).map(([name, value]) => ({ name, value }));
  }

  return { data, summary, chartData };
}

async function generateAppointmentsReport(
  practiceId: number,
  startDate: Date,
  endDate: Date,
  filters: any,
  groupBy?: string,
): Promise<{ data: any[]; summary: any; chartData: any[] }> {
  const { db: database } = await import('../db');

  const conditions: any[] = [
    eq(appointments.practiceId, practiceId),
    gte(appointments.startTime, startDate),
    lte(appointments.startTime, endDate),
  ];

  if (filters?.status) {
    conditions.push(eq(appointments.status, filters.status));
  }
  if (filters?.therapist) {
    conditions.push(eq(appointments.therapistId, filters.therapist));
  }

  const rows = await database
    .select({
      id: appointments.id,
      title: appointments.title,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      notes: appointments.notes,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      therapistFirstName: users.firstName,
      therapistLastName: users.lastName,
      createdAt: appointments.createdAt,
    })
    .from(appointments)
    .leftJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(users, eq(appointments.therapistId, users.id))
    .where(and(...conditions))
    .orderBy(desc(appointments.startTime));

  const data = rows.map((r: any) => ({
    ...r,
    patientName: `${r.patientFirstName || ''} ${r.patientLastName || ''}`.trim(),
    therapistName: `${r.therapistFirstName || ''} ${r.therapistLastName || ''}`.trim(),
  }));

  const statusCounts: Record<string, number> = {};
  for (const d of data) {
    const st = d.status || 'unknown';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  }

  const totalAppointments = data.length;
  const noShows = statusCounts['no_show'] || 0;
  const cancelled = statusCounts['cancelled'] || 0;
  const completed = statusCounts['completed'] || 0;

  const summary = {
    totalAppointments,
    completed,
    noShows,
    cancelled,
    noShowRate: totalAppointments > 0 ? ((noShows / totalAppointments) * 100).toFixed(1) : '0',
    cancellationRate: totalAppointments > 0 ? ((cancelled / totalAppointments) * 100).toFixed(1) : '0',
    utilizationRate: totalAppointments > 0 ? ((completed / totalAppointments) * 100).toFixed(1) : '0',
    statusCounts,
  };

  let chartData: any[] = [];
  if (groupBy === 'therapist') {
    const therapistMap: Record<string, { name: string; total: number; completed: number; noShow: number; cancelled: number }> = {};
    for (const d of data) {
      const t = d.therapistName || 'Unassigned';
      if (!therapistMap[t]) therapistMap[t] = { name: t, total: 0, completed: 0, noShow: 0, cancelled: 0 };
      therapistMap[t].total++;
      if (d.status === 'completed') therapistMap[t].completed++;
      if (d.status === 'no_show') therapistMap[t].noShow++;
      if (d.status === 'cancelled') therapistMap[t].cancelled++;
    }
    chartData = Object.values(therapistMap).sort((a, b) => b.total - a.total);
  } else if (groupBy === 'month') {
    const monthMap: Record<string, { name: string; total: number; completed: number; noShow: number }> = {};
    for (const d of data) {
      const dateStr = d.startTime ? new Date(d.startTime).toISOString().slice(0, 7) : 'Unknown';
      if (!monthMap[dateStr]) monthMap[dateStr] = { name: dateStr, total: 0, completed: 0, noShow: 0 };
      monthMap[dateStr].total++;
      if (d.status === 'completed') monthMap[dateStr].completed++;
      if (d.status === 'no_show') monthMap[dateStr].noShow++;
    }
    chartData = Object.values(monthMap).sort((a, b) => a.name.localeCompare(b.name));
  } else if (groupBy === 'status') {
    chartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
  } else {
    chartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
  }

  return { data, summary, chartData };
}

async function generatePayerPerformanceReport(
  practiceId: number,
  startDate: Date,
  endDate: Date,
  filters: any,
  groupBy?: string,
): Promise<{ data: any[]; summary: any; chartData: any[] }> {
  const { db: database } = await import('../db');

  const conditions = [
    eq(claims.practiceId, practiceId),
    gte(claims.createdAt, startDate),
    lte(claims.createdAt, endDate),
  ];

  if (filters?.payer) {
    conditions.push(eq(claims.insuranceId, parseInt(filters.payer)));
  }

  const rows = await database
    .select({
      id: claims.id,
      status: claims.status,
      totalAmount: claims.totalAmount,
      paidAmount: claims.paidAmount,
      submittedAt: claims.submittedAt,
      paidAt: claims.paidAt,
      denialReason: claims.denialReason,
      insuranceName: insurances.name,
      insuranceId: claims.insuranceId,
      createdAt: claims.createdAt,
    })
    .from(claims)
    .leftJoin(insurances, eq(claims.insuranceId, insurances.id))
    .where(and(...conditions))
    .orderBy(desc(claims.createdAt));

  // Group by payer
  const payerMap: Record<string, {
    name: string;
    totalClaims: number;
    paidClaims: number;
    deniedClaims: number;
    totalBilled: number;
    totalPaid: number;
    avgPaymentDays: number;
    paymentDaysList: number[];
  }> = {};

  for (const r of rows) {
    const payer = r.insuranceName || 'Unknown';
    if (!payerMap[payer]) {
      payerMap[payer] = {
        name: payer,
        totalClaims: 0,
        paidClaims: 0,
        deniedClaims: 0,
        totalBilled: 0,
        totalPaid: 0,
        avgPaymentDays: 0,
        paymentDaysList: [],
      };
    }
    payerMap[payer].totalClaims++;
    payerMap[payer].totalBilled += Number(r.totalAmount) || 0;
    payerMap[payer].totalPaid += Number(r.paidAmount) || 0;

    if (r.status === 'paid') {
      payerMap[payer].paidClaims++;
      if (r.submittedAt && r.paidAt) {
        const days = Math.round(
          (new Date(r.paidAt).getTime() - new Date(r.submittedAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        payerMap[payer].paymentDaysList.push(days);
      }
    }
    if (r.status === 'denied') {
      payerMap[payer].deniedClaims++;
    }
  }

  // Calculate averages
  const data = Object.values(payerMap).map(p => {
    const avgDays = p.paymentDaysList.length > 0
      ? Math.round(p.paymentDaysList.reduce((s, d) => s + d, 0) / p.paymentDaysList.length)
      : 0;
    return {
      payer: p.name,
      totalClaims: p.totalClaims,
      paidClaims: p.paidClaims,
      deniedClaims: p.deniedClaims,
      totalBilled: Number(p.totalBilled.toFixed(2)),
      totalPaid: Number(p.totalPaid.toFixed(2)),
      denialRate: p.totalClaims > 0 ? Number(((p.deniedClaims / p.totalClaims) * 100).toFixed(1)) : 0,
      collectionRate: p.totalBilled > 0 ? Number(((p.totalPaid / p.totalBilled) * 100).toFixed(1)) : 0,
      avgPaymentDays: avgDays,
    };
  }).sort((a, b) => b.totalBilled - a.totalBilled);

  const totalBilledAll = data.reduce((s, d) => s + d.totalBilled, 0);
  const totalPaidAll = data.reduce((s, d) => s + d.totalPaid, 0);
  const totalDeniedAll = data.reduce((s, d) => s + d.deniedClaims, 0);
  const totalClaimsAll = data.reduce((s, d) => s + d.totalClaims, 0);

  const summary = {
    totalPayers: data.length,
    totalClaims: totalClaimsAll,
    totalBilled: totalBilledAll.toFixed(2),
    totalPaid: totalPaidAll.toFixed(2),
    overallDenialRate: totalClaimsAll > 0 ? ((totalDeniedAll / totalClaimsAll) * 100).toFixed(1) : '0',
    overallCollectionRate: totalBilledAll > 0 ? ((totalPaidAll / totalBilledAll) * 100).toFixed(1) : '0',
  };

  const chartData = data.map(d => ({
    name: d.payer,
    totalBilled: d.totalBilled,
    totalPaid: d.totalPaid,
    denialRate: d.denialRate,
  }));

  return { data, summary, chartData };
}

// ==================== CLINICAL REPORT ====================

async function generateClinicalReport(
  practiceId: number,
  startDate: Date,
  endDate: Date,
  filters: any,
  groupBy?: string,
): Promise<{ data: any[]; summary: any; chartData: any[] }> {
  const { db: database } = await import('../db');

  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  const conditions: any[] = [
    eq(treatmentSessions.practiceId, practiceId),
    gte(treatmentSessions.sessionDate, startStr),
    lte(treatmentSessions.sessionDate, endStr),
  ];

  if (filters?.therapist) {
    conditions.push(eq(treatmentSessions.therapistId, filters.therapist));
  }

  // Sessions per patient with documentation status
  const rows = await database
    .select({
      sessionId: treatmentSessions.id,
      patientId: treatmentSessions.patientId,
      therapistId: treatmentSessions.therapistId,
      sessionDate: treatmentSessions.sessionDate,
      duration: treatmentSessions.duration,
      status: treatmentSessions.status,
      cptCodeId: treatmentSessions.cptCodeId,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      therapistFirstName: users.firstName,
      therapistLastName: users.lastName,
      cptCode: cptCodes.code,
      cptDescription: cptCodes.description,
    })
    .from(treatmentSessions)
    .leftJoin(patients, eq(treatmentSessions.patientId, patients.id))
    .leftJoin(users, eq(treatmentSessions.therapistId, users.id))
    .leftJoin(cptCodes, eq(treatmentSessions.cptCodeId, cptCodes.id))
    .where(and(...conditions))
    .orderBy(desc(treatmentSessions.sessionDate));

  const data = rows.map((r: any) => ({
    sessionId: r.sessionId,
    patientName: `${r.patientFirstName || ''} ${r.patientLastName || ''}`.trim(),
    therapistName: `${r.therapistFirstName || ''} ${r.therapistLastName || ''}`.trim(),
    sessionDate: r.sessionDate,
    duration: r.duration || 0,
    status: r.status,
    cptCode: r.cptCode || '',
    cptDescription: r.cptDescription || '',
  }));

  // Group sessions by patient for summary
  const patientSessionCounts: Record<number, number> = {};
  for (const r of rows) {
    patientSessionCounts[r.patientId] = (patientSessionCounts[r.patientId] || 0) + 1;
  }
  const patientIds = Object.keys(patientSessionCounts);
  const totalSessions = data.length;
  const avgSessionsPerPatient = patientIds.length > 0
    ? Math.round((totalSessions / patientIds.length) * 100) / 100
    : 0;
  const avgDuration = totalSessions > 0
    ? Math.round(data.reduce((s: number, d: { duration: number }) => s + d.duration, 0) / totalSessions)
    : 0;

  const summary = {
    totalSessions,
    uniquePatients: patientIds.length,
    avgSessionsPerPatient,
    avgSessionDuration: avgDuration,
  };

  let chartData: any[] = [];
  if (groupBy === 'patient') {
    const patientMap: Record<string, { name: string; sessions: number; totalMinutes: number }> = {};
    for (const d of data) {
      const key = d.patientName || 'Unknown';
      if (!patientMap[key]) patientMap[key] = { name: key, sessions: 0, totalMinutes: 0 };
      patientMap[key].sessions++;
      patientMap[key].totalMinutes += d.duration;
    }
    chartData = Object.values(patientMap).sort((a, b) => b.sessions - a.sessions).slice(0, 20);
  } else if (groupBy === 'therapist') {
    const therapistMap: Record<string, { name: string; sessions: number; patients: Set<string> }> = {};
    for (const r of rows) {
      const key = `${r.therapistFirstName || ''} ${r.therapistLastName || ''}`.trim() || 'Unknown';
      if (!therapistMap[key]) therapistMap[key] = { name: key, sessions: 0, patients: new Set() };
      therapistMap[key].sessions++;
      therapistMap[key].patients.add(String(r.patientId));
    }
    chartData = Object.values(therapistMap).map(t => ({
      name: t.name,
      sessions: t.sessions,
      uniquePatients: t.patients.size,
    })).sort((a, b) => b.sessions - a.sessions);
  } else if (groupBy === 'cpt_code') {
    const cptMap: Record<string, { name: string; count: number }> = {};
    for (const d of data) {
      const key = d.cptCode || 'Unknown';
      if (!cptMap[key]) cptMap[key] = { name: key, count: 0 };
      cptMap[key].count++;
    }
    chartData = Object.values(cptMap).sort((a, b) => b.count - a.count);
  } else {
    // Default: by month
    const monthMap: Record<string, { name: string; sessions: number; patients: Set<string> }> = {};
    for (const r of rows) {
      const dateStr = r.sessionDate ? r.sessionDate.slice(0, 7) : 'Unknown';
      if (!monthMap[dateStr]) monthMap[dateStr] = { name: dateStr, sessions: 0, patients: new Set() };
      monthMap[dateStr].sessions++;
      monthMap[dateStr].patients.add(String(r.patientId));
    }
    chartData = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({ name: v.name, sessions: v.sessions, uniquePatients: v.patients.size }));
  }

  return { data, summary, chartData };
}

// ==================== OPERATIONAL REPORT ====================

async function generateOperationalReport(
  practiceId: number,
  startDate: Date,
  endDate: Date,
  filters: any,
  groupBy?: string,
): Promise<{ data: any[]; summary: any; chartData: any[] }> {
  const { db: database } = await import('../db');

  const conditions: any[] = [
    eq(appointments.practiceId, practiceId),
    gte(appointments.startTime, startDate),
    lte(appointments.startTime, endDate),
  ];

  if (filters?.therapist) {
    conditions.push(eq(appointments.therapistId, filters.therapist));
  }

  const rows = await database
    .select({
      id: appointments.id,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      therapistId: appointments.therapistId,
      therapistFirstName: users.firstName,
      therapistLastName: users.lastName,
      cancellationReason: appointments.cancellationReason,
    })
    .from(appointments)
    .leftJoin(users, eq(appointments.therapistId, users.id))
    .where(and(...conditions))
    .orderBy(desc(appointments.startTime));

  const data = rows.map((r: any) => {
    const startMs = r.startTime ? new Date(r.startTime).getTime() : 0;
    const endMs = r.endTime ? new Date(r.endTime).getTime() : 0;
    const durationMin = startMs && endMs ? Math.round((endMs - startMs) / 60000) : 0;
    return {
      id: r.id,
      date: r.startTime ? new Date(r.startTime).toISOString().split('T')[0] : '',
      therapistName: `${r.therapistFirstName || ''} ${r.therapistLastName || ''}`.trim(),
      status: r.status,
      durationMinutes: durationMin,
      cancellationReason: r.cancellationReason || '',
    };
  });

  const total = data.length;
  const completed = data.filter((d: any) => d.status === 'completed').length;
  const cancelled = data.filter((d: any) => d.status === 'cancelled').length;
  const noShows = data.filter((d: any) => d.status === 'no_show').length;
  const completedDurations = data.filter((d: any) => d.status === 'completed' && d.durationMinutes > 0).map((d: any) => d.durationMinutes);
  const avgSessionLength = completedDurations.length > 0
    ? Math.round(completedDurations.reduce((s: number, d: number) => s + d, 0) / completedDurations.length)
    : 0;

  const summary = {
    totalAppointments: total,
    completed,
    cancelled,
    noShows,
    cancellationRate: total > 0 ? ((cancelled / total) * 100).toFixed(1) : '0',
    noShowRate: total > 0 ? ((noShows / total) * 100).toFixed(1) : '0',
    avgSessionLength,
  };

  let chartData: any[] = [];
  if (groupBy === 'therapist') {
    const therapistMap: Record<string, {
      name: string; total: number; completed: number; cancelled: number; noShow: number; totalDuration: number; completedCount: number;
    }> = {};
    for (const d of data) {
      const key = d.therapistName || 'Unassigned';
      if (!therapistMap[key]) therapistMap[key] = { name: key, total: 0, completed: 0, cancelled: 0, noShow: 0, totalDuration: 0, completedCount: 0 };
      therapistMap[key].total++;
      if (d.status === 'completed') { therapistMap[key].completed++; therapistMap[key].totalDuration += d.durationMinutes; therapistMap[key].completedCount++; }
      if (d.status === 'cancelled') therapistMap[key].cancelled++;
      if (d.status === 'no_show') therapistMap[key].noShow++;
    }
    chartData = Object.values(therapistMap).map(t => ({
      name: t.name,
      total: t.total,
      completed: t.completed,
      cancelled: t.cancelled,
      noShow: t.noShow,
      avgDuration: t.completedCount > 0 ? Math.round(t.totalDuration / t.completedCount) : 0,
    })).sort((a, b) => b.total - a.total);
  } else if (groupBy === 'cancellation_reason') {
    const reasonMap: Record<string, { name: string; count: number }> = {};
    for (const d of data) {
      if (d.status !== 'cancelled') continue;
      const reason = d.cancellationReason || 'No reason';
      if (!reasonMap[reason]) reasonMap[reason] = { name: reason, count: 0 };
      reasonMap[reason].count++;
    }
    chartData = Object.values(reasonMap).sort((a, b) => b.count - a.count);
  } else {
    // Default: by month
    const monthMap: Record<string, { name: string; total: number; completed: number; cancelled: number; noShow: number }> = {};
    for (const d of data) {
      const dateStr = d.date ? d.date.slice(0, 7) : 'Unknown';
      if (!monthMap[dateStr]) monthMap[dateStr] = { name: dateStr, total: 0, completed: 0, cancelled: 0, noShow: 0 };
      monthMap[dateStr].total++;
      if (d.status === 'completed') monthMap[dateStr].completed++;
      if (d.status === 'cancelled') monthMap[dateStr].cancelled++;
      if (d.status === 'no_show') monthMap[dateStr].noShow++;
    }
    chartData = Object.values(monthMap).sort((a, b) => a.name.localeCompare(b.name));
  }

  return { data, summary, chartData };
}

// ==================== COMPLIANCE REPORT ====================

async function generateComplianceReport(
  practiceId: number,
  startDate: Date,
  endDate: Date,
  filters: any,
  groupBy?: string,
): Promise<{ data: any[]; summary: any; chartData: any[] }> {
  const { db: database } = await import('../db');

  // Audit log events for the practice
  const auditConditions: any[] = [
    eq(auditLog.practiceId, practiceId),
    gte(auditLog.createdAt, startDate),
    lte(auditLog.createdAt, endDate),
  ];

  const auditRows = await database
    .select({
      id: auditLog.id,
      eventCategory: auditLog.eventCategory,
      eventType: auditLog.eventType,
      resourceType: auditLog.resourceType,
      userId: auditLog.userId,
      success: auditLog.success,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(and(...auditConditions))
    .orderBy(desc(auditLog.createdAt));

  // MFA adoption: users in practice with mfaEnabled
  const practiceUsers = await database
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      mfaEnabled: users.mfaEnabled,
    })
    .from(users)
    .where(eq(users.practiceId, practiceId));

  const mfaEnabled = practiceUsers.filter((u: any) => u.mfaEnabled).length;
  const mfaTotal = practiceUsers.length;

  // Consent status: active vs expired vs revoked
  const consentRows = await database
    .select({
      id: patientConsents.id,
      consentType: patientConsents.consentType,
      isRevoked: patientConsents.isRevoked,
      expirationDate: patientConsents.expirationDate,
      patientId: patientConsents.patientId,
    })
    .from(patientConsents)
    .where(eq(patientConsents.practiceId, practiceId));

  const now = new Date();
  const nowStr = now.toISOString().split('T')[0];
  let activeConsents = 0;
  let expiredConsents = 0;
  let revokedConsents = 0;
  for (const c of consentRows) {
    if (c.isRevoked) { revokedConsents++; }
    else if (c.expirationDate && c.expirationDate < nowStr) { expiredConsents++; }
    else { activeConsents++; }
  }

  // Build audit event summary for data table
  const categoryCounts: Record<string, number> = {};
  const failedEvents: Record<string, number> = {};
  for (const row of auditRows) {
    const cat = row.eventCategory || 'unknown';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    if (!row.success) {
      failedEvents[cat] = (failedEvents[cat] || 0) + 1;
    }
  }

  const data = Object.entries(categoryCounts).map(([category, totalEvents]) => ({
    eventCategory: category,
    totalEvents,
    failedEvents: failedEvents[category] || 0,
    successRate: totalEvents > 0
      ? Number((((totalEvents - (failedEvents[category] || 0)) / totalEvents) * 100).toFixed(1))
      : 100,
  })).sort((a, b) => b.totalEvents - a.totalEvents);

  const summary = {
    totalAuditEvents: auditRows.length,
    failedEventCount: auditRows.filter((r: any) => !r.success).length,
    mfaAdoptionRate: mfaTotal > 0 ? `${Math.round((mfaEnabled / mfaTotal) * 100)}%` : 'N/A',
    mfaEnabled,
    mfaTotal,
    activeConsents,
    expiredConsents,
    revokedConsents,
  };

  let chartData: any[] = [];
  if (groupBy === 'event_category') {
    chartData = data.map(d => ({ name: d.eventCategory, value: d.totalEvents }));
  } else if (groupBy === 'mfa_status') {
    chartData = [
      { name: 'MFA Enabled', value: mfaEnabled },
      { name: 'MFA Disabled', value: mfaTotal - mfaEnabled },
    ];
  } else if (groupBy === 'consent_status') {
    chartData = [
      { name: 'Active', value: activeConsents },
      { name: 'Expired', value: expiredConsents },
      { name: 'Revoked', value: revokedConsents },
    ];
  } else {
    // Default: audit events by month
    const monthMap: Record<string, { name: string; events: number; failed: number }> = {};
    for (const row of auditRows) {
      const dateStr = row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 7) : 'Unknown';
      if (!monthMap[dateStr]) monthMap[dateStr] = { name: dateStr, events: 0, failed: 0 };
      monthMap[dateStr].events++;
      if (!row.success) monthMap[dateStr].failed++;
    }
    chartData = Object.values(monthMap).sort((a, b) => a.name.localeCompare(b.name));
  }

  return { data, summary, chartData };
}

export default router;

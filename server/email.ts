import nodemailer from 'nodemailer';
import type { Claim, Patient, ReimbursementOptimization } from '@shared/schema';

// Email configuration from environment variables
const emailConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
};

const fromAddress = process.env.EMAIL_FROM || 'noreply@therapybill.ai';

// Create transporter (lazy initialization)
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport(emailConfig);
  }
  return transporter;
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export interface DeniedClaimReportData {
  claim: Claim;
  patient: Patient | null;
  appeal: ReimbursementOptimization | null;
}

export interface DeniedClaimsReportInput {
  practiceName: string;
  reportDate: Date;
  period: string;
  summary: {
    totalDenied: number;
    totalAmountAtRisk: number;
    appealsGenerated: number;
    appealsSent: number;
    appealsWon: number;
  };
  topDenialReasons: { reason: string; count: number }[];
  claims: {
    claimNumber: string;
    patientName: string;
    amount: string;
    denialReason: string | null;
    deniedAt: Date | null;
    appealStatus: string;
  }[];
  reportUrl?: string;
}

function generateDeniedClaimsEmailHtml(data: DeniedClaimsReportInput): string {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const formatDate = (date: Date | null) =>
    date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'sent': return '#3b82f6';
      case 'completed': return '#22c55e';
      case 'failed': return '#ef4444';
      default: return '#94a3b8';
    }
  };

  const claimsRows = data.claims.map(claim => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${claim.claimNumber}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${claim.patientName}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #dc2626; font-weight: 600;">$${claim.amount}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${claim.denialReason || 'Unknown'}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${formatDate(claim.deniedAt)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">
        <span style="display: inline-block; padding: 4px 8px; border-radius: 9999px; font-size: 12px; font-weight: 500; background-color: ${getStatusColor(claim.appealStatus)}20; color: ${getStatusColor(claim.appealStatus)};">
          ${claim.appealStatus === 'none' ? 'No Appeal' : claim.appealStatus.charAt(0).toUpperCase() + claim.appealStatus.slice(1)}
        </span>
      </td>
    </tr>
  `).join('');

  const denialReasonsHtml = data.topDenialReasons.slice(0, 5).map((reason, index) => `
    <span style="display: inline-block; margin: 4px; padding: 6px 12px; background: #f1f5f9; border-radius: 9999px; font-size: 13px;">
      ${index + 1}. ${reason.reason} <span style="color: #64748b;">(${reason.count})</span>
    </span>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Denied Claims Report</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc;">
  <div style="max-width: 800px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0 0 10px 0; font-size: 28px;">Denied Claims Report</h1>
      <p style="margin: 0; opacity: 0.9; font-size: 16px;">${data.practiceName}</p>
      <p style="margin: 10px 0 0 0; opacity: 0.8; font-size: 14px;">${formatDate(data.reportDate)} - ${data.period}</p>
    </div>

    <!-- Summary Stats -->
    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 20px 0; font-size: 18px; color: #1e293b;">Summary</h2>
      <div style="display: flex; flex-wrap: wrap; gap: 15px;">
        <div style="flex: 1; min-width: 120px; text-align: center; padding: 20px; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
          <div style="font-size: 32px; font-weight: 700; color: #dc2626;">${data.summary.totalDenied}</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Claims Denied</div>
        </div>
        <div style="flex: 1; min-width: 120px; text-align: center; padding: 20px; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
          <div style="font-size: 32px; font-weight: 700; color: #dc2626;">${formatCurrency(data.summary.totalAmountAtRisk)}</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Amount at Risk</div>
        </div>
        <div style="flex: 1; min-width: 120px; text-align: center; padding: 20px; background: #fefce8; border-radius: 8px; border: 1px solid #fef08a;">
          <div style="font-size: 32px; font-weight: 700; color: #ca8a04;">${data.summary.appealsGenerated}</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Appeals Generated</div>
        </div>
        <div style="flex: 1; min-width: 120px; text-align: center; padding: 20px; background: #eff6ff; border-radius: 8px; border: 1px solid #bfdbfe;">
          <div style="font-size: 32px; font-weight: 700; color: #2563eb;">${data.summary.appealsSent}</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Appeals Sent</div>
        </div>
        <div style="flex: 1; min-width: 120px; text-align: center; padding: 20px; background: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
          <div style="font-size: 32px; font-weight: 700; color: #16a34a;">${data.summary.appealsWon}</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Appeals Won</div>
        </div>
      </div>
    </div>

    <!-- Top Denial Reasons -->
    ${data.topDenialReasons.length > 0 ? `
    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #1e293b;">Top Denial Reasons</h2>
      <div style="line-height: 2;">
        ${denialReasonsHtml}
      </div>
    </div>
    ` : ''}

    <!-- Claims Table -->
    ${data.claims.length > 0 ? `
    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 20px 0; font-size: 18px; color: #1e293b;">Denied Claims</h2>
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f8fafc;">
              <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Claim #</th>
              <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Patient</th>
              <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Amount</th>
              <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Denial Reason</th>
              <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Date</th>
              <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Appeal</th>
            </tr>
          </thead>
          <tbody>
            ${claimsRows}
          </tbody>
        </table>
      </div>
    </div>
    ` : `
    <div style="background: white; padding: 40px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; text-align: center;">
      <div style="color: #22c55e; font-size: 48px; margin-bottom: 15px;">&#10003;</div>
      <h3 style="margin: 0 0 10px 0; color: #1e293b;">No Denied Claims</h3>
      <p style="margin: 0; color: #64748b;">Great news! No claims were denied in this period.</p>
    </div>
    `}

    <!-- Footer -->
    <div style="background: #f1f5f9; padding: 25px; border-radius: 0 0 12px 12px; text-align: center; border: 1px solid #e2e8f0; border-top: none;">
      ${data.reportUrl ? `
      <a href="${data.reportUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-weight: 500; margin-bottom: 15px;">View Full Report</a>
      <br>
      ` : ''}
      <p style="margin: 0; color: #64748b; font-size: 13px;">
        This is an automated report from TherapyBill AI.<br>
        Generated on ${formatDate(new Date())}
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

function generateDeniedClaimsEmailText(data: DeniedClaimsReportInput): string {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const formatDate = (date: Date | null) =>
    date ? new Date(date).toLocaleDateString() : '-';

  let text = `
DENIED CLAIMS REPORT
====================
${data.practiceName}
${formatDate(data.reportDate)} - ${data.period}

SUMMARY
-------
- Claims Denied: ${data.summary.totalDenied}
- Amount at Risk: ${formatCurrency(data.summary.totalAmountAtRisk)}
- Appeals Generated: ${data.summary.appealsGenerated}
- Appeals Sent: ${data.summary.appealsSent}
- Appeals Won: ${data.summary.appealsWon}

`;

  if (data.topDenialReasons.length > 0) {
    text += `TOP DENIAL REASONS
------------------
`;
    data.topDenialReasons.slice(0, 5).forEach((reason, index) => {
      text += `${index + 1}. ${reason.reason} (${reason.count})\n`;
    });
    text += '\n';
  }

  if (data.claims.length > 0) {
    text += `DENIED CLAIMS
-------------
`;
    data.claims.forEach(claim => {
      text += `
Claim #: ${claim.claimNumber}
Patient: ${claim.patientName}
Amount: $${claim.amount}
Denial Reason: ${claim.denialReason || 'Unknown'}
Denied Date: ${formatDate(claim.deniedAt)}
Appeal Status: ${claim.appealStatus === 'none' ? 'No Appeal' : claim.appealStatus}
---
`;
    });
  } else {
    text += `
No claims were denied in this period.
`;
  }

  if (data.reportUrl) {
    text += `
View full report: ${data.reportUrl}
`;
  }

  text += `
--
This is an automated report from TherapyBill AI.
`;

  return text;
}

export async function sendDeniedClaimsReport(
  to: string | string[],
  data: DeniedClaimsReportInput
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping send');
    return { success: false, error: 'Email not configured' };
  }

  const recipients = Array.isArray(to) ? to : [to];
  const subject = `Denied Claims Report - ${data.period} - ${new Date(data.reportDate).toLocaleDateString()}`;

  try {
    const transport = getTransporter();

    const info = await transport.sendMail({
      from: `"TherapyBill AI" <${fromAddress}>`,
      to: recipients.join(', '),
      subject,
      text: generateDeniedClaimsEmailText(data),
      html: generateDeniedClaimsEmailHtml(data),
    });

    console.log('Denied claims report email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send denied claims report email:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function sendTestEmail(to: string): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return { success: false, error: 'Email not configured. Please set SMTP_USER and SMTP_PASS environment variables.' };
  }

  try {
    const transport = getTransporter();

    await transport.sendMail({
      from: `"TherapyBill AI" <${fromAddress}>`,
      to,
      subject: 'Test Email from TherapyBill AI',
      text: 'This is a test email to verify your email configuration is working correctly.',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Email Configuration Test</h2>
          <p>This is a test email from TherapyBill AI to verify your email configuration is working correctly.</p>
          <p style="color: #22c55e; font-weight: bold;">Your email is configured correctly!</p>
          <p style="color: #64748b; font-size: 12px; margin-top: 20px;">
            Sent from TherapyBill AI at ${new Date().toLocaleString()}
          </p>
        </div>
      `,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// Send authorization confirmation email to patient
export async function sendAuthorizationConfirmationEmail(
  practice: any,
  patient: any,
  authorization: any
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping authorization confirmation email');
    return { success: true }; // Return success to not block the flow
  }

  if (!patient.email) {
    return { success: false, error: 'Patient email not available' };
  }

  try {
    const transport = getTransporter();
    const practiceName = practice?.name || 'Your Healthcare Provider';
    const authDetails = authorization.authorizationDetails || {};

    await transport.sendMail({
      from: `"${practiceName}" <${fromAddress}>`,
      to: patient.email,
      subject: `Insurance Authorization Confirmed - ${practiceName}`,
      text: `Your insurance authorization has been confirmed.

Authorization Number: ${authorization.authorizationNumber || 'N/A'}
Approved Units: ${authDetails.approvedUnits || 'N/A'}
Valid From: ${authorization.startDate || 'N/A'}
Valid Until: ${authorization.endDate || 'N/A'}

If you have any questions, please contact our office.

${practiceName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Insurance Authorization Confirmed</h2>
          <p>Dear ${patient.firstName || 'Patient'},</p>
          <p>Great news! Your insurance authorization has been confirmed.</p>

          <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #1e40af;">Authorization Details</h3>
            <p><strong>Authorization Number:</strong> ${authorization.authorizationNumber || 'N/A'}</p>
            <p><strong>Approved Units:</strong> ${authDetails.approvedUnits || 'N/A'}</p>
            <p><strong>Valid From:</strong> ${authorization.startDate || 'N/A'}</p>
            <p><strong>Valid Until:</strong> ${authorization.endDate || 'N/A'}</p>
          </div>

          <p>If you have any questions about your authorization or upcoming appointments, please don't hesitate to contact our office.</p>

          <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
            This email was sent by ${practiceName}
          </p>
        </div>
      `,
    });

    console.log('Authorization confirmation email sent to:', patient.email);
    return { success: true };
  } catch (error) {
    console.error('Failed to send authorization confirmation email:', error);
    return { success: false, error: (error as Error).message };
  }
}

// Send authorization request email to patient
export async function sendAuthorizationRequestEmail(
  practice: any,
  patient: any,
  authorizationLink: string
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping authorization request email');
    return { success: true };
  }

  if (!patient.email) {
    return { success: false, error: 'Patient email not available' };
  }

  try {
    const transport = getTransporter();
    const practiceName = practice?.name || 'Your Healthcare Provider';

    await transport.sendMail({
      from: `"${practiceName}" <${fromAddress}>`,
      to: patient.email,
      subject: `Insurance Authorization Request - ${practiceName}`,
      text: `Please complete your insurance authorization by clicking the link below:

${authorizationLink}

This link will expire in 7 days.

If you have any questions, please contact our office.

${practiceName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Insurance Authorization Request</h2>
          <p>Dear ${patient.firstName || 'Patient'},</p>
          <p>We need you to complete your insurance authorization to proceed with your treatment.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${authorizationLink}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Complete Authorization
            </a>
          </div>

          <p style="color: #64748b; font-size: 14px;">This link will expire in 7 days.</p>

          <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
            This email was sent by ${practiceName}
          </p>
        </div>
      `,
    });

    console.log('Authorization request email sent to:', patient.email);
    return { success: true };
  } catch (error) {
    console.error('Failed to send authorization request email:', error);
    return { success: false, error: (error as Error).message };
  }
}

// Send authorization reminder email to patient
export async function sendAuthorizationReminderEmail(
  practice: any,
  patient: any,
  authorizationLink: string
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping authorization reminder email');
    return { success: true };
  }

  if (!patient.email) {
    return { success: false, error: 'Patient email not available' };
  }

  try {
    const transport = getTransporter();
    const practiceName = practice?.name || 'Your Healthcare Provider';

    await transport.sendMail({
      from: `"${practiceName}" <${fromAddress}>`,
      to: patient.email,
      subject: `Reminder: Complete Your Insurance Authorization - ${practiceName}`,
      text: `This is a reminder to complete your insurance authorization.

Please click the link below:
${authorizationLink}

If you have any questions, please contact our office.

${practiceName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #f59e0b;">Reminder: Insurance Authorization</h2>
          <p>Dear ${patient.firstName || 'Patient'},</p>
          <p>This is a friendly reminder that we still need you to complete your insurance authorization.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${authorizationLink}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Complete Authorization Now
            </a>
          </div>

          <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
            This email was sent by ${practiceName}
          </p>
        </div>
      `,
    });

    console.log('Authorization reminder email sent to:', patient.email);
    return { success: true };
  } catch (error) {
    console.error('Failed to send authorization reminder email:', error);
    return { success: false, error: (error as Error).message };
  }
}

// Weekly Cancellation Report
export interface WeeklyCancellationReportInput {
  practiceName: string;
  reportDate: Date;
  totalCancellations: number;
  totalScheduled: number;
  cancellationRate: number;
  lateCancellations: number;
  byReason: { reason: string; count: number }[];
  byCancelledBy: { who: string; count: number }[];
  repeatCancellers: { patientName: string; cancellations: number; noShows: number }[];
  reportUrl?: string;
}

function generateWeeklyCancellationEmailHtml(data: WeeklyCancellationReportInput): string {
  const formatDate = (date: Date | null) =>
    date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';

  const reasonRows = data.byReason.map(r => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${r.reason}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${r.count}</td>
    </tr>
  `).join('');

  const cancelledByRows = data.byCancelledBy.map(r => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${r.who}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${r.count}</td>
    </tr>
  `).join('');

  const repeatRows = data.repeatCancellers.map(r => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${r.patientName}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${r.cancellations}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${r.noShows}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Weekly Cancellation Report</title></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f8fafc;">
  <div style="max-width: 700px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0 0 10px 0; font-size: 24px;">Weekly Cancellation Report</h1>
      <p style="margin: 0; opacity: 0.9;">${data.practiceName}</p>
      <p style="margin: 10px 0 0 0; opacity: 0.8; font-size: 14px;">Week ending ${formatDate(data.reportDate)}</p>
    </div>

    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 20px 0; font-size: 18px; color: #1e293b;">Summary</h2>
      <div style="display: flex; flex-wrap: wrap; gap: 15px;">
        <div style="flex: 1; min-width: 120px; text-align: center; padding: 20px; background: #fef2f2; border-radius: 8px;">
          <div style="font-size: 28px; font-weight: 700; color: #dc2626;">${data.totalCancellations}</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Cancellations</div>
        </div>
        <div style="flex: 1; min-width: 120px; text-align: center; padding: 20px; background: #eff6ff; border-radius: 8px;">
          <div style="font-size: 28px; font-weight: 700; color: #2563eb;">${data.totalScheduled}</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Total Scheduled</div>
        </div>
        <div style="flex: 1; min-width: 120px; text-align: center; padding: 20px; background: ${data.cancellationRate > 20 ? '#fef2f2' : '#f0fdf4'}; border-radius: 8px;">
          <div style="font-size: 28px; font-weight: 700; color: ${data.cancellationRate > 20 ? '#dc2626' : '#16a34a'};">${data.cancellationRate.toFixed(1)}%</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Cancel Rate</div>
        </div>
        <div style="flex: 1; min-width: 120px; text-align: center; padding: 20px; background: #fefce8; border-radius: 8px;">
          <div style="font-size: 28px; font-weight: 700; color: #ca8a04;">${data.lateCancellations}</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Late (&lt;24h)</div>
        </div>
      </div>
    </div>

    ${data.byReason.length > 0 ? `
    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #1e293b;">By Reason</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead><tr style="background: #f8fafc;"><th style="padding: 8px 12px; text-align: left;">Reason</th><th style="padding: 8px 12px; text-align: center;">Count</th></tr></thead>
        <tbody>${reasonRows}</tbody>
      </table>
    </div>` : ''}

    ${data.byCancelledBy.length > 0 ? `
    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #1e293b;">By Who Cancelled</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead><tr style="background: #f8fafc;"><th style="padding: 8px 12px; text-align: left;">Cancelled By</th><th style="padding: 8px 12px; text-align: center;">Count</th></tr></thead>
        <tbody>${cancelledByRows}</tbody>
      </table>
    </div>` : ''}

    ${data.repeatCancellers.length > 0 ? `
    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #1e293b;">Repeat Cancellers (2+)</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead><tr style="background: #f8fafc;"><th style="padding: 8px 12px; text-align: left;">Patient</th><th style="padding: 8px 12px; text-align: center;">Cancellations</th><th style="padding: 8px 12px; text-align: center;">No-Shows</th></tr></thead>
        <tbody>${repeatRows}</tbody>
      </table>
    </div>` : ''}

    <div style="background: #f1f5f9; padding: 25px; border-radius: 0 0 12px 12px; text-align: center; border: 1px solid #e2e8f0; border-top: none;">
      ${data.reportUrl ? `<a href="${data.reportUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-weight: 500; margin-bottom: 15px;">View Full Report</a><br>` : ''}
      <p style="margin: 0; color: #64748b; font-size: 13px;">Automated weekly report from TherapyBill AI. Generated ${formatDate(new Date())}</p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendWeeklyCancellationReport(
  to: string | string[],
  data: WeeklyCancellationReportInput
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping weekly cancellation report');
    return { success: false, error: 'Email not configured' };
  }

  const recipients = Array.isArray(to) ? to : [to];
  const subject = `Weekly Cancellation Report - ${data.practiceName} - ${new Date(data.reportDate).toLocaleDateString()}`;

  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from: `"TherapyBill AI" <${fromAddress}>`,
      to: recipients.join(', '),
      subject,
      html: generateWeeklyCancellationEmailHtml(data),
    });

    console.log('Weekly cancellation report email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send weekly cancellation report email:', error);
    return { success: false, error: (error as Error).message };
  }
}

// BAA Expiration Alert Email
export interface BaaExpirationAlertData {
  practiceName: string;
  records: {
    vendorName: string;
    baaType: string;
    expirationDate: string;
    daysRemaining: number;
  }[];
}

export async function sendBaaExpirationAlert(
  to: string | string[],
  data: BaaExpirationAlertData
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping BAA expiration alert');
    return { success: false, error: 'Email not configured' };
  }

  const recipients = Array.isArray(to) ? to : [to];

  const rowsHtml = data.records.map(r => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${r.vendorName}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${r.baaType}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${r.expirationDate}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: ${r.daysRemaining <= 7 ? '#dc2626' : r.daysRemaining <= 14 ? '#f59e0b' : '#64748b'};">
        ${r.daysRemaining} days
      </td>
    </tr>
  `).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>BAA Expiration Alert</title></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f8fafc;">
  <div style="max-width: 700px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0 0 10px 0; font-size: 24px;">BAA Expiration Alert</h1>
      <p style="margin: 0; opacity: 0.9;">${data.practiceName}</p>
    </div>
    <div style="background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
      <p style="color: #1e293b;">The following Business Associate Agreements are expiring within 30 days and require immediate attention:</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background: #f8fafc;">
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Vendor</th>
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Type</th>
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Expiration Date</th>
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0;">Days Remaining</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div style="background: #f1f5f9; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border: 1px solid #e2e8f0; border-top: none;">
      <p style="margin: 0; color: #64748b; font-size: 13px;">Please renew these agreements promptly to maintain HIPAA compliance.<br>This is an automated alert from TherapyBill AI.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `BAA EXPIRATION ALERT - ${data.practiceName}\n\nThe following BAAs are expiring within 30 days:\n\n` +
    data.records.map(r => `- ${r.vendorName} (${r.baaType}): Expires ${r.expirationDate} (${r.daysRemaining} days remaining)`).join('\n') +
    '\n\nPlease renew these agreements promptly to maintain HIPAA compliance.';

  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from: `"TherapyBill AI" <${fromAddress}>`,
      to: recipients.join(', '),
      subject: `BAA Expiration Alert - ${data.records.length} agreement(s) expiring soon`,
      text,
      html,
    });
    console.log('BAA expiration alert sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send BAA expiration alert:', error);
    return { success: false, error: (error as Error).message };
  }
}

// Coverage Change Alert Email
export interface CoverageChangeAlertData {
  practiceName: string;
  patientName: string;
  previousStatus: string;
  newStatus: string;
  recommendedAction: string;
}

export async function sendCoverageChangeAlert(
  to: string | string[],
  data: CoverageChangeAlertData
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping coverage change alert');
    return { success: false, error: 'Email not configured' };
  }

  const recipients = Array.isArray(to) ? to : [to];

  const statusColor = (s: string) => s === 'active' ? '#22c55e' : s === 'inactive' ? '#dc2626' : '#f59e0b';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Coverage Change Alert</title></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0 0 10px 0; font-size: 24px;">Coverage Change Detected</h1>
      <p style="margin: 0; opacity: 0.9;">${data.practiceName}</p>
    </div>
    <div style="background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
      <h2 style="margin: 0 0 20px 0; font-size: 18px; color: #1e293b;">Patient: ${data.patientName}</h2>
      <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px;">
        <div style="flex: 1; text-align: center; padding: 15px; background: #fef2f2; border-radius: 8px;">
          <div style="font-size: 12px; color: #64748b; margin-bottom: 5px;">Previous Status</div>
          <div style="font-size: 18px; font-weight: 700; color: ${statusColor(data.previousStatus)};">${data.previousStatus.toUpperCase()}</div>
        </div>
        <div style="font-size: 24px; color: #94a3b8;">&#8594;</div>
        <div style="flex: 1; text-align: center; padding: 15px; background: #fef2f2; border-radius: 8px;">
          <div style="font-size: 12px; color: #64748b; margin-bottom: 5px;">New Status</div>
          <div style="font-size: 18px; font-weight: 700; color: ${statusColor(data.newStatus)};">${data.newStatus.toUpperCase()}</div>
        </div>
      </div>
      <div style="background: #fffbeb; border: 1px solid #fef08a; border-radius: 8px; padding: 15px;">
        <strong style="color: #92400e;">Recommended Action:</strong>
        <p style="margin: 5px 0 0 0; color: #78350f;">${data.recommendedAction}</p>
      </div>
    </div>
    <div style="background: #f1f5f9; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border: 1px solid #e2e8f0; border-top: none;">
      <p style="margin: 0; color: #64748b; font-size: 13px;">This is an automated alert from TherapyBill AI.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `COVERAGE CHANGE ALERT - ${data.practiceName}\n\nPatient: ${data.patientName}\nPrevious Status: ${data.previousStatus}\nNew Status: ${data.newStatus}\n\nRecommended Action: ${data.recommendedAction}`;

  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from: `"TherapyBill AI" <${fromAddress}>`,
      to: recipients.join(', '),
      subject: `Coverage Change Alert - ${data.patientName}`,
      text,
      html,
    });
    console.log('Coverage change alert sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send coverage change alert:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ==================== HIPAA COMPLIANCE EMAIL TEMPLATES ====================

// Breach Notification Alert
export async function sendBreachNotificationAlert(
  to: string | string[],
  data: {
    practiceName: string;
    breachDescription: string;
    discoveredAt: Date;
    phiInvolved: string;
    remediationSteps: string;
    affectedCount: number;
    breachType: string;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping breach notification alert');
    return { success: false, error: 'Email not configured' };
  }

  const recipients = Array.isArray(to) ? to : [to];
  const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from: `"TherapyBill AI - URGENT" <${fromAddress}>`,
      to: recipients.join(', '),
      subject: `[URGENT] HIPAA Breach Notification - ${data.practiceName}`,
      html: `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;">
  <div style="max-width:650px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#dc2626 0%,#991b1b 100%);color:white;padding:30px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0 0 10px 0;font-size:24px;">HIPAA Breach Incident Report</h1>
      <p style="margin:0;opacity:0.9;">${data.practiceName}</p>
    </div>
    <div style="background:white;padding:30px;border:1px solid #e2e8f0;">
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:20px;margin-bottom:20px;">
        <h3 style="margin:0 0 10px;color:#991b1b;">Breach Details</h3>
        <p><strong>Discovery Date:</strong> ${formatDate(data.discoveredAt)}</p>
        <p><strong>Type:</strong> ${data.breachType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
        <p><strong>Affected Individuals:</strong> ${data.affectedCount}</p>
      </div>
      <h3 style="color:#1e293b;">Description</h3>
      <p style="color:#475569;">${data.breachDescription}</p>
      <h3 style="color:#1e293b;">PHI Involved</h3>
      <p style="color:#475569;">${data.phiInvolved}</p>
      <h3 style="color:#1e293b;">Remediation Steps</h3>
      <p style="color:#475569;">${data.remediationSteps}</p>
      <div style="background:#fefce8;border:1px solid #fef08a;border-radius:8px;padding:15px;margin-top:20px;">
        <strong style="color:#854d0e;">Reminder:</strong> HIPAA requires notification to affected individuals within 60 days of discovery. If 500+ individuals are affected, HHS and media must also be notified.
      </div>
    </div>
    <div style="background:#f1f5f9;padding:20px;border-radius:0 0 12px 12px;text-align:center;border:1px solid #e2e8f0;border-top:none;">
      <p style="margin:0;color:#64748b;font-size:13px;">Automated breach alert from TherapyBill AI</p>
    </div>
  </div>
</body></html>`,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send breach notification alert:', error);
    return { success: false, error: (error as Error).message };
  }
}

// Amendment Request Notification
export async function sendAmendmentRequestNotification(
  to: string | string[],
  data: { patientName: string; fieldToAmend: string; requestDate: Date; deadline: Date; practiceName: string }
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) return { success: false, error: 'Email not configured' };

  const recipients = Array.isArray(to) ? to : [to];
  const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  try {
    const transport = getTransporter();
    await transport.sendMail({
      from: `"TherapyBill AI" <${fromAddress}>`,
      to: recipients.join(', '),
      subject: `New Amendment Request - ${data.patientName}`,
      html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <h2 style="color:#2563eb;">New Patient Amendment Request</h2>
  <p>A patient has submitted an amendment request for their medical records.</p>
  <div style="background:#f0f9ff;padding:15px;border-radius:8px;margin:20px 0;">
    <p><strong>Patient:</strong> ${data.patientName}</p>
    <p><strong>Field:</strong> ${data.fieldToAmend}</p>
    <p><strong>Request Date:</strong> ${formatDate(data.requestDate)}</p>
    <p><strong>Response Deadline:</strong> ${formatDate(data.deadline)}</p>
  </div>
  <p>Please review and respond to this request within the HIPAA-required timeframe (60 days).</p>
  <p style="color:#64748b;font-size:12px;margin-top:30px;">This email was sent by TherapyBill AI for ${data.practiceName}</p>
</div>`,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// Amendment Deadline Alert
export async function sendAmendmentDeadlineAlert(
  to: string | string[],
  data: { patientName: string; fieldToAmend: string; deadline: Date; daysRemaining: number; practiceName: string }
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) return { success: false, error: 'Email not configured' };

  const recipients = Array.isArray(to) ? to : [to];
  const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  try {
    const transport = getTransporter();
    await transport.sendMail({
      from: `"TherapyBill AI - URGENT" <${fromAddress}>`,
      to: recipients.join(', '),
      subject: `[URGENT] Amendment Request Deadline Approaching - ${data.daysRemaining} days remaining`,
      html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <h2 style="color:#f59e0b;">Amendment Request Deadline Approaching</h2>
  <div style="background:#fefce8;border:1px solid #fef08a;padding:15px;border-radius:8px;margin:20px 0;">
    <p><strong style="color:#854d0e;">Only ${data.daysRemaining} days remaining to respond!</strong></p>
    <p><strong>Patient:</strong> ${data.patientName}</p>
    <p><strong>Field:</strong> ${data.fieldToAmend}</p>
    <p><strong>Deadline:</strong> ${formatDate(data.deadline)}</p>
  </div>
  <p>HIPAA requires a response within 60 days of the request. Please review and approve or deny this request promptly.</p>
  <p style="color:#64748b;font-size:12px;margin-top:30px;">This email was sent by TherapyBill AI for ${data.practiceName}</p>
</div>`,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// Send authorization SMS (placeholder - would integrate with SMS service like Twilio)
export async function sendAuthorizationSMS(
  practice: any,
  patient: any,
  message: string
): Promise<{ success: boolean; error?: string }> {
  // SMS integration would go here (e.g., Twilio)
  // For now, just log and return success
  console.log(`SMS would be sent to ${patient.phone}: ${message}`);
  return { success: true };
}

// ==================== PASSWORD AUTHENTICATION EMAIL TEMPLATES ====================

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  to: string,
  data: {
    resetUrl: string;
    firstName: string;
    expiresInMinutes: number;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping password reset email');
    return { success: false, error: 'Email not configured' };
  }

  try {
    const transport = getTransporter();

    await transport.sendMail({
      from: `"TherapyBill AI" <${fromAddress}>`,
      to,
      subject: 'Reset Your Password - TherapyBill AI',
      text: `Hi ${data.firstName},

We received a request to reset your password for your TherapyBill AI account.

Click the link below to reset your password:
${data.resetUrl}

This link will expire in ${data.expiresInMinutes} minutes.

If you didn't request this password reset, you can safely ignore this email. Your password will not be changed.

For security, this link can only be used once. If you need to reset your password again, please request a new link.

Best regards,
The TherapyBill AI Team`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Reset Your Password</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#2563eb 0%,#1d4ed8 100%);color:white;padding:30px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0;font-size:24px;">Reset Your Password</h1>
    </div>
    <div style="background:white;padding:30px;border:1px solid #e2e8f0;border-top:none;">
      <p style="color:#1e293b;">Hi ${data.firstName},</p>
      <p style="color:#475569;">We received a request to reset your password for your TherapyBill AI account.</p>
      <div style="text-align:center;margin:30px 0;">
        <a href="${data.resetUrl}" style="display:inline-block;padding:14px 28px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-weight:600;">Reset Password</a>
      </div>
      <p style="color:#64748b;font-size:14px;">This link will expire in ${data.expiresInMinutes} minutes.</p>
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:15px;margin-top:20px;">
        <p style="margin:0;color:#92400e;font-size:14px;">
          <strong>Didn't request this?</strong> You can safely ignore this email. Your password will not be changed.
        </p>
      </div>
    </div>
    <div style="background:#f1f5f9;padding:20px;border-radius:0 0 12px 12px;text-align:center;border:1px solid #e2e8f0;border-top:none;">
      <p style="margin:0;color:#64748b;font-size:13px;">This is an automated message from TherapyBill AI.</p>
    </div>
  </div>
</body>
</html>`,
    });

    console.log('Password reset email sent to:', to);
    return { success: true };
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Send email verification email
 */
export async function sendEmailVerificationEmail(
  to: string,
  data: {
    verificationUrl: string;
    firstName: string;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping email verification');
    return { success: false, error: 'Email not configured' };
  }

  try {
    const transport = getTransporter();

    await transport.sendMail({
      from: `"TherapyBill AI" <${fromAddress}>`,
      to,
      subject: 'Verify Your Email - TherapyBill AI',
      text: `Hi ${data.firstName},

Welcome to TherapyBill AI! Please verify your email address by clicking the link below:

${data.verificationUrl}

This link will expire in 24 hours.

If you didn't create an account with TherapyBill AI, you can safely ignore this email.

Best regards,
The TherapyBill AI Team`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Verify Your Email</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:white;padding:30px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0;font-size:24px;">Welcome to TherapyBill AI!</h1>
    </div>
    <div style="background:white;padding:30px;border:1px solid #e2e8f0;border-top:none;">
      <p style="color:#1e293b;">Hi ${data.firstName},</p>
      <p style="color:#475569;">Thank you for creating an account! Please verify your email address to get started.</p>
      <div style="text-align:center;margin:30px 0;">
        <a href="${data.verificationUrl}" style="display:inline-block;padding:14px 28px;background:#22c55e;color:white;text-decoration:none;border-radius:8px;font-weight:600;">Verify Email Address</a>
      </div>
      <p style="color:#64748b;font-size:14px;">This link will expire in 24 hours.</p>
      <p style="color:#64748b;font-size:14px;">If you didn't create an account with TherapyBill AI, you can safely ignore this email.</p>
    </div>
    <div style="background:#f1f5f9;padding:20px;border-radius:0 0 12px 12px;text-align:center;border:1px solid #e2e8f0;border-top:none;">
      <p style="margin:0;color:#64748b;font-size:13px;">This is an automated message from TherapyBill AI.</p>
    </div>
  </div>
</body>
</html>`,
    });

    console.log('Email verification sent to:', to);
    return { success: true };
  } catch (error) {
    console.error('Failed to send email verification:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Send security alert email (account lockout, password changed, etc.)
 */
export async function sendSecurityAlertEmail(
  to: string,
  data: {
    alertType: 'account_lockout' | 'password_changed' | 'new_login' | 'mfa_enabled' | 'mfa_disabled';
    ipAddress?: string;
    timestamp: Date;
    failedAttempts?: number;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping security alert email');
    return { success: false, error: 'Email not configured' };
  }

  const formatDate = (d: Date) => new Date(d).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const alertConfig = {
    account_lockout: {
      subject: 'Security Alert: Account Temporarily Locked',
      title: 'Account Temporarily Locked',
      color: '#dc2626',
      message: `Your account has been temporarily locked due to ${data.failedAttempts} failed login attempts. This is a security measure to protect your account.`,
      action: 'If this was you, please wait 15 minutes before trying again. If you forgot your password, use the password reset option.',
    },
    password_changed: {
      subject: 'Security Alert: Password Changed',
      title: 'Password Changed Successfully',
      color: '#22c55e',
      message: 'Your password was successfully changed.',
      action: 'If you did not make this change, please contact support immediately.',
    },
    new_login: {
      subject: 'Security Alert: New Login Detected',
      title: 'New Login Detected',
      color: '#2563eb',
      message: 'A new login to your account was detected.',
      action: 'If this was not you, please change your password immediately.',
    },
    mfa_enabled: {
      subject: 'Security Alert: Two-Factor Authentication Enabled',
      title: 'Two-Factor Authentication Enabled',
      color: '#22c55e',
      message: 'Two-factor authentication has been enabled on your account.',
      action: 'If you did not make this change, please contact support immediately.',
    },
    mfa_disabled: {
      subject: 'Security Alert: Two-Factor Authentication Disabled',
      title: 'Two-Factor Authentication Disabled',
      color: '#f59e0b',
      message: 'Two-factor authentication has been disabled on your account.',
      action: 'If you did not make this change, please contact support immediately and consider re-enabling 2FA.',
    },
  };

  const config = alertConfig[data.alertType];

  try {
    const transport = getTransporter();

    await transport.sendMail({
      from: `"TherapyBill AI Security" <${fromAddress}>`,
      to,
      subject: config.subject,
      text: `${config.title}

${config.message}

Time: ${formatDate(data.timestamp)}
${data.ipAddress ? `IP Address: ${data.ipAddress}` : ''}

${config.action}

If you have any concerns, please contact our support team.

Best regards,
The TherapyBill AI Security Team`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${config.title}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,${config.color} 0%,${config.color}dd 100%);color:white;padding:30px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0;font-size:24px;">${config.title}</h1>
    </div>
    <div style="background:white;padding:30px;border:1px solid #e2e8f0;border-top:none;">
      <p style="color:#475569;">${config.message}</p>
      <div style="background:#f8fafc;border-radius:8px;padding:15px;margin:20px 0;">
        <p style="margin:0 0 8px 0;color:#64748b;font-size:14px;"><strong>Time:</strong> ${formatDate(data.timestamp)}</p>
        ${data.ipAddress ? `<p style="margin:0;color:#64748b;font-size:14px;"><strong>IP Address:</strong> ${data.ipAddress}</p>` : ''}
      </div>
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:15px;">
        <p style="margin:0;color:#92400e;font-size:14px;">
          <strong>Important:</strong> ${config.action}
        </p>
      </div>
    </div>
    <div style="background:#f1f5f9;padding:20px;border-radius:0 0 12px 12px;text-align:center;border:1px solid #e2e8f0;border-top:none;">
      <p style="margin:0;color:#64748b;font-size:13px;">This is an automated security alert from TherapyBill AI.</p>
    </div>
  </div>
</body>
</html>`,
    });

    console.log('Security alert email sent to:', to);
    return { success: true };
  } catch (error) {
    console.error('Failed to send security alert email:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ==================== BREACH PATIENT NOTIFICATION (45 CFR 164.404) ====================

/**
 * Generate and send HIPAA-compliant breach notification letter to affected patients.
 * Per 45 CFR 164.404(c), must include:
 * 1. Description of the breach
 * 2. Types of PHI involved
 * 3. Steps individuals should take to protect themselves
 * 4. What the entity is doing to investigate and mitigate
 * 5. Contact information for the entity
 */
export async function sendPatientBreachNotification(
  to: string,
  data: {
    patientName: string;
    practiceName: string;
    practicePhone: string;
    practiceAddress: string;
    breachDate: string;
    discoveredDate: string;
    breachDescription: string;
    phiTypesInvolved: string[];
    mitigationSteps: string;
    protectiveSteps: string[];
    contactEmail: string;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    console.log('Email not configured, skipping patient breach notification');
    return { success: false, error: 'Email not configured' };
  }

  const phiList = data.phiTypesInvolved.map(t => `<li>${t}</li>`).join('');
  const protectiveList = data.protectiveSteps.map(s => `<li style="margin-bottom:8px;">${s}</li>`).join('');

  try {
    const transport = getTransporter();
    await transport.sendMail({
      from: `"${data.practiceName}" <${fromAddress}>`,
      to,
      subject: `Important Notice: Breach of Your Protected Health Information - ${data.practiceName}`,
      html: `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;">
  <div style="max-width:650px;margin:0 auto;padding:20px;">
    <div style="background:white;padding:40px;border:1px solid #e2e8f0;border-radius:8px;">
      <p style="color:#1e293b;font-size:14px;margin-bottom:20px;">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
      <p style="color:#1e293b;font-size:14px;">Dear ${data.patientName},</p>

      <p style="color:#1e293b;font-size:14px;">We are writing to notify you of a breach of your protected health information (PHI) as required by the Health Insurance Portability and Accountability Act (HIPAA).</p>

      <h3 style="color:#991b1b;margin-top:24px;">What Happened</h3>
      <p style="color:#475569;font-size:14px;">${data.breachDescription}</p>
      <p style="color:#475569;font-size:14px;"><strong>Date of Breach:</strong> ${data.breachDate}<br/><strong>Date Discovered:</strong> ${data.discoveredDate}</p>

      <h3 style="color:#991b1b;">What Information Was Involved</h3>
      <p style="color:#475569;font-size:14px;">The following types of your protected health information may have been involved:</p>
      <ul style="color:#475569;font-size:14px;">${phiList}</ul>

      <h3 style="color:#991b1b;">What We Are Doing</h3>
      <p style="color:#475569;font-size:14px;">${data.mitigationSteps}</p>

      <h3 style="color:#991b1b;">What You Can Do</h3>
      <p style="color:#475569;font-size:14px;">We recommend you take the following steps to protect yourself:</p>
      <ul style="color:#475569;font-size:14px;">${protectiveList}</ul>

      <div style="background:#f1f5f9;border-radius:8px;padding:20px;margin-top:24px;">
        <h3 style="color:#1e293b;margin-top:0;">Contact Information</h3>
        <p style="color:#475569;font-size:14px;margin:0;">
          If you have questions or concerns, please contact us:<br/>
          <strong>${data.practiceName}</strong><br/>
          ${data.practiceAddress}<br/>
          Phone: ${data.practicePhone}<br/>
          Email: ${data.contactEmail}
        </p>
      </div>

      <p style="color:#1e293b;font-size:14px;margin-top:24px;">
        You may also file a complaint with the U.S. Department of Health and Human Services Office for Civil Rights at
        <a href="https://www.hhs.gov/ocr/complaints">www.hhs.gov/ocr/complaints</a> or call 1-877-696-6775.
      </p>

      <p style="color:#1e293b;font-size:14px;">Sincerely,<br/>${data.practiceName}</p>
    </div>
  </div>
</body></html>`,
      text: `NOTICE OF BREACH OF PROTECTED HEALTH INFORMATION

Dear ${data.patientName},

We are writing to notify you of a breach of your protected health information (PHI) as required by HIPAA.

WHAT HAPPENED: ${data.breachDescription}
Date of Breach: ${data.breachDate}
Date Discovered: ${data.discoveredDate}

WHAT INFORMATION WAS INVOLVED: ${data.phiTypesInvolved.join(', ')}

WHAT WE ARE DOING: ${data.mitigationSteps}

WHAT YOU CAN DO: ${data.protectiveSteps.join('; ')}

CONTACT: ${data.practiceName}, ${data.practicePhone}, ${data.contactEmail}

You may also file a complaint with HHS OCR at www.hhs.gov/ocr/complaints or 1-877-696-6775.

Sincerely,
${data.practiceName}`,
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to send patient breach notification:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Generate State Attorney General notification letter content.
 * Returns HTML and text versions for the admin to review/send.
 */
export function generateStateAgNotificationLetter(data: {
  practiceName: string;
  practiceAddress: string;
  practicePhone: string;
  contactName: string;
  contactEmail: string;
  stateName: string;
  breachDate: string;
  discoveredDate: string;
  breachDescription: string;
  breachType: string;
  affectedCount: number;
  phiTypesInvolved: string[];
  mitigationSteps: string;
  remediationSteps: string;
}): { subject: string; text: string } {
  return {
    subject: `HIPAA Breach Notification - ${data.practiceName} - ${data.affectedCount} Individuals Affected`,
    text: `${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

Office of the Attorney General
State of ${data.stateName}

Re: Notification of Breach of Protected Health Information
    Pursuant to HIPAA Breach Notification Rule (45 CFR Part 164, Subpart D)

Dear Attorney General:

${data.practiceName} is writing to notify your office of a breach of unsecured protected health information (PHI) affecting approximately ${data.affectedCount} residents of ${data.stateName}.

ENTITY INFORMATION:
Name: ${data.practiceName}
Address: ${data.practiceAddress}
Contact: ${data.contactName}
Phone: ${data.practicePhone}
Email: ${data.contactEmail}

BREACH DETAILS:
Type: ${data.breachType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
Date of Breach: ${data.breachDate}
Date Discovered: ${data.discoveredDate}
Number of Individuals Affected: ${data.affectedCount}

DESCRIPTION:
${data.breachDescription}

PHI TYPES INVOLVED:
${data.phiTypesInvolved.map(t => `- ${t}`).join('\n')}

MITIGATION AND REMEDIATION:
${data.mitigationSteps}

${data.remediationSteps}

NOTIFICATION TO INDIVIDUALS:
Affected individuals have been or will be notified in writing within the timeframe required by 45 CFR 164.404.

NOTIFICATION TO HHS:
The U.S. Department of Health and Human Services has been or will be notified as required by 45 CFR 164.408.

We are committed to protecting the privacy and security of our patients' health information and are taking all necessary steps to prevent future incidents.

Respectfully,

${data.contactName}
${data.practiceName}
${data.practicePhone}
${data.contactEmail}`,
  };
}

/**
 * Generate HHS breach report form data per 45 CFR 164.408.
 * This produces the structured data needed for submission to
 * the HHS Breach Portal (https://ocrportal.hhs.gov/ocr/breach/wizard_breach.jsf).
 */
export function generateHhsReportData(data: {
  practiceName: string;
  practiceAddress: string;
  practicePhone: string;
  contactName: string;
  contactEmail: string;
  breachDate: string;
  discoveredDate: string;
  breachDescription: string;
  breachType: string;
  affectedCount: number;
  phiTypesInvolved: string[];
  mitigationSteps: string;
  locationOfBreachedInfo: string;
  safeguardsInPlace: string;
  individualNotificationDate: string | null;
  individualNotificationMethod: string;
}): Record<string, any> {
  const isLargeBreach = data.affectedCount >= 500;
  return {
    entityName: data.practiceName,
    entityType: 'Healthcare Provider',
    entityAddress: data.practiceAddress,
    entityPhone: data.practicePhone,
    contactPerson: data.contactName,
    contactEmail: data.contactEmail,
    breachDetails: {
      dateOfBreach: data.breachDate,
      dateDiscovered: data.discoveredDate,
      dateReportedToHHS: new Date().toISOString().split('T')[0],
      typeOfBreach: data.breachType,
      locationOfBreachedInfo: data.locationOfBreachedInfo,
      description: data.breachDescription,
    },
    affectedIndividuals: {
      count: data.affectedCount,
      isLargeBreach,
      reportingDeadline: isLargeBreach ? '60 days from discovery' : 'Annual log submission (within 60 days of calendar year end)',
    },
    phiInvolved: {
      types: data.phiTypesInvolved,
    },
    safeguards: {
      priorToBreachSafeguards: data.safeguardsInPlace,
      mitigationActions: data.mitigationSteps,
    },
    individualNotification: {
      notified: !!data.individualNotificationDate,
      dateNotified: data.individualNotificationDate,
      method: data.individualNotificationMethod,
      substituteNoticeRequired: data.affectedCount >= 10 && !data.individualNotificationDate,
    },
    mediaNotification: {
      required: isLargeBreach,
      reason: isLargeBreach ? 'Breach affects 500 or more individuals' : 'Not required (fewer than 500 individuals)',
    },
  };
}

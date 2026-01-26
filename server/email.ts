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

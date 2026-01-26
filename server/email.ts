import nodemailer from 'nodemailer';
import type { Practice, Patient, PatientInsuranceAuthorization } from '@shared/schema';

// Email configuration
const emailConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
};

// Lazy initialization of transporter
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport(emailConfig);
  }
  return transporter;
}

// Helper to get branded styles
function getBrandedStyles(practice: Practice) {
  const primaryColor = practice.brandPrimaryColor || '#2563eb';
  const secondaryColor = practice.brandSecondaryColor || '#1e40af';

  return {
    primaryColor,
    secondaryColor,
    containerStyle: `
      max-width: 600px;
      margin: 0 auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
    `,
    headerStyle: `
      background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor});
      padding: 30px 20px;
      text-align: center;
      border-radius: 8px 8px 0 0;
    `,
    logoStyle: `
      max-height: 60px;
      max-width: 200px;
    `,
    titleStyle: `
      color: white;
      margin: 15px 0 0 0;
      font-size: 24px;
      font-weight: 600;
    `,
    bodyStyle: `
      background: #ffffff;
      padding: 30px;
      border: 1px solid #e5e7eb;
      border-top: none;
    `,
    buttonStyle: `
      display: inline-block;
      background-color: ${primaryColor};
      color: white;
      padding: 14px 32px;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
      margin: 20px 0;
    `,
    footerStyle: `
      background: #f9fafb;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #6b7280;
      border: 1px solid #e5e7eb;
      border-top: none;
      border-radius: 0 0 8px 8px;
    `,
  };
}

// Authorization Request Email
export async function sendAuthorizationRequestEmail(
  practice: Practice,
  patient: Patient,
  authorization: PatientInsuranceAuthorization,
  authorizationUrl: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const styles = getBrandedStyles(practice);
  const fromName = practice.brandEmailFromName || practice.name;
  const scopes = (authorization.scopes as string[]) || ['eligibility'];

  const scopeDescriptions: Record<string, string> = {
    eligibility: 'Insurance eligibility and coverage status',
    benefits: 'Detailed benefits information (deductibles, copays, coverage limits)',
    claims_history: 'Claims history and payment records',
    prior_auth: 'Prior authorization requirements and status',
  };

  const requestedDataList = scopes
    .map(scope => scopeDescriptions[scope] || scope)
    .map(desc => `<li style="margin-bottom: 8px;">${desc}</li>`)
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Insurance Authorization Request</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
  <div style="${styles.containerStyle}">
    <!-- Header -->
    <div style="${styles.headerStyle}">
      ${practice.brandLogoUrl ? `<img src="${practice.brandLogoUrl}" alt="${practice.name}" style="${styles.logoStyle}">` : ''}
      <h1 style="${styles.titleStyle}">${practice.name}</h1>
    </div>

    <!-- Body -->
    <div style="${styles.bodyStyle}">
      <p style="font-size: 16px;">Dear ${patient.firstName},</p>

      <p>We are requesting your authorization to access your insurance information to better serve your healthcare needs at <strong>${practice.name}</strong>.</p>

      <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 16px; margin: 20px 0;">
        <h3 style="margin: 0 0 12px 0; color: ${styles.primaryColor}; font-size: 16px;">Information We're Requesting Access To:</h3>
        <ul style="margin: 0; padding-left: 20px; color: #334155;">
          ${requestedDataList}
        </ul>
      </div>

      <p>This authorization allows us to:</p>
      <ul style="color: #334155;">
        <li>Verify your insurance coverage before appointments</li>
        <li>Provide accurate cost estimates</li>
        <li>Submit claims efficiently on your behalf</li>
        <li>Check prior authorization requirements</li>
      </ul>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${authorizationUrl}" style="${styles.buttonStyle}">
          Review & Authorize Access
        </a>
      </div>

      <p style="font-size: 14px; color: #6b7280;">
        This link will expire in 7 days. If you did not expect this request, please contact us at
        <a href="mailto:${practice.email}" style="color: ${styles.primaryColor};">${practice.email}</a>.
      </p>

      <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 20px;">
        <p style="font-size: 14px; color: #6b7280; margin: 0;">
          <strong>Your Privacy Matters:</strong> Your information will only be used for healthcare purposes and will be protected in accordance with HIPAA regulations. You can revoke this authorization at any time by contacting our office.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="${styles.footerStyle}">
      <p style="margin: 0 0 8px 0;"><strong>${practice.name}</strong></p>
      ${practice.address ? `<p style="margin: 0 0 8px 0;">${practice.address}</p>` : ''}
      ${practice.phone ? `<p style="margin: 0 0 8px 0;">Phone: ${practice.phone}</p>` : ''}
      ${practice.brandPrivacyPolicyUrl ? `<p style="margin: 0;"><a href="${practice.brandPrivacyPolicyUrl}" style="color: ${styles.primaryColor};">Privacy Policy</a></p>` : ''}
    </div>
  </div>
</body>
</html>
  `;

  const text = `
Insurance Authorization Request from ${practice.name}

Dear ${patient.firstName},

We are requesting your authorization to access your insurance information to better serve your healthcare needs at ${practice.name}.

Information We're Requesting Access To:
${scopes.map(scope => `- ${scopeDescriptions[scope] || scope}`).join('\n')}

To review and authorize this request, please visit:
${authorizationUrl}

This link will expire in 7 days.

If you did not expect this request, please contact us at ${practice.email}.

Your Privacy Matters: Your information will only be used for healthcare purposes and will be protected in accordance with HIPAA regulations.

${practice.name}
${practice.address || ''}
${practice.phone ? `Phone: ${practice.phone}` : ''}
  `.trim();

  const toEmail = authorization.deliveryAddress || patient.email;
  if (!toEmail) {
    return { success: false, error: 'No email address available' };
  }

  try {
    const result = await getTransporter().sendMail({
      from: `"${fromName}" <${practice.brandEmailReplyTo || practice.email || emailConfig.auth.user}>`,
      to: toEmail,
      subject: `Insurance Authorization Request from ${practice.name}`,
      text,
      html,
    });

    return { success: true, messageId: (result as any).messageId };
  } catch (error) {
    console.error('Error sending authorization request email:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Reminder Email
export async function sendAuthorizationReminderEmail(
  practice: Practice,
  patient: Patient,
  authorization: PatientInsuranceAuthorization,
  authorizationUrl: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const styles = getBrandedStyles(practice);
  const fromName = practice.brandEmailFromName || practice.name;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reminder: Insurance Authorization Request</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
  <div style="${styles.containerStyle}">
    <!-- Header -->
    <div style="${styles.headerStyle}">
      ${practice.brandLogoUrl ? `<img src="${practice.brandLogoUrl}" alt="${practice.name}" style="${styles.logoStyle}">` : ''}
      <h1 style="${styles.titleStyle}">${practice.name}</h1>
    </div>

    <!-- Body -->
    <div style="${styles.bodyStyle}">
      <p style="font-size: 16px;">Dear ${patient.firstName},</p>

      <p>This is a friendly reminder that we're still waiting for your authorization to access your insurance information.</p>

      <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 6px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; color: #92400e;">
          <strong>Action Required:</strong> Please complete your authorization to help us serve you better.
        </p>
      </div>

      <p>By authorizing access to your insurance information, we can:</p>
      <ul style="color: #334155;">
        <li>Verify your coverage before your appointments</li>
        <li>Provide accurate cost estimates</li>
        <li>Process claims more efficiently</li>
      </ul>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${authorizationUrl}" style="${styles.buttonStyle}">
          Complete Authorization
        </a>
      </div>

      <p style="font-size: 14px; color: #6b7280;">
        If you've already completed this authorization, please disregard this email.
      </p>
    </div>

    <!-- Footer -->
    <div style="${styles.footerStyle}">
      <p style="margin: 0 0 8px 0;"><strong>${practice.name}</strong></p>
      ${practice.phone ? `<p style="margin: 0 0 8px 0;">Phone: ${practice.phone}</p>` : ''}
      ${practice.email ? `<p style="margin: 0;"><a href="mailto:${practice.email}" style="color: ${styles.primaryColor};">${practice.email}</a></p>` : ''}
    </div>
  </div>
</body>
</html>
  `;

  const text = `
Reminder: Insurance Authorization Request from ${practice.name}

Dear ${patient.firstName},

This is a friendly reminder that we're still waiting for your authorization to access your insurance information.

To complete your authorization, please visit:
${authorizationUrl}

By authorizing access, we can verify your coverage, provide accurate cost estimates, and process claims more efficiently.

If you've already completed this authorization, please disregard this email.

${practice.name}
${practice.phone ? `Phone: ${practice.phone}` : ''}
${practice.email || ''}
  `.trim();

  const toEmail = authorization.deliveryAddress || patient.email;
  if (!toEmail) {
    return { success: false, error: 'No email address available' };
  }

  try {
    const result = await getTransporter().sendMail({
      from: `"${fromName}" <${practice.brandEmailReplyTo || practice.email || emailConfig.auth.user}>`,
      to: toEmail,
      subject: `Reminder: Insurance Authorization Request from ${practice.name}`,
      text,
      html,
    });

    return { success: true, messageId: (result as any).messageId };
  } catch (error) {
    console.error('Error sending authorization reminder email:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Confirmation Email (after patient authorizes)
export async function sendAuthorizationConfirmationEmail(
  practice: Practice,
  patient: Patient,
  authorization: PatientInsuranceAuthorization
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const styles = getBrandedStyles(practice);
  const fromName = practice.brandEmailFromName || practice.name;
  const scopes = (authorization.scopes as string[]) || ['eligibility'];

  const scopeDescriptions: Record<string, string> = {
    eligibility: 'Insurance eligibility',
    benefits: 'Benefits information',
    claims_history: 'Claims history',
    prior_auth: 'Prior authorization',
  };

  const authorizedDataList = scopes
    .map(scope => scopeDescriptions[scope] || scope)
    .map(desc => `<li>${desc}</li>`)
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Confirmed</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
  <div style="${styles.containerStyle}">
    <!-- Header -->
    <div style="${styles.headerStyle}">
      ${practice.brandLogoUrl ? `<img src="${practice.brandLogoUrl}" alt="${practice.name}" style="${styles.logoStyle}">` : ''}
      <h1 style="${styles.titleStyle}">${practice.name}</h1>
    </div>

    <!-- Body -->
    <div style="${styles.bodyStyle}">
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="display: inline-block; background: #dcfce7; border-radius: 50%; padding: 15px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
            <polyline points="20,6 9,17 4,12"></polyline>
          </svg>
        </div>
      </div>

      <h2 style="text-align: center; color: #16a34a; margin: 0 0 20px 0;">Authorization Confirmed</h2>

      <p style="font-size: 16px;">Dear ${patient.firstName},</p>

      <p>Thank you for authorizing <strong>${practice.name}</strong> to access your insurance information. Your authorization has been successfully recorded.</p>

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 16px; margin: 20px 0;">
        <h3 style="margin: 0 0 12px 0; color: #166534; font-size: 16px;">You've Authorized Access To:</h3>
        <ul style="margin: 0; padding-left: 20px; color: #166534;">
          ${authorizedDataList}
        </ul>
      </div>

      <p>This authorization helps us provide you with:</p>
      <ul style="color: #334155;">
        <li>Accurate insurance verification before visits</li>
        <li>Transparent cost estimates</li>
        <li>Faster claims processing</li>
      </ul>

      <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 20px;">
        <p style="font-size: 14px; color: #6b7280; margin: 0;">
          <strong>Need to make changes?</strong> You can revoke this authorization at any time by contacting our office at
          <a href="mailto:${practice.email}" style="color: ${styles.primaryColor};">${practice.email}</a> or
          ${practice.phone ? `calling ${practice.phone}` : 'calling our office'}.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="${styles.footerStyle}">
      <p style="margin: 0 0 8px 0;"><strong>${practice.name}</strong></p>
      ${practice.address ? `<p style="margin: 0 0 8px 0;">${practice.address}</p>` : ''}
      ${practice.phone ? `<p style="margin: 0;">Phone: ${practice.phone}</p>` : ''}
    </div>
  </div>
</body>
</html>
  `;

  const text = `
Authorization Confirmed

Dear ${patient.firstName},

Thank you for authorizing ${practice.name} to access your insurance information. Your authorization has been successfully recorded.

You've Authorized Access To:
${scopes.map(scope => `- ${scopeDescriptions[scope] || scope}`).join('\n')}

This authorization helps us provide you with accurate insurance verification, transparent cost estimates, and faster claims processing.

Need to make changes? You can revoke this authorization at any time by contacting our office at ${practice.email}${practice.phone ? ` or calling ${practice.phone}` : ''}.

${practice.name}
${practice.address || ''}
${practice.phone ? `Phone: ${practice.phone}` : ''}
  `.trim();

  const toEmail = authorization.deliveryAddress || patient.email;
  if (!toEmail) {
    return { success: false, error: 'No email address available' };
  }

  try {
    const result = await getTransporter().sendMail({
      from: `"${fromName}" <${practice.brandEmailReplyTo || practice.email || emailConfig.auth.user}>`,
      to: toEmail,
      subject: `Authorization Confirmed - ${practice.name}`,
      text,
      html,
    });

    return { success: true, messageId: (result as any).messageId };
  } catch (error) {
    console.error('Error sending authorization confirmation email:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Test email function
export async function sendTestEmail(
  email: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const result = await getTransporter().sendMail({
      from: emailConfig.auth.user,
      to: email,
      subject: 'Test Email from Insurance Authorization System',
      text: 'This is a test email to verify email configuration is working correctly.',
      html: '<p>This is a test email to verify email configuration is working correctly.</p>',
    });

    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending test email:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Twilio SMS (if configured)
export async function sendAuthorizationSMS(
  practice: Practice,
  patient: Patient,
  authorization: PatientInsuranceAuthorization,
  authorizationUrl: string
): Promise<{ success: boolean; messageSid?: string; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return { success: false, error: 'Twilio credentials not configured' };
  }

  const toNumber = authorization.deliveryPhone || patient.phone;
  if (!toNumber) {
    return { success: false, error: 'No phone number available' };
  }

  try {
    // Dynamic import for Twilio (optional dependency)
    let twilio: any;
    try {
      twilio = await import('twilio');
    } catch {
      return { success: false, error: 'Twilio not installed. Run: npm install twilio' };
    }
    const client = twilio.default(accountSid, authToken);

    const message = await client.messages.create({
      body: `${practice.name}: Please authorize access to your insurance information to help us serve you better. Click here: ${authorizationUrl} (Link expires in 7 days)`,
      from: fromNumber,
      to: toNumber,
    });

    return { success: true, messageSid: message.sid };
  } catch (error) {
    console.error('Error sending authorization SMS:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

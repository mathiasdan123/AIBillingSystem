/**
 * Email Templates Service
 * Professional HTML email templates with inline CSS for email client compatibility.
 * All templates are bilingual (English/Spanish) and include plain text fallback.
 */

type Locale = 'en' | 'es';

interface EmailOutput {
  subject: string;
  html: string;
  text: string;
}

// ==================== SHARED LAYOUT HELPERS ====================

const BRAND_COLOR = '#2563eb';
const BRAND_GRADIENT = 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)';
const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

function wrapHtml(title: string, headerColor: string, headerTitle: string, bodyContent: string, footerContent: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title></head>
<body style="margin: 0; padding: 0; font-family: ${FONT_STACK}; background-color: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: ${headerColor}; color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0 0 8px 0; font-size: 24px;">TherapyBill AI</h1>
      <p style="margin: 0; opacity: 0.9; font-size: 16px;">${escapeHtml(headerTitle)}</p>
    </div>
    <div style="background: white; padding: 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      ${bodyContent}
    </div>
    <div style="background: #f1f5f9; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border: 1px solid #e2e8f0; border-top: none;">
      ${footerContent}
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buttonHtml(text: string, url: string, color: string = BRAND_COLOR): string {
  return `<div style="text-align: center; margin: 30px 0;">
        <a href="${escapeHtml(url)}" style="display: inline-block; padding: 14px 28px; background: ${color}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">${escapeHtml(text)}</a>
      </div>`;
}

function infoBoxHtml(rows: Array<{ label: string; value: string }>): string {
  const rowsHtml = rows
    .filter(r => r.value)
    .map(r => `<tr>
            <td style="padding: 8px 0; color: #64748b; width: 120px; vertical-align: top;">${escapeHtml(r.label)}:</td>
            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${escapeHtml(r.value)}</td>
          </tr>`)
    .join('\n');

  return `<div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <table style="width: 100%;">
          ${rowsHtml}
        </table>
      </div>`;
}

function warningBoxHtml(content: string): string {
  return `<div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 15px; margin-top: 20px;">
        <p style="margin: 0; color: #92400e; font-size: 14px;">${content}</p>
      </div>`;
}

function alertBoxHtml(content: string): string {
  return `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 15px; margin-top: 20px;">
        <p style="margin: 0; color: #991b1b; font-size: 14px;">${content}</p>
      </div>`;
}

function pText(text: string, color: string = '#475569'): string {
  return `<p style="color: ${color}; font-size: 15px; line-height: 1.6;">${text}</p>`;
}

function footerText(lines: string[]): string {
  return lines
    .map(l => `<p style="margin: 0 0 4px 0; color: #64748b; font-size: 13px;">${escapeHtml(l)}</p>`)
    .join('\n');
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// ==================== i18n STRINGS ====================

const i18n = {
  en: {
    appointmentReminder: {
      subject: (date: string, time: string) => `Appointment Reminder - ${date} at ${time}`,
      headerTitle: 'Appointment Reminder',
      greeting: (name: string) => `Hi ${name},`,
      intro: 'This is a friendly reminder about your upcoming appointment.',
      date: 'Date',
      time: 'Time',
      provider: 'Provider',
      location: 'Location',
      earlyArrival: 'Please arrive 10-15 minutes early to complete any necessary paperwork.',
      reschedule: (phone?: string) =>
        `Need to cancel or reschedule? Please contact us at least 24 hours in advance${phone ? ` at ${phone}` : ''}.`,
      cancelLink: 'Cancel / Reschedule',
      lookForward: 'We look forward to seeing you!',
    },
    appointmentConfirmation: {
      subject: (date: string) => `Appointment Confirmed - ${date}`,
      headerTitle: 'Appointment Confirmed',
      greeting: (name: string) => `Hi ${name},`,
      intro: 'Your appointment has been successfully booked. Here are the details:',
      date: 'Date',
      time: 'Time',
      provider: 'Provider',
      location: 'Location',
      type: 'Type',
      note: 'Please arrive 10-15 minutes early, especially if this is your first visit.',
      reschedule: (phone?: string) =>
        `Need to make changes? Contact us at least 24 hours in advance${phone ? ` at ${phone}` : ''}.`,
      confirmed: 'Appointment Confirmed',
    },
    patientStatement: {
      subject: (practiceName: string) => `Billing Statement - ${practiceName}`,
      headerTitle: 'Billing Statement',
      greeting: (name: string) => `Dear ${name},`,
      intro: 'Please find your billing statement below.',
      dateOfService: 'Date of Service',
      description: 'Description',
      amount: 'Amount',
      totalDue: 'Total Due',
      dueDate: (date: string) => `Payment is due by ${date}.`,
      payNow: 'Pay Now',
      questions: (phone?: string) =>
        `If you have questions about this statement, please contact our billing department${phone ? ` at ${phone}` : ''}.`,
      thankYou: 'Thank you for your prompt payment.',
    },
    passwordReset: {
      subject: 'Reset Your Password - TherapyBill AI',
      headerTitle: 'Reset Your Password',
      greeting: (name: string) => `Hi ${name},`,
      intro: 'We received a request to reset your password for your TherapyBill AI account.',
      buttonText: 'Reset Password',
      expiry: (minutes: number) => `This link will expire in ${minutes} minutes.`,
      didntRequest: "<strong>Didn't request this?</strong> You can safely ignore this email. Your password will not be changed.",
      securityNote: 'For security, this link can only be used once.',
    },
    portalWelcome: {
      subject: (practiceName: string) => `Access Your Patient Portal - ${practiceName}`,
      headerTitle: 'Patient Portal Access',
      greeting: (name: string) => `Hello ${name},`,
      intro: (practiceName: string) => `You've been invited to access your patient portal at ${practiceName}.`,
      features: 'With your patient portal, you can:',
      featureList: [
        'View upcoming appointments',
        'Access billing statements and make payments',
        'Review your health records',
        'Communicate securely with your provider',
      ],
      buttonText: 'Access Patient Portal',
      expiry: 'This link expires in 15 minutes for security purposes.',
      didntRequest: "If you didn't request this link, please ignore this email.",
    },
    practiceWelcome: {
      subject: (practiceName: string) => `Welcome to TherapyBill AI - ${practiceName}`,
      headerTitle: 'Welcome to TherapyBill AI',
      greeting: (name: string) => `Hi ${name},`,
      intro: (practiceName: string) => `Thank you for signing up ${practiceName} with TherapyBill AI! Your practice account is ready.`,
      features: 'Here is what you can do next:',
      featureList: [
        'Complete your practice onboarding to set up insurance and billing preferences',
        'Add patients and their insurance information',
        'Start submitting claims with AI-powered billing accuracy review',
        'Set up appointment scheduling and automated reminders',
      ],
      buttonText: 'Go to Dashboard',
      closing: 'If you have any questions, reply to this email or visit our help center.',
    },
    claimStatusUpdate: {
      subject: (claimNumber: string, status: string) => `Claim ${claimNumber} - ${status}`,
      headerTitle: 'Claim Status Update',
      greeting: 'Hello,',
      intro: (claimNumber: string) => `There is an update on claim <strong>${escapeHtml(claimNumber)}</strong>.`,
      claimNumber: 'Claim #',
      patient: 'Patient',
      status: 'Status',
      amount: 'Billed Amount',
      paidAmount: 'Paid Amount',
      denialReason: 'Denial Reason',
      dateOfService: 'Date of Service',
      payer: 'Payer',
      actionRequired: 'Action may be required. Please review this claim in your dashboard.',
      viewClaim: 'View Claim Details',
    },
    breachNotification: {
      subject: 'Important Security Notice - TherapyBill AI',
      headerTitle: 'Security Notification',
      greeting: (name: string) => `Dear ${name},`,
      intro: 'We are writing to inform you of a security incident that may have affected your personal information.',
      whatHappened: 'What Happened',
      whatInfo: 'What Information Was Involved',
      whatWeDoing: 'What We Are Doing',
      whatYouCanDo: 'What You Can Do',
      contactInfo: 'Contact Information',
      contactText: (phone: string, email: string) =>
        `If you have questions or concerns, please contact our Privacy Officer at ${phone} or ${email}.`,
      regulatoryNote: 'This notice is being provided in accordance with the Health Insurance Portability and Accountability Act (HIPAA) Breach Notification Rule, 45 CFR 164.404.',
      freeCredit: 'We are offering complimentary credit monitoring services for 12 months. Details on how to enroll are included below.',
    },
  },
  es: {
    appointmentReminder: {
      subject: (date: string, time: string) => `Recordatorio de Cita - ${date} a las ${time}`,
      headerTitle: 'Recordatorio de Cita',
      greeting: (name: string) => `Hola ${name},`,
      intro: 'Este es un recordatorio amistoso sobre su pr\u00f3xima cita.',
      date: 'Fecha',
      time: 'Hora',
      provider: 'Proveedor',
      location: 'Ubicaci\u00f3n',
      earlyArrival: 'Por favor, llegue 10-15 minutos antes para completar cualquier papeleo necesario.',
      reschedule: (phone?: string) =>
        `\u00bfNecesita cancelar o reprogramar? Por favor cont\u00e1ctenos con al menos 24 horas de anticipaci\u00f3n${phone ? ` al ${phone}` : ''}.`,
      cancelLink: 'Cancelar / Reprogramar',
      lookForward: '\u00a1Esperamos verle pronto!',
    },
    appointmentConfirmation: {
      subject: (date: string) => `Cita Confirmada - ${date}`,
      headerTitle: 'Cita Confirmada',
      greeting: (name: string) => `Hola ${name},`,
      intro: 'Su cita ha sido reservada exitosamente. Aqu\u00ed est\u00e1n los detalles:',
      date: 'Fecha',
      time: 'Hora',
      provider: 'Proveedor',
      location: 'Ubicaci\u00f3n',
      type: 'Tipo',
      note: 'Por favor, llegue 10-15 minutos antes, especialmente si es su primera visita.',
      reschedule: (phone?: string) =>
        `\u00bfNecesita hacer cambios? Cont\u00e1ctenos con al menos 24 horas de anticipaci\u00f3n${phone ? ` al ${phone}` : ''}.`,
      confirmed: 'Cita Confirmada',
    },
    patientStatement: {
      subject: (practiceName: string) => `Estado de Cuenta - ${practiceName}`,
      headerTitle: 'Estado de Cuenta',
      greeting: (name: string) => `Estimado/a ${name},`,
      intro: 'A continuaci\u00f3n encontrar\u00e1 su estado de cuenta.',
      dateOfService: 'Fecha de Servicio',
      description: 'Descripci\u00f3n',
      amount: 'Monto',
      totalDue: 'Total a Pagar',
      dueDate: (date: string) => `El pago vence el ${date}.`,
      payNow: 'Pagar Ahora',
      questions: (phone?: string) =>
        `Si tiene preguntas sobre este estado de cuenta, por favor contacte nuestro departamento de facturaci\u00f3n${phone ? ` al ${phone}` : ''}.`,
      thankYou: 'Gracias por su pronto pago.',
    },
    passwordReset: {
      subject: 'Restablecer Su Contrase\u00f1a - TherapyBill AI',
      headerTitle: 'Restablecer Su Contrase\u00f1a',
      greeting: (name: string) => `Hola ${name},`,
      intro: 'Recibimos una solicitud para restablecer la contrase\u00f1a de su cuenta de TherapyBill AI.',
      buttonText: 'Restablecer Contrase\u00f1a',
      expiry: (minutes: number) => `Este enlace expirar\u00e1 en ${minutes} minutos.`,
      didntRequest: '<strong>\u00bfNo solicit\u00f3 esto?</strong> Puede ignorar este correo con seguridad. Su contrase\u00f1a no ser\u00e1 cambiada.',
      securityNote: 'Por seguridad, este enlace solo puede usarse una vez.',
    },
    portalWelcome: {
      subject: (practiceName: string) => `Acceda a Su Portal de Pacientes - ${practiceName}`,
      headerTitle: 'Acceso al Portal de Pacientes',
      greeting: (name: string) => `Hola ${name},`,
      intro: (practiceName: string) => `Ha sido invitado/a a acceder a su portal de pacientes en ${practiceName}.`,
      features: 'Con su portal de pacientes, usted puede:',
      featureList: [
        'Ver pr\u00f3ximas citas',
        'Acceder a estados de cuenta y realizar pagos',
        'Revisar sus registros m\u00e9dicos',
        'Comunicarse de forma segura con su proveedor',
      ],
      buttonText: 'Acceder al Portal de Pacientes',
      expiry: 'Este enlace expira en 15 minutos por razones de seguridad.',
      didntRequest: 'Si no solicit\u00f3 este enlace, por favor ignore este correo.',
    },
    practiceWelcome: {
      subject: (practiceName: string) => `Bienvenido a TherapyBill AI - ${practiceName}`,
      headerTitle: 'Bienvenido a TherapyBill AI',
      greeting: (name: string) => `Hola ${name},`,
      intro: (practiceName: string) => `Gracias por registrar ${practiceName} en TherapyBill AI. Su cuenta de consultorio esta lista.`,
      features: 'Esto es lo que puede hacer a continuacion:',
      featureList: [
        'Complete la configuracion de su consultorio para establecer preferencias de seguros y facturacion',
        'Agregue pacientes y su informacion de seguro',
        'Comience a enviar reclamos con revision de precision de facturacion impulsada por IA',
        'Configure la programacion de citas y recordatorios automaticos',
      ],
      buttonText: 'Ir al Panel',
      closing: 'Si tiene alguna pregunta, responda a este correo o visite nuestro centro de ayuda.',
    },
    claimStatusUpdate: {
      subject: (claimNumber: string, status: string) => `Reclamo ${claimNumber} - ${status}`,
      headerTitle: 'Actualizaci\u00f3n de Estado del Reclamo',
      greeting: 'Hola,',
      intro: (claimNumber: string) => `Hay una actualizaci\u00f3n sobre el reclamo <strong>${escapeHtml(claimNumber)}</strong>.`,
      claimNumber: 'Reclamo #',
      patient: 'Paciente',
      status: 'Estado',
      amount: 'Monto Facturado',
      paidAmount: 'Monto Pagado',
      denialReason: 'Raz\u00f3n de Denegaci\u00f3n',
      dateOfService: 'Fecha de Servicio',
      payer: 'Pagador',
      actionRequired: 'Puede requerirse acci\u00f3n. Por favor revise este reclamo en su panel.',
      viewClaim: 'Ver Detalles del Reclamo',
    },
    breachNotification: {
      subject: 'Aviso de Seguridad Importante - TherapyBill AI',
      headerTitle: 'Notificaci\u00f3n de Seguridad',
      greeting: (name: string) => `Estimado/a ${name},`,
      intro: 'Le escribimos para informarle sobre un incidente de seguridad que puede haber afectado su informaci\u00f3n personal.',
      whatHappened: 'Qu\u00e9 Sucedi\u00f3',
      whatInfo: 'Qu\u00e9 Informaci\u00f3n Estuvo Involucrada',
      whatWeDoing: 'Qu\u00e9 Estamos Haciendo',
      whatYouCanDo: 'Qu\u00e9 Puede Hacer Usted',
      contactInfo: 'Informaci\u00f3n de Contacto',
      contactText: (phone: string, email: string) =>
        `Si tiene preguntas o inquietudes, por favor contacte a nuestro Oficial de Privacidad al ${phone} o a ${email}.`,
      regulatoryNote: 'Esta notificaci\u00f3n se proporciona de acuerdo con la Regla de Notificaci\u00f3n de Violaciones de HIPAA, 45 CFR 164.404.',
      freeCredit: 'Estamos ofreciendo servicios complementarios de monitoreo de cr\u00e9dito durante 12 meses. Los detalles sobre c\u00f3mo inscribirse se incluyen a continuaci\u00f3n.',
    },
  },
};

// ==================== TEMPLATE FUNCTIONS ====================

export interface AppointmentReminderData {
  patientName: string;
  appointmentDate: Date;
  appointmentTime: string;
  providerName?: string;
  practiceName: string;
  practiceAddress?: string;
  practicePhone?: string;
  cancelRescheduleUrl?: string;
  locale?: Locale;
}

export function appointmentReminder(data: AppointmentReminderData): EmailOutput {
  const locale = data.locale || 'en';
  const t = i18n[locale].appointmentReminder;

  const formattedDate = data.appointmentDate.toLocaleDateString(locale === 'es' ? 'es-US' : 'en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const rows = [
    { label: t.date, value: formattedDate },
    { label: t.time, value: data.appointmentTime },
    { label: t.provider, value: data.providerName || '' },
    { label: t.location, value: data.practiceAddress || '' },
  ];

  let bodyContent = `
      ${pText(t.greeting(escapeHtml(data.patientName)), '#1e293b')}
      ${pText(t.intro)}
      ${infoBoxHtml(rows)}
      ${pText(t.earlyArrival)}
      ${pText(t.reschedule(data.practicePhone))}`;

  if (data.cancelRescheduleUrl) {
    bodyContent += buttonHtml(t.cancelLink, data.cancelRescheduleUrl, '#64748b');
  }

  const html = wrapHtml(
    t.headerTitle,
    BRAND_GRADIENT,
    `${t.headerTitle} — ${escapeHtml(data.practiceName)}`,
    bodyContent,
    footerText([t.lookForward, data.practiceName]),
  );

  const text = `${t.headerTitle.toUpperCase()}
${'='.repeat(t.headerTitle.length)}
${data.practiceName}

${t.greeting(data.patientName)}

${t.intro}

${t.date}: ${formattedDate}
${t.time}: ${data.appointmentTime}
${data.providerName ? `${t.provider}: ${data.providerName}` : ''}
${data.practiceAddress ? `${t.location}: ${data.practiceAddress}` : ''}

${t.earlyArrival}

${t.reschedule(data.practicePhone)}
${data.cancelRescheduleUrl ? `\n${t.cancelLink}: ${data.cancelRescheduleUrl}` : ''}

${t.lookForward}
${data.practiceName}`;

  return {
    subject: t.subject(formattedDate, data.appointmentTime),
    html,
    text,
  };
}

export interface AppointmentConfirmationData {
  patientName: string;
  appointmentDate: Date;
  appointmentTime: string;
  providerName?: string;
  practiceName: string;
  practiceAddress?: string;
  practicePhone?: string;
  appointmentType?: string;
  locale?: Locale;
}

export function appointmentConfirmation(data: AppointmentConfirmationData): EmailOutput {
  const locale = data.locale || 'en';
  const t = i18n[locale].appointmentConfirmation;

  const formattedDate = data.appointmentDate.toLocaleDateString(locale === 'es' ? 'es-US' : 'en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const rows = [
    { label: t.date, value: formattedDate },
    { label: t.time, value: data.appointmentTime },
    { label: t.provider, value: data.providerName || '' },
    { label: t.location, value: data.practiceAddress || '' },
    { label: t.type, value: data.appointmentType || '' },
  ];

  const bodyContent = `
      ${pText(t.greeting(escapeHtml(data.patientName)), '#1e293b')}
      ${pText(t.intro)}
      ${infoBoxHtml(rows)}
      ${pText(t.note)}
      ${pText(t.reschedule(data.practicePhone))}`;

  const html = wrapHtml(
    t.headerTitle,
    'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
    `${t.confirmed} — ${escapeHtml(data.practiceName)}`,
    bodyContent,
    footerText([data.practiceName]),
  );

  const text = `${t.headerTitle.toUpperCase()}
${'='.repeat(t.headerTitle.length)}
${data.practiceName}

${t.greeting(data.patientName)}

${t.intro}

${t.date}: ${formattedDate}
${t.time}: ${data.appointmentTime}
${data.providerName ? `${t.provider}: ${data.providerName}` : ''}
${data.practiceAddress ? `${t.location}: ${data.practiceAddress}` : ''}
${data.appointmentType ? `${t.type}: ${data.appointmentType}` : ''}

${t.note}

${t.reschedule(data.practicePhone)}

${data.practiceName}`;

  return {
    subject: t.subject(formattedDate),
    html,
    text,
  };
}

export interface PatientStatementData {
  patientName: string;
  practiceName: string;
  practicePhone?: string;
  lineItems: Array<{
    dateOfService: string;
    description: string;
    amount: number;
  }>;
  totalDue: number;
  dueDate: string;
  paymentUrl?: string;
  locale?: Locale;
}

export function patientStatement(data: PatientStatementData): EmailOutput {
  const locale = data.locale || 'en';
  const t = i18n[locale].patientStatement;

  const tableRowsHtml = data.lineItems
    .map(item => `<tr>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #475569;">${escapeHtml(item.dateOfService)}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #475569;">${escapeHtml(item.description)}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #1e293b; text-align: right; font-weight: 500;">${formatCurrency(item.amount)}</td>
          </tr>`)
    .join('\n');

  const tableHtml = `
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <thead>
          <tr style="background: #f8fafc;">
            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 13px; text-transform: uppercase;">${escapeHtml(t.dateOfService)}</th>
            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 13px; text-transform: uppercase;">${escapeHtml(t.description)}</th>
            <th style="padding: 10px; text-align: right; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 13px; text-transform: uppercase;">${escapeHtml(t.amount)}</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding: 12px 10px; font-weight: 700; color: #1e293b; border-top: 2px solid #1e293b;">${escapeHtml(t.totalDue)}</td>
            <td style="padding: 12px 10px; font-weight: 700; color: #1e293b; text-align: right; border-top: 2px solid #1e293b; font-size: 18px;">${formatCurrency(data.totalDue)}</td>
          </tr>
        </tfoot>
      </table>`;

  let bodyContent = `
      ${pText(t.greeting(escapeHtml(data.patientName)), '#1e293b')}
      ${pText(t.intro)}
      ${tableHtml}
      ${pText(t.dueDate(escapeHtml(data.dueDate)))}`;

  if (data.paymentUrl) {
    bodyContent += buttonHtml(t.payNow, data.paymentUrl, '#22c55e');
  }

  bodyContent += pText(t.questions(data.practicePhone));

  const html = wrapHtml(
    t.headerTitle,
    BRAND_GRADIENT,
    `${t.headerTitle} — ${escapeHtml(data.practiceName)}`,
    bodyContent,
    footerText([t.thankYou, data.practiceName]),
  );

  const lineItemsText = data.lineItems
    .map(item => `  ${item.dateOfService}  ${item.description}  ${formatCurrency(item.amount)}`)
    .join('\n');

  const text = `${t.headerTitle.toUpperCase()}
${'='.repeat(t.headerTitle.length)}
${data.practiceName}

${t.greeting(data.patientName)}

${t.intro}

${t.dateOfService}  |  ${t.description}  |  ${t.amount}
${'-'.repeat(50)}
${lineItemsText}
${'-'.repeat(50)}
${t.totalDue}: ${formatCurrency(data.totalDue)}

${t.dueDate(data.dueDate)}
${data.paymentUrl ? `\n${t.payNow}: ${data.paymentUrl}` : ''}

${t.questions(data.practicePhone)}

${t.thankYou}
${data.practiceName}`;

  return {
    subject: t.subject(data.practiceName),
    html,
    text,
  };
}

export interface PasswordResetData {
  firstName: string;
  resetUrl: string;
  expiresInMinutes: number;
  locale?: Locale;
}

export function passwordReset(data: PasswordResetData): EmailOutput {
  const locale = data.locale || 'en';
  const t = i18n[locale].passwordReset;

  const bodyContent = `
      ${pText(t.greeting(escapeHtml(data.firstName)), '#1e293b')}
      ${pText(t.intro)}
      ${buttonHtml(t.buttonText, data.resetUrl)}
      <p style="color: #64748b; font-size: 14px;">${t.expiry(data.expiresInMinutes)}</p>
      ${warningBoxHtml(t.didntRequest)}
      <p style="color: #64748b; font-size: 13px; margin-top: 12px;">${escapeHtml(t.securityNote)}</p>`;

  const html = wrapHtml(
    t.headerTitle,
    BRAND_GRADIENT,
    t.headerTitle,
    bodyContent,
    footerText(['TherapyBill AI']),
  );

  const text = `${t.headerTitle.toUpperCase()}
${'='.repeat(t.headerTitle.length)}

${t.greeting(data.firstName)}

${t.intro}

${t.buttonText}: ${data.resetUrl}

${t.expiry(data.expiresInMinutes)}

${t.securityNote}

TherapyBill AI`;

  return {
    subject: t.subject,
    html,
    text,
  };
}

export interface PortalWelcomeData {
  patientName: string;
  practiceName: string;
  portalUrl: string;
  locale?: Locale;
}

export function portalWelcome(data: PortalWelcomeData): EmailOutput {
  const locale = data.locale || 'en';
  const t = i18n[locale].portalWelcome;

  const featuresHtml = `<ul style="padding-left: 20px; color: #475569;">
        ${t.featureList.map(f => `<li style="padding: 4px 0;">${escapeHtml(f)}</li>`).join('\n')}
      </ul>`;

  const bodyContent = `
      ${pText(t.greeting(escapeHtml(data.patientName)), '#1e293b')}
      ${pText(t.intro(escapeHtml(data.practiceName)))}
      ${pText(t.features)}
      ${featuresHtml}
      ${buttonHtml(t.buttonText, data.portalUrl, '#22c55e')}
      <p style="color: #64748b; font-size: 14px;">${escapeHtml(t.expiry)}</p>
      <p style="color: #64748b; font-size: 14px;">${escapeHtml(t.didntRequest)}</p>`;

  const html = wrapHtml(
    t.headerTitle,
    'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
    `${t.headerTitle} — ${escapeHtml(data.practiceName)}`,
    bodyContent,
    footerText([data.practiceName]),
  );

  const featuresText = t.featureList.map(f => `  - ${f}`).join('\n');

  const text = `${t.headerTitle.toUpperCase()}
${'='.repeat(t.headerTitle.length)}
${data.practiceName}

${t.greeting(data.patientName)}

${t.intro(data.practiceName)}

${t.features}
${featuresText}

${t.buttonText}: ${data.portalUrl}

${t.expiry}

${t.didntRequest}

${data.practiceName}`;

  return {
    subject: t.subject(data.practiceName),
    html,
    text,
  };
}

export interface ClaimStatusUpdateData {
  claimNumber: string;
  patientName: string;
  status: string;
  billedAmount: number;
  paidAmount?: number;
  denialReason?: string;
  dateOfService: string;
  payerName: string;
  practiceName: string;
  viewClaimUrl?: string;
  locale?: Locale;
}

export function claimStatusUpdate(data: ClaimStatusUpdateData): EmailOutput {
  const locale = data.locale || 'en';
  const t = i18n[locale].claimStatusUpdate;

  const statusColor = data.status.toLowerCase().includes('denied') || data.status.toLowerCase().includes('denegad')
    ? '#dc2626'
    : data.status.toLowerCase().includes('paid') || data.status.toLowerCase().includes('pagad')
      ? '#22c55e'
      : '#f59e0b';

  const rows = [
    { label: t.claimNumber, value: data.claimNumber },
    { label: t.patient, value: data.patientName },
    { label: t.dateOfService, value: data.dateOfService },
    { label: t.payer, value: data.payerName },
    { label: t.amount, value: formatCurrency(data.billedAmount) },
  ];

  if (data.paidAmount !== undefined) {
    rows.push({ label: t.paidAmount, value: formatCurrency(data.paidAmount) });
  }
  if (data.denialReason) {
    rows.push({ label: t.denialReason, value: data.denialReason });
  }

  const statusBadge = `<div style="margin: 15px 0;">
        <span style="display: inline-block; padding: 6px 16px; background: ${statusColor}; color: white; border-radius: 20px; font-weight: 600; font-size: 14px;">${escapeHtml(data.status)}</span>
      </div>`;

  let bodyContent = `
      ${pText(t.greeting, '#1e293b')}
      ${pText(t.intro(data.claimNumber))}
      ${statusBadge}
      ${infoBoxHtml(rows)}`;

  if (data.denialReason) {
    bodyContent += alertBoxHtml(`<strong>${escapeHtml(t.denialReason)}:</strong> ${escapeHtml(data.denialReason)}`);
  }

  bodyContent += pText(t.actionRequired);

  if (data.viewClaimUrl) {
    bodyContent += buttonHtml(t.viewClaim, data.viewClaimUrl);
  }

  const html = wrapHtml(
    t.headerTitle,
    BRAND_GRADIENT,
    `${t.headerTitle} — ${escapeHtml(data.practiceName)}`,
    bodyContent,
    footerText([data.practiceName, 'TherapyBill AI']),
  );

  const text = `${t.headerTitle.toUpperCase()}
${'='.repeat(t.headerTitle.length)}
${data.practiceName}

${t.greeting}

${t.claimNumber}: ${data.claimNumber}
${t.status}: ${data.status}
${t.patient}: ${data.patientName}
${t.dateOfService}: ${data.dateOfService}
${t.payer}: ${data.payerName}
${t.amount}: ${formatCurrency(data.billedAmount)}
${data.paidAmount !== undefined ? `${t.paidAmount}: ${formatCurrency(data.paidAmount)}` : ''}
${data.denialReason ? `${t.denialReason}: ${data.denialReason}` : ''}

${t.actionRequired}
${data.viewClaimUrl ? `\n${t.viewClaim}: ${data.viewClaimUrl}` : ''}

${data.practiceName}`;

  return {
    subject: t.subject(data.claimNumber, data.status),
    html,
    text,
  };
}

export interface BreachNotificationData {
  patientName: string;
  practiceName: string;
  breachDate: string;
  discoveryDate: string;
  whatHappened: string;
  informationInvolved: string;
  whatWeAreDoing: string;
  whatYouCanDo: string;
  contactPhone: string;
  contactEmail: string;
  creditMonitoringUrl?: string;
  locale?: Locale;
}

export function breachNotification(data: BreachNotificationData): EmailOutput {
  const locale = data.locale || 'en';
  const t = i18n[locale].breachNotification;

  function sectionHtml(title: string, content: string): string {
    return `<div style="margin: 20px 0;">
        <h3 style="color: #1e293b; font-size: 16px; margin: 0 0 8px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">${escapeHtml(title)}</h3>
        <p style="color: #475569; line-height: 1.6; margin: 0;">${escapeHtml(content)}</p>
      </div>`;
  }

  let bodyContent = `
      ${pText(t.greeting(escapeHtml(data.patientName)), '#1e293b')}
      ${pText(t.intro)}
      ${sectionHtml(t.whatHappened, data.whatHappened)}
      ${sectionHtml(t.whatInfo, data.informationInvolved)}
      ${sectionHtml(t.whatWeDoing, data.whatWeAreDoing)}
      ${sectionHtml(t.whatYouCanDo, data.whatYouCanDo)}`;

  if (data.creditMonitoringUrl) {
    bodyContent += pText(t.freeCredit);
    bodyContent += buttonHtml(
      locale === 'es' ? 'Inscribirse en Monitoreo de Cr\u00e9dito' : 'Enroll in Credit Monitoring',
      data.creditMonitoringUrl,
      '#dc2626',
    );
  }

  bodyContent += `<div style="margin: 20px 0;">
        <h3 style="color: #1e293b; font-size: 16px; margin: 0 0 8px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">${escapeHtml(t.contactInfo)}</h3>
        <p style="color: #475569; line-height: 1.6; margin: 0;">${escapeHtml(t.contactText(data.contactPhone, data.contactEmail))}</p>
      </div>`;

  bodyContent += `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-top: 20px;">
        <p style="margin: 0; color: #64748b; font-size: 12px; line-height: 1.5;">${escapeHtml(t.regulatoryNote)}</p>
      </div>`;

  const html = wrapHtml(
    t.headerTitle,
    'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
    t.headerTitle,
    bodyContent,
    footerText([data.practiceName, 'TherapyBill AI']),
  );

  const text = `${t.headerTitle.toUpperCase()}
${'='.repeat(t.headerTitle.length)}

${t.greeting(data.patientName)}

${t.intro}

${t.whatHappened.toUpperCase()}
${data.whatHappened}

${t.whatInfo.toUpperCase()}
${data.informationInvolved}

${t.whatWeDoing.toUpperCase()}
${data.whatWeAreDoing}

${t.whatYouCanDo.toUpperCase()}
${data.whatYouCanDo}

${t.contactInfo.toUpperCase()}
${t.contactText(data.contactPhone, data.contactEmail)}
${data.creditMonitoringUrl ? `\nCredit Monitoring: ${data.creditMonitoringUrl}` : ''}

${t.regulatoryNote}

${data.practiceName}`;

  return {
    subject: t.subject,
    html,
    text,
  };
}

export interface PracticeWelcomeData {
  firstName: string;
  practiceName: string;
  dashboardUrl?: string;
  locale?: Locale;
}

export function practiceWelcome(data: PracticeWelcomeData): EmailOutput {
  const locale = data.locale || 'en';
  const t = i18n[locale].practiceWelcome;

  const featureListHtml = t.featureList
    .map((f: string) => `<li style="margin-bottom: 8px; color: #475569;">${escapeHtml(f)}</li>`)
    .join('');

  let bodyContent = `
      ${pText(t.greeting(data.firstName), '#1e293b')}
      ${pText(t.intro(data.practiceName))}
      ${pText(t.features)}
      <ul style="padding-left: 20px; margin: 15px 0;">${featureListHtml}</ul>`;

  if (data.dashboardUrl) {
    bodyContent += buttonHtml(t.buttonText, data.dashboardUrl);
  }

  bodyContent += pText(t.closing);

  const html = wrapHtml(
    t.headerTitle,
    BRAND_GRADIENT,
    `${t.headerTitle} — ${escapeHtml(data.practiceName)}`,
    bodyContent,
    footerText([data.practiceName, 'TherapyBill AI']),
  );

  const text = `${t.headerTitle.toUpperCase()}
${'='.repeat(t.headerTitle.length)}

${t.greeting(data.firstName)}

${t.intro(data.practiceName)}

${t.features}
${t.featureList.map((f: string) => `- ${f}`).join('\n')}

${data.dashboardUrl ? `${t.buttonText}: ${data.dashboardUrl}` : ''}

${t.closing}

${data.practiceName}`;

  return {
    subject: t.subject(data.practiceName),
    html,
    text,
  };
}

import { describe, it, expect } from 'vitest';
import {
  appointmentReminder,
  appointmentConfirmation,
  patientStatement,
  passwordReset,
  portalWelcome,
  claimStatusUpdate,
  breachNotification,
} from '../services/emailTemplates';

describe('Email Templates', () => {
  // ==================== appointmentReminder ====================

  describe('appointmentReminder', () => {
    const baseData = {
      patientName: 'Jane Doe',
      appointmentDate: new Date('2026-04-15'),
      appointmentTime: '2:00 PM',
      providerName: 'Dr. Smith',
      practiceName: 'Sunshine Therapy',
      practiceAddress: '123 Main St',
      practicePhone: '555-0100',
    };

    it('returns subject, html, and text fields', () => {
      const result = appointmentReminder(baseData);
      expect(result).toHaveProperty('subject');
      expect(result).toHaveProperty('html');
      expect(result).toHaveProperty('text');
      expect(result.subject).toContain('Appointment Reminder');
      expect(result.subject).toContain('2:00 PM');
    });

    it('includes patient name and provider in HTML', () => {
      const result = appointmentReminder(baseData);
      expect(result.html).toContain('Jane Doe');
      expect(result.html).toContain('Dr. Smith');
      expect(result.html).toContain('Sunshine Therapy');
    });

    it('includes plain text fallback with appointment details', () => {
      const result = appointmentReminder(baseData);
      expect(result.text).toContain('Jane Doe');
      expect(result.text).toContain('2:00 PM');
      expect(result.text).toContain('Dr. Smith');
      expect(result.text).toContain('APPOINTMENT REMINDER');
    });

    it('renders Spanish locale when specified', () => {
      const result = appointmentReminder({ ...baseData, locale: 'es' });
      expect(result.subject).toContain('Recordatorio de Cita');
      expect(result.html).toContain('Recordatorio de Cita');
      expect(result.text).toContain('RECORDATORIO DE CITA');
    });

    it('includes cancel/reschedule button when URL is provided', () => {
      const result = appointmentReminder({
        ...baseData,
        cancelRescheduleUrl: 'https://example.com/cancel',
      });
      expect(result.html).toContain('https://example.com/cancel');
      expect(result.text).toContain('https://example.com/cancel');
    });

    it('escapes HTML in patient name', () => {
      const result = appointmentReminder({
        ...baseData,
        patientName: '<script>alert("xss")</script>',
      });
      expect(result.html).not.toContain('<script>');
      expect(result.html).toContain('&lt;script&gt;');
    });
  });

  // ==================== appointmentConfirmation ====================

  describe('appointmentConfirmation', () => {
    const baseData = {
      patientName: 'John Smith',
      appointmentDate: new Date('2026-05-01'),
      appointmentTime: '10:00 AM',
      providerName: 'Dr. Adams',
      practiceName: 'Healing Center',
      appointmentType: 'Initial Evaluation',
    };

    it('returns correct subject with date', () => {
      const result = appointmentConfirmation(baseData);
      expect(result.subject).toContain('Appointment Confirmed');
    });

    it('includes appointment type in HTML', () => {
      const result = appointmentConfirmation(baseData);
      expect(result.html).toContain('Initial Evaluation');
    });

    it('renders Spanish locale', () => {
      const result = appointmentConfirmation({ ...baseData, locale: 'es' });
      expect(result.subject).toContain('Cita Confirmada');
      expect(result.html).toContain('Cita Confirmada');
    });
  });

  // ==================== patientStatement ====================

  describe('patientStatement', () => {
    const baseData = {
      patientName: 'Alice Wonder',
      practiceName: 'Therapy Works',
      lineItems: [
        { dateOfService: '2026-03-01', description: 'Individual Session', amount: 150 },
        { dateOfService: '2026-03-08', description: 'Group Session', amount: 75 },
      ],
      totalDue: 225,
      dueDate: 'April 1, 2026',
    };

    it('includes line items and total in HTML', () => {
      const result = patientStatement(baseData);
      expect(result.html).toContain('Individual Session');
      expect(result.html).toContain('$150.00');
      expect(result.html).toContain('$225.00');
    });

    it('includes pay now button when payment URL provided', () => {
      const result = patientStatement({ ...baseData, paymentUrl: 'https://pay.example.com' });
      expect(result.html).toContain('https://pay.example.com');
    });

    it('includes plain text line items', () => {
      const result = patientStatement(baseData);
      expect(result.text).toContain('Individual Session');
      expect(result.text).toContain('$225.00');
    });

    it('renders Spanish locale', () => {
      const result = patientStatement({ ...baseData, locale: 'es' });
      expect(result.subject).toContain('Estado de Cuenta');
    });
  });

  // ==================== passwordReset ====================

  describe('passwordReset', () => {
    const baseData = {
      firstName: 'Bob',
      resetUrl: 'https://app.example.com/reset?token=abc123',
      expiresInMinutes: 30,
    };

    it('returns expected subject', () => {
      const result = passwordReset(baseData);
      expect(result.subject).toBe('Reset Your Password - TherapyBill AI');
    });

    it('includes reset URL in both HTML and text', () => {
      const result = passwordReset(baseData);
      expect(result.html).toContain('https://app.example.com/reset?token=abc123');
      expect(result.text).toContain('https://app.example.com/reset?token=abc123');
    });

    it('shows expiry time', () => {
      const result = passwordReset(baseData);
      expect(result.html).toContain('30 minutes');
      expect(result.text).toContain('30 minutes');
    });

    it('renders Spanish locale', () => {
      const result = passwordReset({ ...baseData, locale: 'es' });
      expect(result.subject).toContain('Restablecer');
      expect(result.html).toContain('30 minutos');
    });

    it('escapes HTML in first name', () => {
      const result = passwordReset({ ...baseData, firstName: 'Bob<img src=x>' });
      expect(result.html).not.toContain('<img');
      expect(result.html).toContain('&lt;img');
    });
  });

  // ==================== portalWelcome ====================

  describe('portalWelcome', () => {
    const baseData = {
      patientName: 'Carol',
      practiceName: 'Mindful Health',
      portalUrl: 'https://portal.example.com/invite/xyz',
    };

    it('includes feature list in HTML', () => {
      const result = portalWelcome(baseData);
      expect(result.html).toContain('View upcoming appointments');
      expect(result.html).toContain('Access billing statements');
    });

    it('includes portal URL', () => {
      const result = portalWelcome(baseData);
      expect(result.html).toContain(baseData.portalUrl);
      expect(result.text).toContain(baseData.portalUrl);
    });
  });

  // ==================== claimStatusUpdate ====================

  describe('claimStatusUpdate', () => {
    const baseData = {
      claimNumber: 'CLM-001',
      patientName: 'David Lee',
      status: 'Paid',
      billedAmount: 200,
      dateOfService: '2026-03-01',
      payerName: 'Aetna',
      practiceName: 'Therapy Plus',
    };

    it('includes claim number in subject', () => {
      const result = claimStatusUpdate(baseData);
      expect(result.subject).toContain('CLM-001');
      expect(result.subject).toContain('Paid');
    });

    it('shows denial reason when present', () => {
      const result = claimStatusUpdate({
        ...baseData,
        status: 'Denied',
        denialReason: 'Missing authorization',
      });
      expect(result.html).toContain('Missing authorization');
      expect(result.text).toContain('Missing authorization');
    });

    it('renders Spanish locale', () => {
      const result = claimStatusUpdate({ ...baseData, locale: 'es' });
      expect(result.subject).toContain('Reclamo');
    });
  });

  // ==================== breachNotification ====================

  describe('breachNotification', () => {
    const baseData = {
      patientName: 'Eva Green',
      practiceName: 'Safe Therapy',
      breachDate: 'March 1, 2026',
      discoveryDate: 'March 5, 2026',
      whatHappened: 'Unauthorized access to records',
      informationInvolved: 'Names and dates of birth',
      whatWeAreDoing: 'Investigating and implementing safeguards',
      whatYouCanDo: 'Monitor your credit reports',
      contactPhone: '1-800-555-0199',
      contactEmail: 'privacy@safetherapy.com',
    };

    it('returns security notice subject', () => {
      const result = breachNotification(baseData);
      expect(result.subject).toBe('Important Security Notice - TherapyBill AI');
    });

    it('includes HIPAA regulatory note', () => {
      const result = breachNotification(baseData);
      expect(result.html).toContain('45 CFR 164.404');
      expect(result.text).toContain('45 CFR 164.404');
    });

    it('includes credit monitoring button when URL provided', () => {
      const result = breachNotification({
        ...baseData,
        creditMonitoringUrl: 'https://credit.example.com',
      });
      expect(result.html).toContain('https://credit.example.com');
      expect(result.html).toContain('Enroll in Credit Monitoring');
    });

    it('renders Spanish locale', () => {
      const result = breachNotification({ ...baseData, locale: 'es' });
      expect(result.subject).toContain('Aviso de Seguridad Importante');
      expect(result.html).toContain('Notificaci');
    });
  });
});

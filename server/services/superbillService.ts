/**
 * Superbill Service
 *
 * Generates and manages superbills - itemized forms given to patients
 * for out-of-network insurance reimbursement.
 */

import { eq, and, sql, desc, gte, lte } from 'drizzle-orm';
import {
  superbills,
  appointments,
  soapNotes,
  treatmentSessions,
  cptCodes,
  icd10Codes,
  type InsertSuperbill,
  type Superbill,
} from '@shared/schema';
import { db } from '../db';
import logger from './logger';

export interface ProcedureCodeEntry {
  code: string;
  description: string;
  units: number;
  fee: string;
}

export interface SuperbillCreateData {
  patientId: number;
  providerId: string;
  appointmentId?: number;
  dateOfService: string;
  diagnosisCodes: string[];
  procedureCodes: ProcedureCodeEntry[];
  totalAmount: string;
  notes?: string;
}

export interface SuperbillFilters {
  patientId?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Create a new superbill from provided data.
 */
export async function generateSuperbill(
  practiceId: number,
  data: SuperbillCreateData,
): Promise<Superbill> {
  const insertData: InsertSuperbill = {
    practiceId,
    patientId: data.patientId,
    providerId: data.providerId,
    appointmentId: data.appointmentId ?? null,
    dateOfService: data.dateOfService,
    diagnosisCodes: data.diagnosisCodes,
    procedureCodes: data.procedureCodes,
    totalAmount: data.totalAmount,
    notes: data.notes ?? null,
    status: 'draft',
  };

  const [superbill] = await db.insert(superbills).values(insertData).returning();

  logger.info('Superbill created', {
    superbillId: superbill.id,
    practiceId,
    patientId: data.patientId,
    totalAmount: data.totalAmount,
  });

  return superbill;
}

/**
 * Auto-generate a superbill from an appointment and its linked SOAP note / treatment session.
 */
export async function generateFromAppointment(
  appointmentId: number,
  practiceId: number,
): Promise<Superbill> {
  // Fetch the appointment
  const [appointment] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId)));

  if (!appointment) {
    throw new Error(`Appointment ${appointmentId} not found for practice ${practiceId}`);
  }

  if (!appointment.patientId || !appointment.therapistId) {
    throw new Error(`Appointment ${appointmentId} is missing patient or therapist`);
  }

  // Find treatment session linked to this appointment date
  const sessionDate = appointment.startTime.toISOString().split('T')[0];
  const [session] = await db
    .select()
    .from(treatmentSessions)
    .where(
      and(
        eq(treatmentSessions.practiceId, practiceId),
        eq(treatmentSessions.patientId, appointment.patientId),
        eq(treatmentSessions.therapistId, appointment.therapistId),
        eq(treatmentSessions.sessionDate, sessionDate),
      ),
    );

  // Build diagnosis codes from session's ICD-10 code
  const diagnosisCodes: string[] = [];
  if (session?.icd10CodeId) {
    const [icdCode] = await db
      .select()
      .from(icd10Codes)
      .where(eq(icd10Codes.id, session.icd10CodeId));
    if (icdCode) {
      diagnosisCodes.push(icdCode.code);
    }
  }

  // Build procedure codes from session's CPT code
  const procedureCodes: ProcedureCodeEntry[] = [];
  let totalAmount = '0.00';

  if (session?.cptCodeId) {
    const [cpt] = await db
      .select()
      .from(cptCodes)
      .where(eq(cptCodes.id, session.cptCodeId));
    if (cpt) {
      const fee = cpt.baseRate ? String(cpt.baseRate) : '0.00';
      const units = session.units ?? 1;
      procedureCodes.push({
        code: cpt.code,
        description: cpt.description || cpt.code,
        units,
        fee,
      });
      totalAmount = (parseFloat(fee) * units).toFixed(2);
    }
  }

  if (diagnosisCodes.length === 0) {
    diagnosisCodes.push('UNSPECIFIED');
  }

  if (procedureCodes.length === 0) {
    throw new Error(`No procedure codes found for appointment ${appointmentId}`);
  }

  return generateSuperbill(practiceId, {
    patientId: appointment.patientId,
    providerId: appointment.therapistId,
    appointmentId,
    dateOfService: sessionDate,
    diagnosisCodes,
    procedureCodes,
    totalAmount,
    notes: session?.notes ?? undefined,
  });
}

/**
 * List superbills for a practice with optional filters.
 */
export async function getSuperbills(
  practiceId: number,
  filters?: SuperbillFilters,
): Promise<Superbill[]> {
  const conditions = [eq(superbills.practiceId, practiceId)];

  if (filters?.patientId) {
    conditions.push(eq(superbills.patientId, filters.patientId));
  }
  if (filters?.status) {
    conditions.push(eq(superbills.status, filters.status));
  }
  if (filters?.startDate) {
    conditions.push(gte(superbills.dateOfService, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(superbills.dateOfService, filters.endDate));
  }

  const results = await db
    .select()
    .from(superbills)
    .where(and(...conditions))
    .orderBy(desc(superbills.dateOfService));

  return results;
}

/**
 * Get a single superbill by ID scoped to a practice.
 */
export async function getSuperbill(
  id: number,
  practiceId: number,
): Promise<Superbill | null> {
  const [superbill] = await db
    .select()
    .from(superbills)
    .where(and(eq(superbills.id, id), eq(superbills.practiceId, practiceId)));

  return superbill ?? null;
}

/**
 * Finalize a superbill (no further edits allowed).
 */
export async function finalizeSuperbill(
  id: number,
  practiceId: number,
): Promise<Superbill> {
  const existing = await getSuperbill(id, practiceId);

  if (!existing) {
    throw new Error(`Superbill ${id} not found for practice ${practiceId}`);
  }

  if (existing.status === 'finalized' || existing.status === 'sent') {
    throw new Error(`Superbill ${id} is already ${existing.status}`);
  }

  const [updated] = await db
    .update(superbills)
    .set({ status: 'finalized', updatedAt: new Date() })
    .where(and(eq(superbills.id, id), eq(superbills.practiceId, practiceId)))
    .returning();

  logger.info('Superbill finalized', { superbillId: id, practiceId });

  return updated;
}

/**
 * Mark a superbill as sent, recording delivery method and timestamp.
 */
export async function markSent(
  id: number,
  practiceId: number,
  method: 'email' | 'portal' | 'print',
): Promise<Superbill> {
  const existing = await getSuperbill(id, practiceId);

  if (!existing) {
    throw new Error(`Superbill ${id} not found for practice ${practiceId}`);
  }

  if (existing.status === 'draft') {
    throw new Error(`Superbill ${id} must be finalized before sending`);
  }

  const [updated] = await db
    .update(superbills)
    .set({
      status: 'sent',
      sentAt: new Date(),
      sentMethod: method,
      updatedAt: new Date(),
    })
    .where(and(eq(superbills.id, id), eq(superbills.practiceId, practiceId)))
    .returning();

  logger.info('Superbill marked as sent', {
    superbillId: id,
    practiceId,
    method,
  });

  return updated;
}

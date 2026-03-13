/**
 * Intake Form Service
 *
 * Manages digital intake form templates and patient submissions.
 * Patients fill out intake forms before their first appointment.
 */

import { eq, and, desc } from 'drizzle-orm';
import {
  intakeFormTemplates,
  intakeFormSubmissions,
  type IntakeFormTemplate,
  type IntakeFormSubmission,
} from '@shared/schema';
import { db } from '../db';
import logger from './logger';

export interface IntakeFieldDefinition {
  type: string;    // 'text', 'textarea', 'select', 'checkbox', 'radio', 'date', 'number'
  label: string;
  required: boolean;
  options?: string[];
}

export interface TemplateCreateData {
  name: string;
  description?: string;
  fields: IntakeFieldDefinition[];
  isActive?: boolean;
}

export interface TemplateUpdateData {
  name?: string;
  description?: string;
  fields?: IntakeFieldDefinition[];
  isActive?: boolean;
}

export interface SubmissionFilters {
  patientId?: number;
  status?: string;
  templateId?: number;
}

/**
 * Create a new intake form template for a practice.
 */
export async function createTemplate(
  practiceId: number,
  data: TemplateCreateData,
): Promise<IntakeFormTemplate> {
  if (!data.name || !data.fields || !Array.isArray(data.fields) || data.fields.length === 0) {
    throw new Error('Template name and at least one field are required');
  }

  const [template] = await db
    .insert(intakeFormTemplates)
    .values({
      practiceId,
      name: data.name,
      description: data.description ?? null,
      fields: data.fields,
      isActive: data.isActive ?? true,
    })
    .returning();

  logger.info('Intake form template created', {
    templateId: template.id,
    practiceId,
    name: data.name,
  });

  return template;
}

/**
 * List active intake form templates for a practice.
 */
export async function getTemplates(
  practiceId: number,
): Promise<IntakeFormTemplate[]> {
  const results = await db
    .select()
    .from(intakeFormTemplates)
    .where(
      and(
        eq(intakeFormTemplates.practiceId, practiceId),
        eq(intakeFormTemplates.isActive, true),
      ),
    )
    .orderBy(desc(intakeFormTemplates.createdAt));

  return results;
}

/**
 * Get a single intake form template by ID, scoped to a practice.
 */
export async function getTemplate(
  id: number,
  practiceId: number,
): Promise<IntakeFormTemplate | null> {
  const [template] = await db
    .select()
    .from(intakeFormTemplates)
    .where(
      and(
        eq(intakeFormTemplates.id, id),
        eq(intakeFormTemplates.practiceId, practiceId),
      ),
    );

  return template ?? null;
}

/**
 * Update an intake form template.
 */
export async function updateTemplate(
  id: number,
  practiceId: number,
  updates: TemplateUpdateData,
): Promise<IntakeFormTemplate> {
  const existing = await getTemplate(id, practiceId);
  if (!existing) {
    throw new Error(`Intake form template ${id} not found for practice ${practiceId}`);
  }

  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) setData.name = updates.name;
  if (updates.description !== undefined) setData.description = updates.description;
  if (updates.fields !== undefined) setData.fields = updates.fields;
  if (updates.isActive !== undefined) setData.isActive = updates.isActive;

  const [updated] = await db
    .update(intakeFormTemplates)
    .set(setData)
    .where(
      and(
        eq(intakeFormTemplates.id, id),
        eq(intakeFormTemplates.practiceId, practiceId),
      ),
    )
    .returning();

  logger.info('Intake form template updated', {
    templateId: id,
    practiceId,
  });

  return updated;
}

/**
 * Validate responses against template fields and save a submission.
 */
export async function submitForm(
  templateId: number,
  practiceId: number,
  patientId: number,
  responses: Record<string, unknown>,
): Promise<IntakeFormSubmission> {
  // Verify template exists and belongs to the practice
  const template = await getTemplate(templateId, practiceId);
  if (!template) {
    throw new Error(`Intake form template ${templateId} not found for practice ${practiceId}`);
  }

  // Validate required fields
  const fields = template.fields as IntakeFieldDefinition[];
  const missingFields: string[] = [];
  for (const field of fields) {
    if (field.required) {
      const value = responses[field.label];
      if (value === undefined || value === null || value === '') {
        missingFields.push(field.label);
      }
    }
  }

  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }

  const [submission] = await db
    .insert(intakeFormSubmissions)
    .values({
      templateId,
      practiceId,
      patientId,
      responses,
      status: 'submitted',
      submittedAt: new Date(),
    })
    .returning();

  logger.info('Intake form submitted', {
    submissionId: submission.id,
    templateId,
    practiceId,
    patientId,
  });

  return submission;
}

/**
 * List intake form submissions for a practice with optional filters.
 */
export async function getSubmissions(
  practiceId: number,
  filters?: SubmissionFilters,
): Promise<IntakeFormSubmission[]> {
  const conditions = [eq(intakeFormSubmissions.practiceId, practiceId)];

  if (filters?.patientId) {
    conditions.push(eq(intakeFormSubmissions.patientId, filters.patientId));
  }
  if (filters?.status) {
    conditions.push(eq(intakeFormSubmissions.status, filters.status));
  }
  if (filters?.templateId) {
    conditions.push(eq(intakeFormSubmissions.templateId, filters.templateId));
  }

  const results = await db
    .select()
    .from(intakeFormSubmissions)
    .where(and(...conditions))
    .orderBy(desc(intakeFormSubmissions.createdAt));

  return results;
}

/**
 * Get a single submission by ID, scoped to a practice.
 */
export async function getSubmission(
  id: number,
  practiceId: number,
): Promise<IntakeFormSubmission | null> {
  const [submission] = await db
    .select()
    .from(intakeFormSubmissions)
    .where(
      and(
        eq(intakeFormSubmissions.id, id),
        eq(intakeFormSubmissions.practiceId, practiceId),
      ),
    );

  return submission ?? null;
}

/**
 * Mark a submission as reviewed by a user.
 */
export async function markReviewed(
  id: number,
  practiceId: number,
  reviewedBy: string,
): Promise<IntakeFormSubmission> {
  const existing = await getSubmission(id, practiceId);
  if (!existing) {
    throw new Error(`Intake form submission ${id} not found for practice ${practiceId}`);
  }

  if (existing.status === 'reviewed') {
    throw new Error(`Intake form submission ${id} is already reviewed`);
  }

  const [updated] = await db
    .update(intakeFormSubmissions)
    .set({
      status: 'reviewed',
      reviewedBy,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(intakeFormSubmissions.id, id),
        eq(intakeFormSubmissions.practiceId, practiceId),
      ),
    )
    .returning();

  logger.info('Intake form submission reviewed', {
    submissionId: id,
    practiceId,
    reviewedBy,
  });

  return updated;
}

/**
 * Get all pending (unreviewed) submissions for a practice.
 */
export async function getPendingSubmissions(
  practiceId: number,
): Promise<IntakeFormSubmission[]> {
  return getSubmissions(practiceId, { status: 'submitted' });
}

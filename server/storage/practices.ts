import {
  practices,
  payerCredentials,
  payerIntegrations,
  ssoConfigurations,
  notificationTemplates,
  type Practice,
  type InsertPractice,
  type SsoConfiguration,
  type InsertSsoConfiguration,
  type NotificationTemplate,
  type InsertNotificationTemplate,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  encryptPracticeRecord,
  decryptPracticeRecord,
} from "../services/phiEncryptionService";
import { cache, CacheKeys } from "../services/cacheService";

// ==================== PRACTICE OPERATIONS ====================

export async function createPractice(practice: InsertPractice): Promise<Practice> {
  const encrypted = encryptPracticeRecord(practice as any);
  const [newPractice] = await db
    .insert(practices)
    .values(encrypted as any)
    .returning();
  return decryptPracticeRecord(newPractice) as Practice;
}

export async function getPractice(id: number): Promise<Practice | undefined> {
  const [practice] = await db
    .select()
    .from(practices)
    .where(eq(practices.id, id));
  return practice ? decryptPracticeRecord(practice) as Practice : undefined;
}

export async function getAllPracticeIds(): Promise<number[]> {
  const result = await db
    .select({ id: practices.id })
    .from(practices);
  return result.map((p: { id: number }) => p.id);
}

export async function updatePractice(id: number, practice: Partial<InsertPractice>): Promise<Practice> {
  const encrypted = encryptPracticeRecord(practice as any);
  const [updatedPractice] = await db
    .update(practices)
    .set({ ...encrypted, updatedAt: new Date() })
    .where(eq(practices.id, id))
    .returning();
  // Invalidate practice-related caches
  await cache.del(CacheKeys.practiceInfo(id));
  await cache.del(CacheKeys.telehealthSettings(id));
  return decryptPracticeRecord(updatedPractice) as Practice;
}

// ==================== PAYER CREDENTIALS ====================

export async function getPayerCredentials(practiceId: number, payerName?: string): Promise<any | undefined> {
  const [cred] = await db
    .select()
    .from(payerCredentials)
    .where(and(
      eq(payerCredentials.practiceId, practiceId),
      eq(payerCredentials.isActive, true),
    ));
  return cred;
}

export async function upsertPayerCredentials(practiceId: number, data: any): Promise<void> {
  const existing = await getPayerCredentials(practiceId);
  if (existing) {
    await db
      .update(payerCredentials)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(payerCredentials.id, existing.id));
  } else {
    await db.insert(payerCredentials).values({
      practiceId,
      ...data,
    } as any);
  }
}

export async function getAllPayerCredentials(practiceId: number): Promise<any[]> {
  return await db
    .select()
    .from(payerCredentials)
    .where(eq(payerCredentials.practiceId, practiceId));
}

export async function updatePayerHealthStatus(id: number, status: string): Promise<void> {
  await db
    .update(payerCredentials)
    .set({ updatedAt: new Date() } as any)
    .where(eq(payerCredentials.id, id));
}

export async function getPayerCredentialForPractice(practiceId: number, payerIntegrationId: number): Promise<any | undefined> {
  const [cred] = await db
    .select()
    .from(payerCredentials)
    .where(and(
      eq(payerCredentials.practiceId, practiceId),
      eq(payerCredentials.payerIntegrationId, payerIntegrationId),
      eq(payerCredentials.isActive, true),
    ));
  return cred;
}

export async function updatePayerCredential(id: number, data: any): Promise<any> {
  const [updated] = await db
    .update(payerCredentials)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(payerCredentials.id, id))
    .returning();
  return updated;
}

export async function createPayerCredential(data: any): Promise<any> {
  const [created] = await db
    .insert(payerCredentials)
    .values(data)
    .returning();
  return created;
}

export async function getAllPayerCredentialsList(practiceId?: number): Promise<any[]> {
  if (practiceId) {
    return getAllPayerCredentials(practiceId);
  }
  return await db.select().from(payerCredentials);
}

export async function getPayerIntegrationByCode(code: string): Promise<any | undefined> {
  const [integration] = await db
    .select()
    .from(payerIntegrations)
    .where(eq(payerIntegrations.payerCode, code));
  return integration;
}

export async function getPayerIntegrations(): Promise<any[]> {
  return await db.select().from(payerIntegrations);
}

export async function updatePayerIntegration(id: number, data: any): Promise<any> {
  const [updated] = await db
    .update(payerIntegrations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(payerIntegrations.id, id))
    .returning();
  return updated;
}

// ==================== SSO CONFIGURATION ====================

export async function getSsoConfigByPractice(practiceId: number): Promise<SsoConfiguration | undefined> {
  const [config] = await db
    .select()
    .from(ssoConfigurations)
    .where(eq(ssoConfigurations.practiceId, practiceId));
  return config || undefined;
}

export async function getSsoConfigByEmailDomain(domain: string): Promise<SsoConfiguration | undefined> {
  const normalizedDomain = domain.toLowerCase();
  const [config] = await db
    .select()
    .from(ssoConfigurations)
    .where(
      and(
        eq(ssoConfigurations.emailDomain, normalizedDomain),
        eq(ssoConfigurations.enabled, true),
      )
    );
  return config || undefined;
}

export async function upsertSsoConfig(config: InsertSsoConfiguration): Promise<SsoConfiguration> {
  const existing = await getSsoConfigByPractice(config.practiceId);
  if (existing) {
    const [updated] = await db
      .update(ssoConfigurations)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(ssoConfigurations.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(ssoConfigurations)
    .values(config as any)
    .returning();
  return created;
}

export async function updateSsoConfig(id: number, config: Partial<InsertSsoConfiguration>): Promise<SsoConfiguration | undefined> {
  const [updated] = await db
    .update(ssoConfigurations)
    .set({ ...config, updatedAt: new Date() })
    .where(eq(ssoConfigurations.id, id))
    .returning();
  return updated || undefined;
}

// ==================== NOTIFICATION TEMPLATES (P0.5) ====================

/**
 * Practice-customizable notification templates. Layered on top of the
 * hardcoded defaults in emailTemplates.ts / smsService.ts — if a practice
 * has a custom row for (notification_type, channel), it wins; otherwise
 * the default is used.
 *
 * The unique constraint (practice_id, notification_type, channel) means
 * at most one custom template per pair. Upsert is the natural pattern.
 */

export async function getNotificationTemplates(practiceId: number): Promise<NotificationTemplate[]> {
  return db
    .select()
    .from(notificationTemplates)
    .where(eq(notificationTemplates.practiceId, practiceId))
    .orderBy(desc(notificationTemplates.updatedAt));
}

export async function getNotificationTemplate(
  practiceId: number,
  notificationType: string,
  channel: string,
): Promise<NotificationTemplate | undefined> {
  const [row] = await db
    .select()
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.practiceId, practiceId),
        eq(notificationTemplates.notificationType, notificationType),
        eq(notificationTemplates.channel, channel),
        eq(notificationTemplates.isActive, true),
      ),
    )
    .limit(1);
  return row;
}

export async function upsertNotificationTemplate(
  template: InsertNotificationTemplate,
): Promise<NotificationTemplate> {
  // Try to update first (covers the common "edit existing" path).
  const existing = await getNotificationTemplate(
    template.practiceId,
    template.notificationType,
    template.channel,
  );
  if (existing) {
    const [updated] = await db
      .update(notificationTemplates)
      .set({
        subject: template.subject ?? null,
        body: template.body,
        isActive: template.isActive ?? true,
        updatedAt: new Date(),
      })
      .where(eq(notificationTemplates.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(notificationTemplates)
    .values({ ...template, updatedAt: new Date() } as any)
    .returning();
  return created;
}

export async function deleteNotificationTemplate(
  practiceId: number,
  templateId: number,
): Promise<boolean> {
  // Soft delete via isActive=false so the fallback to default kicks in
  // without losing the body for audit/restore.
  const [updated] = await db
    .update(notificationTemplates)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(notificationTemplates.id, templateId),
        eq(notificationTemplates.practiceId, practiceId),
      ),
    )
    .returning();
  return !!updated;
}

import {
  practices,
  payerCredentials,
  payerIntegrations,
  ssoConfigurations,
  type Practice,
  type InsertPractice,
  type SsoConfiguration,
  type InsertSsoConfiguration,
} from "@shared/schema";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
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

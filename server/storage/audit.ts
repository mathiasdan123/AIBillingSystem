import {
  auditLog,
  baaRecords,
  breachIncidents,
  amendmentRequests,
  complianceChecks,
  conversations,
  messages,
  messageNotifications,
  patientPortalAccess,
  patientDocuments,
  patients,
  type AuditLog,
  type InsertAuditLog,
  type BaaRecord,
  type InsertBaaRecord,
  type BreachIncident,
  type InsertBreachIncident,
  type AmendmentRequest,
  type InsertAmendmentRequest,
  type ComplianceCheck,
  type InsertComplianceCheck,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type MessageNotification,
  type InsertMessageNotification,
  type PatientPortalAccess,
  type InsertPatientPortalAccess,
  type PatientDocument,
  type InsertPatientDocument,
  type Patient,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lte, count, sum, sql, isNull, inArray, ne } from "drizzle-orm";
import { createHash } from "crypto";
import { getPatient, getPatientStatements } from "./patients";

// ==================== AUDIT LOG ====================

export async function createAuditLog(entry: InsertAuditLog): Promise<AuditLog> {
  const [lastEntry] = await db
    .select({ integrityHash: auditLog.integrityHash })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1);

  const previousHash = lastEntry?.integrityHash || "GENESIS";
  const entryData = JSON.stringify(entry);
  const hash = createHash("sha256")
    .update(previousHash + entryData)
    .digest("hex");

  const [created] = await db
    .insert(auditLog)
    .values({ ...entry, integrityHash: hash })
    .returning();
  return created;
}

export async function createAuditLogEntry(entry: any): Promise<any> {
  return createAuditLog(entry);
}

export async function verifyAuditLogIntegrity(limit?: number): Promise<{ valid: boolean; checkedCount: number; brokenAtId?: number }> {
  const entries = await db
    .select()
    .from(auditLog)
    .orderBy(auditLog.id)
    .limit(limit || 1000);

  let previousHash = "GENESIS";
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.integrityHash) {
      continue;
    }
    const { integrityHash, id, createdAt, ...entryFields } = entry;
    const entryData = JSON.stringify(entryFields);
    const expectedHash = createHash("sha256")
      .update(previousHash + entryData)
      .digest("hex");

    if (integrityHash !== expectedHash) {
      return { valid: false, checkedCount: i + 1, brokenAtId: entry.id };
    }
    previousHash = integrityHash;
  }
  return { valid: true, checkedCount: entries.length };
}

export async function getAuditLogsForResource(resourceType: string, resourceId: string): Promise<AuditLog[]> {
  return await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.resourceType, resourceType), eq(auditLog.resourceId, resourceId)))
    .orderBy(desc(auditLog.createdAt));
}

export async function getAuditLogs(filters: any): Promise<any[]> {
  return await db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(100);
}

export async function getAuditLogsPaginated(filters: {
  practiceId?: number;
  userId?: string;
  eventCategory?: string;
  startDate?: Date;
  endDate?: Date;
  page: number;
  limit: number;
}): Promise<{ logs: AuditLog[]; total: number }> {
  const conditions: any[] = [];
  if (filters.practiceId) conditions.push(eq(auditLog.practiceId, filters.practiceId));
  if (filters.userId) conditions.push(eq(auditLog.userId, filters.userId));
  if (filters.eventCategory) conditions.push(eq(auditLog.eventCategory, filters.eventCategory));
  if (filters.startDate) conditions.push(gte(auditLog.createdAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(auditLog.createdAt, filters.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db
    .select({ count: count() })
    .from(auditLog)
    .where(whereClause);

  const logs = await db
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(filters.limit)
    .offset((filters.page - 1) * filters.limit);

  return { logs, total: totalResult?.count || 0 };
}

// ==================== BAA RECORDS ====================

export async function createBaaRecord(record: InsertBaaRecord): Promise<BaaRecord> {
  const [created] = await db.insert(baaRecords).values(record).returning();
  return created;
}

export async function getBaaRecords(practiceId: number): Promise<BaaRecord[]> {
  return await db
    .select()
    .from(baaRecords)
    .where(eq(baaRecords.practiceId, practiceId))
    .orderBy(desc(baaRecords.createdAt));
}

export async function updateBaaRecord(id: number, record: Partial<InsertBaaRecord>): Promise<BaaRecord> {
  const [updated] = await db
    .update(baaRecords)
    .set({ ...record, updatedAt: new Date() })
    .where(eq(baaRecords.id, id))
    .returning();
  return updated;
}

export async function deleteBaaRecord(id: number): Promise<void> {
  await db.delete(baaRecords).where(eq(baaRecords.id, id));
}

export async function getExpiringBaaRecords(daysAhead: number): Promise<BaaRecord[]> {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);
  return await db
    .select()
    .from(baaRecords)
    .where(and(
      eq(baaRecords.status, 'active'),
      lte(baaRecords.expirationDate, futureDate.toISOString().split('T')[0]),
    ));
}

// ==================== BREACH INCIDENTS ====================

export async function createBreachIncident(data: InsertBreachIncident): Promise<BreachIncident> {
  const [created] = await db.insert(breachIncidents).values(data).returning();
  return created;
}

export async function getBreachIncident(id: number): Promise<BreachIncident | undefined> {
  const [incident] = await db.select().from(breachIncidents).where(eq(breachIncidents.id, id));
  return incident;
}

export async function updateBreachIncident(id: number, data: Partial<InsertBreachIncident>): Promise<BreachIncident> {
  const [updated] = await db
    .update(breachIncidents)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(breachIncidents.id, id))
    .returning();
  return updated;
}

export async function getBreachIncidentsByPractice(practiceId: number): Promise<BreachIncident[]> {
  return await db
    .select()
    .from(breachIncidents)
    .where(eq(breachIncidents.practiceId, practiceId))
    .orderBy(desc(breachIncidents.createdAt));
}

export async function getBreachesRequiringNotification(): Promise<BreachIncident[]> {
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  return await db
    .select()
    .from(breachIncidents)
    .where(
      and(
        ne(breachIncidents.notificationStatus, "complete"),
        ne(breachIncidents.status, "closed"),
        gte(breachIncidents.discoveredAt, sixtyDaysAgo)
      )
    )
    .orderBy(breachIncidents.discoveredAt);
}

// ==================== AMENDMENT REQUESTS ====================

export async function createAmendmentRequest(data: InsertAmendmentRequest): Promise<AmendmentRequest> {
  const [created] = await db.insert(amendmentRequests).values(data).returning();
  return created;
}

export async function getAmendmentRequest(id: number): Promise<AmendmentRequest | undefined> {
  const [request] = await db.select().from(amendmentRequests).where(eq(amendmentRequests.id, id));
  return request;
}

export async function updateAmendmentRequest(id: number, data: Partial<InsertAmendmentRequest>): Promise<AmendmentRequest> {
  const [updated] = await db
    .update(amendmentRequests)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(amendmentRequests.id, id))
    .returning();
  return updated;
}

export async function getAmendmentRequestsByPatient(patientId: number): Promise<AmendmentRequest[]> {
  return await db
    .select()
    .from(amendmentRequests)
    .where(eq(amendmentRequests.patientId, patientId))
    .orderBy(desc(amendmentRequests.createdAt));
}

export async function getPendingAmendmentRequests(practiceId: number): Promise<AmendmentRequest[]> {
  return await db
    .select()
    .from(amendmentRequests)
    .where(
      and(
        eq(amendmentRequests.practiceId, practiceId),
        inArray(amendmentRequests.status, ["pending", "extended"])
      )
    )
    .orderBy(amendmentRequests.responseDeadline);
}

// ==================== COMPLIANCE CHECKS ====================

export async function getComplianceChecks(practiceId: number): Promise<ComplianceCheck[]> {
  return await db
    .select()
    .from(complianceChecks)
    .where(eq(complianceChecks.practiceId, practiceId))
    .orderBy(desc(complianceChecks.lastCheckedAt));
}

export async function upsertComplianceCheck(data: InsertComplianceCheck): Promise<ComplianceCheck> {
  const [existing] = await db
    .select()
    .from(complianceChecks)
    .where(and(
      eq(complianceChecks.practiceId, data.practiceId),
      eq(complianceChecks.checkType, data.checkType),
    ));

  if (existing) {
    const [updated] = await db
      .update(complianceChecks)
      .set({
        status: data.status,
        lastCheckedAt: new Date(),
        details: data.details,
        notes: data.notes,
      })
      .where(eq(complianceChecks.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(complianceChecks).values(data).returning();
  return created;
}

// ==================== SECURE MESSAGING ====================

export function generatePatientAccessToken(): string {
  return createHash('sha256')
    .update(Math.random().toString() + Date.now().toString())
    .digest('hex')
    .substring(0, 64);
}

export async function createConversation(conversation: InsertConversation): Promise<Conversation> {
  const patientAccessToken = generatePatientAccessToken();
  const tokenExpiry = new Date();
  tokenExpiry.setDate(tokenExpiry.getDate() + 30);

  const [result] = await db.insert(conversations).values({
    ...conversation,
    patientAccessToken,
    patientTokenExpiresAt: tokenExpiry,
  }).returning();
  return result;
}

export async function getConversation(id: number): Promise<Conversation | undefined> {
  const [result] = await db.select().from(conversations).where(eq(conversations.id, id));
  return result;
}

export async function getConversationByToken(token: string): Promise<Conversation | undefined> {
  const [result] = await db
    .select()
    .from(conversations)
    .where(and(
      eq(conversations.patientAccessToken, token),
      gte(conversations.patientTokenExpiresAt, new Date())
    ));
  return result;
}

export async function getConversations(practiceId: number, filters?: {
  therapistId?: string;
  patientId?: number;
  status?: string;
}): Promise<(Conversation & { patient: Patient | null })[]> {
  const conditions: any[] = [eq(conversations.practiceId, practiceId)];

  if (filters?.therapistId) conditions.push(eq(conversations.therapistId, filters.therapistId));
  if (filters?.patientId) conditions.push(eq(conversations.patientId, filters.patientId));
  if (filters?.status) conditions.push(eq(conversations.status, filters.status));

  const results = await db
    .select({
      conversation: conversations,
      patient: patients,
    })
    .from(conversations)
    .leftJoin(patients, eq(conversations.patientId, patients.id))
    .where(and(...conditions))
    .orderBy(desc(conversations.lastMessageAt));

  return results.map((r: { conversation: Conversation; patient: Patient | null }) => ({
    ...r.conversation,
    patient: r.patient,
  }));
}

export async function getPatientConversations(patientId: number): Promise<Conversation[]> {
  return await db
    .select()
    .from(conversations)
    .where(eq(conversations.patientId, patientId))
    .orderBy(desc(conversations.lastMessageAt));
}

export async function updateConversation(id: number, updates: Partial<InsertConversation>): Promise<Conversation> {
  const [result] = await db
    .update(conversations)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  return result;
}

export async function archiveConversation(id: number): Promise<Conversation> {
  return updateConversation(id, { status: 'archived' });
}

export async function createMessage(message: InsertMessage): Promise<Message> {
  const [result] = await db.insert(messages).values({
    ...message,
    deliveredAt: new Date(),
  }).returning();

  const conversation = await getConversation(message.conversationId);
  if (conversation) {
    const updates: Record<string, unknown> = {
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    };

    if (message.senderType === 'therapist') {
      updates.unreadByPatient = (conversation.unreadByPatient || 0) + 1;
    } else {
      updates.unreadByTherapist = (conversation.unreadByTherapist || 0) + 1;
    }

    await db
      .update(conversations)
      .set(updates)
      .where(eq(conversations.id, message.conversationId));
  }

  return result;
}

export async function getMessage(id: number): Promise<Message | undefined> {
  const [result] = await db.select().from(messages).where(eq(messages.id, id));
  return result;
}

export async function getMessages(conversationId: number, limit: number = 50, offset: number = 0): Promise<Message[]> {
  return await db
    .select()
    .from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      isNull(messages.deletedAt)
    ))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function markMessageRead(id: number): Promise<Message> {
  const [result] = await db
    .update(messages)
    .set({
      readAt: new Date(),
      readByRecipient: true,
    })
    .where(eq(messages.id, id))
    .returning();
  return result;
}

export async function markConversationReadByTherapist(conversationId: number): Promise<void> {
  await db
    .update(messages)
    .set({
      readAt: new Date(),
      readByRecipient: true,
    })
    .where(and(
      eq(messages.conversationId, conversationId),
      eq(messages.senderType, 'patient'),
      isNull(messages.readAt)
    ));

  await db
    .update(conversations)
    .set({ unreadByTherapist: 0, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function markConversationReadByPatient(conversationId: number): Promise<void> {
  await db
    .update(messages)
    .set({
      readAt: new Date(),
      readByRecipient: true,
    })
    .where(and(
      eq(messages.conversationId, conversationId),
      eq(messages.senderType, 'therapist'),
      isNull(messages.readAt)
    ));

  await db
    .update(conversations)
    .set({ unreadByPatient: 0, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function softDeleteMessage(id: number, deletedBy: string): Promise<Message> {
  const [result] = await db
    .update(messages)
    .set({
      deletedAt: new Date(),
      deletedBy,
    })
    .where(eq(messages.id, id))
    .returning();
  return result;
}

export async function getUnreadCount(practiceId: number, therapistId?: string): Promise<number> {
  const conditions: any[] = [eq(conversations.practiceId, practiceId)];
  if (therapistId) conditions.push(eq(conversations.therapistId, therapistId));

  const [result] = await db
    .select({ total: sum(conversations.unreadByTherapist) })
    .from(conversations)
    .where(and(...conditions));

  return Number(result?.total || 0);
}

export async function getPatientUnreadCount(patientId: number): Promise<number> {
  const [result] = await db
    .select({ total: sum(conversations.unreadByPatient) })
    .from(conversations)
    .where(eq(conversations.patientId, patientId));

  return Number(result?.total || 0);
}

export async function createMessageNotification(notification: InsertMessageNotification): Promise<MessageNotification> {
  const [result] = await db.insert(messageNotifications).values(notification).returning();
  return result;
}

export async function updateMessageNotification(id: number, updates: Partial<InsertMessageNotification>): Promise<MessageNotification> {
  const [result] = await db
    .update(messageNotifications)
    .set(updates)
    .where(eq(messageNotifications.id, id))
    .returning();
  return result;
}

export async function getPendingNotifications(): Promise<MessageNotification[]> {
  return await db
    .select()
    .from(messageNotifications)
    .where(eq(messageNotifications.status, 'pending'))
    .orderBy(messageNotifications.createdAt);
}

export async function refreshPatientAccessToken(conversationId: number): Promise<Conversation> {
  const newToken = generatePatientAccessToken();
  const tokenExpiry = new Date();
  tokenExpiry.setDate(tokenExpiry.getDate() + 30);

  const [result] = await db
    .update(conversations)
    .set({
      patientAccessToken: newToken,
      patientTokenExpiresAt: tokenExpiry,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId))
    .returning();
  return result;
}

export async function getConversationWithMessages(id: number): Promise<{
  conversation: Conversation;
  messages: Message[];
  patient: Patient | null;
} | null> {
  const conversation = await getConversation(id);
  if (!conversation) return null;

  const msgs = await getMessages(id, 100);
  const patient = conversation.patientId
    ? await getPatient(conversation.patientId)
    : null;

  return {
    conversation,
    messages: msgs.reverse(),
    patient: patient || null,
  };
}

// ==================== PATIENT PORTAL ====================

export function generatePortalToken(): string {
  return createHash('sha256')
    .update(Math.random().toString() + Date.now().toString() + 'portal')
    .digest('hex')
    .substring(0, 64);
}

export function generateMagicLinkToken(): string {
  return createHash('sha256')
    .update(Math.random().toString() + Date.now().toString() + 'magic')
    .digest('hex')
    .substring(0, 64);
}

export async function createPatientPortalAccess(dataOrPatientId: InsertPatientPortalAccess | number, practiceId?: number): Promise<PatientPortalAccess> {
  if (typeof dataOrPatientId === 'object') {
    const [result] = await db.insert(patientPortalAccess).values(dataOrPatientId).returning();
    return result;
  }

  const portalToken = generatePortalToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  const [result] = await db.insert(patientPortalAccess).values({
    patientId: dataOrPatientId,
    practiceId: practiceId!,
    portalToken,
    portalTokenExpiresAt: expiresAt,
  }).returning();
  return result;
}

export async function updatePatientPortalMagicLink(id: number, magicLinkToken: string, magicLinkExpiresAt: Date): Promise<PatientPortalAccess> {
  const [result] = await db
    .update(patientPortalAccess)
    .set({
      magicLinkToken,
      magicLinkExpiresAt,
      magicLinkUsedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(patientPortalAccess.id, id))
    .returning();
  return result;
}

export async function getPatientPortalAccess(patientId: number): Promise<PatientPortalAccess | undefined> {
  const [result] = await db
    .select()
    .from(patientPortalAccess)
    .where(and(
      eq(patientPortalAccess.patientId, patientId),
      eq(patientPortalAccess.isActive, true)
    ));
  return result;
}

export async function getPatientPortalByToken(token: string): Promise<PatientPortalAccess | undefined> {
  const [result] = await db
    .select()
    .from(patientPortalAccess)
    .where(and(
      eq(patientPortalAccess.portalToken, token),
      eq(patientPortalAccess.isActive, true),
      gte(patientPortalAccess.portalTokenExpiresAt, new Date())
    ));
  return result;
}

export async function getPatientPortalByMagicLink(token: string): Promise<PatientPortalAccess | undefined> {
  const [result] = await db
    .select()
    .from(patientPortalAccess)
    .where(and(
      eq(patientPortalAccess.magicLinkToken, token),
      eq(patientPortalAccess.isActive, true),
      gte(patientPortalAccess.magicLinkExpiresAt, new Date()),
      isNull(patientPortalAccess.magicLinkUsedAt)
    ));
  return result;
}

export async function createMagicLink(patientId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = generateMagicLinkToken();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 15);

  await db
    .update(patientPortalAccess)
    .set({
      magicLinkToken: token,
      magicLinkExpiresAt: expiresAt,
      magicLinkUsedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(patientPortalAccess.patientId, patientId));

  return { token, expiresAt };
}

export async function useMagicLink(token: string): Promise<PatientPortalAccess | null> {
  const access = await getPatientPortalByMagicLink(token);
  if (!access) return null;

  const [result] = await db
    .update(patientPortalAccess)
    .set({
      magicLinkUsedAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: (access.accessCount || 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(patientPortalAccess.id, access.id))
    .returning();

  return result;
}

export async function updatePortalAccess(patientId: number): Promise<void> {
  await db
    .update(patientPortalAccess)
    .set({
      lastAccessedAt: new Date(),
      accessCount: sql`${patientPortalAccess.accessCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(patientPortalAccess.patientId, patientId));
}

export async function refreshPortalToken(patientId: number): Promise<PatientPortalAccess> {
  const newToken = generatePortalToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  const [result] = await db
    .update(patientPortalAccess)
    .set({
      portalToken: newToken,
      portalTokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(patientPortalAccess.patientId, patientId))
    .returning();

  return result;
}

export async function createPatientDocument(document: InsertPatientDocument): Promise<PatientDocument> {
  const [result] = await db.insert(patientDocuments).values(document).returning();
  return result;
}

export async function getPatientDocuments(patientId: number, visibleToPatient?: boolean): Promise<PatientDocument[]> {
  const conditions: any[] = [eq(patientDocuments.patientId, patientId)];
  if (visibleToPatient !== undefined) {
    conditions.push(eq(patientDocuments.visibleToPatient, visibleToPatient));
  }

  return await db
    .select()
    .from(patientDocuments)
    .where(and(...conditions))
    .orderBy(desc(patientDocuments.createdAt));
}

export async function getPatientDocument(id: number): Promise<PatientDocument | undefined> {
  const [result] = await db.select().from(patientDocuments).where(eq(patientDocuments.id, id));
  return result;
}

export async function updatePatientDocument(id: number, updates: Partial<InsertPatientDocument>): Promise<PatientDocument> {
  const [result] = await db
    .update(patientDocuments)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(patientDocuments.id, id))
    .returning();
  return result;
}

export async function markDocumentViewed(id: number): Promise<PatientDocument> {
  const [result] = await db
    .update(patientDocuments)
    .set({ viewedAt: new Date(), updatedAt: new Date() })
    .where(eq(patientDocuments.id, id))
    .returning();
  return result;
}

export async function markDocumentDownloaded(id: number): Promise<PatientDocument> {
  const [result] = await db
    .update(patientDocuments)
    .set({ downloadedAt: new Date(), updatedAt: new Date() })
    .where(eq(patientDocuments.id, id))
    .returning();
  return result;
}

export async function signDocument(id: number, signatureData: string): Promise<PatientDocument> {
  const [result] = await db
    .update(patientDocuments)
    .set({
      signedAt: new Date(),
      signatureData,
      updatedAt: new Date(),
    })
    .where(eq(patientDocuments.id, id))
    .returning();
  return result;
}

export async function getPatientPortalDashboard(patientId: number): Promise<{
  patient: Patient | null;
  upcomingAppointments: any[];
  recentStatements: any[];
  unreadMessages: number;
  documents: PatientDocument[];
}> {
  const patient = await getPatient(patientId);

  const now = new Date();
  // Import lazily to avoid circular
  const { getAppointments } = await import('./appointments');
  const allAppointments = patient?.practiceId
    ? await getAppointments(patient.practiceId)
    : [];
  const upcomingAppointments = allAppointments
    .filter((apt: any) => apt.patientId === patientId && new Date(apt.startTime) >= now && apt.status !== 'cancelled')
    .sort((a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 5);

  const statements = await getPatientStatements(patientId);
  const recentStatements = statements.slice(0, 5);

  const unreadMessages = await getPatientUnreadCount(patientId);

  const documents = await getPatientDocuments(patientId, true);

  return {
    patient: patient || null,
    upcomingAppointments,
    recentStatements,
    unreadMessages,
    documents,
  };
}

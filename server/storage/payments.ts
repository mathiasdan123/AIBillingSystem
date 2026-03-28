import {
  patientPaymentMethods,
  paymentTransactions,
  paymentPlans,
  paymentPlanInstallments,
  practicePaymentSettings,
  patientStatements,
  patientPayments,
  webhookEvents,
  type PatientPaymentMethod,
  type InsertPatientPaymentMethod,
  type PaymentTransaction,
  type InsertPaymentTransaction,
  type PaymentPlan,
  type InsertPaymentPlan,
  type PaymentPlanInstallment,
  type InsertPaymentPlanInstallment,
  type PracticePaymentSettings,
  type InsertPracticePaymentSettings,
  type PatientPayment,
  type InsertPatientPayment,
  type WebhookEvent,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lte, lt, inArray } from "drizzle-orm";
import {
  encryptPracticePaymentSettingsRecord,
  decryptPracticePaymentSettingsRecord,
} from "../services/phiEncryptionService";
import { getPatientStatements } from "./patients";

// ==================== PATIENT PAYMENT METHODS ====================

export async function createPatientPaymentMethod(method: InsertPatientPaymentMethod): Promise<PatientPaymentMethod> {
  if (method.isDefault) {
    await db.update(patientPaymentMethods)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(
        eq(patientPaymentMethods.patientId, method.patientId),
        eq(patientPaymentMethods.isActive, true)
      ));
  }
  const [newMethod] = await db.insert(patientPaymentMethods).values(method).returning();
  return newMethod;
}

export async function getPatientPaymentMethods(patientId: number): Promise<PatientPaymentMethod[]> {
  return db.select()
    .from(patientPaymentMethods)
    .where(and(
      eq(patientPaymentMethods.patientId, patientId),
      eq(patientPaymentMethods.isActive, true)
    ))
    .orderBy(desc(patientPaymentMethods.isDefault), patientPaymentMethods.createdAt);
}

export async function getPatientPaymentMethod(id: number): Promise<PatientPaymentMethod | undefined> {
  const [method] = await db.select()
    .from(patientPaymentMethods)
    .where(eq(patientPaymentMethods.id, id));
  return method;
}

export async function getDefaultPaymentMethod(patientId: number): Promise<PatientPaymentMethod | undefined> {
  const [method] = await db.select()
    .from(patientPaymentMethods)
    .where(and(
      eq(patientPaymentMethods.patientId, patientId),
      eq(patientPaymentMethods.isDefault, true),
      eq(patientPaymentMethods.isActive, true)
    ));
  return method;
}

export async function updatePatientPaymentMethod(id: number, updates: Partial<InsertPatientPaymentMethod>): Promise<PatientPaymentMethod | undefined> {
  const [updated] = await db.update(patientPaymentMethods)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(patientPaymentMethods.id, id))
    .returning();
  return updated;
}

export async function setDefaultPaymentMethod(id: number, patientId: number): Promise<PatientPaymentMethod | undefined> {
  await db.update(patientPaymentMethods)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(
      eq(patientPaymentMethods.patientId, patientId),
      eq(patientPaymentMethods.isActive, true)
    ));
  return updatePatientPaymentMethod(id, { isDefault: true });
}

export async function deletePatientPaymentMethod(id: number): Promise<void> {
  await db.update(patientPaymentMethods)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(patientPaymentMethods.id, id));
}

// ==================== PAYMENT TRANSACTIONS ====================

export async function createPaymentTransaction(transaction: InsertPaymentTransaction): Promise<PaymentTransaction> {
  const [newTransaction] = await db.insert(paymentTransactions).values(transaction).returning();
  return newTransaction;
}

export async function getPaymentTransactions(practiceId: number, filters?: {
  patientId?: number;
  status?: string;
  type?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}): Promise<PaymentTransaction[]> {
  const conditions: any[] = [eq(paymentTransactions.practiceId, practiceId)];

  if (filters?.patientId) {
    conditions.push(eq(paymentTransactions.patientId, filters.patientId));
  }
  if (filters?.status) {
    conditions.push(eq(paymentTransactions.status, filters.status));
  }
  if (filters?.type) {
    conditions.push(eq(paymentTransactions.type, filters.type));
  }
  if (filters?.startDate) {
    conditions.push(gte(paymentTransactions.createdAt, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(paymentTransactions.createdAt, filters.endDate));
  }

  let query = db.select()
    .from(paymentTransactions)
    .where(and(...conditions))
    .orderBy(desc(paymentTransactions.createdAt));

  if (filters?.limit) {
    query = query.limit(filters.limit) as typeof query;
  }

  return query;
}

export async function getPaymentTransaction(id: number): Promise<PaymentTransaction | undefined> {
  const [transaction] = await db.select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.id, id));
  return transaction;
}

export async function updatePaymentTransaction(id: number, updates: Partial<InsertPaymentTransaction>): Promise<PaymentTransaction | undefined> {
  const [updated] = await db.update(paymentTransactions)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(paymentTransactions.id, id))
    .returning();
  return updated;
}

export async function getPatientPaymentHistory(patientId: number): Promise<PaymentTransaction[]> {
  return db.select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.patientId, patientId))
    .orderBy(desc(paymentTransactions.createdAt));
}

// ==================== PAYMENT PLANS ====================

export async function createPaymentPlan(plan: InsertPaymentPlan): Promise<PaymentPlan> {
  const [newPlan] = await db.insert(paymentPlans).values(plan).returning();
  return newPlan;
}

export async function getPaymentPlans(practiceId: number, filters?: {
  patientId?: number;
  status?: string;
}): Promise<PaymentPlan[]> {
  const conditions: any[] = [eq(paymentPlans.practiceId, practiceId)];

  if (filters?.patientId) {
    conditions.push(eq(paymentPlans.patientId, filters.patientId));
  }
  if (filters?.status) {
    conditions.push(eq(paymentPlans.status, filters.status));
  }

  return db.select()
    .from(paymentPlans)
    .where(and(...conditions))
    .orderBy(desc(paymentPlans.createdAt));
}

export async function getPaymentPlan(id: number): Promise<PaymentPlan | undefined> {
  const [plan] = await db.select()
    .from(paymentPlans)
    .where(eq(paymentPlans.id, id));
  return plan;
}

export async function updatePaymentPlan(id: number, updates: Partial<InsertPaymentPlan>): Promise<PaymentPlan | undefined> {
  const [updated] = await db.update(paymentPlans)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(paymentPlans.id, id))
    .returning();
  return updated;
}

export async function getPatientPaymentPlans(patientId: number): Promise<PaymentPlan[]> {
  return db.select()
    .from(paymentPlans)
    .where(eq(paymentPlans.patientId, patientId))
    .orderBy(desc(paymentPlans.createdAt));
}

export async function getActivePaymentPlans(practiceId: number): Promise<PaymentPlan[]> {
  return db.select()
    .from(paymentPlans)
    .where(and(
      eq(paymentPlans.practiceId, practiceId),
      eq(paymentPlans.status, 'active')
    ))
    .orderBy(paymentPlans.nextPaymentDate);
}

// ==================== PAYMENT PLAN INSTALLMENTS ====================

export async function createPaymentPlanInstallment(installment: InsertPaymentPlanInstallment): Promise<PaymentPlanInstallment> {
  const [newInstallment] = await db.insert(paymentPlanInstallments).values(installment).returning();
  return newInstallment;
}

export async function getPaymentPlanInstallments(planId: number): Promise<PaymentPlanInstallment[]> {
  return db.select()
    .from(paymentPlanInstallments)
    .where(eq(paymentPlanInstallments.paymentPlanId, planId))
    .orderBy(paymentPlanInstallments.installmentNumber);
}

export async function updatePaymentPlanInstallment(id: number, updates: Partial<InsertPaymentPlanInstallment>): Promise<PaymentPlanInstallment | undefined> {
  const [updated] = await db.update(paymentPlanInstallments)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(paymentPlanInstallments.id, id))
    .returning();
  return updated;
}

export async function getDueInstallments(practiceId: number): Promise<PaymentPlanInstallment[]> {
  const today = new Date().toISOString().split('T')[0];
  const activePlans = await getActivePaymentPlans(practiceId);
  const planIds = activePlans.map((p: PaymentPlan) => p.id);

  if (planIds.length === 0) return [];

  return db.select()
    .from(paymentPlanInstallments)
    .where(and(
      inArray(paymentPlanInstallments.paymentPlanId, planIds),
      eq(paymentPlanInstallments.status, 'scheduled'),
      lte(paymentPlanInstallments.dueDate, today)
    ))
    .orderBy(paymentPlanInstallments.dueDate);
}

export async function getPaymentPlanInstallment(id: number): Promise<PaymentPlanInstallment | undefined> {
  const [installment] = await db.select()
    .from(paymentPlanInstallments)
    .where(eq(paymentPlanInstallments.id, id));
  return installment;
}

export async function getUpcomingInstallments(practiceId: number, days: number = 7): Promise<PaymentPlanInstallment[]> {
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + days);

  const activePlans = await getActivePaymentPlans(practiceId);
  const planIds = activePlans.map((p: PaymentPlan) => p.id);

  if (planIds.length === 0) return [];

  return db.select()
    .from(paymentPlanInstallments)
    .where(and(
      inArray(paymentPlanInstallments.paymentPlanId, planIds),
      eq(paymentPlanInstallments.status, 'scheduled'),
      gte(paymentPlanInstallments.dueDate, today.toISOString().split('T')[0]),
      lte(paymentPlanInstallments.dueDate, futureDate.toISOString().split('T')[0])
    ))
    .orderBy(paymentPlanInstallments.dueDate);
}

export async function getOverdueInstallments(practiceId: number): Promise<PaymentPlanInstallment[]> {
  const today = new Date().toISOString().split('T')[0];
  const activePlans = await getActivePaymentPlans(practiceId);
  const planIds = activePlans.map((p: PaymentPlan) => p.id);

  if (planIds.length === 0) return [];

  return db.select()
    .from(paymentPlanInstallments)
    .where(and(
      inArray(paymentPlanInstallments.paymentPlanId, planIds),
      eq(paymentPlanInstallments.status, 'scheduled'),
      lt(paymentPlanInstallments.dueDate, today)
    ))
    .orderBy(paymentPlanInstallments.dueDate);
}

// ==================== PRACTICE PAYMENT SETTINGS ====================

export async function getPracticePaymentSettings(practiceId: number): Promise<PracticePaymentSettings | undefined> {
  const [settings] = await db.select()
    .from(practicePaymentSettings)
    .where(eq(practicePaymentSettings.practiceId, practiceId));
  return settings ? decryptPracticePaymentSettingsRecord(settings) as PracticePaymentSettings : undefined;
}

export async function upsertPracticePaymentSettings(settings: InsertPracticePaymentSettings): Promise<PracticePaymentSettings> {
  const encrypted = encryptPracticePaymentSettingsRecord(settings as any);
  const existing = await getPracticePaymentSettings(settings.practiceId);

  if (existing) {
    const [updated] = await db.update(practicePaymentSettings)
      .set({ ...encrypted, updatedAt: new Date() })
      .where(eq(practicePaymentSettings.practiceId, settings.practiceId))
      .returning();
    return decryptPracticePaymentSettingsRecord(updated) as PracticePaymentSettings;
  }

  const [created] = await db.insert(practicePaymentSettings).values(encrypted as any).returning();
  return decryptPracticePaymentSettingsRecord(created) as PracticePaymentSettings;
}

// ==================== PAYMENT ANALYTICS ====================

export async function getPaymentStats(practiceId: number, startDate?: Date, endDate?: Date): Promise<{
  totalCollected: number;
  totalPending: number;
  totalRefunded: number;
  transactionCount: number;
  averagePayment: number;
  byCategory: { category: string; amount: number; count: number }[];
  byMethod: { type: string; amount: number; count: number }[];
}> {
  const conditions: any[] = [eq(paymentTransactions.practiceId, practiceId)];
  if (startDate) {
    conditions.push(gte(paymentTransactions.createdAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(paymentTransactions.createdAt, endDate));
  }

  const transactions = await db.select()
    .from(paymentTransactions)
    .where(and(...conditions));

  const completed = transactions.filter((t: PaymentTransaction) => t.status === 'completed' && t.type === 'payment');
  const pending = transactions.filter((t: PaymentTransaction) => t.status === 'pending');
  const refunded = transactions.filter((t: PaymentTransaction) => t.type === 'refund' && t.status === 'completed');

  const totalCollected = completed.reduce((sum: number, t: PaymentTransaction) => sum + parseFloat(t.amount || '0'), 0);
  const totalPending = pending.reduce((sum: number, t: PaymentTransaction) => sum + parseFloat(t.amount || '0'), 0);
  const totalRefunded = refunded.reduce((sum: number, t: PaymentTransaction) => sum + parseFloat(t.amount || '0'), 0);
  const transactionCount = completed.length;
  const averagePayment = transactionCount > 0 ? totalCollected / transactionCount : 0;

  const categoryTotals: Record<string, { amount: number; count: number }> = {};
  for (const t of completed) {
    const cat = t.category || 'other';
    if (!categoryTotals[cat]) categoryTotals[cat] = { amount: 0, count: 0 };
    categoryTotals[cat].amount += parseFloat(t.amount || '0');
    categoryTotals[cat].count++;
  }
  const byCategory = Object.entries(categoryTotals)
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.amount - a.amount);

  const methodTotals: Record<string, { amount: number; count: number }> = {};
  for (const t of completed) {
    const method = t.processor || 'unknown';
    if (!methodTotals[method]) methodTotals[method] = { amount: 0, count: 0 };
    methodTotals[method].amount += parseFloat(t.amount || '0');
    methodTotals[method].count++;
  }
  const byMethod = Object.entries(methodTotals)
    .map(([type, data]) => ({ type, ...data }))
    .sort((a, b) => b.amount - a.amount);

  return { totalCollected, totalPending, totalRefunded, transactionCount, averagePayment, byCategory, byMethod };
}

export async function getPatientBalance(patientId: number): Promise<{
  totalCharges: number;
  totalPayments: number;
  totalAdjustments: number;
  currentBalance: number;
}> {
  const transactions = await getPatientPaymentHistory(patientId);

  let totalCharges = 0;
  let totalPayments = 0;
  let totalAdjustments = 0;

  for (const t of transactions) {
    if (t.status !== 'completed') continue;
    const amount = parseFloat(t.amount || '0');

    if (t.type === 'payment') {
      totalPayments += amount;
    } else if (t.type === 'refund') {
      totalPayments -= amount;
    } else if (t.type === 'adjustment' || t.type === 'write_off') {
      totalAdjustments += amount;
    }
  }

  const statements = await getPatientStatements(patientId);
  for (const s of statements) {
    totalCharges += parseFloat(s.totalCharges || '0');
  }

  const currentBalance = totalCharges - totalPayments - totalAdjustments;

  return { totalCharges, totalPayments, totalAdjustments, currentBalance };
}

export async function getPaymentPlanWithInstallments(planId: number): Promise<{
  plan: PaymentPlan;
  installments: PaymentPlanInstallment[];
} | null> {
  const plan = await getPaymentPlan(planId);
  if (!plan) return null;

  const installments = await getPaymentPlanInstallments(planId);
  return { plan, installments };
}

// ==================== PATIENT PAYMENTS (legacy table) ====================

export async function createPatientPayment(payment: InsertPatientPayment): Promise<PatientPayment> {
  const [result] = await db.insert(patientPayments).values(payment).returning();
  return result;
}

export async function getPatientPayments(patientId: number): Promise<PatientPayment[]> {
  return db
    .select()
    .from(patientPayments)
    .where(eq(patientPayments.patientId, patientId))
    .orderBy(desc(patientPayments.paymentDate));
}

export async function getPatientPaymentsByPractice(practiceId: number): Promise<PatientPayment[]> {
  return db
    .select()
    .from(patientPayments)
    .where(eq(patientPayments.practiceId, practiceId))
    .orderBy(desc(patientPayments.paymentDate));
}

// ==================== WEBHOOK EVENTS ====================

export async function getWebhookEvent(eventId: string): Promise<WebhookEvent | undefined> {
  const [event] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.eventId, eventId))
    .limit(1);
  return event;
}

export async function createWebhookEvent(eventId: string, eventType: string, status: string, metadata?: any): Promise<WebhookEvent> {
  const [event] = await db
    .insert(webhookEvents)
    .values({ eventId, eventType, status, metadata: metadata ?? null })
    .returning();
  return event;
}

export async function updateWebhookEventStatus(eventId: string, status: string): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status })
    .where(eq(webhookEvents.eventId, eventId));
}

export async function updatePatientPortalPaymentStatus(patientId: number, hasPaymentMethod: boolean): Promise<void> {
  const { patientPortalAccess } = await import("@shared/schema");
  await db
    .update(patientPortalAccess)
    .set({ hasPaymentMethod, updatedAt: new Date() })
    .where(eq(patientPortalAccess.patientId, patientId));
}

import {
  users,
  invites,
  type User,
  type UpsertUser,
  type Invite,
  type InsertInvite,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import {
  encryptUserRecord,
  decryptUserRecord,
} from "../services/phiEncryptionService";

// ==================== USER OPERATIONS ====================

export async function getUser(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user ? decryptUserRecord(user) as User : undefined;
}

export async function upsertUser(userData: UpsertUser): Promise<User> {
  const encrypted = encryptUserRecord(userData as any);
  const [user] = await db
    .insert(users)
    .values(encrypted as any)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        ...encrypted,
        updatedAt: new Date(),
      },
    })
    .returning();
  return decryptUserRecord(user) as User;
}

export async function getAllUsers(): Promise<User[]> {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  return rows.map((r: any) => decryptUserRecord(r) as User);
}

export async function updateUserRole(id: string, role: string): Promise<User | undefined> {
  const [user] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return user ? decryptUserRecord(user) as User : undefined;
}

// ==================== PASSWORD AUTH ====================

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user ? decryptUserRecord(user) as User : undefined;
}

export async function createUserWithPassword(userData: {
  email: string;
  passwordHash: string;
  firstName?: string;
  lastName?: string;
  practiceId?: number;
  role?: string;
}): Promise<User> {
  const { nanoid } = await import('nanoid');
  const userId = nanoid();
  const record = {
    id: userId,
    email: userData.email,
    passwordHash: userData.passwordHash,
    firstName: userData.firstName,
    lastName: userData.lastName,
    practiceId: userData.practiceId,
    role: userData.role || 'therapist',
    emailVerified: false,
    failedLoginAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const encrypted = encryptUserRecord(record as any);
  const [user] = await db
    .insert(users)
    .values(encrypted as any)
    .returning();
  return decryptUserRecord(user) as User;
}

export async function updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function setPasswordResetToken(userId: string, token: string, expires: Date): Promise<void> {
  await db
    .update(users)
    .set({
      passwordResetToken: token,
      passwordResetExpires: expires,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function clearPasswordResetToken(userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      passwordResetToken: null,
      passwordResetExpires: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function getUserByPasswordResetToken(token: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.passwordResetToken, token));
  return user ? decryptUserRecord(user) as User : undefined;
}

export async function incrementFailedLoginAttempts(userId: string): Promise<number> {
  const [user] = await db
    .update(users)
    .set({
      failedLoginAttempts: sql`COALESCE(${users.failedLoginAttempts}, 0) + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({ failedLoginAttempts: users.failedLoginAttempts });
  return user?.failedLoginAttempts || 1;
}

export async function resetFailedLoginAttempts(userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      failedLoginAttempts: 0,
      lockoutUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function setLockout(userId: string, lockoutUntil: Date): Promise<void> {
  await db
    .update(users)
    .set({
      lockoutUntil,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function setEmailVerificationToken(userId: string, token: string, expires: Date): Promise<void> {
  await db
    .update(users)
    .set({
      emailVerificationToken: token,
      emailVerificationExpires: expires,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function getUserByEmailVerificationToken(token: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.emailVerificationToken, token));
  return user ? decryptUserRecord(user) as User : undefined;
}

export async function verifyEmail(userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function updateLastLoginAt(userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function clearAllUserSessions(userId: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM sessions
    WHERE sess::text LIKE ${`%"sub":"${userId}"%`}
  `);
}

export async function getTherapistsByPractice(practiceId: number): Promise<User[]> {
  const rows = await db
    .select()
    .from(users)
    .where(and(
      eq(users.practiceId, practiceId),
      eq(users.role, 'therapist')
    ));
  return rows.map((r: any) => decryptUserRecord(r) as User);
}

export async function updateUser(id: string, updates: Partial<{
  firstName: string;
  lastName: string;
  email: string;
  credentials: string;
  licenseNumber: string;
  npiNumber: string;
  digitalSignature: string;
  signatureUploadedAt: Date;
  practiceId: number;
  role: string;
  ssoProvider: string;
  ssoExternalId: string;
}>): Promise<User | undefined> {
  const encrypted = encryptUserRecord(updates as any);
  const [user] = await db
    .update(users)
    .set({ ...encrypted, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return user ? decryptUserRecord(user) as User : undefined;
}

// ==================== MFA ====================

export async function updateUserMfa(userId: string, data: { mfaEnabled?: boolean; mfaSecret?: any; mfaBackupCodes?: any }): Promise<User | undefined> {
  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return updated ? decryptUserRecord(updated) as User : undefined;
}

// ==================== SUPERVISION ====================

export async function getSupervisees(supervisorId: string): Promise<User[]> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.supervisorId, supervisorId))
    .orderBy(users.lastName, users.firstName);
  return rows.map((r: any) => decryptUserRecord(r) as User);
}

export async function updateUserSupervision(userId: string, supervisorId: string | null, requiresCosign: boolean): Promise<User | undefined> {
  const [updated] = await db
    .update(users)
    .set({
      supervisorId: supervisorId,
      requiresCosign: requiresCosign,
      updatedAt: new Date()
    })
    .where(eq(users.id, userId))
    .returning();
  return updated ? decryptUserRecord(updated) as User : undefined;
}

export async function getAdminsByPractice(practiceId: number): Promise<{ id: string; email: string }[]> {
  const admins = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.practiceId, practiceId)));
  return admins.filter((a: any): a is { id: string; email: string } => !!a.email);
}

export async function getUserBySsoExternalId(provider: string, externalId: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.ssoProvider, provider),
        eq(users.ssoExternalId, externalId),
      )
    );
  return user ? decryptUserRecord(user) as User : undefined;
}

// ==================== INVITES ====================

export async function createInvite(invite: InsertInvite): Promise<Invite> {
  const [created] = await db.insert(invites).values(invite).returning();
  return created;
}

export async function getInvitesByPractice(practiceId: number): Promise<Invite[]> {
  return await db
    .select()
    .from(invites)
    .where(eq(invites.practiceId, practiceId))
    .orderBy(desc(invites.createdAt));
}

export async function getInviteByToken(token: string): Promise<Invite | undefined> {
  const [invite] = await db
    .select()
    .from(invites)
    .where(eq(invites.token, token));
  return invite;
}

export async function getInviteByEmail(email: string): Promise<Invite | undefined> {
  const [invite] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.email, email), eq(invites.status, "pending")));
  return invite;
}

export async function updateInviteStatus(id: number, status: string, acceptedAt?: Date): Promise<Invite | undefined> {
  const [updated] = await db
    .update(invites)
    .set({ status, acceptedAt })
    .where(eq(invites.id, id))
    .returning();
  return updated;
}

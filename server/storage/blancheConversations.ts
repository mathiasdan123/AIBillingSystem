import { blancheConversations } from "@shared/schema";
import { db } from "../db";
import { and, eq, sql } from "drizzle-orm";
import {
  encryptBlancheMessages,
  decryptBlancheMessages,
} from "../services/phiEncryptionService";

export interface BlancheMessageRecord {
  role: "user" | "assistant";
  content: string;
  hidden?: boolean;
  proposal?: unknown;
  toolCalls?: unknown;
  [key: string]: unknown;
}

/**
 * Load the saved chat history for (userId, practiceId), or [] if none yet.
 * Messages are decrypted from the JSONB blob.
 */
export async function getBlancheConversation(
  userId: string,
  practiceId: number,
): Promise<BlancheMessageRecord[]> {
  const [row] = await db
    .select()
    .from(blancheConversations)
    .where(
      and(
        eq(blancheConversations.userId, userId),
        eq(blancheConversations.practiceId, practiceId),
      ),
    );
  if (!row) return [];
  return decryptBlancheMessages(row.messages) as BlancheMessageRecord[];
}

/**
 * Replace the saved chat history for (userId, practiceId) with `messages`.
 * Upserts on the (user_id, practice_id) unique index.
 */
export async function saveBlancheConversation(
  userId: string,
  practiceId: number,
  messages: BlancheMessageRecord[],
): Promise<void> {
  const encrypted = encryptBlancheMessages(messages);
  await db
    .insert(blancheConversations)
    .values({
      userId,
      practiceId,
      messages: encrypted as any,
    })
    .onConflictDoUpdate({
      target: [blancheConversations.userId, blancheConversations.practiceId],
      set: {
        messages: encrypted as any,
        updatedAt: sql`NOW()`,
      },
    });
}

/**
 * Wipe the saved chat history for (userId, practiceId). Used by the "New
 * Conversation" button.
 */
export async function clearBlancheConversation(
  userId: string,
  practiceId: number,
): Promise<void> {
  await db
    .delete(blancheConversations)
    .where(
      and(
        eq(blancheConversations.userId, userId),
        eq(blancheConversations.practiceId, practiceId),
      ),
    );
}

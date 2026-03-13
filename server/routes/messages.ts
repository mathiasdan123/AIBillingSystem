/**
 * Secure Messaging Routes
 *
 * Handles:
 * - GET /api/messages/conversations - List conversations for therapist
 * - GET /api/messages/conversations/:id - Get conversation with messages
 * - POST /api/messages/conversations - Create a conversation
 * - POST /api/messages/conversations/:id/messages - Send a message
 * - PATCH /api/messages/conversations/:id/archive - Archive a conversation
 * - GET /api/messages/unread-count - Get unread count for therapist
 * - DELETE /api/messages/:id - Delete (soft) a message
 * - GET /api/public/messages/:token/conversations - Patient get conversations
 * - GET /api/public/messages/:token/conversations/:id - Patient get conversation
 * - POST /api/public/messages/:token/conversations/:id/messages - Patient send message
 * - GET /api/public/messages/:token/unread-count - Patient unread count
 *
 * Mounted at /api so all paths include their full prefix.
 */

import { Router } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }

  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === 'admin') {
    return requestedPracticeId || userPracticeId || 1;
  }

  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }

  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

// ==================== AUTHENTICATED MESSAGING ROUTES ====================

// Get all conversations for a therapist
router.get('/messages/conversations', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const therapistId = req.user?.claims?.sub;
    const status = req.query.status as string | undefined;
    const patientId = req.query.patientId ? parseInt(req.query.patientId as string) : undefined;

    const conversations = await storage.getConversations(practiceId, {
      therapistId,
      patientId,
      status: status || 'active',
    });

    res.json(conversations);
  } catch (error) {
    logger.error('Error fetching conversations', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
});

// Get a single conversation with messages
router.get('/messages/conversations/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = await storage.getConversationWithMessages(id);

    if (!data) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Mark as read by therapist
    await storage.markConversationReadByTherapist(id);

    res.json(data);
  } catch (error) {
    logger.error('Error fetching conversation', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch conversation' });
  }
});

// Create a new conversation
router.post('/messages/conversations', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const therapistId = req.user?.claims?.sub;
    const { patientId, subject, initialMessage } = req.body;

    if (!patientId) {
      return res.status(400).json({ message: 'Patient ID is required' });
    }

    // Get patient to verify they exist
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Check for existing active conversation with this patient
    const existingConversations = await storage.getConversations(practiceId, {
      patientId,
      status: 'active',
    });

    if (existingConversations.length > 0) {
      // Return existing conversation
      return res.json({
        conversation: existingConversations[0],
        isExisting: true,
      });
    }

    // Create new conversation
    const conversation = await storage.createConversation({
      practiceId,
      patientId,
      therapistId,
      subject: subject || `Conversation with ${patient.firstName} ${patient.lastName}`,
      status: 'active',
    });

    // If initial message provided, create it
    if (initialMessage) {
      const user = await storage.getUser(therapistId);
      await storage.createMessage({
        conversationId: conversation.id,
        senderId: therapistId,
        senderType: 'therapist',
        senderName: user ? `${user.firstName} ${user.lastName}` : 'Therapist',
        content: initialMessage,
        containsPhi: true,
      });
    }

    // Create audit log
    await storage.createAuditLog({
      userId: therapistId,
      eventType: 'write',
      eventCategory: 'messaging',
      resourceType: 'conversation',
      resourceId: conversation.id.toString(),
      practiceId,
      ipAddress: req.ip || '0.0.0.0',
      details: { patientId, subject },
    });

    res.status(201).json({ conversation, isExisting: false });
  } catch (error) {
    logger.error('Error creating conversation', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create conversation' });
  }
});

// Send a message in a conversation
router.post('/messages/conversations/:id/messages', isAuthenticated, async (req: any, res) => {
  try {
    const conversationId = parseInt(req.params.id);
    const therapistId = req.user?.claims?.sub;
    const { content, attachments } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const conversation = await storage.getConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const user = await storage.getUser(therapistId);

    const message = await storage.createMessage({
      conversationId,
      senderId: therapistId,
      senderType: 'therapist',
      senderName: user ? `${user.firstName} ${user.lastName}` : 'Therapist',
      content: content.trim(),
      attachments: attachments || [],
      containsPhi: true,
    });

    // Create notification for patient (email/SMS would be sent by a background job)
    await storage.createMessageNotification({
      messageId: message.id,
      recipientType: 'patient',
      recipientId: conversation.patientId?.toString(),
      notificationType: 'email',
      status: 'pending',
    });

    res.status(201).json(message);
  } catch (error) {
    logger.error('Error sending message', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to send message' });
  }
});

// Archive a conversation
router.patch('/messages/conversations/:id/archive', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const conversation = await storage.archiveConversation(id);
    res.json(conversation);
  } catch (error) {
    logger.error('Error archiving conversation', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to archive conversation' });
  }
});

// Get unread count for therapist
router.get('/messages/unread-count', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const therapistId = req.user?.claims?.sub;
    const count = await storage.getUnreadCount(practiceId, therapistId);
    res.json({ count });
  } catch (error) {
    logger.error('Error fetching unread count', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch unread count' });
  }
});

// Delete a message (soft delete)
router.delete('/messages/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user?.claims?.sub;

    const message = await storage.getMessage(id);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Only the sender can delete their own message
    if (message.senderId !== userId) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }

    const deleted = await storage.softDeleteMessage(id, userId);
    res.json({ message: 'Message deleted', deleted });
  } catch (error) {
    logger.error('Error deleting message', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete message' });
  }
});

// ==================== PUBLIC PATIENT MESSAGING ====================
// These endpoints allow patients to access their messages via a secure token

// Get patient's conversations via token
router.get('/public/messages/:token/conversations', async (req, res) => {
  try {
    const { token } = req.params;
    const conversation = await storage.getConversationByToken(token);

    if (!conversation) {
      return res.status(404).json({ message: 'Invalid or expired access link' });
    }

    // Get all conversations for this patient
    const conversations = await storage.getPatientConversations(conversation.patientId);

    res.json(conversations);
  } catch (error) {
    logger.error('Error fetching patient conversations', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
});

// Get a specific conversation with messages (patient view)
router.get('/public/messages/:token/conversations/:id', async (req, res) => {
  try {
    const { token, id } = req.params;
    const tokenConversation = await storage.getConversationByToken(token);

    if (!tokenConversation) {
      return res.status(404).json({ message: 'Invalid or expired access link' });
    }

    const conversationId = parseInt(id);
    const data = await storage.getConversationWithMessages(conversationId);

    if (!data || data.conversation.patientId !== tokenConversation.patientId) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Mark as read by patient
    await storage.markConversationReadByPatient(conversationId);

    res.json(data);
  } catch (error) {
    logger.error('Error fetching patient conversation', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch conversation' });
  }
});

// Patient sends a message
router.post('/public/messages/:token/conversations/:id/messages', async (req, res) => {
  try {
    const { token, id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const tokenConversation = await storage.getConversationByToken(token);
    if (!tokenConversation) {
      return res.status(404).json({ message: 'Invalid or expired access link' });
    }

    const conversationId = parseInt(id);
    const conversation = await storage.getConversation(conversationId);

    if (!conversation || conversation.patientId !== tokenConversation.patientId) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Get patient name
    const patient = await storage.getPatient(conversation.patientId);

    const message = await storage.createMessage({
      conversationId,
      senderId: null, // Patient doesn't have a user ID
      senderType: 'patient',
      senderName: patient ? `${patient.firstName} ${patient.lastName}` : 'Patient',
      content: content.trim(),
      attachments: [],
      containsPhi: true,
    });

    // Create notification for therapist
    if (conversation.therapistId) {
      await storage.createMessageNotification({
        messageId: message.id,
        recipientType: 'therapist',
        recipientId: conversation.therapistId,
        notificationType: 'email',
        status: 'pending',
      });
    }

    res.status(201).json(message);
  } catch (error) {
    logger.error('Error sending patient message', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to send message' });
  }
});

// Get patient's unread count
router.get('/public/messages/:token/unread-count', async (req, res) => {
  try {
    const { token } = req.params;
    const conversation = await storage.getConversationByToken(token);

    if (!conversation) {
      return res.status(404).json({ message: 'Invalid or expired access link' });
    }

    const count = await storage.getPatientUnreadCount(conversation.patientId);
    res.json({ count });
  } catch (error) {
    logger.error('Error fetching patient unread count', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch unread count' });
  }
});

export default router;

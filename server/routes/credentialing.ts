/**
 * Credentialing Routes
 *
 * Handles:
 * - GET    /api/credentialing             - List all credentials for the practice
 * - POST   /api/credentialing             - Add new credential record
 * - PATCH  /api/credentialing/:id         - Update status, dates, notes
 * - DELETE /api/credentialing/:id         - Remove credential
 * - GET    /api/credentialing/expiring    - Get credentials expiring in next 90 days
 */

import { Router, type Response } from 'express';
import { eq, and, lte, gte, or, sql } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import { db, dbReady } from '../db';
import { providerCredentials } from '@shared/schema';
import logger from '../services/logger';

export interface CredentialAtRiskEntry {
  credential: any;
  daysUntilExpiration: number | null;
  daysUntilReCredentialing: number | null;
  daysUntilAction: number; // min of the two (whichever is sooner)
  reason: 'expiring' | 're_credentialing' | 'both';
}

/**
 * Slice 1 credentialing alert — fetch provider credentials whose
 * expiration OR re-credentialing deadline falls within `daysAhead`.
 * Used by both the /at-risk endpoint below AND the daily cron task
 * that emails admins.
 */
export async function getAtRiskCredentials(
  practiceId: number,
  daysAhead: number = 60
): Promise<CredentialAtRiskEntry[]> {
  const today = new Date();
  const horizon = new Date();
  horizon.setDate(today.getDate() + daysAhead);
  const todayStr = today.toISOString().split('T')[0];
  const horizonStr = horizon.toISOString().split('T')[0];

  const rows = await db
    .select()
    .from(providerCredentials)
    .where(
      and(
        eq(providerCredentials.practiceId, practiceId),
        // Only flag active / in-progress ones — already expired / denied
        // are either handled or abandoned.
        or(
          eq(providerCredentials.enrollmentStatus, 'active'),
          eq(providerCredentials.enrollmentStatus, 'in_progress'),
          eq(providerCredentials.enrollmentStatus, 'pending')
        ),
        or(
          and(
            gte(providerCredentials.expirationDate, todayStr),
            lte(providerCredentials.expirationDate, horizonStr)
          ),
          and(
            gte(providerCredentials.reCredentialingDate, todayStr),
            lte(providerCredentials.reCredentialingDate, horizonStr)
          )
        )
      )
    );

  const entries: CredentialAtRiskEntry[] = rows.map((c: any) => {
    const expDays = c.expirationDate
      ? Math.ceil((new Date(c.expirationDate).getTime() - today.getTime()) / 86400000)
      : null;
    const recDays = c.reCredentialingDate
      ? Math.ceil((new Date(c.reCredentialingDate).getTime() - today.getTime()) / 86400000)
      : null;
    const candidates = [expDays, recDays].filter((d): d is number => typeof d === 'number' && d >= 0 && d <= daysAhead);
    const soonest = candidates.length ? Math.min(...candidates) : daysAhead;
    let reason: CredentialAtRiskEntry['reason'];
    if (expDays != null && recDays != null && expDays <= daysAhead && recDays <= daysAhead) {
      reason = 'both';
    } else if (expDays != null && expDays <= daysAhead) {
      reason = 'expiring';
    } else {
      reason = 're_credentialing';
    }
    return {
      credential: c,
      daysUntilExpiration: expDays,
      daysUntilReCredentialing: recDays,
      daysUntilAction: soonest,
      reason,
    };
  });

  entries.sort((a, b) => a.daysUntilAction - b.daysUntilAction);
  return entries;
}

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

// Safe error response helper
const safeErrorResponse = (res: Response, statusCode: number, publicMessage: string, error?: any) => {
  if (error) {
    logger.error(publicMessage, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  return res.status(statusCode).json({ message: publicMessage });
};

// GET /at-risk - Combined expiration + re-credentialing deadline check.
// Must come before /:id.
router.get('/at-risk', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const daysAhead = parseInt(req.query.daysAhead as string) || 60;
    const entries = await getAtRiskCredentials(practiceId, daysAhead);
    res.json(entries);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch at-risk credentials', error);
  }
});

/**
 * Build the provider descriptor for a draft request. Accepts either a
 * registered therapist (providerId → lookup) OR a freehand write-in
 * (providerName + optional details). Lets practices draft credentialing
 * materials for a brand-new hire before that person has been added to
 * the Therapists tab.
 */
async function resolveProviderForDraft(body: any): Promise<{
  firstName: string;
  lastName: string;
  credentials: string | null;
  npiNumber: string | null;
  licenseNumber: string | null;
  taxonomyCode: string | null;
} | null> {
  const { storage } = await import('../storage');
  // Path A — existing therapist by id.
  if (body?.providerId) {
    const p = await storage.getUser(body.providerId);
    if (!p) return null;
    return {
      firstName: p.firstName ?? '',
      lastName: p.lastName ?? '',
      credentials: (p as any).credentials ?? null,
      npiNumber: (p as any).npiNumber ?? null,
      licenseNumber: (p as any).licenseNumber ?? null,
      taxonomyCode: (p as any).taxonomyCode ?? null,
    };
  }
  // Path B — freehand write-in.
  if (body?.providerName && typeof body.providerName === 'string') {
    const [firstName = '', ...rest] = body.providerName.trim().split(/\s+/);
    const lastName = rest.join(' ');
    return {
      firstName,
      lastName,
      credentials: body.providerCredentials ?? null,
      npiNumber: body.providerNpi ?? null,
      licenseNumber: body.providerLicense ?? null,
      taxonomyCode: null,
    };
  }
  return null;
}

// POST /draft-packet — AI-drafted enrollment packet cover letter + checklist
router.post('/draft-packet', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const { payerName, notes } = req.body || {};
    if (!payerName) {
      return res.status(400).json({ message: 'payerName is required.' });
    }
    const provider = await resolveProviderForDraft(req.body);
    if (!provider) {
      return res.status(400).json({
        message: 'Either providerId (existing therapist) or providerName (freehand) is required.',
      });
    }
    if (!provider.firstName && !provider.lastName) {
      return res.status(400).json({ message: 'Provider name cannot be empty.' });
    }
    const { storage } = await import('../storage');
    const practice = await storage.getPractice(practiceId);
    if (!practice) return res.status(404).json({ message: 'Practice not found' });

    const { draftCredentialingPacketLetter } = await import('../services/credentialingAiService');
    const result = await draftCredentialingPacketLetter({
      practice: {
        name: practice.name,
        npi: (practice as any).npi ?? null,
        taxId: (practice as any).taxId ?? null,
        address: (practice as any).address ?? null,
        phone: (practice as any).phone ?? null,
        specialty: (practice as any).specialty ?? null,
        professionalLicense: (practice as any).professionalLicense ?? null,
        caqhProfileId: (practice as any).caqhProfileId ?? null,
        ownerName: (practice as any).ownerName ?? null,
        ownerTitle: (practice as any).ownerTitle ?? null,
      },
      provider,
      payer: { name: payerName, contact: null },
      notes: notes ?? null,
    });
    res.json(result);
  } catch (error: any) {
    const msg = error?.message ?? 'Failed to draft credentialing packet';
    const status = msg.includes('ANTHROPIC_API_KEY') ? 503 : 500;
    safeErrorResponse(res, status, msg, error);
  }
});

/**
 * POST /bulk-draft-packet — generate enrollment packet letters for
 * multiple providers against the same payer in one call. Used during
 * group onboarding (a practice hires 5 OTs; they all need credentialing
 * packets sent to Aetna).
 *
 * Body: { providers: Array<{ providerId? | providerName?+optional }>, payerName, notes? }
 * Returns: { results: Array<{ provider: {...}, success: boolean, result?, error? }> }
 *
 * Runs sequentially, not in parallel — Anthropic rate limits prefer it,
 * and Claude Sonnet's per-letter latency is short enough that 5-10
 * providers in series is fine (~30-60s end-to-end).
 */
router.post('/bulk-draft-packet', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const { providers, payerName, notes } = req.body || {};
    if (!Array.isArray(providers) || providers.length === 0) {
      return res.status(400).json({ message: 'providers array is required (1+ entries).' });
    }
    if (providers.length > 10) {
      return res.status(400).json({ message: 'Max 10 providers per bulk request.' });
    }
    if (!payerName) {
      return res.status(400).json({ message: 'payerName is required.' });
    }

    const { storage } = await import('../storage');
    const practice = await storage.getPractice(practiceId);
    if (!practice) return res.status(404).json({ message: 'Practice not found' });

    const { draftCredentialingPacketLetter } = await import('../services/credentialingAiService');
    const practiceBlock = {
      name: practice.name,
      npi: (practice as any).npi ?? null,
      taxId: (practice as any).taxId ?? null,
      address: (practice as any).address ?? null,
      phone: (practice as any).phone ?? null,
      specialty: (practice as any).specialty ?? null,
      professionalLicense: (practice as any).professionalLicense ?? null,
      caqhProfileId: (practice as any).caqhProfileId ?? null,
      ownerName: (practice as any).ownerName ?? null,
      ownerTitle: (practice as any).ownerTitle ?? null,
    };

    const results: any[] = [];
    for (const p of providers) {
      const provider = await resolveProviderForDraft(p);
      const providerLabel = provider
        ? `${provider.firstName} ${provider.lastName}`.trim() || 'Unknown provider'
        : 'Unknown provider';
      if (!provider || (!provider.firstName && !provider.lastName)) {
        results.push({
          provider: { label: providerLabel, ...(p ?? {}) },
          success: false,
          error: 'Provider could not be resolved (missing id or name).',
        });
        continue;
      }
      try {
        const result = await draftCredentialingPacketLetter({
          practice: practiceBlock,
          provider,
          payer: { name: payerName, contact: null },
          notes: notes ?? null,
        });
        results.push({
          provider: { label: providerLabel, ...(p ?? {}) },
          success: true,
          result,
        });
      } catch (err: any) {
        results.push({
          provider: { label: providerLabel, ...(p ?? {}) },
          success: false,
          error: err?.message ?? 'Generation failed',
        });
      }
    }

    res.json({ results });
  } catch (error: any) {
    const msg = error?.message ?? 'Failed to bulk-draft credentialing packets';
    const status = msg.includes('ANTHROPIC_API_KEY') ? 503 : 500;
    safeErrorResponse(res, status, msg, error);
  }
});

// POST /draft-application — AI-drafted credentialing application cover + Q&A
router.post('/draft-application', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const { payerName, notes } = req.body || {};
    if (!payerName) {
      return res.status(400).json({ message: 'payerName is required.' });
    }
    const provider = await resolveProviderForDraft(req.body);
    if (!provider) {
      return res.status(400).json({
        message: 'Either providerId (existing therapist) or providerName (freehand) is required.',
      });
    }
    if (!provider.firstName && !provider.lastName) {
      return res.status(400).json({ message: 'Provider name cannot be empty.' });
    }
    const { storage } = await import('../storage');
    const practice = await storage.getPractice(practiceId);
    if (!practice) return res.status(404).json({ message: 'Practice not found' });

    const { draftCredentialingApplication } = await import('../services/credentialingAiService');
    const result = await draftCredentialingApplication({
      practice: {
        name: practice.name,
        npi: (practice as any).npi ?? null,
        taxId: (practice as any).taxId ?? null,
        address: (practice as any).address ?? null,
        phone: (practice as any).phone ?? null,
        specialty: (practice as any).specialty ?? null,
        professionalLicense: (practice as any).professionalLicense ?? null,
        caqhProfileId: (practice as any).caqhProfileId ?? null,
        ownerName: (practice as any).ownerName ?? null,
        ownerTitle: (practice as any).ownerTitle ?? null,
      },
      provider,
      payer: { name: payerName, contact: null },
      notes: notes ?? null,
    });
    res.json(result);
  } catch (error: any) {
    const msg = error?.message ?? 'Failed to draft credentialing application';
    const status = msg.includes('ANTHROPIC_API_KEY') ? 503 : 500;
    safeErrorResponse(res, status, msg, error);
  }
});

// GET /expiring - Get credentials expiring in next 90 days
// NOTE: This route must be defined BEFORE /:id to avoid matching "expiring" as an id
router.get('/expiring', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const daysAhead = parseInt(req.query.days as string) || 90;

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const results = await db
      .select()
      .from(providerCredentials)
      .where(
        and(
          eq(providerCredentials.practiceId, practiceId),
          lte(providerCredentials.expirationDate, futureDate.toISOString().split('T')[0]),
          gte(providerCredentials.expirationDate, now.toISOString().split('T')[0])
        )
      )
      .orderBy(providerCredentials.expirationDate);

    res.json(results);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch expiring credentials', error);
  }
});

// GET / - List all credentials for the practice
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const status = req.query.status as string | undefined;

    let query = db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.practiceId, practiceId));

    if (status && status !== 'all') {
      query = db
        .select()
        .from(providerCredentials)
        .where(
          and(
            eq(providerCredentials.practiceId, practiceId),
            eq(providerCredentials.enrollmentStatus, status)
          )
        );
    }

    const results = await query.orderBy(providerCredentials.providerName);
    res.json(results);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch credentials', error);
  }
});

// POST / - Add new credential record
router.post('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);

    const {
      providerId,
      providerName,
      providerNpi,
      payerName,
      payerId,
      caqhProfileId,
      enrollmentStatus,
      enrollmentDate,
      expirationDate,
      reCredentialingDate,
      applicationSubmittedAt,
      notes,
      documents,
    } = req.body;

    if (!providerId || !providerName || !payerName) {
      return res.status(400).json({ message: 'providerId, providerName, and payerName are required' });
    }

    const [result] = await db
      .insert(providerCredentials)
      .values({
        practiceId,
        providerId,
        providerName,
        providerNpi: providerNpi || null,
        payerName,
        payerId: payerId || null,
        caqhProfileId: caqhProfileId || null,
        enrollmentStatus: enrollmentStatus || 'pending',
        enrollmentDate: enrollmentDate || null,
        expirationDate: expirationDate || null,
        reCredentialingDate: reCredentialingDate || null,
        applicationSubmittedAt: applicationSubmittedAt || null,
        notes: notes || null,
        documents: documents || null,
      })
      .returning();

    res.status(201).json(result);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to create credential record', error);
  }
});

// PATCH /:id - Update status, dates, notes
router.patch('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid credential ID' });
    }

    // Only allow updating fields that exist
    const allowedFields = [
      'providerName', 'providerNpi', 'payerName', 'payerId', 'caqhProfileId',
      'enrollmentStatus', 'enrollmentDate', 'expirationDate', 'reCredentialingDate',
      'applicationSubmittedAt', 'notes', 'documents', 'providerId',
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    updates.updatedAt = new Date();

    const [result] = await db
      .update(providerCredentials)
      .set(updates)
      .where(
        and(
          eq(providerCredentials.id, id),
          eq(providerCredentials.practiceId, practiceId)
        )
      )
      .returning();

    if (!result) {
      return res.status(404).json({ message: 'Credential record not found' });
    }

    res.json(result);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to update credential record', error);
  }
});

// DELETE /:id - Remove credential
router.delete('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid credential ID' });
    }

    const [deleted] = await db
      .delete(providerCredentials)
      .where(
        and(
          eq(providerCredentials.id, id),
          eq(providerCredentials.practiceId, practiceId)
        )
      )
      .returning();

    if (!deleted) {
      return res.status(404).json({ message: 'Credential record not found' });
    }

    res.json({ message: 'Credential record deleted' });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to delete credential record', error);
  }
});

/**
 * POST /render-letter-pdf — render a credentialing draft (packet OR
 * application) as a typeset PDF. Accepts the result of /draft-packet or
 * /draft-application after the biller has reviewed/edited it client-side.
 * Body: { mode: 'packet' | 'application', letter, payerName,
 *         documentChecklist?, prefilledAnswers? }
 */
router.post('/render-letter-pdf', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const { mode, letter, payerName, documentChecklist, prefilledAnswers, subject } = req.body || {};
    if (!letter || typeof letter !== 'string' || letter.length < 50) {
      return res.status(400).json({ message: 'letter is required.' });
    }
    if (mode !== 'packet' && mode !== 'application') {
      return res.status(400).json({ message: 'mode must be "packet" or "application".' });
    }
    const { storage } = await import('../storage');
    const practice = await storage.getPractice(practiceId);
    if (!practice) return res.status(404).json({ message: 'Practice not found' });

    const sections: any[] = [];
    if (mode === 'packet' && Array.isArray(documentChecklist) && documentChecklist.length > 0) {
      sections.push({
        type: 'checklist',
        title: 'Document Checklist',
        items: documentChecklist.map((d: any) => ({
          item: String(d.item ?? ''),
          description: String(d.description ?? ''),
          alreadyOnFile: Boolean(d.alreadyOnFile),
        })),
      });
    }
    if (mode === 'application' && Array.isArray(prefilledAnswers) && prefilledAnswers.length > 0) {
      sections.push({
        type: 'qa',
        title: 'Application Answers (paste into payer portal)',
        entries: prefilledAnswers.map((qa: any) => ({
          question: String(qa.question ?? ''),
          answer: String(qa.answer ?? ''),
        })),
      });
    }

    const { renderLetterPdf } = await import('../services/letterPdfRenderer');
    const buffer = await renderLetterPdf({
      practice: {
        name: practice.name,
        address: (practice as any).address ?? null,
        phone: (practice as any).phone ?? null,
        email: (practice as any).email ?? null,
        npi: (practice as any).npi ?? null,
      },
      recipient: payerName
        ? { line1: 'Provider Credentialing Department', line2: payerName }
        : undefined,
      subject:
        subject ||
        (mode === 'packet'
          ? 'Credentialing Enrollment Packet'
          : 'Provider Credentialing Application'),
      body: letter,
      sections,
    });

    const filename = `credentialing-${mode}-${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error: any) {
    safeErrorResponse(res, 500, error?.message ?? 'Failed to render PDF', error);
  }
});

export default router;

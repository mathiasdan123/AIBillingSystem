/**
 * Locations Routes
 *
 * Handles multi-location workspace management:
 * - /api/locations - CRUD for practice locations
 * - /api/locations/:id/staff - Staff assignment to locations
 * - /api/locations/:id/stats - Location statistics
 */

import { Router, type Response, type NextFunction } from 'express';
import { isAuthenticated } from '../replitAuth';
import { db } from '../db';
import {
  practiceLocations,
  userLocations,
  users,
  patients,
  treatmentSessions,
  claims,
  payments,
  type PracticeLocation,
  type InsertPracticeLocation,
} from '@shared/schema';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import logger from '../services/logger';

const router = Router();

// Helper to get practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === 'admin' && requestedPracticeId) {
    return requestedPracticeId;
  }
  return userPracticeId || 1;
};

// Middleware: admin role required
const isAdmin = async (req: any, res: Response, next: NextFunction) => {
  const role = req.userRole;
  if (role === 'admin') {
    return next();
  }
  return res.status(403).json({ message: 'Admin access required' });
};

// Safe error response
const safeErrorResponse = (res: Response, statusCode: number, message: string, error?: any) => {
  if (error) {
    logger.error(message, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  return res.status(statusCode).json({ message });
};

// ==================== LOCATIONS CRUD ====================

// GET / - List all locations for the practice
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const includeInactive = req.query.includeInactive === 'true';

    let conditions = [eq(practiceLocations.practiceId, practiceId)];
    if (!includeInactive) {
      conditions.push(eq(practiceLocations.isActive, true));
    }

    const locations = await db
      .select()
      .from(practiceLocations)
      .where(and(...conditions))
      .orderBy(desc(practiceLocations.isMainLocation), practiceLocations.name);

    // Get staff counts for each location
    const locationsWithCounts = await Promise.all(
      locations.map(async (location: PracticeLocation) => {
        const staffCountResult = await db
          .select({ count: count() })
          .from(userLocations)
          .where(eq(userLocations.locationId, location.id));

        return {
          ...location,
          staffCount: staffCountResult[0]?.count || 0,
        };
      })
    );

    res.json(locationsWithCounts);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch locations', error);
  }
});

// POST / - Create a new location (admin only)
router.post('/', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { name, address, city, state, zipCode, phone, fax, isMainLocation, operatingHours } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Location name is required' });
    }

    // If setting as main location, unset any existing main location
    if (isMainLocation) {
      await db
        .update(practiceLocations)
        .set({ isMainLocation: false, updatedAt: new Date() })
        .where(and(
          eq(practiceLocations.practiceId, practiceId),
          eq(practiceLocations.isMainLocation, true)
        ));
    }

    const [newLocation] = await db
      .insert(practiceLocations)
      .values({
        practiceId,
        name: name.trim(),
        address: address || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        phone: phone || null,
        fax: fax || null,
        isMainLocation: isMainLocation || false,
        isActive: true,
        operatingHours: operatingHours || null,
      })
      .returning();

    logger.info('Location created', { locationId: newLocation.id, practiceId });
    res.status(201).json(newLocation);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to create location', error);
  }
});

// PUT /:id - Update location details
router.put('/:id', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const locationId = parseInt(req.params.id);

    if (isNaN(locationId)) {
      return res.status(400).json({ message: 'Invalid location ID' });
    }

    // Verify location belongs to practice
    const existing = await db
      .select()
      .from(practiceLocations)
      .where(and(
        eq(practiceLocations.id, locationId),
        eq(practiceLocations.practiceId, practiceId)
      ));

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const { name, address, city, state, zipCode, phone, fax, isMainLocation, operatingHours } = req.body;

    // If setting as main location, unset any existing main location
    if (isMainLocation && !existing[0].isMainLocation) {
      await db
        .update(practiceLocations)
        .set({ isMainLocation: false, updatedAt: new Date() })
        .where(and(
          eq(practiceLocations.practiceId, practiceId),
          eq(practiceLocations.isMainLocation, true)
        ));
    }

    const [updated] = await db
      .update(practiceLocations)
      .set({
        name: name?.trim() || existing[0].name,
        address: address !== undefined ? address : existing[0].address,
        city: city !== undefined ? city : existing[0].city,
        state: state !== undefined ? state : existing[0].state,
        zipCode: zipCode !== undefined ? zipCode : existing[0].zipCode,
        phone: phone !== undefined ? phone : existing[0].phone,
        fax: fax !== undefined ? fax : existing[0].fax,
        isMainLocation: isMainLocation !== undefined ? isMainLocation : existing[0].isMainLocation,
        operatingHours: operatingHours !== undefined ? operatingHours : existing[0].operatingHours,
        updatedAt: new Date(),
      })
      .where(eq(practiceLocations.id, locationId))
      .returning();

    logger.info('Location updated', { locationId, practiceId });
    res.json(updated);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to update location', error);
  }
});

// DELETE /:id - Soft-delete (set isActive=false)
router.delete('/:id', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const locationId = parseInt(req.params.id);

    if (isNaN(locationId)) {
      return res.status(400).json({ message: 'Invalid location ID' });
    }

    // Verify location belongs to practice
    const existing = await db
      .select()
      .from(practiceLocations)
      .where(and(
        eq(practiceLocations.id, locationId),
        eq(practiceLocations.practiceId, practiceId)
      ));

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const [updated] = await db
      .update(practiceLocations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(practiceLocations.id, locationId))
      .returning();

    logger.info('Location deactivated', { locationId, practiceId });
    res.json(updated);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to deactivate location', error);
  }
});

// ==================== STAFF MANAGEMENT ====================

// GET /:id/staff - List staff assigned to a location
router.get('/:id/staff', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const locationId = parseInt(req.params.id);

    if (isNaN(locationId)) {
      return res.status(400).json({ message: 'Invalid location ID' });
    }

    // Verify location belongs to practice
    const existing = await db
      .select()
      .from(practiceLocations)
      .where(and(
        eq(practiceLocations.id, locationId),
        eq(practiceLocations.practiceId, practiceId)
      ));

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const staff = await db
      .select({
        id: userLocations.id,
        userId: userLocations.userId,
        locationId: userLocations.locationId,
        isPrimary: userLocations.isPrimary,
        createdAt: userLocations.createdAt,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
        profileImageUrl: users.profileImageUrl,
      })
      .from(userLocations)
      .innerJoin(users, eq(userLocations.userId, users.id))
      .where(eq(userLocations.locationId, locationId));

    res.json(staff);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch location staff', error);
  }
});

// POST /:id/staff - Assign a user to a location
router.post('/:id/staff', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const locationId = parseInt(req.params.id);
    const { userId, isPrimary } = req.body;

    if (isNaN(locationId)) {
      return res.status(400).json({ message: 'Invalid location ID' });
    }

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Verify location belongs to practice
    const existing = await db
      .select()
      .from(practiceLocations)
      .where(and(
        eq(practiceLocations.id, locationId),
        eq(practiceLocations.practiceId, practiceId)
      ));

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    // Check if user is already assigned to this location
    const existingAssignment = await db
      .select()
      .from(userLocations)
      .where(and(
        eq(userLocations.userId, userId),
        eq(userLocations.locationId, locationId)
      ));

    if (existingAssignment.length > 0) {
      return res.status(409).json({ message: 'User is already assigned to this location' });
    }

    // If setting as primary, unset any existing primary for this user
    if (isPrimary) {
      await db
        .update(userLocations)
        .set({ isPrimary: false })
        .where(eq(userLocations.userId, userId));
    }

    const [assignment] = await db
      .insert(userLocations)
      .values({
        userId,
        locationId,
        isPrimary: isPrimary || false,
      })
      .returning();

    logger.info('Staff assigned to location', { userId, locationId, practiceId });
    res.status(201).json(assignment);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to assign staff to location', error);
  }
});

// DELETE /:id/staff/:userId - Remove user from location
router.delete('/:id/staff/:userId', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const locationId = parseInt(req.params.id);
    const userId = req.params.userId;

    if (isNaN(locationId)) {
      return res.status(400).json({ message: 'Invalid location ID' });
    }

    // Verify location belongs to practice
    const existing = await db
      .select()
      .from(practiceLocations)
      .where(and(
        eq(practiceLocations.id, locationId),
        eq(practiceLocations.practiceId, practiceId)
      ));

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const deleted = await db
      .delete(userLocations)
      .where(and(
        eq(userLocations.userId, userId),
        eq(userLocations.locationId, locationId)
      ))
      .returning();

    if (deleted.length === 0) {
      return res.status(404).json({ message: 'Staff assignment not found' });
    }

    logger.info('Staff removed from location', { userId, locationId, practiceId });
    res.json({ message: 'Staff removed from location' });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to remove staff from location', error);
  }
});

// ==================== LOCATION STATS ====================

// GET /:id/stats - Basic stats for a location
router.get('/:id/stats', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const locationId = parseInt(req.params.id);

    if (isNaN(locationId)) {
      return res.status(400).json({ message: 'Invalid location ID' });
    }

    // Verify location belongs to practice
    const existing = await db
      .select()
      .from(practiceLocations)
      .where(and(
        eq(practiceLocations.id, locationId),
        eq(practiceLocations.practiceId, practiceId)
      ));

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    // Get staff assigned to this location
    const staffAtLocation = await db
      .select({ userId: userLocations.userId })
      .from(userLocations)
      .where(eq(userLocations.locationId, locationId));

    const staffIds = staffAtLocation.map((s: { userId: string }) => s.userId);

    if (staffIds.length === 0) {
      return res.json({
        staffCount: 0,
        patientCount: 0,
        appointmentCount: 0,
        revenue: 0,
      });
    }

    // Count unique patients seen by staff at this location
    const patientCountResult = await db
      .select({ count: sql<number>`count(distinct ${treatmentSessions.patientId})` })
      .from(treatmentSessions)
      .where(and(
        eq(treatmentSessions.practiceId, practiceId),
        sql`${treatmentSessions.therapistId} = ANY(${sql`ARRAY[${sql.join(staffIds.map((id: string) => sql`${id}`), sql`, `)}]`})`
      ));

    // Count appointments/sessions
    const appointmentCountResult = await db
      .select({ count: count() })
      .from(treatmentSessions)
      .where(and(
        eq(treatmentSessions.practiceId, practiceId),
        sql`${treatmentSessions.therapistId} = ANY(${sql`ARRAY[${sql.join(staffIds.map((id: string) => sql`${id}`), sql`, `)}]`})`
      ));

    // Sum revenue from payments (join through claims -> treatmentSessions to get therapist)
    const revenueResult = await db
      .select({ total: sql<string>`COALESCE(SUM(${payments.amount}::numeric), 0)` })
      .from(payments)
      .innerJoin(claims, eq(payments.claimId, claims.id))
      .innerJoin(treatmentSessions, eq(claims.sessionId, treatmentSessions.id))
      .where(and(
        eq(claims.practiceId, practiceId),
        sql`${treatmentSessions.therapistId} = ANY(${sql`ARRAY[${sql.join(staffIds.map((id: string) => sql`${id}`), sql`, `)}]`})`
      ));

    res.json({
      staffCount: staffIds.length,
      patientCount: Number(patientCountResult[0]?.count) || 0,
      appointmentCount: Number(appointmentCountResult[0]?.count) || 0,
      revenue: parseFloat(revenueResult[0]?.total || '0'),
    });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch location stats', error);
  }
});

export default router;

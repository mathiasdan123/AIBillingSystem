/**
 * Payer Contracts Routes
 *
 * Handles:
 * - /api/payer-contracts - CRUD for payer contracts
 * - /api/payer-contracts/:id/rates - CRUD for contracted rates
 * - /api/payer-contracts/:id/rates/compare - Rate comparison vs Medicare
 * - /api/payer-contracts/:id/rates/import - Bulk CSV import
 * - /api/payer-contracts/underpayments - Detect underpaid claims
 */

import { Router, type Response, type NextFunction } from 'express';
import { isAuthenticated } from '../replitAuth';
import { db } from '../db';
import {
  payerContracts,
  payerRates,
  claims,
  claimLineItems,
  insurances,
  cptCodes,
  type PayerContract,
  type InsertPayerContract,
  type PayerRate,
  type InsertPayerRate,
} from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
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

// Middleware: admin or billing role
const isAdminOrBilling = async (req: any, res: Response, next: NextFunction) => {
  const role = req.userRole;
  if (role === 'admin' || role === 'billing') {
    return next();
  }
  return res.status(403).json({ message: 'Admin or billing access required' });
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

// ==================== CONTRACTS CRUD ====================

// GET /api/payer-contracts - List all contracts for a practice
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const contracts = await db
      .select()
      .from(payerContracts)
      .where(eq(payerContracts.practiceId, practiceId))
      .orderBy(desc(payerContracts.createdAt));

    res.json(contracts);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch payer contracts', error);
  }
});

// GET /api/payer-contracts/:id - Get single contract
router.get('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const contractId = parseInt(req.params.id);
    if (isNaN(contractId)) {
      return res.status(400).json({ message: 'Invalid contract ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);
    const [contract] = await db
      .select()
      .from(payerContracts)
      .where(and(eq(payerContracts.id, contractId), eq(payerContracts.practiceId, practiceId)));

    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    res.json(contract);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch contract', error);
  }
});

// POST /api/payer-contracts - Create a new contract
router.post('/', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { payerName, payerId, contractName, effectiveDate, terminationDate, status, notes } = req.body;

    if (!payerName || !contractName || !effectiveDate) {
      return res.status(400).json({ message: 'payerName, contractName, and effectiveDate are required' });
    }

    const [contract] = await db
      .insert(payerContracts)
      .values({
        practiceId,
        payerName,
        payerId: payerId || null,
        contractName,
        effectiveDate,
        terminationDate: terminationDate || null,
        status: status || 'active',
        notes: notes || null,
      })
      .returning();

    res.status(201).json(contract);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to create payer contract', error);
  }
});

// PUT /api/payer-contracts/:id - Update a contract
router.put('/:id', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const contractId = parseInt(req.params.id);
    if (isNaN(contractId)) {
      return res.status(400).json({ message: 'Invalid contract ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);

    // Verify ownership
    const [existing] = await db
      .select()
      .from(payerContracts)
      .where(and(eq(payerContracts.id, contractId), eq(payerContracts.practiceId, practiceId)));

    if (!existing) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    const { payerName, payerId, contractName, effectiveDate, terminationDate, status, notes } = req.body;

    const [updated] = await db
      .update(payerContracts)
      .set({
        ...(payerName !== undefined && { payerName }),
        ...(payerId !== undefined && { payerId }),
        ...(contractName !== undefined && { contractName }),
        ...(effectiveDate !== undefined && { effectiveDate }),
        ...(terminationDate !== undefined && { terminationDate }),
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes }),
        updatedAt: new Date(),
      })
      .where(eq(payerContracts.id, contractId))
      .returning();

    res.json(updated);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to update payer contract', error);
  }
});

// DELETE /api/payer-contracts/:id - Delete a contract (and its rates)
router.delete('/:id', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const contractId = parseInt(req.params.id);
    if (isNaN(contractId)) {
      return res.status(400).json({ message: 'Invalid contract ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);

    // Verify ownership
    const [existing] = await db
      .select()
      .from(payerContracts)
      .where(and(eq(payerContracts.id, contractId), eq(payerContracts.practiceId, practiceId)));

    if (!existing) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    // Delete rates first, then the contract
    await db.delete(payerRates).where(eq(payerRates.contractId, contractId));
    await db.delete(payerContracts).where(eq(payerContracts.id, contractId));

    res.json({ message: 'Contract deleted successfully' });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to delete payer contract', error);
  }
});

// ==================== RATES CRUD ====================

// GET /api/payer-contracts/:id/rates - List rates for a contract
router.get('/:id/rates', isAuthenticated, async (req: any, res) => {
  try {
    const contractId = parseInt(req.params.id);
    if (isNaN(contractId)) {
      return res.status(400).json({ message: 'Invalid contract ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);

    // Verify ownership
    const [contract] = await db
      .select()
      .from(payerContracts)
      .where(and(eq(payerContracts.id, contractId), eq(payerContracts.practiceId, practiceId)));

    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    const rates = await db
      .select()
      .from(payerRates)
      .where(eq(payerRates.contractId, contractId))
      .orderBy(payerRates.cptCode);

    res.json(rates);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch rates', error);
  }
});

// POST /api/payer-contracts/:id/rates - Add a rate
router.post('/:id/rates', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const contractId = parseInt(req.params.id);
    if (isNaN(contractId)) {
      return res.status(400).json({ message: 'Invalid contract ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);

    // Verify ownership
    const [contract] = await db
      .select()
      .from(payerContracts)
      .where(and(eq(payerContracts.id, contractId), eq(payerContracts.practiceId, practiceId)));

    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    const { cptCode, description, contractedRate, medicareRate, effectiveDate, terminationDate, modifiers } = req.body;

    if (!cptCode || contractedRate === undefined || contractedRate === null) {
      return res.status(400).json({ message: 'cptCode and contractedRate are required' });
    }

    const [rate] = await db
      .insert(payerRates)
      .values({
        contractId,
        cptCode,
        description: description || null,
        contractedRate: contractedRate.toString(),
        medicareRate: medicareRate != null ? medicareRate.toString() : null,
        effectiveDate: effectiveDate || null,
        terminationDate: terminationDate || null,
        modifiers: modifiers || null,
      })
      .returning();

    res.status(201).json(rate);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to create rate', error);
  }
});

// PUT /api/payer-contracts/:contractId/rates/:rateId - Update a rate
router.put('/:contractId/rates/:rateId', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const contractId = parseInt(req.params.contractId);
    const rateId = parseInt(req.params.rateId);
    if (isNaN(contractId) || isNaN(rateId)) {
      return res.status(400).json({ message: 'Invalid IDs' });
    }

    const practiceId = getAuthorizedPracticeId(req);

    // Verify contract ownership
    const [contract] = await db
      .select()
      .from(payerContracts)
      .where(and(eq(payerContracts.id, contractId), eq(payerContracts.practiceId, practiceId)));

    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    // Verify rate belongs to contract
    const [existingRate] = await db
      .select()
      .from(payerRates)
      .where(and(eq(payerRates.id, rateId), eq(payerRates.contractId, contractId)));

    if (!existingRate) {
      return res.status(404).json({ message: 'Rate not found' });
    }

    const { cptCode, description, contractedRate, medicareRate, effectiveDate, terminationDate, modifiers } = req.body;

    const updateData: Record<string, any> = {};
    if (cptCode !== undefined) updateData.cptCode = cptCode;
    if (description !== undefined) updateData.description = description;
    if (contractedRate !== undefined) updateData.contractedRate = contractedRate.toString();
    if (medicareRate !== undefined) updateData.medicareRate = medicareRate != null ? medicareRate.toString() : null;
    if (effectiveDate !== undefined) updateData.effectiveDate = effectiveDate;
    if (terminationDate !== undefined) updateData.terminationDate = terminationDate;
    if (modifiers !== undefined) updateData.modifiers = modifiers;

    const [updated] = await db
      .update(payerRates)
      .set(updateData)
      .where(eq(payerRates.id, rateId))
      .returning();

    res.json(updated);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to update rate', error);
  }
});

// DELETE /api/payer-contracts/:contractId/rates/:rateId - Delete a rate
router.delete('/:contractId/rates/:rateId', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const contractId = parseInt(req.params.contractId);
    const rateId = parseInt(req.params.rateId);
    if (isNaN(contractId) || isNaN(rateId)) {
      return res.status(400).json({ message: 'Invalid IDs' });
    }

    const practiceId = getAuthorizedPracticeId(req);

    // Verify contract ownership
    const [contract] = await db
      .select()
      .from(payerContracts)
      .where(and(eq(payerContracts.id, contractId), eq(payerContracts.practiceId, practiceId)));

    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    // Verify rate belongs to contract
    const [existingRate] = await db
      .select()
      .from(payerRates)
      .where(and(eq(payerRates.id, rateId), eq(payerRates.contractId, contractId)));

    if (!existingRate) {
      return res.status(404).json({ message: 'Rate not found' });
    }

    await db.delete(payerRates).where(eq(payerRates.id, rateId));
    res.json({ message: 'Rate deleted successfully' });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to delete rate', error);
  }
});

// ==================== RATE COMPARISON ====================

// GET /api/payer-contracts/:id/rates/compare - Compare contracted vs Medicare rates
router.get('/:id/rates/compare', isAuthenticated, async (req: any, res) => {
  try {
    const contractId = parseInt(req.params.id);
    if (isNaN(contractId)) {
      return res.status(400).json({ message: 'Invalid contract ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);

    // Verify ownership
    const [contract] = await db
      .select()
      .from(payerContracts)
      .where(and(eq(payerContracts.id, contractId), eq(payerContracts.practiceId, practiceId)));

    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    const rates = await db
      .select()
      .from(payerRates)
      .where(eq(payerRates.contractId, contractId))
      .orderBy(payerRates.cptCode);

    interface RateComparison {
      id: number;
      cptCode: string;
      description: string | null;
      contractedRate: number;
      medicareRate: number | null;
      difference: number | null;
      percentOfMedicare: number | null;
      status: string;
    }

    const comparison: RateComparison[] = rates.map((rate: typeof rates[number]) => {
      const contracted = parseFloat(rate.contractedRate);
      const medicare = rate.medicareRate ? parseFloat(rate.medicareRate) : null;
      const difference = medicare != null ? contracted - medicare : null;
      const percentOfMedicare = medicare != null && medicare > 0
        ? Math.round((contracted / medicare) * 10000) / 100
        : null;

      return {
        id: rate.id,
        cptCode: rate.cptCode,
        description: rate.description,
        contractedRate: contracted,
        medicareRate: medicare,
        difference,
        percentOfMedicare,
        status: percentOfMedicare != null
          ? percentOfMedicare >= 100 ? 'above_medicare' : 'below_medicare'
          : 'no_medicare_data',
      };
    });

    const summary = {
      totalCodes: comparison.length,
      aboveMedicare: comparison.filter((c: RateComparison) => c.status === 'above_medicare').length,
      belowMedicare: comparison.filter((c: RateComparison) => c.status === 'below_medicare').length,
      noMedicareData: comparison.filter((c: RateComparison) => c.status === 'no_medicare_data').length,
      averagePercentOfMedicare: (() => {
        const withData = comparison.filter((c: RateComparison) => c.percentOfMedicare != null);
        if (withData.length === 0) return null;
        const total = withData.reduce((acc: number, c: RateComparison) => acc + (c.percentOfMedicare || 0), 0);
        return Math.round((total / withData.length) * 100) / 100;
      })(),
    };

    res.json({ contract, comparison, summary });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to compare rates', error);
  }
});

// ==================== CSV IMPORT ====================

// POST /api/payer-contracts/:id/rates/import - Bulk import rates from CSV
router.post('/:id/rates/import', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const contractId = parseInt(req.params.id);
    if (isNaN(contractId)) {
      return res.status(400).json({ message: 'Invalid contract ID' });
    }

    const practiceId = getAuthorizedPracticeId(req);

    // Verify ownership
    const [contract] = await db
      .select()
      .from(payerContracts)
      .where(and(eq(payerContracts.id, contractId), eq(payerContracts.practiceId, practiceId)));

    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    const { csvData } = req.body;
    if (!csvData || typeof csvData !== 'string') {
      return res.status(400).json({ message: 'csvData (string) is required' });
    }

    // Parse CSV: expected format is cptCode,description,rate[,medicareRate]
    const lines = csvData.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length > 0);

    if (lines.length === 0) {
      return res.status(400).json({ message: 'CSV data is empty' });
    }

    // Check if first line is a header
    const firstLine = lines[0].toLowerCase();
    const startIndex = (firstLine.includes('cpt') || firstLine.includes('code') || firstLine.includes('description')) ? 1 : 0;

    const imported: PayerRate[] = [];
    const errors: string[] = [];

    for (let i = startIndex; i < lines.length; i++) {
      const parts = lines[i].split(',').map((p: string) => p.trim().replace(/^["']|["']$/g, ''));

      if (parts.length < 3) {
        errors.push(`Line ${i + 1}: Expected at least 3 columns (cptCode, description, rate), got ${parts.length}`);
        continue;
      }

      const cptCode = parts[0];
      const description = parts[1];
      const rateStr = parts[2];
      const medicareRateStr = parts.length > 3 ? parts[3] : null;

      const rate = parseFloat(rateStr);
      if (isNaN(rate)) {
        errors.push(`Line ${i + 1}: Invalid rate value "${rateStr}"`);
        continue;
      }

      let medicareRate: number | null = null;
      if (medicareRateStr) {
        medicareRate = parseFloat(medicareRateStr);
        if (isNaN(medicareRate)) {
          medicareRate = null;
        }
      }

      try {
        const [newRate] = await db
          .insert(payerRates)
          .values({
            contractId,
            cptCode,
            description: description || null,
            contractedRate: rate.toString(),
            medicareRate: medicareRate != null ? medicareRate.toString() : null,
          })
          .returning();

        imported.push(newRate);
      } catch (insertError) {
        errors.push(`Line ${i + 1}: Failed to insert rate for CPT ${cptCode}`);
      }
    }

    res.json({
      message: `Imported ${imported.length} rates`,
      imported: imported.length,
      errors: errors.length > 0 ? errors : undefined,
      rates: imported,
    });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to import rates', error);
  }
});

// ==================== UNDERPAYMENT DETECTION ====================

// GET /api/payer-contracts/underpayments - Detect underpaid claims
router.get('/underpayments/detect', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    // Get all active contracts with their rates for this practice
    const contracts = await db
      .select()
      .from(payerContracts)
      .where(and(
        eq(payerContracts.practiceId, practiceId),
        eq(payerContracts.status, 'active'),
      ));

    if (contracts.length === 0) {
      return res.json({ underpayments: [], message: 'No active contracts found' });
    }

    // Build a map of payerName -> { cptCode -> contractedRate }
    const rateMap: Map<string, Map<string, number>> = new Map();
    const contractMap: Map<string, PayerContract> = new Map();

    for (const contract of contracts) {
      const rates = await db
        .select()
        .from(payerRates)
        .where(eq(payerRates.contractId, contract.id));

      const cptRates = new Map<string, number>();
      for (const rate of rates) {
        cptRates.set(rate.cptCode, parseFloat(rate.contractedRate));
      }
      rateMap.set(contract.payerName.toLowerCase(), cptRates);
      contractMap.set(contract.payerName.toLowerCase(), contract);
    }

    // Get paid claims with their line items and insurance info
    const paidClaims = await db
      .select({
        claim: claims,
        insurance: insurances,
      })
      .from(claims)
      .leftJoin(insurances, eq(claims.insuranceId, insurances.id))
      .where(and(
        eq(claims.practiceId, practiceId),
        eq(claims.status, 'paid'),
      ))
      .orderBy(desc(claims.paidAt));

    const underpayments: Array<{
      claimId: number;
      claimNumber: string | null;
      payerName: string;
      paidAmount: number;
      expectedAmount: number;
      underpaymentAmount: number;
      paidAt: Date | null;
      lineItems: Array<{
        cptCode: string;
        paidRate: number;
        contractedRate: number;
        difference: number;
        units: number;
      }>;
    }> = [];

    for (const { claim, insurance } of paidClaims) {
      if (!insurance) continue;

      const payerKey = insurance.name.toLowerCase();
      const cptRates = rateMap.get(payerKey);
      if (!cptRates) continue;

      // Get line items for this claim
      const lineItems = await db
        .select()
        .from(claimLineItems)
        .where(eq(claimLineItems.claimId, claim.id));

      let expectedTotal = 0;
      const underpaidItems: Array<{
        cptCode: string;
        paidRate: number;
        contractedRate: number;
        difference: number;
        units: number;
      }> = [];

      for (const item of lineItems) {
        // Look up CPT code from the cptCodes table if we have an ID
        // For now, use the rate as the paid rate and compare
        const paidRate = parseFloat(item.rate);
        const units = item.units;

        // We need to find the CPT code string - query it
        const [cptCodeResult] = await db
          .select()
          .from(cptCodes)
          .where(eq(cptCodes.id, item.cptCodeId))
          .limit(1);

        if (!cptCodeResult) continue;

        const contractedRate = cptRates.get(cptCodeResult.code);
        if (contractedRate === undefined) continue;

        expectedTotal += contractedRate * units;

        // If the paid rate per unit is less than contracted rate
        if (paidRate < contractedRate) {
          underpaidItems.push({
            cptCode: cptCodeResult.code,
            paidRate,
            contractedRate,
            difference: contractedRate - paidRate,
            units,
          });
        }
      }

      const paidAmount = claim.paidAmount ? parseFloat(claim.paidAmount) : 0;

      if (underpaidItems.length > 0 || (expectedTotal > 0 && paidAmount < expectedTotal)) {
        underpayments.push({
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          payerName: insurance.name,
          paidAmount,
          expectedAmount: expectedTotal,
          underpaymentAmount: expectedTotal - paidAmount,
          paidAt: claim.paidAt,
          lineItems: underpaidItems,
        });
      }
    }

    res.json({
      underpayments,
      totalUnderpaymentAmount: underpayments.reduce((sum, u) => sum + u.underpaymentAmount, 0),
      underpaidClaimCount: underpayments.length,
    });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to detect underpayments', error);
  }
});

/**
 * Utility function: Check if a claim payment is underpaid vs contracted rate.
 * Call this when a claim payment comes in to flag underpayments.
 */
export async function checkClaimUnderpayment(claimId: number): Promise<{
  isUnderpaid: boolean;
  expectedAmount: number;
  paidAmount: number;
  difference: number;
} | null> {
  try {
    const [claim] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, claimId));

    if (!claim || !claim.insuranceId || !claim.paidAmount) return null;

    const [insurance] = await db
      .select()
      .from(insurances)
      .where(eq(insurances.id, claim.insuranceId));

    if (!insurance) return null;

    // Find active contract for this payer and practice
    const [contract] = await db
      .select()
      .from(payerContracts)
      .where(and(
        eq(payerContracts.practiceId, claim.practiceId),
        eq(payerContracts.status, 'active'),
        sql`LOWER(${payerContracts.payerName}) = LOWER(${insurance.name})`,
      ));

    if (!contract) return null;

    // Get contracted rates
    const rates = await db
      .select()
      .from(payerRates)
      .where(eq(payerRates.contractId, contract.id));

    const rateMap = new Map<string, number>();
    for (const rate of rates) {
      rateMap.set(rate.cptCode, parseFloat(rate.contractedRate));
    }

    // Get line items and calculate expected amount
    const lineItems = await db
      .select()
      .from(claimLineItems)
      .where(eq(claimLineItems.claimId, claimId));

    let expectedTotal = 0;
    for (const item of lineItems) {
      const [cptCodeResult] = await db
        .select()
        .from(cptCodes)
        .where(eq(cptCodes.id, item.cptCodeId))
        .limit(1);

      if (!cptCodeResult) continue;

      const contractedRate = rateMap.get(cptCodeResult.code);
      if (contractedRate !== undefined) {
        expectedTotal += contractedRate * item.units;
      }
    }

    const paidAmount = parseFloat(claim.paidAmount);
    const difference = expectedTotal - paidAmount;

    return {
      isUnderpaid: difference > 0.01, // Small threshold for rounding
      expectedAmount: expectedTotal,
      paidAmount,
      difference: Math.max(0, difference),
    };
  } catch (error) {
    logger.error('Error checking claim underpayment', {
      claimId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export default router;

/**
 * Bulk Operations Service
 *
 * Provides batch operations for claims:
 * - bulkSubmitClaims: validate and submit multiple claims
 * - bulkUpdateClaimStatus: batch status update
 * - bulkExportClaims: CSV export with filters
 */

import { storage } from '../storage';
import logger from './logger';
import type { Claim } from '../../shared/schema';

export interface BulkOperationResult {
  claimId: number;
  success: boolean;
  error?: string;
}

export interface BulkSubmitResult extends BulkOperationResult {
  claimNumber?: string | null;
  submissionMethod?: string;
}

export interface BulkExportFilters {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  payerName?: string;
}

/**
 * Submit multiple claims in bulk. Validates each claim belongs to the practice
 * and is in draft status. One failure does not stop the batch.
 */
export async function bulkSubmitClaims(
  claimIds: number[],
  practiceId: number
): Promise<BulkSubmitResult[]> {
  const results: BulkSubmitResult[] = [];

  for (const claimId of claimIds) {
    try {
      const claim = await storage.getClaim(claimId);

      if (!claim) {
        results.push({ claimId, success: false, error: 'Claim not found' });
        continue;
      }

      if (claim.practiceId !== practiceId) {
        results.push({ claimId, success: false, error: 'Claim does not belong to this practice' });
        continue;
      }

      if (claim.status !== 'draft') {
        results.push({
          claimId,
          success: false,
          error: `Claim is in '${claim.status}' status, only draft claims can be submitted`,
        });
        continue;
      }

      // Update claim to submitted status
      await storage.updateClaim(claimId, {
        status: 'submitted',
        submittedAt: new Date(),
        submittedAmount: claim.totalAmount,
      });

      results.push({
        claimId,
        success: true,
        claimNumber: claim.claimNumber,
        submissionMethod: 'manual',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Bulk submit failed for claim', { claimId, error: message });
      results.push({ claimId, success: false, error: message });
    }
  }

  return results;
}

/**
 * Update status of multiple claims in bulk. Validates each claim belongs
 * to the practice. One failure does not stop the batch.
 */
export async function bulkUpdateClaimStatus(
  claimIds: number[],
  status: string,
  practiceId: number
): Promise<BulkOperationResult[]> {
  const validStatuses = ['draft', 'submitted', 'paid', 'denied', 'appeal', 'optimized'];
  const results: BulkOperationResult[] = [];

  if (!validStatuses.includes(status)) {
    return claimIds.map(claimId => ({
      claimId,
      success: false,
      error: `Invalid status '${status}'. Valid statuses: ${validStatuses.join(', ')}`,
    }));
  }

  for (const claimId of claimIds) {
    try {
      const claim = await storage.getClaim(claimId);

      if (!claim) {
        results.push({ claimId, success: false, error: 'Claim not found' });
        continue;
      }

      if (claim.practiceId !== practiceId) {
        results.push({ claimId, success: false, error: 'Claim does not belong to this practice' });
        continue;
      }

      const updateData: Record<string, any> = { status };
      if (status === 'submitted') {
        updateData.submittedAt = new Date();
      } else if (status === 'paid') {
        updateData.paidAt = new Date();
      }

      await storage.updateClaim(claimId, updateData);
      results.push({ claimId, success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Bulk status update failed for claim', { claimId, error: message });
      results.push({ claimId, success: false, error: message });
    }
  }

  return results;
}

/**
 * Export claims as CSV string with optional filters.
 */
export async function bulkExportClaims(
  practiceId: number,
  filters: BulkExportFilters
): Promise<string> {
  let allClaims = await storage.getClaims(practiceId);

  // Apply filters
  if (filters.status) {
    allClaims = allClaims.filter(c => c.status === filters.status);
  }

  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom);
    allClaims = allClaims.filter(c => c.createdAt && new Date(c.createdAt) >= from);
  }

  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    allClaims = allClaims.filter(c => c.createdAt && new Date(c.createdAt) <= to);
  }

  if (filters.payerName) {
    const payerLower = filters.payerName.toLowerCase();
    // Filter by clearinghouse response payer name if available
    allClaims = allClaims.filter(c => {
      const response = c.clearinghouseResponse as any;
      if (response && response.payerName) {
        return response.payerName.toLowerCase().includes(payerLower);
      }
      return false;
    });
  }

  // Build CSV
  const headers = [
    'ID',
    'Claim Number',
    'Patient ID',
    'Status',
    'Total Amount',
    'Submitted Amount',
    'Paid Amount',
    'Billing Order',
    'Created At',
    'Submitted At',
    'Paid At',
  ];

  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = allClaims.map(c => [
    c.id,
    c.claimNumber,
    c.patientId,
    c.status,
    c.totalAmount,
    c.submittedAmount,
    c.paidAmount,
    c.billingOrder,
    c.createdAt ? new Date(c.createdAt).toISOString() : '',
    c.submittedAt ? new Date(c.submittedAt).toISOString() : '',
    c.paidAt ? new Date(c.paidAt).toISOString() : '',
  ].map(escapeCSV).join(','));

  return [headers.join(','), ...rows].join('\n');
}

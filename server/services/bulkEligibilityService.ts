/**
 * Shared bulk-eligibility helper.
 *
 * Extracted so both the in-app dispatcher (server/routes/ai-assistant.ts)
 * and the MCP eligibility tools (server/mcp/tools/eligibility.ts) call the
 * exact same primitive. Behavior must stay identical across surfaces — any
 * change here is felt by both Blanche web chat and MCP clients.
 *
 * Tenant scoping: callers pass practiceId; every fetched patient is
 * defensively checked against that practiceId before any Stedi call.
 */
import { storage } from '../storage';
import { sanitizeExternalError } from './errorSanitizer';

export type BulkEligibilityResult = {
  checked: number;
  eligible: number;
  ineligible: number;
  errors: number;
  results: Array<{
    patientName: string;
    insurance: string | null;
    status: string;
    eligible: boolean | null;
    error?: string;
  }>;
};

export async function runBulkEligibility(
  practiceId: number,
  patientIds: number[],
): Promise<BulkEligibilityResult | { error: string }> {
  const {
    checkEligibility: stediCheckEligibility,
    isStediConfigured,
    PAYER_IDS: payerIds,
  } = await import('./stediService');
  if (!isStediConfigured()) {
    return { error: 'Stedi API is not configured. Please set the STEDI_API_KEY.' };
  }

  const practice = await storage.getPractice(practiceId);

  const results: BulkEligibilityResult['results'] = [];
  let eligible = 0;
  let ineligible = 0;
  let errors = 0;

  for (let i = 0; i < patientIds.length; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 200));
    const pid = patientIds[i];
    try {
      const pat: any = await storage.getPatient(pid);
      if (!pat) {
        errors++;
        results.push({ patientName: 'Unknown', insurance: null, status: 'error', eligible: null, error: 'Patient not found' });
        continue;
      }
      if (pat.practiceId !== practiceId) {
        errors++;
        results.push({ patientName: 'Unknown', insurance: null, status: 'error', eligible: null, error: 'Patient not in practice' });
        continue;
      }
      if (!pat.insuranceProvider && !pat.insuranceId && !pat.policyNumber) {
        errors++;
        results.push({ patientName: `${pat.firstName} ${pat.lastName}`, insurance: null, status: 'skipped', eligible: null, error: 'No insurance info' });
        continue;
      }

      const insName = (pat.insuranceProvider || '').toLowerCase();
      const pId = (payerIds as Record<string, string>)[insName] || pat.insuranceId || '60054';
      const eligRes = await stediCheckEligibility({
        payer: { id: pId, name: pat.insuranceProvider || 'Unknown' },
        provider: { npi: (practice as any)?.npi || '', organizationName: (practice as any)?.name || undefined },
        subscriber: { memberId: pat.insuranceId || pat.policyNumber || '', firstName: pat.firstName, lastName: pat.lastName, dateOfBirth: pat.dateOfBirth || '' },
      }, practiceId);

      const isElig = eligRes.status === 'active';
      if (isElig) eligible++;
      else if (eligRes.status === 'inactive') ineligible++;
      else errors++;

      results.push({
        patientName: `${pat.firstName} ${pat.lastName}`,
        insurance: pat.insuranceProvider || null,
        status: eligRes.status,
        eligible: isElig,
      });
    } catch (err) {
      errors++;
      results.push({ patientName: 'Unknown', insurance: null, status: 'error', eligible: null, error: sanitizeExternalError(err instanceof Error ? err.message : String(err)) });
    }
  }

  return { checked: patientIds.length, eligible, ineligible, errors, results };
}

/**
 * Phase 5 guard — refuse mutation/send/charge operations when the target row
 * is a demo row. Returns a human-readable error string ready to surface, or
 * null if the row is NOT demo and the caller should proceed.
 */
export function rejectIfDemoDataMessage(
  row: { isDemo?: boolean } | null | undefined,
  what: 'patient' | 'claim' | 'appointment',
): string | null {
  if (row && (row as any).isDemo) {
    return `This is a demo ${what} (created by enable_demo_mode). To keep demo and real data separate, demo rows can't be submitted, sent, or charged. To do this for real, create a real ${what} first — or call clear_demo_data to wipe the demo records.`;
  }
  return null;
}

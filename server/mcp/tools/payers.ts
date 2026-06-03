import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as stediService from '../../services/stediService';
import { withAudit } from '../audit';
import type { McpPracticeContext } from '../types';

/**
 * Payer-directory tools. `search_payer` resolves a payer's name to its verified
 * Stedi payer ID(s) with transaction support, so the assistant returns real IDs
 * instead of guessing. Payer-directory data is public (not PHI) — containsPhi=false.
 */
export function registerPayerTools(
  server: McpServer,
  context: McpPracticeContext,
) {
  const searchPayer = withAudit(
    'search_payer',
    'eligibility',
    false, // payer directory is public reference data, not PHI
    async (input: { query: string; limit?: number }) => {
      const query = (input.query || '').trim();
      if (!query) {
        return { query: '', count: 0, payers: [], message: 'Provide a payer name, ID, or alias to search.' };
      }

      const results = await stediService.searchPayers(query, {
        pageSize: input.limit,
        practiceId: context.practiceId,
      });

      if (results.length === 0) {
        return {
          query,
          count: 0,
          payers: [],
          message: `No payers matched "${query}". Try a shorter or differently spelled name (fuzzy matching is supported).`,
        };
      }

      // Flatten transaction support into plain language for the assistant.
      const payers = results.map((p) => ({
        payerId: p.payerId,
        name: p.displayName,
        operatingStates: p.operatingStates,
        coverageTypes: p.coverageTypes,
        aliases: p.aliases,
        eligibilityCheck: p.transactionSupport.eligibilityCheck ?? 'UNKNOWN',
        professionalClaims: p.transactionSupport.professionalClaimSubmission ?? 'UNKNOWN',
        claimStatus: p.transactionSupport.claimStatus ?? 'UNKNOWN',
        eraPayment: p.transactionSupport.claimPayment ?? 'UNKNOWN',
      }));

      const top = payers[0];
      return {
        query,
        count: payers.length,
        payers,
        message:
          `Top match: ${top.name} — payer ID ${top.payerId}. ` +
          `Eligibility ${top.eligibilityCheck}, professional claims ${top.professionalClaims}, ERA ${top.eraPayment}. ` +
          (payers.length > 1
            ? `${payers.length - 1} other related ${payers.length - 1 === 1 ? 'payer' : 'payers'} returned (e.g. Medicaid "Better Health" or Senior Supplemental have separate IDs) — confirm the patient's exact plan.`
            : ''),
      };
    },
  );

  server.tool(
    'search_payer',
    'Look up a verified insurance payer ID from a payer name (or ID/alias) using the live Stedi Payer Network. Use when a user asks "what is the payer ID for X", before configuring a patient\'s insurance, or to confirm whether a payer supports eligibility, claims, claim status, or ERA. Returns the primary payer ID, related entities (commercial vs. Medicaid vs. Senior Supplemental often differ), operating states, and per-transaction support. Public reference data — no PHI.',
    {
      query: z.string().describe('Payer name, payer ID, or alias to search for (fuzzy matching supported, e.g. "aetna", "bcbs nj", "60054").'),
      limit: z.number().optional().describe('Max results to return (10-100, default 10).'),
    },
    (input) => searchPayer(input, context),
  );
}

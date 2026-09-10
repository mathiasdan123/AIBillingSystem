/**
 * Canonical Anthem payer_crosswalk rows — single source of truth shared by
 * the seed (server/seeds.ts), the prod sync script
 * (scripts/repair-anthem-crosswalk-payer-id.ts), and tests.
 *
 * Stedi has no single "Anthem" payer: each state is its own entity with its
 * own payer ID (verified 2026-09-10 via GET /2024-04-01/payers/search). The
 * IDs below are each entity's primary payer ID from Stedi's registry; the
 * stediId (registry key) is recorded in notes.
 *
 * The New York row doubles as the generic fallback — its keywords include
 * plain "anthem" so plan names with no state qualifier still resolve. That is
 * deliberate while Wonder Kids (NY) is the only Anthem-billing practice;
 * revisit the fallback if a practice in another Anthem state onboards with
 * unqualified plan names. State-qualified names win regardless of the
 * fallback because resolvePayerId picks the most specific crosswalk match,
 * not the first.
 */
import type { InsertPayerCrosswalk } from '../../shared/schema';

/**
 * Keyword variants for one Anthem state entity. Matching normalizes both
 * sides (BCBS → "blue cross blue shield", "of/the" stripped — see
 * normalizePayerNameForMatch in stediService), so these four cover
 * "Anthem Indiana", "Anthem BCBS of Indiana", "Anthem Blue Cross Blue
 * Shield Indiana", and "Anthem Blue Cross and Blue Shield Indiana" alike.
 */
function stateKeywords(stateName: string): string[] {
  return [
    `anthem ${stateName}`,
    `anthem blue cross ${stateName}`,
    `anthem blue cross blue shield ${stateName}`,
    `anthem blue cross and blue shield ${stateName}`,
  ];
}

const ANTHEM_STATES: Array<{ state: string; stateName: string; payerId: string; stediId: string }> = [
  { state: 'CA', stateName: 'california', payerId: '040', stediId: 'LAESW' },
  { state: 'CO', stateName: 'colorado', payerId: '050', stediId: 'TBEZC' },
  { state: 'CT', stateName: 'connecticut', payerId: '00060', stediId: 'DRWRY' },
  { state: 'GA', stateName: 'georgia', payerId: '00601', stediId: 'VDCLI' },
  { state: 'IN', stateName: 'indiana', payerId: '130', stediId: 'AOQAR' },
  { state: 'KY', stateName: 'kentucky', payerId: '00660', stediId: 'DXTYZ' },
  { state: 'ME', stateName: 'maine', payerId: '180', stediId: 'YJHSX' },
  { state: 'MO', stateName: 'missouri', payerId: '241', stediId: 'XUAZF' },
  { state: 'NV', stateName: 'nevada', payerId: '00265', stediId: 'ERSOT' },
  { state: 'NH', stateName: 'new hampshire', payerId: '00770', stediId: 'QCFIB' },
  { state: 'OH', stateName: 'ohio', payerId: '00834', stediId: 'BHNXS' },
  { state: 'VA', stateName: 'virginia', payerId: '423', stediId: 'DGOYK' },
  { state: 'WI', stateName: 'wisconsin', payerId: '450', stediId: 'VLFZU' },
];

export const ANTHEM_CROSSWALK_ROWS: InsertPayerCrosswalk[] = [
  {
    parentPayerName: 'Blue Cross Blue Shield',
    subPlanName: 'Anthem BCBS of New York',
    subPlanKeywords: [
      ...stateKeywords('new york'),
      // Generic fallback: unqualified "Anthem" plan names resolve here.
      'anthem',
      'anthem bcbs',
      'anthem blue cross',
      // Former name of the NY entity (renamed 2024). Deliberately NOT plain
      // "empire" — "The Empire Plan" (NYSHIP) is administered by UHC.
      'empire bcbs',
      'empire blue cross',
    ],
    tradingPartnerId: '803',
    stediPayerId: '803',
    state: 'NY',
    notes:
      'Anthem BCBS of New York (formerly Empire BCBS), Stedi OLQXL / primary payer ID 803. ' +
      'Also the generic fallback for unqualified "Anthem" plan names. ' +
      'Prior seed value 00805 resolved to Excellus BCBS of NY, not Anthem.',
    isActive: true,
  },
  ...ANTHEM_STATES.map(({ state, stateName, payerId, stediId }) => ({
    parentPayerName: 'Blue Cross Blue Shield',
    subPlanName: `Anthem BCBS of ${stateName.replace(/\b\w/g, (c) => c.toUpperCase())}`,
    subPlanKeywords: stateKeywords(stateName),
    tradingPartnerId: payerId,
    stediPayerId: payerId,
    state,
    notes: `Anthem ${state} per Stedi registry (stediId ${stediId}, primary payer ID ${payerId}).`,
    isActive: true,
  })),
];

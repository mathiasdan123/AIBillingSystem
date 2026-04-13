/**
 * EDI 835 (Electronic Remittance Advice) Parser
 *
 * Parses X12 835 transaction sets to extract payment information.
 * Handles core segments: ISA, GS, ST, BPR, TRN, N1, CLP, SVC, CAS, DTM, AMT.
 *
 * Reference: ASC X12 835 Health Care Claim Payment/Advice
 */

// ==================== Types ====================

export interface Parsed835 {
  /** Interchange envelope info */
  interchange: {
    senderId: string;
    receiverId: string;
    date: string;
    controlNumber: string;
  };
  /** Functional group info */
  functionalGroup: {
    senderId: string;
    receiverId: string;
    date: string;
    controlNumber: string;
  };
  /** Payment/check info from BPR segment */
  payment: {
    transactionType: string; // H = remittance only, I = payment + remittance, etc.
    totalAmount: number;
    paymentMethod: string; // ACH, CHK, FWT, etc.
    checkNumber?: string;
    checkDate?: string;
    payerName?: string;
    payerId?: string;
    payeeName?: string;
    payeeId?: string;
  };
  /** Trace number from TRN segment */
  traceNumber?: string;
  /** Individual claim-level details */
  claims: Parsed835Claim[];
  /** Raw segment data for debugging */
  rawSegments: string[];
}

export interface Parsed835Claim {
  /** Patient control number (claim number from original 837) */
  patientControlNumber: string;
  /** Claim status: 1=processed primary, 2=processed secondary, etc. */
  claimStatusCode: string;
  /** Total charge amount on the claim */
  chargedAmount: number;
  /** Amount the payer paid */
  paidAmount: number;
  /** Patient responsibility amount */
  patientResponsibility: number;
  /** Claim filing indicator (e.g., 12 = PPO) */
  claimFilingIndicator?: string;
  /** Payer claim control number */
  payerClaimControlNumber?: string;
  /** Patient name from NM1 segment */
  patientName?: string;
  /** Subscriber/member ID */
  memberId?: string;
  /** Service lines under this claim */
  serviceLines: Parsed835ServiceLine[];
  /** Claim-level adjustments */
  adjustments: Parsed835Adjustment[];
}

export interface Parsed835ServiceLine {
  /** CPT/HCPCS procedure code */
  procedureCode: string;
  /** Procedure modifiers */
  modifiers: string[];
  /** Charged amount for this service */
  chargedAmount: number;
  /** Paid amount for this service */
  paidAmount: number;
  /** Allowed amount */
  allowedAmount?: number;
  /** Units of service */
  units: number;
  /** Date of service */
  serviceDate?: string;
  /** Service-level adjustments */
  adjustments: Parsed835Adjustment[];
  /** Remark codes */
  remarkCodes: string[];
}

export interface Parsed835Adjustment {
  /** Adjustment group code: CO, OA, PI, PR, CR */
  groupCode: string;
  /** Reason code (e.g., 1, 2, 45, 253) */
  reasonCode: string;
  /** Adjustment amount */
  amount: number;
  /** Quantity (optional) */
  quantity?: number;
}

// ==================== Adjustment Group Code Descriptions ====================

const ADJUSTMENT_GROUP_CODES: Record<string, string> = {
  'CO': 'Contractual Obligations',
  'OA': 'Other Adjustments',
  'PI': 'Payor Initiated Reductions',
  'PR': 'Patient Responsibility',
  'CR': 'Corrections/Reversals',
};

// Common adjustment reason codes (subset)
const COMMON_REASON_CODES: Record<string, string> = {
  '1': 'Deductible amount',
  '2': 'Coinsurance amount',
  '3': 'Copayment amount',
  '4': 'The procedure code is inconsistent with the modifier used',
  '5': 'The procedure code/bill type is inconsistent with the place of service',
  '16': 'Claim/service lacks information needed for adjudication',
  '18': 'Duplicate claim/service',
  '22': 'Payment adjusted - care may not have been covered',
  '23': 'Payment adjusted - charges covered under capitation agreement',
  '29': 'The time limit for filing has expired',
  '45': 'Charge exceeds fee schedule/maximum allowable/contracted/legislated amount',
  '50': 'Non-covered services',
  '96': 'Non-covered charges',
  '97': 'Payment adjusted - benefit for this service not provided',
  '109': 'Claim not covered by this payer',
  '119': 'Benefit maximum for this time period has been reached',
  '197': 'Precertification/authorization/notification absent',
  '204': 'This service is not covered under patient benefit plan',
  '253': 'Sequestration - reduction in federal payment',
};

// ==================== Parser ====================

/**
 * Parse an X12 835 EDI document into structured data.
 *
 * @param rawEdi - The raw X12 835 text (segments separated by ~ and elements by *)
 * @returns Parsed835 structure
 */
export function parse835(rawEdi: string): Parsed835 {
  // Normalize line endings and trim
  const normalized = rawEdi.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  // Detect segment terminator - usually ~ but could be ~\n
  // ISA segment is always exactly 106 characters before the segment terminator
  let segmentTerminator = '~';
  let elementSeparator = '*';
  let subElementSeparator = ':';

  // The ISA segment has a fixed length; element separator is position 3, sub-element at 104, segment term at 105
  if (normalized.length >= 106) {
    elementSeparator = normalized[3];
    subElementSeparator = normalized[104];
    segmentTerminator = normalized[105];
  }

  // Split into segments, removing empties and whitespace
  const rawSegments = normalized
    .split(segmentTerminator)
    .map(s => s.replace(/[\n\r]/g, '').trim())
    .filter(s => s.length > 0);

  const result: Parsed835 = {
    interchange: { senderId: '', receiverId: '', date: '', controlNumber: '' },
    functionalGroup: { senderId: '', receiverId: '', date: '', controlNumber: '' },
    payment: { transactionType: '', totalAmount: 0, paymentMethod: '' },
    claims: [],
    rawSegments,
  };

  let currentClaim: Parsed835Claim | null = null;
  let currentServiceLine: Parsed835ServiceLine | null = null;
  let currentN1Qualifier = '';

  for (const segment of rawSegments) {
    const elements = segment.split(elementSeparator);
    const segmentId = elements[0];

    switch (segmentId) {
      case 'ISA':
        result.interchange = parseISA(elements);
        break;

      case 'GS':
        result.functionalGroup = parseGS(elements);
        break;

      case 'BPR':
        result.payment = {
          ...result.payment,
          ...parseBPR(elements),
        };
        break;

      case 'TRN':
        result.traceNumber = elements[2] || '';
        // The check/EFT number may also be in TRN03
        if (elements[3] && !result.payment.checkNumber) {
          result.payment.checkNumber = elements[3];
        }
        break;

      case 'DTM': {
        const dateQualifier = elements[1];
        const dateValue = elements[2] || '';
        if (dateQualifier === '405') {
          // Production date (check date)
          result.payment.checkDate = formatDate(dateValue);
        }
        if (currentServiceLine && dateQualifier === '472') {
          // Service date
          currentServiceLine.serviceDate = formatDate(dateValue);
        }
        break;
      }

      case 'N1': {
        currentN1Qualifier = elements[1] || '';
        const entityName = elements[2] || '';
        const idQualifier = elements[3] || '';
        const entityId = elements[4] || '';

        if (currentN1Qualifier === 'PR') {
          // Payer
          result.payment.payerName = entityName;
          result.payment.payerId = entityId;
        } else if (currentN1Qualifier === 'PE') {
          // Payee
          result.payment.payeeName = entityName;
          result.payment.payeeId = entityId;
        }
        break;
      }

      case 'CLP': {
        // Save previous claim
        if (currentClaim) {
          if (currentServiceLine) {
            currentClaim.serviceLines.push(currentServiceLine);
            currentServiceLine = null;
          }
          result.claims.push(currentClaim);
        }

        currentClaim = parseCLP(elements);
        currentServiceLine = null;
        break;
      }

      case 'NM1': {
        if (currentClaim) {
          const entityIdCode = elements[1];
          if (entityIdCode === 'QC') {
            // Patient name
            const lastName = elements[3] || '';
            const firstName = elements[4] || '';
            currentClaim.patientName = `${firstName} ${lastName}`.trim();
            // Member ID can appear in NM109 for QC as well
            if (elements[9]) {
              currentClaim.memberId = elements[9];
            }
          } else if (entityIdCode === 'IL') {
            // Insured/subscriber
            const lastName = elements[3] || '';
            const firstName = elements[4] || '';
            if (!currentClaim.patientName) {
              currentClaim.patientName = `${firstName} ${lastName}`.trim();
            }
            // Member ID is in NM109
            if (elements[9]) {
              currentClaim.memberId = elements[9];
            }
          }
        }
        break;
      }

      case 'SVC': {
        // Save previous service line
        if (currentServiceLine && currentClaim) {
          currentClaim.serviceLines.push(currentServiceLine);
        }

        currentServiceLine = parseSVC(elements, subElementSeparator);
        break;
      }

      case 'CAS': {
        const adjustment = parseCAS(elements);
        if (currentServiceLine) {
          currentServiceLine.adjustments.push(...adjustment);
        } else if (currentClaim) {
          currentClaim.adjustments.push(...adjustment);
        }
        break;
      }

      case 'AMT': {
        if (currentServiceLine) {
          const amtQualifier = elements[1];
          const amount = parseFloat(elements[2] || '0');
          if (amtQualifier === 'B6') {
            // Allowed amount
            currentServiceLine.allowedAmount = amount;
          }
        }
        break;
      }

      case 'LQ': {
        // Remark codes (e.g., LQ*HE*N130)
        const remarkQualifier = elements[1] || '';
        const remarkCode = elements[2] || '';
        if (remarkCode && currentServiceLine) {
          currentServiceLine.remarkCodes.push(remarkCode);
        }
        break;
      }

      default:
        // Ignore unknown segments
        break;
    }
  }

  // Push the last claim
  if (currentClaim) {
    if (currentServiceLine) {
      currentClaim.serviceLines.push(currentServiceLine);
    }
    result.claims.push(currentClaim);
  }

  return result;
}

// ==================== Segment Parsers ====================

function parseISA(elements: string[]): Parsed835['interchange'] {
  return {
    senderId: (elements[6] || '').trim(),
    receiverId: (elements[8] || '').trim(),
    date: formatDate((elements[9] || '') + (elements[10] || '')),
    controlNumber: (elements[13] || '').trim(),
  };
}

function parseGS(elements: string[]): Parsed835['functionalGroup'] {
  return {
    senderId: (elements[2] || '').trim(),
    receiverId: (elements[3] || '').trim(),
    date: formatDate(elements[4] || ''),
    controlNumber: (elements[6] || '').trim(),
  };
}

function parseBPR(elements: string[]): Partial<Parsed835['payment']> {
  return {
    transactionType: elements[1] || '',
    totalAmount: parseFloat(elements[2] || '0'),
    paymentMethod: elements[4] || '',
    checkNumber: elements[10] || undefined,
    checkDate: elements[16] ? formatDate(elements[16]) : undefined,
  };
}

function parseCLP(elements: string[]): Parsed835Claim {
  return {
    patientControlNumber: elements[1] || '',
    claimStatusCode: elements[2] || '',
    chargedAmount: parseFloat(elements[3] || '0'),
    paidAmount: parseFloat(elements[4] || '0'),
    patientResponsibility: parseFloat(elements[5] || '0'),
    claimFilingIndicator: elements[6] || undefined,
    payerClaimControlNumber: elements[7] || undefined,
    serviceLines: [],
    adjustments: [],
  };
}

function parseSVC(elements: string[], subElementSep: string): Parsed835ServiceLine {
  // SVC01 is composite: procedure code type + code + modifiers
  // e.g., HC:99213:25 or HC:90837
  const compositeParts = (elements[1] || '').split(subElementSep);
  const procedureCode = compositeParts[1] || compositeParts[0] || '';
  const modifiers = compositeParts.slice(2).filter(m => m.length > 0);

  return {
    procedureCode,
    modifiers,
    chargedAmount: parseFloat(elements[2] || '0'),
    paidAmount: parseFloat(elements[3] || '0'),
    units: parseInt(elements[5] || '1', 10) || 1,
    adjustments: [],
    remarkCodes: [],
  };
}

function parseCAS(elements: string[]): Parsed835Adjustment[] {
  const groupCode = elements[1] || '';
  const adjustments: Parsed835Adjustment[] = [];

  // CAS segment: CAS*groupCode*reasonCode1*amount1*quantity1*reasonCode2*amount2*quantity2...
  // Each adjustment is a triplet: reasonCode, amount, quantity (repeated up to 6 times)
  for (let i = 2; i < elements.length; i += 3) {
    const reasonCode = elements[i];
    const amount = elements[i + 1];
    const quantity = elements[i + 2];

    if (reasonCode && amount) {
      adjustments.push({
        groupCode,
        reasonCode,
        amount: parseFloat(amount),
        quantity: quantity ? parseInt(quantity, 10) : undefined,
      });
    }
  }

  return adjustments;
}

// ==================== Utilities ====================

/**
 * Format a date string from EDI format (YYYYMMDD or YYMMDD) to YYYY-MM-DD
 */
function formatDate(raw: string): string {
  const cleaned = raw.replace(/\D/g, '');
  if (cleaned.length === 8) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  }
  if (cleaned.length === 6) {
    const year = parseInt(cleaned.slice(0, 2), 10);
    const prefix = year > 50 ? '19' : '20';
    return `${prefix}${cleaned.slice(0, 2)}-${cleaned.slice(2, 4)}-${cleaned.slice(4, 6)}`;
  }
  return raw;
}

/**
 * Get a human-readable description for an adjustment group code.
 */
export function getAdjustmentGroupDescription(code: string): string {
  return ADJUSTMENT_GROUP_CODES[code] || code;
}

/**
 * Get a human-readable description for an adjustment reason code.
 */
export function getReasonCodeDescription(code: string): string {
  return COMMON_REASON_CODES[code] || `Reason code ${code}`;
}

/**
 * Flatten a parsed 835 into line items suitable for database insertion.
 * Each service line within each claim becomes one line item.
 * If a claim has no service lines, the claim itself becomes a line item.
 */
export function flattenToLineItems(parsed: Parsed835): Array<{
  patientName: string;
  memberId: string | null;
  serviceDate: string | null;
  cptCode: string | null;
  chargedAmount: number;
  allowedAmount: number | null;
  paidAmount: number;
  adjustmentAmount: number;
  adjustmentReasonCodes: Array<{ code: string; description: string }>;
  remarkCodes: Array<{ code: string; description: string }>;
}> {
  const items: Array<{
    patientName: string;
    memberId: string | null;
    serviceDate: string | null;
    cptCode: string | null;
    chargedAmount: number;
    allowedAmount: number | null;
    paidAmount: number;
    adjustmentAmount: number;
    adjustmentReasonCodes: Array<{ code: string; description: string }>;
    remarkCodes: Array<{ code: string; description: string }>;
  }> = [];

  for (const claim of parsed.claims) {
    if (claim.serviceLines.length > 0) {
      for (const svc of claim.serviceLines) {
        const allAdj = [...claim.adjustments, ...svc.adjustments];
        const adjAmount = allAdj.reduce((sum, a) => sum + a.amount, 0);
        const adjCodes = allAdj.map(a => ({
          code: `${a.groupCode}-${a.reasonCode}`,
          description: `${getAdjustmentGroupDescription(a.groupCode)}: ${getReasonCodeDescription(a.reasonCode)}`,
        }));
        const rmkCodes = svc.remarkCodes.map(code => ({
          code,
          description: code,
        }));

        items.push({
          patientName: claim.patientName || claim.patientControlNumber,
          memberId: claim.memberId || null,
          serviceDate: svc.serviceDate || null,
          cptCode: svc.procedureCode || null,
          chargedAmount: svc.chargedAmount,
          allowedAmount: svc.allowedAmount ?? null,
          paidAmount: svc.paidAmount,
          adjustmentAmount: adjAmount,
          adjustmentReasonCodes: adjCodes,
          remarkCodes: rmkCodes,
        });
      }
    } else {
      // Claim-level only (no service lines)
      const adjAmount = claim.adjustments.reduce((sum, a) => sum + a.amount, 0);
      const adjCodes = claim.adjustments.map(a => ({
        code: `${a.groupCode}-${a.reasonCode}`,
        description: `${getAdjustmentGroupDescription(a.groupCode)}: ${getReasonCodeDescription(a.reasonCode)}`,
      }));

      items.push({
        patientName: claim.patientName || claim.patientControlNumber,
        memberId: claim.memberId || null,
        serviceDate: null,
        cptCode: null,
        chargedAmount: claim.chargedAmount,
        allowedAmount: null,
        paidAmount: claim.paidAmount,
        adjustmentAmount: adjAmount,
        adjustmentReasonCodes: adjCodes,
        remarkCodes: [],
      });
    }
  }

  return items;
}

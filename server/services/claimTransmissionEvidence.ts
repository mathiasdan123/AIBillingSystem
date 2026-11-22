/**
 * Was this claim ever sent to a payer? (#497 review, held claims.)
 *
 * The manual ERA match route refuses claims a payer cannot have adjudicated.
 * 'draft' and 'held' are not enough to decide that: the submit route puts a
 * SENT-but-unconfirmed claim on hold ("DO NOT RESUBMIT — a retry may file a
 * duplicate"), a clearinghouse rejection lands on hold with the attempt's
 * id, and a reopened draft was filed before it was reopened. An ERA is
 * exactly the evidence that resolves those. Only a claim with no trace of a
 * transmission — no submitted timestamp, no clearinghouse attempt, no
 * 'submitted' timeline event — is refused, and that refusal never says
 * "resubmit".
 */

export interface TransmissionEvidenceClaim {
  status?: string | null;
  submittedAt?: Date | string | null;
  clearinghouseSubmittedAt?: Date | string | null;
  clearinghouseClaimId?: string | null;
  clearinghouseStatus?: string | null;
}

export interface TransmissionEvidenceEvent {
  eventType?: string | null;
}

export interface TransmissionEvidence {
  transmitted: boolean;
  /** The first signal that proved it, for logs and messages. */
  signal: 'submitted_at' | 'clearinghouse_attempt' | 'submitted_event' | null;
}

export function transmissionEvidence(
  claim: TransmissionEvidenceClaim,
  events: TransmissionEvidenceEvent[] = [],
): TransmissionEvidence {
  if (claim.submittedAt) return { transmitted: true, signal: 'submitted_at' };
  if (claim.clearinghouseSubmittedAt || claim.clearinghouseClaimId) {
    return { transmitted: true, signal: 'clearinghouse_attempt' };
  }
  if (events.some((e) => e?.eventType === 'submitted')) return { transmitted: true, signal: 'submitted_event' };
  return { transmitted: false, signal: null };
}

/** Statuses that mean "not currently filed" and need evidence before an ERA may be matched. */
export function needsTransmissionEvidence(status: string | null | undefined): boolean {
  return status === 'draft' || status === 'held';
}

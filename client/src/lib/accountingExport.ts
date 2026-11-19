/**
 * Export builders for the Accounting page. Pure functions over the ledger
 * rows the page shows, so the CSV, QuickBooks IIF and tax summary contain
 * exactly the fields the API returns (they used to read `transactionDate`,
 * `paymentType` and `paymentMethod`, which never existed, and wrote
 * "undefined").
 */

export interface AccountingLedgerRow {
  id: string;
  source: "patient" | "insurance";
  date: string;
  amount: number;
  type: string;
  category: string | null;
  method: string | null;
  status: string;
  party: string;
  patientId: number | null;
  claimId: number | null;
  checkNumber: string | null;
}

export interface AccountingTotals {
  /** Net of completed refunds. */
  totalRevenue: number;
  insuranceRevenue: number;
  /** Net of completed refunds. */
  patientRevenue: number;
  pendingPayments: number;
  /** Completed refunds in the period (already subtracted from the figures above). */
  totalRefunded: number;
}

const csvCell = (value: unknown): string => {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
};

export const labelMethod = (method: string | null): string => {
  if (!method) return "";
  if (method === "era") return "ERA / EFT";
  return method.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
};

export function buildPaymentsCsv(rows: AccountingLedgerRow[]): string {
  const headers = ["Date", "Source", "Patient / Payer", "Amount", "Type", "Category", "Method", "Status", "Claim", "Check #"];
  const lines = rows.map((r) =>
    [
      r.date,
      r.source,
      r.party,
      r.amount.toFixed(2),
      r.type,
      r.category ?? "",
      labelMethod(r.method),
      r.status,
      r.claimId ?? "",
      r.checkNumber ?? "",
    ].map(csvCell).join(","),
  );
  return [headers.map(csvCell).join(","), ...lines].join("\n");
}

/** QuickBooks IIF deposits for completed payments; refunds post as negative deposits. */
export function buildQuickBooksIif(rows: AccountingLedgerRow[]): string {
  const header =
    "!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n" +
    "!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n" +
    "!ENDTRNS\n";
  const body = rows
    .filter((r) => r.status === "completed" && (r.type === "payment" || r.type === "refund"))
    .map((r) => {
      const date = r.date.replace(/-/g, "/");
      const signed = r.type === "refund" ? -r.amount : r.amount;
      const amount = signed.toFixed(2);
      const memo = r.source === "insurance" ? `insurance payment${r.checkNumber ? ` check ${r.checkNumber}` : ""}` : `${r.category ?? "patient"} ${r.type}`;
      return (
        `TRNS\tDEPOSIT\t${date}\tChecking\t${r.party}\t${amount}\t${memo}\n` +
        `SPL\tDEPOSIT\t${date}\tTherapy Revenue\t${r.party}\t${(-signed).toFixed(2)}\t${memo}\n` +
        "ENDTRNS"
      );
    })
    .join("\n");
  return header + body;
}

export function buildTaxSummary(
  period: { start: string; end: string },
  totals: AccountingTotals,
  rows: AccountingLedgerRow[],
  generatedOn: string = new Date().toISOString().split("T")[0],
): string {
  const patientRows = rows.filter((r) => r.source === "patient");
  return `TAX SUMMARY REPORT
Period: ${period.start} to ${period.end}
Generated: ${generatedOn}

REVENUE SUMMARY (net of refunds)
================================
Total Revenue: $${totals.totalRevenue.toFixed(2)}
  - Insurance Payments (posted ERA / manual postings): $${totals.insuranceRevenue.toFixed(2)}
  - Patient Payments (copays, balances, self-pay): $${totals.patientRevenue.toFixed(2)}
    (after $${totals.totalRefunded.toFixed(2)} refunded to patients)

Pending Patient Payments: $${totals.pendingPayments.toFixed(2)}

TRANSACTION COUNT
=================
Insurance postings: ${rows.length - patientRows.length}
Patient payments: ${patientRows.length}
  Completed: ${patientRows.filter((r) => r.status === "completed").length}
  Pending: ${patientRows.filter((r) => r.status === "pending").length}
  Failed / refunded / voided: ${patientRows.filter((r) => ["failed", "refunded", "voided"].includes(r.status)).length}

---
This report is for informational purposes only.
Consult with a tax professional for tax filing.`;
}

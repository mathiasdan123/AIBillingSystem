/**
 * InvoicePrintView - Professional invoice / patient statement print layout
 *
 * Renders a print-ready invoice with:
 * - Practice header (name, address, NPI, Tax ID)
 * - Patient info (name, DOB, insurance)
 * - Service lines (date, CPT, description, units, charges)
 * - Payment summary (billed, paid, adjustments, patient responsibility)
 * - Balance due and payment terms
 */

interface InvoiceLineItem {
  serviceDate?: string | null;
  cptCode?: string | null;
  description: string;
  units?: number;
  chargeAmount: string;
  insurancePaid: string;
  adjustments: string;
  patientResponsibility: string;
}

interface InvoicePrintViewProps {
  statementNumber: string;
  statementDate: string;
  dueDate?: string | null;
  patientName: string;
  patientDob?: string;
  patientAddress?: string;
  insuranceName?: string;
  insuranceId?: string;
  lineItems: InvoiceLineItem[];
  totalAmount: string;
  paidAmount: string;
  balanceDue: string;
  paymentTerms?: string;
}

export default function InvoicePrintView({
  statementNumber,
  statementDate,
  dueDate,
  patientName,
  patientDob,
  patientAddress,
  insuranceName,
  insuranceId,
  lineItems,
  totalAmount,
  paidAmount,
  balanceDue,
  paymentTerms = "Payment due within 30 days of statement date.",
}: InvoicePrintViewProps) {
  const fmt = (v: string | number) =>
    "$" + parseFloat(String(v || "0")).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const totalCharges = lineItems.reduce((s, li) => s + parseFloat(li.chargeAmount || "0"), 0);
  const totalInsurance = lineItems.reduce((s, li) => s + parseFloat(li.insurancePaid || "0"), 0);
  const totalAdj = lineItems.reduce((s, li) => s + parseFloat(li.adjustments || "0"), 0);
  const totalPatientResp = lineItems.reduce((s, li) => s + parseFloat(li.patientResponsibility || "0"), 0);

  return (
    <div>
      {/* Patient & Statement Info */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
        <div>
          <h3 style={{ fontSize: "10pt", fontWeight: 600, color: "#374151", margin: "0 0 4px 0" }}>Bill To:</h3>
          <p style={{ fontSize: "10pt", margin: "0 0 2px 0", fontWeight: 600 }}>{patientName}</p>
          {patientDob && <p style={{ fontSize: "9pt", color: "#4b5563", margin: "0 0 2px 0" }}>DOB: {patientDob}</p>}
          {patientAddress && <p style={{ fontSize: "9pt", color: "#4b5563", margin: 0 }}>{patientAddress}</p>}
        </div>
        <div style={{ textAlign: "right" }}>
          <table style={{ fontSize: "9pt", borderCollapse: "collapse", marginLeft: "auto" }}>
            <tbody>
              <tr>
                <td style={{ padding: "2px 8px", color: "#6b7280", textAlign: "right" }}>Statement #:</td>
                <td style={{ padding: "2px 0", fontWeight: 600 }}>{statementNumber}</td>
              </tr>
              <tr>
                <td style={{ padding: "2px 8px", color: "#6b7280", textAlign: "right" }}>Date:</td>
                <td style={{ padding: "2px 0" }}>{new Date(statementDate).toLocaleDateString()}</td>
              </tr>
              {dueDate && (
                <tr>
                  <td style={{ padding: "2px 8px", color: "#6b7280", textAlign: "right" }}>Due Date:</td>
                  <td style={{ padding: "2px 0", fontWeight: 600, color: "#dc2626" }}>
                    {new Date(dueDate).toLocaleDateString()}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Insurance Info */}
      {insuranceName && (
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "4px", padding: "8px 12px", marginBottom: "16px", fontSize: "9pt" }}>
          <span style={{ color: "#6b7280" }}>Insurance: </span>
          <span style={{ fontWeight: 600 }}>{insuranceName}</span>
          {insuranceId && <span style={{ color: "#6b7280" }}> (ID: {insuranceId})</span>}
        </div>
      )}

      {/* Service Lines Table */}
      <table className="print-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "9pt", marginBottom: "16px" }}>
        <thead>
          <tr style={{ background: "#f3f4f6" }}>
            <th style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>Date</th>
            <th style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>CPT</th>
            <th style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>Description</th>
            <th style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "center", fontWeight: 600 }}>Units</th>
            <th style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>Charges</th>
            <th style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>Ins. Paid</th>
            <th style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>Adjust.</th>
            <th style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>Patient Resp.</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((li, idx) => (
            <tr key={idx} style={{ background: idx % 2 === 0 ? "#fff" : "#f9fafb" }}>
              <td style={{ border: "1px solid #d1d5db", padding: "4px 8px" }}>
                {li.serviceDate ? new Date(li.serviceDate).toLocaleDateString() : "-"}
              </td>
              <td style={{ border: "1px solid #d1d5db", padding: "4px 8px" }}>{li.cptCode || "-"}</td>
              <td style={{ border: "1px solid #d1d5db", padding: "4px 8px" }}>{li.description}</td>
              <td style={{ border: "1px solid #d1d5db", padding: "4px 8px", textAlign: "center" }}>{li.units || 1}</td>
              <td style={{ border: "1px solid #d1d5db", padding: "4px 8px", textAlign: "right" }}>{fmt(li.chargeAmount)}</td>
              <td style={{ border: "1px solid #d1d5db", padding: "4px 8px", textAlign: "right" }}>{fmt(li.insurancePaid)}</td>
              <td style={{ border: "1px solid #d1d5db", padding: "4px 8px", textAlign: "right" }}>{fmt(li.adjustments)}</td>
              <td style={{ border: "1px solid #d1d5db", padding: "4px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(li.patientResponsibility)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: "#f3f4f6", fontWeight: 600 }}>
            <td colSpan={4} style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "right" }}>Totals:</td>
            <td style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "right" }}>{fmt(totalCharges)}</td>
            <td style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "right" }}>{fmt(totalInsurance)}</td>
            <td style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "right" }}>{fmt(totalAdj)}</td>
            <td style={{ border: "1px solid #d1d5db", padding: "6px 8px", textAlign: "right" }}>{fmt(totalPatientResp)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Payment Summary Box */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
        <div style={{ border: "2px solid #1e40af", borderRadius: "6px", padding: "12px 20px", minWidth: "260px" }}>
          <table style={{ width: "100%", fontSize: "10pt", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ padding: "3px 0", color: "#4b5563" }}>Total Billed:</td>
                <td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(totalAmount)}</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 0", color: "#4b5563" }}>Insurance Paid:</td>
                <td style={{ padding: "3px 0", textAlign: "right", color: "#16a34a" }}>{fmt(totalInsurance)}</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 0", color: "#4b5563" }}>Adjustments:</td>
                <td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(totalAdj)}</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 0", color: "#4b5563" }}>Payments Applied:</td>
                <td style={{ padding: "3px 0", textAlign: "right", color: "#16a34a" }}>{fmt(paidAmount)}</td>
              </tr>
              <tr style={{ borderTop: "2px solid #1e40af" }}>
                <td style={{ padding: "6px 0 0 0", fontSize: "12pt", fontWeight: 700, color: "#1e3a5f" }}>Balance Due:</td>
                <td style={{ padding: "6px 0 0 0", textAlign: "right", fontSize: "12pt", fontWeight: 700, color: "#dc2626" }}>
                  {fmt(balanceDue)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Terms */}
      <div style={{ background: "#eff6ff", border: "1px solid #dbeafe", borderRadius: "4px", padding: "8px 12px", fontSize: "8pt", color: "#1e40af" }}>
        {paymentTerms}
      </div>
    </div>
  );
}

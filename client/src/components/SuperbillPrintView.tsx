/**
 * SuperbillPrintView - CMS-1500 style superbill for treatment sessions/claims
 *
 * Includes:
 * - Provider info (name, NPI, Tax ID)
 * - Patient demographics
 * - Diagnosis codes (ICD-10)
 * - CPT codes with modifiers
 * - Referring provider
 * - Authorization number
 */

interface SuperbillLineItem {
  cptCode: string;
  modifier?: string | null;
  description: string;
  units: number;
  chargeAmount: string;
  icd10Pointer?: string;
}

interface SuperbillPrintViewProps {
  claimNumber: string;
  serviceDate: string;
  // Provider
  providerName: string;
  providerNpi?: string;
  providerCredentials?: string;
  // Patient
  patientName: string;
  patientDob?: string;
  patientGender?: string;
  patientAddress?: string;
  patientPhone?: string;
  patientInsuranceId?: string;
  // Insurance
  insuranceName?: string;
  insurancePlanName?: string;
  groupNumber?: string;
  memberId?: string;
  // Clinical
  diagnosisCodes: Array<{ code: string; description: string }>;
  lineItems: SuperbillLineItem[];
  // Referral
  referringProvider?: string;
  referringProviderNpi?: string;
  authorizationNumber?: string;
  // Totals
  totalAmount: string;
}

export default function SuperbillPrintView({
  claimNumber,
  serviceDate,
  providerName,
  providerNpi,
  providerCredentials,
  patientName,
  patientDob,
  patientGender,
  patientAddress,
  patientPhone,
  patientInsuranceId,
  insuranceName,
  insurancePlanName,
  groupNumber,
  memberId,
  diagnosisCodes,
  lineItems,
  referringProvider,
  referringProviderNpi,
  authorizationNumber,
  totalAmount,
}: SuperbillPrintViewProps) {
  const fmt = (v: string | number) =>
    "$" + parseFloat(String(v || "0")).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const cellStyle = { border: "1px solid #d1d5db", padding: "4px 8px", fontSize: "9pt" };
  const headerCellStyle = { ...cellStyle, background: "#f3f4f6", fontWeight: 600 as const };
  const labelStyle = { fontSize: "7pt", color: "#6b7280", textTransform: "uppercase" as const, marginBottom: "2px" };
  const valueStyle = { fontSize: "9pt", fontWeight: 600 as const };

  return (
    <div>
      {/* CMS-1500 Header */}
      <div style={{ textAlign: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "8pt", color: "#6b7280", letterSpacing: "2px", textTransform: "uppercase" }}>
          HEALTH INSURANCE CLAIM FORM (Reference: CMS-1500)
        </span>
      </div>

      {/* Two-column: Patient Info / Insurance Info */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
        {/* Patient Information */}
        <div style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: "4px", padding: "8px" }}>
          <div style={{ fontSize: "8pt", fontWeight: 700, color: "#1e40af", borderBottom: "1px solid #dbeafe", paddingBottom: "4px", marginBottom: "6px" }}>
            PATIENT INFORMATION
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            <div>
              <div style={labelStyle}>Patient Name</div>
              <div style={valueStyle}>{patientName}</div>
            </div>
            <div>
              <div style={labelStyle}>Date of Birth</div>
              <div style={valueStyle}>{patientDob || "-"}</div>
            </div>
            <div>
              <div style={labelStyle}>Gender</div>
              <div style={valueStyle}>{patientGender || "-"}</div>
            </div>
            <div>
              <div style={labelStyle}>Phone</div>
              <div style={valueStyle}>{patientPhone || "-"}</div>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={labelStyle}>Address</div>
              <div style={valueStyle}>{patientAddress || "-"}</div>
            </div>
            <div>
              <div style={labelStyle}>Insurance ID</div>
              <div style={valueStyle}>{patientInsuranceId || memberId || "-"}</div>
            </div>
          </div>
        </div>

        {/* Insurance Information */}
        <div style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: "4px", padding: "8px" }}>
          <div style={{ fontSize: "8pt", fontWeight: 700, color: "#1e40af", borderBottom: "1px solid #dbeafe", paddingBottom: "4px", marginBottom: "6px" }}>
            INSURANCE INFORMATION
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={labelStyle}>Insurance/Plan</div>
              <div style={valueStyle}>{insuranceName || "-"}</div>
            </div>
            {insurancePlanName && (
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={labelStyle}>Plan Name</div>
                <div style={valueStyle}>{insurancePlanName}</div>
              </div>
            )}
            <div>
              <div style={labelStyle}>Group Number</div>
              <div style={valueStyle}>{groupNumber || "-"}</div>
            </div>
            <div>
              <div style={labelStyle}>Member ID</div>
              <div style={valueStyle}>{memberId || "-"}</div>
            </div>
            <div>
              <div style={labelStyle}>Claim Number</div>
              <div style={valueStyle}>{claimNumber}</div>
            </div>
            <div>
              <div style={labelStyle}>Date of Service</div>
              <div style={valueStyle}>{new Date(serviceDate).toLocaleDateString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Provider & Authorization */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
        <div style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: "4px", padding: "8px" }}>
          <div style={{ fontSize: "8pt", fontWeight: 700, color: "#1e40af", borderBottom: "1px solid #dbeafe", paddingBottom: "4px", marginBottom: "6px" }}>
            RENDERING PROVIDER
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            <div>
              <div style={labelStyle}>Provider Name</div>
              <div style={valueStyle}>{providerName}{providerCredentials ? `, ${providerCredentials}` : ""}</div>
            </div>
            <div>
              <div style={labelStyle}>NPI</div>
              <div style={valueStyle}>{providerNpi || "-"}</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: "4px", padding: "8px" }}>
          <div style={{ fontSize: "8pt", fontWeight: 700, color: "#1e40af", borderBottom: "1px solid #dbeafe", paddingBottom: "4px", marginBottom: "6px" }}>
            REFERRAL / AUTHORIZATION
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            <div>
              <div style={labelStyle}>Referring Provider</div>
              <div style={valueStyle}>{referringProvider || "-"}</div>
            </div>
            <div>
              <div style={labelStyle}>Referring NPI</div>
              <div style={valueStyle}>{referringProviderNpi || "-"}</div>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={labelStyle}>Prior Auth Number</div>
              <div style={valueStyle}>{authorizationNumber || "-"}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Diagnosis Codes */}
      <div style={{ border: "1px solid #d1d5db", borderRadius: "4px", padding: "8px", marginBottom: "12px" }}>
        <div style={{ fontSize: "8pt", fontWeight: 700, color: "#1e40af", borderBottom: "1px solid #dbeafe", paddingBottom: "4px", marginBottom: "6px" }}>
          DIAGNOSIS CODES (ICD-10-CM)
        </div>
        {diagnosisCodes.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {diagnosisCodes.map((dx, i) => (
              <div
                key={i}
                style={{
                  background: "#eff6ff",
                  border: "1px solid #dbeafe",
                  borderRadius: "4px",
                  padding: "4px 8px",
                  fontSize: "9pt",
                }}
              >
                <span style={{ fontWeight: 700, color: "#1e40af" }}>{String.fromCharCode(65 + i)}. </span>
                <span style={{ fontWeight: 600 }}>{dx.code}</span>
                <span style={{ color: "#4b5563" }}> - {dx.description}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: "9pt", color: "#6b7280", margin: 0 }}>No diagnosis codes recorded</p>
        )}
      </div>

      {/* Service Lines Table */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px" }}>
        <thead>
          <tr>
            <th style={headerCellStyle}>CPT Code</th>
            <th style={headerCellStyle}>Modifier</th>
            <th style={{ ...headerCellStyle, textAlign: "left" }}>Description</th>
            <th style={{ ...headerCellStyle, textAlign: "center" }}>Dx Ptr</th>
            <th style={{ ...headerCellStyle, textAlign: "center" }}>Units</th>
            <th style={{ ...headerCellStyle, textAlign: "right" }}>Charges</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((li, idx) => (
            <tr key={idx} style={{ background: idx % 2 === 0 ? "#fff" : "#f9fafb" }}>
              <td style={{ ...cellStyle, fontWeight: 600 }}>{li.cptCode}</td>
              <td style={cellStyle}>{li.modifier || "-"}</td>
              <td style={cellStyle}>{li.description}</td>
              <td style={{ ...cellStyle, textAlign: "center" }}>{li.icd10Pointer || "A"}</td>
              <td style={{ ...cellStyle, textAlign: "center" }}>{li.units}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(li.chargeAmount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: "#f3f4f6" }}>
            <td colSpan={5} style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>Total Charges:</td>
            <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700, fontSize: "10pt" }}>{fmt(totalAmount)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Signature Line */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "32px", paddingTop: "8px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ borderBottom: "1px solid #000", width: "80%", marginBottom: "4px", minHeight: "24px" }} />
          <div style={{ fontSize: "8pt", color: "#6b7280" }}>Provider Signature</div>
        </div>
        <div style={{ width: "160px" }}>
          <div style={{ borderBottom: "1px solid #000", width: "100%", marginBottom: "4px", minHeight: "24px" }} />
          <div style={{ fontSize: "8pt", color: "#6b7280" }}>Date</div>
        </div>
      </div>
    </div>
  );
}

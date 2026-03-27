/**
 * PrintLayout - Reusable print layout component
 *
 * Renders content into a hidden div (#print-root) and triggers window.print().
 * The print CSS in index.css hides everything except #print-root during printing.
 *
 * Usage:
 *   <PrintLayout
 *     trigger={<Button>Print</Button>}
 *     title="Invoice"
 *     practiceName="ABC Therapy"
 *     practiceAddress="123 Main St"
 *     practiceNpi="1234567890"
 *     practiceTaxId="12-3456789"
 *   >
 *     {content to print}
 *   </PrintLayout>
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PrintLayoutProps {
  /** The button/element that triggers printing */
  trigger: ReactNode;
  /** Document title shown on print header */
  title: string;
  /** Practice header info */
  practiceName?: string;
  practiceAddress?: string;
  practicePhone?: string;
  practiceNpi?: string;
  practiceTaxId?: string;
  /** Optional date range subtitle */
  dateRange?: string;
  /** Content to render in the print layout */
  children: ReactNode;
}

export default function PrintLayout({
  trigger,
  title,
  practiceName = "Your Practice",
  practiceAddress,
  practicePhone,
  practiceNpi,
  practiceTaxId,
  dateRange,
  children,
}: PrintLayoutProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const printRootRef = useRef<HTMLDivElement | null>(null);

  const handlePrint = useCallback(() => {
    // Ensure the #print-root div exists
    let printRoot = document.getElementById("print-root") as HTMLDivElement | null;
    if (!printRoot) {
      printRoot = document.createElement("div");
      printRoot.id = "print-root";
      printRoot.style.display = "none";
      document.body.appendChild(printRoot);
    }
    printRootRef.current = printRoot;

    setIsPrinting(true);

    // Allow React to render the portal content, then trigger print
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        setIsPrinting(false);
      });
    });
  }, []);

  return (
    <>
      {/* The trigger element gets onClick attached */}
      <span onClick={handlePrint} className="inline-flex">
        {trigger}
      </span>

      {/* Portal: rendered into #print-root only when printing */}
      {isPrinting &&
        printRootRef.current &&
        createPortal(
          <div className="print-content" style={{ fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif" }}>
            {/* Practice Header */}
            <div style={{ borderBottom: "2px solid #1e40af", paddingBottom: "12px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h1 style={{ fontSize: "18pt", fontWeight: 700, color: "#1e3a5f", margin: 0 }}>
                    {practiceName}
                  </h1>
                  {practiceAddress && (
                    <p style={{ fontSize: "9pt", color: "#4b5563", margin: "2px 0 0 0" }}>{practiceAddress}</p>
                  )}
                  {practicePhone && (
                    <p style={{ fontSize: "9pt", color: "#4b5563", margin: "2px 0 0 0" }}>{practicePhone}</p>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <h2 style={{ fontSize: "14pt", fontWeight: 600, color: "#1e40af", margin: 0 }}>{title}</h2>
                  {dateRange && (
                    <p style={{ fontSize: "9pt", color: "#6b7280", margin: "2px 0 0 0" }}>{dateRange}</p>
                  )}
                  <p style={{ fontSize: "8pt", color: "#9ca3af", margin: "4px 0 0 0" }}>
                    Printed: {new Date().toLocaleDateString()}
                  </p>
                </div>
              </div>
              {(practiceNpi || practiceTaxId) && (
                <div style={{ display: "flex", gap: "24px", marginTop: "6px", fontSize: "8pt", color: "#6b7280" }}>
                  {practiceNpi && <span>NPI: {practiceNpi}</span>}
                  {practiceTaxId && <span>Tax ID: {practiceTaxId}</span>}
                </div>
              )}
            </div>

            {/* Print Body */}
            {children}

            {/* Footer */}
            <div
              style={{
                borderTop: "1px solid #d1d5db",
                marginTop: "24px",
                paddingTop: "8px",
                fontSize: "7pt",
                color: "#9ca3af",
                textAlign: "center",
              }}
            >
              {practiceName} — {title} — Generated {new Date().toLocaleString()}
            </div>
          </div>,
          printRootRef.current,
        )}
    </>
  );
}

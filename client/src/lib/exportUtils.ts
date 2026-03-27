/**
 * Client-side export utilities for CSV and print-based PDF generation.
 */

/**
 * Export an array of objects as a CSV file download.
 */
export function exportToCsv(filename: string, rows: Record<string, unknown>[], columns?: string[]): void {
  if (!rows || rows.length === 0) return;

  const cols = columns || Object.keys(rows[0]);

  // Header row
  const header = cols.map(c => `"${formatColumnHeader(c)}"`).join(",");

  // Data rows
  const dataRows = rows.map(row =>
    cols.map(col => {
      const value = row[col];
      if (value === null || value === undefined) return '""';
      const str = String(value).replace(/"/g, '""');
      return `"${str}"`;
    }).join(",")
  );

  const csv = [header, ...dataRows].join("\n");
  downloadFile(filename, csv, "text/csv;charset=utf-8;");
}

/**
 * Convert a camelCase or snake_case column name to a human-readable header.
 */
function formatColumnHeader(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}

/**
 * Trigger a file download in the browser.
 */
function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

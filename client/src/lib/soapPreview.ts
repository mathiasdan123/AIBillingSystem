// Extract the in-progress SOAP narrative from a partial JSON stream so the
// user sees the note materialize section-by-section while Claude writes it.
// The streamed text is raw JSON (the model emits keys in subjective→objective→
// assessment→plan order), so we pull each section's string value — including
// the final, still-unterminated one — and unescape it for display.
export function extractSoapPreview(raw: string): string {
  // The model sometimes wraps the JSON in a ```json code fence despite the
  // prompt. Drop a leading fence so the preview is never polluted by it. (The
  // per-section regex below already skips it, but this makes the intent explicit
  // and keeps the preview clean for any future rendering changes.)
  raw = raw.replace(/^\s*```(?:json)?\s*/i, "");
  const sections: Array<[label: string, key: string]> = [
    ["Subjective", "subjective"],
    ["Objective", "objective"],
    ["Assessment", "assessment"],
    ["Plan", "plan"],
  ];
  const parts: string[] = [];
  for (const [label, key] of sections) {
    // "key" : "value...  (value may be unterminated as it's still streaming)
    const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
    const value = m?.[1];
    if (value) {
      const text = value
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, " ")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
      parts.push(`${label}\n${text}`);
    }
  }
  return parts.join("\n\n");
}

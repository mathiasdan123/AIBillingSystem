import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Regression guard (therapybill-qa #2): quick-add patient flows used to send a
 * fabricated date of birth ("2000-01-01") so the server would accept the row.
 * That invented value was then persisted as real patient data and fed every
 * downstream age computation (the SOAP prompt would state "Age: 26 years").
 *
 * The server accepts a missing or null dateOfBirth (createPatientSchema), and
 * every renderer and prompt builder already handles a blank one. So no client
 * code may ever hardcode a birth date. This scans the client source for the
 * pattern instead of testing six UIs one by one.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("quick-add patient flows", () => {
  it("never send a hardcoded date of birth", () => {
    const root = join(__dirname, "..");
    const offenders = walk(root).filter((f) =>
      /dateOfBirth:\s*["'`]\d{4}-\d{2}-\d{2}["'`]/.test(readFileSync(f, "utf8")),
    );
    expect(offenders, `hardcoded dateOfBirth literal in: ${offenders.join(", ")}`).toEqual([]);
  });
});

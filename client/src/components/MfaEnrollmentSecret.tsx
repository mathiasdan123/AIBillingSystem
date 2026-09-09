import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

/**
 * The "add this account to your authenticator" step of MFA enrollment.
 * Renders a real scannable QR (for users viewing on a computer) and the bare
 * base32 secret with a copy button (for users on a phone, who can't scan
 * their own screen — Google Authenticator's "Enter a setup key" flow).
 *
 * Never suggest pasting the otpauth URI into an external QR generator: the
 * URI contains the TOTP secret, and shipping it to a third-party site leaks
 * the second factor.
 */
export function extractTotpSecret(uri: string): string | null {
  const match = /[?&]secret=([A-Z2-7]+)/i.exec(uri);
  return match ? match[1] : null;
}

export default function MfaEnrollmentSecret({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);
  const secret = extractTotpSecret(uri);

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context); the
      // select-all styling below still lets the user copy by hand.
    }
  };

  return (
    <div className="space-y-3" data-testid="mfa-enrollment-secret">
      <div className="flex flex-col items-center gap-2">
        <div className="bg-white p-3 rounded-lg border" data-testid="mfa-qr-code">
          <QRCodeSVG value={uri} size={168} />
        </div>
        <p className="text-xs text-slate-600 text-center">
          Scan with your authenticator app (Google Authenticator, Authy, 1Password…)
        </p>
      </div>

      {secret && (
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">
            On your phone and can't scan? In your authenticator, choose{" "}
            <span className="whitespace-nowrap">"Enter a setup key"</span> and use:
          </p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 text-xs bg-slate-100 p-2 rounded break-all select-all"
              data-testid="mfa-manual-secret"
            >
              {secret}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copySecret} data-testid="button-copy-mfa-secret">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

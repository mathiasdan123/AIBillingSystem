import { Button } from "@/components/ui/button";
import { AlertTriangle, LogIn, RefreshCw } from "lucide-react";
import { isUnauthorizedError } from "@/lib/authUtils";
import { isMfaGateError } from "@/lib/queryClient";

interface Props {
  /** The error from useQuery. Render this component only when it is truthy. */
  error: unknown;
  /** What failed to load, lowercase — "patients", "claims", "appointments". */
  what: string;
  /** Optional retry (usually the query's refetch). */
  onRetry?: () => void;
}

/**
 * Renders a FAILED data load.
 *
 * This exists to keep one specific lie off the screen: an empty state where
 * the request actually failed. "You have no patients yet" and "we could not
 * load your patients" look nothing alike to a user — the first says their
 * data is gone — but they were indistinguishable in code whenever a query
 * returned no rows.
 *
 * Usage: render this INSTEAD of the empty state, and check it first.
 *
 *   if (error) return <QueryErrorState error={error} what="patients" onRetry={refetch} />;
 *   if (!rows.length) return <EmptyState … />;
 */
export function QueryErrorState({ error, what, onRetry }: Props) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // The MFA gate is checked FIRST: it is a 403, so the generic auth branch
  // would otherwise claim the session expired and send the user to a full
  // re-login — when one TOTP code away was the truth. On 2026-08-26 this
  // state rendered as a raw JSON string on Patients and as "Create your
  // first claim" on Claims; the user's own requirement: the notice must
  // carry a LINK to reauthenticate.
  const isMfaGate = isMfaGateError(message);
  const isAuth =
    !isMfaGate && (error instanceof Error ? isUnauthorizedError(error) : /^(401|403)/.test(message));

  return (
    <div
      className="flex flex-col items-center justify-center py-12 px-6 text-center"
      data-testid={`query-error-${what.replace(/\s+/g, "-")}`}
      role="alert"
    >
      <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
      <h3 className="text-lg font-semibold text-foreground mb-1">
        {isMfaGate ? "Verify your identity" : isAuth ? "Your session expired" : `Couldn't load ${what}`}
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mb-4">
        {isMfaGate
          ? `Your ${what} are safe. For security, this session needs a fresh verification code before showing them.`
          : isAuth
            ? `Your ${what} are safe — you just need to sign in again to see them.`
            : `Something went wrong loading your ${what}. This is a loading problem, not missing data.`}
      </p>
      <div className="flex gap-2">
        {isMfaGate ? (
          <Button onClick={() => window.location.assign("/mfa-challenge")} data-testid="button-mfa-challenge-link">
            <LogIn className="w-4 h-4 mr-2" />
            Enter verification code
          </Button>
        ) : isAuth ? (
          <Button onClick={() => window.location.assign("/api/login")}>
            <LogIn className="w-4 h-4 mr-2" />
            Sign in again
          </Button>
        ) : (
          onRetry && (
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Try again
            </Button>
          )
        )}
      </div>
      {!isAuth && message && (
        <p className="text-xs text-muted-foreground/70 mt-4 font-mono max-w-md truncate">{message}</p>
      )}
    </div>
  );
}

export default QueryErrorState;

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { CheckCircle2, Circle, AlertTriangle, ArrowRight, Landmark } from "lucide-react";

interface ProviderProfileResponse {
  enrollmentAuthorizedAt: string | null;
  stediProviderId: string | null;
  readiness: { complete: boolean; missing: string[] };
}

interface PayerEnrollmentRow {
  name: string;
  payerId: string;
  enrollments: Array<{
    transactionType: "eligibility" | "claims" | "era";
    status: "not_enrolled" | "pending" | "enrolled" | "rejected";
    requiresEnrollment: boolean;
  }>;
}

/**
 * "Insurance billing setup" checklist — the guided path from a brand-new
 * practice to being able to bill payers and auto-receive payment reports.
 * Renders on the dashboard for admin/billing users until every step is done,
 * then disappears. The Stedi provider record step is automated (created the
 * moment profile + authorization are complete); the card surfaces its status
 * and a retry path if the automatic attempt failed.
 */
export default function BillingSetupChecklist() {
  const { isAuthenticated, hasFinancialAccess } = useAuth();

  const { data: profile } = useQuery<ProviderProfileResponse>({
    queryKey: ["/api/provider-profile"],
    enabled: isAuthenticated && hasFinancialAccess,
    retry: false,
  });

  const { data: payers } = useQuery<PayerEnrollmentRow[]>({
    queryKey: ["/api/payer-enrollments"],
    enabled: isAuthenticated && hasFinancialAccess,
    retry: false,
  });

  if (!hasFinancialAccess || !profile) return null;

  const profileDone = profile.readiness?.complete === true;
  const authorized = !!profile.enrollmentAuthorizedAt;
  const providerLinked = !!profile.stediProviderId;

  const eraStats = (payers ?? []).reduce(
    (acc, p) => {
      for (const e of p.enrollments) {
        if (e.transactionType !== "era" || !e.requiresEnrollment) continue;
        if (e.status === "enrolled") acc.live++;
        else if (e.status === "pending") acc.pending++;
      }
      return acc;
    },
    { live: 0, pending: 0 },
  );
  const eraStarted = eraStats.live + eraStats.pending > 0;

  // All done — the practice can bill and auto-receive ERAs; stay out of the way.
  if (profileDone && authorized && providerLinked && eraStarted) return null;

  // Provider-record creation is automatic; it only needs attention when its
  // prerequisites are met but the record still doesn't exist (failed attempt).
  const providerNeedsAttention = profileDone && authorized && !providerLinked;

  const steps: Array<{
    key: string;
    label: string;
    detail: string;
    done: boolean;
    attention?: boolean;
    href: string;
  }> = [
    {
      key: "profile",
      label: "Complete your billing identity",
      detail: profileDone
        ? "Legal name, NPI, Tax ID and billing contact on file"
        : `${profile.readiness?.missing?.length ?? 0} field${(profile.readiness?.missing?.length ?? 0) === 1 ? "" : "s"} still needed (NPI, Tax ID, address…)`,
      done: profileDone,
      href: "/provider-profile",
    },
    {
      key: "authorize",
      label: "Authorize enrollment submissions",
      detail: authorized
        ? "Authorization signed"
        : "One signature lets us submit payer enrollments for you",
      done: authorized,
      href: "/provider-profile",
    },
    {
      key: "provider",
      label: "Clearinghouse provider record",
      detail: providerLinked
        ? "Linked"
        : providerNeedsAttention
          ? "Automatic setup didn't complete — open your provider profile to retry"
          : "Created automatically once the steps above are done",
      done: providerLinked,
      attention: providerNeedsAttention,
      href: "/provider-profile",
    },
    {
      key: "era",
      label: "Enroll for electronic payment reports (ERA)",
      detail: eraStarted
        ? `${eraStats.live} live, ${eraStats.pending} pending`
        : "One click per payer — payments then post automatically",
      done: eraStarted,
      href: "/payer-enrollments",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card data-testid="billing-setup-checklist" className="mt-4 md:mt-6 border-blue-200 dark:border-blue-900">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="w-4 h-4 text-blue-600" />
          Insurance billing setup
          <span className="ml-auto text-sm font-normal text-muted-foreground">
            {doneCount}/{steps.length} done
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {steps.map((step) => (
          <Link key={step.key} href={step.href}>
            <div className="flex items-start gap-3 rounded-md p-2 hover:bg-muted transition-colors cursor-pointer">
              {step.done ? (
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              ) : step.attention ? (
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
              )}
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-medium ${step.done ? "text-muted-foreground line-through decoration-1" : ""}`}>
                  {step.label}
                </span>
                <span className="block text-xs text-muted-foreground">{step.detail}</span>
              </span>
              {!step.done && <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />}
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

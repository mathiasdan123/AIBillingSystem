import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ClipboardList,
  FilePlus,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  CreditCard,
  RefreshCw,
  DollarSign,
  Copy,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface BillingStep {
  number: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  details: string[];
  blancheCapability: string;
  blanchePrompt?: string;
  color: "green" | "blue";
  branches?: {
    icon: React.ReactNode;
    label: string;
    description: string;
    colorClass: string;
  }[];
}

const BILLING_STEPS: BillingStep[] = [
  {
    number: 1,
    title: "Document the Session",
    description:
      "After each therapy session, clinical documentation captures what happened and why it matters.",
    icon: <ClipboardList className="w-6 h-6" />,
    details: [
      "Write or generate a SOAP note (Subjective, Objective, Assessment, Plan)",
      "AI suggests CPT codes based on your documentation",
      "Record session duration, interventions, and progress toward goals",
    ],
    blancheCapability:
      "Blanche can generate a complete SOAP note from session details and suggest the most accurate CPT codes.",
    blanchePrompt:
      "Generate a SOAP note for a 53-minute individual therapy session focusing on anxiety management with CBT techniques",
    color: "green",
  },
  {
    number: 2,
    title: "Create the Claim",
    description:
      "A claim is the formal request sent to insurance for reimbursement. It combines patient info, diagnosis codes, and procedure codes.",
    icon: <FilePlus className="w-6 h-6" />,
    details: [
      "Draft a claim directly from your SOAP note",
      "Review CPT codes, units, and billed amounts",
      "Verify patient demographics and insurance details are correct",
      "Add ICD-10 diagnosis codes that support medical necessity",
    ],
    blancheCapability:
      "Blanche reviews claims for accuracy before submission and flags potential issues that could cause denials.",
    blanchePrompt:
      "Review my pending claims and check for any coding errors or missing information",
    color: "blue",
  },
  {
    number: 3,
    title: "Submit to Insurance",
    description:
      "Claims are transmitted electronically to the insurance payer through a clearinghouse using the 837P standard format.",
    icon: <Send className="w-6 h-6" />,
    details: [
      "Electronic submission via clearinghouse (837P format)",
      "Claim status changes from Draft to Submitted",
      "Clearinghouse validates formatting before forwarding to payer",
      "Confirmation of receipt typically within 24 hours",
    ],
    blancheCapability:
      "Blanche can submit claims directly and predicts denial risk before you send, so you can fix issues upfront.",
    blanchePrompt: "Submit claim #1234 to insurance and check denial risk first",
    color: "green",
  },
  {
    number: 4,
    title: "Track & Wait",
    description:
      "Insurance payers typically take 5 to 30 days to process a claim. During this time, automated status checks keep you informed.",
    icon: <Clock className="w-6 h-6" />,
    details: [
      "Automated status checking via 276/277 transactions",
      "Processing typically takes 5-30 business days",
      "Overdue claims (30+ days) are automatically flagged",
      "Dashboard shows real-time claim pipeline status",
    ],
    blancheCapability:
      "Blanche monitors your claims, flags anything overdue, and can check claim status on demand.",
    blanchePrompt: "Show me all overdue claims and their current status",
    color: "green",
  },
  {
    number: 5,
    title: "Insurance Responds",
    description:
      "The payer sends back a decision. This is the moment of truth -- your claim is either paid, denied, or partially paid.",
    icon: <CheckCircle className="w-6 h-6" />,
    details: [
      "Response arrives as an ERA (Electronic Remittance Advice)",
      "Payment is automatically matched to the original claim",
      "Adjustment reason codes explain any differences from billed amount",
    ],
    blancheCapability:
      "Blanche reads ERA responses, categorizes outcomes, and immediately flags denials or underpayments for review.",
    blanchePrompt: "Show me recent ERA payments and flag any denials",
    color: "blue",
    branches: [
      {
        icon: <CheckCircle className="w-5 h-5" />,
        label: "PAID",
        description:
          "Full payment received. ERA auto-matched, payment posted to patient account.",
        colorClass: "bg-green-50 border-green-200 text-green-800",
      },
      {
        icon: <XCircle className="w-5 h-5" />,
        label: "DENIED",
        description:
          "Claim rejected. Blanche reviews the denial reason, suggests corrections, and can draft an appeal letter.",
        colorClass: "bg-red-50 border-red-200 text-red-800",
      },
      {
        icon: <AlertTriangle className="w-5 h-5" />,
        label: "PARTIAL",
        description:
          "Underpayment detected. Review adjustment codes, determine if a dispute is warranted.",
        colorClass: "bg-amber-50 border-amber-200 text-amber-800",
      },
    ],
  },
  {
    number: 6,
    title: "Patient Billing",
    description:
      "After insurance pays its portion, any remaining balance is the patient's responsibility.",
    icon: <CreditCard className="w-6 h-6" />,
    details: [
      "Calculate copay, coinsurance, and deductible amounts",
      "Generate a patient statement with clear line items",
      "Statement visible in the Patient Portal for easy access",
      "Secure online payment option via Stripe",
    ],
    blancheCapability:
      "Blanche can create patient invoices and explain charges in plain language patients can understand.",
    blanchePrompt:
      "Create an invoice for patient Jane Smith for her remaining balance after insurance payment",
    color: "green",
  },
  {
    number: 7,
    title: "Follow Up",
    description:
      "Denied or underpaid claims need follow-up action. The faster you respond, the better your chances of recovery.",
    icon: <RefreshCw className="w-6 h-6" />,
    details: [
      "AI-generated appeal letters for denied claims",
      "Underpayment dispute preparation with supporting documentation",
      "Corrected claim resubmission with updated codes or information",
      "Track appeal outcomes and timelines",
    ],
    blancheCapability:
      "Blanche drafts appeal letters, identifies the best strategy for each denial type, and tracks resubmissions.",
    blanchePrompt:
      "Generate an appeal letter for denied claim #5678 with denial reason CO-197",
    color: "blue",
  },
  {
    number: 8,
    title: "Get Paid",
    description:
      "Revenue is reconciled, reports are generated, and you have a clear picture of your practice finances.",
    icon: <DollarSign className="w-6 h-6" />,
    details: [
      "Payment reconciliation across all payers",
      "Revenue reporting by month, payer, and service type",
      "Collection rate tracking and benchmarking",
      "Accounts receivable aging to spot slow payers",
    ],
    blancheCapability:
      "Blanche provides real-time financial analytics, collection rates, and identifies revenue opportunities.",
    blanchePrompt:
      "Show me my collection rate and revenue breakdown for the last 3 months",
    color: "green",
  },
];

function StepCard({ step }: { step: BillingStep }) {
  const { toast } = useToast();

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    toast({
      title: "Copied to clipboard",
      description: "Paste this prompt into the Blanche chat to try it out.",
    });
  };

  const isAutomated = step.color === "green";

  return (
    <div className="relative">
      {/* Timeline connector */}
      <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-slate-200 -z-10" />

      <div className="flex gap-4 sm:gap-6">
        {/* Step number circle */}
        <div
          className={`flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg ${
            isAutomated
              ? "bg-gradient-to-br from-green-500 to-green-600"
              : "bg-gradient-to-br from-blue-500 to-blue-600"
          }`}
        >
          {step.number}
        </div>

        {/* Content card */}
        <Card className="flex-1 mb-8 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4 sm:p-6">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div
                className={`p-2 rounded-lg ${
                  isAutomated
                    ? "bg-green-50 text-green-600"
                    : "bg-blue-50 text-blue-600"
                }`}
              >
                {step.icon}
              </div>
              <h3 className="text-lg font-semibold text-slate-900">
                {step.title}
              </h3>
              <Badge
                variant="outline"
                className={
                  isAutomated
                    ? "border-green-300 text-green-700 bg-green-50"
                    : "border-blue-300 text-blue-700 bg-blue-50"
                }
              >
                {isAutomated ? "Automated" : "Review Required"}
              </Badge>
            </div>

            {/* Description */}
            <p className="text-slate-600 mb-4">{step.description}</p>

            {/* Details list */}
            <ul className="space-y-2 mb-4">
              {step.details.map((detail, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-slate-700"
                >
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                  {detail}
                </li>
              ))}
            </ul>

            {/* Branches (for Step 5) */}
            {step.branches && (
              <div className="grid gap-3 mb-4 sm:grid-cols-3">
                {step.branches.map((branch, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 ${branch.colorClass}`}
                  >
                    <div className="flex items-center gap-2 font-semibold mb-1">
                      {branch.icon}
                      {branch.label}
                    </div>
                    <p className="text-xs leading-relaxed">
                      {branch.description}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Blanche capability callout */}
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-semibold text-slate-800">
                  What Blanche Can Do
                </span>
              </div>
              <p className="text-sm text-slate-600 mb-3">
                {step.blancheCapability}
              </p>
              {step.blanchePrompt && (
                <button
                  onClick={() => copyPrompt(step.blanchePrompt!)}
                  className="inline-flex items-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-3 py-1.5 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Try it: &ldquo;{step.blanchePrompt}&rdquo;
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function BillingGuide() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="mb-4 text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>

          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
            How Billing Works
          </h1>
          <p className="text-slate-600 max-w-2xl">
            The complete revenue cycle from therapy session to payment. Follow
            these 8 steps to understand how insurance billing works and how
            Blanche automates each stage.
          </p>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-slate-600">
                Automated by Blanche
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-slate-600">
                Requires your review
              </span>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="relative">
          {BILLING_STEPS.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}

          {/* End marker */}
          <div className="flex gap-4 sm:gap-6">
            <div className="flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-green-500 to-blue-500 text-white shadow-lg">
              <CheckCircle className="w-7 h-7" />
            </div>
            <div className="flex-1 flex items-center">
              <p className="text-lg font-semibold text-slate-700">
                Cycle complete. Repeat for each session.
              </p>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-12 p-4 bg-slate-100 rounded-lg border border-slate-200 text-xs text-slate-500 leading-relaxed">
          TherapyBill AI assists with billing accuracy by suggesting codes based
          on clinical documentation. All coding decisions must be reviewed and
          approved by the treating provider.
        </div>
      </div>
    </div>
  );
}

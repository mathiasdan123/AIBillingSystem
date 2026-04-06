import { useState } from "react";
import { Link } from "wouter";
import { Check, X, ChevronRight, Brain, FileText, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// ─── Plan Data ────────────────────────────────────────────────────────────────

const plans = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Solo OT practitioners",
    monthlyPrice: 99,
    annualPrice: 825,
    annualSavings: 363,
    providers: "1 OT provider",
    staff: "1 non-clinical staff",
    features: [
      "AI SOAP notes",
      "Scheduling & online booking",
      "Patient & caregiver portal",
      "Treatment plans & goal tracking",
      "Basic analytics",
      "Email support",
    ],
    popular: false,
    cta: "Start Free Trial",
  },
  {
    id: "professional",
    name: "Professional",
    tagline: "Growing OT practices",
    monthlyPrice: 199,
    annualPrice: 1659,
    annualSavings: 729,
    providers: "Up to 5 OTs ($59/mo each add'l)",
    staff: "3 non-clinical staff",
    features: [
      "AI SOAP notes",
      "Scheduling & online booking",
      "Patient & caregiver portal",
      "Treatment plans & goal tracking",
      "Telehealth",
      "Full analytics & reporting",
      "Email + chat support",
    ],
    popular: true,
    cta: "Start Free Trial",
  },
  {
    id: "practice",
    name: "Practice",
    tagline: "Multi-therapist OT clinics",
    monthlyPrice: 399,
    annualPrice: 3325,
    annualSavings: 1463,
    providers: "Up to 15 OTs ($49/mo each add'l)",
    staff: "Unlimited non-clinical staff",
    features: [
      "Everything in Professional, plus:",
      "AOTA industry benchmarking",
      "Custom report builder",
      "Priority support + onboarding call",
      "Priority data migration",
    ],
    popular: false,
    cta: "Start Free Trial",
  },
];

const includedFeatures = [
  "Digital signature & supervisor co-sign",
  "AI-powered OT SOAP note generation",
  "Patient & caregiver portal (magic-link login)",
  "Scheduling with waitlist & reminders",
  "Exercise & intervention banks",
  "Outcome measures with auto-scoring",
  "Authorization tracking (units used vs. authorized)",
  "Session time tracking",
  "SMS & email appointment reminders",
  "Data import (SimplePractice, TherapyNotes, Jane, WebPT, Fusion, Prompt)",
  "HIPAA-compliant (AES-256 encryption, MFA, audit logs, AWS BAA)",
  "White-label branding (custom logo & colors)",
  "Onboarding checklist",
];

const billingFeatures = [
  { text: "Electronic claim submission (837P)", included: true },
  { text: "AI claim review before submission", included: true },
  { text: "Real-time eligibility verification (270/271)", included: true },
  { text: "AI denial prediction", included: true },
  { text: "Real-time claim status checking (276/277)", included: true },
  { text: "AI-generated appeal letters", included: true },
  { text: "Batch claim submission", included: true },
  { text: "Automated follow-ups for aging claims", included: true },
  { text: "Secondary insurance claims", included: true },
  { text: "Payer underpayment detection", included: true },
  { text: "ERA/835 auto-posting & matching", included: true },
  { text: "OT CPT code knowledge built in", included: true },
  { text: "Superbill generation for self-pay", included: true },
  { text: "AI billing assistant on every page", included: true },
  { text: "Credit card & ACH patient payments (Stripe)", included: true },
  { text: "Fee schedule management & rate comparison", included: true },
];

const comparisonRows = [
  { label: "Billing fee", us: "6% of collections", them: "7\u20139% of collections" },
  { label: "Practice management software", us: "Included", them: "$79\u2013189/mo (additional cost)" },
  { label: "AI claim review & denial prediction", us: "Included", them: "Not available" },
  { label: "AI SOAP notes", us: "Included", them: "+$35/mo add-on (if available)" },
  { label: "Eligibility verification", us: "Included", them: "+$20/mo add-on or per-check fee" },
  { label: "Telehealth", us: "Included", them: "+$15/mo add-on" },
  { label: "Per-claim fees", us: "None", them: "+$0.14\u2013$0.35 per claim" },
  { label: "Intake forms", us: "Included", them: "+$5/user/mo" },
  { label: "You control your billing", us: "Yes \u2014 AI-assisted, you submit", them: "No \u2014 outsourced, less visibility" },
];

const faqs = [
  {
    q: "Is there a free trial?",
    a: "Yes. 30 days, no credit card required. You get full access to the entire platform \u2014 scheduling, SOAP notes, portal, analytics, and the complete billing workflow. During the trial, claims run in sandbox mode: the AI reviews your claims for accuracy and you experience the full submission workflow, but nothing is sent to payers. This means you can keep using your current billing system during the trial with zero risk of duplicate claims. When you're ready to go live, we switch you to production and you start submitting real claims.",
  },
  {
    q: "When does the 6% billing fee apply?",
    a: "Only after your trial ends and you go live. The fee is applied to insurance payments posted through the platform \u2014 you pay when you get paid. No minimums, no monthly billing fee for the billing engine.",
  },
  {
    q: "Can I keep using my current system during the trial?",
    a: "Yes. That's the point of sandbox mode. Your current billing system keeps running normally. You test TherapyBill AI side by side, import your data, and switch over when you're confident. No disruption to your practice.",
  },
  {
    q: "Can I use practice management without the billing engine?",
    a: "Yes. You can subscribe to practice management only and handle billing elsewhere. Add the billing engine anytime.",
  },
  {
    q: "Do I need a billing company?",
    a: "No. The AI reviews claims, predicts denials, and generates appeals. You handle billing yourself with AI doing the heavy lifting. Platform support is available if you run into issues.",
  },
  {
    q: "What does patient payment processing cost?",
    a: "Standard Stripe rates (2.9% + 30\u00A2 for cards, 0.8% for ACH). The 6% billing fee applies to insurance collections only, not patient payments.",
  },
  {
    q: "Is it HIPAA compliant?",
    a: "Yes. PHI encryption, MFA, audit logging, breach management, and a signed BAA with AWS.",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <Brain className="w-7 h-7 text-blue-600" />
            <span className="font-bold text-xl text-slate-900">TherapyBill AI</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm">Home</Button>
            </Link>
            <Link href="/?login=true">
              <Button size="sm">Sign In</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 sm:py-20 text-center px-4">
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 mb-4">
          TherapyBill AI Pricing
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          Practice management + AI-powered billing for OT practices. 30-day free trial in sandbox mode. No contracts. Cancel anytime.
        </p>
      </section>

      {/* ── Part 1: Practice Management ──────────────────────────────────── */}
      <section className="pb-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8">
            <Badge variant="outline" className="mb-3 text-sm px-3 py-1 font-medium">Part 1</Badge>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">Practice Management</h2>
            <p className="text-slate-600 max-w-xl mx-auto">
              Scheduling, clinical documentation, patient portal, analytics, and practice operations. Flat monthly fee.
            </p>
          </div>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3 mb-10">
            <span className={`text-sm font-medium ${!annual ? "text-slate-900" : "text-slate-500"}`}>Monthly</span>
            <button
              onClick={() => setAnnual(!annual)}
              className={`relative w-12 h-6 rounded-full transition-colors ${annual ? "bg-blue-600" : "bg-slate-300"}`}
              aria-label="Toggle annual billing"
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${annual ? "translate-x-6" : ""}`}
              />
            </button>
            <span className={`text-sm font-medium ${annual ? "text-slate-900" : "text-slate-500"}`}>
              Annual <span className="text-green-600 font-semibold">(save up to $1,463)</span>
            </span>
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => (
              <Card
                key={plan.id}
                className={`relative flex flex-col ${plan.popular ? "border-2 border-blue-500 shadow-lg" : "border border-slate-200"}`}
              >
                {plan.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-3">
                    Most Popular
                  </Badge>
                )}
                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.tagline}</CardDescription>
                  <div className="mt-4">
                    {annual ? (
                      <>
                        <div className="text-4xl font-bold text-slate-900">
                          ${Math.round(plan.annualPrice / 12)}<span className="text-base font-normal text-slate-500">/mo</span>
                        </div>
                        <div className="text-sm text-slate-500 mt-1">
                          ${plan.annualPrice.toLocaleString()}/yr with annual billing
                        </div>
                        <div className="text-sm text-green-600 font-medium">
                          (save ${plan.annualSavings.toLocaleString()})
                        </div>
                      </>
                    ) : (
                      <div className="text-4xl font-bold text-slate-900">
                        ${plan.monthlyPrice}<span className="text-base font-normal text-slate-500">/mo</span>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <ul className="space-y-2.5 mb-6 flex-1">
                    <li className="flex items-start gap-2 text-sm font-medium text-slate-900">
                      <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      {plan.providers}
                    </li>
                    <li className="flex items-start gap-2 text-sm font-medium text-slate-900">
                      <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      {plan.staff}
                    </li>
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                        <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link href="/?login=true">
                    <Button className="w-full" variant={plan.popular ? "default" : "outline"}>
                      {plan.cta}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Included in All Plans */}
      <section className="py-16 bg-slate-50 px-4">
        <div className="max-w-5xl mx-auto">
          <h3 className="text-xl font-bold text-slate-900 text-center mb-8">
            Included in All Practice Management Plans
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            {includedFeatures.map((f) => (
              <div key={f} className="flex items-start gap-2 text-sm text-slate-700">
                <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                {f}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Part 2: AI Billing Engine ────────────────────────────────────── */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <Badge variant="outline" className="mb-3 text-sm px-3 py-1 font-medium">Part 2</Badge>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">AI Billing Engine</h2>
            <p className="text-slate-600 max-w-xl mx-auto">
              Claims submission, eligibility verification, AI claim review, denial prediction, appeals, and payment posting. Priced as a percentage of insurance collections — you only pay when you get paid.
            </p>
          </div>

          <Card className="max-w-3xl mx-auto border-2 border-blue-100">
            <CardHeader className="text-center">
              <div className="text-5xl font-bold text-slate-900">6%</div>
              <div className="text-lg text-slate-600 mt-1">of insurance collections</div>
              <p className="text-sm text-slate-500 mt-3 max-w-lg mx-auto">
                Applied to insurance payments posted through the platform. No minimums. No setup fee.
              </p>
              <p className="text-sm text-slate-500 mt-2 max-w-lg mx-auto">
                Traditional billing companies charge 7-9% and you still need separate software — with TherapyBill AI, the software is included.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                {billingFeatures.map((f) => (
                  <div key={f.text} className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    {f.text}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Comparison Table ─────────────────────────────────────────────── */}
      <section className="py-16 bg-slate-50 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-10">
            How TherapyBill AI Compares
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 pr-4 font-medium text-slate-500 w-1/3"></th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900">TherapyBill AI</th>
                  <th className="text-left py-3 pl-4 font-semibold text-slate-500">Traditional Biller + Separate EHR</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium text-slate-700">{row.label}</td>
                    <td className="py-3 px-4 text-slate-900 font-medium">{row.us}</td>
                    <td className="py-3 pl-4 text-slate-500">{row.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-10">
            Common Questions
          </h2>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-slate-600 leading-relaxed">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="py-16 bg-gradient-to-r from-blue-600 to-blue-700 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">Start your 30-day free trial</h2>
          <p className="text-blue-100 mb-8">Full platform, sandbox mode, no risk</p>
          <Link href="/?login=true">
            <Button size="lg" variant="secondary" className="text-blue-600 font-semibold">
              Get Started Free <ChevronRight className="ml-1 w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="py-8 bg-slate-900 text-center px-4">
        <p className="text-xs text-slate-400 max-w-2xl mx-auto">
          TherapyBill AI assists with billing accuracy by suggesting codes based on clinical documentation. All coding decisions must be reviewed and approved by the treating provider.
        </p>
      </footer>
    </div>
  );
}

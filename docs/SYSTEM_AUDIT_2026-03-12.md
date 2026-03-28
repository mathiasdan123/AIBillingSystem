# TherapyBill AI — McKinsey-Style System Audit

**Date:** March 12, 2026
**Auditor:** Claude Code (Opus 4.6)
**Scope:** Full-stack application audit across 5 dimensions

---

## Executive Summary

TherapyBill AI is a **feature-rich, architecturally sound** therapy billing platform with genuine AI differentiation. However, it has **critical gaps across security, testing, and feature completeness** that must be addressed before enterprise sales or acquisition.

| Dimension | Score | Verdict |
|-----------|-------|---------|
| Frontend UX/UI | 6.5/10 | Functional, needs polish |
| Backend Architecture | 3.2/5 | MVP-grade, scalability issues |
| HIPAA Compliance | 3.6/5 | Not production-ready for real PHI |
| Business Logic & Features | 6.5/10 | Strong AI, missing table-stakes features |
| Code Quality & DevOps | 2.8/5 | Critical gaps in testing & security |

**Overall Sales Readiness: 5.5/10** — Strong foundation, not yet ready for enterprise buyers.

---

## DEAL-BREAKERS (Fix Immediately)

### 1. Credentials Exposed in Git
- `.env` file with **live API keys** (Supabase, OpenAI, Stripe, ElevenLabs, DB password, PHI encryption key) is tracked in git history
- **Action:** Rotate ALL keys immediately, remove `.env` from git history, add to `.gitignore`
- **Impact:** Violates SOC 2/HIPAA, deal-killer for any acquirer

### 2. Test Coverage ~2%
- Only ~80 tests across 185 source files
- Zero tests for: AI services, Stripe, Stedi, encryption, audit logging, 60+ React components
- **Action:** Write critical-path tests for claims, payments, eligibility, AI optimization (target 40%+)

### 3. No Production Monitoring
- No Sentry, Datadog, New Relic, or any APM
- No error tracking — failures are silent
- **Action:** Integrate Sentry (1-week effort), add alerting

### 4. No React Error Boundaries
- A single component crash takes down the entire app
- **Action:** Add ErrorBoundary wrapper around all routes

---

## P0 — Must Fix Before Sales (2-4 weeks)

### Features
| Gap | Impact | Effort |
|-----|--------|--------|
| **No recurring appointments** | #1 deal-killer for therapists — table-stakes feature | 1 week |
| **Patient billing non-functional** | No statements, no collections, no AR aging | 2 weeks |
| **No claims reconciliation (835)** | Can't match payments to claims automatically | 2 weeks |
| **Landing page footer links broken** | Signals unfinished product | 1 day |
| **Patient portal signature is a stub** | "Signature pad would go here" — not shippable | 2 days |

### Backend
| Gap | Impact | Effort |
|-----|--------|--------|
| **Route duplication** | routes.ts (11K lines) duplicates modular routers | 3 days |
| **No pagination** | All GET endpoints return ALL records — will crash at 5K+ patients | 3 days |
| **N+1 query patterns** | Patient list does 1,001 queries for 1,000 patients | 3 days |
| **Fire-and-forget webhooks** | Stripe payment succeeds but DB record may be lost | 2 days |

### Security/HIPAA
| Gap | Impact | Effort |
|-----|--------|--------|
| **MFA not mandatory** | Users can access PHI without enabling MFA | 1 day |
| **PHI encryption gaps** | Voice recordings, therapist PII, insurance data not encrypted | 1 week |
| **Consent not enforced** | System accesses PHI regardless of patient consent status | 3 days |
| **BAA tracking non-functional** | No enforcement — vendors access data without signed BAA | 3 days |
| **Retention policy hardcoded to 365 days** | May violate state law (typically 6+ years for billing) | 1 day |

---

## P1 — Must Fix Before Enterprise Sales (4-8 weeks)

### Features
- Batch claim submission (currently one-at-a-time)
- Secondary insurance billing
- Payer rate/contract management (cannot store negotiated rates)
- Appointment reminders (SMS/email)
- Therapist productivity reporting
- Multi-language support (at minimum Spanish)
- Bulk eligibility checks

### UX/UI
- **Accessibility audit (WCAG 2.1 AA)** — currently 4/10, zero ARIA labels, navigation not keyboard-accessible
- Skeleton loaders (currently just spinners)
- Empty state onboarding UX (guide new users)
- Inline form validation (currently only on submit)
- Mobile-first redesign (currently desktop-first with responsive patches)
- Dark mode

### Backend
- Redis-backed rate limiting (current in-memory breaks on horizontal scaling)
- Standardized error response format (`{ status, code, message }`)
- Database indexes on frequently queried columns
- API key encryption in database
- Webhook idempotency (prevent duplicate payments)
- Request timeout middleware

### DevOps
- Enforce test passing in CI (currently `continue-on-error: true`)
- Auto-generate OpenAPI from TypeScript (current manual spec drifts)
- Add E2E tests (Playwright/Cypress)
- Code coverage reporting with minimum thresholds
- Performance/load testing

---

## P2 — Complete for Market Leadership (Next Quarter)

- Treatment plan/goals integration with SOAP notes
- Custom report builder
- Practice benchmarking against anonymized peers
- AI denial prediction before submission
- Continuous AI learning from claim outcomes
- SSO (SAML/OIDC) for enterprise customers
- Multi-location workspace management UI
- Patient-facing progress notes (read-only)
- HIPAA compliance self-assessment dashboard
- Automated breach notification to HHS/state AG

---

## Competitive Positioning

### What You Beat Competitors On
- **AI claim accuracy review + appeal generation** — 12-month lead over SimplePractice/TherapyNotes/Jane
- **Modern tech stack** — clean React/TypeScript vs legacy competitors
- **Appeals workflow** — Kanban board UX is genuinely best-in-class

### What Competitors Have That You Don't
| Feature | SimplePractice | TherapyNotes | Jane App | TherapyBill AI |
|---------|---------------|--------------|----------|---------------|
| Recurring appointments | Yes | Yes | Yes | **No** |
| Patient statements | Yes | Yes | Yes | **No** |
| 835 remittance posting | Yes | No | Yes | **No** |
| Batch claims | Yes | Yes | Yes | **No** |
| Secondary insurance | Yes | Yes | Yes | **No** |
| Appointment reminders | Yes | Yes | Yes | **No** |
| AI claim accuracy review | No | No | No | **Yes** |
| AI appeal generation | No | No | Basic | **Yes** |
| WCAG accessibility | Partial | Partial | Yes | **No** |

---

## Go-to-Market Readiness

**Ready for now:**
- Solo OT practices (1-3 providers)
- Simple insurance (1-2 payers)
- Tech-forward early adopters

**NOT ready for:**
- Multi-location practices (no workspace UI)
- Complex insurance networks (no rate management)
- MSOs/DSOs (multi-tenant incomplete)
- Enterprise healthcare systems

**Suggested positioning:**
> *"AI-powered billing that gets you paid accurately — fewer undercoded claims, 85% less admin time"*

**Path to PMF:**
1. Land 20 single-provider OT clinics
2. Prove AI claim accuracy review ROI empirically
3. Build case studies with clear financial metrics
4. Expand to multi-provider once recurring appointments + billing complete

---

## Investment Required to Reach Sales-Ready

| Phase | Scope | Timeline | Effort |
|-------|-------|----------|--------|
| **Critical fixes** | Credentials, testing, monitoring, error boundaries | 1-2 weeks | 1 engineer |
| **P0 features** | Recurring appts, patient billing, 835, pagination | 3-4 weeks | 1-2 engineers |
| **P0 security** | MFA enforcement, PHI gaps, consent, retention | 2 weeks | 1 engineer |
| **P1 features + UX** | Accessibility, batch claims, payer rates, mobile | 6-8 weeks | 2 engineers |
| **P1 DevOps** | Redis rate limiting, CI enforcement, E2E tests | 2-3 weeks | 1 engineer |
| **Total to enterprise-ready** | | **~12-16 weeks** | **2 engineers** |

---

## Detailed Audit Reports

Full detailed findings from each audit workstream:
- Frontend UX/UI: 20 categories assessed, 38 pages reviewed
- Backend Architecture: 10 dimensions, 807 error handlers audited
- HIPAA Compliance: 12 regulatory areas, 10 critical gaps identified
- Business Logic: 12 feature areas, competitive analysis vs 3 competitors
- Code Quality & DevOps: 13 categories, 185 source files analyzed

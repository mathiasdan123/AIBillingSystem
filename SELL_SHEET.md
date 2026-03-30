# TherapyBill AI

### The All-in-One Practice Management & Billing Platform Built for Behavioral Health

---

## The Problem

Therapists didn't go into healthcare to spend hours on billing paperwork. Yet the average behavioral health practice juggles 3-5 separate software tools for scheduling, documentation, billing, and claims -- each with its own login, its own learning curve, and its own monthly fee. Meanwhile, claim denials eat into revenue, eligibility surprises derail sessions, and switching between systems burns hours every week that could be spent with patients.

---

## How TherapyBill AI Saves You Time

### AI-Powered SOAP Notes
Write clinical documentation in a fraction of the time. Enter your session details and our AI generates complete SOAP notes with Subjective, Objective, Assessment, and Plan sections -- ready for your review and signature. Supports OT, PT, SLP, and behavioral health specialties. You review, edit, and sign. The AI does the heavy lifting.

### AI Billing Assistant on Every Page
Have a billing question mid-workflow? Our Claude-powered AI assistant is available on every page -- no searching through help docs or calling a support line. Ask about CPT codes, payer-specific rules, modifier usage, or documentation requirements and get an answer instantly.

### AI Claim Review Before Submission
Before a claim goes out the door, AI reviews it for coding accuracy, missing information, and common denial triggers. Claims are flagged with specific issues so you can fix problems before they become rejections -- not after.

### AI Denial Prediction
Our system analyzes your claims against historical denial patterns and payer-specific rules to predict which claims are at risk of denial before you submit them. Fix issues proactively instead of chasing rejections weeks later.

### AI-Generated Appeal Letters
When a claim is denied, the system generates a payer-specific appeal letter using the clinical documentation and denial reason. You review and send -- instead of spending 30+ minutes drafting from scratch each time.

---

## Why Fewer Claims Get Denied

Claim denials are the single biggest revenue drain for therapy practices. TherapyBill AI attacks this problem at every stage:

**Before the appointment:** Real-time insurance eligibility verification checks patient coverage via direct payer connections (Stedi 270/271 transactions) so you know before the session whether coverage is active, what the copay is, and whether authorization is needed. Batch verification lets you check an entire day's schedule at once.

**Before submission:** AI reviews every claim for coding accuracy, correct modifiers, and payer-specific requirements. The system flags potential issues -- missing referring provider info, incorrect place of service, bundling conflicts -- so you fix them before submission, not after a 30-day denial cycle.

**After denial:** AI-powered appeal letter generation, deadline tracking (60-day HIPAA requirement), and escalation workflows mean denied claims get appealed quickly and systematically instead of falling through the cracks.

**Over time:** The AI learning service tracks your practice's claim outcomes and denial patterns, generating actionable insights specific to your payers and your coding patterns. The system gets smarter the more you use it.

---

## Everything You Need, One Platform

TherapyBill AI replaces your scheduling software, your EHR, your billing system, your patient portal, and your analytics dashboard -- all in one HIPAA-compliant platform.

### Scheduling & Appointments
- Single and recurring appointment scheduling
- Online patient self-booking via public booking page
- Therapist availability and time-off management
- Waitlist management with auto-fill notifications
- Appointment reminders via SMS (Twilio) and email
- Pre-appointment eligibility checking
- Telehealth session management with patient access codes

### Clinical Documentation
- AI-assisted SOAP note generation
- Digital signature and supervisor co-sign workflows
- Treatment plan creation and progress tracking
- Outcome measures (PHQ-9, GAD-7) with auto-scoring and trend tracking
- Exercise and therapy intervention banks
- Session time tracking

### Insurance & Eligibility
- Real-time eligibility verification for major payers (Aetna, UHC, Horizon BCBS, Anthem BCBS, Cigna, Humana, Kaiser, Medicare, Medicaid, TriCare)
- Batch eligibility processing for full-day schedules
- Treatment authorization tracking with units used vs. authorized
- Insurance plan document upload with AI-powered benefit extraction
- Patient cost estimation based on plan details
- Out-of-network reimbursement prediction

### Claims & Billing
- Electronic claim submission (837P) via Stedi clearinghouse
- Batch claim submission
- Real-time claim status checking (276/277)
- Secondary insurance claim submission
- Electronic remittance processing (835 ERA parsing)
- Auto-matching of remittance line items to claims
- Payer contract rate tracking and underpayment detection
- Superbill generation for self-pay patients
- Fee schedule management and rate comparison across payers
- Automated follow-up generation for aging and denied claims

### Patient Portal
- Patient login via secure magic link (no passwords to manage)
- View upcoming appointments and request new ones
- Access billing statements and make payments
- Complete intake forms and assigned surveys
- View shared progress notes
- Secure therapist-patient messaging

### Payments
- Credit card and ACH payments via Stripe
- Patient payment links
- Payment plan creation with installment tracking
- Patient statement generation and delivery
- Payment posting and refund processing

### Analytics & Reporting
- Real-time dashboard with KPIs: claims by status, denial rate, collection rate, AR aging
- Revenue analytics with monthly breakdown and forecasting
- Clean claims rate tracking
- Therapist productivity metrics and trends
- Cancellation and no-show rate analysis
- Referral source analytics
- Industry benchmarking against MGMA, AOTA, and CMS data
- Custom report builder with CSV export
- Daily billing summary reports via email

### Practice Management
- Multi-location support
- Role-based access (admin, therapist, billing staff)
- User credential and license tracking
- Supervision relationship management
- Onboarding checklist for new practices
- White-label branding with custom logo and colors

### Patient Engagement
- Google review management with AI-assisted responses
- Patient feedback collection
- Review request automation
- Secure messaging between therapists and patients

---

## Easy to Switch

### Import From What You Already Use
TherapyBill AI includes a guided data import tool that supports migration from:
- **SimplePractice**
- **TherapyNotes**
- **Jane App**
- **WebPT**
- **Fusion / Ensura**
- **Prompt Health**

Upload your exported CSV, JSON, or Excel files. Preview and map your data before import. The system validates everything before executing, so nothing gets lost in translation.

### Step-by-Step Onboarding
A built-in onboarding checklist walks you through setting up your practice -- from entering your NPI and tax ID to configuring your first appointment types and connecting your payer information.

---

## Security & HIPAA Compliance

TherapyBill AI is built for healthcare from the ground up -- not retrofitted with security as an afterthought.

- **PHI Encryption at Rest:** All protected health information encrypted with AES-256-GCM
- **Multi-Factor Authentication:** TOTP-based MFA required for accessing PHI (HIPAA 45 CFR 164.312(d))
- **Audit Logging:** Every PHI access event is logged with tamper detection
- **Breach Management:** Built-in breach incident tracking, HHS reporting workflows, and state notification letter generation with 60-day deadline monitoring
- **Role-Based Access Control:** Admin, therapist, and billing roles with practice-level data isolation
- **Rate Limiting:** Protection against brute force and abuse
- **AWS Infrastructure:** Hosted on AWS ECS Fargate with RDS PostgreSQL, BAA signed with AWS
- **SSL/TLS:** All data encrypted in transit
- **Compliance Self-Assessment:** Built-in security header testing and HIPAA compliance checklist
- **SSO Support:** Okta, Azure AD, and Google single sign-on

---

## Why TherapyBill AI vs. the Alternatives

| Capability | TherapyBill AI | Typical EHR | Typical Billing Software |
|---|---|---|---|
| AI SOAP note generation | Yes | No | No |
| AI claim review before submission | Yes | No | No |
| AI denial prediction | Yes | No | No |
| AI appeal letter generation | Yes | No | No |
| Real-time eligibility verification | Yes | Sometimes (add-on) | Sometimes |
| Electronic claim submission | Yes | Sometimes (add-on) | Yes |
| ERA/835 auto-posting | Yes | Rare | Sometimes |
| Patient portal with self-booking | Yes | Sometimes | No |
| Outcome tracking (PHQ-9, GAD-7) | Yes | Sometimes | No |
| Industry benchmarking | Yes | No | No |
| Payer underpayment detection | Yes | No | Rare |
| Telehealth built in | Yes | Sometimes (add-on) | No |
| Data import from 6 platforms | Yes | Limited | Limited |
| HIPAA breach management tools | Yes | No | No |
| White-label branding | Yes | Rare | No |

---

## Built For

- **Licensed Therapists** (LCSW, LMFT, LPC, Psychologists)
- **Occupational Therapists**
- **Physical Therapists**
- **Speech-Language Pathologists**
- **Solo practitioners and group practices**

---

## The Bottom Line

Every hour spent on billing paperwork, chasing denied claims, or switching between disconnected systems is an hour not spent with patients. TherapyBill AI brings scheduling, documentation, billing, claims, payments, and analytics into one platform -- with AI built into every step to reduce manual work and catch errors before they cost you money.

All coding decisions remain with the treating provider. AI suggests -- you decide.

---

*TherapyBill AI assists with billing accuracy by suggesting codes based on clinical documentation. All coding decisions must be reviewed and approved by the treating provider.*

**Live at [app.therapybillai.com](https://app.therapybillai.com)**

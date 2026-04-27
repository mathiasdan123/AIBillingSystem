/**
 * Help sidebar content — condensed customer-facing FAQ.
 *
 * Source of truth for the sidebar that appears when a user clicks the ? icon
 * in the bottom-left of the app. Structured by workflow, not feature, so
 * users find answers by searching for the real question they have.
 *
 * Keep answers under ~40 words each — this shows up in a narrow panel. For
 * deep explanations, link out to the full docs.
 *
 * Each item is indexed by its question + answer text in the sidebar's
 * search box, so be generous with keywords in phrasing.
 */

export interface HelpSection {
  id: string;
  title: string;
  items: HelpItem[];
}

export interface HelpItem {
  question: string;
  answer: string;
}

export const helpSections: HelpSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    items: [
      {
        question: 'What do I do first?',
        answer:
          'Settings → Practice Details → fill out practice name, NPI, Tax ID, and therapy specialty. Then start adding patients. Claim submission is already wired up through our managed clearinghouse — no extra setup needed.',
      },
      {
        question: 'Is my data HIPAA-compliant?',
        answer:
          'Yes. BAA with AWS, PHI encrypted at rest (AES-256-GCM) and in transit (TLS), MFA enforced, and full audit trail. BAA letter available on request.',
      },
    ],
  },
  {
    id: 'patients',
    title: 'Patients',
    items: [
      {
        question: 'How do I add a new patient?',
        answer:
          'Patients → "Add Patient". Or use the Intake tab to send a patient a link to fill in their own info — photo-uploaded insurance cards are read by AI.',
      },
      {
        question: 'How do I send an intake link?',
        answer:
          'Patient list → "New Intake" → enter email. Patient completes online; answers flow back into their chart.',
      },
      {
        question: 'How do I merge duplicate patients?',
        answer: 'Not self-serve yet. Email support and we\'ll merge on the back end.',
      },
      {
        question: 'How do I share the patient portal?',
        answer: 'Patient detail → "Send Portal Link". They get an email with secure login.',
      },
    ],
  },
  {
    id: 'eligibility',
    title: 'Eligibility & Benefits',
    items: [
      {
        question: 'How do I check if a patient\'s insurance is active?',
        answer:
          'Patient detail → Benefits Verification card → "Verify Benefits". Takes 5-10 seconds and returns active/inactive, copay, deductible, and visit limits.',
      },
      {
        question: 'Why does the Benefits card say "Generic coverage only"?',
        answer:
          'The payer answered our therapy-specific question with a generic response. Visit limits and copays shown may not be therapy-specific — call the payer to confirm before relying on them.',
      },
      {
        question: 'How often does eligibility run?',
        answer:
          'Automatic every 6 hours for patients with upcoming appointments. You can also trigger manually anytime. Best practice: re-verify before the first session of each month.',
      },
      {
        question: 'Eligibility is timing out. What do I do?',
        answer:
          'Usually a clearinghouse or payer hiccup. Wait 5-10 minutes and retry. If a specific payer is consistently slow, let us know and we\'ll investigate.',
      },
    ],
  },
  {
    id: 'scheduling',
    title: 'Scheduling & Front Desk',
    items: [
      {
        question: 'How do I check a patient in?',
        answer:
          'Front Desk tab → find appointment → "Check In". Kicks off the copay collection workflow if enabled.',
      },
      {
        question: 'How do appointment reminders work?',
        answer:
          'Automatic — 24 hours before each appointment, the patient gets an email and/or SMS (based on their preference) at 9am practice time.',
      },
      {
        question: 'How do I mark a no-show?',
        answer:
          'Front Desk → mark as "No Show" or "Cancelled". We track rates weekly and send a cancellation report every Monday.',
      },
      {
        question: 'Can patients book their own appointments?',
        answer:
          'Yes — Online Booking tab has a public link. Patients pick a provider, time, and service; appointment appears on your calendar.',
      },
    ],
  },
  {
    id: 'claims',
    title: 'Claims',
    items: [
      {
        question: 'How do I create a claim?',
        answer:
          'Claims → "Unbilled Sessions" tab → select one or more → "Create Claim". Or enable auto-create in Settings.',
      },
      {
        question: 'What is the "Check Risk" button?',
        answer:
          'AI pre-submission review. Flags likely denial causes (bad modifier, future DOS, etc.) and gives you a 0-100 risk score with fixes.',
      },
      {
        question: 'Why is my claim "Held"?',
        answer:
          'The scrubber found a blocking issue — missing auth, wrong NPI, STC mismatch. Click the claim to see the specific reason.',
      },
      {
        question: 'What does the "78 Risk" score mean?',
        answer: '0-30 = low, 31-69 = medium, 70+ = high. High means 2+ critical issues — don\'t submit until fixed.',
      },
      {
        question: 'Can I edit a claim after submission?',
        answer:
          'No — EDI rules. You can void it, or wait for the payer response and submit a corrected claim.',
      },
      {
        question: 'How do I submit a secondary claim?',
        answer:
          'Primary claim detail → "Submit Secondary". We auto-populate from the primary\'s ERA data once it\'s paid.',
      },
    ],
  },
  {
    id: 'prior-auth',
    title: 'Prior Authorizations',
    items: [
      {
        question: 'How do I log a prior authorization I got by phone or fax?',
        answer:
          'Patient detail → Prior Authorizations card → "Add Manually". Or click "Scan Approval" and drop the payer\'s approval letter — AI reads the auth number, units, dates, and CPT and prefills the form.',
      },
      {
        question: 'How do I draft a PA request letter?',
        answer:
          'Patient detail → Prior Authorizations → "Draft PA Request". Pick CPT, diagnosis, units. AI writes a one-page letter using the patient\'s SOAP notes. Review, then Download PDF or copy to clipboard.',
      },
      {
        question: 'What does the purple AI forecast banner mean?',
        answer:
          'AI watched this patient\'s session pace and predicts when their auth runs out. Earlier of (date expiry, projected unit exhaustion). Yellow/red urgency badges on the dashboard widget too — "request renewal now" guidance built in.',
      },
      {
        question: 'A claim was denied for missing prior auth — what now?',
        answer:
          'Claims page → click the denied claim → "Fix & Resubmit". Call payer for retro auth, log it under the patient, then click resubmit. Goes out as a replacement claim (not a duplicate), payer treats it as a correction.',
      },
      {
        question: 'How does claim auto-attach work?',
        answer:
          'When you submit a claim without an auth number, system finds the patient\'s active matching auth (status=active, today within date range, CPT matches or wildcard) and auto-attaches the auth number. No manual lookup needed.',
      },
      {
        question: 'Where do I see auths about to expire?',
        answer:
          'Dashboard → "Auths at Risk" widget shows up to 5 patients with auth predicted to lapse within 30 days, sorted by urgency. Click through to the patient detail to act.',
      },
    ],
  },
  {
    id: 'credentialing',
    title: 'Credentialing',
    items: [
      {
        question: 'What does the Credentialing page do?',
        answer:
          'Per-provider, per-payer in-network status tracker. Add credential records as you submit applications, mark status as pending → active → expired/denied. Daily emails alert admins about deadlines within 60 days.',
      },
      {
        question: 'How do I draft an enrollment packet for a new provider?',
        answer:
          'Credentialing page → "AI Draft" dropdown → "Draft enrollment packet letter". Pick the provider (or type manually if not in system yet) + payer name. AI generates cover letter + document checklist. Download as PDF.',
      },
      {
        question: 'How do I draft a credentialing application?',
        answer:
          'Same "AI Draft" dropdown → "Draft credentialing application". AI fills the standard payer questions (NPI, license, specialty, etc.) using practice + provider data. Download PDF or paste into payer portal.',
      },
      {
        question: 'What does the EDI column mean on the credentialing page?',
        answer:
          'Aggregate enrollment status across the three transaction types (eligibility, claims, ERA) for that payer. Green = all enrolled, yellow = some pending, red = something rejected. Click to jump to Payer Enrollments page.',
      },
      {
        question: 'How do I track payer enrollment for claim submission?',
        answer:
          'Sidebar → Settings → Practice → Payer Enrollments. Grid shows each payer × transaction type with status (not enrolled / pending / enrolled / rejected). Per-payer "X/Y providers credentialed" cross-link.',
      },
      {
        question: 'When am I notified about credentialing deadlines?',
        answer:
          'Daily 9:15 AM email to practice admins listing any provider credential expiring or re-credentialing within 60 days. Plus 9:30 AM email for therapist license expirations. Plus the dashboard widget.',
      },
      {
        question: 'I just enrolled with a new payer — will I be notified?',
        answer:
          'Yes — when an enrollment status flips to "enrolled" or "rejected", admins get an immediate email with the new status, transaction type, and (if rejected) the reason.',
      },
    ],
  },
  {
    id: 'soap-interventions',
    title: 'SOAP Interventions',
    items: [
      {
        question: 'What\'s the new "Interventions" section on the SOAP form?',
        answer:
          'Categorized library of higher-level interventions (Speech Therapy, ADLs, Sensory Swing, etc.) you multi-select for the session. Different from "Activities Performed" — that\'s granular activities, this is the umbrella categories. Both feed the AI prompt.',
      },
      {
        question: 'Can I add my own interventions to the picker?',
        answer:
          'Yes — practice admins can add custom items via API today (UI coming soon). System defaults are shared and can\'t be deleted, but you can hide ones you don\'t use.',
      },
    ],
  },
  {
    id: 'denials',
    title: 'Denials & Appeals',
    items: [
      {
        question: 'What are the amber "Suggested next steps"?',
        answer:
          'Actionable guidance below the red denial reason. Examples: "run fresh eligibility", "retroactive prior auth", "generic coverage only was verified".',
      },
      {
        question: 'How do I file an appeal?',
        answer:
          'Denied claim detail → Appeals tab → "Generate Appeal". Claude drafts a letter citing medical necessity. Review, edit, send.',
      },
      {
        question: 'What if prior auth was missing?',
        answer:
          'Call the payer for retroactive auth (usually allowed 30-90 days post-service). Add the auth number to the claim, resubmit. If retro auth is denied, appeal.',
      },
      {
        question: 'Where do I see appeal success rates?',
        answer: 'Reports → Appeal Insights. Shows your practice\'s rate by denial type.',
      },
    ],
  },
  {
    id: 'payments',
    title: 'Payments (ERA / Patient)',
    items: [
      {
        question: 'How do payments come in?',
        answer:
          'ERAs (835s) auto-post when our clearinghouse receives them. Patient payments via Stripe auto-post to the patient balance.',
      },
      {
        question: 'How do I post a check I received in the mail?',
        answer:
          'Claim detail → Payments tab → "Record Payment" → enter amount, check number, and date.',
      },
      {
        question: 'Where do I see what a patient owes?',
        answer:
          'Patient detail → "Account" tab for per-patient. Reimbursement tab for practice-wide AR aging.',
      },
      {
        question: 'How do I send a statement?',
        answer:
          'Reimbursement → select overdue accounts → "Send Statement". Email or paper.',
      },
    ],
  },
  {
    id: 'soap',
    title: 'SOAP Notes',
    items: [
      {
        question: 'How do I generate a SOAP note?',
        answer:
          'Appointment detail → SOAP Note tab → "Generate with AI". Takes your session description and drafts a note. Review + edit before signing.',
      },
      {
        question: 'Are AI drafts compliant?',
        answer:
          'Yes, when reviewed by the treating provider. All coding decisions must be reviewed + approved by the provider before signing.',
      },
      {
        question: 'Can I customize the template?',
        answer: 'Yes — Settings → Practice Details → "SOAP Note Template".',
      },
      {
        question: 'Can I edit a signed note?',
        answer:
          'No — signed notes are locked. You can file an amendment request, which is tracked separately for audit.',
      },
    ],
  },
  {
    id: 'reports',
    title: 'Reports & Analytics',
    items: [
      {
        question: 'Where do I see total revenue?',
        answer: 'Insights → Dashboard. Shows MTD, YTD, and trends.',
      },
      {
        question: 'Where do I see AR aging?',
        answer: 'Reimbursement → "AR Aging" section. Buckets: 0-30, 31-60, 61-90, 90+ days.',
      },
      {
        question: 'Can I export to Excel?',
        answer: 'Yes — every report has a "Download CSV" button.',
      },
      {
        question: 'Is there a daily summary email?',
        answer:
          'Yes — sent at 7am ET daily. Configurable in Settings → Preferences → Email Reports.',
      },
    ],
  },
  {
    id: 'security',
    title: 'Security & Access',
    items: [
      {
        question: 'Do I have to use MFA?',
        answer:
          'Yes for admins and anyone accessing PHI. One-time setup via authenticator app (Google Authenticator, 1Password, Authy, etc.).',
      },
      {
        question: 'I lost my MFA device. How do I reset?',
        answer:
          'Email support from your practice admin\'s email. We verify identity then reset. If you ARE the admin, contact us directly.',
      },
      {
        question: 'What user roles are there?',
        answer:
          'Admin, Biller, Therapist, Front Desk, Read-Only. Settings → Users → edit a user to change.',
      },
      {
        question: 'Session timeout?',
        answer:
          '30 minutes of inactivity in production. MFA re-verification required every 15 minutes for PHI routes.',
      },
      {
        question: 'Can I see who accessed a patient chart?',
        answer:
          'Admin only — Compliance → Audit Logs → filter by patient. Required for HIPAA breach investigations.',
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    items: [
      {
        question: 'A page won\'t load.',
        answer:
          'Hard refresh (Cmd-Shift-R on Mac, Ctrl-Shift-R on Windows). If persists, check app.therapybillai.com/api/health — if that returns 200, it\'s a browser issue.',
      },
      {
        question: 'Claim submission says "Authorization Pending".',
        answer:
          'The payer requires prior auth and your claim doesn\'t have an auth number. Add it in the Authorization Number field, then submit.',
      },
      {
        question: 'Claim status stuck on "Unknown" for days.',
        answer:
          'We couldn\'t reach the payer for status updates. Usually resolves on its own. If it\'s been 7+ days, contact support to escalate.',
      },
      {
        question: 'I deleted a patient by accident.',
        answer:
          'Soft-deleted — recoverable. Email support within 7 years and we\'ll restore. (After 7 years it\'s hard-deleted for HIPAA retention.)',
      },
    ],
  },
  {
    id: 'billing',
    title: 'Subscription & Billing',
    items: [
      {
        question: 'How does pricing work?',
        answer: 'Per-provider/month flat fee. No per-claim charges. Contact sales for specifics.',
      },
      {
        question: 'Is clearinghouse access included?',
        answer:
          'Yes — eligibility checks, claim submission, and ERA retrieval are all handled through our managed clearinghouse. Eligibility is included up to a fair-use limit; claims + ERAs may have small per-transaction pass-through costs (typically $0.10-0.50).',
      },
      {
        question: 'What\'s the contract length?',
        answer:
          'Month-to-month by default. Annual prepay gets 15% off.',
      },
      {
        question: 'What happens if I cancel?',
        answer:
          'Your data stays for 7 years (HIPAA retention). Export everything before canceling. After 7 years, it\'s permanently deleted.',
      },
    ],
  },
  {
    id: 'whats-new',
    title: 'What\'s New (April 2026)',
    items: [
      {
        question: 'Therapy Specialty dropdown',
        answer:
          'New field on Practice Details. Tells eligibility checks to ask payers specifically about OT/PT/ST/MH coverage instead of generic.',
      },
      {
        question: 'Strict STC Validation toggle',
        answer:
          'Optional safety switch on Practice Details. When ON, blocks claims where the CPT doesn\'t match what the payer verified. OFF by default — scrubber only warns.',
      },
      {
        question: '"Generic coverage only" banner',
        answer:
          'Amber banner on Benefits Verification card when the payer returned only generic coverage instead of answering your specialty-specific question.',
      },
      {
        question: '"Suggested next steps" on denials',
        answer:
          'Amber bullets below denial reasons with actionable guidance: run fresh eligibility, request retro prior auth, or re-verify for specialty coverage.',
      },
      {
        question: 'Clear rejection codes',
        answer:
          'Rejected claims now show the actual X12 code (A7, F4, etc.) with plain-English label, instead of a generic "Unknown" pill.',
      },
    ],
  },
];

/**
 * Flatten + filter help content by a search query. Case-insensitive substring
 * match across both question and answer text. Returns sections with only the
 * matching items — empty sections are dropped.
 */
export function filterHelpSections(
  sections: HelpSection[],
  query: string
): HelpSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  const out: HelpSection[] = [];
  for (const s of sections) {
    const matches = s.items.filter(
      (i) =>
        i.question.toLowerCase().includes(q) ||
        i.answer.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q)
    );
    if (matches.length > 0) {
      out.push({ ...s, items: matches });
    }
  }
  return out;
}

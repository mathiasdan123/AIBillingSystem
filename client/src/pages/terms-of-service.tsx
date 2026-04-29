import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link href="/">
          <a className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 mb-8">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Home
          </a>
        </Link>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-slate-500 mb-10">Effective Date: April 16, 2026</p>

        <div className="prose prose-slate max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Acceptance of Terms</h2>
            <p className="text-slate-700 leading-relaxed">
              By accessing or using the TherapyBill AI platform at app.therapybillai.com (the "Service"), you agree
              to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the
              Service. If you are using the Service on behalf of a practice or organization, you represent that you have
              the authority to bind that entity to these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">2. Description of Service</h2>
            <p className="text-slate-700 leading-relaxed">
              TherapyBill AI is a cloud-based medical billing and practice management platform designed for behavioral
              health and therapy practices, including occupational therapy (OT), physical therapy (PT), and
              speech-language pathology (SLP). The Service provides tools for insurance claim submission, eligibility
              verification, appointment scheduling, clinical documentation, AI-assisted billing code suggestions,
              patient management, and practice analytics.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">3. Account Registration and Responsibilities</h2>
            <p className="text-slate-700 leading-relaxed mb-3">
              To use the Service, you must create an account and provide accurate, complete information. You are
              responsible for:
            </p>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li>Maintaining the confidentiality of your account credentials</li>
              <li>Enabling and using multi-factor authentication (MFA) as required for PHI access</li>
              <li>All activity that occurs under your account</li>
              <li>Notifying us immediately of any unauthorized access to your account</li>
              <li>Ensuring that all users within your practice comply with these Terms</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. HIPAA Compliance and Provider Responsibilities</h2>
            <p className="text-slate-700 leading-relaxed mb-3">
              TherapyBill AI operates as a Business Associate under HIPAA. We will enter into a Business Associate
              Agreement (BAA) with each covered entity using the Service. As a healthcare provider using the Service,
              you acknowledge and agree that:
            </p>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li>You are responsible for the accuracy and completeness of all patient information entered into the Service</li>
              <li>You are responsible for all clinical and billing decisions, including final approval of diagnosis codes, procedure codes, and billing amounts</li>
              <li>AI-generated suggestions (including billing code recommendations, SOAP note drafts, and appeal letters) are tools to assist your professional judgment and do not replace it</li>
              <li>You must review and approve all AI-generated content before it is used for billing or clinical purposes</li>
              <li>You are responsible for complying with all applicable federal and state healthcare regulations</li>
              <li>You will not use the Service to bill for services not rendered or to engage in any fraudulent billing practices</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">5. AI-Assisted Features Disclaimer</h2>
            <p className="text-slate-700 leading-relaxed">
              TherapyBill AI assists with billing accuracy by suggesting codes based on clinical documentation.
              All coding decisions must be reviewed and approved by the treating provider. The AI features of the
              Service are designed to support, not replace, the clinical and billing judgment of qualified healthcare
              professionals. TherapyBill AI does not guarantee the accuracy of AI-generated suggestions and is not
              responsible for billing errors resulting from the use of AI suggestions without proper provider review.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">6. Prohibited Uses</h2>
            <p className="text-slate-700 leading-relaxed mb-3">
              You agree not to use the Service to:
            </p>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li>Submit fraudulent insurance claims or bill for services not rendered</li>
              <li>Engage in upcoding, unbundling, or any other improper billing practice</li>
              <li>Access or attempt to access PHI of patients outside your care</li>
              <li>Share your account credentials with unauthorized individuals</li>
              <li>Reverse engineer, decompile, or attempt to extract the source code of the Service</li>
              <li>Use the Service in any way that violates applicable laws or regulations</li>
              <li>Transmit malicious code, viruses, or any other harmful technology</li>
              <li>Interfere with or disrupt the integrity or performance of the Service</li>
              <li>Use automated tools (bots, scrapers) to access the Service without our written consent</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">7. Payment Terms</h2>
            <p className="text-slate-700 leading-relaxed mb-3">
              Access to the Service requires a paid subscription. Payment terms are as follows:
            </p>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li>Subscription fees are billed monthly or annually in advance via Stripe</li>
              <li>All fees are non-refundable except as required by applicable law</li>
              <li>We reserve the right to change subscription pricing with 30 days' notice</li>
              <li>Failure to pay may result in suspension or termination of your account</li>
              <li>You are responsible for all applicable taxes related to your use of the Service</li>
              <li>
                <strong>AI usage — fair use.</strong> AI-powered features (SOAP narratives, claim review,
                denial prediction, appeal letters, prior-authorization letters, credentialing drafts,
                insight report narratives) are included in your subscription subject to fair use. If your
                account significantly exceeds typical AI usage for your plan tier, we may bill the
                incremental AI provider costs at-cost on your next invoice or work with you to move to a
                higher-tier plan. We will give at least 14 days' written notice (via the email on file)
                before billing any incremental AI costs, and detailed AI usage will be visible in your
                billing dashboard.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">8. Intellectual Property</h2>
            <p className="text-slate-700 leading-relaxed">
              The Service, including its design, features, code, and content (excluding your data), is owned by
              TherapyBill AI and protected by intellectual property laws. You retain ownership of all data you enter
              into the Service, including patient records, clinical documentation, and practice information. By using
              the Service, you grant us a limited license to process your data solely for the purpose of providing
              the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">9. Limitation of Liability</h2>
            <p className="text-slate-700 leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, THERAPYBILL AI SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
              SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, OR
              GOODWILL, ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ALL CLAIMS RELATED TO THE SERVICE
              SHALL NOT EXCEED THE AMOUNT YOU PAID FOR THE SERVICE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
              THERAPYBILL AI IS NOT LIABLE FOR CLINICAL DECISIONS MADE BY PROVIDERS, CLAIM DENIALS BY INSURANCE PAYERS,
              OR ERRORS IN BILLING RESULTING FROM INACCURATE DATA ENTERED BY USERS.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">10. Disclaimers</h2>
            <p className="text-slate-700 leading-relaxed">
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED,
              INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
              NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.
              THERAPYBILL AI IS NOT A HEALTHCARE PROVIDER AND DOES NOT PROVIDE MEDICAL, LEGAL, OR FINANCIAL ADVICE.
              THE AI FEATURES ARE DECISION-SUPPORT TOOLS AND DO NOT REPLACE PROFESSIONAL JUDGMENT.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">11. Indemnification</h2>
            <p className="text-slate-700 leading-relaxed">
              You agree to indemnify and hold harmless TherapyBill AI, its officers, directors, employees, and agents
              from any claims, damages, losses, or expenses (including reasonable attorneys' fees) arising from your
              use of the Service, violation of these Terms, violation of any applicable law, or infringement of any
              third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">12. Termination</h2>
            <p className="text-slate-700 leading-relaxed mb-3">
              Either party may terminate this agreement as follows:
            </p>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li><strong>By you:</strong> You may cancel your subscription and close your account at any time through your account settings or by contacting us</li>
              <li><strong>By us:</strong> We may suspend or terminate your account immediately if you violate these Terms, engage in fraudulent activity, or fail to pay subscription fees</li>
              <li><strong>Data after termination:</strong> Upon termination, you may request an export of your data within 30 days. After the 30-day period, your data will be retained only as required by law (see our Privacy Policy for retention details)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">13. Governing Law</h2>
            <p className="text-slate-700 leading-relaxed">
              These Terms shall be governed by and construed in accordance with the laws of the State of New Jersey,
              without regard to its conflict of law provisions. Any disputes arising from these Terms or the Service
              shall be resolved in the state or federal courts located in New Jersey.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">14. Changes to These Terms</h2>
            <p className="text-slate-700 leading-relaxed">
              We may update these Terms from time to time. We will notify you of material changes by posting the
              updated Terms on the Service, updating the effective date, and sending notice to the email address
              associated with your account. Your continued use of the Service after changes are posted constitutes
              acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">15. Contact Us</h2>
            <p className="text-slate-700 leading-relaxed">
              If you have questions about these Terms of Service, please contact us:
            </p>
            <div className="mt-3 text-slate-700 space-y-1">
              <p><strong>TherapyBill AI</strong></p>
              <p>Email: <a href="mailto:daniel@therapybillai.com" className="text-blue-600 hover:text-blue-800">daniel@therapybillai.com</a></p>
              <p>Phone: <a href="tel:+12014240779" className="text-blue-600 hover:text-blue-800">(201) 424-0779</a></p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

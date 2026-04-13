import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link href="/">
          <a className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 mb-8">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Home
          </a>
        </Link>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-500 mb-10">Effective Date: April 16, 2026</p>

        <div className="prose prose-slate max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Introduction</h2>
            <p className="text-slate-700 leading-relaxed">
              TherapyBill AI ("we," "us," or "our") operates a HIPAA-compliant medical billing and practice management
              platform for therapy practices, including occupational therapy, physical therapy, and speech-language
              pathology. This Privacy Policy describes how we collect, use, disclose, and protect your information when
              you use our services at app.therapybillai.com (the "Service").
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">2. Information We Collect</h2>

            <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">2.1 Practice and Account Information</h3>
            <p className="text-slate-700 leading-relaxed">
              When you register for an account, we collect your name, email address, phone number, practice name,
              professional credentials (NPI, license numbers), and billing address. This information is used to create
              and manage your account.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">2.2 Protected Health Information (PHI)</h3>
            <p className="text-slate-700 leading-relaxed">
              In the course of providing billing and practice management services, you may enter patient demographics,
              insurance information, diagnosis codes, procedure codes, clinical documentation (SOAP notes), treatment
              plans, and appointment records. All PHI is handled in accordance with the Health Insurance Portability
              and Accountability Act (HIPAA) and our Business Associate Agreement (BAA) with your practice.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">2.3 Billing and Payment Data</h3>
            <p className="text-slate-700 leading-relaxed">
              We collect information related to insurance claims, remittance advice, and subscription payments.
              Credit card and payment details are processed and stored by Stripe, our PCI DSS-compliant payment
              processor. We do not store credit card numbers on our servers.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">2.4 Usage and Analytics Data</h3>
            <p className="text-slate-700 leading-relaxed">
              We collect information about how you interact with the Service, including pages visited, features used,
              session duration, browser type, device information, and IP address. This data is used to improve the
              Service and is not linked to PHI.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li>Providing and maintaining the Service, including billing, scheduling, and clinical documentation</li>
              <li>Processing insurance claims through electronic clearinghouse submission</li>
              <li>AI-assisted billing code suggestions to improve coding accuracy (all suggestions require provider review and approval)</li>
              <li>Generating SOAP notes and clinical documentation with AI assistance</li>
              <li>Processing subscription payments and invoices</li>
              <li>Sending service-related notifications (appointment reminders, claim status updates)</li>
              <li>Improving the Service through aggregated, de-identified analytics</li>
              <li>Complying with legal obligations and regulatory requirements</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. HIPAA Compliance</h2>
            <p className="text-slate-700 leading-relaxed mb-3">
              TherapyBill AI operates as a Business Associate under HIPAA. We maintain comprehensive safeguards to
              protect PHI:
            </p>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li><strong>Encryption at rest:</strong> All PHI is encrypted using AES-256-GCM encryption before storage</li>
              <li><strong>Encryption in transit:</strong> All data transmitted between your browser and our servers is encrypted via TLS 1.2+</li>
              <li><strong>Access controls:</strong> Role-based access controls, multi-factor authentication (MFA), and session management</li>
              <li><strong>Audit logging:</strong> All access to PHI is logged with tamper-detection capabilities</li>
              <li><strong>Business Associate Agreement:</strong> We execute a BAA with every covered entity using the Service</li>
              <li><strong>Breach notification:</strong> We maintain a breach incident management and notification process compliant with the HIPAA Breach Notification Rule</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">5. Data Storage and Security</h2>
            <p className="text-slate-700 leading-relaxed mb-3">
              Your data is stored on Amazon Web Services (AWS) infrastructure in the United States. We have executed
              a HIPAA Business Associate Agreement with AWS. Our infrastructure includes:
            </p>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li>AWS ECS Fargate for application hosting in a private subnet</li>
              <li>AWS RDS PostgreSQL with encryption at rest for database storage</li>
              <li>Application-level AES-256-GCM encryption for all PHI fields</li>
              <li>Automated backups and disaster recovery procedures</li>
              <li>Network isolation using VPC, private subnets, and security groups</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">6. Third-Party Services</h2>
            <p className="text-slate-700 leading-relaxed mb-3">
              We use the following third-party services to operate the platform. Each service that handles PHI does so
              under a Business Associate Agreement:
            </p>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li><strong>Amazon Web Services (AWS):</strong> Cloud infrastructure, hosting, and database services (BAA in place)</li>
              <li><strong>Stedi:</strong> Electronic clearinghouse for insurance eligibility verification, claim submission, and claim status inquiries (BAA in place)</li>
              <li><strong>Stripe:</strong> Payment processing for subscription billing and patient invoicing (PCI DSS compliant)</li>
              <li><strong>Anthropic (Claude AI):</strong> AI-powered billing code suggestions, clinical documentation assistance, and appeal letter generation. PHI processing is governed by our BAA and Anthropic's data handling policies. AI outputs always require provider review.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">7. Data Retention and Deletion</h2>
            <p className="text-slate-700 leading-relaxed mb-3">
              We retain your data for as long as your account is active and as required by applicable law:
            </p>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li><strong>Account data:</strong> Retained while your account is active and for 30 days after account closure</li>
              <li><strong>PHI and clinical records:</strong> Retained per HIPAA requirements (minimum 6 years from date of creation or last effective date)</li>
              <li><strong>Billing and claims data:</strong> Retained for 7 years in accordance with IRS and payer requirements</li>
              <li><strong>Audit logs:</strong> Retained for 6 years per HIPAA requirements</li>
            </ul>
            <p className="text-slate-700 leading-relaxed mt-3">
              Upon account termination, you may request an export of your data. After the applicable retention period,
              data is securely deleted using industry-standard methods.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">8. Your Rights</h2>
            <p className="text-slate-700 leading-relaxed mb-3">
              You have the following rights regarding your information:
            </p>
            <ul className="list-disc list-inside text-slate-700 space-y-2">
              <li><strong>Access:</strong> You may request a copy of the personal information we hold about you</li>
              <li><strong>Correction:</strong> You may request that we correct inaccurate or incomplete information</li>
              <li><strong>Deletion:</strong> You may request deletion of your personal information, subject to legal retention requirements</li>
              <li><strong>Data portability:</strong> You may request an export of your data in a standard format</li>
              <li><strong>Restriction:</strong> You may request that we limit our processing of your information in certain circumstances</li>
            </ul>
            <p className="text-slate-700 leading-relaxed mt-3">
              To exercise any of these rights, contact us at{" "}
              <a href="mailto:daniel@therapybillai.com" className="text-blue-600 hover:text-blue-800">
                daniel@therapybillai.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">9. Cookies and Tracking</h2>
            <p className="text-slate-700 leading-relaxed">
              We use essential cookies required for the Service to function, including session cookies for authentication
              and security. We do not use third-party advertising cookies. Analytics cookies, if used, collect
              aggregated, non-identifiable usage data to help us improve the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">10. Children's Privacy</h2>
            <p className="text-slate-700 leading-relaxed">
              The Service is intended for use by licensed healthcare providers and practice administrators. We do not
              knowingly collect personal information directly from children under 13. Patient information for minors
              is entered and managed by their treating providers as part of clinical care, governed by HIPAA and the
              applicable BAA.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">11. Changes to This Policy</h2>
            <p className="text-slate-700 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of material changes by posting
              the updated policy on the Service and updating the effective date. Your continued use of the Service
              after changes are posted constitutes acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">12. Contact Us</h2>
            <p className="text-slate-700 leading-relaxed">
              If you have questions about this Privacy Policy or our data practices, please contact us:
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

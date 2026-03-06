# AIBillingSystem Demo Instructions

## Demo URL
**https://aibilling-demo.loca.lt**

**Tunnel Password:** `68.173.239.185`
(Enter this when prompted on first visit)

---

## Admin/Therapist Portal

### Access
Simply go to the main URL above. You'll be automatically logged in as a demo admin user.

### Features to Explore

| Feature | Navigation |
|---------|------------|
| Dashboard | Home page - overview of practice metrics |
| Patients | View and manage patient records |
| Calendar | Appointment scheduling |
| SOAP Notes | Clinical documentation |
| Claims | Insurance claim management |
| Analytics | Revenue and claims analytics |
| Appeals | Denial management and appeals |

### Key Workflows to Demo

1. **Patient Intake**
   - Click "Patient Intake" in sidebar
   - Fill out the comprehensive intake form
   - See HIPAA-compliant data collection

2. **SOAP Note Creation**
   - Go to "SOAP Notes"
   - Create a new note with AI-assisted billing code suggestions

3. **Claims Management**
   - View claims by status (draft, submitted, paid, denied)
   - See AI-optimized billing recommendations

4. **Analytics Dashboard**
   - View revenue trends
   - See denial reasons breakdown
   - Track collection rates

---

## Patient Portal

### Access

1. **Get Demo Token:**
   Open this URL in your browser:
   ```
   https://aibilling-demo.loca.lt/api/patient-portal/demo-login
   ```

   You'll see a response like:
   ```json
   {
     "portalToken": "abc123...",
     "patient": {"firstName": "John", "lastName": "Smith"}
   }
   ```

2. **Access Patient Portal:**
   Go to:
   ```
   https://aibilling-demo.loca.lt/patient-portal
   ```

### Patient Portal Features

| Feature | Description |
|---------|-------------|
| Appointments | View upcoming and past appointments |
| Statements | See billing statements and balances |
| Documents | Access intake forms and consents |
| Messages | Secure messaging with therapist |
| Profile | Update contact information |

---

## Notes

- **First Visit:** Enter tunnel password `68.173.239.185` when prompted (only needed once per IP)
- **Mock Data:** The demo uses pre-seeded sample data for patients, appointments, and claims
- **No Real PHI:** All data shown is fictional test data
- **Session:** Your session will persist in the browser

---

## Technical Details

- **Stack:** React + TypeScript frontend, Express + PostgreSQL backend
- **Security:** HIPAA-compliant encryption, role-based access control
- **AI Features:** OpenAI-powered SOAP note generation and billing optimization

---

## Questions?

Contact: [Your contact info here]

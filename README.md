# TherapyBill AI

A comprehensive AI-powered medical billing and practice management platform designed for occupational therapy and mental health practices.

## Features

### Core Billing
- **Claims Management** - Create, submit, and track insurance claims with real-time status updates
- **AI Claim Review** - Automatic CPT code suggestions and billing accuracy checks
- **Appeal Generation** - AI-powered appeal letter generation for denied claims
- **Reimbursement Prediction** - ML-based out-of-network reimbursement forecasting

### Clinical Documentation
- **SOAP Notes** - AI-assisted clinical documentation with voice dictation
- **Session Recording** - Record and transcribe therapy sessions with automatic SOAP generation
- **Treatment Plans** - Comprehensive treatment plan creation with goals and objectives
- **Outcome Measures** - Built-in assessments (PHQ-9, GAD-7, Barthel, Berg, etc.)

### Patient Management
- **Patient Portal** - Secure patient access for appointments, documents, and messaging
- **Insurance Eligibility** - Real-time eligibility verification via Stedi API
- **Intake Forms** - Multi-step digital intake with AI-powered insurance card parsing
- **Consent Management** - HIPAA-compliant consent collection and tracking

### Scheduling
- **Calendar Management** - Therapist scheduling with availability management
- **Online Booking** - Patient self-scheduling with customizable booking pages
- **Waitlist** - Intelligent waitlist management with automatic notifications
- **Telehealth** - Video session management with secure patient links

### Analytics & Reporting
- **Dashboard** - KPIs including collection rate, clean claims rate, capacity utilization
- **Revenue Analytics** - Trends, forecasting, and payer comparison
- **A/R Aging** - Accounts receivable tracking by aging bucket
- **Denial Analysis** - Top denial reasons and appeal success rates

### HIPAA Compliance
- **Audit Logging** - Comprehensive PHI access tracking with tamper detection
- **Breach Management** - Incident reporting and notification workflows
- **Patient Rights** - Data export, amendment requests, accounting of disclosures
- **BAA Tracking** - Business Associate Agreement management

## Tech Stack

- **Frontend**: React 18, TypeScript, TailwindCSS, Radix UI
- **Backend**: Node.js, Express.js, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Supabase Auth (OAuth/JWT)
- **AI Services**: OpenAI GPT-4, Anthropic Claude
- **Payments**: Stripe
- **SMS/Email**: Twilio, Nodemailer
- **Insurance APIs**: Stedi (eligibility, claims)

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Supabase project (for authentication)

## Environment Variables

Create a `.env` file with the following variables:

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Authentication (Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Session
SESSION_SECRET=your-session-secret

# AI Services
OPENAI_API_KEY=sk-your-openai-key

# Payments (Stripe)
STRIPE_SECRET_KEY=sk_live_your-stripe-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret

# Insurance (Stedi)
STEDI_API_KEY=your-stedi-key

# Notifications
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
TWILIO_PHONE_NUMBER=+1234567890

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email
SMTP_PASS=your-password

# Encryption
PHI_ENCRYPTION_KEY=32-byte-hex-key
```

## Installation

```bash
# Install dependencies
npm install

# Push database schema
npm run db:push

# Start development server
npm run dev
```

## Production Deployment

```bash
# Build for production
npm run build

# Start production server
npm start
```

### Railway Deployment

The application is configured for Railway deployment:

1. Connect your GitHub repository
2. Set environment variables in Railway dashboard
3. Deploy automatically on push to main

### Health Check

The application exposes a health endpoint at `/api/health` for monitoring.

## API Documentation

The API follows RESTful conventions with the following main resource paths:

- `/api/patients` - Patient management
- `/api/claims` - Claims processing
- `/api/appointments` - Scheduling
- `/api/soap-notes` - Clinical documentation
- `/api/analytics` - Reporting and analytics
- `/api/billing` - Payment processing

All endpoints require authentication except public booking and patient portal access.

## Security

- AES-256-GCM encryption for PHI at rest
- JWT-based authentication with 30-minute session timeout
- Row-level security (RLS) for multi-tenant isolation
- Audit logging with integrity verification
- Rate limiting on all endpoints

## HIPAA Compliance

This application includes infrastructure for HIPAA compliance:

- Encrypted PHI storage
- Comprehensive audit trails
- Breach notification workflows
- Patient rights management
- BAA tracking

**Note**: Deploying this application does not automatically make your practice HIPAA compliant. You must implement appropriate administrative and physical safeguards, conduct risk assessments, and ensure proper BAAs are in place with all vendors.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

For issues and feature requests, please open a GitHub issue.

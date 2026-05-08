# CLAUDE.md - AI Billing System

## Workflow
- After completing a round of changes, automatically run `npx tsc --noEmit` and `npm test` to verify everything works.
- If both pass, auto-commit the changes with a descriptive commit message without asking. Do not push unless explicitly asked.

## Project Overview
Medical billing and practice management platform for behavioral health / therapy practices. HIPAA-compliant with PHI encryption, MFA, audit logging, and breach management.

## Tech Stack
- **Frontend:** React 18, TypeScript, TailwindCSS, Radix UI, Wouter (routing), React Query, React Hook Form + Zod
- **Backend:** Express.js 4, Node.js 20+, TypeScript
- **Database:** PostgreSQL via Drizzle ORM (AWS RDS in production, pg driver locally)
- **Auth:** Passport.js local strategy, Argon2 hashing, express-session, MFA via TOTP
- **Build:** Vite (client), esbuild (server), tsx (dev)

## Commands
```bash
npm run dev          # Start dev server (tsx + vite, loads .env automatically)
npm run dev:local    # Start with local PostgreSQL
npm run build        # Production build (vite + esbuild)
npm start            # Run production server (dist/index.js)
npm run db:push      # Push schema changes to database
npm test             # Run all tests (vitest)
npm run test:server  # Server tests only
npm run test:client  # Client tests only
npm run check        # TypeScript type checking
```

## Project Structure
```
server/
  index.ts           # Entry point, security setup, middleware
  routes.ts          # Route registry and middleware orchestrator (218 lines)
  storage.ts         # Data access layer (large)
  db.ts              # Database connection (Neon or pg)
  routes/            # Modular route files
    auth.ts          # Auth, users, MFA, invites
    patients.ts      # Patient CRUD, insurance, eligibility
    claims.ts        # Claims CRUD, submission, status
    soap-notes.ts    # Clinical documentation, AI generation
    appointments.ts  # Scheduling, reminders
    analytics.ts     # Dashboard KPIs, revenue
  services/
    stediService.ts      # Stedi clearinghouse (eligibility 270/271, claims 837P, status 276/277)
    stripeService.ts     # Payment processing
    phiEncryptionService.ts  # AES-256-GCM encryption for PHI
    mfaService.ts        # Multi-factor authentication
    logger.ts            # Structured logging
  middleware/
    mfa-required.ts      # MFA enforcement for PHI routes
    auditMiddleware.ts   # PHI access audit logging
    rate-limiter.ts      # Rate limiting
  payer-integrations/
    adapters/payers/StediAdapter.ts  # Stedi payer adapter

client/src/
  App.tsx            # Root component, routing, lazy loading
  pages/             # 38 page components
  components/
    ui/              # 49 Radix UI wrapper components
  hooks/             # useAuth, useIdleTimeout, etc.
  lib/               # queryClient, authUtils, sanitize

shared/
  schema.ts          # Single source of truth: all Drizzle table definitions + Zod schemas (~2500 lines)

migrations/          # Drizzle SQL migrations (18 files)
```

## Key Integrations
| Service | Env Var | Purpose | Status |
|---------|---------|---------|--------|
| Stedi | `STEDI_API_KEY` | Eligibility, claims submission, claim status | Test key configured, sandbox verified |
| Stripe | `STRIPE_SECRET_KEY` | Patient/practice billing | Configured |
| Anthropic | `ANTHROPIC_API_KEY` | AI billing assistant (Claude), claim accuracy review, appeals | Configured |
| OpenAI | `OPENAI_API_KEY` | SOAP notes generation | Optional |
| Twilio | `TWILIO_ACCOUNT_SID` | SMS reminders | Optional |
| ElevenLabs | `ELEVENLABS_API_KEY` | Text-to-speech | Optional |
| SMTP | `SMTP_HOST` | Email notifications | Optional |

## Database
- Schema defined in `shared/schema.ts` using Drizzle ORM
- Config in `drizzle.config.ts` (uses `DIRECT_URL` or `DATABASE_URL`)
- Push changes with `npm run db:push` (no migration generation needed for dev)
- Key tables: users, practices, patients, insurances, claims, appointments, soapNotes, auditLogs

### Migration safety (zero-downtime deploys)
Production runs 2 ECS tasks behind ALB. During a rolling deploy, old and new code run side-by-side for ~30-90 seconds. Migrations that break old code = downtime.

Before merging any migration, run `scripts/lint-migrations.sh` (or `scripts/lint-migrations.sh --staged` as a pre-commit). It flags the patterns that always break rolling deploys: `DROP COLUMN`, `SET NOT NULL`, `RENAME COLUMN`, `RENAME TO`, `DROP TABLE`.

Use **expand → migrate → contract** for breaking changes:

| Want to do | Do this instead |
|---|---|
| Drop a column | (1) Deploy code that no longer reads it. (2) Drop in a follow-up migration. |
| Add NOT NULL constraint | (1) Add nullable. (2) Backfill data. (3) Add NOT NULL after every old task is gone (next deploy). |
| Rename a column | (1) Add new column. (2) Deploy code that writes both, reads either. (3) Backfill. (4) Deploy code reading only new. (5) Drop old column. |
| Rename a table | Create a view at the old name pointing to the new table. Ship for one release, then drop. |
| Drop a table | Deploy code that no longer touches it → drop in follow-up migration. |

Override (rare, only with a planned maintenance window): add `-- migration-lint: ignore (reason: <why>)` to the SQL file.

Migrations run as a separate ECS task (`therapybill-migrate`) **before** the app rolls out. The app deploy and migration deploy are deliberately decoupled — the migration completes (or fails fast) before any new app task is created.

## Authentication & Security
- Session-based auth with 30-min rolling idle timeout in production, 1-week in development (`express-session` `maxAge` in `server/replitAuth.ts`)
- MFA re-verification timeout: 15 min for PHI/admin routes (`MFA_SESSION_TIMEOUT` in `server/middleware/mfa-required.ts`)
- MFA required for PHI access routes (HIPAA 45 CFR 164.312(d))
- PHI encrypted at rest with AES-256-GCM (`PHI_ENCRYPTION_KEY`)
- Rate limiting: 1000 general / 20 auth / 100 API requests per window
- Audit trail with tamper detection

## Deployment
- **AWS ECS Fargate:** Production app hosting (us-east-1, 0.25 vCPU, 512MB)
- **AWS RDS PostgreSQL:** Production database (db.t4g.micro, encrypted, private subnet)
- **AWS ALB:** Load balancer with SSL (app.therapybillai.com)
- **AWS ECR:** Docker image registry (773320320189.dkr.ecr.us-east-1.amazonaws.com/therapybill-app)
- **AWS CodeBuild:** Builds Docker images from S3 source zip
- **HIPAA BAA:** Signed with AWS
- **Docker:** Multi-stage build, non-root user, health check at `/api/health`
- Production build outputs: `dist/index.js` (server) + `dist/public/` (client)
- **Domain:** app.therapybillai.com (SSL via ACM, DNS via Squarespace)
- **Deploy process:** zip source → upload to S3 → CodeBuild → ECR → ECS force-new-deployment

## Environment Variables (Required)
```
DATABASE_URL=        # PostgreSQL connection string (RDS in production)
SESSION_SECRET=      # Min 32 chars
PHI_ENCRYPTION_KEY=  # 64-char hex (32 bytes)
NODE_ENV=            # development or production
ANTHROPIC_API_KEY=   # Claude API key for AI billing assistant
STEDI_API_KEY=       # Stedi clearinghouse API key
STRIPE_SECRET_KEY=   # Stripe payment processing
STRIPE_PUBLISHABLE_KEY= # Stripe client-side key
```

## Testing
- Vitest for server and client tests
- Server: node environment, client: jsdom
- Testing libraries: @testing-library/react, supertest

## Conventions
- Route files go in `server/routes/` (modular pattern)
- Service files go in `server/services/`
- UI components use Radix UI primitives from `client/src/components/ui/`
- All database types derived from `shared/schema.ts`
- Zod schemas generated from Drizzle schemas via `drizzle-zod`
- Passwords hashed with Argon2 (never bcrypt)
- Use structured logger (`server/services/logger.ts`), not console.log in production code

## Current Status / Notes
- **Live at:** https://app.therapybillai.com (AWS ECS, HIPAA BAA signed)
- **Stedi:** Test key configured. Eligibility + claims work without enrollment for Aetna, UHC, Horizon BCBS, Anthem BCBS. ERA enrollment pending.
- **Stripe:** Test keys configured. Swap to live keys for real payments.
- **AI Assistant:** Claude-powered (Anthropic), available on every page
- **Patient Portal:** Fully integrated, access via Send Portal Link button in patient details
- **Data Import:** Supports SimplePractice, TherapyNotes, Jane App, WebPT, Fusion/Ensura, Prompt Health
- Routes fully refactored: `routes.ts` is now a 218-line router registry; 63 modular route files in `routes/`
- Storage layer: `storage.ts` delegates to modular files under `storage/`
- **Rate Limiting:** Redis-backed distributed rate limiting supported (set `REDIS_URL`); falls back to per-instance in-memory
- **PCI Compliance:** Payment card handling uses Stripe Elements + SetupIntent tokenization (PCI DSS compliant)

## Compliance
- All billing-related language must use "accuracy" framing, not "optimization" or "maximization"
- AI suggests codes — therapist must always make final coding decision
- Disclaimer required on customer-facing pages: "TherapyBill AI assists with billing accuracy by suggesting codes based on clinical documentation. All coding decisions must be reviewed and approved by the treating provider."

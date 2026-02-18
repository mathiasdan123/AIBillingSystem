# TherapyBill AI - Setup & Configuration Guide

## Quick Start

```bash
cd /Users/danielkramer/Documents/GitHub/AIBillingSystem
npm run dev
```

Then create a shareable tunnel:
```bash
cloudflared tunnel --url http://localhost:5000
```

---

## Environment Variables (.env)

Your `.env` file should contain:

```env
# Database (Supabase Direct Connection)
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.koqenszkqkykauljzicq.supabase.co:5432/postgres"
DIRECT_URL="postgresql://postgres:YOUR_PASSWORD@db.koqenszkqkykauljzicq.supabase.co:5432/postgres"

# Session
SESSION_SECRET=local-dev-secret-key-12345

# Supabase Auth
SUPABASE_URL=https://koqenszkqkykauljzicq.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Client-side Supabase (Vite)
VITE_SUPABASE_URL=https://koqenszkqkykauljzicq.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# PHI Encryption
PHI_ENCRYPTION_KEY=your_32_byte_hex_key

# OpenAI
OPENAI_API_KEY=your_key

# Eleven Labs
ELEVENLABS_API_KEY=your_key

# Stripe
STRIPE_SECRET_KEY=your_key
VITE_STRIPE_PUBLIC_KEY=your_key
STRIPE_WEBHOOK_SECRET=

# Stedi Clearinghouse
STEDI_API_KEY=your_key
```

### If Database Password Changes
1. Go to Supabase Dashboard → Settings → Database
2. Reset database password
3. Update `DATABASE_URL` and `DIRECT_URL` in `.env`
4. Restart server: `pkill -f node && npm run dev`

---

## Supabase Project Details

- **Project ID:** koqenszkqkykauljzicq
- **Dashboard:** https://supabase.com/dashboard/project/koqenszkqkykauljzicq
- **Database Host:** db.koqenszkqkykauljzicq.supabase.co
- **API URL:** https://koqenszkqkykauljzicq.supabase.co

### Key Locations in Dashboard
- **API Keys:** Settings → API
- **Database Password:** Settings → Database
- **SQL Editor:** SQL Editor (left sidebar)
- **Security Advisor:** Database → Security Advisor

---

## Row Level Security (RLS)

RLS policies were created in `/supabase/rls_policies.sql` but are currently **DISABLED** because the app uses direct PostgreSQL connections (not Supabase Auth).

### To Re-enable RLS (if switching to Supabase Auth)
Run in Supabase SQL Editor:
```sql
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
-- etc. (see rls_policies.sql for full list)
```

### To Disable RLS (current state)
```sql
ALTER TABLE public.patients DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims DISABLE ROW LEVEL SECURITY;
-- etc.
```

---

## Database Schema

71 tables total. Key tables:

| Table | Purpose |
|-------|---------|
| `users` | User accounts (has `practice_id`) |
| `practices` | Practice/clinic info |
| `patients` | Patient records (PHI) |
| `claims` | Insurance claims |
| `appointments` | Scheduling |
| `soap_notes` | Clinical notes |
| `eligibility_checks` | Insurance verification |
| `appeals` | Claim appeals |

### Tables WITH `practice_id` column
patients, claims, appointments, treatment_sessions, expenses, invoices, payments, appeals, waitlist, telehealth_sessions, conversations, etc.

### Tables WITHOUT `practice_id` (linked via foreign keys)
soap_notes (via session_id), claim_line_items (via claim_id), messages (via conversation_id), eligibility_checks (via patient_id)

### Shared Reference Tables (no practice isolation)
insurances, cpt_codes, icd10_codes, insurance_billing_rules

---

## Project Structure

```
AIBillingSystem/
├── client/                 # React frontend (Vite)
│   └── src/
│       ├── pages/          # Page components
│       ├── components/     # UI components
│       └── hooks/          # Custom hooks
├── server/                 # Express backend
│   ├── routes.ts           # API endpoints
│   ├── storage.ts          # Database operations
│   └── services/           # Business logic
├── shared/
│   └── schema.ts           # Drizzle ORM schema (all 71 tables)
├── supabase/
│   ├── rls_policies.sql    # RLS security policies
│   └── verify_rls.sql      # RLS verification script
└── .env                    # Environment variables
```

---

## Common Issues & Fixes

### 502 Bad Gateway (cloudflared tunnel)
- Server crashed. Check logs: `tail -50 /tmp/server.log`
- Restart: `pkill -f node && npm run dev`

### "password authentication failed"
- Database password changed in Supabase
- Update `.env` with new password from Supabase Dashboard → Settings → Database

### Safari can't connect to cloudflared tunnel
- Use Chrome instead (Safari has issues with Cloudflare tunnels)

### RLS blocking all queries
- Run disable script in Supabase SQL Editor (see rls_policies.sql comments)
- Or use `service_role` key which bypasses RLS

---

## Recent Features Added

1. **Analytics Dashboard** (`/analytics`)
   - 5 tabs: Overview, Patients, Payments, Therapists, Cancellations
   - Revenue tracking, patient visit limits, therapist performance

2. **Calendar Therapist Dropdown**
   - Select which therapist sees the client when scheduling

3. **Eligibility Check Fix**
   - Consistent results using patient ID as seed

4. **Reimbursement Page Layout Fix**
   - Fixed sidebar overlap with `md:ml-64` class

---

## Useful Commands

```bash
# Start development server
npm run dev

# Create shareable link
cloudflared tunnel --url http://localhost:5000

# Check if server is running
lsof -i :5000

# View server logs
tail -f /tmp/server.log

# Kill server
pkill -f node

# Type check
npm run check

# Database push (apply schema changes)
npm run db:push
```

---

## Getting Help

- **Claude Code:** Continue conversation with context
- **Supabase Docs:** https://supabase.com/docs
- **Drizzle ORM:** https://orm.drizzle.team/docs

---

*Last updated: February 18, 2026*

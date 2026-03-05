# TherapyBill AI - Security Architecture

## Overview

TherapyBill AI is a HIPAA-compliant healthcare billing platform. This document describes the security architecture, data access patterns, and compliance measures.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (React SPA)                          │
│  - Uses Supabase Auth for authentication                            │
│  - Stores JWT in memory/localStorage                                │
│  - Sends Bearer token to server                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTPS + JWT Bearer Token
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SERVER (Express + Node.js)                     │
│  - Validates JWT via Supabase Auth API                              │
│  - Extracts user_id and practice_id                                 │
│  - Applies practice-based data filtering                            │
│  - Uses Drizzle ORM for database queries                            │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ Direct PostgreSQL Connection
                                 │ (with service_role privileges)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SUPABASE POSTGRESQL DATABASE                    │
│  - Row Level Security (RLS) enabled on all tables                   │
│  - Policies enforce practice-based isolation                        │
│  - PHI data encrypted at rest (Supabase managed)                    │
│  - Connection via PgBouncer pooler                                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Authentication Flow

### 1. User Login
```
Client                    Supabase Auth              Server
  │                            │                        │
  │──── Login Request ────────►│                        │
  │                            │                        │
  │◄─── JWT Access Token ──────│                        │
  │                            │                        │
  │──── API Request + Bearer Token ────────────────────►│
  │                            │                        │
  │                            │◄── Verify Token ───────│
  │                            │                        │
  │                            │─── User Data ─────────►│
  │                            │                        │
  │◄─────────────────────────── Response ───────────────│
```

### 2. Token Verification (Server)
```typescript
// server/supabaseAuth.ts
const { data: { user }, error } = await supabase.auth.getUser(token);
if (error || !user) {
  return res.status(401).json({ message: 'Unauthorized' });
}
req.user = { claims: { sub: user.id } };
```

## Data Access Architecture

### Multi-Tenant Isolation

Data is isolated by `practice_id`. Every table containing practice-specific data includes a `practice_id` column.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           PRACTICE 1                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ Patients │ │  Claims  │ │Appointments│ │SOAP Notes│              │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                           PRACTICE 2                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ Patients │ │  Claims  │ │Appointments│ │SOAP Notes│              │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

### Row Level Security (RLS)

RLS is implemented at the database level as defense-in-depth:

```sql
-- Example policy for patients table
CREATE POLICY "patients_practice" ON patients
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

-- Helper function (in public schema due to Supabase auth schema protection)
CREATE FUNCTION public.rls_user_practice_id() RETURNS INTEGER AS $$
  SELECT practice_id::INTEGER FROM users WHERE id = auth.uid()::TEXT
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
```

### Access Layers

| Layer | Enforcement | Description |
|-------|-------------|-------------|
| **1. API Routes** | `isAuthenticated` middleware | Verifies JWT token |
| **2. Application** | Practice ID filtering | Server filters by practice_id |
| **3. Database** | RLS Policies | PostgreSQL enforces isolation |

## Database Connection Strategy

### Why Direct PostgreSQL (not Supabase API)?

The application uses direct PostgreSQL connections via Drizzle ORM instead of Supabase's REST API for:

1. **Performance**: Direct SQL is faster than REST API
2. **Flexibility**: Complex queries, transactions, joins
3. **Drizzle ORM**: Type-safe queries with TypeScript
4. **Batch Operations**: Efficient bulk inserts/updates

### Connection Configuration

```typescript
// server/db.ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL // PgBouncer pooler
});
```

### Service Role Usage

The server uses the database connection string (which has full access), NOT the `service_role` key. This means:

- Server can access all data (no RLS enforcement at query time)
- **Application layer MUST filter by practice_id**
- RLS policies serve as backup/defense-in-depth

## PHI Protection

### Encryption

| Data Type | Encryption Method |
|-----------|------------------|
| PHI at rest | Supabase managed (AES-256) |
| PHI in transit | TLS 1.3 |
| Sensitive fields (SSN, etc.) | Application-level AES-256-GCM |
| Payer credentials | AES-256 with separate key |

### PHI Encryption Service

```typescript
// server/services/phiEncryptionService.ts
export function encryptPatientRecord(data) {
  // Encrypts: SSN, notes, sensitive medical info
  return encryptedRecord;
}
```

## API Security

### Authentication Middleware

```typescript
// Applied to protected routes
app.get('/api/patients', isAuthenticated, async (req, res) => {
  // Only authenticated users reach here
});
```

### Role-Based Access Control

| Role | Permissions |
|------|-------------|
| `admin` | Full access, manage users, view audit logs |
| `billing` | Claims, payments, eligibility |
| `therapist` | Patients, appointments, SOAP notes |

```typescript
const isAdminOrBilling = async (req, res, next) => {
  const user = await storage.getUser(req.user.claims.sub);
  if (!['admin', 'billing'].includes(user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
};
```

## HIPAA Compliance Measures

### Technical Safeguards

| Requirement | Implementation |
|-------------|----------------|
| Access Control | JWT auth, role-based access |
| Audit Controls | `audit_log` table, all PHI access logged |
| Integrity | Database constraints, validation |
| Transmission Security | TLS 1.3, HTTPS only |

### Administrative Safeguards

| Requirement | Implementation |
|-------------|----------------|
| BAA Tracking | `baa_records` table |
| Breach Management | `breach_incidents` table, notification workflow |
| Amendment Requests | `amendment_requests` table |
| Access Logging | Full audit trail |

## Security Checklist

### Production Deployment

- [ ] Rotate all API keys in Supabase Dashboard
- [ ] Use environment variables (not .env file) in production
- [ ] Enable Supabase email confirmations
- [ ] Set up database backups
- [ ] Configure rate limiting
- [ ] Enable Supabase audit logging
- [ ] Review and test RLS policies
- [ ] Disable dev-user endpoint in production

### Environment Variables Required

```bash
# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Supabase (Auth only)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...  # For client auth
# DO NOT use SUPABASE_SERVICE_ROLE_KEY in production app code

# Encryption
PHI_ENCRYPTION_KEY=<32-byte-hex>
PAYER_CREDENTIAL_ENCRYPTION_KEY=<32-byte-hex>

# Third Party
OPENAI_API_KEY=sk-...
STRIPE_SECRET_KEY=sk_live_...
```

## Incident Response

### Breach Detection

1. Monitor `audit_log` for unusual access patterns
2. Alert on failed authentication attempts
3. Review `breach_incidents` table daily

### Breach Response

1. Immediate: Contain and assess
2. Within 24h: Document in `breach_incidents`
3. Within 60 days: HIPAA notification if required
4. Use built-in breach notification workflow

## Appendix: RLS Policy Summary

### Practice-Isolated Tables (50+)

All tables with `practice_id` have policies enforcing:
```sql
USING (practice_id = auth.user_practice_id())
```

### Shared Reference Tables

Read-only access for authenticated users:
- `insurances`
- `cpt_codes`
- `icd10_codes`
- `insurance_billing_rules`

### Admin-Only Tables

Additional admin check:
- `breach_incidents` (read)
- `baa_records` (all operations)

---

*Last Updated: March 2026*
*Document Version: 1.0*

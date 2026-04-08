import * as schema from "@shared/schema";
import { enableSlowQueryLogging, startPoolMonitor } from "./services/dbOptimizer";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Clean up connection string - remove unsupported parameters for standard pg driver
let connectionString = process.env.DATABASE_URL;
// Remove channel_binding parameter (Neon-specific, not supported by node-postgres)
connectionString = connectionString.replace(/[&?]channel_binding=[^&]*/g, '');

// Use Neon serverless driver ONLY when the DATABASE_URL points to a Neon endpoint.
// For AWS RDS (and all standard PostgreSQL), use the regular pg driver.
// The Neon driver uses WebSockets which RDS does not support.
const isNeonDatabase = connectionString.includes('.neon.tech') || !!process.env.REPLIT_DOMAINS;
const useRegularPg = !isNeonDatabase;

let pool: any;
let db: any;
let dbReady: Promise<void>;

// Initialize database connection
dbReady = (async () => {
  if (useRegularPg) {
    // Use regular pg driver for AWS RDS and local development
    const pg = await import('pg');
    const { drizzle: drizzlePg } = await import('drizzle-orm/node-postgres');
    pool = new pg.default.Pool({
      connectionString,
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      connectionTimeoutMillis: 5000,   // fail fast if no connection available in 5s
      idleTimeoutMillis: 30000,        // close idle connections after 30s
      statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000', 10),        // kill queries that run longer than 30s
    });
    db = drizzlePg({ client: pool, schema });
    console.error('Using regular PostgreSQL driver (pg)');
  } else {
    // Use neon-serverless only when connecting to a Neon database (WebSocket-based)
    const { Pool, neonConfig } = await import('@neondatabase/serverless');
    const { drizzle: drizzleNeon } = await import('drizzle-orm/neon-serverless');
    const ws = await import('ws');
    neonConfig.webSocketConstructor = ws.default;
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzleNeon({ client: pool, schema });
    console.error('Using Neon serverless driver');
  }

  // Enable slow query logging and pool monitoring
  enableSlowQueryLogging(pool);
  startPoolMonitor(pool);
})();

// Helper to ensure db is ready before use
async function getDb() {
  await dbReady;
  return db;
}

async function getPool() {
  await dbReady;
  return pool;
}

export { pool, db, dbReady, getDb, getPool };

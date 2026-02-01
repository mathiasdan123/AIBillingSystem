import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Use regular pg for local development, neon-serverless for production
const isLocalDev = process.env.NODE_ENV === 'development' && !process.env.REPLIT_DOMAINS;

let pool: any;
let db: any;
let dbReady: Promise<void>;

// Initialize database connection
dbReady = (async () => {
  if (isLocalDev) {
    // Use regular pg driver for local PostgreSQL
    const pg = await import('pg');
    const { drizzle: drizzlePg } = await import('drizzle-orm/node-postgres');
    pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzlePg({ client: pool, schema });
  } else {
    // Use neon-serverless for production (Replit/Neon)
    const { Pool, neonConfig } = await import('@neondatabase/serverless');
    const { drizzle: drizzleNeon } = await import('drizzle-orm/neon-serverless');
    const ws = await import('ws');
    neonConfig.webSocketConstructor = ws.default;
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzleNeon({ client: pool, schema });
  }
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

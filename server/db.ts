import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Clean up connection string - remove unsupported parameters for standard pg driver
let connectionString = process.env.DATABASE_URL;
// Remove channel_binding parameter (Neon-specific, not supported by node-postgres)
connectionString = connectionString.replace(/[&?]channel_binding=[^&]*/g, '');

// Use regular pg for local development, Railway, and Render - neon-serverless only for Replit/Neon
const isLocalDev = process.env.NODE_ENV === 'development' && !process.env.REPLIT_DOMAINS;
const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
const isRender = !!process.env.RENDER;
const useRegularPg = isLocalDev || isRailway || isRender;

let pool: any;
let db: any;
let dbReady: Promise<void>;

// Initialize database connection
dbReady = (async () => {
  if (useRegularPg) {
    // Use regular pg driver for local PostgreSQL and Railway
    const pg = await import('pg');
    const { drizzle: drizzlePg } = await import('drizzle-orm/node-postgres');
    pool = new pg.default.Pool({ connectionString });
    db = drizzlePg({ client: pool, schema });
    console.log('Using regular PostgreSQL driver');
  } else {
    // Use neon-serverless for production (Replit/Neon)
    const { Pool, neonConfig } = await import('@neondatabase/serverless');
    const { drizzle: drizzleNeon } = await import('drizzle-orm/neon-serverless');
    const ws = await import('ws');
    neonConfig.webSocketConstructor = ws.default;
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzleNeon({ client: pool, schema });
    console.log('Using Neon serverless driver');
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

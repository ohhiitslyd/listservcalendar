import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : { rejectUnauthorized: false },
  max: 10, // Maximum number of connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test connection on startup
pool.on("connect", () => {
  console.log("[db] Connected to PostgreSQL (Neon)");
});

pool.on("error", (err) => {
  console.error("[db] Unexpected error on idle client", err);
});

// Initialize schema
export async function initializeSchema() {
  const client = await pool.connect();
  try {
    // Email scraping table (raw email data)
    await client.query(`
      CREATE TABLE IF NOT EXISTS scraped_emails (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        gmail_message_id TEXT UNIQUE NOT NULL,
        thread_id TEXT,
        from_email TEXT,
        from_name TEXT,
        subject TEXT,
        body_text TEXT,
        body_html TEXT,
        received_date TEXT,
        scraped_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        processed INTEGER DEFAULT 0,
        attachments TEXT
      )
    `);

    // Unified events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        email_id TEXT REFERENCES scraped_emails(id),
        title TEXT,
        description TEXT,
        location TEXT,
        organization TEXT,
        tags TEXT,
        poster_url TEXT,
        start TEXT NOT NULL,
        "end" TEXT,
        all_day INTEGER DEFAULT 0,
        confidence_score REAL,
        status TEXT DEFAULT 'draft',
        google_event_id TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // App settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Admin tokens table for automated scraping OAuth
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_tokens (
        id SERIAL PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        user_email TEXT,
        refresh_token TEXT NOT NULL,
        access_token TEXT,
        token_expiry TEXT,
        is_scraper_account BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("[db] Schema initialized successfully");
  } finally {
    client.release();
  }
}

// Helper for queries that return rows
export async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

// Helper for queries that return a single row
export async function queryOne(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

// Helper for insert/update/delete that returns rowCount
export async function execute(text, params) {
  const result = await pool.query(text, params);
  return { rowCount: result.rowCount, rows: result.rows };
}

// Get a client for transactions
export async function getClient() {
  return pool.connect();
}

export { pool };
export default pool;

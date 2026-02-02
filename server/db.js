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

// Migration function to add new preference columns and migrate existing data
async function migrateUserPreferences(client) {
  try {
    // Check if organization_preference column exists
    const orgPrefCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'organization_preference'
    `);

    // Check if event_type_preference column exists
    const eventTypePrefCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'event_type_preference'
    `);

    // Add organization_preference column if it doesn't exist
    if (orgPrefCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS organization_preference TEXT[] DEFAULT '{}'
      `);
      console.log("[db] Added organization_preference column");
    } else {
      // Check if column is JSONB and needs conversion to TEXT[]
      const columnInfo = await client.query(`
        SELECT data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'organization_preference'
      `);
      
      if (columnInfo.rows[0]?.data_type === 'jsonb') {
        // Convert JSONB to TEXT[] by extracting array values
        await client.query(`
          ALTER TABLE users 
          ALTER COLUMN organization_preference TYPE TEXT[] 
          USING CASE 
            WHEN organization_preference::text = '{}' THEN '{}'::text[]
            WHEN jsonb_typeof(organization_preference) = 'array' 
              THEN ARRAY(SELECT jsonb_array_elements_text(organization_preference))
            ELSE '{}'::text[]
          END
        `);
        console.log("[db] Converted organization_preference from JSONB to TEXT[]");
      }
    }

    // Add event_type_preference column if it doesn't exist
    if (eventTypePrefCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS event_type_preference TEXT[] DEFAULT '{}'
      `);
      console.log("[db] Added event_type_preference column");
    } else {
      // Check if column is JSONB and needs conversion to TEXT[]
      const columnInfo = await client.query(`
        SELECT data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'event_type_preference'
      `);
      
      if (columnInfo.rows[0]?.data_type === 'jsonb') {
        // Convert JSONB to TEXT[] by extracting array values
        await client.query(`
          ALTER TABLE users 
          ALTER COLUMN event_type_preference TYPE TEXT[] 
          USING CASE 
            WHEN event_type_preference::text = '{}' THEN '{}'::text[]
            WHEN jsonb_typeof(event_type_preference) = 'array' 
              THEN ARRAY(SELECT jsonb_array_elements_text(event_type_preference))
            ELSE '{}'::text[]
          END
        `);
        console.log("[db] Converted event_type_preference from JSONB to TEXT[]");
      }
    }

    // Migrate existing preferences data if both new columns are empty and old preferences exist
    const usersWithOldPrefs = await client.query(`
      SELECT id, preferences 
      FROM users 
      WHERE preferences IS NOT NULL 
        AND preferences != '{}'::jsonb
        AND (
          organization_preference IS NULL 
          OR array_length(organization_preference, 1) IS NULL
          OR event_type_preference IS NULL 
          OR array_length(event_type_preference, 1) IS NULL
        )
    `);

    for (const user of usersWithOldPrefs.rows) {
      const oldPrefs = user.preferences || {};
      
      // Extract organization preferences (convert to array)
      let orgPrefArray = [];
      if (oldPrefs.organization) {
        orgPrefArray = Array.isArray(oldPrefs.organization) 
          ? oldPrefs.organization 
          : [oldPrefs.organization];
      } else if (oldPrefs.organization_preference) {
        orgPrefArray = Array.isArray(oldPrefs.organization_preference)
          ? oldPrefs.organization_preference
          : [oldPrefs.organization_preference];
      } else if (oldPrefs.orgCategories) {
        orgPrefArray = Array.isArray(oldPrefs.orgCategories)
          ? oldPrefs.orgCategories
          : [oldPrefs.orgCategories];
      }
      
      // Extract event type preferences (convert to array)
      let eventTypePrefArray = [];
      if (oldPrefs.eventType) {
        eventTypePrefArray = Array.isArray(oldPrefs.eventType)
          ? oldPrefs.eventType
          : [oldPrefs.eventType];
      } else if (oldPrefs.event_type_preference) {
        eventTypePrefArray = Array.isArray(oldPrefs.event_type_preference)
          ? oldPrefs.event_type_preference
          : [oldPrefs.event_type_preference];
      } else if (oldPrefs.categories) {
        eventTypePrefArray = Array.isArray(oldPrefs.categories)
          ? oldPrefs.categories
          : [oldPrefs.categories];
      } else if (oldPrefs.tags) {
        eventTypePrefArray = Array.isArray(oldPrefs.tags)
          ? oldPrefs.tags
          : [oldPrefs.tags];
      }

      // Update user with migrated preferences (as TEXT arrays)
      await client.query(`
        UPDATE users 
        SET 
          organization_preference = $1,
          event_type_preference = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [orgPrefArray, eventTypePrefArray, user.id]);
    }

    if (usersWithOldPrefs.rows.length > 0) {
      console.log(`[db] Migrated preferences for ${usersWithOldPrefs.rows.length} user(s)`);
    }
  } catch (error) {
    console.error("[db] Error during preferences migration:", error);
    // Don't throw - allow schema initialization to continue
  }
}

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
        organization_email TEXT,
        event_tags TEXT,
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

    // Add organization_email column if it doesn't exist
    await client.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS organization_email TEXT
    `);

    // Add event_tags column if it doesn't exist (event-type tags, e.g. "Free Food", "Performance")
    await client.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS event_tags TEXT
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

    // Users table for user profiles and preferences
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        picture_url TEXT,
        preferences JSONB DEFAULT '{}',
        organization_preference TEXT[] DEFAULT '{}',
        event_type_preference TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index on users email
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);

    // Create indexes for frequently queried columns
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_events_source ON events(source)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_events_status ON events(status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_events_email_id ON events(email_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scraped_emails_processed ON scraped_emails(processed)
    `);

    // Migration: Add new preference columns if they don't exist
    await migrateUserPreferences(client);

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

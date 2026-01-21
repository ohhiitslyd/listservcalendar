import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { google } from "googleapis";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import cron from "node-cron";
import { scrapeEmails } from "./services/emailScraper.js";
import { parseEmailForEvents } from "./services/llmParser.js";
import { runAutomatedScrape } from "./services/autoScraper.js";
import {
  publishEventToCalendar,
  getOrCreateListServCalendar as getOrCreateListServCalendarShared,
} from "./services/calendarPublisher.js";

dotenv.config();

// Resolve file location relative to this index.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load event type descriptors for LLM-based tagging
const EVENT_TYPE_PATH = path.join(
  __dirname,
  "..",
  "event_types",
  "event_type_des.json"
);

let EVENT_TYPE_RULES = { tags: {} };
try {
  const raw = fs.readFileSync(EVENT_TYPE_PATH, "utf8");
  EVENT_TYPE_RULES = JSON.parse(raw);
  console.log(
    "[event-types] loaded",
    Object.keys(EVENT_TYPE_RULES.tags || {}).length,
    "event type tags from",
    EVENT_TYPE_PATH
  );
} catch (e) {
  console.warn(
    "Could not read event_type_des.json. Event type tagging will be empty.",
    e
  );
}

// Export EVENT_TYPE_RULES for use in other modules
export { EVENT_TYPE_RULES };

const {
  PORT = 3000,
  SESSION_SECRET = "dev-secret",
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  FRONTEND_URL = "http://localhost:5173",
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.error("Missing Google OAuth env vars. Check .env.");
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: false },
  })
);

// SQLite setup
const db = new Database(path.join(__dirname, "db.sqlite"));

// Email scraping table (raw email data)
db.exec(`CREATE TABLE IF NOT EXISTS scraped_emails (
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
  scraped_at TEXT DEFAULT CURRENT_TIMESTAMP,
  processed INTEGER DEFAULT 0,
  attachments TEXT
);`);

try {
  db.exec(`ALTER TABLE scraped_emails ADD COLUMN attachments TEXT`);
} catch (e) {
  // Column already exists
}

// Unified events table (replaces drafts and email_events)
db.exec(`CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  email_id TEXT,
  title TEXT,
  description TEXT,
  location TEXT,
  organization TEXT,
  tags TEXT,
  poster_url TEXT,
  start TEXT NOT NULL,
  end TEXT,
  all_day INTEGER DEFAULT 0,
  confidence_score REAL,
  status TEXT DEFAULT 'draft',
  google_event_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (email_id) REFERENCES scraped_emails(id)
);`);

// Add google_event_id column if it doesn't exist
try {
  db.exec(`ALTER TABLE events ADD COLUMN google_event_id TEXT`);
} catch (e) {
  // Column already exists
}

// Add event_tags column for LLM-based event type tagging
try {
  db.exec(`ALTER TABLE events ADD COLUMN event_tags TEXT`);
  console.log("[db] Added event_tags column");
} catch (e) {
  // Column already exists
}

// App settings table for tracking scrape metadata
db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);`);

// Admin tokens table for automated scraping OAuth
db.exec(`CREATE TABLE IF NOT EXISTS admin_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT UNIQUE NOT NULL,
  user_email TEXT,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  token_expiry TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);`);

// Helper function for combining date and time
function combineDateTime(date, time, allDay) {
  if (!date) return null;
  if (time && !allDay) {
    return `${date}T${time}`;
  }
  return date;
}

// Migration: Merge drafts and email_events into events table
function runMigration() {
  console.log(
    "[db] Running migration: consolidating drafts and email_events..."
  );

  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('drafts', 'email_events', 'events')"
    )
    .all()
    .map((t) => t.name);

  const hasDrafts = tables.includes("drafts");
  const hasEmailEvents = tables.includes("email_events");
  const hasEvents = tables.includes("events");

  // Migrate drafts to events
  if (hasDrafts && !hasEvents) {
    console.log("[db] Migrating drafts to events table...");
    const drafts = db.prepare("SELECT * FROM drafts").all();
    for (const draft of drafts) {
      db.prepare(
        `INSERT INTO events(id, user_id, source, title, description, location, organization, tags, poster_url, start, end, all_day, status, created_at, updated_at)
         VALUES(?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
      ).run(
        draft.id,
        draft.user_id,
        draft.title || "",
        draft.description || "",
        draft.location || "",
        draft.organization || "",
        draft.tags || "[]",
        draft.poster_url || "",
        draft.start,
        draft.end || null,
        draft.all_day || 0,
        draft.created_at || new Date().toISOString(),
        draft.updated_at || new Date().toISOString()
      );
    }
    console.log(`[db] Migrated ${drafts.length} drafts to events`);
  }

  // Migrate email_events to events
  if (hasEmailEvents) {
    console.log("[db] Migrating email_events to events table...");
    const emailEvents = db.prepare("SELECT * FROM email_events").all();
    for (const evt of emailEvents) {
      // Combine date and time into ISO format
      const start = combineDateTime(
        evt.start_date,
        evt.start_time,
        evt.all_day
      );
      const end = combineDateTime(evt.end_date, evt.end_time, evt.all_day);

      if (start) {
        // Check if event already exists (might have been migrated from drafts)
        const existing = db
          .prepare("SELECT id FROM events WHERE id=?")
          .get(evt.id);
        if (!existing) {
          db.prepare(
            `INSERT INTO events(id, user_id, source, email_id, title, description, location, organization, tags, poster_url, start, end, all_day, confidence_score, status, created_at, updated_at)
             VALUES(?, ?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            evt.id,
            evt.user_id,
            evt.email_id || null,
            evt.title || "",
            evt.description || "",
            evt.location || "",
            evt.organization || "",
            evt.tags || "[]",
            "", // poster_url will be set when converting to draft
            start,
            end || null,
            evt.all_day || 0,
            evt.confidence_score || null,
            evt.status === "converted" ? "draft" : "draft",
            evt.extracted_at || new Date().toISOString(),
            evt.extracted_at || new Date().toISOString()
          );
        }
      }
    }
    console.log(`[db] Migrated ${emailEvents.length} email_events to events`);
  }

  // Drop old tables if migration successful
  if (hasEvents && (hasDrafts || hasEmailEvents)) {
    console.log("[db] Dropping old tables...");
    if (hasDrafts) {
      try {
        db.exec("DROP TABLE drafts");
        console.log("[db] Dropped drafts table");
      } catch (e) {
        console.warn("[db] Could not drop drafts table:", e.message);
      }
    }
    if (hasEmailEvents) {
      try {
        db.exec("DROP TABLE email_events");
        console.log("[db] Dropped email_events table");
      } catch (e) {
        console.warn("[db] Could not drop email_events table:", e.message);
      }
    }
  }

  // Ensure events table has all required columns
  const columns = db.pragma("table_info(events)").map((col) => col.name);
  const requiredColumns = {
    source: "TEXT NOT NULL DEFAULT 'manual'",
    email_id: "TEXT",
    confidence_score: "REAL",
  };

  for (const [col, def] of Object.entries(requiredColumns)) {
    if (!columns.includes(col)) {
      try {
        db.exec(`ALTER TABLE events ADD COLUMN ${col} ${def}`);
        console.log(`[db] Added column: ${col}`);
      } catch (e) {
        console.warn(`[db] Could not add column ${col}:`, e.message);
      }
    }
  }

  console.log("[db] Migration complete.");
}

runMigration(); // Run the migration on startup

// Prepared statements for events table
const eventInsert = db.prepare(
  `INSERT INTO events(id, user_id, source, email_id, title, description, location, organization, tags, poster_url, start, end, all_day, confidence_score, status)
   VALUES(@id, @user_id, @source, @email_id, @title, @description, @location, @organization, @tags, @poster_url, @start, @end, @all_day, @confidence_score, @status)`
);
const eventUpdate = db.prepare(
  `UPDATE events SET title=@title, description=@description, location=@location, organization=@organization, tags=@tags, poster_url=@poster_url,
   start=@start, end=@end, all_day=@all_day, updated_at=CURRENT_TIMESTAMP WHERE id=@id AND user_id=@user_id`
);
const eventDelete = db.prepare(
  "DELETE FROM events WHERE id=@id AND user_id=@user_id"
);
const eventsByUser = db.prepare(
  "SELECT * FROM events WHERE user_id=? AND status != 'published'"
);
const eventsByUserAndSource = db.prepare(
  "SELECT * FROM events WHERE user_id=? AND source=? AND status != 'published'"
);

function ensureAuthed(req, res, next) {
  if (!req.session.tokens || !req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

function getOAuthClient(req) {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
  if (req.session.tokens) oauth2Client.setCredentials(req.session.tokens);
  oauth2Client.on("tokens", (tokens) => {
    req.session.tokens = { ...req.session.tokens, ...tokens };
  });
  return oauth2Client;
}

// --- Helper: Ensure ListServ calendar exists (with session caching) ---
async function getOrCreateListServCalendar(req, oauth2Client) {
  // Use session cache if available
  if (req.session.listservCalendarId) {
    return { id: req.session.listservCalendarId, created: false };
  }
  // Use shared function for actual work
  const result = await getOrCreateListServCalendarShared(oauth2Client);
  // Cache the result in session
  req.session.listservCalendarId = result.id;
  return result;
}

// beginning of additions

// ---- Key normalization helpers (add near the top, after JSON loads) ----
// ============================================================================
// OLD TAGGING SYSTEM - DEPRECATED (Replaced by LLM-based event type tagging)
// Event tags are now assigned by LLM during email parsing using event_type_des.json
// This provides more accurate, context-aware tagging
// ============================================================================

// --- Auth ---
app.get("/auth/google", (req, res) => {
  const oauth2Client = getOAuthClient(req);
  const scopes = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.readonly",
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    const { tokens } = await oauth2Client.getToken(req.query.code);
    req.session.tokens = tokens;
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userinfo } = await oauth2.userinfo.get();
    req.session.user = {
      id: userinfo.id || userinfo.email,
      email: userinfo.email,
      name: userinfo.name,
    };
    await getOrCreateListServCalendar(req, oauth2Client);

    // Store admin tokens for automated scraping
    // Only store if we have a refresh_token (first time or re-consent)
    if (tokens.refresh_token) {
      try {
        db.prepare(
          `INSERT OR REPLACE INTO admin_tokens 
          (user_id, user_email, refresh_token, access_token, token_expiry, updated_at) 
          VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          userinfo.id || userinfo.email,
          userinfo.email,
          tokens.refresh_token,
          tokens.access_token || null,
          tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : null,
          new Date().toISOString()
        );
        console.log(
          `[auth] Stored admin tokens for automated scraping: ${userinfo.email}`
        );
      } catch (dbError) {
        console.error("[auth] Failed to store admin tokens:", dbError);
        // Don't fail auth if token storage fails
      }
    }

    res.redirect(FRONTEND_URL);
  } catch (e) {
    console.error(e);
    res.status(500).send("Authentication failed");
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});
app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// --- List all user calendars ---
app.get("/api/calendars", ensureAuthed, async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const resp = await calendar.calendarList.list();
    const items = (resp.data.items || []).map((c) => ({
      id: c.id,
      summary: c.summary,
      accessRole: c.accessRole,
      primary: c.primary || false,
      backgroundColor: c.backgroundColor,
    }));
    res.json({ calendars: items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch calendar list" });
  }
});

// --- Current ListServ calendar info ---
app.get("/api/calendar", ensureAuthed, async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const { id: calendarId, created } = await getOrCreateListServCalendar(
      req,
      oauth2Client
    );
    const { data } = await calendar.calendars.get({ calendarId });
    res.json({
      id: data.id,
      summary: data.summary,
      timeZone: data.timeZone,
      accessRole: data.accessRole || "unknown",
      created,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch calendar info" });
  }
});

// --- Get events (multi-calendar) ---
app.get("/api/events", ensureAuthed, async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const { id: listservCalendarId } = await getOrCreateListServCalendar(
      req,
      oauth2Client
    );

    const now = new Date();
    const timeMin =
      req.query.timeMin ||
      new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const timeMax =
      req.query.timeMax ||
      new Date(
        now.getFullYear(),
        now.getMonth() + 3,
        0,
        23,
        59,
        59
      ).toISOString();

    // Fetch events from requested calendars (including listserv calendar)
    // Published events will come from Google Calendar, drafts from local DB
    const requestedIds = req.query.calendarIds
      ? req.query.calendarIds.split(",")
      : ["primary"];

    const allEvents = [];
    for (const calId of requestedIds) {
      const googleResp = await calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
      });
      const googleEvents = (googleResp.data.items || []).map((ev) => {
        const isAllDay = !!ev.start?.date;
        const props = ev.extendedProperties?.shared || {};
        return {
          id: `google:${ev.id}`,
          calendarId: calId,
          source: "google",
          title: ev.summary || "(No title)",
          description: ev.description || "",
          location: ev.location || "",
          start: isAllDay ? ev.start.date : ev.start?.dateTime,
          end: isAllDay ? ev.end.date : ev.end?.dateTime,
          allDay: isAllDay,
          organization: props.organization || "",
          tags: JSON.parse(props.tags || "[]"),
          poster_url: props.poster_url || "",
        };
      });
      allEvents.push(...googleEvents);
    }

    const localEvents = eventsByUser.all(req.session.user.id).map((e) => ({
      id: e.source === "manual" ? `draft:${e.id}` : `email:${e.id}`,
      source: e.source === "manual" ? "draft" : "email",
      title: e.title || (e.source === "manual" ? "(Draft)" : "(Event)"),
      description: e.description || "",
      location: e.location || "",
      start: e.start,
      end: e.end,
      allDay: !!e.all_day,
      organization: e.organization || "",
      tags: JSON.parse(e.tags || "[]"), // De-serialize tags from JSON string
      poster_url: e.poster_url || "",
    }));

    // Combine all events (tags come from LLM, no additional processing needed)
    const combined = [...localEvents, ...allEvents];

    // Helper: identify ListServ events so only they get filtered away
    const isListServ = (ev) => {
      const isDraft = ev.source === "draft" || ev.source === "email";
      const isGoogleListServ =
        ev.source === "google" && ev.calendarId === listservCalendarId;
      return isDraft || isGoogleListServ;
    };

    // Filter by categories (event type tags) if requested
    // Accept both 'categories' (frontend) and 'eventTypes' (legacy) parameters
    let filtered = combined;
    const categoriesParam = req.query.categories || req.query.eventTypes;

    if (categoriesParam) {
      const reqCategories = categoriesParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      filtered = combined.filter((ev) => {
        // Non-ListServ events are always kept, regardless of filters
        if (!isListServ(ev)) return true;

        // For ListServ events, check if they match any requested categories
        return (ev.tags || []).some((tag) => reqCategories.includes(tag));
      });
    }

    res.json({ events: filtered });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to reach events" });
  }
});

// Get event type tags for filtering (LLM-based tagging)
app.get("/api/event-types", ensureAuthed, (req, res) => {
  const tags = EVENT_TYPE_RULES?.tags || {};
  const list = Object.entries(tags).map(([tagName, def]) => ({
    tag: tagName,
    description: def.description,
    keywords: def.keywords || [],
  }));
  res.json({ eventTypes: list });
});

// Alias for frontend compatibility - returns categories in expected format
app.get("/api/event-categories", ensureAuthed, (req, res) => {
  const tags = EVENT_TYPE_RULES?.tags || {};
  const categories = Object.entries(tags).map(([tagName, def]) => ({
    key: tagName,
    label: tagName,
    description: def.description,
  }));
  res.json({ categories });
});

// --- Drafts (now using unified events table) ---
app.post("/api/drafts", ensureAuthed, (req, res) => {
  try {
    const {
      title,
      description,
      location,
      start,
      end,
      allDay,
      organization,
      tags,
      poster_url,
    } = req.body;
    if (!start) return res.status(400).json({ error: "start required" });
    const id = `draft_${crypto.randomBytes(12).toString("hex")}`;
    const tagsJson = Array.isArray(tags)
      ? JSON.stringify(tags)
      : tags || "[]";
    eventInsert.run({
      id,
      user_id: req.session.user.id,
      source: "manual",
      email_id: null,
      title: title || "",
      description: description || "",
      location: location || "",
      organization: organization || "",
      tags: tagsJson,
      poster_url: poster_url || "",
      start,
      end: end || null,
      all_day: allDay ? 1 : 0,
      confidence_score: null,
      status: "draft",
    });
    res.json({ ok: true, id: `draft:${id}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create draft" });
  }
});

// --- Delete events ---
app.delete("/api/events/:compoundId", ensureAuthed, async (req, res) => {
  try {
    const [source, rawId] = req.params.compoundId.split(":");

    if (source === "draft" || source === "email") {
      // Check if event was published to Google Calendar
      const event = db
        .prepare(
          "SELECT google_event_id, status FROM events WHERE id=? AND user_id=?"
        )
        .get(rawId, req.session.user.id);

      // Delete from Google Calendar if it was published
      if (event && event.google_event_id && event.status === "published") {
        try {
          const oauth2Client = getOAuthClient(req);
          const calendar = google.calendar({
            version: "v3",
            auth: oauth2Client,
          });
          const { id: listservCalendarId } = await getOrCreateListServCalendar(
            req,
            oauth2Client
          );
          await calendar.events.delete({
            calendarId: listservCalendarId,
            eventId: event.google_event_id,
          });
          console.log(
            `[delete] Deleted event ${rawId} from Google Calendar (${event.google_event_id})`
          );
        } catch (gcalError) {
          console.error(
            `[delete] Failed to delete from Google Calendar:`,
            gcalError.message
          );
          // Continue to delete from local DB even if Google Calendar delete fails
        }
      }

      // Delete from local database
      eventDelete.run({ id: rawId, user_id: req.session.user.id });
      return res.json({ ok: true });
    }

    if (source === "google") {
      const oauth2Client = getOAuthClient(req);
      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      const { id: listservCalendarId } = await getOrCreateListServCalendar(
        req,
        oauth2Client
      );
      await calendar.events.delete({
        calendarId: listservCalendarId,
        eventId: rawId,
      });
      return res.json({ ok: true });
    }

    res.status(400).json({ error: "Unknown event source" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete event" });
  }
});

// --- Delete all events from ListServ calendar ---
app.delete("/api/calendar/events", ensureAuthed, async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const { id: listservCalendarId } = await getOrCreateListServCalendar(
      req,
      oauth2Client
    );

    // Get all events from the listserv calendar
    const now = new Date();
    const timeMin = new Date(now.getFullYear() - 1, 0, 1).toISOString();
    const timeMax = new Date(
      now.getFullYear() + 2,
      11,
      31,
      23,
      59,
      59
    ).toISOString();

    let nextPageToken = null;
    let deletedCount = 0;
    let errorCount = 0;

    do {
      const response = await calendar.events.list({
        calendarId: listservCalendarId,
        timeMin,
        timeMax,
        maxResults: 2500,
        pageToken: nextPageToken,
        singleEvents: true,
      });

      const events = response.data.items || [];
      nextPageToken = response.data.nextPageToken;

      // Delete each event
      for (const event of events) {
        try {
          await calendar.events.delete({
            calendarId: listservCalendarId,
            eventId: event.id,
          });
          deletedCount++;
        } catch (error) {
          console.error(`Failed to delete event ${event.id}:`, error.message);
          errorCount++;
        }
      }
    } while (nextPageToken);

    res.json({
      success: true,
      deleted: deletedCount,
      errors: errorCount,
      message: `Deleted ${deletedCount} events from Google Calendar`,
    });
  } catch (e) {
    console.error("[delete-gcal] Error:", e);
    res.status(500).json({
      error: "Failed to delete events from Google Calendar",
      details: e.message,
    });
  }
});

app.post("/api/events/:compoundId/publish", ensureAuthed, async (req, res) => {
  try {
    const [source, rawId] = req.params.compoundId.split(":");
    if (source !== "draft" && source !== "email")
      return res
        .status(400)
        .json({ error: "Only drafts or email events can be published" });
    const row = db
      .prepare(`SELECT * FROM events WHERE id=? AND user_id=?`)
      .get(rawId, req.session.user.id);
    if (!row) return res.status(404).json({ error: "Event not found" });

    // Validate dates
    if (!row.start) {
      return res.status(400).json({ error: "Invalid event date" });
    }

    if (!row.all_day) {
      // For timed events, ensure it's a valid ISO datetime string
      if (!row.start.includes("T") || isNaN(new Date(row.start).getTime())) {
        console.error(
          `[publish] Invalid datetime format for event ${rawId}: ${row.start}`
        );
        return res.status(400).json({ error: "Invalid event datetime format" });
      }
    }

    // Parse tags from database
    const eventTags = row.tags
      ? JSON.parse(row.tags)
      : [];

    const oauth2Client = getOAuthClient(req);
    const result = await publishEventToCalendar({
      oauth2Client,
      db,
      eventId: rawId,
      userId: req.session.user.id,
      title: row.title || "",
      description: row.description || "",
      location: row.location || "",
      organization: row.organization || "",
      eventTags,
      posterUrl: row.poster_url || "",
      start: row.start,
      end: row.end || row.start,
      allDay: !!row.all_day,
      logPrefix: "[publish]",
    });

    if (!result.success) {
      return res.status(500).json({
        error: "Failed to publish event to Google Calendar",
        details: result.error,
      });
    }

    res.json({
      ok: true,
      published: { id: `google:${result.google_event_id}` },
    });
  } catch (e) {
    console.error(`[publish] Error publishing event:`, e);
    console.error(`[publish] Error details:`, {
      message: e.message,
      stack: e.stack,
      response: e.response?.data,
    });
    res
      .status(500)
      .json({ error: "Failed to publish event", details: e.message });
  }
});

// --- Email Scraping Endpoints ---

// Scrape emails from Gmail
app.post("/api/scrape/emails", ensureAuthed, async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    const userId = req.session.user.id;

    const {
      maxResults = 50,
      query = "to:campus-events@dartmouth.edu",
      force = false,
    } = req.body;

    const result = await scrapeEmails(oauth2Client, userId, db, {
      maxResults,
      query,
      skipExisting: !force,
      force,
    });

    res.json(result);
  } catch (e) {
    console.error("[scrape] Error:", e);
    res
      .status(500)
      .json({ error: "Failed to scrape emails", details: e.message });
  }
});

app.post("/api/scrape/process", ensureAuthed, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { emailId = null, reprocess = false } = req.body;

    let emailsToProcess = [];

    if (emailId) {
      // Process specific email
      const email = db
        .prepare("SELECT * FROM scraped_emails WHERE id=? AND user_id=?")
        .get(emailId, userId);
      if (!email) {
        return res.status(404).json({ error: "Email not found" });
      }
      emailsToProcess = [email];
    } else {
      // Process all emails (or only unprocessed if reprocess=false)
      const query = reprocess
        ? "SELECT * FROM scraped_emails WHERE user_id=? ORDER BY received_date DESC"
        : "SELECT * FROM scraped_emails WHERE user_id=? AND processed=0 ORDER BY received_date DESC";
      emailsToProcess = db.prepare(query).all(userId);
    }

    let processed = 0;
    let eventsCreated = 0;
    const errors = [];

    for (const email of emailsToProcess) {
      try {
        // Skip if already processed (unless reprocessing)
        if (!reprocess && email.processed) {
          continue;
        }

        // If reprocessing, delete old events first (both local and Google Calendar)
        if (reprocess) {
          // Get events that will be deleted so we can remove them from Google Calendar
          const eventsToDelete = db
            .prepare(
              "SELECT id, google_event_id, status FROM events WHERE email_id=? AND user_id=?"
            )
            .all(email.id, userId);

          // Delete from Google Calendar if they were published
          if (eventsToDelete.length > 0) {
            try {
              const oauth2Client = getOAuthClient(req);
              const calendar = google.calendar({
                version: "v3",
                auth: oauth2Client,
              });
              const { id: listservCalendarId } =
                await getOrCreateListServCalendar(req, oauth2Client);

              for (const evt of eventsToDelete) {
                if (evt.google_event_id && evt.status === "published") {
                  try {
                    await calendar.events.delete({
                      calendarId: listservCalendarId,
                      eventId: evt.google_event_id,
                    });
                    console.log(
                      `[process] Deleted event ${evt.id} from Google Calendar (${evt.google_event_id}) during reprocess`
                    );
                  } catch (gcalError) {
                    console.error(
                      `[process] Failed to delete event ${evt.id} from Google Calendar:`,
                      gcalError.message
                    );
                    // Continue even if deletion fails
                  }
                }
              }
            } catch (authError) {
              console.error(
                `[process] Failed to authenticate for Google Calendar deletion:`,
                authError.message
              );
              // Continue with local deletion even if Google Calendar deletion fails
            }
          }

          // Delete from local database
          db.prepare("DELETE FROM events WHERE email_id=? AND user_id=?").run(
            email.id,
            userId
          );
          db.prepare("UPDATE scraped_emails SET processed=0 WHERE id=?").run(
            email.id
          );
        }

        const events = await parseEmailForEvents(email);

        if (events.length === 0) {
          console.warn(
            `[process] No events extracted from email: ${
              email.subject || email.id
            }`
          );
        }

        for (const event of events) {
          const eventId = `email_event_${crypto
            .randomBytes(12)
            .toString("hex")}`;

          // Tags come from LLM parsing (event.tags)
          const tagsJson = event.tags
            ? JSON.stringify(event.tags)
            : "[]";

          const start = combineDateTime(
            event.startDate,
            event.startTime,
            event.allDay
          );

          let end = combineDateTime(event.endDate, event.endTime, event.allDay);

          if (!start) {
            console.warn(
              `[process] Skipping event ${eventId} - missing start date`
            );
            continue;
          }

          // Validate: if end date is different from start date, reset to same day
          // Most campus events are single-day; multi-day is likely a parsing error
          if (
            end &&
            event.endDate &&
            event.startDate &&
            event.endDate !== event.startDate
          ) {
            console.warn(
              `[process] Multi-day event detected (likely parsing error), resetting end to same day:`,
              {
                title: event.title,
                startDate: event.startDate,
                endDate: event.endDate,
              }
            );
            // Keep the end time but use the start date
            end = combineDateTime(event.startDate, event.endTime, event.allDay);
          }

          if (event.startTime && !event.endTime && !event.allDay && start) {
            const startDate = new Date(start);
            const endDate = new Date(startDate);
            endDate.setHours(endDate.getHours() + 1);
            end = endDate.toISOString();
          } else if (event.allDay && !end) {
            end = start;
          }

          // Check for duplicates:
          // 1. Same email + same title + same start date = duplicate (skip)
          // 2. Same title + same start date + same organization = duplicate (skip)
          // 3. Same title + same start date but different organization = keep both
          const startDateOnly = start.split("T")[0];

          // First check: duplicate from same email
          const duplicateFromSameEmail = db
            .prepare(
              "SELECT id FROM events WHERE user_id=? AND email_id=? AND title=? AND start LIKE ?"
            )
            .get(userId, email.id, event.title, `${startDateOnly}%`);

          if (duplicateFromSameEmail) {
            continue; // Skip duplicate from same email
          }

          // Second check: duplicate with same title, start date, and organization
          const duplicateSameOrg = db
            .prepare(
              "SELECT id FROM events WHERE user_id=? AND title=? AND organization=? AND start LIKE ?"
            )
            .get(
              userId,
              event.title,
              event.organization || "",
              `${startDateOnly}%`
            );

          if (duplicateSameOrg) {
            continue; // Skip duplicate with same organization
          }

          eventInsert.run({
            id: eventId,
            user_id: userId,
            source: "email",
            email_id: email.id,
            title: event.title || "",
            description: event.description || "",
            location: event.location || "",
            organization: event.organization || "",
            tags: tagsJson,
            poster_url: event.posterUrl || "",
            start,
            end: end || null,
            all_day: event.allDay ? 1 : 0,
            confidence_score: event.confidenceScore || null,
            status: "draft",
          });

          // Auto-publish email-sourced events to Google Calendar
          const oauth2Client = getOAuthClient(req);
          await publishEventToCalendar({
            oauth2Client,
            db,
            eventId,
            userId,
            title: event.title || "",
            description: event.description || "",
            location: event.location || "",
            organization: event.organization || "",
            eventTags: event.tags || [],
            posterUrl: event.posterUrl || "",
            start,
            end: end || start,
            allDay: event.allDay,
            logPrefix: "[process]",
          });
          // Note: publishEventToCalendar handles errors internally and logs them

          eventsCreated++;
        }

        db.prepare("UPDATE scraped_emails SET processed=1 WHERE id=?").run(
          email.id
        );
        processed++;
      } catch (error) {
        console.error(`[process] Error processing email ${email.id}:`, error);
        errors.push({ emailId: email.id, error: error.message });
      }
    }

    res.json({
      success: true,
      processed,
      eventsCreated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    console.error("[process] Error:", e);
    res
      .status(500)
      .json({ error: "Failed to process emails", details: e.message });
  }
});

// Get scraped emails
app.get("/api/scraped-emails", ensureAuthed, (req, res) => {
  try {
    const userId = req.session.user.id;
    const { limit = 50, offset = 0, processed = null } = req.query;

    let query = "SELECT * FROM scraped_emails WHERE user_id=?";
    const params = [userId];

    if (processed !== null) {
      query += " AND processed=?";
      params.push(processed === "true" ? 1 : 0);
    }

    query += " ORDER BY received_date DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), parseInt(offset));

    const emails = db.prepare(query).all(...params);

    // Parse attachments JSON for each email
    const emailsWithAttachments = emails.map((email) => ({
      ...email,
      attachments: email.attachments ? JSON.parse(email.attachments) : null,
    }));

    res.json({ emails: emailsWithAttachments });
  } catch (e) {
    console.error("[scraped-emails] Error:", e);
    res.status(500).json({ error: "Failed to fetch scraped emails" });
  }
});

// Get extracted events from emails (now from unified events table)
app.get("/api/email-events", ensureAuthed, (req, res) => {
  try {
    const userId = req.session.user.id;
    const { status = null, limit = 50, offset = 0 } = req.query;

    let query = "SELECT * FROM events WHERE user_id=? AND source='email'";
    const params = [userId];

    if (status) {
      query += " AND status=?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), parseInt(offset));

    const events = db.prepare(query).all(...params);

    // Parse tags JSON for each event
    const eventsWithParsedTags = events.map((event) => ({
      ...event,
      tags: event.tags ? JSON.parse(event.tags) : [],
    }));

    res.json({ events: eventsWithParsedTags });
  } catch (e) {
    console.error("[email-events] Error:", e);
    res.status(500).json({ error: "Failed to fetch email events" });
  }
});

// Export scraped emails to JSON file
app.get("/api/scraped-emails/export", ensureAuthed, (req, res) => {
  try {
    const userId = req.session.user.id;
    const emails = db
      .prepare(
        "SELECT * FROM scraped_emails WHERE user_id=? ORDER BY received_date DESC"
      )
      .all(userId);

    // Parse attachments JSON for each email
    const emailsWithAttachments = emails.map((email) => ({
      ...email,
      attachments: email.attachments ? JSON.parse(email.attachments) : null,
    }));

    // Write to JSON file
    const exportPath = path.join(__dirname, "scraped_emails_export.json");
    fs.writeFileSync(
      exportPath,
      JSON.stringify(
        { emails: emailsWithAttachments, exportedAt: new Date().toISOString() },
        null,
        2
      )
    );

    res.json({
      success: true,
      count: emails.length,
      filePath: exportPath,
      message: `Exported ${emails.length} emails to ${exportPath}`,
    });
  } catch (e) {
    console.error("[export] Error:", e);
    res.status(500).json({ error: "Failed to export emails" });
  }
});

// Get attachment image for an email
app.get(
  "/api/scraped-emails/:emailId/attachments/:contentId",
  ensureAuthed,
  (req, res) => {
    try {
      const userId = req.session.user.id;
      const { emailId, contentId } = req.params;

      const email = db
        .prepare("SELECT * FROM scraped_emails WHERE id=? AND user_id=?")
        .get(emailId, userId);

      if (!email) {
        return res.status(404).json({ error: "Email not found" });
      }

      if (!email.attachments) {
        return res.status(404).json({ error: "No attachments found" });
      }

      const attachments = JSON.parse(email.attachments);

      // Try exact match first, then case-insensitive match, then partial match
      const attachment = attachments.find((att) => {
        if (!att.contentId) return false;
        const attId = att.contentId.toLowerCase();
        const searchId = contentId.toLowerCase();
        return (
          att.contentId === contentId ||
          attId === searchId ||
          attId.includes(searchId) ||
          searchId.includes(attId)
        );
      });

      if (!attachment || !attachment.data) {
        console.error(
          `[attachment] Not found: emailId=${emailId}, contentId=${contentId}`
        );
        console.error(
          `[attachment] Available contentIds:`,
          attachments.map((a) => a.contentId)
        );
        return res.status(404).json({ error: "Attachment not found" });
      }

      // Decode base64 and send as image
      const imageBuffer = Buffer.from(attachment.data, "base64");
      res.setHeader("Content-Type", attachment.mimeType || "image/jpeg");
      res.setHeader("Content-Length", imageBuffer.length);
      res.send(imageBuffer);
    } catch (e) {
      console.error("[attachment] Error:", e);
      res.status(500).json({ error: "Failed to fetch attachment" });
    }
  }
);

// Update email event poster_url (email events are already drafts, just need to set poster)
app.post("/api/email-events/:eventId/to-draft", ensureAuthed, (req, res) => {
  try {
    const userId = req.session.user.id;
    const eventId = req.params.eventId;

    const event = db
      .prepare(
        "SELECT * FROM events WHERE id=? AND user_id=? AND source='email'"
      )
      .get(eventId, userId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Get the source email to check for attachments
    const email = db
      .prepare("SELECT * FROM scraped_emails WHERE id=? AND user_id=?")
      .get(event.email_id, userId);

    // Generate poster_url from first attachment if available
    let posterUrl = "";
    if (email && email.attachments) {
      try {
        const attachments = JSON.parse(email.attachments);
        if (attachments && attachments.length > 0) {
          const firstAttachment = attachments[0];
          // Generate URL to serve the image
          const baseUrl = `${req.protocol}://${req.get("host")}`;
          posterUrl = `${baseUrl}/api/scraped-emails/${email.id}/attachments/${firstAttachment.contentId}`;

          // Update the event with poster_url
          db.prepare(
            "UPDATE events SET poster_url=? WHERE id=? AND user_id=?"
          ).run(posterUrl, eventId, userId);
        }
      } catch (e) {
        console.error("[to-draft] Error parsing attachments:", e);
      }
    }

    res.json({ ok: true, eventId: `email:${eventId}`, poster_url: posterUrl });
  } catch (e) {
    console.error("[to-draft] Error:", e);
    res.status(500).json({ error: "Failed to update event" });
  }
});

// --- Automated Scraping Endpoint (Manual Trigger) ---
app.post("/api/scrape/auto-run", ensureAuthed, async (req, res) => {
  try {
    console.log("[manual-scrape] Manually triggered automated scrape");
    const result = await runAutomatedScrape(db);
    res.json(result);
  } catch (e) {
    console.error("[manual-scrape] Error:", e);
    res.status(500).json({
      success: false,
      error: "Failed to run automated scrape",
      details: e.message,
    });
  }
});

// --- Clear ListServ Calendar Endpoint ---
app.post("/api/clear-listserv-calendar", ensureAuthed, async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const { id: listservCalendarId } = await getOrCreateListServCalendar(
      req,
      oauth2Client
    );

    console.log(`[clear-calendar] Fetching events from ListServ calendar...`);

    // Get all events
    const events = await calendar.events.list({
      calendarId: listservCalendarId,
      maxResults: 2500,
      singleEvents: false,
    });

    const eventList = events.data.items || [];
    console.log(`[clear-calendar] Found ${eventList.length} events to delete`);

    let deleted = 0;
    const errors = [];

    // Delete each event
    for (const event of eventList) {
      try {
        await calendar.events.delete({
          calendarId: listservCalendarId,
          eventId: event.id,
        });
        deleted++;
        if (deleted % 10 === 0) {
          console.log(
            `[clear-calendar] Deleted ${deleted}/${eventList.length}...`
          );
        }
      } catch (error) {
        console.error(
          `[clear-calendar] Failed to delete ${event.id}:`,
          error.message
        );
        errors.push({ eventId: event.id, error: error.message });
      }
    }

    console.log(
      `[clear-calendar] Complete: ${deleted} deleted, ${errors.length} errors`
    );

    res.json({
      success: true,
      deleted,
      total: eventList.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    console.error("[clear-calendar] Error:", e);
    res
      .status(500)
      .json({ error: "Failed to clear calendar", details: e.message });
  }
});

// --- Serve frontend ---
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (!req.path.startsWith("/api") && !req.path.startsWith("/auth")) {
    try {
      return res.sendFile(path.join(clientDist, "index.html"));
    } catch {}
  }
  next();
});

// --- Setup Automated Email Scraping (Every 12 Hours) ---
// Cron schedule: '0 */12 * * *' runs at minute 0 of every 12th hour (00:00, 12:00)
// Alternative: '0 0,12 * * *' explicitly runs at midnight and noon
cron.schedule("0 */12 * * *", async () => {
  console.log("\n[CRON] ⏰ Automated email scrape triggered");
  try {
    const result = await runAutomatedScrape(db);
    if (result.success) {
      console.log(
        `[CRON] ✅ Scrape successful: ${result.eventsCreated} events created`
      );
    } else {
      console.error(`[CRON] ❌ Scrape failed: ${result.error}`);
    }
  } catch (error) {
    console.error("[CRON] ❌ Automated scrape error:", error.message);
  }
});

console.log("✅ [CRON] Automated email scraping scheduled every 12 hours");

app.listen(PORT, () =>
  console.log(`Server listening on http://localhost:${PORT}`)
);

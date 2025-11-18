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
import { scrapeEmails } from "./services/emailScraper.js";
import { parseEmailForEvents } from "./services/llmParser.js";

dotenv.config();

// Resolve file location relative to this index.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// If the JSON file is next to index.js in server/
const CATEGORY_DESCRIPTOR_PATH = path.join(
  __dirname,
  "event_category_descriptors.json"
);
/**
 * Shape of the file (structure of tags):
 * {
 *   "categories": {
 *     "Career Development": {
 *       "label": "Career Development",
 *       "must_include_any": [...],
 *       "exclude_if_any": [...],
 *       "description": "..."
 *     },
 *     ...
 *   }
 * }
 */
// Load the JSON once at boot
let CATEGORY_RULES = { categories: {} };
try {
  const raw = fs.readFileSync(CATEGORY_DESCRIPTOR_PATH, "utf8");
  CATEGORY_RULES = JSON.parse(raw);
  console.log(
    "[categories] loaded",
    Object.keys(CATEGORY_RULES.categories || {}).length,
    "categories from",
    CATEGORY_DESCRIPTOR_PATH
  );
} catch (e) {
  console.warn(
    "Could not read event_category_descriptors.json. Category filtering will be empty.",
    e
  );
}

// Organization based filters (organization_events.json)
const ORG_DESCRIPTOR_PATH = path.join(__dirname, "organization_events.json");

let ORGANIZATION_RULES = { categories: {} };
try {
  const rawOrg = fs.readFileSync(ORG_DESCRIPTOR_PATH, "utf8");
  ORGANIZATION_RULES = JSON.parse(rawOrg);
  console.log(
    "[org-categories] loaded",
    Object.keys(ORGANIZATION_RULES.categories || {}).length,
    "top-level org categories from",
    ORG_DESCRIPTOR_PATH
  );
} catch (e) {
  console.warn(
    "Could not read organization_events.json. Org category filtering will be empty.",
    e
  );
}

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
const eventsByUser = db.prepare("SELECT * FROM events WHERE user_id=?");
const eventsByUserAndSource = db.prepare(
  "SELECT * FROM events WHERE user_id=? AND source=?"
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

// --- Helper: Ensure ListServ calendar exists ---
async function getOrCreateListServCalendar(req, oauth2Client) {
  if (req.session.listservCalendarId)
    return { id: req.session.listservCalendarId, created: false };
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const list = await calendar.calendarList.list();
  const existing = (list.data.items || []).find(
    (c) => c.summary?.toLowerCase() === "listserv events"
  );
  if (existing) {
    req.session.listservCalendarId = existing.id;
    return { id: existing.id, created: false };
  }
  const newCal = await calendar.calendars.insert({
    requestBody: {
      summary: "ListServ Events",
      description: "Dedicated calendar for ListServ app",
      timeZone: "America/Los_Angeles",
    },
  });
  await calendar.calendarList.insert({ requestBody: { id: newCal.data.id } });
  req.session.listservCalendarId = newCal.data.id;
  return { id: newCal.data.id, created: true };
}

// beginning of additions

// ---- Key normalization helpers (add near the top, after JSON loads) ----
const slug = (s = "") =>
  String(s)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_:]/g, ""); // keep letters, digits, underscores, and colons

const lowerArray = (arr = []) => arr.map((x) => String(x).toLowerCase());

// --- Filtering helper Functions (event category classification) ---
// normalize and test text
function toTextBlob(ev) {
  //combining fields together
  const {
    title = "",
    description = "",
    location = "",
    organization = "",
  } = ev || {};
  return `${title} ${description} ${location} ${organization}`.toLowerCase();
}

//is a non case sensitive match
function matchesAnyKeyword(blob, keywords = []) {
  return keywords.some((kw) => blob.includes(String(kw).toLowerCase()));
}

/**
 * assignCategories(ev) -> array of category keys
 * Uses CATEGORY_RULES.categories[*].must_include_any / exclude_if_any
 * Logic:
 *  - If must_include_any is present: require at least one to appear
 *  - If exclude_if_any contains a hit: skip that category
 */
function assignCategories(ev) {
  const blob = toTextBlob(ev);
  const out = [];

  const cats = CATEGORY_RULES?.categories || {};
  for (const [key, def] of Object.entries(cats)) {
    const must = def.must_include_any || [];
    const exc = def.exclude_if_any || [];

    // If must_include_any exists and none hit -> skip
    if (must.length > 0 && !matchesAnyKeyword(blob, must)) continue;

    // If any excluded keyword hits -> skip
    if (exc.length > 0 && matchesAnyKeyword(blob, exc)) continue;

    out.push(key); // match!
  }
  return out;
}

// --- Organization-level classification ---
function assignOrgCategories(ev) {
  const blob = toTextBlob(ev);
  const out = [];

  const cats = ORGANIZATION_RULES?.categories || {};
  for (const [typeKeyRaw, typeDef] of Object.entries(cats)) {
    const typeKey = slug(typeKeyRaw);
    const subcats = typeDef?.subcategories || {};
    let sawChild = false;

    // Optional: if type-level must_include_any is used
    const typeHit =
      Array.isArray(typeDef?.must_include_any) &&
      matchesAnyKeyword(blob, lowerArray(typeDef.must_include_any));
    if (typeHit) out.push(typeKey);

    for (const [subKeyRaw, subDef] of Object.entries(subcats)) {
      const subKey = slug(subKeyRaw);

      const subHit =
        Array.isArray(subDef?.must_include_any) &&
        matchesAnyKeyword(blob, lowerArray(subDef.must_include_any));
      if (subHit) {
        out.push(`${typeKey}:${subKey}`);
        sawChild = true;
      }

      const orgs = subDef?.organizations || {};
      for (const [orgKeyRaw, orgDef] of Object.entries(orgs)) {
        const orgKey = slug(orgKeyRaw);
        const orgHit =
          Array.isArray(orgDef?.must_include_any) &&
          matchesAnyKeyword(blob, lowerArray(orgDef.must_include_any));
        if (orgHit) {
          out.push(`${typeKey}:${subKey}:${orgKey}`);
          sawChild = true;
        }
      }
    }

    // If any child matched but we didn’t add the bare type yet, include it
    if (sawChild && !out.includes(typeKey)) out.push(typeKey);
  }

  return out;
}

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

    // Exclude listserv calendar from Google Calendar fetch (we have local versions)
    // This prevents duplicates - we want local events (with delete button), not Google Calendar versions
    const requestedIds = req.query.calendarIds
      ? req.query.calendarIds
          .split(",")
          .filter((id) => id !== listservCalendarId)
      : ["primary"]; // Only fetch primary calendar, not listserv calendar

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

    // --- Combine and normalize tags ---
    const combined = [...localEvents, ...allEvents].map((ev) => {
      const catKeys = assignCategories(ev).map(slug); // normalize category keys
      const orgKeys = assignOrgCategories(ev).map(slug); // normalize org-category keys
      return { ...ev, categories: catKeys, orgCategories: orgKeys };
    });

    // Helper: identify ListServ events so only they get filtered away
    const isListServ = (ev) => {
      const isDraft = ev.source === "draft" || ev.source === "email";
      const isGoogleListServ =
        ev.source === "google" && ev.calendarId === listservCalendarId;
      return isDraft || isGoogleListServ;
    };

    // --- Normalize query params so case/space differences don't break filtering ---
    const reqCatParam = req.query.categories;
    const reqOrgParam = req.query.orgCategories;

    // These are the selected category keys (already slugified on the frontend)
    const reqCats = reqCatParam
      ? reqCatParam
          .split(",")
          .map((s) => slug(s.trim()))
          .filter(Boolean)
      : null;

    const reqOrgCats = reqOrgParam
      ? reqOrgParam
          .split(",")
          .map((s) => slug(s.trim()))
          .filter(Boolean)
      : null;

    // Apply filters ONLY to ListServ events; non-ListServ always pass through
    let filtered = combined;

    if (reqCats || reqOrgCats) {
      filtered = combined.filter((ev) => {
        // 1) Non-ListServ events are always kept, regardless of filters
        if (!isListServ(ev)) return true;

        // 2) If somehow we have no filters, keep the event
        if (!reqCats && !reqOrgCats) return true;

        // 3) Compute "does this event match any selected event-category filter?"
        const matchesCat = reqCats
          ? (ev.categories || []).some((c) => reqCats.includes(c))
          : false;

        // 4) Compute "does this event match any selected org-category filter?"
        const matchesOrg = reqOrgCats
          ? (ev.orgCategories || []).some((c) => reqOrgCats.includes(c))
          : false;

        // 5) OR logic across the two groups:
        //    - If only `reqCats` set → matchesCat must be true
        //    - If only `reqOrgCats` set → matchesOrg must be true
        //    - If both set → (matchesCat || matchesOrg)
        return matchesCat || matchesOrg;
      });
    }

    res.json({ events: filtered });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to reach events" });
  }
});

//returns category labels from the JSON (left panel) - more additions
app.get("/api/event-categories", ensureAuthed, (req, res) => {
  const cats = CATEGORY_RULES?.categories || {};
  const list = Object.entries(cats).map(([rawKey, def]) => ({
    key: slug(rawKey), // normalized key
    label: def.label || rawKey, // human label stays pretty
    description: def.description || "",
  }));
  res.json({ categories: list });
});

// --- Org categories → flat list for bubbles on the left panel
app.get("/api/org-categories", ensureAuthed, (req, res) => {
  const cats = ORGANIZATION_RULES?.categories || {};
  const list = [];

  for (const [typeKeyRaw, typeDef] of Object.entries(cats)) {
    const typeKey = slug(typeKeyRaw);
    const typeLabel = typeDef.label || typeKeyRaw;
    list.push({ key: typeKey, label: typeLabel, level: "type" });

    const subcats = typeDef.subcategories || {};
    for (const [subKeyRaw, subDef] of Object.entries(subcats)) {
      const subKey = slug(subKeyRaw);
      const subLabel = subDef.label || subKeyRaw;
      const subFlatKey = `${typeKey}:${subKey}`;
      list.push({
        key: subFlatKey,
        label: `${typeLabel} • ${subLabel}`,
        level: "subcategory",
      });

      const orgs = subDef.organizations || {};
      for (const [orgKeyRaw, orgDef] of Object.entries(orgs)) {
        const orgKey = slug(orgKeyRaw);
        const orgLabel = orgDef.label || orgKeyRaw;
        const orgFlatKey = `${typeKey}:${subKey}:${orgKey}`;
        list.push({
          key: orgFlatKey,
          label: orgLabel,
          level: "organization",
        });
      }
    }
  }

  res.json({ categories: list });
});

//ending of additions

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
    const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : tags || "[]";
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

    const oauth2Client = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const { id: listservCalendarId } = await getOrCreateListServCalendar(
      req,
      oauth2Client
    );

    // Validate and format dates
    let startDate, endDate;
    if (row.all_day) {
      // For all-day events, ensure date is in YYYY-MM-DD format
      startDate = row.start ? row.start.split("T")[0] : null;
      endDate = row.end ? row.end.split("T")[0] : startDate;
      if (!startDate) {
        console.error(
          `[publish] Invalid all-day event date for event ${rawId}: ${row.start}`
        );
        return res.status(400).json({ error: "Invalid event date" });
      }
    } else {
      // For timed events, ensure ISO 8601 format
      startDate = row.start;
      endDate = row.end || row.start;
      if (!startDate) {
        console.error(
          `[publish] Invalid timed event date for event ${rawId}: ${row.start}`
        );
        return res.status(400).json({ error: "Invalid event date" });
      }
      // Ensure it's a valid ISO datetime string
      if (!startDate.includes("T") || isNaN(new Date(startDate).getTime())) {
        console.error(
          `[publish] Invalid datetime format for event ${rawId}: ${startDate}`
        );
        return res.status(400).json({ error: "Invalid event datetime format" });
      }
    }

    const resource = {
      summary: row.title || "",
      description: row.description || "",
      location: row.location || "",
      // Store custom data in extendedProperties
      extendedProperties: {
        shared: {
          organization: row.organization || "",
          tags: row.tags || "[]", // Pass the JSON string
          poster_url: row.poster_url || "",
        },
      },
    };

    if (row.all_day) {
      resource.start = { date: startDate };
      resource.end = { date: endDate };
    } else {
      resource.start = { dateTime: startDate, timeZone: "America/New_York" };
      resource.end = { dateTime: endDate, timeZone: "America/New_York" };
    }

    console.log(
      `[publish] Publishing event ${rawId} (source: ${source}) to calendar ${listservCalendarId}`
    );
    console.log(`[publish] Event details:`, {
      title: resource.summary,
      start: resource.start,
      end: resource.end,
      allDay: row.all_day,
    });

    const insertResp = await calendar.events.insert({
      calendarId: listservCalendarId,
      requestBody: resource,
    });

    if (!insertResp.data || !insertResp.data.id) {
      console.error(
        `[publish] Google Calendar insert failed for event ${rawId}:`,
        insertResp
      );
      return res
        .status(500)
        .json({ error: "Failed to publish event to Google Calendar" });
    }

    console.log(
      `[publish] Successfully published event ${rawId} to Google Calendar: ${insertResp.data.id}`
    );

    // Only delete from local database after successful publish
    eventDelete.run({ id: rawId, user_id: req.session.user.id });
    res.json({ ok: true, published: { id: `google:${insertResp.data.id}` } });
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

          const eventForTagging = {
            title: event.title || "",
            description: event.description || "",
            location: event.location || "",
            organization: event.organization || "",
          };
          const catKeys = assignCategories(eventForTagging).map(slug);
          const orgKeys = assignOrgCategories(eventForTagging).map(slug);
          const tagsJson = JSON.stringify([...catKeys, ...orgKeys]);

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
          try {
            const oauth2Client = getOAuthClient(req);
            const calendar = google.calendar({
              version: "v3",
              auth: oauth2Client,
            });
            const { id: listservCalendarId } =
              await getOrCreateListServCalendar(req, oauth2Client);

            let startDate, endDate;
            if (event.allDay) {
              startDate = start ? start.split("T")[0] : null;
              endDate = end ? end.split("T")[0] : startDate;
            } else {
              startDate = start;
              endDate = end || start;
            }

            if (startDate) {
              const resource = {
                summary: event.title || "",
                description: event.description || "",
                location: event.location || "",
                extendedProperties: {
                  shared: {
                    organization: event.organization || "",
                    tags: tagsJson,
                    poster_url: event.posterUrl || "",
                  },
                },
              };

              if (event.allDay) {
                resource.start = { date: startDate };
                resource.end = { date: endDate };
              } else {
                resource.start = {
                  dateTime: startDate,
                  timeZone: "America/New_York",
                };
                resource.end = {
                  dateTime: endDate,
                  timeZone: "America/New_York",
                };
              }

              const insertResp = await calendar.events.insert({
                calendarId: listservCalendarId,
                requestBody: resource,
              });

              if (insertResp.data && insertResp.data.id) {
                db.prepare(
                  "UPDATE events SET status='published', google_event_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?"
                ).run(insertResp.data.id, eventId, userId);
              } else {
                console.warn(
                  `[process] Failed to auto-publish event ${eventId} to Google Calendar`
                );
              }
            }
          } catch (publishError) {
            console.error(
              `[process] Error auto-publishing event ${eventId}:`,
              publishError.message
            );
          }

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

app.listen(PORT, () =>
  console.log(`Server listening on http://localhost:${PORT}`)
);

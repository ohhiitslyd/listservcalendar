import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { google } from "googleapis";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
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
import { initializeSchema, query, queryOne, execute, pool } from "./db.js";

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
  SCRAPER_EMAIL,
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

// Initialize PostgreSQL schema
await initializeSchema();

// Helper function for combining date and time
function combineDateTime(date, time, allDay) {
  if (!date) return null;
  if (time && !allDay) {
    return `${date}T${time}`;
  }
  return date;
}

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

    // Store admin tokens for automated scraping (only for designated scraper account)
    if (tokens.refresh_token) {
      try {
        const isScraperAccount =
          SCRAPER_EMAIL && userinfo.email === SCRAPER_EMAIL;

        await execute(
          `INSERT INTO admin_tokens (user_id, user_email, refresh_token, access_token, token_expiry, is_scraper_account, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id) DO UPDATE SET
             user_email = EXCLUDED.user_email,
             refresh_token = EXCLUDED.refresh_token,
             access_token = EXCLUDED.access_token,
             token_expiry = EXCLUDED.token_expiry,
             is_scraper_account = EXCLUDED.is_scraper_account,
             updated_at = EXCLUDED.updated_at`,
          [
            userinfo.id || userinfo.email,
            userinfo.email,
            tokens.refresh_token,
            tokens.access_token || null,
            tokens.expiry_date
              ? new Date(tokens.expiry_date).toISOString()
              : null,
            isScraperAccount,
            new Date().toISOString(),
          ]
        );

        if (isScraperAccount) {
          console.log(
            `[auth] ✓ Stored SCRAPER ACCOUNT tokens: ${userinfo.email}`
          );
        } else {
          console.log(
            `[auth] Stored user tokens (not scraper): ${userinfo.email}`
          );
        }
      } catch (dbError) {
        console.error("[auth] Failed to store admin tokens:", dbError);
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

    // Get local events from PostgreSQL
    const localEventsRaw = await query(
      "SELECT * FROM events WHERE user_id = $1 AND status != 'published'",
      [req.session.user.id]
    );

    const localEvents = localEventsRaw.map((e) => ({
      id: e.source === "manual" ? `draft:${e.id}` : `email:${e.id}`,
      source: e.source === "manual" ? "draft" : "email",
      title: e.title || (e.source === "manual" ? "(Draft)" : "(Event)"),
      description: e.description || "",
      location: e.location || "",
      start: e.start,
      end: e.end,
      allDay: !!e.all_day,
      organization: e.organization || "",
      tags: e.tags ? JSON.parse(e.tags) : [],
      poster_url: e.poster_url || "",
    }));

    const combined = [...localEvents, ...allEvents];

    const isListServ = (ev) => {
      const isDraft = ev.source === "draft" || ev.source === "email";
      const isGoogleListServ =
        ev.source === "google" && ev.calendarId === listservCalendarId;
      return isDraft || isGoogleListServ;
    };

    let filtered = combined;
    const categoriesParam = req.query.categories || req.query.eventTypes;

    if (categoriesParam) {
      const reqCategories = categoriesParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      filtered = combined.filter((ev) => {
        if (!isListServ(ev)) return true;
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
app.post("/api/drafts", ensureAuthed, async (req, res) => {
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

    await execute(
      `INSERT INTO events (id, user_id, source, email_id, title, description, location, organization, tags, poster_url, start, "end", all_day, confidence_score, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        req.session.user.id,
        "manual",
        null,
        title || "",
        description || "",
        location || "",
        organization || "",
        tagsJson,
        poster_url || "",
        start,
        end || null,
        allDay ? 1 : 0,
        null,
        "draft",
      ]
    );

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
      const event = await queryOne(
        "SELECT google_event_id, status FROM events WHERE id = $1 AND user_id = $2",
        [rawId, req.session.user.id]
      );

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
        }
      }

      await execute(
        "DELETE FROM events WHERE id = $1 AND user_id = $2",
        [rawId, req.session.user.id]
      );
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

    const row = await queryOne(
      "SELECT * FROM events WHERE id = $1 AND user_id = $2",
      [rawId, req.session.user.id]
    );
    if (!row) return res.status(404).json({ error: "Event not found" });

    if (!row.start) {
      return res.status(400).json({ error: "Invalid event date" });
    }

    if (!row.all_day) {
      if (!row.start.includes("T") || isNaN(new Date(row.start).getTime())) {
        console.error(
          `[publish] Invalid datetime format for event ${rawId}: ${row.start}`
        );
        return res.status(400).json({ error: "Invalid event datetime format" });
      }
    }

    const eventTags = row.tags ? JSON.parse(row.tags) : [];

    const oauth2Client = getOAuthClient(req);
    const result = await publishEventToCalendar({
      oauth2Client,
      pool,
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
    res
      .status(500)
      .json({ error: "Failed to publish event", details: e.message });
  }
});

// --- Email Scraping Endpoints ---

app.post("/api/scrape/emails", ensureAuthed, async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    const userId = req.session.user.id;

    const {
      maxResults = 50,
      query: searchQuery = "to:campus-events@dartmouth.edu",
      force = false,
    } = req.body;

    const result = await scrapeEmails(oauth2Client, userId, pool, {
      maxResults,
      query: searchQuery,
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
      const email = await queryOne(
        "SELECT * FROM scraped_emails WHERE id = $1 AND user_id = $2",
        [emailId, userId]
      );
      if (!email) {
        return res.status(404).json({ error: "Email not found" });
      }
      emailsToProcess = [email];
    } else {
      const queryText = reprocess
        ? "SELECT * FROM scraped_emails WHERE user_id = $1 ORDER BY received_date DESC"
        : "SELECT * FROM scraped_emails WHERE user_id = $1 AND processed = 0 ORDER BY received_date DESC";
      emailsToProcess = await query(queryText, [userId]);
    }

    let processed = 0;
    let eventsCreated = 0;
    const errors = [];

    for (const email of emailsToProcess) {
      try {
        if (!reprocess && email.processed) {
          continue;
        }

        if (reprocess) {
          const eventsToDelete = await query(
            "SELECT id, google_event_id, status FROM events WHERE email_id = $1 AND user_id = $2",
            [email.id, userId]
          );

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
                  }
                }
              }
            } catch (authError) {
              console.error(
                `[process] Failed to authenticate for Google Calendar deletion:`,
                authError.message
              );
            }
          }

          await execute(
            "DELETE FROM events WHERE email_id = $1 AND user_id = $2",
            [email.id, userId]
          );
          await execute(
            "UPDATE scraped_emails SET processed = 0 WHERE id = $1",
            [email.id]
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

          const tagsJson = event.tags ? JSON.stringify(event.tags) : "[]";

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

          const startDateOnly = start.split("T")[0];

          const duplicateFromSameEmail = await queryOne(
            "SELECT id FROM events WHERE user_id = $1 AND email_id = $2 AND title = $3 AND start LIKE $4",
            [userId, email.id, event.title, `${startDateOnly}%`]
          );

          if (duplicateFromSameEmail) {
            continue;
          }

          const duplicateSameOrg = await queryOne(
            "SELECT id FROM events WHERE user_id = $1 AND title = $2 AND organization = $3 AND start LIKE $4",
            [userId, event.title, event.organization || "", `${startDateOnly}%`]
          );

          if (duplicateSameOrg) {
            continue;
          }

          await execute(
            `INSERT INTO events (id, user_id, source, email_id, title, description, location, organization, tags, poster_url, start, "end", all_day, confidence_score, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              eventId,
              userId,
              "email",
              email.id,
              event.title || "",
              event.description || "",
              event.location || "",
              event.organization || "",
              tagsJson,
              event.posterUrl || "",
              start,
              end || null,
              event.allDay ? 1 : 0,
              event.confidenceScore || null,
              "draft",
            ]
          );

          // Auto-publish email-sourced events to Google Calendar
          const oauth2Client = getOAuthClient(req);
          await publishEventToCalendar({
            oauth2Client,
            pool,
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

          eventsCreated++;
        }

        await execute(
          "UPDATE scraped_emails SET processed = 1 WHERE id = $1",
          [email.id]
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
app.get("/api/scraped-emails", ensureAuthed, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { limit = 50, offset = 0, processed = null } = req.query;

    let queryText = "SELECT * FROM scraped_emails WHERE user_id = $1";
    const params = [userId];
    let paramIndex = 2;

    if (processed !== null) {
      queryText += ` AND processed = $${paramIndex}`;
      params.push(processed === "true" ? 1 : 0);
      paramIndex++;
    }

    queryText += ` ORDER BY received_date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const emails = await query(queryText, params);

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

// Get extracted events from emails
app.get("/api/email-events", ensureAuthed, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { status = null, limit = 50, offset = 0 } = req.query;

    let queryText = "SELECT * FROM events WHERE user_id = $1 AND source = 'email'";
    const params = [userId];
    let paramIndex = 2;

    if (status) {
      queryText += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const events = await query(queryText, params);

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
app.get("/api/scraped-emails/export", ensureAuthed, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const emails = await query(
      "SELECT * FROM scraped_emails WHERE user_id = $1 ORDER BY received_date DESC",
      [userId]
    );

    const emailsWithAttachments = emails.map((email) => ({
      ...email,
      attachments: email.attachments ? JSON.parse(email.attachments) : null,
    }));

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
  async (req, res) => {
    try {
      const userId = req.session.user.id;
      const { emailId, contentId } = req.params;

      const email = await queryOne(
        "SELECT * FROM scraped_emails WHERE id = $1 AND user_id = $2",
        [emailId, userId]
      );

      if (!email) {
        return res.status(404).json({ error: "Email not found" });
      }

      if (!email.attachments) {
        return res.status(404).json({ error: "No attachments found" });
      }

      const attachments = JSON.parse(email.attachments);

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

// Update email event poster_url
app.post("/api/email-events/:eventId/to-draft", ensureAuthed, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const eventId = req.params.eventId;

    const event = await queryOne(
      "SELECT * FROM events WHERE id = $1 AND user_id = $2 AND source = 'email'",
      [eventId, userId]
    );
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const email = await queryOne(
      "SELECT * FROM scraped_emails WHERE id = $1 AND user_id = $2",
      [event.email_id, userId]
    );

    let posterUrl = "";
    if (email && email.attachments) {
      try {
        const attachments = JSON.parse(email.attachments);
        if (attachments && attachments.length > 0) {
          const firstAttachment = attachments[0];
          const baseUrl = `${req.protocol}://${req.get("host")}`;
          posterUrl = `${baseUrl}/api/scraped-emails/${email.id}/attachments/${firstAttachment.contentId}`;

          await execute(
            "UPDATE events SET poster_url = $1 WHERE id = $2 AND user_id = $3",
            [posterUrl, eventId, userId]
          );
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
    const result = await runAutomatedScrape(pool);
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

    const events = await calendar.events.list({
      calendarId: listservCalendarId,
      maxResults: 2500,
      singleEvents: false,
    });

    const eventList = events.data.items || [];
    console.log(`[clear-calendar] Found ${eventList.length} events to delete`);

    let deleted = 0;
    const deleteErrors = [];

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
        deleteErrors.push({ eventId: event.id, error: error.message });
      }
    }

    console.log(
      `[clear-calendar] Complete: ${deleted} deleted, ${deleteErrors.length} errors`
    );

    res.json({
      success: true,
      deleted,
      total: eventList.length,
      errors: deleteErrors.length > 0 ? deleteErrors : undefined,
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

// --- Setup Automated Email Scraping (Every 8 Hours) ---
cron.schedule("0 */8 * * *", async () => {
  console.log("\n[CRON] Automated email scrape triggered");
  try {
    const result = await runAutomatedScrape(pool);
    if (result.success) {
      console.log(
        `[CRON] Scrape successful: ${result.eventsCreated} events created`
      );
    } else {
      console.error(`[CRON] Scrape failed: ${result.error}`);
    }
  } catch (error) {
    console.error("[CRON] Automated scrape error:", error.message);
  }
});

console.log("[CRON] Automated email scraping scheduled every 8 hours");

app.listen(PORT, () =>
  console.log(`Server listening on http://localhost:${PORT}`)
);

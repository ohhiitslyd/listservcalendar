/**
 * Clean email-sourced events and optionally scraped emails from the database
 * Run with: node server/scripts/cleanEvents.js [--all]
 *   --all: Also delete all scraped emails (complete fresh start)
 * 
 * to clean gCal from console
 *      fetch('/api/calendar/events', { method: 'DELETE', credentials: 'include' })
       .then(r => r.json())
       .then(data => console.log('Deleted:', data.deleted, 'events'))
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "db.sqlite");

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found at: ${dbPath}`);
  process.exit(1);
}

const cleanAll = process.argv.includes("--all");
const skipGCal = process.argv.includes("--skip-gcal");

const db = new Database(dbPath);

/**
 * Create OAuth2 client from stored admin tokens
 */
function createOAuthClientFromTokens(tokenData) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: tokenData.refresh_token,
    access_token: tokenData.access_token,
    expiry_date: tokenData.token_expiry
      ? new Date(tokenData.token_expiry).getTime()
      : null,
  });

  return oauth2Client;
}

/**
 * Get admin OAuth credentials from database
 */
function getAdminTokens(db) {
  try {
    const token = db
      .prepare("SELECT * FROM admin_tokens ORDER BY updated_at DESC LIMIT 1")
      .get();
    return token;
  } catch (error) {
    console.error("[cleanEvents] Error getting admin tokens:", error);
    return null;
  }
}

/**
 * Get or create ListServ calendar
 */
async function getOrCreateListServCalendar(oauth2Client) {
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const list = await calendar.calendarList.list();
  const existing = (list.data.items || []).find(
    (c) => c.summary?.toLowerCase() === "listserv events"
  );
  if (existing) {
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
  return { id: newCal.data.id, created: true };
}

/**
 * Clear all events from Google Calendar
 */
async function clearGoogleCalendar() {
  try {
    const adminTokenData = getAdminTokens(db);
    if (!adminTokenData) {
      console.log("No admin tokens found. Skipping Google Calendar cleanup.");
      console.log("   Sign in through the app first to store admin tokens.");
      return { success: false, deleted: 0 };
    }

    console.log(
      `\n Clearing Google Calendar (using admin: ${
        adminTokenData.user_email || adminTokenData.user_id
      })...`
    );

    const oauth2Client = createOAuthClientFromTokens(adminTokenData);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const { id: listservCalendarId } = await getOrCreateListServCalendar(
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
          if (deletedCount % 10 === 0) {
            process.stdout.write(`\r   Deleted ${deletedCount} events...`);
          }
        } catch (error) {
          console.error(
            `\n   Failed to delete event ${event.id}:`,
            error.message
          );
          errorCount++;
        }
      }
    } while (nextPageToken);

    if (deletedCount > 0) {
      process.stdout.write(
        `\r   Deleted ${deletedCount} events${
          errorCount > 0 ? ` (${errorCount} errors)` : ""
        }    \n`
      );
    } else {
      console.log("   No events found in Google Calendar.");
    }

    return { success: true, deleted: deletedCount, errors: errorCount };
  } catch (error) {
    console.error("\nError clearing Google Calendar:", error.message);
    return { success: false, error: error.message };
  }
}

console.log("🧹 Starting cleanup...\n");
console.log("📊 Database cleanup:");

// Count before
const eventsBefore = db
  .prepare("SELECT COUNT(*) as count FROM events WHERE source = 'email'")
  .get();
const emailsBefore = db
  .prepare("SELECT COUNT(*) as count FROM scraped_emails")
  .get();

console.log(`Events before: ${eventsBefore.count}`);

// Delete all email-sourced events
const eventsResult = db
  .prepare("DELETE FROM events WHERE source = 'email'")
  .run();
console.log(`Deleted ${eventsResult.changes} email-sourced events`);

if (cleanAll) {
  // Delete all scraped emails (complete fresh start)
  const emailsResult = db.prepare("DELETE FROM scraped_emails").run();
  console.log(`Deleted ${emailsResult.changes} scraped emails`);
  console.log("\nComplete fresh start! All emails and events removed.");
} else {
  // Reset processed flag for all emails (keep emails, just mark as unprocessed)
  const resetResult = db
    .prepare("UPDATE scraped_emails SET processed = 0")
    .run();
  console.log(` Reset processed flag for ${resetResult.changes} emails`);
  console.log(
    "\n✨ Events cleaned! Emails kept (will be skipped if already scraped)."
  );
  console.log(
    "💡 Tip: Use '--all' flag to also delete scraped emails for complete fresh start."
  );
}

// Count after
const eventsAfter = db
  .prepare("SELECT COUNT(*) as count FROM events WHERE source = 'email'")
  .get();
const emailsAfter = db
  .prepare("SELECT COUNT(*) as count FROM scraped_emails")
  .get();

console.log(`\n Events after: ${eventsAfter.count}`);
console.log(` Emails after: ${emailsAfter.count}`);

// Clear Google Calendar if not skipped
if (!skipGCal) {
  const gcalResult = await clearGoogleCalendar();
  if (gcalResult.success) {
    console.log(
      `\nGoogle Calendar cleared: ${gcalResult.deleted} events deleted`
    );
  }
} else {
  console.log("\n⏭ Skipping Google Calendar cleanup (--skip-gcal flag)");
}

console.log("\n Cleanup complete! Ready for fresh scraping and parsing!");
console.log("\n Next steps:");
console.log(
  "   1. Run automated scrape: fetch('/api/scrape/auto-run', { method: 'POST', credentials: 'include' })"
);
console.log("   2. Or manually scrape and process emails through the UI");

db.close();

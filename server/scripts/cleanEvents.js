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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "db.sqlite");

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found at: ${dbPath}`);
  process.exit(1);
}

const cleanAll = process.argv.includes("--all");

const db = new Database(dbPath);

console.log("🧹 Cleaning email-sourced events from database...\n");

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
console.log("\n Ready for fresh scraping and parsing!");

db.close();

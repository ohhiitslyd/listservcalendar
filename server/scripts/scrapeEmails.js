#!/usr/bin/env node
/**
 * Script to export scraped emails to JSON
 *
 * This script exports already-scraped emails from the database to a JSON file.
 * To scrape new emails, use the API endpoint: POST /api/scrape/emails
 *
 * Usage: node scripts/scrapeEmails.js [maxResults]
 * Example: node scripts/scrapeEmails.js 20
 * 
 * To see an image use the url: http://localhost:3000/api/scraped-emails/{email_id}/attachments/{content_id}
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.join(__dirname, "..");

// Get maxResults from command line or default to 20
const maxResults = parseInt(process.argv[2]) || 20;

function main() {
  try {
    const db = new Database(path.join(serverDir, "db.sqlite"));

    // Get the most recent user (for script purposes)
    const users = db
      .prepare("SELECT DISTINCT user_id FROM scraped_emails LIMIT 1")
      .all();

    if (users.length === 0) {
      console.error(
        "No users found in database. Please scrape emails through the API first."
      );
      console.log("\nAuthentication required!");
      console.log("\nTo scrape emails, use the browser console (recommended):");
      console.log("  1. Open browser and go to: http://localhost:3000");
      console.log("  2. Authenticate via: http://localhost:3000/auth/google");
      console.log("  3. Open browser console (F12) and run:");
      console.log("     fetch('/api/scrape/emails', {");
      console.log("       method: 'POST',");
      console.log("       headers: { 'Content-Type': 'application/json' },");
      console.log("       credentials: 'include',");
      console.log(`       body: JSON.stringify({ maxResults: ${maxResults} })`);
      console.log("     }).then(r => r.json()).then(console.log);");
      console.log(
        "\n  4. After scraping, run this script again to export the emails.\n"
      );
      process.exit(1);
    }

    const userId = users[0].user_id;
    console.log(
      `Exporting ${maxResults} most recent emails for user: ${userId}...\n`
    );

    // Export existing emails to JSON
    const emails = db
      .prepare(
        "SELECT * FROM scraped_emails WHERE user_id=? ORDER BY received_date DESC LIMIT ?"
      )
      .all(userId, maxResults);

    // Parse attachments JSON for each email
    const emailsWithAttachments = emails.map((email) => ({
      ...email,
      attachments: email.attachments ? JSON.parse(email.attachments) : null,
    }));

    // Write to JSON file
    const exportPath = path.join(serverDir, "scraped_emails_export.json");
    fs.writeFileSync(
      exportPath,
      JSON.stringify(
        {
          emails: emailsWithAttachments,
          exportedAt: new Date().toISOString(),
          count: emailsWithAttachments.length,
        },
        null,
        2
      )
    );

    console.log(`Exported ${emailsWithAttachments.length} emails to:`);
    console.log(`   ${exportPath}\n`);

    // Show summary
    const withAttachments = emailsWithAttachments.filter(
      (e) => e.attachments && e.attachments.length > 0
    ).length;
    console.log(`Summary:`);
    console.log(`   Total emails: ${emailsWithAttachments.length}`);
    console.log(`   With attachments: ${withAttachments}`);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();

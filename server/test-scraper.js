#!/usr/bin/env node
// Usage: node test-scraper.js [check|scrape]

import dotenv from "dotenv";
import { pool, initializeSchema } from "./db.js";
import { runAutomatedScrape } from "./services/autoScraper.js";

dotenv.config();

const cmd = process.argv[2];

async function check() {
  const client = await pool.connect();
  console.log("DB: connected");
  client.release();

  const scraper = await pool.query("SELECT user_email, updated_at FROM admin_tokens WHERE is_scraper_account = TRUE");
  if (scraper.rows[0]) {
    console.log(`Scraper: ${scraper.rows[0].user_email} (updated ${scraper.rows[0].updated_at})`);
  } else {
    console.log(`Scraper: NOT CONFIGURED - log in with ${process.env.SCRAPER_EMAIL}`);
  }

  const emails = await pool.query("SELECT COUNT(*) as c FROM scraped_emails");
  const events = await pool.query("SELECT COUNT(*) as c FROM events");
  console.log(`Emails: ${emails.rows[0].c} | Events: ${events.rows[0].c}`);
}

async function scrape() {
  console.log("Running scrape...");
  const result = await runAutomatedScrape(pool);
  console.log(result.success ? `Done: ${result.eventsCreated} events created` : `Error: ${result.error}`);
}

(async () => {
  await initializeSchema();
  if (cmd === "check") await check();
  else if (cmd === "scrape") await scrape();
  else console.log("Usage: node test-scraper.js [check|scrape]");
  await pool.end();
})();

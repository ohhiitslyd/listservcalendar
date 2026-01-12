import { google } from "googleapis";
import { scrapeEmails } from "./emailScraper.js";
import { parseEmailForEvents } from "./llmParser.js";

/**
 * Automated Email Scraping Service
 * Runs periodically to scrape campus-events emails and extract event data
 */

/**
 * Format date for Gmail's "after:" query syntax
 * @param {Date} date - Date to format
 * @returns {string} - Date in YYYY/MM/DD format
 */
function formatDateForGmail(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

/**
 * Get the last scrape time from database
 * @param {Database} db - SQLite database instance
 * @returns {Date} - Last scrape time or default to 12 hours ago
 */
function getLastScrapeTime(db) {
  try {
    // First try to get from app_settings
    const setting = db
      .prepare("SELECT value FROM app_settings WHERE key=?")
      .get("last_auto_scrape");

    if (setting?.value) {
      return new Date(setting.value);
    }

    // Fallback: Get the most recent email's received_date
    const lastEmail = db
      .prepare(
        "SELECT received_date FROM scraped_emails ORDER BY received_date DESC LIMIT 1"
      )
      .get();

    if (lastEmail?.received_date) {
      return new Date(lastEmail.received_date);
    }

    // Default: 12 hours ago (matches the cron schedule)
    return new Date(Date.now() - 12 * 60 * 60 * 1000);
  } catch (error) {
    console.error("[autoScraper] Error getting last scrape time:", error);
    // Default: 12 hours ago
    return new Date(Date.now() - 12 * 60 * 60 * 1000);
  }
}

/**
 * Save the current scrape time to database
 * @param {Database} db - SQLite database instance
 */
function saveLastScrapeTime(db) {
  try {
    db.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)"
    ).run(
      "last_auto_scrape",
      new Date().toISOString(),
      new Date().toISOString()
    );
  } catch (error) {
    console.error("[autoScraper] Error saving last scrape time:", error);
  }
}

/**
 * Get admin OAuth credentials from database
 * @param {Database} db - SQLite database instance
 * @returns {Object|null} - Admin token data or null
 */
function getAdminTokens(db) {
  try {
    const token = db
      .prepare("SELECT * FROM admin_tokens ORDER BY updated_at DESC LIMIT 1")
      .get();
    return token;
  } catch (error) {
    console.error("[autoScraper] Error getting admin tokens:", error);
    return null;
  }
}

/**
 * Create OAuth2 client from stored admin tokens
 * @param {Object} tokenData - Admin token data from database
 * @returns {Object} - OAuth2 client
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

  // Auto-refresh tokens
  oauth2Client.on("tokens", (tokens) => {
    console.log("[autoScraper] OAuth tokens refreshed");
    // Note: We could save the new tokens back to DB here if needed
  });

  return oauth2Client;
}

/**
 * Helper function to combine date and time into ISO string
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} time - Time in HH:MM format
 * @param {boolean} allDay - Whether it's an all-day event
 * @returns {string|null} - Combined datetime or null
 */
function combineDateTime(date, time, allDay) {
  if (!date) return null;
  if (time && !allDay) {
    return `${date}T${time}`;
  }
  return date;
}

/**
 * Process unprocessed emails and extract events
 * @param {string} userId - User ID
 * @param {Database} db - SQLite database instance
 * @returns {Promise<Object>} - Processing results
 */
async function processUnprocessedEmails(userId, db) {
  try {
    // Get all unprocessed emails
    const emailsToProcess = db
      .prepare(
        "SELECT * FROM scraped_emails WHERE user_id=? AND processed=0 ORDER BY received_date DESC"
      )
      .all(userId);

    let processed = 0;
    let eventsCreated = 0;
    const errors = [];

    for (const email of emailsToProcess) {
      try {
        // Parse email for events using LLM
        // Note: parseEmailForEvents expects the full email object
        const parsedEvents = await parseEmailForEvents(email);

        // Insert events into the events table
        const eventInsert = db.prepare(`
          INSERT INTO events(
            id, user_id, source, email_id, title, description, location,
            organization, tags, poster_url, start, end, all_day, 
            confidence_score, status
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const event of parsedEvents) {
          // Combine date and time fields into proper datetime strings
          const start = combineDateTime(
            event.startDate,
            event.startTime,
            event.allDay
          );
          let end = combineDateTime(event.endDate, event.endTime, event.allDay);

          // Skip events without a start date
          if (!start) {
            console.warn(
              `[autoScraper] Skipping event without start date: ${
                event.title || "(no title)"
              }`
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
              `[autoScraper] Multi-day event detected (likely parsing error), resetting end to same day:`,
              {
                title: event.title,
                startDate: event.startDate,
                endDate: event.endDate,
              }
            );
            // Keep the end time but use the start date
            end = combineDateTime(event.startDate, event.endTime, event.allDay);
          }

          // If we have a start time but no end time, default to 1 hour duration
          if (event.startTime && !event.endTime && !event.allDay && start) {
            const startDate = new Date(start);
            const endDate = new Date(startDate);
            endDate.setHours(endDate.getHours() + 1);
            end = endDate.toISOString();
          }

          const eventId = `event_${Math.random().toString(36).substr(2, 16)}`;
          eventInsert.run(
            eventId,
            userId,
            "email",
            email.id,
            event.title || "(No title)",
            event.description || "",
            event.location || "",
            event.organization || "",
            event.tags ? JSON.stringify(event.tags) : null,
            event.posterUrl || null,
            start,
            end || start,
            event.allDay ? 1 : 0,
            event.confidence || null,
            "draft"
          );
          eventsCreated++;
        }

        // Mark email as processed
        db.prepare("UPDATE scraped_emails SET processed=1 WHERE id=?").run(
          email.id
        );
        processed++;
      } catch (error) {
        console.error(
          `[autoScraper] Error processing email ${email.id}:`,
          error.message
        );
        errors.push({ emailId: email.id, error: error.message });
      }
    }

    return {
      processed,
      eventsCreated,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error("[autoScraper] Error in processUnprocessedEmails:", error);
    throw error;
  }
}

/**
 * Main automated scrape function
 * @param {Database} db - SQLite database instance
 * @returns {Promise<Object>} - Scrape results
 */
export async function runAutomatedScrape(db) {
  const startTime = new Date();
  console.log(`\n[autoScraper] ========================================`);
  console.log(
    `[autoScraper] Starting automated scrape at ${startTime.toISOString()}`
  );

  try {
    // Step 1: Get admin OAuth credentials
    const adminTokenData = getAdminTokens(db);
    if (!adminTokenData) {
      throw new Error(
        "No admin tokens found. Please authenticate an admin user first."
      );
    }

    const oauth2Client = createOAuthClientFromTokens(adminTokenData);
    const userId = adminTokenData.user_id;

    console.log(
      `[autoScraper] Using admin user: ${adminTokenData.user_email || userId}`
    );

    // Step 2: Get last scrape time
    const lastScrapeTime = getLastScrapeTime(db);
    console.log(
      `[autoScraper] Last scrape time: ${lastScrapeTime.toISOString()}`
    );

    // Step 3: Build Gmail query with time filter
    const afterDate = formatDateForGmail(lastScrapeTime);
    const query = `to:campus-events@dartmouth.edu after:${afterDate}`;
    console.log(`[autoScraper] Gmail query: ${query}`);

    // Step 4: Scrape emails
    console.log(`[autoScraper] Scraping emails...`);
    const scrapeResult = await scrapeEmails(oauth2Client, userId, db, {
      query,
      skipExisting: true,
      force: false,
    });

    console.log(
      `[autoScraper] Scrape complete: ${scrapeResult.scraped} new, ${scrapeResult.skipped} skipped`
    );

    // Step 5: Process scraped emails
    console.log(`[autoScraper] Processing emails...`);
    const processResult = await processUnprocessedEmails(userId, db);

    console.log(
      `[autoScraper] Processing complete: ${processResult.processed} emails, ${processResult.eventsCreated} events`
    );

    // Step 6: Save scrape time
    saveLastScrapeTime(db);

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`[autoScraper] Completed in ${duration}s`);
    console.log(`[autoScraper] ========================================\n`);

    return {
      success: true,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: `${duration}s`,
      emailsScraped: scrapeResult.scraped,
      emailsSkipped: scrapeResult.skipped,
      emailsProcessed: processResult.processed,
      eventsCreated: processResult.eventsCreated,
      errors: processResult.errors,
    };
  } catch (error) {
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.error(`[autoScraper] ERROR after ${duration}s:`, error.message);
    console.log(`[autoScraper] ========================================\n`);

    return {
      success: false,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: `${duration}s`,
      error: error.message,
    };
  }
}

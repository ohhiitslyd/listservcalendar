import { google } from "googleapis";
import { scrapeEmails } from "./emailScraper.js";
import { parseEmailForEvents } from "./llmParser.js";
import { publishEventToCalendar } from "./calendarPublisher.js";

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
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Promise<Date>} - Last scrape time or default to 8 hours ago
 */
async function getLastScrapeTime(pool) {
  try {
    // First try to get from app_settings
    const settingResult = await pool.query(
      "SELECT value FROM app_settings WHERE key = $1",
      ["last_auto_scrape"]
    );

    if (settingResult.rows[0]?.value) {
      return new Date(settingResult.rows[0].value);
    }

    // Fallback: Get the most recent email's received_date
    const lastEmailResult = await pool.query(
      "SELECT received_date FROM scraped_emails ORDER BY received_date DESC LIMIT 1"
    );

    if (lastEmailResult.rows[0]?.received_date) {
      return new Date(lastEmailResult.rows[0].received_date);
    }

    // Default: 8 hours ago (matches the cron schedule)
    return new Date(Date.now() - 8 * 60 * 60 * 1000);
  } catch (error) {
    console.error("[autoScraper] Error getting last scrape time:", error);
    // Default: 8 hours ago
    return new Date(Date.now() - 8 * 60 * 60 * 1000);
  }
}

/**
 * Save the current scrape time to database
 * @param {Pool} pool - PostgreSQL connection pool
 */
async function saveLastScrapeTime(pool) {
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      ["last_auto_scrape", new Date().toISOString(), new Date().toISOString()]
    );
  } catch (error) {
    console.error("[autoScraper] Error saving last scrape time:", error);
  }
}

/**
 * Get admin OAuth credentials from database
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Promise<Object|null>} - Admin token data or null
 */
async function getAdminTokens(pool) {
  try {
    const result = await pool.query(
      "SELECT * FROM admin_tokens WHERE is_scraper_account = TRUE ORDER BY updated_at DESC LIMIT 1"
    );
    return result.rows[0] || null;
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
export function combineDateTime(date, time, allDay) {
  if (!date) return null;
  if (time && !allDay) {
    return `${date}T${time}`;
  }
  return date;
}

/**
 * Process unprocessed emails and extract events
 * @param {string} userId - User ID
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {Object} oauth2Client - Google OAuth2 client for publishing events
 * @returns {Promise<Object>} - Processing results
 */
async function processUnprocessedEmails(userId, pool, oauth2Client) {
  try {
    // Get all unprocessed emails
    const emailsResult = await pool.query(
      "SELECT * FROM scraped_emails WHERE user_id = $1 AND processed = 0 ORDER BY received_date DESC",
      [userId]
    );
    const emailsToProcess = emailsResult.rows;

    let processed = 0;
    let eventsCreated = 0;
    const errors = [];

    for (const email of emailsToProcess) {
      try {
        // Parse email for events using LLM
        const parsedEvents = await parseEmailForEvents(email);

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

          // Validate multi-day events: allow them but cap duration and fix obvious errors
          if (end && start) {
            const startMs = new Date(start).getTime();
            const endMs = new Date(end).getTime();
            const durationDays = (endMs - startMs) / (1000 * 60 * 60 * 24);

            // If end is before start, swap them
            if (endMs < startMs) {
              console.warn(
                `[autoScraper] End before start detected, swapping:`,
                { title: event.title, start, end }
              );
              const temp = end;
              end = start;
              start = temp;
            }
            // Cap events at 14 days max (likely LLM parsing error if longer)
            else if (durationDays > 14) {
              console.warn(
                `[autoScraper] Event duration ${durationDays.toFixed(1)} days exceeds 14 day limit, capping:`,
                { title: event.title, startDate: event.startDate, endDate: event.endDate }
              );
              const cappedEnd = new Date(startMs + 14 * 24 * 60 * 60 * 1000);
              end = event.allDay
                ? cappedEnd.toISOString().split("T")[0]
                : cappedEnd.toISOString();
            }
          }

          // If we have a start time but no end time, default to 1 hour duration
          if (event.startTime && !event.endTime && !event.allDay && start) {
            const startDate = new Date(start);
            const endDate = new Date(startDate);
            endDate.setHours(endDate.getHours() + 1);
            end = endDate.toISOString();
          }

          // Check for duplicate from same email (prevent LLM parsing same event twice)
          const startDateOnly = start.split("T")[0];
          const duplicateFromSameEmail = await pool.query(
            "SELECT id FROM events WHERE user_id = $1 AND email_id = $2 AND title = $3 AND start LIKE $4",
            [userId, email.id, event.title, `${startDateOnly}%`]
          );

          if (duplicateFromSameEmail.rows.length > 0) {
            console.log(
              `[autoScraper] Skipping duplicate event from same email: ${event.title}`
            );
            continue;
          }

          const eventId = `event_${Math.random().toString(36).substr(2, 16)}`;

          await pool.query(
            `INSERT INTO events (id, user_id, source, email_id, title, description, location,
              organization, tags, poster_url, start, "end", all_day, confidence_score, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
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
              "draft",
            ]
          );
          eventsCreated++;

          // Auto-publish email-sourced events to Google Calendar
          if (oauth2Client) {
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
              logPrefix: "[autoScraper]",
            });
          }
        }

        // Mark email as processed
        await pool.query(
          "UPDATE scraped_emails SET processed = 1 WHERE id = $1",
          [email.id]
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
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Promise<Object>} - Scrape results
 */
export async function runAutomatedScrape(pool) {
  const startTime = new Date();
  console.log(`\n[autoScraper] ========================================`);
  console.log(
    `[autoScraper] Starting automated scrape at ${startTime.toISOString()}`
  );

  try {
    // Step 1: Get admin OAuth credentials
    const adminTokenData = await getAdminTokens(pool);
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
    const lastScrapeTime = await getLastScrapeTime(pool);
    console.log(
      `[autoScraper] Last scrape time: ${lastScrapeTime.toISOString()}`
    );

    // Step 3: Build Gmail query with time filter
    const afterDate = formatDateForGmail(lastScrapeTime);
    const query = `to:campus-events@dartmouth.edu after:${afterDate}`;
    console.log(`[autoScraper] Gmail query: ${query}`);

    // Step 4: Scrape emails
    console.log(`[autoScraper] Scraping emails...`);
    const scrapeResult = await scrapeEmails(oauth2Client, userId, pool, {
      query,
      skipExisting: true,
      force: false,
    });

    console.log(
      `[autoScraper] Scrape complete: ${scrapeResult.scraped} new, ${scrapeResult.skipped} skipped`
    );

    // Step 5: Process scraped emails and auto-publish events
    console.log(
      `[autoScraper] Processing emails and auto-publishing events...`
    );
    const processResult = await processUnprocessedEmails(
      userId,
      pool,
      oauth2Client
    );

    console.log(
      `[autoScraper] Processing complete: ${processResult.processed} emails, ${processResult.eventsCreated} events`
    );

    // Step 6: Save scrape time
    await saveLastScrapeTime(pool);

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

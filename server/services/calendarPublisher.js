import { google } from "googleapis";

/**
 * Shared utility functions for Google Calendar operations
 * Used by both the main server and automated scraper
 */

/**
 * Get or create the ListServ Events calendar
 * @param {Object} oauth2Client - Google OAuth2 client
 * @returns {Promise<{id: string, created: boolean}>} - Calendar ID and whether it was created
 */
export async function getOrCreateListServCalendar(oauth2Client) {
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  try {
    // List all calendars
    const listResponse = await calendar.calendarList.list();
    const calendars = listResponse.data.items || [];

    // Look for existing "ListServ Events" calendar (case-insensitive)
    const existing = calendars.find(
      (cal) => cal.summary?.toLowerCase() === "listserv events"
    );

    if (existing) {
      return { id: existing.id, created: false };
    }

    // Create new calendar if not found
    const createResponse = await calendar.calendars.insert({
      requestBody: {
        summary: "ListServ Events",
        description: "Events extracted from campus-events@dartmouth.edu emails",
        timeZone: "America/New_York",
      },
    });

    return { id: createResponse.data.id, created: true };
  } catch (error) {
    console.error(
      "[calendarPublisher] Error getting/creating ListServ calendar:",
      error.message
    );
    throw error;
  }
}

/**
 * Publish an event to Google Calendar
 * @param {Object} params - Event parameters
 * @param {Object} params.oauth2Client - Google OAuth2 client
 * @param {Pool} params.pool - PostgreSQL connection pool
 * @param {string} params.eventId - Local event ID
 * @param {string} params.userId - User ID
 * @param {string} params.title - Event title
 * @param {string} params.description - Event description
 * @param {string} params.location - Event location
 * @param {string} params.organization - Event organization
 * @param {Array<string>} params.eventTags - Event tags array
 * @param {string} params.posterUrl - Poster image URL
 * @param {string} params.start - Start date/time (ISO string)
 * @param {string} params.end - End date/time (ISO string)
 * @param {boolean} params.allDay - Whether event is all-day
 * @param {string} params.logPrefix - Log prefix for messages
 * @returns {Promise<{success: boolean, error?: string, googleEventId?: string}>}
 */
export async function publishEventToCalendar({
  oauth2Client,
  pool,
  eventId,
  userId,
  title,
  description,
  location,
  organization,
  organizationEmail = "", 
  eventTags = [],
  posterUrl = "",
  start,
  end,
  allDay = false,
  logPrefix = "[calendarPublisher]",
}) {
  try {
    // Get or create ListServ calendar
    const { id: calendarId } = await getOrCreateListServCalendar(oauth2Client);

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // Format event for Google Calendar API
    const eventData = {
      summary: title || "(No title)",
      description: description || "",
      location: location || "",
      start: allDay
        ? { date: start.split("T")[0] } // All-day events use date only
        : { dateTime: start, timeZone: "America/New_York" },
      end: allDay
        ? { date: end ? end.split("T")[0] : start.split("T")[0] }
        : { dateTime: end || start, timeZone: "America/New_York" },
      extendedProperties: {
        shared: {
          organization: organization || "",
          organization_email: organizationEmail || "",
          tags: JSON.stringify(eventTags || []),
          poster_url: posterUrl || "",
          source_event_id: eventId, // Track original database event ID for matching
        },
      },
    };

    // Create event in Google Calendar
    const response = await calendar.events.insert({
      calendarId,
      requestBody: eventData,
    });

    const googleEventId = response.data.id;

    // Update local database
    await pool.query(
      `UPDATE events
       SET google_event_id = $1, status = 'published', updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      [googleEventId, eventId, userId]
    );

    console.log(
      `${logPrefix} Published event ${eventId} to Google Calendar (${googleEventId})`
    );

    return { success: true, google_event_id: googleEventId };
  } catch (error) {
    const errorMessage = error.message || "Unknown error";
    console.error(
      `${logPrefix} Failed to publish event ${eventId} to Google Calendar:`,
      errorMessage
    );
    return { success: false, error: errorMessage };
  }
}

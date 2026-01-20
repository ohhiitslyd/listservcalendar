import { google } from "googleapis";

/**
 * Shared utility for publishing events to Google Calendar
 * Used by both /api/scrape/process and autoScraper.js
 */

/**
 * Get or create the ListServ calendar (without session caching)
 * @param {Object} oauth2Client - Google OAuth2 client
 * @returns {Promise<Object>} - Calendar info with id and created flag
 */
export async function getOrCreateListServCalendar(oauth2Client) {
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
 * Publish an event to Google Calendar
 * @param {Object} params - Publishing parameters
 * @param {Object} params.oauth2Client - Google OAuth2 client
 * @param {Database} params.db - SQLite database instance
 * @param {string} params.eventId - Event ID in database
 * @param {string} params.userId - User ID
 * @param {string} params.title - Event title
 * @param {string} params.description - Event description
 * @param {string} params.location - Event location
 * @param {string} params.organization - Event organization
 * @param {Array<string>} params.eventTags - Array of event tags
 * @param {string} params.posterUrl - Poster image URL
 * @param {string} params.start - Start datetime (ISO format)
 * @param {string} params.end - End datetime (ISO format)
 * @param {boolean} params.allDay - Whether event is all-day
 * @param {string} params.logPrefix - Prefix for log messages (e.g., "[autoScraper]")
 * @returns {Promise<Object>} - Result with success flag and google_event_id
 */
export async function publishEventToCalendar({
  oauth2Client,
  db,
  eventId,
  userId,
  title,
  description,
  location,
  organization,
  eventTags,
  posterUrl,
  start,
  end,
  allDay,
  logPrefix = "[publish]",
}) {
  try {
    const calendar = google.calendar({
      version: "v3",
      auth: oauth2Client,
    });
    const { id: listservCalendarId } = await getOrCreateListServCalendar(
      oauth2Client
    );

    // Format dates based on all-day vs timed event
    let startDate, endDate;
    if (allDay) {
      startDate = start ? start.split("T")[0] : null;
      endDate = end ? end.split("T")[0] : startDate;
    } else {
      startDate = start;
      endDate = end || start;
    }

    if (!startDate) {
      console.warn(
        `${logPrefix} Skipping publish - missing start date for event ${eventId}`
      );
      return { success: false, error: "Missing start date" };
    }

    // Build Google Calendar event resource
    const resource = {
      summary: title || "",
      description: description || "",
      location: location || "",
      extendedProperties: {
        shared: {
          organization: organization || "",
          tags: eventTags ? JSON.stringify(eventTags) : "[]",
          poster_url: posterUrl || "",
        },
      },
    };

    // Set start/end dates
    if (allDay) {
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

    // Insert event into Google Calendar
    const insertResp = await calendar.events.insert({
      calendarId: listservCalendarId,
      requestBody: resource,
    });

    if (insertResp.data && insertResp.data.id) {
      // Update database with published status
      db.prepare(
        "UPDATE events SET status='published', google_event_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?"
      ).run(insertResp.data.id, eventId, userId);

      console.log(
        `${logPrefix}Published event: "${title || eventId}" (${
          insertResp.data.id
        })`
      );

      return {
        success: true,
        google_event_id: insertResp.data.id,
      };
    } else {
      console.warn(
        `${logPrefix}  Failed to publish event ${eventId} - no event ID returned`
      );
      return {
        success: false,
        error: "No event ID returned from Google Calendar",
      };
    }
  } catch (error) {
    console.error(
      `${logPrefix} Error publishing event ${eventId}:`,
      error.message
    );
    return { success: false, error: error.message };
  }
}

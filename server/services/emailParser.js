import * as cheerio from "cheerio";
import { parse, format, isValid } from "date-fns";

/**
 * Email Parser Service
 * Extracts event information from email content
 */

/**
 * Convert HTML to plain text, preserving some structure
 */
function htmlToText(html) {
  if (!html) return "";

  const $ = cheerio.load(html);

  // Remove script and style tags
  $("script, style").remove();

  // Convert common HTML elements to text
  $("br").replaceWith("\n");
  $("p, div").each(function () {
    const $el = $(this);
    $el.replaceWith($el.text() + "\n");
  });

  return $.text().trim();
}

/**
 * Extract date/time patterns from text
 */
function extractDateTime(text, emailDate = null) {
  const patterns = [
    /(\d{1,2}:\d{2}\s*(?:AM|PM)?\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM))/i,
    /(\d{1,2}:\d{2}\s*(?:AM|PM))/i,
    /(?:when|date|time)[:\s]*([A-Za-z]+\s+\d{1,2},?\s+\d{4}(?:,\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i,
    /(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
    /([A-Za-z]+\s+\d{1,2},?\s+\d{4})/,
  ];

  const relativeDatePatterns = [
    /(?:tonight|this evening|today)/i,
    /(?:tomorrow|tmr)/i,
  ];

  let relativeDate = null;
  for (const pattern of relativeDatePatterns) {
    const match = text.match(pattern);
    if (match) {
      relativeDate = match[0].toLowerCase();
      break;
    }
  }

  let timeMatch = null;
  for (const pattern of patterns.slice(0, 2)) {
    const match = text.match(pattern);
    if (match) {
      timeMatch = match[1];
      break;
    }
  }

  if (relativeDate && emailDate) {
    const baseDate = new Date(emailDate);
    if (relativeDate.includes("tomorrow")) {
      baseDate.setDate(baseDate.getDate() + 1);
    }
    if (timeMatch) {
      return { relativeDate: baseDate, timeStr: timeMatch };
    }
    return { relativeDate: baseDate, timeStr: null };
  }

  for (const pattern of patterns.slice(2)) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  if (timeMatch && emailDate) {
    return { relativeDate: new Date(emailDate), timeStr: timeMatch };
  }

  return null;
}

/**
 * Parse date string or object to Date object
 */
function parseDate(dateInput) {
  if (!dateInput) return null;

  if (typeof dateInput === "object" && dateInput.relativeDate) {
    const baseDate = new Date(dateInput.relativeDate);
    if (dateInput.timeStr) {
      const timeRangeMatch = dateInput.timeStr.match(
        /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i
      );
      if (timeRangeMatch) {
        let hours = parseInt(timeRangeMatch[1]);
        const minutes = parseInt(timeRangeMatch[2]);
        const ampm = timeRangeMatch[3] || timeRangeMatch[6];

        if (ampm) {
          if (ampm.toUpperCase() === "PM" && hours !== 12) hours += 12;
          if (ampm.toUpperCase() === "AM" && hours === 12) hours = 0;
        }

        baseDate.setHours(hours, minutes, 0, 0);
        return { start: baseDate, end: parseEndTime(baseDate, timeRangeMatch) };
      } else {
        const timeMatch = dateInput.timeStr.match(
          /(\d{1,2}):(\d{2})\s*(AM|PM)?/i
        );
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const ampm = timeMatch[3];

          if (ampm) {
            if (ampm.toUpperCase() === "PM" && hours !== 12) hours += 12;
            if (ampm.toUpperCase() === "AM" && hours === 12) hours = 0;
          }

          baseDate.setHours(hours, minutes, 0, 0);
          return baseDate;
        }
      }
    }
    return baseDate;
  }

  if (typeof dateInput !== "string") return null;

  const formats = [
    "MMMM d, yyyy, h:mm a",
    "MMM d, yyyy, h:mm a",
    "MMMM d, yyyy",
    "MMM d, yyyy",
    "M/d/yyyy h:mm a",
    "M/d/yyyy",
  ];

  for (const fmt of formats) {
    try {
      const parsed = parse(dateInput, fmt, new Date());
      if (isValid(parsed)) {
        return parsed;
      }
    } catch (e) {
      // Continue to next format
    }
  }

  try {
    const parsed = new Date(dateInput);
    if (isValid(parsed)) {
      return parsed;
    }
  } catch (e) {
    // Ignore
  }

  return null;
}

/**
 * Parse end time from time range string
 */
function parseEndTime(startDate, timeRangeMatch) {
  const endDate = new Date(startDate);
  let hours = parseInt(timeRangeMatch[4]);
  const minutes = parseInt(timeRangeMatch[5]);
  const ampm = timeRangeMatch[6];

  if (ampm) {
    if (ampm.toUpperCase() === "PM" && hours !== 12) hours += 12;
    if (ampm.toUpperCase() === "AM" && hours === 12) hours = 0;
  }

  endDate.setHours(hours, minutes, 0, 0);
  return endDate;
}

/**
 * Extract location from text
 */
function extractLocation(text) {
  const locationPatterns = [
    /(?:where|location)[:\s]+([^\n]+)/i,
    /(?:at|@)\s+the\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Museum|House|Hall|Building|Room|Center|Library|Dining|Commons|Theater|Auditorium|Gym|Field|Stadium))/i,
    /(?:at|@)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Museum|House|Hall|Building|Room|Center|Library|Dining|Commons|Theater|Auditorium|Gym|Field|Stadium))/i,
    /([A-Z][a-z]+\s+(?:Museum|House|Hall|Building|Room|Center|Library|Dining|Commons|Theater|Auditorium|Gym|Field|Stadium))/,
    /(?:at|@)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
  ];

  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim().replace(/^the\s+/i, "");
    }
  }

  return null;
}

/**
 * Extract title from subject or body
 */
function extractTitle(subject, bodyText) {
  let title = subject
    .replace(/^(re|fwd?):\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (title.length < 5 || title.toLowerCase().includes("campus events")) {
    const titlePatterns = [
      /^([A-Z][^\n]{10,100})/m,
      /(?:event|title)[:\s]+([^\n]+)/i,
    ];

    for (const pattern of titlePatterns) {
      const match = bodyText.match(pattern);
      if (match && match[1]) {
        title = match[1].trim();
        break;
      }
    }
  }

  return title || "Untitled Event";
}

/**
 * Extract description from body
 */
function extractDescription(bodyText, title) {
  let desc = bodyText;
  if (title && desc.toLowerCase().startsWith(title.toLowerCase())) {
    desc = desc.substring(title.length).trim();
  }

  desc = desc.replace(/^(dear|hello|hi)[^\n]*\n/i, "");

  const sentences = desc.split(/[.!?]\s+/).slice(0, 3);
  desc = sentences.join(". ").trim();

  if (desc.length > 500) {
    desc = desc.substring(0, 500) + "...";
  }

  return desc || "";
}

/**
 * Calculate confidence score based on extracted data
 */
function calculateConfidence(event) {
  let score = 0;
  if (event.title && event.title.length > 5) score += 0.3;
  if (event.startDate) score += 0.4;
  if (event.startTime) score += 0.2;
  if (event.location) score += 0.1;
  return Math.min(score, 1.0);
}

/**
 * Parse email and extract event information
 */
export function parseEmailForEvents(emailData) {
  const events = [];

  if (!emailData) {
    return events;
  }

  const { subject, bodyText, bodyHtml, received_date } = emailData;
  const text = bodyText || htmlToText(bodyHtml || "");

  if (!text && !subject) {
    return events;
  }

  const title = extractTitle(subject, text);
  const description = extractDescription(text, title);
  const location = extractLocation(text);
  const dateTimeData = extractDateTime(text, received_date);

  let startDate = null;
  let startTime = null;
  let endDate = null;
  let endTime = null;
  let allDay = false;

  if (dateTimeData) {
    const parsed = parseDate(dateTimeData);

    if (parsed) {
      if (typeof parsed === "object" && parsed.start && parsed.end) {
        startDate = format(parsed.start, "yyyy-MM-dd");
        startTime = format(parsed.start, "HH:mm:ss");
        endDate = format(parsed.end, "yyyy-MM-dd");
        endTime = format(parsed.end, "HH:mm:ss");
        allDay = false;
      } else {
        startDate = format(parsed, "yyyy-MM-dd");

        const hasTime =
          (typeof dateTimeData === "object" && dateTimeData.timeStr) ||
          (typeof dateTimeData === "string" &&
            dateTimeData.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/i));

        if (hasTime) {
          startTime = format(parsed, "HH:mm:ss");
          allDay = false;

          if (!(typeof parsed === "object" && parsed.end)) {
            const endDateTime = new Date(parsed);
            endDateTime.setHours(endDateTime.getHours() + 1);
            endDate = format(endDateTime, "yyyy-MM-dd");
            endTime = format(endDateTime, "HH:mm:ss");
          }
        } else {
          allDay = true;
          endDate = startDate;
        }
      }
    }
  }

  const event = {
    title,
    description,
    location: location || null,
    startDate: startDate || null,
    endDate: endDate || null,
    startTime: startTime || null,
    endTime: endTime || null,
    allDay: allDay || false,
    confidenceScore: calculateConfidence({
      title,
      startDate,
      startTime,
      location,
    }),
  };

  if (event.title && event.startDate) {
    events.push(event);
  }

  return events;
}

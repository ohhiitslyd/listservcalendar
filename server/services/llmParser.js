import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * LLM-based email parser using OpenAI API with event type tagging
 *
 * Features:
 * - JSON mode for guaranteed valid JSON output
 * - Retry logic for resilient API calls
 * - Vision API for extracting full event details from poster images
 * - Few-shot examples for improved accuracy
 */

// Configuration
const LLM_CONFIG = {
  model: "gpt-4o",
  temperature: 0.3,
  maxTokens: 600,
  maxRetries: 3,
  retryDelayMs: 1000,
  visionMaxTokens: 400,
  // API base URL - can be overridden for Azure OpenAI or other providers
  apiBaseUrl: process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1",
};

// Load event type definitions
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVENT_TYPE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "event_types",
  "event_type_des.json"
);

let EVENT_TAGS = { tags: {} };
try {
  const raw = fs.readFileSync(EVENT_TYPE_PATH, "utf8");
  EVENT_TAGS = JSON.parse(raw);
  console.log(
    "[llm-parser] Loaded",
    Object.keys(EVENT_TAGS.tags || {}).length,
    "event type tags"
  );
} catch (e) {
  console.warn("[llm-parser] Could not load event_type_des.json:", e.message);
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate and sanitize a time string in HH:MM:SS format
 * Returns null if the time is invalid
 * @param {string} timeStr - Time string to validate
 * @returns {string|null} - Valid time string or null
 */
function validateTimeString(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;

  const match = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);

  // Validate ranges: hours 0-23, minutes 0-59, seconds 0-59
  if (hours < 0 || hours > 23) {
    console.warn(`[llm-parser] Invalid hour value: ${hours}, setting time to null`);
    return null;
  }
  if (minutes < 0 || minutes > 59) {
    console.warn(`[llm-parser] Invalid minute value: ${minutes}, setting time to null`);
    return null;
  }
  if (seconds < 0 || seconds > 59) {
    console.warn(`[llm-parser] Invalid second value: ${seconds}, setting time to null`);
    return null;
  }

  // Return properly formatted time
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Make an OpenAI API call with retry logic
 * @param {string} apiKey - OpenAI API key
 * @param {Object} requestBody - The request body for the API
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<Object>} The API response data
 */
async function callOpenAIWithRetry(apiKey, requestBody, maxRetries = LLM_CONFIG.maxRetries) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${LLM_CONFIG.apiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Don't retry on auth errors or invalid requests
        if (response.status === 401 || response.status === 400) {
          throw new Error(`API error ${response.status}: ${errorText}`);
        }
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`[llm-parser] Attempt ${attempt}/${maxRetries} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const delay = LLM_CONFIG.retryDelayMs * attempt; // Exponential backoff
        console.log(`[llm-parser] Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Few-shot examples for improved extraction accuracy
 * Now supports multiple events per email
 */
const FEW_SHOT_EXAMPLES = `
EXAMPLE 1 (Single event):
Email Subject: Join us for Trivia Night!
Email Body: Come test your knowledge at Murphy's Pub this Friday! Teams of up to 6, prizes for top 3 teams. Food and drinks available for purchase. 7-9 PM. All ages welcome but 21+ to drink.

Output:
{"events":[{"title":"Trivia Night at Murphy's Pub","description":"Team trivia competition with prizes for top 3 teams. Teams of up to 6 people. Food and drinks available for purchase.","location":"Murphy's Pub","startDate":"[Friday's date]","startTime":"19:00:00","endDate":"[Friday's date]","endTime":"21:00:00","allDay":false,"tags":["21+"]}]}

EXAMPLE 2 (Multiple events in one email):
Email Subject: Digital Fashion Show & Info Session
Email Body: The "Entangled Ecologies" digital fashion show debuts on June 1st at the HOP. Join us for open hours on Wed, 1/28, 5:30-7pm @ DALI Lab to learn more and ask questions. Food provided!

Output:
{"events":[{"title":"Entangled Ecologies Digital Fashion Show","description":"Digital fashion show at the Hopkins Center.","location":"HOP","startDate":"2025-06-01","startTime":null,"endDate":"2025-06-01","endTime":null,"allDay":true,"tags":["Performance"]},{"title":"Fashion Show Info Session","description":"Open hours to learn about the fashion show and ask questions. Food provided.","location":"DALI Lab","startDate":"2025-01-28","startTime":"17:30:00","endDate":"2025-01-28","endTime":"19:00:00","allDay":false,"tags":["Free Food","Mixer"]}]}

EXAMPLE 3 (No events):
Email Subject: Reminder: Summer Internship Applications Due
Email Body: Don't forget - applications for summer internships at tech companies are due by February 15th. Visit the career center for help with your resume.

Output:
{"events":[]}
`;

/**
 * Format event type tags for LLM prompt
 */
function formatEventTypesForLLM() {
  const tags = EVENT_TAGS?.tags || {};

  return Object.entries(tags)
    .map(([tagName, def]) => {
      const keywordSample = def.keywords?.slice(0, 8).join(", ") || "N/A";
      const shouldTag = def.examples_should_tag?.[0] || "N/A";
      const shouldNotTag = def.examples_should_not_tag?.[0] || "N/A";

      return `**${tagName}**
- Description: ${def.description}
- Rules: ${def.rules}
- Keywords: ${keywordSample}...
- ✓ Should tag: ${shouldTag}
- ✗ Should NOT tag: ${shouldNotTag}`;
    })
    .join("\n\n");
}

/**
 * Convert HTML to plain text, removing base64 image data and other bloat
 */
function htmlToText(html) {
  if (!html) return "";

  let cleanedHtml = html
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "[image]")
    .replace(/src\s*=\s*["']data:image\/[^"']+["']/gi, 'src="[image]"')
    .replace(
      /background-image\s*:\s*url\(data:image\/[^)]+\)/gi,
      "background-image: url([image])"
    );

  const $ = cheerio.load(cleanedHtml);
  $("script, style").remove();
  $("img").remove();

  $("*").each(function () {
    const $el = $(this);
    const attrs = $el[0]?.attribs || {};
    for (const attr in attrs) {
      if (attrs[attr]?.includes("data:image/")) {
        $el.attr(attr, "[image]");
      }
    }
  });

  $("br").replaceWith("\n");
  $("p, div").each(function () {
    const $el = $(this);
    $el.replaceWith($el.text() + "\n");
  });

  let text = $.text().trim();
  text = text.replace(/[A-Za-z0-9+/]{100,}/g, "[data-removed]");
  text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{3,}/g, " ");

  return text;
}

/**
 * Extract organization from email sender name
 */
function extractOrganization(fromName) {
  if (!fromName) return null;
  let org = fromName.trim();
  org = org.replace(/<[^>]+>/g, "").trim();
  org = org.replace(/^(from|sent by|by):\s*/i, "").trim();
  return org || null;
}

/**
 * Helper function to convert time string to 24-hour format
 */
function parseTimeTo24Hour(timeStr) {
  const match = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)?/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3]?.toUpperCase();

  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:00`;
}

/**
 * Process a single raw event object from LLM response
 * Applies vision extraction, date/time parsing, validation, and formatting
 */
async function processRawEvent(rawEvent, context) {
  const { attachments, emailId, posterUrl, organization, received_date, cleanedText, apiKey, subject } = context;

  // Make a copy to avoid mutating the original
  const parsed = { ...rawEvent };

  // If key information is missing but we have image attachments, try vision API
  const needsVisionExtraction = !parsed.startTime || !parsed.startDate || !parsed.title;
  if (needsVisionExtraction && attachments && emailId) {
    try {
      const attachmentsList =
        typeof attachments === "string"
          ? JSON.parse(attachments)
          : attachments;
      if (Array.isArray(attachmentsList)) {
        const imageAttachments = attachmentsList.filter(
          (att) =>
            att.mimeType && att.mimeType.startsWith("image/") && att.data
        );

        if (imageAttachments.length > 0) {
          const imageData = imageAttachments[0].data;
          const imageMimeType = imageAttachments[0].mimeType;

          const visionPrompt = `Analyze this event poster/flyer image carefully. Extract ALL visible event information.

Return a JSON object with these fields (use null if not visible):
{
  "title": "Event title/name visible on the poster",
  "date": "Date in YYYY-MM-DD format (interpret month names, e.g., 'January 30' with context year ${new Date().getFullYear()})",
  "startTime": "Start time in HH:MM:SS 24-hour format (e.g., '6:00 PM' → '18:00:00')",
  "endTime": "End time in HH:MM:SS 24-hour format, or null if not shown",
  "location": "Venue/room/address if visible",
  "description": "Brief description if visible (what the event is about)"
}

TIME CONVERSION:
- 6:00 PM → "18:00:00"
- 7:30 PM → "19:30:00"
- 12:00 PM (noon) → "12:00:00"
- 9:00 AM → "09:00:00"

Look carefully at ALL text in the image including stylized/decorative fonts. Return valid JSON only.`;

          try {
            const visionData = await callOpenAIWithRetry(apiKey, {
              model: LLM_CONFIG.model,
              messages: [
                {
                  role: "system",
                  content: "You are an expert at reading event posters and extracting structured event information. Always return valid JSON.",
                },
                {
                  role: "user",
                  content: [
                    { type: "text", text: visionPrompt },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:${imageMimeType};base64,${imageData}`,
                        detail: "high",
                      },
                    },
                  ],
                },
              ],
              max_tokens: LLM_CONFIG.visionMaxTokens,
              response_format: { type: "json_object" },
            }, 2);

            const visionContent = visionData.choices[0]?.message?.content?.trim();
            if (visionContent) {
              const visionParsed = JSON.parse(visionContent);
              console.log(`[llm-parser] Vision API extracted:`, visionParsed);

              if (visionParsed.title && !parsed.title) {
                parsed.title = visionParsed.title;
              }
              if (visionParsed.date && !parsed.startDate) {
                parsed.startDate = visionParsed.date;
              }
              if (visionParsed.startTime && !parsed.startTime) {
                parsed.startTime = visionParsed.startTime;
                parsed.allDay = false;
              }
              if (visionParsed.endTime && !parsed.endTime) {
                parsed.endTime = visionParsed.endTime;
              }
              if (visionParsed.location && !parsed.location) {
                parsed.location = visionParsed.location;
              }
              if (visionParsed.description && !parsed.description) {
                parsed.description = visionParsed.description;
              }
            }
          } catch (visionApiError) {
            console.warn("[llm-parser] Vision API call failed:", visionApiError.message);
          }
        }
      }
    } catch (visionError) {
      console.warn("[llm-parser] Vision processing error:", visionError.message);
    }
  }

  // Try to extract date from text if LLM missed it
  let extractedStartDate = parsed.startDate;
  if (!extractedStartDate && cleanedText) {
    const normalizedTextLower = cleanedText.toLowerCase();
    const emailDate = new Date(received_date);
    const today = new Date(emailDate);
    today.setHours(0, 0, 0, 0);

    if (normalizedTextLower.includes("tonight") || normalizedTextLower.includes("today")) {
      extractedStartDate = today.toISOString().split("T")[0];
    } else if (normalizedTextLower.includes("tomorrow")) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      extractedStartDate = tomorrow.toISOString().split("T")[0];
    }

    if (extractedStartDate) {
      parsed.startDate = extractedStartDate;
    }
  }

  // Validate title - generate fallback if missing
  if (!parsed.title) {
    if (subject && subject.trim()) {
      let fallbackTitle = subject.trim();
      fallbackTitle = fallbackTitle.replace(/^(RE|FWD|FW|Fwd|Re|Fw):\s*/i, "");
      fallbackTitle = fallbackTitle.replace(/[!]{2,}/g, "!");
      if (fallbackTitle.length > 100) {
        fallbackTitle = fallbackTitle.substring(0, 97) + "...";
      }
      parsed.title = fallbackTitle;
    } else {
      parsed.title = "Event";
    }
  }

  // Final validation - we must have a startDate
  if (!parsed.startDate && !extractedStartDate) {
    // Use email date as fallback
    const emailDate = new Date(received_date);
    parsed.startDate = emailDate.toISOString().split("T")[0];
    console.warn(`[llm-parser] Event "${parsed.title}" has no date - using email date as fallback`);
  }

  // Validate and clean tags
  let tags = [];
  if (parsed.tags) {
    if (Array.isArray(parsed.tags)) {
      tags = parsed.tags.filter((tag) => tag && typeof tag === "string");
    } else if (typeof parsed.tags === "string") {
      try {
        tags = JSON.parse(parsed.tags);
      } catch {
        tags = parsed.tags.split(",").map((t) => t.trim()).filter(Boolean);
      }
    }
  }
  const availableTagNames = Object.keys(EVENT_TAGS?.tags || {});
  tags = tags.filter((tag) => availableTagNames.includes(tag));

  if (tags.length > 0) {
    console.log(`[llm-parser] Event "${parsed.title}" tagged with: ${tags.join(", ")}`);
  }

  // Validate times
  const validatedStartTime = parsed.allDay ? null : validateTimeString(parsed.startTime);
  const validatedEndTime = parsed.allDay ? null : validateTimeString(parsed.endTime);

  // If times were invalid, treat as all-day event
  const effectiveAllDay = parsed.allDay || (!validatedStartTime && !validatedEndTime && !parsed.startTime);

  const event = {
    title: parsed.title,
    description: parsed.description || null,
    location: parsed.location || null,
    startDate: parsed.startDate,
    startTime: effectiveAllDay ? null : validatedStartTime,
    endDate: parsed.endDate || parsed.startDate,
    endTime: effectiveAllDay ? null : validatedEndTime,
    allDay: effectiveAllDay,
    posterUrl: posterUrl || null,
    organization: organization,
    tags: tags,
    confidenceScore: 0.95,
  };

  // If startTime exists but no endTime, set endTime to 1 hour later
  if (event.startTime && !event.endTime && !event.allDay) {
    const startDate = new Date(`${event.startDate}T${event.startTime}`);
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 1);
    event.endDate = endDate.toISOString().split("T")[0];
    event.endTime = endDate.toTimeString().split(" ")[0];
  }

  // Validate: ensure end time is not before start time
  if (event.startTime && event.endTime && !event.allDay) {
    const startDate = new Date(`${event.startDate}T${event.startTime}`);
    const endDate = new Date(`${event.endDate}T${event.endTime}`);
    if (endDate <= startDate) {
      const correctedEnd = new Date(startDate);
      correctedEnd.setHours(correctedEnd.getHours() + 1);
      event.endDate = correctedEnd.toISOString().split("T")[0];
      event.endTime = correctedEnd.toTimeString().split(" ")[0];
    }
  }

  return event;
}

/**
 * Parse email and extract event information using LLM
 * @param {Object} emailData - Email data with subject, bodyText, bodyHtml, received_date, from_name, attachments, id
 * @returns {Promise<Array>} Array of extracted events with organization added
 */
export async function parseEmailForEvents(emailData) {
  const events = [];

  if (!emailData) {
    return events;
  }

  const {
    subject,
    bodyText,
    body_text,
    bodyHtml,
    body_html,
    received_date,
    from_name,
    attachments,
    id: emailId,
  } = emailData;
  // Handle both camelCase and snake_case field names
  const text = bodyText || body_text || htmlToText(bodyHtml || body_html || "");

  if (!text && !subject) {
    return events;
  }

  const organization = extractOrganization(from_name);

  // Skip if no API key configured
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn(
      "[llm-parser] OPENAI_API_KEY not configured, skipping LLM parsing"
    );
    return events;
  }

  // Clean text to remove any remaining base64 data
  const cleanedText = text.replace(/[A-Za-z0-9+/]{100,}/g, "[data-removed]");

  const emailDate = new Date(received_date);
  const emailDateStr = emailDate.toISOString().split("T")[0];

  // Extract poster URL from attachments if available
  let posterUrl = null;
  if (attachments && emailId) {
    try {
      const attachmentsList =
        typeof attachments === "string" ? JSON.parse(attachments) : attachments;
      if (Array.isArray(attachmentsList) && attachmentsList.length > 0) {
        // Use the first image attachment as the poster
        const imageAttachment =
          attachmentsList.find(
            (att) => att.mimeType && att.mimeType.startsWith("image/")
          ) || attachmentsList[0];

        if (imageAttachment && imageAttachment.contentId) {
          // Construct the URL to serve the attachment
          posterUrl = `/api/scraped-emails/${emailId}/attachments/${imageAttachment.contentId}`;
        }
      }
    } catch (e) {
      console.warn("[llm-parser] Error parsing attachments:", e.message);
    }
  }

  const bodyPreview = cleanedText.substring(0, 10000);
  const bodyTruncated = cleanedText.length > 10000;

  // Build event type context for LLM
  const eventTypesContext = formatEventTypesForLLM();

  // Build prompt with event type tagging
  const prompt = `Extract event information from this email and assign appropriate event type tags. Today's date is ${emailDateStr}.

Email Subject: ${subject || "(no subject)"}
From: ${from_name || "Unknown"}
Email Body:
${bodyPreview}${
    bodyTruncated ? "\n[... email continues but truncated ...]" : ""
  }

WHAT IS AN EVENT?
- An event is a gathering, meeting, performance, workshop, lecture, social activity, or similar happening that people can attend
- Events have a specific date/time when they occur
- DO extract: concerts, meetings, workshops, parties, lectures, performances, social gatherings, study sessions, fundraisers, etc.
- DO NOT extract: application deadlines, survey requests, reminders, announcements without dates, parking applications, general announcements

EVENT TYPE TAGS - Assign ALL applicable tags from this list:
${eventTypesContext}

IMPORTANT: An email may contain MULTIPLE events with DIFFERENT dates/times. Extract ALL events separately.

Return a JSON object with an "events" array containing ALL events found:
{
  "events": [
    {
      "title": "Event title (MUST extract if event exists)",
      "description": "Concise summary (2-3 sentences max)",
      "location": "Location or null",
      "startDate": "YYYY-MM-DD (REQUIRED for each event)",
      "startTime": "HH:MM:SS or null (24-hour format, null if all-day)",
      "endDate": "YYYY-MM-DD or null",
      "endTime": "HH:MM:SS or null (24-hour format, null if all-day)",
      "allDay": true or false,
      "tags": ["Tag1", "Tag2"]
    }
  ]
}

CRITICAL: Return actual JSON null values (not the string "null"). For example:
- CORRECT: "location": null
- WRONG: "location": "null"

MULTI-EVENT EXTRACTION RULES:
- If an email mentions multiple events with DIFFERENT dates (e.g., "Fashion show on June 1st" AND "Info session on Jan 28"), extract EACH as a separate event
- Each event MUST have its own correct date and time - do NOT mix dates/times between events
- If an email has a main event AND a related info session/open hours, extract BOTH
- Return an empty array {"events":[]} if no events are found

CRITICAL EXTRACTION RULES:
- ALWAYS extract a title if there's any event mentioned (even if incomplete)
- ALWAYS extract a startDate if there's ANY date/time reference (TONIGHT, TOMORROW, specific dates)
- If the email mentions "TONIGHT", "TODAY", or "TOMORROW" - these ARE valid dates (use ${emailDateStr} as reference)
- If only a deadline is mentioned but it's for an event (e.g., "Register by Dec 21 for event on Jan 5"), extract the EVENT date (Jan 5), not the deadline
- If the email is ONLY about applications, surveys, or reminders with no actual event, return {"events":[]}

IMPORTANT: The description field should be a brief, informative summary of what the event is about. Extract key details from the email body that would help someone understand what the event is.

EVENT TYPE TAGGING RULES:
- Read the email content carefully and assign ALL applicable event type tags
- Follow the description, rules, and examples for each tag precisely
- "Free Food": Only tag if food is PROVIDED to attendees (NOT collecting/donating food)
- "Philanthropy": Only tag if fundraising/charity/service is EXPLICITLY mentioned
- "21+": Only tag if age restriction is EXPLICITLY stated
- "Performance": Tag for live shows, concerts, theater (NOT film screenings)
- "Screening": Tag for film/movie viewings
- "Workshop": Tag for hands-on, interactive learning
- "Lecture/Speaker": Tag for talks where attendees primarily listen
- Multiple tags can and should be applied when appropriate
- When in doubt about a tag, DO NOT include it

CRITICAL RULES FOR TIME DETECTION:
- ONLY extract times that are EXPLICITLY mentioned in the email text - NEVER guess or invent times
- If NO time is mentioned anywhere, set allDay: true and leave startTime/endTime as null
- If ANY time is mentioned, set allDay: false and extract the time(s)

TIME EXTRACTION EXAMPLES (follow these EXACTLY):
1. "7 - 8:30PM" → startTime: "19:00:00", endTime: "20:30:00", allDay: false
2. "TONIGHT 10PM" → startTime: "22:00:00", endTime: null, allDay: false
3. "6:00 PM - 8:00 PM" → startTime: "18:00:00", endTime: "20:00:00", allDay: false
4. "@5:30" (with no AM/PM, assume PM if evening context) → startTime: "17:30:00", endTime: null, allDay: false
5. "11/18/2025" (date only, NO time) → startTime: null, endTime: null, allDay: true
6. "TOMORROW" (date only, NO time) → startTime: null, endTime: null, allDay: true

TIME CONVERSION REFERENCE (24-hour format):
- 12:00 AM = "00:00:00", 1:00 AM = "01:00:00", ..., 11:00 AM = "11:00:00"
- 12:00 PM = "12:00:00" (noon)
- 1:00 PM = "13:00:00", 2:00 PM = "14:00:00", 3:00 PM = "15:00:00"
- 4:00 PM = "16:00:00", 5:00 PM = "17:00:00", 6:00 PM = "18:00:00"
- 7:00 PM = "19:00:00", 8:00 PM = "20:00:00", 8:30 PM = "20:30:00"
- 9:00 PM = "21:00:00", 10:00 PM = "22:00:00", 11:00 PM = "23:00:00"

CRITICAL TIME VALIDATION:
- Hours MUST be 00-23 (never 24 or higher)
- Minutes MUST be 00-59 (never 60 or higher)
- Seconds MUST be 00-59 (never 60 or higher)
- INVALID examples: "42:00:00", "25:30:00", "12:60:00" - NEVER output these
- If you cannot determine a valid time, use null instead of guessing

DATE EXTRACTION RULES:
- Use relative dates correctly: "TONIGHT"/"TODAY" = ${emailDateStr}, "TOMORROW" = day after ${emailDateStr}
- If this email is NOT about an event (only applications, surveys, reminders), return null for all fields
- If this email IS about an event, you MUST extract title and startDate
- Be aggressive about extracting dates from context

${FEW_SHOT_EXAMPLES}

Now extract from the email above. Return ONLY valid JSON:`;

  try {
    // Use JSON mode for guaranteed valid JSON output
    const data = await callOpenAIWithRetry(apiKey, {
      model: LLM_CONFIG.model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that extracts event information from emails. An email may contain multiple events - extract ALL of them. Always respond with valid JSON in the format {\"events\": [...]}. If no events are found, return {\"events\": []}.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: LLM_CONFIG.temperature,
      max_tokens: LLM_CONFIG.maxTokens * 2, // Increased for multi-event responses
      response_format: { type: "json_object" }, // JSON mode - guarantees valid JSON
    });

    const content = data.choices[0]?.message?.content?.trim();

    if (!content) {
      console.warn("[llm-parser] No content in LLM response");
      return [];
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    let parsed = JSON.parse(jsonStr);

    // Handle both new array format {"events": [...]} and legacy single-object format
    let rawEvents = [];
    if (parsed.events && Array.isArray(parsed.events)) {
      rawEvents = parsed.events;
      console.log(`[llm-parser] LLM returned ${rawEvents.length} event(s)`);
    } else if (parsed.title || parsed.startDate) {
      // Legacy single-object format for backward compatibility
      rawEvents = [parsed];
      console.log(`[llm-parser] LLM returned legacy single event format`);
    } else {
      console.log(`[llm-parser] No events found in email`);
      return [];
    }

    // Process each event
    const processedEvents = [];
    for (const rawEvent of rawEvents) {
      // Fix: LLM sometimes returns string "null" or null for boolean fields
      // Convert all string "null" values to actual null
      if (rawEvent.startTime === "null") rawEvent.startTime = null;
      if (rawEvent.endTime === "null") rawEvent.endTime = null;
      if (rawEvent.startDate === "null") rawEvent.startDate = null;
      if (rawEvent.endDate === "null") rawEvent.endDate = null;
      if (rawEvent.location === "null") rawEvent.location = null;
      if (rawEvent.description === "null") rawEvent.description = null;
      if (rawEvent.title === "null") rawEvent.title = null;
      // Fix: allDay should always be a boolean
      if (rawEvent.allDay !== true && rawEvent.allDay !== false) {
        rawEvent.allDay = !rawEvent.startTime && !rawEvent.endTime; // Default based on time presence
      }

      // Process this event (rest of the logic will be applied per-event)
      const processedEvent = await processRawEvent(rawEvent, {
        attachments,
        emailId,
        posterUrl,
        organization,
        received_date,
        cleanedText,
        apiKey,
        subject,
      });

      if (processedEvent) {
        processedEvents.push(processedEvent);
      }
    }

    return processedEvents;
  } catch (error) {
    console.error("[llm-parser] Error parsing with LLM:", error.message);
    return [];
  }
}

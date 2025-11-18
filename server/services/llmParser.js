import * as cheerio from "cheerio";

/**
 * LLM-based email parser using OpenAI API
 */

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
    bodyHtml,
    received_date,
    from_name,
    attachments,
    id: emailId,
  } = emailData;
  const text = bodyText || htmlToText(bodyHtml || "");

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

  // Build prompt with improved time detection
  const prompt = `Extract event information from this email. Today's date is ${emailDateStr}.

Email Subject: ${subject || "(no subject)"}
From: ${from_name || "Unknown"}
Email Body:
${bodyPreview}${
    bodyTruncated ? "\n[... email continues but truncated ...]" : ""
  }

Extract the following information as JSON:
{
  "title": "Event title or null",
  "description": "Event description or null",
  "location": "Location or null",
  "startDate": "YYYY-MM-DD or null",
  "startTime": "HH:MM:SS or null (24-hour format, or null if all-day)",
  "endDate": "YYYY-MM-DD or null",
  "endTime": "HH:MM:SS or null (24-hour format, or null if all-day)",
  "allDay": true or false
}

CRITICAL RULES FOR TIME DETECTION:
- If ANY time is mentioned (even just "6:00 PM", "5:30", "@8PM", "6:00–8:00 PM", "6:00-8:00 PM", etc.), set allDay: false
- Time formats to detect include:
  * Standard: "6:00 PM", "5:30 PM", "11PM", "10:15 AM"
  * With en-dash (–): "6:00–8:00 PM", "5:30–7:30 PM" (common in emails)
  * With hyphen (-): "6:00-8:00 PM", "5:30-7:30 PM", "6-7 PM" (short ranges)
  * With em-dash (—): "6:00—8:00 PM"
  * Ranges: "6-8 PM", "5:30-7:30", "6:00 to 8:00 PM", "6-7 PM"
  * Single times: "@8PM", "at 5:30", "TONIGHT @ 10PM"
- If a time RANGE is mentioned (e.g., "6:00–8:00 PM", "6:00-8:00 PM", "6-7 PM"), extract BOTH startTime and endTime
- If only start time is mentioned, set endTime to 1 hour after startTime
- If ONLY a date is mentioned with NO time at all, set allDay: true
- Look for time indicators like: ⏰, 🕐, "Time:", "WHEN:", "at", "@", etc.
- Use relative dates correctly: "TONIGHT" = today, "TOMORROW" = next day, "Sunday" = next Sunday, "TODAY" = today
- Date formats to recognize:
  * "Sun, Nov 16, 2025" → "2025-11-16"
  * "Sunday, November 16, 2025" → "2025-11-16"
  * "Nov 16, 2025" → "2025-11-16"
  * "11/16/2025" → "2025-11-16"
  * Relative: "TODAY", "TOMORROW", "Sunday" (next Sunday from email date)
- Dates should be in YYYY-MM-DD format
- Times should be in HH:MM:SS format (24-hour, e.g., "18:00:00" for 6 PM)
- For time ranges like "6:00–8:00 PM", "6:00-8:00 PM", or "6-7 PM", convert to: startTime="18:00:00", endTime="20:00:00" (or "19:00:00" for "6-7 PM")
- If no event information is found, return null for all fields
- Return ONLY valid JSON, no other text`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o", // Cheaper, faster model
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant that extracts event information from emails. Always return valid JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent parsing
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[llm-parser] API error: ${response.status} ${errorText}`);
      return [];
    }

    const data = await response.json();
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

    const parsed = JSON.parse(jsonStr);

    // Debug logging
    console.log(`[llm-parser] Parsed event for "${subject}":`, {
      title: parsed.title,
      startDate: parsed.startDate,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      allDay: parsed.allDay,
      location: parsed.location,
    });

    // Try to extract date from text if LLM missed it (do this early for validation)
    let extractedStartDate = parsed.startDate;
    if (!extractedStartDate) {
      // Look for date patterns in text
      const datePatterns = [
        /(?:WHEN|DATE|WHEN:)\s*:?\s*(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)day?,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i,
        /(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)day?,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i,
        /\d{1,2}\/\d{1,2}\/\d{4}/,
      ];

      for (const pattern of datePatterns) {
        const match = cleanedText.match(pattern);
        if (match) {
          try {
            const date = new Date(match[0]);
            if (!isNaN(date.getTime())) {
              extractedStartDate = date.toISOString().split("T")[0];
              console.log(
                `[llm-parser] Extracted date from text: ${match[0]} → ${extractedStartDate}`
              );
              break;
            }
          } catch (e) {
            // Continue to next pattern
          }
        }
      }
    }

    // Validate and format the response
    if (!parsed.title || (!parsed.startDate && !extractedStartDate)) {
      console.warn(`[llm-parser] Invalid event - missing title or startDate:`, {
        title: parsed.title,
        startDate: parsed.startDate,
        extractedStartDate: extractedStartDate,
      });
      return []; // Invalid event
    }

    // Post-process: Check if text contains time patterns that LLM might have missed
    // Helper function to convert time string to 24-hour format
    const parseTimeTo24Hour = (timeStr) => {
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
    };

    // Try to extract time from text if LLM missed it
    let extractedStartTime = parsed.startTime;
    let extractedEndTime = parsed.endTime;

    const normalizedText = cleanedText
      .replace(/\r\n|\r|\n/g, " ")
      .replace(/\s+/g, " ");

    if (!parsed.startTime && !parsed.endTime) {
      // Try to find time range: "6:00–8:00 PM", "6:00-8:00 PM", "6-8 PM", or "6-7 PM"
      // Pattern 1: Full format with colons: "6:00–8:00 PM" (use normalized text)
      let rangeMatch = normalizedText.match(
        /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i
      );

      // Pattern 2: Short format without colons: "6-8 PM" or "6-7 PM"
      if (!rangeMatch) {
        const shortMatch = normalizedText.match(
          /(\d{1,2})\s*[–—-]\s*(\d{1,2})\s*(AM|PM|am|pm)/i
        );
        if (shortMatch) {
          const startTimeStr = `${shortMatch[1]}:00 ${shortMatch[3]}`;
          const endTimeStr = `${shortMatch[2]}:00 ${shortMatch[3]}`;
          extractedStartTime = parseTimeTo24Hour(startTimeStr);
          extractedEndTime = parseTimeTo24Hour(endTimeStr);
          console.log(
            `[llm-parser] Extracted time range from text: ${startTimeStr} - ${endTimeStr}`
          );
        }
      }

      // Pattern 3: Mixed format: "6:00-8 PM" or "6-8:00 PM" (only if Pattern 1 and 2 didn't match)
      if (!rangeMatch && !extractedStartTime) {
        rangeMatch = normalizedText.match(
          /(\d{1,2}):?(\d{2})?\s*[–—-]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)/i
        );
      }

      if (rangeMatch && !extractedStartTime) {
        const startTimeStr = `${rangeMatch[1]}:${rangeMatch[2] || "00"} ${
          rangeMatch[5]
        }`;
        const endTimeStr = `${rangeMatch[3]}:${rangeMatch[4] || "00"} ${
          rangeMatch[5]
        }`;
        extractedStartTime = parseTimeTo24Hour(startTimeStr);
        extractedEndTime = parseTimeTo24Hour(endTimeStr);
        console.log(
          `[llm-parser] Extracted time range from text: ${startTimeStr} - ${endTimeStr}`
        );
      }

      if (!extractedStartTime) {
        // Try to find single time: "6:00 PM" or "@8PM" or "at 5:30 PM"
        const singleTimeMatch =
          normalizedText.match(
            /(?:@|at)\s*(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)?/i
          ) || normalizedText.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i);
        if (singleTimeMatch) {
          const timeStr = singleTimeMatch[0].replace(/[@at]/gi, "").trim();
          extractedStartTime = parseTimeTo24Hour(timeStr);
          console.log(
            `[llm-parser] Extracted single time from text: ${timeStr}`
          );
        }
      }
    }

    const timeIndicators = /⏰|🕐|🕑|🕒|🕓|🕔|🕕|🕖|🕗|🕘|🕙|🕚|🕛/;
    const hasTimeEmoji = timeIndicators.test(cleanedText);

    // If time emoji found but no time extracted, try to find time near the emoji
    if (hasTimeEmoji && !extractedStartTime && !parsed.startTime) {
      // Look for time pattern near the emoji (within 50 chars)
      const emojiIndex = normalizedText.search(timeIndicators);
      if (emojiIndex >= 0) {
        const context = normalizedText.substring(
          Math.max(0, emojiIndex - 10),
          emojiIndex + 50
        );
        const timeNearEmoji = context.match(
          /(\d{1,2}):?(\d{2})?\s*[–—-]?\s*(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)/i
        );
        if (timeNearEmoji) {
          if (timeNearEmoji[3] && timeNearEmoji[5]) {
            // Time range
            const startTimeStr = `${timeNearEmoji[1]}:${
              timeNearEmoji[2] || "00"
            } ${timeNearEmoji[5]}`;
            const endTimeStr = `${timeNearEmoji[3]}:${
              timeNearEmoji[4] || "00"
            } ${timeNearEmoji[5]}`;
            extractedStartTime = parseTimeTo24Hour(startTimeStr);
            extractedEndTime = parseTimeTo24Hour(endTimeStr);
            console.log(
              `[llm-parser] Extracted time range near emoji: ${startTimeStr} - ${endTimeStr}`
            );
          } else {
            // Single time
            const timeStr = `${timeNearEmoji[1]}:${timeNearEmoji[2] || "00"} ${
              timeNearEmoji[5] || "PM"
            }`;
            extractedStartTime = parseTimeTo24Hour(timeStr);
            console.log(
              `[llm-parser] Extracted single time near emoji: ${timeStr}`
            );
          }
        }
      }
    }

    // Validate: if startTime exists OR time pattern found in text, it should NOT be all-day
    const hasTime =
      extractedStartTime ||
      extractedEndTime ||
      parsed.startTime ||
      parsed.endTime ||
      hasTimeEmoji;
    const allDay = parsed.allDay && !hasTime; // Only all-day if explicitly set AND no time exists

    if (hasTimeEmoji && !extractedStartTime && !parsed.startTime) {
      console.warn(
        `[llm-parser] Time emoji detected but no time extracted. Text snippet: "${cleanedText.substring(
          0,
          300
        )}"`
      );
    }

    const event = {
      title: parsed.title,
      description: parsed.description || null,
      location: parsed.location || null,
      startDate: extractedStartDate || parsed.startDate,
      startTime: allDay ? null : extractedStartTime || parsed.startTime || null,
      endDate: parsed.endDate || extractedStartDate || parsed.startDate,
      endTime: allDay ? null : extractedEndTime || parsed.endTime || null,
      allDay: allDay,
      posterUrl: posterUrl || null,
      organization: organization,
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
        // If end is before or equal to start, add 1 hour to start
        const correctedEnd = new Date(startDate);
        correctedEnd.setHours(correctedEnd.getHours() + 1);
        event.endDate = correctedEnd.toISOString().split("T")[0];
        event.endTime = correctedEnd.toTimeString().split(" ")[0];
      }
    }

    return [event];
  } catch (error) {
    console.error("[llm-parser] Error parsing with LLM:", error.message);
    return [];
  }
}

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

  // Build prompt with improved time detection
  const prompt = `Extract event information from this email. Today's date is ${emailDateStr}.

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

Extract the following information as JSON:
{
  "title": "Event title or null (MUST extract if event exists, even if partial)",
  "description": "Concise summary of the event (2-3 sentences max, or null if no description available)",
  "location": "Location or null",
  "startDate": "YYYY-MM-DD or null (REQUIRED if this is an event - extract from 'TONIGHT', 'TOMORROW', dates, deadlines if event-related)",
  "startTime": "HH:MM:SS or null (24-hour format, or null if all-day)",
  "endDate": "YYYY-MM-DD or null",
  "endTime": "HH:MM:SS or null (24-hour format, or null if all-day)",
  "allDay": true or false
}

CRITICAL: Return actual JSON null values (not the string "null"). For example:
- CORRECT: "location": null
- WRONG: "location": "null"

CRITICAL EXTRACTION RULES:
- ALWAYS extract a title if there's any event mentioned (even if incomplete)
- ALWAYS extract a startDate if there's ANY date/time reference (TONIGHT, TOMORROW, specific dates, deadlines for events)
- If the email mentions "TONIGHT", "TODAY", or "TOMORROW" - these ARE valid dates (use ${emailDateStr} as reference)
- If only a deadline is mentioned but it's for an event (e.g., "Register by Dec 21 for event on Jan 5"), extract the EVENT date (Jan 5), not the deadline
- If the email is ONLY about applications, surveys, or reminders with no actual event, return null for all fields

IMPORTANT: The description field should be a brief, informative summary of what the event is about. Extract key details from the email body that would help someone understand what the event is.

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

DATE EXTRACTION RULES:
- Use relative dates correctly: "TONIGHT"/"TODAY" = ${emailDateStr}, "TOMORROW" = day after ${emailDateStr}
- If this email is NOT about an event (only applications, surveys, reminders), return null for all fields
- If this email IS about an event, you MUST extract title and startDate
- Be aggressive about extracting dates from context

Return ONLY valid JSON, no other text`;

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

    let parsed = JSON.parse(jsonStr);

    // Fix: LLM sometimes returns string "null" or null for boolean fields
    // Convert all string "null" values to actual null
    if (parsed.startTime === "null") parsed.startTime = null;
    if (parsed.endTime === "null") parsed.endTime = null;
    if (parsed.startDate === "null") parsed.startDate = null;
    if (parsed.endDate === "null") parsed.endDate = null;
    if (parsed.location === "null") parsed.location = null;
    if (parsed.description === "null") parsed.description = null;
    if (parsed.title === "null") parsed.title = null;
    // Fix: allDay should always be a boolean
    if (parsed.allDay !== true && parsed.allDay !== false) {
      parsed.allDay = !parsed.startTime && !parsed.endTime; // Default based on time presence
    }

    // If time is missing but we have image attachments, try vision API
    if (!parsed.startTime && !parsed.endTime && attachments && emailId) {
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
            // Use first image for vision API
            const imageData = imageAttachments[0].data;
            const imageMimeType = imageAttachments[0].mimeType;

            const visionPrompt = `Look at this event poster/image. Extract the event time information if it's visible in the image. 
Return ONLY a JSON object with:
{
  "startTime": "HH:MM:SS in 24-hour format or null",
  "endTime": "HH:MM:SS in 24-hour format or null"
}
If you see a time like "6:00 PM", convert it to "18:00:00". If you see a time range like "6:00-8:00 PM", extract both startTime and endTime.
If no time is visible, return {"startTime": null, "endTime": null}.`;

            const visionResponse = await fetch(
              "https://api.openai.com/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  model: "gpt-4o",
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text: visionPrompt },
                        {
                          type: "image_url",
                          image_url: {
                            url: `data:${imageMimeType};base64,${imageData}`,
                          },
                        },
                      ],
                    },
                  ],
                  max_tokens: 200,
                }),
              }
            );

            if (visionResponse.ok) {
              const visionData = await visionResponse.json();
              const visionContent =
                visionData.choices[0]?.message?.content?.trim();
              if (visionContent) {
                const visionJsonMatch = visionContent.match(/\{[\s\S]*\}/);
                if (visionJsonMatch) {
                  const visionParsed = JSON.parse(visionJsonMatch[0]);
                  if (visionParsed.startTime || visionParsed.endTime) {
                    parsed.startTime =
                      visionParsed.startTime || parsed.startTime;
                    parsed.endTime = visionParsed.endTime || parsed.endTime;
                    parsed.allDay = false; // If we found time, it's not all-day
                    console.log(
                      `[llm-parser] Extracted time from image: startTime=${parsed.startTime}, endTime=${parsed.endTime}`
                    );
                  }
                }
              }
            }
          }
        }
      } catch (visionError) {
        console.warn("[llm-parser] Vision API error:", visionError.message);
      }
    }

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
      // First, check for relative dates in the text
      const normalizedText = cleanedText.toLowerCase();
      const emailDate = new Date(received_date);
      const today = new Date(emailDate);
      today.setHours(0, 0, 0, 0);

      if (
        normalizedText.includes("tonight") ||
        normalizedText.includes("today")
      ) {
        extractedStartDate = today.toISOString().split("T")[0];
        console.log(
          `[llm-parser] Extracted date from relative: TONIGHT/TODAY → ${extractedStartDate}`
        );
      } else if (normalizedText.includes("tomorrow")) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        extractedStartDate = tomorrow.toISOString().split("T")[0];
        console.log(
          `[llm-parser] Extracted date from relative: TOMORROW → ${extractedStartDate}`
        );
      } else {
        // Look for date patterns in text
        const datePatterns = [
          /(?:WHEN|DATE|WHEN:)\s*:?\s*(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)day?,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i,
          /(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)day?,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i,
          /\d{1,2}\/\d{1,2}\/\d{4}/,
          /\d{1,2}\/\d{1,2}\/\d{2}/, // Also try 2-digit year
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

      // If we extracted a date, update parsed object
      if (extractedStartDate) {
        parsed.startDate = extractedStartDate;
      }
    }

    // Validate and format the response
    // Title is optional - generate fallback from subject if missing
    if (!parsed.title) {
      // Try to extract a title from the subject line
      if (subject && subject.trim()) {
        // Clean up the subject - remove common prefixes/suffixes
        let fallbackTitle = subject.trim();
        // Remove common email prefixes
        fallbackTitle = fallbackTitle.replace(
          /^(RE|FWD|FW|Fwd|Re|Fw):\s*/i,
          ""
        );
        // Remove excessive punctuation
        fallbackTitle = fallbackTitle.replace(/[!]{2,}/g, "!");
        // Limit length
        if (fallbackTitle.length > 100) {
          fallbackTitle = fallbackTitle.substring(0, 97) + "...";
        }
        parsed.title = fallbackTitle;
        console.log(
          `[llm-parser] Generated fallback title from subject: "${parsed.title}"`
        );
      } else {
        // Last resort: use a generic title
        parsed.title = "Event";
        console.warn(
          `[llm-parser] No title found, using generic "Event" title`
        );
      }
    }

    // For startDate, be more lenient - try to extract from text if LLM missed it
    // But if we still can't find a date after all attempts, it might not be an event
    if (!parsed.startDate && !extractedStartDate) {
      // Check if title suggests it's not an event (applications, surveys, etc.)
      const nonEventKeywords = [
        "apply",
        "application",
        "survey",
        "reminder",
        "deadline",
        "register for",
        "sign up for",
      ];
      const titleLower = parsed.title.toLowerCase();
      const isNonEvent = nonEventKeywords.some((keyword) =>
        titleLower.includes(keyword)
      );

      if (isNonEvent) {
        console.log(
          `[llm-parser] Skipping non-event: "${parsed.title}" (appears to be application/survey/reminder)`
        );
        return []; // Likely not an event
      }

      // If it has a title but no date, and it's not clearly a non-event, we still need a date
      // Use the email's received_date as a fallback (assume event is on the day email was received)
      if (!extractedStartDate) {
        const emailDate = new Date(received_date);
        extractedStartDate = emailDate.toISOString().split("T")[0];
        parsed.startDate = extractedStartDate;
        console.warn(
          `[llm-parser] Event has title but no date - using email date as fallback:`,
          {
            title: parsed.title,
            fallbackDate: extractedStartDate,
            subject: subject,
          }
        );
      }
    }

    // Final validation - we must have a startDate at this point
    if (!parsed.startDate && !extractedStartDate) {
      console.warn(`[llm-parser] Cannot create event without date:`, {
        title: parsed.title,
        subject: subject,
      });
      return [];
    }

    // Use extracted date if we found one
    if (extractedStartDate && !parsed.startDate) {
      parsed.startDate = extractedStartDate;
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

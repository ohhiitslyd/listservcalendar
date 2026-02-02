import { google } from "googleapis";
import crypto from "crypto";

/**
 * Email Scraper Service
 * Handles Gmail API interactions to fetch emails from Campus-Events mailing list
 */

/**
 * Search for emails using Gmail API
 * @param {Object} oauth2Client - Authenticated OAuth2 client
 * @param {Object} options - Search options
 * @param {string} options.query - Gmail search query (default: to campus-events@dartmouth.edu)
 * @param {number} options.maxResults - Maximum number of results (default: 50)
 * @param {string} options.pageToken - Page token for pagination
 * @returns {Promise<Object>} List of message IDs and next page token
 */
export async function searchEmails(oauth2Client, options = {}) {
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const {
    query = "to:campus-events@dartmouth.edu",
    maxResults = 50,
    pageToken = null,
  } = options;

  try {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
      pageToken,
    });

    return {
      messages: response.data.messages || [],
      nextPageToken: response.data.nextPageToken || null,
      resultSizeEstimate: response.data.resultSizeEstimate || 0,
    };
  } catch (error) {
    console.error("[emailScraper] Error searching emails:", error.message);
    throw error;
  }
}

/**
 * Fetch attachment data by attachmentId (for large attachments)
 * @param {Object} oauth2Client - Authenticated OAuth2 client
 * @param {string} messageId - Gmail message ID
 * @param {string} attachmentId - Gmail attachment ID
 * @returns {Promise<string>} Base64-encoded attachment data
 */
async function fetchAttachmentData(oauth2Client, messageId, attachmentId) {
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const response = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: messageId,
      id: attachmentId,
    });

    return response.data.data; // Base64-encoded data
  } catch (error) {
    console.error(
      `[emailScraper] Error fetching attachment ${attachmentId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Fetch full email content by message ID
 * @param {Object} oauth2Client - Authenticated OAuth2 client
 * @param {string} messageId - Gmail message ID
 * @returns {Promise<Object>} Parsed email data
 */
export async function fetchEmailContent(oauth2Client, messageId) {
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const response = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const message = response.data;
    const headers = message.payload.headers || [];

    // Extract headers
    const getHeader = (name) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ||
      "";

    const fromHeader = getHeader("From");
    const fromMatch = fromHeader.match(/^(.+?)\s*<(.+?)>$/) || [
      null,
      fromHeader,
      fromHeader,
    ];
    const fromName = fromMatch[1]?.trim() || "";
    const fromEmail = fromMatch[2]?.trim() || fromHeader;

    // Extract body content and inline attachments (images with Content-ID)
    let bodyText = "";
    let bodyHtml = "";
    const attachments = [];

    const extractBody = (part, msgId = messageId) => {
      // Extract headers from this part
      const partHeaders = part.headers || [];
      const getPartHeader = (name) =>
        partHeaders.find((h) => h.name.toLowerCase() === name.toLowerCase())
          ?.value || "";

      // Check for image attachments (both inline with Content-ID and regular attachments)
      const contentId = getPartHeader("Content-ID");
      const contentDisposition = getPartHeader("Content-Disposition");
      const filename =
        getPartHeader("Content-Name") ||
        getPartHeader("Filename") ||
        part.filename ||
        contentDisposition?.match(/filename="?([^";\n]+)"?/i)?.[1];
      const mimeType = part.mimeType || "";

      const hasData = part.body?.data;
      const hasAttachmentId = part.body?.attachmentId;
      const isImage = mimeType.startsWith("image/");

      // Capture both inline images (with Content-ID) and regular image attachments
      if (isImage && (hasData || hasAttachmentId)) {
        // Generate a unique ID for attachments without Content-ID
        const attachmentIndex = attachments.length;
        const generatedId = contentId
          ? contentId.replace(/[<>]/g, "")
          : `attachment_${attachmentIndex}_${Date.now()}`;

        const attachmentData = {
          contentId: generatedId,
          mimeType: mimeType,
          filename: filename || `image_${attachmentIndex}.${mimeType.split("/")[1] || "jpg"}`,
          size: part.body.size || 0,
          isInline: !!contentId, // Track if this was an inline image
        };

        if (hasData) {
          attachmentData.data = part.body.data;
        } else if (hasAttachmentId) {
          attachmentData.attachmentId = part.body.attachmentId;
          attachmentData.messageId = msgId;
        }

        attachments.push(attachmentData);
      }

      // Extract text/html body (always extract, even if there are attachments)
      if (
        part.body?.data &&
        (part.mimeType === "text/plain" || part.mimeType === "text/html")
      ) {
        const data = Buffer.from(part.body.data, "base64").toString("utf-8");
        if (part.mimeType === "text/plain") {
          bodyText = data;
        } else if (part.mimeType === "text/html") {
          bodyHtml = data;
        }
      }

      // Recursively process nested parts
      if (part.parts) {
        part.parts.forEach((p) => extractBody(p, msgId));
      }
    };

    extractBody(message.payload, messageId);

    for (const attachment of attachments) {
      if (attachment.attachmentId && !attachment.data) {
        try {
          attachment.data = await fetchAttachmentData(
            oauth2Client,
            attachment.messageId,
            attachment.attachmentId
          );
          delete attachment.attachmentId;
          delete attachment.messageId;
        } catch (error) {
          console.error(
            `[emailScraper] Failed to fetch attachment ${attachment.contentId}:`,
            error.message
          );
          const index = attachments.indexOf(attachment);
          if (index > -1) attachments.splice(index, 1);
        }
      }
    }

    // Get date
    const dateHeader = getHeader("Date");
    const receivedDate = dateHeader
      ? new Date(dateHeader).toISOString()
      : new Date().toISOString();

    return {
      gmailMessageId: messageId,
      threadId: message.threadId,
      fromEmail,
      fromName,
      subject: getHeader("Subject"),
      bodyText,
      bodyHtml,
      receivedDate,
      attachments: attachments.length > 0 ? attachments : null,
    };
  } catch (error) {
    console.error(
      `[emailScraper] Error fetching email ${messageId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Scrape emails and store them in database
 * @param {Object} oauth2Client - Authenticated OAuth2 client
 * @param {string} userId - User ID
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {Object} options - Scraping options
 * @param {number} options.maxResults - Maximum number of emails to fetch
 * @param {string} options.query - Gmail search query
 * @param {boolean} options.skipExisting - Skip emails already in database
 * @returns {Promise<Object>} Scraping results
 */
export async function scrapeEmails(oauth2Client, userId, pool, options = {}) {
  const {
    maxResults = 50,
    query = "to:campus-events@dartmouth.edu",
    skipExisting = true,
    force = false, // If true, re-fetch existing emails to update attachments
  } = options;

  try {
    // Search for emails
    const searchResult = await searchEmails(oauth2Client, {
      query,
      maxResults,
    });
    const messages = searchResult.messages || [];

    let scraped = 0;
    let skipped = 0;
    let errors = [];

    // Process each email
    for (const msg of messages) {
      try {
        // Check if already exists by gmail_message_id
        const existingResult = await pool.query(
          "SELECT * FROM scraped_emails WHERE gmail_message_id = $1",
          [msg.id]
        );
        const existing = existingResult.rows[0];

        if (existing && skipExisting && !force) {
          skipped++;
          continue;
        }

        // Fetch full email content
        const emailData = await fetchEmailContent(oauth2Client, msg.id);

        // Check for duplicate email with same subject + from_email + received_date
        // This catches cases where Gmail assigns different message IDs to the same email
        // (e.g., when subscribed to multiple lists or BCC scenarios)
        if (!existing) {
          const duplicateEmailResult = await pool.query(
            `SELECT id FROM scraped_emails
             WHERE user_id = $1
               AND subject = $2
               AND from_email = $3
               AND received_date = $4`,
            [userId, emailData.subject, emailData.fromEmail, emailData.receivedDate]
          );

          if (duplicateEmailResult.rows.length > 0) {
            console.log(
              `[emailScraper] Skipping duplicate email (same subject/sender/date): "${emailData.subject}" from ${emailData.fromEmail}`
            );
            skipped++;
            continue;
          }
        }

        if (existing && force) {
          // Update existing email with new data (especially attachments)
          await pool.query(
            `UPDATE scraped_emails SET
              thread_id = $1, from_email = $2, from_name = $3, subject = $4,
              body_text = $5, body_html = $6, received_date = $7, attachments = $8
             WHERE gmail_message_id = $9 AND user_id = $10`,
            [
              emailData.threadId,
              emailData.fromEmail,
              emailData.fromName,
              emailData.subject,
              emailData.bodyText,
              emailData.bodyHtml,
              emailData.receivedDate,
              emailData.attachments
                ? JSON.stringify(emailData.attachments)
                : null,
              emailData.gmailMessageId,
              userId,
            ]
          );
          scraped++; // Count as scraped even though it's an update
        } else {
          // Insert new email
          const emailId = `email_${crypto.randomBytes(12).toString("hex")}`;
          await pool.query(
            `INSERT INTO scraped_emails (
              id, user_id, gmail_message_id, thread_id, from_email, from_name,
              subject, body_text, body_html, received_date, attachments
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              emailId,
              userId,
              emailData.gmailMessageId,
              emailData.threadId,
              emailData.fromEmail,
              emailData.fromName,
              emailData.subject,
              emailData.bodyText,
              emailData.bodyHtml,
              emailData.receivedDate,
              emailData.attachments
                ? JSON.stringify(emailData.attachments)
                : null,
            ]
          );
          scraped++;
        }
      } catch (error) {
        console.error(
          `[emailScraper] Error processing message ${msg.id}:`,
          error.message
        );
        errors.push({ messageId: msg.id, error: error.message });
      }
    }

    return {
      success: true,
      scraped,
      skipped,
      totalFound: messages.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error("[emailScraper] Error scraping emails:", error.message);
    throw error;
  }
}

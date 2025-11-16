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

      // Check if this is an inline attachment (image with Content-ID)
      const contentId = getPartHeader("Content-ID");
      const filename =
        getPartHeader("Content-Name") || getPartHeader("Filename");
      const mimeType = part.mimeType || "";

      // Inline attachments have Content-ID and are typically images
      // Check for both direct data and attachmentId (for large attachments)
      const hasData = part.body?.data;
      const hasAttachmentId = part.body?.attachmentId;
      const isImage = mimeType.startsWith("image/");

      if (contentId && isImage && (hasData || hasAttachmentId)) {
        const attachmentData = {
          contentId: contentId.replace(/[<>]/g, ""),
          mimeType: mimeType,
          filename: filename || `image.${mimeType.split("/")[1]}`,
          size: part.body.size || 0,
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
 * @param {Object} db - SQLite database instance
 * @param {Object} options - Scraping options
 * @param {number} options.maxResults - Maximum number of emails to fetch
 * @param {string} options.query - Gmail search query
 * @param {boolean} options.skipExisting - Skip emails already in database
 * @returns {Promise<Object>} Scraping results
 */
export async function scrapeEmails(oauth2Client, userId, db, options = {}) {
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

    const emailByGmailId = db.prepare(
      "SELECT * FROM scraped_emails WHERE gmail_message_id=?"
    );
    const emailInsert = db.prepare(`INSERT INTO scraped_emails(
      id, user_id, gmail_message_id, thread_id, from_email, from_name, 
      subject, body_text, body_html, received_date, attachments
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const emailUpdate = db.prepare(`UPDATE scraped_emails SET
      thread_id=?, from_email=?, from_name=?, subject=?, body_text=?, 
      body_html=?, received_date=?, attachments=?
      WHERE gmail_message_id=? AND user_id=?`);

    // Process each email
    for (const msg of messages) {
      try {
        // Check if already exists
        const existing = emailByGmailId.get(msg.id);

        if (existing && skipExisting && !force) {
          skipped++;
          continue;
        }

        // Fetch full email content
        const emailData = await fetchEmailContent(oauth2Client, msg.id);

        if (existing && force) {
          // Update existing email with new data (especially attachments)
          emailUpdate.run(
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
            userId
          );
          scraped++; // Count as scraped even though it's an update
        } else {
          // Insert new email
          const emailId = `email_${crypto.randomBytes(12).toString("hex")}`;
          emailInsert.run(
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
            emailData.attachments ? JSON.stringify(emailData.attachments) : null
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

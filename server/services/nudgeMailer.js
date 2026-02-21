import { google } from "googleapis";

/**
 * Send a nudge notification email from the sender's Gmail to the target.
 */
export async function sendNudgeEmail({
  oauth2Client,
  senderName,
  senderEmail,
  targetEmail,
  event,
  frontendUrl,
}) {
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const firstName = (senderName || senderEmail).split(/\s+/)[0];
  const subject = `${firstName} nudged you!`;
  const html = buildEmailHtml({ senderName, event, frontendUrl });

  const messageParts = [
    `From: ${senderName} <${senderEmail}>`,
    `To: ${targetEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ];
  const rawMessage = messageParts.join("\r\n");

  // Gmail API requires base64url encoding
  const encoded = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });

  console.log(
    `[nudge-email] Sent from ${senderEmail} to ${targetEmail} for event "${event.title}"`
  );
}

// --- Date/time formatting (matches client-side EventDetails.jsx) ---

function formatTime(dateStr) {
  return new Date(dateStr)
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// --- HTML email template ---

function buildEmailHtml({ senderName, event, frontendUrl }) {
  // Always use production URL for emails — Gmail must fetch images from a public host
  const baseUrl = "https://listservcal.tech";
  const title = escapeHtml(event.title || "Untitled Event");
  const org = escapeHtml(event.organization || "");
  const location = escapeHtml(event.location || "");
  const description = escapeHtml(event.description || "");
  const startDate = event.start ? formatDate(event.start) : "";
  const startTime = event.start ? formatTime(event.start) : "";
  const endTime = event.end ? formatTime(event.end) : "";
  const timeDisplay = endTime && endTime !== startTime
    ? `${startTime} &ndash; ${endTime}`
    : startTime;
  const senderFirst = (senderName || "Someone").split(/\s+/)[0];

  // Build poster URL via the public /api/posters/:eventId endpoint
  const posterUrl = event.poster_url
    ? `${baseUrl}/api/posters/${encodeURIComponent(event.id)}`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <!--[if !mso]><!-->
  <style>
    @media only screen and (max-width: 420px) {
      .card { width: 100% !important; border-radius: 0 !important; }
      .card-body { padding: 16px !important; }
      .card-header { padding: 16px !important; }
      .card-footer { padding: 0 16px 16px !important; }
    }
  </style>
  <!--<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 0;">
<tr><td align="center" style="padding:0 12px;">
<table role="presentation" class="card" cellpadding="0" cellspacing="0" style="width:100%;max-width:380px;background-color:#ffffff;border-radius:12px;overflow:hidden;">

  <!-- Header -->
  <tr>
    <td class="card-header" style="background-color:#d4e9c4;padding:20px 24px;">
      <p style="margin:0;font-size:16px;font-weight:600;color:#1f2937;">${title}</p>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td class="card-body" style="padding:20px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

        ${org ? `<tr>
          <td style="padding-bottom:12px;">
            <p style="margin:0;font-size:13px;color:#6b7280;">Organization</p>
            <p style="margin:4px 0 0;font-size:14px;color:#1f2937;">${org}</p>
          </td>
        </tr>` : ""}

        ${startDate ? `<tr>
          <td style="padding-bottom:12px;">
            <p style="margin:0;font-size:13px;color:#6b7280;">When</p>
            <p style="margin:4px 0 0;font-size:14px;color:#1f2937;">${escapeHtml(startDate)}${timeDisplay ? ` &middot; ${timeDisplay}` : ""}</p>
          </td>
        </tr>` : ""}

        ${location ? `<tr>
          <td style="padding-bottom:12px;">
            <p style="margin:0;font-size:13px;color:#6b7280;">Location</p>
            <p style="margin:4px 0 0;font-size:14px;color:#1f2937;">${location}</p>
          </td>
        </tr>` : ""}

        ${description ? `<tr>
          <td style="padding-bottom:12px;">
            <p style="margin:0;font-size:13px;color:#6b7280;">Description</p>
            <p style="margin:4px 0 0;font-size:14px;color:#1f2937;line-height:1.4;">${description}</p>
          </td>
        </tr>` : ""}

        ${posterUrl ? `<tr>
          <td style="padding-bottom:12px;">
            <img src="${escapeHtml(posterUrl)}" alt="Event poster" style="display:block;width:100%;height:auto;border-radius:8px;" />
          </td>
        </tr>` : ""}

      </table>
    </td>
  </tr>

  <!-- CTA Button -->
  <tr>
    <td class="card-footer" style="padding:0 24px 20px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${escapeHtml(baseUrl)}" style="height:44px;width:100%;" arcsize="18%" fillcolor="#d4e9c4" stroke="f">
        <v:textbox inset="0,0,0,0"><center style="font-size:14px;font-weight:600;color:#1f2937;">View on ListServCal</center></v:textbox>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${escapeHtml(baseUrl)}" target="_blank" style="display:block;background-color:#d4e9c4;border-radius:8px;padding:12px 0;font-size:14px;font-weight:600;color:#1f2937;text-decoration:none;text-align:center;">View on ListServCal</a>
      <!--<![endif]-->
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td class="card-footer" style="padding:0 24px 20px;">
      <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">Sent by ${escapeHtml(senderFirst)} via ListServCal</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

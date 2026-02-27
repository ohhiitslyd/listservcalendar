/**
 * Build a shareable text message + URL for an event.
 */
export function buildShareMessage(event) {
  const title =
    event.title || event.extendedProps?.title || "(Untitled Event)";
  const org = event.extendedProps?.organization || event.organization || "";
  const location =
    event.extendedProps?.location || event.location || "";
  const isAllDay = event.allDay ?? event.extendedProps?.allDay;

  // Build the shareable URL
  const eventId = event.id || "";
  const url = `https://listservcal.tech/?event=${encodeURIComponent(eventId)}`;

  // Format date/time
  const startDate = event.start ? new Date(event.start) : null;
  let dateStr = "";
  if (startDate && !isNaN(startDate)) {
    const dayPart = startDate.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (isAllDay) {
      dateStr = dayPart;
    } else {
      const timePart = startDate
        .toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
        .toLowerCase();
      dateStr = `${dayPart} at ${timePart}`;
    }
  }

  // Build headline
  const headline = org ? `${org} is hosting ${title}!` : title;

  // Build details line (date + location)
  let details = dateStr;
  if (details && location) {
    details += ` - ${location}`;
  } else if (location) {
    details = location;
  }

  const lines = [headline];
  if (details) lines.push(details);
  lines.push(`Check it out on ListServCal: ${url}`);

  return { text: lines.join("\n"), url, title };
}

/**
 * Share or copy event details.
 * Uses Web Share API on mobile, clipboard on desktop.
 * Returns "shared" | "copied" | "cancelled".
 */
export async function shareEvent(event) {
  const { text, url, title } = buildShareMessage(event);

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      if (err.name === "AbortError") return "cancelled";
      // Fall through to clipboard
    }
  }

  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    // Final fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return "copied";
  }
}

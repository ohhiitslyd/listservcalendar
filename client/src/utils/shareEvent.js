/**
 * Build the shareable URL for an event.
 * OG meta tags on the server handle showing title, details, and poster.
 */
export function getShareUrl(event) {
  const eventId = event.id || "";
  return `https://listservcal.tech/?event=${encodeURIComponent(eventId)}`;
}

/**
 * Share or copy an event link.
 * Uses Web Share API on mobile, clipboard on desktop.
 * Returns "shared" | "copied" | "cancelled".
 */
export async function shareEvent(event) {
  const url = getShareUrl(event);
  const title =
    event.title || event.extendedProps?.title || "(Untitled Event)";

  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (err) {
      if (err.name === "AbortError") return "cancelled";
      // Fall through to clipboard
    }
  }

  // Fallback: copy URL to clipboard
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    // Final fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return "copied";
  }
}

import { useMemo } from "react";

/**
 * Returns an object: { [categoryKey]: count }
 * Only counts events that belong to the ListServ calendar (the ones we filter).
 */
export const useMemoizedCounts = (events, listservCalendarId) =>
  useMemo(() => {
    const counts = {};
    const lsId = listservCalendarId;

    (events || []).forEach((ev) => {
      // Treat email-ingested events as ListServ too
      const isListServ =
        (ev.source === "google" && ev.calendarId === lsId) ||
        ev.source === "draft" ||
        ev.source === "email";

      if (!isListServ) return;

      // Categories might exist either directly or inside extendedProps
      const cats = ev.categories || ev?.extendedProps?.categories || [];
      cats.forEach((c) => {
        counts[c] = (counts[c] || 0) + 1;
      });
    });

    return counts;
  }, [events, listservCalendarId]);
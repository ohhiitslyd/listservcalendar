// src/components/Calendar/Calendar.jsx
import React, { useContext, useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

import { AppContext } from "../../context/AppContext";
import { EventDetails } from "../EventDetails/EventDetails";
import { useEvents } from "../../hooks/useEvents";
import { DateBar } from "../DateBar/DateBar";
import "./Calendar.css";

// Helper function to determine if a color is light or dark using brightness
// Returns true if color is light (use black text), false if dark (use white text)
const isLightColor = (hexColor) => {
  if (!hexColor) return true; // Default to light (black text)

  // Remove # if present
  const hex = hexColor.replace("#", "").toLowerCase();

  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate brightness using YIQ formula (perceived brightness)
  // This gives more weight to green, less to blue
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  // If brightness > 128 (midpoint of 0-255), it's light (use black text)
  // If brightness <= 128, it's dark (use white text)
  return brightness > 128;
};

// 1. ACCEPT the props from App.jsx here
export const Calendar = ({
  onSelect,
  onDatesSet,
  scrollTime,
}) => {
  // We need events, calendarRef, and selectedEvent to drive the overlay details card.
  const {
    filteredEvents,
    events,
    calendarRef,
    selectedEvent,
    setSelectedEvent,
    listservCalendarId,
    tagColorMap,
  } = useContext(AppContext);

  const { applyFiltersToCalendar } = useEvents();

  // Position of the floating EventDetails overlay (in viewport coordinates)
  const [detailsOverlayPosition, setDetailsOverlayPosition] = useState(null);

  // 3. DELETE the local `handleSelect` and `handleEventClick` functions.
  //    They are now correctly passed in as props from InnerApp.

  // ----- APPLY FILTER VISIBILITY AFTER EVERY RENDER -----
  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (api) applyFiltersToCalendar(api);
  }, [applyFiltersToCalendar, calendarRef]); // Added calendarRef to dependency array

  // Clear overlay when selected event is cleared
  useEffect(() => {
    if (!selectedEvent) {
      setDetailsOverlayPosition(null);
    }
  }, [selectedEvent]);

  // Local handler: position overlay next to the clicked event
  const handleEventClickLocal = (clickInfo) => {
    const ev = clickInfo.event;
    const source =
      ev.extendedProps?.source ||
      (ev.id?.startsWith("draft:") ? "draft" : "google");

    // Disallow editing non‑ListServ Google events (same logic as before)
    if (source === "google") {
      const calendarId = ev.extendedProps?.calendarId;
      const isListServ =
        listservCalendarId && calendarId === listservCalendarId;
      if (!isListServ) {
        window.alert(
          "This event is not part of the ListServ Events calendar. Edits are only allowed for ListServ Events."
        );
        return;
      }
    }

    const elRect = clickInfo.el.getBoundingClientRect();
    const cardWidth = 320;
    const cardHeight = 420; // keep in sync with CSS max-height
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Prefer to show on the right; fall back to left when there is not enough space
    let left = elRect.right + margin;
    if (left + cardWidth > viewportWidth - 16) {
      left = elRect.left - cardWidth - margin;
      if (left < 16) left = 16;
    }

    // Position vertically near the event, but clamp so the card stays on screen
    let top = elRect.top + 4;
    const maxTop = viewportHeight - cardHeight - 16;
    if (top > maxTop) top = maxTop;
    if (top < 16) top = 16;

    setDetailsOverlayPosition({ top, left });
    setSelectedEvent(ev);
  };

  // Apply full-block background "splotch" based on event-type tags
  const handleEventDidMount = (info) => {
    const ev = info.event;
    const isListServ = ev.classNames.includes("fc-event-listserv");
    const harness = info.el.parentElement; // FullCalendar wraps events in a harness div

    if (!isListServ) {
      // Primary / other calendars → intentionally under ListServ events
      if (harness) harness.style.zIndex = "5";
      info.el.style.zIndex = "5";
      return;
    }

    // ListServ events should always visually sit above the primary calendar
    if (harness) harness.style.zIndex = "30";
    info.el.style.zIndex = "30";

    const tags = ev.extendedProps?.tags || [];
    const colors = (tags || [])
      .map((t) => tagColorMap?.[String(t || "")])
      .filter(Boolean);

    const uniqColors = Array.from(new Set(colors));

    if (uniqColors.length === 0) {
      // No event-type tags: use light gray block
      info.el.style.backgroundImage = "none";
      info.el.style.backgroundColor = "#e5e7eb";
      info.el.style.color = "#111827";
    } else if (uniqColors.length === 1) {
      const c = uniqColors[0];
      info.el.style.backgroundImage = "none";
      info.el.style.backgroundColor = c;
      info.el.style.color = "#000000";
    } else {
      // Even distribution across the whole block:
      // Base linear gradient ensures no white; radial gradients add organic edges.
      const baseStep = 100 / uniqColors.length;
      const baseStops = uniqColors
        .map((c, i) => {
          const start = Math.round(i * baseStep);
          const end = Math.round((i + 1) * baseStep);
          return `${c} ${start}% ${end}%`;
        })
        .join(", ");
      const base = `linear-gradient(90deg, ${baseStops})`;

      const spots = uniqColors.slice(0, 3);
      const positions = ["15% 25%", "85% 30%", "50% 80%"];
      const radials = spots.map((c, i) => {
        const pos = positions[i] || "50% 50%";
        return `radial-gradient(circle at ${pos}, ${c} 0 55%, rgba(255,255,255,0) 70%)`;
      });

      info.el.style.backgroundImage = [base, ...radials].join(", ");
      info.el.style.backgroundColor = "transparent";
      info.el.style.color = "#000000";
    }

    info.el.style.borderRadius = "5px";
  };

  return (
    <div className="app-calendar-container">
      <DateBar />
      <div className="app-calendar-wrapper">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          headerToolbar={false}
          initialView="timeGridWeek"
          selectable={false}
          selectMirror={false}
          events={events}
          eventOrder={(a, b) => {
            const aIsListServ = Array.isArray(a.classNames) && a.classNames.includes("fc-event-listserv");
            const bIsListServ = Array.isArray(b.classNames) && b.classNames.includes("fc-event-listserv");
            if (aIsListServ === bIsListServ) return 0;
            // Render primary/other events first, then ListServ, so ListServ segments appear on top
            return aIsListServ ? 1 : -1;
          }}
          height="100%"
          dayHeaderFormat={{ weekday: "short" }}
          dayHeaderContent={(arg) => {
            // Return day name with first letter capitalized (Sun, Mon, etc.)
            const dayName =
              arg.text.charAt(0).toUpperCase() +
              arg.text.slice(1).toLowerCase();
            const date = arg.date.getDate();
            return (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span>{dayName}</span>
                <span
                  style={{
                    fontSize: "16px",
                    color: "#1f2937",
                    marginTop: "4px",
                  }}
                >
                  {date}
                </span>
              </div>
            );
          }}
          slotLabelFormat={{
            hour: "numeric",
            minute: "2-digit",
            omitZeroMinute: false,
            meridiem: "short",
          }}
          eventTimeFormat={{
            hour: "numeric",
            minute: "2-digit",
            omitZeroMinute: false,
            meridiem: "short",
          }}
          eventContent={(arg) => {
            const formatTime = (date) => {
              if (!date) return "";
              const d = new Date(date);
              const hours = d.getHours();
              const minutes = d.getMinutes();
              const ampm = hours >= 12 ? "pm" : "am";
              const displayHours = hours % 12 || 12;
              const displayMinutes = minutes.toString().padStart(2, "0");
              return `${displayHours}:${displayMinutes} ${ampm}`;
            };

            const startTime = formatTime(arg.event.start);
            const endTime = formatTime(arg.event.end);
            const timeRange = endTime ? `${startTime} - ${endTime}` : startTime;
            const title = arg.event.title || "";

            // Custom rendering for non-listserv events
            const isOther = arg.event.classNames.includes("fc-event-other");
            if (isOther) {
              return {
                html: `<div style="display: flex; flex-direction: column; gap: 2px; padding: 0; overflow: hidden;">
                  <div style="font-size: 10px; font-weight: 500; color: #000; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</div>
                  <div style="font-size: 9px; font-weight: 400; color: #6b7280; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${timeRange}</div>
                </div>`,
              };
            }

            // Custom rendering for listserv events - title first, then time
            const isListServ =
              arg.event.classNames.includes("fc-event-listserv");
            if (isListServ) {
              const textColor = "#000";
              const timeColor = "#6b7280"; // Slightly lighter gray for time

              return {
                html: `<div style="display: flex; flex-direction: column; gap: 2px; padding: 2px 4px; overflow: hidden;">
                  <div style="font-size: 10px; font-weight: 500; color: ${textColor}; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</div>
                  <div style="font-size: 9px; font-weight: 400; color: ${timeColor}; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${timeRange}</div>
                </div>`,
              };
            }

            return { html: arg.event.title || "" };
          }}
          // 4. USE the props from App.jsx
          select={onSelect}
          eventClick={handleEventClickLocal}
          datesSet={onDatesSet}
          scrollTime={scrollTime}
          eventDidMount={handleEventDidMount}
        />
        {selectedEvent && detailsOverlayPosition && (
          <div
            className="event-details-overlay"
            style={{
              position: "fixed",
              top: detailsOverlayPosition.top,
              left: detailsOverlayPosition.left,
            }}
          >
            {/* Reuse the existing EventDetails card UI */}
            {/* We import lazily here to avoid circular deps in comments; actual import is at top of file */}
            {/* eslint-disable-next-line react/jsx-pascal-case */}
            <EventDetails />
          </div>
        )}
      </div>
    </div>
  );
};

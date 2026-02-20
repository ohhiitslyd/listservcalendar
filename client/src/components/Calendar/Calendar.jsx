// src/components/Calendar/Calendar.jsx
import React, { useContext, useEffect, useState, useRef } from "react";
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
  statusText,
  statusSubtext,
  statusDotClass,
}) => {
  // We need events, calendarRef, and selectedEvent to drive the overlay details card.
  const {
    filteredEvents,
    events,
    calendarRef,
    selectedEvent,
    setSelectedEvent,
    setEventDetailsSource,
    setSelectedEventInviters,
    focusEventRequest,
    clearFocusEventRequest,
    listservCalendarId,
    tagColorMap,
    calendars,
  } = useContext(AppContext);

  const { applyFiltersToCalendar } = useEvents();

  // Position of the floating EventDetails overlay (in viewport coordinates)
  const [detailsOverlayPosition, setDetailsOverlayPosition] = useState(null);
  // State for personal calendar event popup
  const [personalEventInfo, setPersonalEventInfo] = useState(null);
  const personalEventCardRef = useRef(null);

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

  // Adjust personal event popup position after render to ensure it fits on screen
  useEffect(() => {
    if (!personalEventInfo || !personalEventCardRef.current) return;
    
    const card = personalEventCardRef.current;
    const cardRect = card.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const minMargin = 16;
    
    // If card bottom exceeds viewport, adjust position upward
    if (cardRect.bottom > viewportHeight - minMargin) {
      const actualHeight = cardRect.height;
      const newTop = Math.max(minMargin, viewportHeight - actualHeight - minMargin);
      const currentTop = personalEventInfo.position.top;
      
      // Only update if position needs to change significantly (avoid infinite loops)
      if (Math.abs(newTop - currentTop) > 1) {
        setPersonalEventInfo(prev => ({
          ...prev,
          position: {
            ...prev.position,
            top: newTop,
          },
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalEventInfo]); // Run when popup opens or position changes

  // Check if we're on mobile
  const isMobile = () => window.innerWidth <= 768;

  // Local handler: position overlay next to the clicked event
  const handleEventClickLocal = (clickInfo) => {
    const ev = clickInfo.event;
    const source =
      ev.extendedProps?.source ||
      (ev.id?.startsWith("draft:") ? "draft" : "google");

    // Clear any existing personal event popup when clicking any event
    setPersonalEventInfo(null);

    // Handle non‑ListServ Google events with custom popup
    if (source === "google") {
      const calendarId = ev.extendedProps?.calendarId;
      const isListServ =
        listservCalendarId && calendarId === listservCalendarId;
      if (!isListServ) {
        // Find calendar name
        const calendar = calendars?.find(c => c.id === calendarId);
        const calendarName = calendar?.summary || "Personal Calendar";
        
        // On mobile, center the popup
        if (isMobile()) {
          setPersonalEventInfo({
            event: ev,
            calendarName,
            position: { top: 0, left: 0 }, // CSS will handle centering
          });
          return;
        }
        
        const elRect = clickInfo.el.getBoundingClientRect();
        const cardWidth = 320;
        const cardMaxHeight = 200;
        const margin = 8;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Position popup next to event
        let left = elRect.right + margin;
        if (left + cardWidth > viewportWidth - 16) {
          left = elRect.left - cardWidth - margin;
          if (left < 16) left = 16;
        }

        // Position vertically near the event, but ensure it stays within viewport
        const minMargin = 16;
        // Use a conservative estimate - actual card is around 200-220px
        const estimatedCardHeight = 250; // Overestimate to be safe
        const maxCardHeight = viewportHeight - (minMargin * 2);
        const cardHeight = Math.min(estimatedCardHeight, maxCardHeight);
        
        // Start with position near the event
        let top = elRect.top + 4;
        
        // CRITICAL: Calculate maximum allowed top position
        // This ensures the bottom of the card is always within viewport
        const maxAllowedTop = viewportHeight - cardHeight - minMargin;
        
        // If popup would go off bottom, position it at maxAllowedTop
        if (top + cardHeight > viewportHeight - minMargin) {
          top = maxAllowedTop;
        }
        
        // Ensure it doesn't go off the top
        if (top < minMargin) {
          top = minMargin;
        }
        
        // ABSOLUTE GUARANTEE: bottom must be within viewport
        // Recalculate to ensure this is always true
        const finalBottom = top + cardHeight;
        if (finalBottom > viewportHeight - minMargin) {
          // Force position so bottom is exactly at viewport - margin
          top = viewportHeight - cardHeight - minMargin;
          // But don't go above top margin
          if (top < minMargin) {
            top = minMargin;
          }
        }

        setPersonalEventInfo({
          event: ev,
          calendarName,
          position: { top, left },
        });
        return;
      }
    }

    // On mobile, make overlay full-page (centered)
    if (isMobile()) {
      setDetailsOverlayPosition({ top: 0, left: 0 }); // CSS will handle full-page
      setSelectedEvent(ev);
      return;
    }

    const elRect = clickInfo.el.getBoundingClientRect();
    const cardWidth = 320;
    const cardMaxHeight = 520; // keep in sync with CSS max-height
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
    const maxTop = viewportHeight - cardMaxHeight - 16;
    if (top > maxTop) top = Math.max(16, maxTop);
    if (top < 16) top = 16;
    
    // Ensure the bottom of the card doesn't go below viewport
    const minTop = viewportHeight - cardMaxHeight - 16;
    if (top < minTop) top = Math.max(16, minTop);

    setDetailsOverlayPosition({ top, left });
    setEventDetailsSource("calendar");
    setSelectedEventInviters([]);
    setSelectedEvent(ev);
  };

  const computeOverlayPosition = (elRect, cardWidth = 320, cardMaxHeight = 520) => {
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = elRect.right + margin;
    if (left + cardWidth > viewportWidth - 16) {
      left = elRect.left - cardWidth - margin;
      if (left < 16) left = 16;
    }

    let top = elRect.top + 4;
    const maxTop = viewportHeight - cardMaxHeight - 16;
    if (top > maxTop) top = Math.max(16, maxTop);
    if (top < 16) top = 16;

    const minTop = viewportHeight - cardMaxHeight - 16;
    if (top < minTop) top = Math.max(16, minTop);

    return { top, left };
  };

  useEffect(() => {
    const requestedId = focusEventRequest?.eventId;
    if (!requestedId) return;

    const api = calendarRef.current?.getApi?.();
    if (!api) {
      clearFocusEventRequest();
      return;
    }

    const targetEvent = (events || []).find(
      (ev) => String(ev?.id || "") === String(requestedId)
    );

    if (!targetEvent) {
      clearFocusEventRequest();
      window.alert("Could not find the invited event in the current event list.");
      return;
    }

    if (targetEvent.start) {
      api.gotoDate(targetEvent.start);
    }

    const escapeAttrValue = (value) =>
      String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const openNearCalendarEvent = (attempt = 0) => {
      const selector = `.fc-event[data-event-id="${escapeAttrValue(requestedId)}"]`;
      const eventEl = document.querySelector(selector);

      if (eventEl) {
        const pos = computeOverlayPosition(eventEl.getBoundingClientRect(), 320, 520);
        setPersonalEventInfo(null);
        setDetailsOverlayPosition(pos);
        setEventDetailsSource("nudge");
        setSelectedEventInviters(focusEventRequest?.inviterEmails || []);
        setSelectedEvent(targetEvent);
        clearFocusEventRequest();
        return;
      }

      if (attempt >= 15) {
        const wrapper = document.querySelector(".app-calendar-wrapper");
        const rect = wrapper?.getBoundingClientRect?.();
        if (rect) {
          setDetailsOverlayPosition({
            top: Math.max(16, rect.top + 32),
            left: Math.max(16, rect.right - 340),
          });
        }
        setEventDetailsSource("nudge");
        setSelectedEventInviters(focusEventRequest?.inviterEmails || []);
        setSelectedEvent(targetEvent);
        clearFocusEventRequest();
        return;
      }

      setTimeout(() => openNearCalendarEvent(attempt + 1), 90);
    };

    setTimeout(() => openNearCalendarEvent(0), 90);
  }, [
    focusEventRequest,
    events,
    calendarRef,
    setSelectedEvent,
    clearFocusEventRequest,
    setEventDetailsSource,
    setSelectedEventInviters,
  ]);

  // Apply full-block background "splotch" based on event-type tags
  const handleEventDidMount = (info) => {
    info.el.setAttribute("data-event-id", info.event.id || "");
    const ev = info.event;
    const isNudged = !!ev.extendedProps?.isNudged;
    const isListServ = ev.classNames.includes("fc-event-listserv");
    const harness = info.el.parentElement; // FullCalendar wraps events in a harness div

    // Use the same green as the "Free Food" tag for all ListServ events
    const freeFoodGreen = tagColorMap?.["Free Food"] || "#d4e9c4";

    if (isNudged) {
      if (harness) harness.style.zIndex = "35";
      info.el.style.zIndex = "35";
      info.el.style.backgroundImage = "none";
      info.el.style.backgroundColor = freeFoodGreen;
      info.el.style.color = "#000000";
      info.el.style.borderRadius = "5px";
      return;
    }

    if (!isListServ) {
      // Primary / other calendars → intentionally under ListServ events
      if (harness) harness.style.zIndex = "5";
      info.el.style.zIndex = "5";
      return;
    }

    // ListServ events should always visually sit above the primary calendar
    if (harness) harness.style.zIndex = "30";
    info.el.style.zIndex = "30";

    // All ListServ events (regardless of tags) use the same green as "Free Food"
    info.el.style.backgroundImage = "none";
    info.el.style.backgroundColor = freeFoodGreen;
    info.el.style.color = "#000000";

    info.el.style.borderRadius = "5px";
  };

  return (
    <div className="app-calendar-container">
      <DateBar 
        statusText={statusText}
        statusSubtext={statusSubtext}
        statusDotClass={statusDotClass}
      />
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

            const isAllDay = arg.event.allDay || arg.event.extendedProps?.allDay;
            const startTime = isAllDay ? null : formatTime(arg.event.start);
            const endTime = isAllDay ? null : formatTime(arg.event.end);
            const timeRange = endTime ? `${startTime} - ${endTime}` : startTime;
            const title = arg.event.title || "";

            // Custom rendering for non-listserv events
            const isOther = arg.event.classNames.includes("fc-event-other");
            if (isOther) {
              if (isAllDay) {
                return {
                  html: `<div style="display: flex; flex-direction: column; gap: 2px; padding: 0; overflow: hidden;">
                    <div style="font-size: 10px; font-weight: 500; color: #000; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</div>
                  </div>`,
                };
              }
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

              if (isAllDay) {
                return {
                  html: `<div style="display: flex; flex-direction: column; gap: 2px; padding: 2px 4px; overflow: hidden;">
                    <div style="font-size: 10px; font-weight: 500; color: ${textColor}; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</div>
                  </div>`,
                };
              }

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

        {personalEventInfo && (
          <div
            className="personal-event-overlay"
            style={{
              position: "fixed",
              top: personalEventInfo.position.top,
              left: personalEventInfo.position.left,
              maxHeight: `${Math.max(100, window.innerHeight - personalEventInfo.position.top - 16)}px`,
            }}
          >
            <div className="personal-event-card" ref={personalEventCardRef}>
              <div className="personal-event-header">
                <h3 className="personal-event-title">
                  {personalEventInfo.event.title || "(No title)"}
                </h3>
                <button
                  className="close-panel-button"
                  onClick={() => setPersonalEventInfo(null)}
                  aria-label="Close"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <div className="personal-event-separator"></div>
              <div className="personal-event-content">
                <div className="personal-event-message">
                  <svg className="personal-event-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <div className="personal-event-text">
                    <p className="personal-event-calendar-name">
                      This event is part of your <strong>{personalEventInfo.calendarName}</strong> calendar.
                    </p>
                    <p className="personal-event-instruction">
                      You can toggle personal calendars on/off using the "My Calendars" button in the header, but individual events cannot be filtered.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

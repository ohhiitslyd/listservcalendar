// src/components/Calendar/Calendar.jsx
import React, { useRef, useContext, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

import { AppContext } from "../../context/AppContext";
import { useEvents } from "../../hooks/useEvents";
import "./Calendar.css";

/**
 * Calendar component – renders FullCalendar and wires up the
 * selection / click handlers that interact with the global AppContext.
 */
export const Calendar = () => {
  // -----------------------------------------------------------------
  // 1️⃣  Hooks – must be at the top level of the component
  // -----------------------------------------------------------------
  const calendarRef = useRef(null); // <-- the ref used to talk to FullCalendar

  // Pull everything we need from the context **once**
  const {
    user,
    events,
    setSelectionInfo,
    setEventForm,
    setCreateModalOpen,
    setSelectedEvent,
    listservCalendarId,
  } = useContext(AppContext);

  // Hook that knows how to hide/show events according to active filters
  const { applyFiltersToCalendar } = useEvents();

  // -----------------------------------------------------------------
  // 2️⃣  Event‑handler functions (plain functions – no hooks inside)
  // -----------------------------------------------------------------
  const handleSelect = (selectionInfo) => {
    if (!user) return; // ignore selections when not logged in

    setSelectionInfo(selectionInfo);
    setEventForm({
      title: "",
      description: "",
      location: "",
      allDay: selectionInfo.allDay,
    });
    setCreateModalOpen(true);
  };

  const handleEventClick = (clickInfo) => {
    const ev = clickInfo.event;
    const source =
      ev.extendedProps?.source ||
      (ev.id?.startsWith("draft:") ? "draft" : "google");

    // Disallow editing non‑ListServ Google events
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

    setSelectedEvent(ev);
  };

  // -----------------------------------------------------------------
  // 3️⃣  Apply filter visibility whenever the filter helper changes
  // -----------------------------------------------------------------
  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (api) {
      applyFiltersToCalendar(api);
    }
  }, [applyFiltersToCalendar]);

  // -----------------------------------------------------------------
  // 4️⃣  Render FullCalendar
  // -----------------------------------------------------------------
  return (
    <div className="app-calendar-container">
      <div className="app-calendar-wrapper">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "timeGridWeek,timeGridDay",
          }}
          initialView="timeGridWeek"
          selectable
          selectMirror
          select={handleSelect}
          eventClick={handleEventClick}
          events={events}          // <-- events come from context
          height="100%"
        />
      </div>
    </div>
  );
};
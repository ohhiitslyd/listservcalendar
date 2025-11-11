// src/components/Calendar/Calendar.jsx
import React, { useContext, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

import { AppContext } from "../../context/AppContext";
import { useEvents } from "../../hooks/useEvents";
import "./Calendar.css";

export const Calendar = () => {
  const {
    user,
    events,
    setSelectionInfo,
    setEventForm,
    setCreateModalOpen,
    setSelectedEvent,
    listservCalendarId,
    calendarRef,          // <-- now comes from context
  } = useContext(AppContext);

  const { applyFiltersToCalendar } = useEvents();

  // ----- SELECT (drag‑to‑create) -----
  const handleSelect = (selectionInfo) => {
    if (!user) return;
    setSelectionInfo(selectionInfo);
    setEventForm({
      title: "",
      description: "",
      location: "",
      allDay: selectionInfo.allDay,
    });
    setCreateModalOpen(true);
  };

  // ----- CLICK ON EXISTING EVENT -----
  const handleEventClick = (clickInfo) => {
    const ev = clickInfo.event;
    const source =
      ev.extendedProps?.source ||
      (ev.id?.startsWith("draft:") ? "draft" : "google");

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

  // ----- APPLY FILTER VISIBILITY AFTER EVERY RENDER -----
  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (api) applyFiltersToCalendar(api);
  }, [applyFiltersToCalendar]);

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
          events={events}
          height="100%"
        />
      </div>
    </div>
  );
};
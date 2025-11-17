// src/components/Calendar/Calendar.jsx
import React, { useContext, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

import { AppContext } from "../../context/AppContext";
import { useEvents } from "../../hooks/useEvents";
import { DateBar } from "../DateBar/DateBar";
import "./Calendar.css";

// 1. ACCEPT the props from App.jsx here
export const Calendar = ({ onSelect, onEventClick, onDatesSet, scrollTime }) => {
  // 2. CLEAN UP: We only need `events` and `calendarRef` from context now.
  //    The other variables were only for the handlers you're deleting.
  const {
    events,
    calendarRef,
  } = useContext(AppContext);

  const { applyFiltersToCalendar } = useEvents();

  // 3. DELETE the local `handleSelect` and `handleEventClick` functions.
  //    They are now correctly passed in as props from InnerApp.

  // ----- APPLY FILTER VISIBILITY AFTER EVERY RENDER -----
  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (api) applyFiltersToCalendar(api);
  }, [applyFiltersToCalendar, calendarRef]); // Added calendarRef to dependency array

  return (
    <div className="app-calendar-container">
      <DateBar />
      <div className="app-calendar-wrapper">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          headerToolbar={false}
          initialView="timeGridWeek"
          selectable
          selectMirror
          events={events}
          height="100%"

          // 4. USE the props from App.jsx
          select={onSelect}
          eventClick={onEventClick}
          datesSet={onDatesSet} 
          scrollTime={scrollTime}
        />
      </div>
    </div>
  );
};
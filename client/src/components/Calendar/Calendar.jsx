import React, { useRef, useContext } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { AppContext } from "../../context/AppContext";
import { useEvents } from "../../hooks/useEvents";
import "./Calendar.css";

export const Calendar = () => {
  const calendarRef = useRef();
  const { events, onSelect, onEventClick } = useContext(AppContext);
  const { applyFiltersToCalendar } = useEvents();

  // Whenever activeFilters change, we ask FullCalendar to hide/show events.
  React.useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    applyFiltersToCalendar(api);
  }, [applyFiltersToCalendar]);

  // expose the ref for other components (e.g., modal close)
  React.useEffect(() => {
    // store in context so CreateEventModal can call unselect()
    // (alternatively you could lift the ref via provider)
    // we’ll keep it simple and attach it to the context directly:
    const { setCalendarRef } = useContext(AppContext);
    if (setCalendarRef) setCalendarRef(calendarRef);
  }, []);

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
          select={onSelect}
          events={events}
          eventClick={onEventClick}
          height="100%"
        />
      </div>
    </div>
  );
};
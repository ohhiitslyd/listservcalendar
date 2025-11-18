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
          dayHeaderFormat={{ weekday: 'short' }}
          dayHeaderContent={(arg) => {
            // Return day name with first letter capitalized (Sun, Mon, etc.)
            const dayName = arg.text.charAt(0).toUpperCase() + arg.text.slice(1).toLowerCase();
            const date = arg.date.getDate();
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <span>{dayName}</span>
                <span style={{ fontSize: '16px', color: '#1f2937', marginTop: '4px' }}>{date}</span>
              </div>
            );
          }}
          slotLabelFormat={{
            hour: 'numeric',
            minute: '2-digit',
            omitZeroMinute: false,
            meridiem: 'short'
          }}
          eventTimeFormat={{
            hour: 'numeric',
            minute: '2-digit',
            omitZeroMinute: false,
            meridiem: 'short'
          }}
          eventContent={(arg) => {
            // Custom rendering to show time for non-listserv events
            const isOther = arg.event.classNames.includes('fc-event-other');
            if (isOther) {
              const formatTime = (date) => {
                if (!date) return '';
                const d = new Date(date);
                const hours = d.getHours();
                const minutes = d.getMinutes();
                const ampm = hours >= 12 ? 'pm' : 'am';
                const displayHours = hours % 12 || 12;
                const displayMinutes = minutes.toString().padStart(2, '0');
                return `${displayHours}:${displayMinutes} ${ampm}`;
              };
              
              const startTime = formatTime(arg.event.start);
              const endTime = formatTime(arg.event.end);
              const timeRange = endTime ? `${startTime} - ${endTime}` : startTime;
              const title = arg.event.title || '';
              
              return {
                html: `<div style="display: flex; flex-direction: column; gap: 2px; padding: 0; overflow: hidden;">
                  <div style="font-size: 10px; font-weight: 500; color: #000; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</div>
                  <div style="font-size: 9px; font-weight: 400; color: #6b7280; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${timeRange}</div>
                </div>`
              };
            }
            return { html: arg.event.title || '' };
          }}

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
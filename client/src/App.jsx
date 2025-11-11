/* -------------------------------------------------
   src/App.jsx – entry point for the React app
   ------------------------------------------------- */

import React, { useContext } from "react";
import { AppProvider, AppContext } from "./context/AppContext";

import { Header } from "./components/Header/Header";
import { Filters } from "./components/Filters/Filters";
import { Calendar } from "./components/Calendar/Calendar";
import { EventDetails } from "./components/EventDetails/EventDetails";
import { CreateEventModal } from "./components/CreateEventModal/CreateEventModal";

import "./App.css";

/* -------------------------------------------------
   InnerApp – UI that consumes the context.
   It **does NOT** export anything; it lives only
   this file.
   ------------------------------------------------- */
const InnerApp = () => {
  const {
    user,
    visibleCalendars,
    listservCalendarId,
    fetchEvents,
    setSelectionInfo,
    setEventForm,
    setCreateModalOpen,
    setSelectedEvent,
    selectedEvent,
    // **NOTE:** we *do not* destructure `onSelect` or `onEventClick`
    // because we will define them locally (see below).
  } = useContext(AppContext);

  /* -------------------------------------------------
     handleSelect – called when the user drags on the calendar
     ------------------------------------------------- */
  const handleSelect = (selectionInfo) => {
    if (!user) return;

    setSelectionInfo(selectionInfo);
    setEventForm({
      title: "",
      description: "",          // ← make sure this key exists
      location: "",
      allDay: selectionInfo.allDay,
    });
    setCreateModalOpen(true);
  };

  /* -------------------------------------------------
     handleEventClick – called when an event is clicked
     ------------------------------------------------- */
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

  /* -------------------------------------------------
     Publishing / deleting a draft
     ------------------------------------------------- */
  const handlePublishEvent = async () => {
    const id = selectedEvent?.id;
    if (!id?.startsWith("draft:")) return;

    const res = await fetch(
      `/api/events/${encodeURIComponent(id)}/publish`,
      { method: "POST", credentials: "include" }
    );

    if (!res.ok) {
      alert("Failed to publish event");
    } else {
      setSelectedEvent(null);
      await fetchEvents(Array.from(visibleCalendars));
    }
  };

  const handleDeleteEvent = async () => {
    if (!window.confirm("Are you sure you want to delete this event?")) return;

    const id = selectedEvent?.id;
    await fetch(`/api/events/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });

    setSelectedEvent(null);
    await fetchEvents(Array.from(visibleCalendars));
  };

  /* -------------------------------------------------
     Render the UI layout
     ------------------------------------------------- */
  return (
    <div className="app-container">
      <Header />

      <div className="app-content">
        {/* LEFT PANEL – filter bubbles */}
        <div className="app-left-panel">
          <Filters />
        </div>

        {/* MAIN CALENDAR – we forward the handlers with the names FullCalendar expects */}
        <Calendar
          onSelect={handleSelect}
          onEventClick={handleEventClick}
        />

        {/* RIGHT PANEL – event details */}
        <div className="app-right-panel">
          <EventDetails
            selectedEvent={selectedEvent}
            setSelectedEvent={setSelectedEvent}
            handlePublishEvent={handlePublishEvent}
            handleDeleteEvent={handleDeleteEvent}
            listservCalendarId={listservCalendarId}
          />
        </div>
      </div>

      {/* FOOTER */}
      <div className="app-footer">
        <p>
          Click and drag on the calendar to create an event. Click any event
          to view details and manage it.
        </p>
      </div>

      {/* MODAL – create event */}
      <CreateEventModal />
    </div>
  );
};

/* -------------------------------------------------
   Export the top‑level component that Vite mounts.
   ------------------------------------------------- */
export default function App() {
  return (
    <AppProvider>
      <InnerApp />
    </AppProvider>
  );
}
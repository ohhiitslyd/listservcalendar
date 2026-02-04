/* -------------------------------------------------
   src/App.jsx – entry point for the React app
   ------------------------------------------------- */

import React, { useContext, useMemo } from "react";
import { AppProvider, AppContext } from "./context/AppContext";

import { Header } from "./components/Header/Header";
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
    setCurrentViewRange,
    availableCats,
    availableOrgCats,
    selectedOrgCats,
    selectedCats,
    setSelectedOrgCats,
    setSelectedCats,
    setExcludeMode,
    // **NOTE:** we *do not* destructure `onSelect` or `onEventClick`
    // because we will define them locally (see below).
  } = useContext(AppContext);

  const selectedOrgChips = useMemo(() => {
    if (!availableOrgCats || !selectedOrgCats) return [];
    const orgMap = new Map();
    availableOrgCats.forEach((cat) => {
      if (!cat?.key) return;
      const parts = cat.key.split(":");
      const level =
        cat.level || (parts.length === 1 ? "type" : parts.length === 2 ? "subcategory" : "organization");
      if (level === "organization") {
        orgMap.set(cat.key, cat.label || cat.key);
      }
    });

    return Array.from(selectedOrgCats)
      .filter((key) => orgMap.has(key))
      .map((key) => ({ key, label: orgMap.get(key) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [availableOrgCats, selectedOrgCats]);

  const selectedEventTypeChips = useMemo(() => {
    if (!availableCats || !selectedCats) return [];
    const typeMap = new Map(
      availableCats.map((cat) => [cat.key, cat.label || cat.key])
    );

    return Array.from(selectedCats)
      .filter((key) => typeMap.has(key))
      .map((key) => ({ key, label: typeMap.get(key) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [availableCats, selectedCats]);

  const totalSelectedFilters = (selectedCats?.size || 0) + (selectedOrgCats?.size || 0);

  const handleClearAll = () => {
    setSelectedCats(new Set());
    setSelectedOrgCats(new Set());
    setExcludeMode(false);
  };

  const handleRemoveOrgChip = (key) => {
    setSelectedOrgCats((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const handleRemoveEventTypeChip = (key) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  /* -------------------------------------------------
     handleSelect – called when the user drags on the calendar
     ------------------------------------------------- */
  const handleSelect = (selectionInfo) => {
    if (!user) return;

    setSelectionInfo(selectionInfo);
    setEventForm({ 
      title: "", 
      organization: "", 
      location: "", 
      description: "", 
      tags: "", 
      poster_url: "", 
      allDay: selectionInfo.allDay
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
    handleDatesSet – called when the calendar view changes
    (e.g. user goes to next/prev week). We store the visible
    start/end so the filter-bubble counts only consider events
    in that range.
    ------------------------------------------------- */
  const handleDatesSet = (arg) => {
    // `arg.start` and `arg.end` are Date objects from FullCalendar
    setCurrentViewRange({
      start: arg.start.toISOString(),
      end: arg.end.toISOString(),
    });
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
        <div className="app-left-panel">
          <div className="selected-filters-panel">
            <div className="selected-filters-header">
              <span className="selected-filters-title">Selected filters</span>
              <span className="selected-filters-count">{totalSelectedFilters}</span>
              <button
                type="button"
                className="selected-filters-clear"
                onClick={handleClearAll}
              >
                Clear all
              </button>
            </div>
            <div className="selected-filters-chips">
              {selectedEventTypeChips.length > 0 && (
                <div className="selected-filters-group">
                  <span className="selected-filters-group-title">Event types</span>
                  <div className="selected-filters-group-chips">
                    {selectedEventTypeChips.map((chip) => (
                      <span key={chip.key} className="selected-filter-chip">
                        <span className="selected-filter-chip-label">{chip.label}</span>
                        <button
                          type="button"
                          className="selected-filter-chip-remove"
                          onClick={() => handleRemoveEventTypeChip(chip.key)}
                          aria-label={`Remove ${chip.label}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {selectedOrgChips.length > 0 && (
                <div className="selected-filters-group">
                  <span className="selected-filters-group-title">Organizations</span>
                  <div className="selected-filters-group-chips">
                    {selectedOrgChips.map((chip) => (
                      <span key={chip.key} className="selected-filter-chip">
                        <span className="selected-filter-chip-label">{chip.label}</span>
                        <button
                          type="button"
                          className="selected-filter-chip-remove"
                          onClick={() => handleRemoveOrgChip(chip.key)}
                          aria-label={`Remove ${chip.label}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {selectedOrgChips.length === 0 && selectedEventTypeChips.length === 0 && (
                <span className="selected-filters-empty">No filters selected.</span>
              )}
            </div>
          </div>
        </div>

        <div className="app-main-panel">
          {/* MAIN CALENDAR – we forward the handlers with the names FullCalendar expects */}
          <Calendar
            onSelect={handleSelect}
            onEventClick={handleEventClick}
            onDatesSet={handleDatesSet}
            scrollTime="09:00"
          />
        </div>

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
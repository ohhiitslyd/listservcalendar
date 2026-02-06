/* -------------------------------------------------
   src/App.jsx – entry point for the React app
   ------------------------------------------------- */

import React, { useContext, useMemo, useState, useEffect } from "react";
import { AppProvider, AppContext } from "./context/AppContext";

import { Header } from "./components/Header/Header";
import { Calendar } from "./components/Calendar/Calendar";
import { EventDetails } from "./components/EventDetails/EventDetails";
import { CreateEventModal } from "./components/CreateEventModal/CreateEventModal";
import { Filters } from "./components/Filters/Filters";
import { api } from "./api/calendarApi";

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
    excludeMode,
    logout,
    // **NOTE:** we *do not* destructure `onSelect` or `onEventClick`
    // because we will define them locally (see below).
  } = useContext(AppContext);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const [pendingPublishKey, setPendingPublishKey] = useState(null);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [lastPublishedKey, setLastPublishedKey] = useState(null);
  const [eventTypesOpen, setEventTypesOpen] = useState(true);
  const [orgsOpen, setOrgsOpen] = useState(true);

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

  const currentPublishKey = useMemo(() => {
    const cats = Array.from(selectedCats || []).sort();
    const orgs = Array.from(selectedOrgCats || []).sort();
    return JSON.stringify({
      cats,
      orgs,
      exclude: !!excludeMode,
    });
  }, [selectedCats, selectedOrgCats, excludeMode]);

  useEffect(() => {
    if (!user) return;
    if (lastPublishedKey === null) {
      setLastPublishedKey(currentPublishKey);
    }
  }, [user, lastPublishedKey, currentPublishKey]);

  const effectivePublishKey =
    filtersDrawerOpen && pendingPublishKey ? pendingPublishKey : currentPublishKey;

  const hasUnpublishedChanges =
    !!user && lastPublishedKey !== null && effectivePublishKey !== lastPublishedKey;

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

  const publishFilters = async () => {
    try {
      setIsPublishing(true);
      const orgPrefsArray = Array.from(selectedOrgCats);
      const eventTypePrefsArray = Array.from(selectedCats);

      await api.updatePreferences({
        organizationPreference: orgPrefsArray,
        eventTypePreference: eventTypePrefsArray,
        excludeMode,
      });

      const syncResult = await api.syncCalendarByPreferences();
      setPublishResult(syncResult);
      setLastPublishedKey(currentPublishKey);
    } catch (error) {
      console.error("Failed to publish filters:", error);
      alert(`Failed to publish filters: ${error.message || error.error || "Unknown error"}`);
    } finally {
      setIsPublishing(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    const handleBeforeUnload = (event) => {
      if (!hasUnpublishedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [user, hasUnpublishedChanges]);

  useEffect(() => {
    if (publishResult) {
      setShowPublishConfirm(false);
    }
  }, [publishResult]);

  const handleLogout = () => {
    if (hasUnpublishedChanges) {
      setShowLeaveConfirm(true);
      return;
    }
    logout();
  };

  /* -------------------------------------------------
     handleSelect – disabled: users cannot create manual events
     ------------------------------------------------- */
  // const handleSelect = (selectionInfo) => {
  //   if (!user) return;

  //   setSelectionInfo(selectionInfo);
  //   setEventForm({ 
  //     title: "", 
  //     organization: "", 
  //     location: "", 
  //     description: "", 
  //     tags: "", 
  //     poster_url: "", 
  //     allDay: selectionInfo.allDay
  //   });
  //   setCreateModalOpen(true);
  // };

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
      <Header
        onOpenFilters={() => setFiltersDrawerOpen(true)}
        onPublish={() => {
          if (isPublishing || publishResult) return;
          setShowPublishConfirm(true);
        }}
        onLogout={handleLogout}
      />

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
                  <button
                    type="button"
                    className="selected-filters-group-toggle"
                    onClick={() => setEventTypesOpen((prev) => !prev)}
                    aria-expanded={eventTypesOpen}
                  >
                    <span className="selected-filters-group-title">Event types</span>
                    <svg
                      className={`selected-filters-group-caret ${eventTypesOpen ? "open" : ""}`}
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </button>
                  {eventTypesOpen && (
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
                  )}
                </div>
              )}
              {selectedOrgChips.length > 0 && (
                <div className="selected-filters-group">
                  <button
                    type="button"
                    className="selected-filters-group-toggle"
                    onClick={() => setOrgsOpen((prev) => !prev)}
                    aria-expanded={orgsOpen}
                  >
                    <span className="selected-filters-group-title">Organizations</span>
                    <svg
                      className={`selected-filters-group-caret ${orgsOpen ? "open" : ""}`}
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </button>
                  {orgsOpen && (
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
                  )}
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

      {filtersDrawerOpen && (
        <div
          className="filters-drawer-overlay"
          onClick={() => {
            setFiltersDrawerOpen(false);
            setPendingPublishKey(null);
          }}
        >
          <div
            className="filters-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="filters-drawer-header">
              <h3>Filters</h3>
              <button
                type="button"
                className="filters-drawer-close"
                onClick={() => {
                  setFiltersDrawerOpen(false);
                  setPendingPublishKey(null);
                }}
              >
                ✕
              </button>
            </div>
            <Filters
              onClose={() => {
                setFiltersDrawerOpen(false);
                setPendingPublishKey(null);
              }}
              showHeader={false}
              onPendingKeyChange={setPendingPublishKey}
            />
          </div>
        </div>
      )}

      {(showPublishConfirm || isPublishing || publishResult) && (
        <div className="publish-modal-overlay">
          <div className="publish-modal">
            <div className="publish-modal-content">
              {publishResult ? (
                <>
                  <h4>Published to ListServ</h4>
                  <p>
                    {publishResult.published ?? 0} new events were added to your ListServ calendar.
                    {(publishResult.deleted ?? 0) > 0 && (
                      <> {publishResult.deleted} events were removed from your ListServ calendar.</>
                    )}
                  </p>
                  <p style={{ marginTop: "12px", fontSize: "14px", color: "#666" }}>
                    Wait a minute and then refresh your Google Calendar.
                  </p>
                </>
              ) : isPublishing ? (
                <>
                  <h4>Publishing...</h4>
                  <p>Sending events to your ListServ calendar.</p>
                </>
              ) : (
                <>
                  <h4>Publish to Google Calendar</h4>
                  <p>
                    Save your filter preferences and send the current dashboard events
                    to your ListServ calendar.
                  </p>
                </>
              )}
            </div>
            <div className="publish-modal-actions">
              {publishResult ? (
                <button
                  type="button"
                  className="publish-modal-primary"
                  onClick={() => {
                    setPublishResult(null);
                    setShowPublishConfirm(false);
                  }}
                >
                  Done
                </button>
              ) : isPublishing ? null : (
                <>
                  <button
                    type="button"
                    className="publish-modal-secondary"
                    onClick={() => setShowPublishConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="publish-modal-primary"
                    onClick={publishFilters}
                  >
                    Publish
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showLeaveConfirm && (
        <div className="publish-modal-overlay">
          <div className="publish-modal">
            <div className="publish-modal-content">
              <h4>Leave without publishing?</h4>
              <p>
                If you don’t publish, changes won’t be reflected on your Google Calendar.
                Are you sure you want to leave?
              </p>
            </div>
            <div className="publish-modal-actions">
              <button
                type="button"
                className="publish-modal-secondary"
                onClick={() => setShowLeaveConfirm(false)}
              >
                Stay
              </button>
              <button
                type="button"
                className="publish-modal-primary"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  setLastPublishedKey(null);
                  logout();
                }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
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

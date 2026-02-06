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
    events,
    tagColorMap,
    listservCalendarId,
    logout,
    // **NOTE:** we *do not* destructure `onSelect` or `onEventClick`
    // because we will define them locally (see below).
  } = useContext(AppContext);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const [filtersShouldFocusSearch, setFiltersShouldFocusSearch] = useState(false);
  const [pendingPublishKey, setPendingPublishKey] = useState(null);
  const [pendingFiltersCount, setPendingFiltersCount] = useState(null);
  const [publishResult, setPublishResult] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [lastPublishedKey, setLastPublishedKey] = useState(null);
  const [hasEverPublished, setHasEverPublished] = useState(false);
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
      setHasEverPublished(true);
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

  // Auto‑dismiss publish success toast a few seconds after completion
  useEffect(() => {
    if (!publishResult) return;
    const timer = setTimeout(() => {
      setPublishResult(null);
    }, 5000);
    return () => clearTimeout(timer);
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

  // Legend of event-type tags → colors (for right-hand panel)
  const typeLegend = useMemo(() => {
    if (!events || !Array.isArray(events) || !tagColorMap) return [];
    const seen = new Set();
    const legend = [];
    let hasUntagged = false;

    events.forEach((ev) => {
      const isListServ =
        ev.calendarId === listservCalendarId ||
        ev.source === "draft" ||
        ev.source === "email";
      if (!isListServ) return;

      const tags = ev.tags || ev?.extendedProps?.tags || [];
      if (!tags || tags.length === 0) {
        hasUntagged = true;
      }

      tags.forEach((tag) => {
        const key = String(tag || "");
        if (!key || seen.has(key)) return;
        const color = tagColorMap[key];
        if (!color) return;
        seen.add(key);
        legend.push({
          key,
          color,
          label: key,
        });
      });
    });

    // Sort regular tags alphabetically
    legend.sort((a, b) => a.label.localeCompare(b.label));

    // Add "No event type tag" at the bottom if needed
    if (hasUntagged) {
      legend.push({
        key: "__untagged__",
        color: "#e5e7eb",
        label: "No event type tag",
      });
    }

    return legend;
  }, [events, listservCalendarId, tagColorMap]);

  const statusText = useMemo(() => {
    if (!hasEverPublished) {
      return "No events published to ListServ calendar";
    }
    if (hasUnpublishedChanges) {
      return "Changes not yet published to GCal";
    }
    return "Dashboard matches GCal";
  }, [hasEverPublished, hasUnpublishedChanges]);

  /* -------------------------------------------------
     Render the UI layout
     ------------------------------------------------- */
  return (
    <div className="app-container">
      <Header
        onOpenFilters={() => {
          setFiltersShouldFocusSearch(false);
          setFiltersDrawerOpen(true);
        }}
        filtersCount={filtersDrawerOpen && typeof pendingFiltersCount === "number"
          ? pendingFiltersCount
          : undefined}
        onPublish={() => {
          if (isPublishing) return;
          publishFilters();
        }}
        onLogout={handleLogout}
      />

      <div className="app-content">
        <div className="app-left-panel">
          <div className="left-panel-status">
            <span
              className={`left-panel-status-dot ${
                !hasEverPublished || hasUnpublishedChanges ? "unsynced" : "synced"
              }`}
            />
            <span className="left-panel-status-text">
              {statusText}
            </span>
          </div>
          <div className="left-panel-search-bar">
            <input
              type="text"
              className="left-panel-search-input"
              placeholder="Search organizations..."
              readOnly
              onClick={() => {
                setFiltersShouldFocusSearch(true);
                setFiltersDrawerOpen(true);
              }}
              onFocus={() => {
                setFiltersShouldFocusSearch(true);
                setFiltersDrawerOpen(true);
              }}
            />
          </div>
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
          onDatesSet={handleDatesSet}
          scrollTime="09:00"
        />
      </div>

        {/* RIGHT PANEL – event-type color legend */}
        <div className="app-right-panel legend-right-panel">
          <div className="legend-panel">
            <h4 className="legend-title">Event type colors</h4>
            {typeLegend.length === 0 ? (
              <p className="legend-empty">
                Event colors will appear here once events are loaded.
              </p>
            ) : (
              <div className="legend-items">
                {typeLegend.map((item) => (
                  <div key={item.key} className="legend-item">
                    <span
                      className="legend-swatch"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="legend-label">{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
            setFiltersShouldFocusSearch(false);
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
                  setFiltersShouldFocusSearch(false);
                }}
              >
                ✕
              </button>
            </div>
            <Filters
              onClose={() => {
                setFiltersDrawerOpen(false);
                setPendingPublishKey(null);
                setFiltersShouldFocusSearch(false);
                setPendingFiltersCount(null);
              }}
              showHeader={false}
              onPendingKeyChange={setPendingPublishKey}
              onPendingCountChange={setPendingFiltersCount}
              autoFocusOrgSearch={filtersShouldFocusSearch}
            />
          </div>
        </div>
      )}

      {(isPublishing || publishResult) && (
        <div className="publish-toast">
          <div className="publish-toast-content">
            {isPublishing && (
              <>
                <div className="publish-toast-title">Publishing to Google Calendar…</div>
                <div className="publish-toast-progress">
                  <div className="publish-toast-progress-bar" />
                </div>
                <div className="publish-toast-text">
                  Publishing and deleting events. You can keep using the dashboard while events are processing.
                </div>
              </>
            )}
            {!isPublishing && publishResult && (
              <>
                <div className="publish-toast-title">
                  All {(publishResult.published ?? 0) + (publishResult.deleted ?? 0)} events processed
                </div>
                <div className="publish-toast-text">
                  {publishResult.published ?? 0} events published to Google Calendar
                  {(publishResult.deleted ?? 0) > 0 && (
                    <> · {publishResult.deleted} removed</>
                  )}
                  <br />
                  <span style={{ fontSize: "12px", color: "#6b7280" }}>
                    Please wait a few minutes for changes to appear in Google Calendar.
                  </span>
                </div>
              </>
            )}
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

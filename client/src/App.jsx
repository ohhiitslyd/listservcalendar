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
  const [pendingPublishKey, setPendingPublishKey] = useState(null);
  const [pendingFiltersCount, setPendingFiltersCount] = useState(null);
  const [publishResult, setPublishResult] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [lastPublishedKey, setLastPublishedKey] = useState(null);
  const [hasEverPublished, setHasEverPublished] = useState(false);


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
    pendingPublishKey ? pendingPublishKey : currentPublishKey;

  const hasUnpublishedChanges =
    !!user && lastPublishedKey !== null && effectivePublishKey !== lastPublishedKey;


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
        onPublish={() => {
          if (isPublishing) return;
          publishFilters();
        }}
        onLogout={handleLogout}
      />

      <div className="app-content">
        <div className="app-left-panel">
          <Filters
            showHeader={true}
            statusText={statusText}
            statusDotClass={!hasEverPublished || hasUnpublishedChanges ? "unsynced" : "synced"}
            onPendingKeyChange={setPendingPublishKey}
            onPendingCountChange={setPendingFiltersCount}
            autoFocusOrgSearch={false}
          />
        </div>

        <div className="app-main-panel">
          {/* MAIN CALENDAR – we forward the handlers with the names FullCalendar expects */}
        <Calendar
          onDatesSet={handleDatesSet}
          scrollTime="09:00"
        />
      </div>

      </div>

      {/* MODAL – create event */}
      <CreateEventModal />


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

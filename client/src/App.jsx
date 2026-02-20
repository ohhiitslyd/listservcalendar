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
import { Onboarding } from "./components/Onboarding/Onboarding";
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
    login,
    preferencesLoaded,
    // **NOTE:** we *do not* destructure `onSelect` or `onEventClick`
    // because we will define them locally (see below).
  } = useContext(AppContext);
  const [publishResult, setPublishResult] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [publishedKey, setPublishedKey] = useState(null); // Key computed from database preferences
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingClosedThisSession, setOnboardingClosedThisSession] = useState(false);
  const [hasLoggedInThisSession, setHasLoggedInThisSession] = useState(false);

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

  // Compute publishedKey from loaded preferences (what's in the database)
  // This represents what was last published
  useEffect(() => {
    if (user && preferencesLoaded) {
      // Compute key from current filter state when preferences are first loaded
      // At that moment, current state matches what's in the database
      if (publishedKey === null && currentPublishKey) {
        setPublishedKey(currentPublishKey);
      }
    } else if (!user) {
      // Reset when user logs out
      setPublishedKey(null);
    }
  }, [user, preferencesLoaded, currentPublishKey, publishedKey]);

  const hasUnpublishedChanges =
    !!user && publishedKey !== null && currentPublishKey !== publishedKey;

  const handleOpenPublishConfirm = () => {
    // Just show the confirmation popup; we only update DB + GCal if user confirms.
    setShowPublishConfirm(true);
  };

  const publishFilters = async () => {
    try {
      setIsPublishing(true);
      const orgPrefsArray = Array.from(selectedOrgCats || []);
      const eventTypePrefsArray = Array.from(selectedCats || []);

      await api.updatePreferences({
        organizationPreference: orgPrefsArray,
        eventTypePreference: eventTypePrefsArray,
        excludeMode,
      });

      const syncResult = await api.syncCalendarByPreferences();

      setPublishResult(syncResult);
      // Update publishedKey to match what we just published
      setPublishedKey(currentPublishKey);
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

  // Auto-open onboarding for signed-out users (testing mode - only if they haven't logged in yet)
  useEffect(() => {
    if (!user && !onboardingClosedThisSession && !hasLoggedInThisSession) {
      // Auto-open onboarding when user is signed out, hasn't closed it, and hasn't logged in this session
      setOnboardingOpen(true);
    }
  }, [user, onboardingClosedThisSession, hasLoggedInThisSession]);

  // Track when user logs in - once logged in, never auto-open again (only via "?" button)
  useEffect(() => {
    if (user) {
      setHasLoggedInThisSession(true);
      // Close onboarding if it's open when user logs in
      setOnboardingOpen(false);
    }
  }, [user]);

  const handleOnboardingClose = () => {
    setOnboardingOpen(false);
    setOnboardingClosedThisSession(true);
  };

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


  const isPublishedUpToDate = useMemo(() => {
    return publishedKey !== null && !hasUnpublishedChanges;
  }, [publishedKey, hasUnpublishedChanges]);

  const statusText = useMemo(() => {
    return isPublishedUpToDate ? "Published" : "Unpublished Changes";
  }, [isPublishedUpToDate]);

  const statusDotClass = useMemo(() => {
    return isPublishedUpToDate ? "synced" : "unsynced";
  }, [isPublishedUpToDate]);

  const selectedEventTypeLabels = useMemo(() => {
    const labels = [];
    const labelMap = new Map(
      (availableCats || []).map((c) => [c.key, c.label || c.key])
    );
    (selectedCats || new Set()).forEach((key) => {
      const label = labelMap.get(key);
      if (label) labels.push(label);
    });
    return labels.sort();
  }, [availableCats, selectedCats]);

  const selectedOrgLabels = useMemo(() => {
    const labels = [];
    const labelMap = new Map(
      (availableOrgCats || []).map((c) => [c.key, c.label || c.key])
    );
    (selectedOrgCats || new Set()).forEach((key) => {
      const label = labelMap.get(key);
      if (label) labels.push(label);
    });
    return labels.sort();
  }, [availableOrgCats, selectedOrgCats]);


  /* -------------------------------------------------
     Render the UI layout
     ------------------------------------------------- */
  return (
    <div className="app-container">
      <Header
        onPublish={() => {
          if (isPublishing) return;
          handleOpenPublishConfirm();
        }}
        onLogout={handleLogout}
        onMobileFiltersToggle={() => setMobileFiltersOpen(!mobileFiltersOpen)}
        mobileFiltersOpen={mobileFiltersOpen}
        statusText={statusText}
        statusDotClass={statusDotClass}
        onHelpClick={user ? () => setOnboardingOpen(true) : undefined}
      />

      <div className="app-content">
        <div className="app-left-panel">
          <Filters
            showHeader={true}
            statusText={null}
            statusDotClass={null}
            autoFocusOrgSearch={false}
            onClose={() => setMobileFiltersOpen(false)}
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

      {/* Mobile filters overlay */}
      {mobileFiltersOpen && (
        <div className="mobile-filters-overlay" onClick={() => setMobileFiltersOpen(false)}>
          <div className="mobile-filters-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-filters-header">
              <h3>Filters</h3>
              <button
                className="mobile-filters-close"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <Filters
              showHeader={false}
              statusText={null}
              statusDotClass={null}
              autoFocusOrgSearch={false}
              onClose={() => setMobileFiltersOpen(false)}
            />
          </div>
        </div>
      )}

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
                ‼️ Changes won't be reflected on your Google Calendar!
                Are you sure you want to leave?
              </p>
            </div>
            <div className="publish-modal-actions">
              <button
                type="button"
                className="publish-modal-primary"
                onClick={() => setShowLeaveConfirm(false)}
              >
                Stay
              </button>
              <button
                type="button"
                className="publish-modal-secondary"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  logout();
                }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {showPublishConfirm && (
        <div className="publish-modal-overlay">
          <div className="publish-modal">
            <div className="publish-modal-content">
              <h4>Publish to Google Calendar?</h4>
              <p className="publish-modal-caption">
                All events currently visible will be added to your ListServ calendar!
              </p>
              <p className="publish-modal-note">
                ⭐️ This will not affect your main personal calendar.
              </p>
            </div>
            <div className="publish-modal-actions">
              <button
                type="button"
                className="publish-modal-secondary"
                onClick={() => {
                  setShowPublishConfirm(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="publish-modal-primary"
                onClick={async () => {
                  setShowPublishConfirm(false);
                  await publishFilters();
                }}
              >
                Publish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Modal */}
      <Onboarding
        isOpen={onboardingOpen}
        onClose={handleOnboardingClose}
        onLogin={login}
        isSignedIn={!!user}
      />
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

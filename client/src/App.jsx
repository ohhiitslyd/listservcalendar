import React, { useEffect, useState, useCallback, useRef } from "react";
import FullCalendarReact from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [visibleCalendars, setVisibleCalendars] = useState(new Set());
  const [events, setEvents] = useState([]);
  const [listservCalendarId, setListservCalendarId] = useState(null);
  const calendarRef = useRef();

  // Filter states
  const [activeFilters, setActiveFilters] = useState(new Set());
  const [weeklyCounts, setWeeklyCounts] = useState({});

  // Filter categories
  const CATEGORIES = {
    "Career Development (by field/major)": [
      "Finance",
      "Engineering",
      "Pre-Med",
      "Computer Science",
    ],
    "Greek Life Events": ["On night events (drinks 21+)", "Phil events"],
    "Dartmouth Related Research Opportunities": [
      "Evergreen AI",
      "URad opportunities",
    ],
    "Music / Arts": [
      "Acapella",
      "Orchestra",
      "Bands",
      "DJ Set",
      "Dance Shows",
      "Visual Art",
      "Movie Screenings",
      "Museum Exhibits",
      "Hood",
      "BVAC",
    ],
    "Free Food": ["Free Food"],
    "Outdoors / Nature": ["DOC events"],
    "News / Politics": ["DPU", "Political Talks"],
    "House Community Events": [
      "Allen House",
      "West House",
      "East Wheelock House",
      "North Park House",
      "School House",
      "South House",
      "Community Dinners",
      "Community Trips",
    ],
    "Cultural / Religion / Theological": ["AQ", "Hillel", "KSA", "DCSA"],
    "Dartmouth Related Academia": ["Dean Emails", "Termly Reminders"],
    "Department Based (by department)": [],
  };

  // Modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectionInfo, setSelectionInfo] = useState(null);

  // Form state for creating events
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    location: "",
    allDay: false,
  });

  const fetchMe = async () => {
    const res = await fetch("/api/me", { credentials: "include" });
    const data = await res.json();
    setUser(data.user);
  };

  // Fetch calendars and set defaults
  const fetchCalendars = async () => {
    const res = await fetch("/api/calendars", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    const items = data.calendars || [];
    setCalendars(items);

    // find listserv calendar id if present
    const ls = items.find(
      (c) => c.summary && c.summary.toLowerCase() === "listserv events"
    );
    if (ls) setListservCalendarId(ls.id);

    // Default visible: primary + listserv (if exists)
    const defaults = items
      .filter(
        (c) =>
          c.primary ||
          (c.summary && c.summary.toLowerCase() === "listserv events")
      )
      .map((c) => c.id);

    // If nothing matched (rare), default to 'primary'
    if (defaults.length === 0) defaults.push("primary");

    setVisibleCalendars(new Set(defaults));
    // fetch events for defaults
    await fetchEvents(defaults);
  };

  // Fetch working calendar info (optional)
  const fetchWorkingCalendar = async () => {
    const res = await fetch("/api/calendar", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.id) {
      setListservCalendarId(data.id);
    }
  };

  // Fetch events for the selected calendar IDs
  const fetchEvents = useCallback(
    async (calendarIds) => {
      const ids = calendarIds || Array.from(visibleCalendars);
      const query =
        ids && ids.length
          ? `?calendarIds=${encodeURIComponent(ids.join(","))}`
          : "";
      const res = await fetch(`/api/events${query}`, {
        credentials: "include",
      });
      if (res.status === 401) {
        setEvents([]);
        return;
      }
      const data = await res.json();
      // Transform events for FullCalendar with extendedProps
      const transformedEvents = (data.events || []).map((ev) => ({
        ...ev,
        extendedProps: {
          description: ev.description || "",
          location: ev.location || "",
          source: ev.source,
          calendarId: ev.calendarId || null,
          filter: ev.filter || ev.tag || null, // Add filter/tag for filtering
        },
      }));
      setEvents(transformedEvents);
    },
    [visibleCalendars]
  );

  useEffect(() => {
    fetchMe();
  }, []);

  useEffect(() => {
    if (user) {
      fetchCalendars();
      fetchWorkingCalendar();
    } else {
      setCalendars([]);
      setVisibleCalendars(new Set());
      setEvents([]);
      setListservCalendarId(null);
    }
  }, [user]);

  const login = () => {
    window.location.href = "/auth/google";
  };

  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    setEvents([]);
  };

  // Filter helper functions
  const isGoogle = (e) => {
    const id = String(e?.id || e?._def?.publicId || "");
    return (
      id.startsWith("google:") ||
      e?.source === "google" ||
      e?.provider === "google" ||
      e?.calendarType === "google"
    );
  };

  const getTag = (e) => {
    const ext = e?.extendedProps || e?._def?.extendedProps || {};
    return ext.filter || ext.tag || null;
  };

  const isCampus = (e) => !!getTag(e);

  const toggleFilter = (name) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const clearFilters = () => setActiveFilters(new Set());

  // Apply filters to calendar events
  const applyFiltersToCalendar = useCallback(() => {
    const api = calendarRef.current?.getApi?.();
    if (!api) return;

    const noneSelected = activeFilters.size === 0;

    api.batchRendering(() => {
      api.getEvents().forEach((evApi) => {
        if (isGoogle(evApi)) {
          evApi.setProp("display", "auto");
          return;
        }
        if (!isCampus(evApi)) {
          evApi.setProp("display", "auto");
          return;
        }
        if (noneSelected) {
          evApi.setProp("display", "auto");
        } else {
          const tag = getTag(evApi);
          evApi.setProp("display", activeFilters.has(tag) ? "auto" : "none");
        }
      });
    });
  }, [activeFilters]);

  // Calculate weekly counts for filter badges
  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    const base = api?.getDate?.() ?? new Date();
    const start = new Date(base);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const counts = {};
    Object.values(CATEGORIES)
      .flat()
      .forEach((f) => (counts[f] = 0));

    (events || []).forEach((e) => {
      if (!isCampus(e)) return;
      const when = new Date(e.start || e.startStr || e.date || e.startTime);
      if (isNaN(+when) || when < start || when > end) return;
      const tag = getTag(e);
      if (typeof counts[tag] === "number") counts[tag] += 1;
    });
    setWeeklyCounts(counts);
  }, [events]);

  // Apply filters when they change
  useEffect(() => {
    applyFiltersToCalendar();
  }, [applyFiltersToCalendar, events]);

  // Helper to toggle calendar visibility
  const toggleCalendar = async (calId) => {
    const newSet = new Set(visibleCalendars);
    if (newSet.has(calId)) newSet.delete(calId);
    else newSet.add(calId);
    setVisibleCalendars(newSet);
    await fetchEvents(Array.from(newSet));
  };

  const onSelect = (selectionInfo) => {
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

  const handleCreateEvent = async (publishImmediately = false) => {
    if (!eventForm.title.trim()) {
      alert("Please enter an event title");
      return;
    }

    const body = {
      title: eventForm.title,
      description: eventForm.description || "",
      location: eventForm.location || "",
      start: selectionInfo.startStr,
      end: selectionInfo.endStr,
      allDay: eventForm.allDay,
    };

    if (publishImmediately) {
      // Create draft first, then immediately publish
      const draftRes = await fetch("/api/drafts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const draftData = await draftRes.json();
      if (draftData.id) {
        const publishRes = await fetch(
          `/api/events/${encodeURIComponent(draftData.id)}/publish`,
          {
            method: "POST",
            credentials: "include",
          }
        );
        if (!publishRes.ok) {
          alert("Failed to publish event");
        }
      } else {
        alert("Failed to create event");
      }
    } else {
      // Just save as draft
      const res = await fetch("/api/drafts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.id) {
        alert("Failed to create draft");
      }
    }

    setCreateModalOpen(false);
    setSelectionInfo(null);
    setEventForm({ title: "", description: "", location: "", allDay: false });
    const api = calendarRef.current?.getApi();
    api?.unselect();
    await fetchEvents(Array.from(visibleCalendars));
  };

  const onEventClick = (clickInfo) => {
    const ev = clickInfo.event;
    const id = ev.id;
    const source =
      ev.extendedProps?.source ||
      (id.startsWith("draft:") ? "draft" : "google");

    // If it's a Google event not from ListServ, show info only
    if (source === "google") {
      const calendarId = ev.extendedProps?.calendarId;
      const isListServEvent =
        listservCalendarId && calendarId === listservCalendarId;

      if (!isListServEvent) {
        window.alert(
          "This event is not part of the ListServ Events calendar. Edits are only allowed for ListServ Events."
        );
        return;
      }
    }

    setSelectedEvent(ev);
    setEventModalOpen(true);
  };

  const handlePublishEvent = async () => {
    const id = selectedEvent.id;
    if (!id.startsWith("draft:")) return;

    const res = await fetch(`/api/events/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      alert("Failed to publish event");
    } else {
      setEventModalOpen(false);
      setSelectedEvent(null);
      await fetchEvents(Array.from(visibleCalendars));
    }
  };

  const handleDeleteEvent = async () => {
    if (!window.confirm("Are you sure you want to delete this event?")) return;

    const id = selectedEvent.id;
    await fetch(`/api/events/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    setEventModalOpen(false);
    setSelectedEvent(null);
    await fetchEvents(Array.from(visibleCalendars));
  };

  const refresh = () => fetchEvents(Array.from(visibleCalendars));

  return (
    <div className="app-container">
      {/* Fixed Header */}
      <div className="app-header">
        <h2>Calendar Sync (ListServ)</h2>
        <div className="app-header-controls">
          {user ? (
            <div>
              <span>Signed in as {user.name || user.email}</span>
              <button className="app-header-button" onClick={logout}>
                Logout
              </button>
              <button className="app-header-button" onClick={refresh}>
                Refresh
              </button>
            </div>
          ) : (
            <button onClick={login}>Sign in with Google</button>
          )}
        </div>

        {/* Calendar Selection */}
        {user && calendars.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <strong>Calendars</strong>
            <div style={{ marginTop: 8 }}>
              {calendars.length === 0 && (
                <div style={{ fontStyle: "italic" }}>No calendars loaded</div>
              )}
              {calendars.map((c) => {
                const isListServ =
                  c.summary && c.summary.toLowerCase() === "listserv events";
                return (
                  <label
                    key={c.id}
                    style={{
                      marginRight: 12,
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={visibleCalendars.has(c.id)}
                      onChange={() => toggleCalendar(c.id)}
                      disabled={isListServ}
                      style={{ marginRight: 6 }}
                    />
                    <span>
                      {c.summary}
                      {c.primary ? " (primary)" : ""}
                      {isListServ ? " (ListServ)" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: "#444" }}>
              <div>
                Notes: Primary calendar and ListServ Events are visible by
                default. Edits (publish/delete) are only allowed on the ListServ
                Events calendar.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area with Panels */}
      <div className="app-content">
        {/* Left Panel - Filters */}
        <div className="app-left-panel">
          <div
            style={{ display: "flex", alignItems: "center", marginBottom: 12 }}
          >
            <h3 style={{ margin: 0, flex: 1 }}>Filters</h3>
            <button
              onClick={clearFilters}
              style={{
                fontSize: 12,
                border: "1px solid #e5e7eb",
                background: "#fff",
                borderRadius: 8,
                padding: "4px 8px",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>

          {Object.entries(CATEGORIES).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#374151",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {cat}
              </div>
              {items.length === 0 ? (
                <div style={{ color: "#9ca3af", fontSize: 13 }}>
                  (No filters yet)
                </div>
              ) : (
                items.map((name) => {
                  const active = activeFilters.has(name);
                  const count = weeklyCounts[name] ?? 0;
                  return (
                    <button
                      key={name}
                      onClick={() => toggleFilter(name)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        borderRadius: 10,
                        padding: "8px 10px",
                        border: active
                          ? "1px solid #3b82f6"
                          : "1px solid #e5e7eb",
                        background: active ? "#eff6ff" : "#fff",
                        color: active ? "#1d4ed8" : "#111827",
                        cursor: "pointer",
                        fontSize: 14,
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {name}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          minWidth: 26,
                          textAlign: "center",
                          padding: "2px 6px",
                          borderRadius: 999,
                          background: "#f3f4f6",
                          border: "1px solid #e5e7eb",
                        }}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ))}
        </div>

        {/* Calendar Container - Fixed Header, Scrollable Body */}
        <div className="app-calendar-container">
          <div className="app-calendar-wrapper">
            <FullCalendarReact
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              headerToolbar={{
                left: "prev,next today",
                center: "title",
                right: "timeGridWeek,timeGridDay",
              }}
              initialView="timeGridWeek"
              selectable={true}
              selectMirror={true}
              select={onSelect}
              events={events}
              eventClick={onEventClick}
              height="100%"
            />
          </div>
        </div>

        {/* Right Panel - Event Details (Future) */}
        <div className="app-right-panel">
          <h3>Event Details</h3>
          <p>Event card display placeholder</p>
        </div>
      </div>

      {/* Fixed Footer */}
      <div className="app-footer">
        <p>
          Click and drag on the calendar to create an event. Click any event to
          view details and manage it.
        </p>
      </div>

      {/* Create Event Modal */}
      {createModalOpen && (
        <div
          className="modal-overlay"
          onClick={() => {
            setCreateModalOpen(false);
            setSelectionInfo(null);
            const api = calendarRef.current?.getApi();
            api?.unselect();
          }}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Create Event</h3>
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input
                type="text"
                className="form-input"
                value={eventForm.title}
                onChange={(e) =>
                  setEventForm({ ...eventForm, title: e.target.value })
                }
                placeholder="Event title"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-textarea"
                value={eventForm.description}
                onChange={(e) =>
                  setEventForm({ ...eventForm, description: e.target.value })
                }
                placeholder="Event description (optional)"
                rows={3}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Location</label>
              <input
                type="text"
                className="form-input"
                value={eventForm.location}
                onChange={(e) =>
                  setEventForm({ ...eventForm, location: e.target.value })
                }
                placeholder="Location (optional)"
              />
            </div>
            <div className="form-group" style={{ marginBottom: "20px" }}>
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={eventForm.allDay}
                  onChange={(e) =>
                    setEventForm({ ...eventForm, allDay: e.target.checked })
                  }
                />
                <span>All-day event</span>
              </label>
            </div>
            <div className="button-group">
              <button
                className="button button-cancel"
                onClick={() => {
                  setCreateModalOpen(false);
                  setSelectionInfo(null);
                  const api = calendarRef.current?.getApi();
                  api?.unselect();
                }}
              >
                Cancel
              </button>
              <button
                className="button button-secondary"
                onClick={() => handleCreateEvent(false)}
              >
                Save as Draft
              </button>
              <button
                className="button button-primary"
                onClick={() => handleCreateEvent(true)}
              >
                Publish to Google Calendar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Details Modal */}
      {eventModalOpen && selectedEvent && (
        <div
          className="modal-overlay"
          onClick={() => {
            setEventModalOpen(false);
            setSelectedEvent(null);
          }}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">
              {selectedEvent.title || "(No title)"}
            </h3>
            <div className="event-details">
              <div className="event-details-item">
                <strong>Start:</strong>{" "}
                {selectedEvent.start
                  ? new Date(selectedEvent.start).toLocaleString()
                  : "Not set"}
              </div>
              {selectedEvent.end && (
                <div className="event-details-item">
                  <strong>End:</strong>{" "}
                  {new Date(selectedEvent.end).toLocaleString()}
                </div>
              )}
              {selectedEvent.extendedProps?.description && (
                <div className="event-details-item">
                  <strong>Description:</strong>{" "}
                  {selectedEvent.extendedProps.description}
                </div>
              )}
              {selectedEvent.extendedProps?.location && (
                <div className="event-details-item">
                  <strong>Location:</strong>{" "}
                  {selectedEvent.extendedProps.location}
                </div>
              )}
              <div className="event-status">
                {selectedEvent.id.startsWith("draft:") ? (
                  <span className="event-status-draft">● Draft</span>
                ) : (
                  <span className="event-status-published">
                    ● Published to Google Calendar
                  </span>
                )}
              </div>
            </div>
            <div className="event-actions">
              <button
                className="button button-cancel"
                onClick={() => {
                  setEventModalOpen(false);
                  setSelectedEvent(null);
                }}
              >
                Close
              </button>
              {selectedEvent.id.startsWith("draft:") && (
                <button
                  className="button button-primary"
                  onClick={handlePublishEvent}
                >
                  Publish to Google Calendar
                </button>
              )}
              {/* Only show delete for drafts or ListServ events */}
              {(selectedEvent.id.startsWith("draft:") ||
                (selectedEvent.extendedProps?.calendarId ===
                  listservCalendarId &&
                  listservCalendarId)) && (
                <button
                  className="button button-danger"
                  onClick={handleDeleteEvent}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

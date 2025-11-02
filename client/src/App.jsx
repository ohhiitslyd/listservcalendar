import React, { useEffect, useState, useCallback, useRef } from "react";
import FullCalendarReact from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [events, setEvents] = useState([]);
  const calendarRef = useRef();

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

  const fetchEvents = useCallback(async () => {
    const res = await fetch("/api/events", { credentials: "include" });
    if (res.status === 401) return setEvents([]);
    const data = await res.json();
    // Transform events for FullCalendar with extendedProps
    const transformedEvents = (data.events || []).map((ev) => ({
      ...ev,
      extendedProps: {
        description: ev.description || "",
        location: ev.location || "",
      },
    }));
    setEvents(transformedEvents);
  }, []);

  useEffect(() => {
    fetchMe();
  }, []);

  useEffect(() => {
    if (user) fetchEvents();
  }, [user, fetchEvents]);

  const login = () => {
    window.location.href = "/auth/google";
  };

  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    setEvents([]);
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
    await fetchEvents();
  };

  const onEventClick = (clickInfo) => {
    const ev = clickInfo.event;
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
      await fetchEvents();
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
    await fetchEvents();
  };

  return (
    <div className="app-container">
      {/* Fixed Header */}
      <div className="app-header">
        <h2>Calendar Sync</h2>
        <div className="app-header-controls">
          {user ? (
            <div>
              <span>Signed in as {user.name || user.email}</span>
              <button className="app-header-button" onClick={logout}>
                Logout
              </button>
              <button className="app-header-button" onClick={fetchEvents}>
                Refresh
              </button>
            </div>
          ) : (
            <button onClick={login}>Sign in with Google</button>
          )}
        </div>
      </div>

      {/* Main Content Area with Panels */}
      <div className="app-content">
        {/* Left Panel - Filtering (Future) */}
        <div className="app-left-panel">
          <h3>Filters</h3>
          <p>Filtering panel placeholder</p>
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
                right: "dayGridMonth,timeGridWeek,timeGridDay",
              }}
              initialView="dayGridMonth"
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
              <button
                className="button button-danger"
                onClick={handleDeleteEvent}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

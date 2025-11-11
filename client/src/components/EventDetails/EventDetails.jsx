import React, { useContext } from "react";
import { AppContext } from "../../context/AppContext";
import "./EventDetails.css";

export const EventDetails = () => {
  const {
    selectedEvent,
    setSelectedEvent,
    handlePublishEvent,
    handleDeleteEvent,
    listservCalendarId,
    logout,
  } = useContext(AppContext);

  if (!selectedEvent) {
    return (
      <div className="event-details-placeholder">
        <h3>Event Details</h3>
        <p>Click an event to see its details here.</p>
      </div>
    );
  }

  const isDraft = selectedEvent.id.startsWith("draft:");
  const isListServ =
    selectedEvent.extendedProps?.calendarId === listservCalendarId;

  return (
    <div className="event-details-card">
      <button
        className="close-panel-button"
        onClick={() => setSelectedEvent(null)}
      >
        &times;
      </button>

      <h3 className="modal-title">{selectedEvent.title || "(No title)"}</h3>

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
          {isDraft ? (
            <span className="event-status-draft">● Draft</span>
          ) : (
            <span className="event-status-published">
              ● Published to Google Calendar
            </span>
          )}
        </div>
      </div>

      <div className="event-actions">
        {isDraft && (
          <button className="button button-primary" onClick={handlePublishEvent}>
            Publish to Google Calendar
          </button>
        )}
        {(isDraft || isListServ) && (
          <button className="button button-danger" onClick={handleDeleteEvent}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
};
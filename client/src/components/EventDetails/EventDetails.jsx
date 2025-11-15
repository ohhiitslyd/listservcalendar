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
      // X button top-right corner to close event
        className="close-panel-button"
        onClick={() => setSelectedEvent(null)}
      >
        &times;
      </button>

      <h3 className="modal-title">{selectedEvent.title || "(No title)"}</h3>

      <div className="event-details">

        {selectedEvent.extendedProps?.organization && (
          <div className="event-details-item">
            <strong>Organization:</strong>{" "}
            {selectedEvent.extendedProps.organization}
          </div>
        )}

        {selectedEvent.extendedProps?.location && (
          <div className="event-details-item">
            <strong>Location:</strong>{" "}
            {selectedEvent.extendedProps.location}
          </div>
        )}

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

        {selectedEvent.extendedProps?.tags &&
        selectedEvent.extendedProps.tags.length > 0 && (
          <div className="event-details-item">
            <strong>Tags:</strong>
            <div className="event-tags-container">
              {selectedEvent.extendedProps.tags.map((tag, index) => (
                <span key={index} className="event-tag">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {selectedEvent.extendedProps?.poster_url && (
        <div className="event-details-item">
          <strong>Attachment:</strong>
          {/* Check if it's a PDF or an image */}
          {selectedEvent.extendedProps.poster_url.endsWith('.pdf') ? (
            <a href={selectedEvent.extendedProps.poster_url} target="_blank" rel="noopener noreferrer">
              View Poster (PDF)
            </a>
          ) : (
            <img 
              src={selectedEvent.extendedProps.poster_url} 
              alt="Event Poster" 
              className="event-poster-image" 
            />
          )}
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
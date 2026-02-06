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
    return null;
  }

  const isDraft = selectedEvent.id.startsWith("draft:");
  const isEmail = selectedEvent.id.startsWith("email:");
  const isListServ =
    selectedEvent.extendedProps?.calendarId === listservCalendarId;

  // Format date and time
  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).toLowerCase();
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Get tag color based on organization type (music = blue, sports = purple, etc.)
  const getTagColor = () => {
    // For now, default to blue for music organizations
    // You can enhance this based on the organization type
    return "#93b3ea";
  };

  return (
    <div className="event-details-card">
      {/* Header with colored background */}
      <div className="event-details-header">
        <h3 className="event-details-title">{selectedEvent.title || "(No title)"}</h3>
        <button
          className="close-panel-button"
          onClick={() => setSelectedEvent(null)}
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#93b3ea" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      {/* Separator line */}
      <div className="event-details-separator"></div>

      {/* Event details */}
      <div className="event-details-content">
        {selectedEvent.extendedProps?.organization && (
          <div className="event-details-row">
            <svg className="event-details-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1e1e1e" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span className="event-details-text">{selectedEvent.extendedProps.organization}</span>
          </div>
        )}

        <div className="event-details-row">
          <svg className="event-details-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1e1e1e" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <div className="event-details-time-group">
            {selectedEvent.start && selectedEvent.end && (
              <>
                <div className="event-details-text">
                  {formatTime(selectedEvent.start)} - {formatTime(selectedEvent.end)}
                </div>
                <div className="event-details-text">
                  {formatDate(selectedEvent.start)}
                </div>
              </>
            )}
          </div>
        </div>

        {selectedEvent.extendedProps?.location && (
          <div className="event-details-row">
            <svg className="event-details-icon" width="15" height="15" viewBox="0 0 24 24" fill="#1d1b20">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"></path>
            </svg>
            <span className="event-details-text">{selectedEvent.extendedProps.location}</span>
          </div>
        )}

        {selectedEvent.extendedProps?.description && (
          <div className="event-details-row">
            <svg className="event-details-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1e1e1e" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <span className="event-details-text">{selectedEvent.extendedProps.description}</span>
          </div>
        )}

        {selectedEvent.extendedProps?.poster_url && (
          <div className="event-details-poster">
            <img
              src={selectedEvent.extendedProps.poster_url}
              alt={`${selectedEvent.title || "Event"} poster`}
              className="event-poster-image"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <a
              className="event-poster-link"
              href={selectedEvent.extendedProps.poster_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              View full poster
            </a>
          </div>
        )}

        {selectedEvent.extendedProps?.tags &&
        selectedEvent.extendedProps.tags.length > 0 && (
          <div className="event-details-row event-details-tags-row">
            <svg className="event-details-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1e1e1e" strokeWidth="2">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
              <line x1="7" y1="7" x2="7.01" y2="7"></line>
            </svg>
            <div className="event-tags-container">
              {selectedEvent.extendedProps.tags.map((tag, index) => (
                <span 
                  key={index} 
                  className="event-tag"
                  style={{ backgroundColor: getTagColor(), borderColor: getTagColor() }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Delete button for listserv events */}
      {(isDraft || isEmail || isListServ) && (
        <div className="event-details-actions">
          <button 
            className="event-delete-button" 
            onClick={handleDeleteEvent}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};
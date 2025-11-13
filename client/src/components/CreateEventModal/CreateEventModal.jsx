import React, { useContext } from "react";
import { AppContext } from "../../context/AppContext";
import "./CreateEventModal.css";

export const CreateEventModal = () => {
  const {
    createModalOpen,
    setCreateModalOpen,
    selectionInfo,
    setSelectionInfo,
    eventForm,
    setEventForm,
    handleCreateEvent,
    calendarRef,
  } = useContext(AppContext);

  if (!createModalOpen) return null;

  const close = () => {
    setCreateModalOpen(false);
    setSelectionInfo(null);
    const api = calendarRef?.current?.getApi?.();
    api?.unselect();
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Create Event</h3>

        {/* Title */}
        <div className="form-group">
          <label className="form-label">Title</label>
          <input
            type="text"
            className="form-input"
            value={eventForm.title}
            onChange={e =>
              setEventForm({ ...eventForm, title: e.target.value })
            }
            placeholder="Event title (optional)"
            autoFocus
          />
        </div>

        {/* Organization */}
        <div className="form-group">
          <label className="form-label">Organization</label>
          <input
            type="text"
            className="form-input"
            value={eventForm.organization}
            onChange={e =>
              setEventForm({ ...eventForm, organization: e.target.value })
            }
            placeholder="Organization (optional)"
          />
        </div>

        {/* Location */}
        <div className="form-group">
          <label className="form-label">Location</label>
          <input
            type="text"
            className="form-input"
            value={eventForm.location}
            onChange={e =>
              setEventForm({ ...eventForm, location: e.target.value })
            }
            placeholder="Location (optional)"
          />
        </div>

        {/* Description */}
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-textarea"
            value={eventForm.description}
            onChange={e =>
              setEventForm({ ...eventForm, description: e.target.value })
            }
            placeholder="Event description (optional)"
            rows={3}
          />
        </div>

        {/* Tags */}
        <div className="form-group">
              <label className="form-label">Tags</label>
              <input
                type="text"
                className="form-input"
                value={eventForm.tags}
                onChange={(e) =>
                  setEventForm({ ...eventForm, tags: e.target.value })
                }
                placeholder="Comma-separated, e.g., guest lecture, free food"
              />
        </div>

        {/* Poster URL */}
        <div className="form-group">
              <label className="form-label">Poster/Image URL</label>
              <input
                type="text"
                className="form-input"
                value={eventForm.poster_url}
                onChange={(e) =>
                  setEventForm({ ...eventForm, poster_url: e.target.value })
                }
                placeholder="https://.../poster.png (optional)"
              />
        </div>

        {/* All‑day toggle */}
        <div className="form-group" style={{ marginBottom: "20px" }}>
          <label className="form-checkbox-label">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={eventForm.allDay}
              onChange={e =>
                setEventForm({ ...eventForm, allDay: e.target.checked })
              }
            />
            <span>All‑day event</span>
          </label>
        </div>

        {/* Buttons */}
        <div className="button-group">
          <button className="button button-cancel" onClick={close}>
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
  );
};
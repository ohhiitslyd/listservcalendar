import React, {
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { AppContext } from "../../context/AppContext";
import { api } from "../../api/calendarApi";
import "./EventDetails.css";

export const EventDetails = ({ onClose }) => {
  const {
    user,
    selectedEvent,
    setSelectedEvent,
    setEvents,
    calendarRef,
    listservCalendarId,
    setEventDetailsSource,
    selectedEventInviters,
    setSelectedEventInviters,
    setUserInviteState,
    tagColorMap,
  } = useContext(AppContext);
  const [showNudgeForm, setShowNudgeForm] = useState(false);
  const [nudgeEmail, setNudgeEmail] = useState("");
  const [nudgeRecipients, setNudgeRecipients] = useState([]);
  const [nudgeLoading, setNudgeLoading] = useState(false);
  const [nudgeSuccess, setNudgeSuccess] = useState(null); // { emails: string[] } when nudge succeeds
  const [inviteResponseLoading, setInviteResponseLoading] = useState(false);
  const [optimisticallyRemovedInviters, setOptimisticallyRemovedInviters] = useState(new Set());
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const debounceTimerRef = useRef(null);
  const searchCounterRef = useRef(0);
  const suggestionsRef = useRef(null);
  const inputRef = useRef(null);
  
  // Session-level storage for previously nudged emails
  const getPreviouslyNudgedEmails = () => {
    try {
      const stored = sessionStorage.getItem("previouslyNudgedEmails");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };
  
  const addToPreviouslyNudged = (emails) => {
    try {
      const existing = getPreviouslyNudgedEmails();
      const newSet = new Set([...existing, ...emails.map(e => e.toLowerCase())]);
      sessionStorage.setItem("previouslyNudgedEmails", JSON.stringify([...newSet]));
    } catch {
      // Ignore storage errors
    }
  };

  useEffect(() => {
    setShowNudgeForm(false);
    setNudgeEmail("");
    setNudgeRecipients([]);
    setNudgeLoading(false);
    setNudgeSuccess(null);
    setInviteResponseLoading(false);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestionIndex(-1);
    setOptimisticallyRemovedInviters(new Set());
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, [selectedEvent?.id]);

  const searchPeople = useCallback((query) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (!query || query.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceTimerRef.current = setTimeout(async () => {
      const requestId = ++searchCounterRef.current;
      try {
        const data = await api.searchDartmouthPeople(query.trim());
        if (requestId !== searchCounterRef.current) return;
        
        // Check if each person has been nudged for THIS specific event
        const normalizeEventId = (id) => {
          const value = String(id || "").trim();
          if (!value) return "";
          if (value.startsWith("email:")) return value.slice("email:".length);
          return value;
        };
        
        const currentEventId = String(selectedEvent?.id || "").trim();
        const normalizedCurrentEventId = normalizeEventId(currentEventId);
        const userNudgedEvents = Array.isArray(user?.nudgedEvents) ? user.nudgedEvents : [];
        
        // Mark API results that have been nudged for this specific event
        const apiResults = (data.results || []).map(r => {
          const emailLower = r.email.toLowerCase();
          const hasBeenNudgedForThisEvent = userNudgedEvents.some((entry) => {
            const entryId = String(entry?.id || "").trim();
            const normalizedEntryId = normalizeEventId(entryId);
            const entryEmail = String(entry?.email || "").trim().toLowerCase();
            
            // Check if this entry matches both the event ID and the email
            const eventMatches = 
              entryId === currentEventId || 
              normalizedEntryId === normalizedCurrentEventId ||
              entryId === normalizedCurrentEventId ||
              normalizedEntryId === currentEventId;
            
            const emailMatches = entryEmail === emailLower;
            
            return eventMatches && emailMatches;
          });
          
          return {
            ...r,
            isPreviouslyNudged: hasBeenNudgedForThisEvent
          };
        });
        
        setSuggestions(apiResults);
        setShowSuggestions(apiResults.length > 0);
        setActiveSuggestionIndex(-1);
      } catch {
        if (requestId !== searchCounterRef.current) return;
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);
  }, [selectedEvent?.id, user?.nudgedEvents]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target) &&
        inputRef.current &&
        !inputRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const addRecipient = (email, displayName) => {
    const lower = email.toLowerCase();
    if (nudgeRecipients.some((r) => r.email.toLowerCase() === lower)) return;
    setNudgeRecipients((prev) => [...prev, { email, displayName }]);
  };

  const removeRecipient = (email) => {
    setNudgeRecipients((prev) => prev.filter((r) => r.email !== email));
  };

  const handleSuggestionClick = (suggestion) => {
    addRecipient(suggestion.email, suggestion.displayName);
    setNudgeEmail("");
    setShowSuggestions(false);
    setSuggestions([]);
    setActiveSuggestionIndex(-1);
  };

  const tryAddManualEmail = () => {
    const trimmed = nudgeEmail.trim();
    if (trimmed && trimmed.includes("@")) {
      addRecipient(trimmed, trimmed);
      setNudgeEmail("");
      setSuggestions([]);
      setShowSuggestions(false);
      return true;
    }
    return false;
  };

  const handleInputKeyDown = (e) => {
    // Backspace on empty input removes last chip
    if (e.key === "Backspace" && !nudgeEmail && nudgeRecipients.length > 0) {
      removeRecipient(nudgeRecipients[nudgeRecipients.length - 1].email);
      return;
    }
    // Suggestions navigation
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestionIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0,
        );
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSuggestionIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1,
        );
        return;
      } else if (e.key === "Enter" && activeSuggestionIndex >= 0) {
        e.preventDefault();
        handleSuggestionClick(suggestions[activeSuggestionIndex]);
        return;
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }
    // Enter / Tab / Comma with typed email → add as manual chip
    if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      if (tryAddManualEmail()) {
        e.preventDefault();
      } else if (e.key === "Enter") {
        e.preventDefault(); // prevent form submit from Enter in input
      }
    }
  };

  if (!selectedEvent) {
    return null;
  }

  const isDraft = selectedEvent.id.startsWith("draft:");
  const isEmail = selectedEvent.id.startsWith("email:");
  const isListServ =
    selectedEvent.extendedProps?.calendarId === listservCalendarId;
  const parseEventDateTime = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return NaN;
    const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
    return Date.parse(normalized);
  };

  const eventEndMs = parseEventDateTime(selectedEvent?.end || selectedEvent?.start);
  const hasEnded = !Number.isNaN(eventEndMs) && eventEndMs < Date.now();
  const canNudge =
    !!selectedEvent?.id &&
    (isEmail || isListServ || isDraft) &&
    !hasEnded;

  const normalizeEventId = (id) => {
    const value = String(id || "").trim();
    if (!value) return "";
    if (value.startsWith("email:")) return value.slice("email:".length);
    return value;
  };

  const selectedEventIds = new Set([
    String(selectedEvent?.id || "").trim(),
    normalizeEventId(selectedEvent?.id),
  ]);

  const updateEventNudgeStatus = (eventId, nextStatus) => {
    const targetId = String(eventId || "").trim();
    const normalizedTargetId = normalizeEventId(targetId);
    if (!targetId) return;

    setEvents((prev) =>
      (prev || []).map((ev) => {
        const currentId = String(ev?.id || "").trim();
        const normalizedCurrentId = normalizeEventId(currentId);
        const matches =
          currentId === targetId ||
          normalizedCurrentId === normalizedTargetId;
        if (!matches) return ev;

        return {
          ...ev,
          extendedProps: {
            ...(ev.extendedProps || {}),
            nudgeDisplayStatus: nextStatus,
          },
        };
      })
    );

    setSelectedEvent((prev) => {
      if (!prev) return prev;
      const currentId = String(prev?.id || "").trim();
      const normalizedCurrentId = normalizeEventId(currentId);
      const matches =
        currentId === targetId ||
        normalizedCurrentId === normalizedTargetId;
      if (!matches) return prev;

      // Preserve FullCalendar EventApi instances; spreading them strips prototype getters.
      if (typeof prev.setExtendedProp === "function") {
        prev.setExtendedProp("nudgeDisplayStatus", nextStatus);
        return prev;
      }

      return {
        ...prev,
        extendedProps: {
          ...(prev.extendedProps || {}),
          nudgeDisplayStatus: nextStatus,
        },
      };
    });

    const api = calendarRef?.current?.getApi?.();
    if (!api) return;
    const candidates = Array.from(
      new Set([targetId, normalizedTargetId].filter(Boolean))
    );
    candidates.forEach((id) => {
      const fcEvent = api.getEventById(id);
      if (fcEvent) {
        fcEvent.setExtendedProp("nudgeDisplayStatus", nextStatus);
      }

      // eventDidMount applies inline styles for pending/accepted.
      // Clear/apply those inline styles immediately so status changes
      // are visible without waiting for a full remount.
      const safeId = String(id).replace(/"/g, '\\"');
      const eventEls = document.querySelectorAll(
        `.fc-event[data-event-id="${safeId}"]`
      );
      eventEls.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (nextStatus === "pending") {
          el.style.border = "1px dashed #6d28d9";
          return;
        }
        if (nextStatus === "accepted") {
          el.style.border = "none";
          return;
        }
        // "none" (or any fallback) should drop the pending dotted outline.
        el.style.border = "none";
      });
    });
  };

  const acceptedInviterEntries = Array.from(
    new Map(
      (Array.isArray(user?.acceptedNudges) ? user.acceptedNudges : [])
        .filter((entry) => {
          const entryId = String(entry?.id || "").trim();
          const normalizedEntryId = normalizeEventId(entryId);
          return (
            selectedEventIds.has(entryId) ||
            selectedEventIds.has(normalizedEntryId)
          );
        })
        .map((entry) => {
          const email = String(entry?.email || "").trim().toLowerCase();
          const name = String(entry?.name || "").trim();
          return [email, { email, name }];
        })
        .filter(([email]) => Boolean(email)),
    ).values()
  );

  const pendingInviterEntries = Array.from(
    new Map(
      (Array.isArray(user?.invitedEvents) ? user.invitedEvents : [])
        .filter((entry) => {
          const entryId = String(entry?.id || "").trim();
          const normalizedEntryId = normalizeEventId(entryId);
          return selectedEventIds.has(entryId) || selectedEventIds.has(normalizedEntryId);
        })
        .map((entry) => {
          const email = String(entry?.email || "").trim().toLowerCase();
          const name = String(entry?.name || "").trim();
          return [email, { email, name }];
        })
        .filter(([email]) => Boolean(email)),
    ).values()
  );

  const acceptedYourNudgePeople = Array.from(
    new Set(
      (Array.isArray(selectedEvent?.extendedProps?.acceptedByNames) &&
      selectedEvent.extendedProps.acceptedByNames.length > 0
        ? selectedEvent.extendedProps.acceptedByNames
        : Array.isArray(selectedEvent?.extendedProps?.acceptedByEmails)
          ? selectedEvent.extendedProps.acceptedByEmails
        : []
      )
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  const pendingInviterEmails = new Set(
    pendingInviterEntries.map((entry) => entry.email)
  );
  const hasPendingInviters = pendingInviterEntries.length > 0;
  const canRespondInline = hasPendingInviters;
  const acceptedInviterEmails = new Set(
    acceptedInviterEntries.map((entry) => entry.email)
  );

  const inviterByEmail = new Map();
  const addInviter = (email, name = "") => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) return;
    const cleanedName = String(name || "").trim();
    const existing = inviterByEmail.get(normalizedEmail);
    if (!existing) {
      inviterByEmail.set(normalizedEmail, {
        email: normalizedEmail,
        name: cleanedName,
      });
      return;
    }
    if (!existing.name && cleanedName) {
      inviterByEmail.set(normalizedEmail, {
        ...existing,
        name: cleanedName,
      });
    }
  };

  (selectedEventInviters || []).forEach((email) => addInviter(email, ""));
  pendingInviterEntries.forEach((entry) => addInviter(entry.email, entry.name));
  acceptedInviterEntries.forEach((entry) => addInviter(entry.email, entry.name));
  const displayInviters = Array.from(inviterByEmail.values()).filter(
    (inviter) => !optimisticallyRemovedInviters.has(inviter.email)
  );
  const visiblePendingInviterEmails = new Set(
    Array.from(pendingInviterEmails).filter(
      (email) => !optimisticallyRemovedInviters.has(email)
    )
  );

  // Format date and time
  const formatTime = (date) => {
    return new Date(date)
      .toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
      .toLowerCase();
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Use the same green as the "Free Food" tag for all pill accents
  const freeFoodGreen = tagColorMap?.["Free Food"] || "#d4e9c4";
  const getTagColor = () => freeFoodGreen;

  const handleNudgeSubmit = async (e) => {
    e.preventDefault();
    // Also add any leftover typed email as a recipient before submitting
    const finalRecipients = [...nudgeRecipients];
    const leftover = nudgeEmail.trim();
    if (leftover && leftover.includes("@")) {
      const lower = leftover.toLowerCase();
      if (!finalRecipients.some((r) => r.email.toLowerCase() === lower)) {
        finalRecipients.push({ email: leftover, displayName: leftover });
      }
    }
    if (!selectedEvent?.id || finalRecipients.length === 0) return;

    try {
      setNudgeLoading(true);
      const results = await Promise.allSettled(
        finalRecipients.map((r) =>
          api.nudgeEvent({ eventId: selectedEvent.id, targetEmail: r.email }),
        ),
      );
      const succeeded = results.filter(
        (r) => r.status === "fulfilled" && r.value?.success,
      ).length;
      const successfulEmails = finalRecipients
        .filter((_, i) => results[i].status === "fulfilled" && results[i].value?.success)
        .map(r => r.email);
      
      // Collect error messages for failed nudges
      const failedResults = results
        .map((r, i) => ({ result: r, email: finalRecipients[i].email }))
        .filter(({ result }) => result.status !== "fulfilled" || !result.value?.success);
      const errorMessages = failedResults.map(({ result, email }) => {
        const errorMsg = result.status === "fulfilled" && result.value?.error 
          ? result.value.error 
          : "Unknown error";
        return `${email}: ${errorMsg}`;
      });

      // Save successful emails to session storage for autofill
      if (successfulEmails.length > 0) {
        addToPreviouslyNudged(successfulEmails);
      }

      // Show inline success message instead of browser alert
      setNudgeSuccess({ 
        emails: successfulEmails, 
        total: finalRecipients.length,
        errors: errorMessages 
      });
      setNudgeEmail("");
      setNudgeRecipients([]);
      setShowNudgeForm(false);
    } catch (error) {
      setNudgeSuccess({ emails: [], total: finalRecipients.length, error: true });
    } finally {
      setNudgeLoading(false);
    }
  };

  const closeDetails = () => {
    if (onClose) {
      onClose();
    } else {
      setSelectedEvent(null);
      setEventDetailsSource("calendar");
      setSelectedEventInviters([]);
    }
  };

  const respondToInvite = async (action, inviterEmail = "") => {
    if (!selectedEvent?.id) return;
    const eventId = selectedEvent.id;
    const previousStatus = selectedEvent?.extendedProps?.nudgeDisplayStatus || "none";
    const normalizedInviterEmail = String(inviterEmail || "").trim().toLowerCase();
    if (!normalizedInviterEmail) {
      alert("Please respond to a specific inviter email.");
      return;
    }
    const decliningSingleInviter = action === "decline" && !!normalizedInviterEmail;
    const declinedInviterWasPending = visiblePendingInviterEmails.has(normalizedInviterEmail);
    const shouldOptimisticallyRemove = decliningSingleInviter && declinedInviterWasPending;
    if (shouldOptimisticallyRemove) {
      setOptimisticallyRemovedInviters((prev) => {
        const next = new Set(prev);
        next.add(normalizedInviterEmail);
        return next;
      });
    }
    const remainingPendingAfterDecline = decliningSingleInviter
      ? Math.max(0, visiblePendingInviterEmails.size - (declinedInviterWasPending ? 1 : 0))
      : 0;
    const optimisticStatus =
      action === "accept"
        ? "accepted"
        : action === "decline"
          ? remainingPendingAfterDecline > 0
            ? "pending"
            : acceptedInviterEmails.size > 0
              ? "accepted"
              : "none"
          : previousStatus;

    if (optimisticStatus !== previousStatus) {
      updateEventNudgeStatus(eventId, optimisticStatus);
    }

    try {
      setInviteResponseLoading(true);
      const result = await api.respondToInvite({
        eventId,
        action,
        inviterEmail: normalizedInviterEmail || undefined,
      });

      if (!result?.success) {
        if (shouldOptimisticallyRemove) {
          setOptimisticallyRemovedInviters((prev) => {
            const next = new Set(prev);
            next.delete(normalizedInviterEmail);
            return next;
          });
        }
        if (optimisticStatus !== previousStatus) {
          updateEventNudgeStatus(eventId, previousStatus);
        }
        alert(result?.error || "Failed to update invited event");
        return;
      }

      setUserInviteState({
        invitedEvents: result?.invitedEvents || [],
        acceptedNudges: result?.acceptedNudges || [],
      });
      // Keep the card open for inviter-specific responses so users can
      // accept/decline multiple inviters in one pass.
      if (!normalizedInviterEmail && (action === "decline" || action === "accept")) {
        closeDetails();
      }
    } catch (error) {
      if (shouldOptimisticallyRemove) {
        setOptimisticallyRemovedInviters((prev) => {
          const next = new Set(prev);
          next.delete(normalizedInviterEmail);
          return next;
        });
      }
      if (optimisticStatus !== previousStatus) {
        updateEventNudgeStatus(eventId, previousStatus);
      }
      alert("Failed to update invited event");
    } finally {
      setInviteResponseLoading(false);
    }
  };

  return (
    <div className="event-details-card">
      {/* Header with colored background */}
      <div className="event-details-header">
        <h3 className="event-details-title">
          {selectedEvent.title || "(No title)"}
        </h3>
        <button
          className="close-panel-button"
          onClick={closeDetails}
          aria-label="Close"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={freeFoodGreen}
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      {/* Separator line */}
      <div className="event-details-separator"></div>

      {displayInviters.length > 0 && (
        <div className="event-details-inviters">
          <div className="event-details-inviters-label">
            {hasPendingInviters
              ? "Invited by:"
            : acceptedInviterEmails.size > 0
                ? "Accepted nudges from:"
                : "Invited by:"}
          </div>
          <div className="event-details-inviters-list">
            {displayInviters.map((inviter) => {
              const email = inviter.email;
              const displayName = inviter.name || email;
              const isPending = visiblePendingInviterEmails.has(email);
              return (
                <span key={email} className="event-details-inviter-entry">
                  <span className="event-details-inviter-email">{displayName}</span>
                  {canRespondInline && isPending && (
                    <span className="event-details-inline-invite-actions">
                      <button
                        type="button"
                        className="event-inline-invite-button event-inline-invite-button-decline"
                        aria-label={`Decline invite from ${displayName}`}
                        title={`Decline invite from ${displayName}`}
                        onClick={() => respondToInvite("decline", email)}
                        disabled={inviteResponseLoading}
                      >
                        X
                      </button>
                      <button
                        type="button"
                        className="event-inline-invite-button event-inline-invite-button-accept"
                        aria-label={`Accept invite from ${displayName}`}
                        title={`Accept invite from ${displayName}`}
                        onClick={() => respondToInvite("accept", email)}
                        disabled={inviteResponseLoading}
                      >
                        ✓
                      </button>
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {acceptedYourNudgePeople.length > 0 && (
        <div className="event-details-inviters">
          <span className="event-details-inviters-label">Accepted your nudge:</span>{" "}
          <span>{acceptedYourNudgePeople.join(", ")}</span>
        </div>
      )}

      {/* Event details */}
      <div className="event-details-content">
        {selectedEvent.extendedProps?.organization && (
          <div className="event-details-row">
            <svg
              className="event-details-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1e1e1e"
              strokeWidth="2"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span className="event-details-text">
              {selectedEvent.extendedProps.organization}
            </span>
          </div>
        )}

        <div className="event-details-row">
          <svg
            className="event-details-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#1e1e1e"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <div className="event-details-time-group">
            {selectedEvent.start && selectedEvent.end && (
              <>
                {!selectedEvent.allDay && (
                  <div className="event-details-text">
                    {formatTime(selectedEvent.start)} -{" "}
                    {formatTime(selectedEvent.end)}
                  </div>
                )}
                <div className="event-details-text">
                  {formatDate(selectedEvent.start)}
                </div>
              </>
            )}
          </div>
        </div>

        {selectedEvent.extendedProps?.location && (
          <div className="event-details-row">
            <svg
              className="event-details-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="#1d1b20"
            >
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"></path>
            </svg>
            <span className="event-details-text">
              {selectedEvent.extendedProps.location}
            </span>
          </div>
        )}

        {selectedEvent.extendedProps?.description && (
          <div className="event-details-row">
            <svg
              className="event-details-icon"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1e1e1e"
              strokeWidth="1.5"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <span className="event-details-text">
              {selectedEvent.extendedProps.description}
            </span>
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
              <svg
                className="event-details-icon"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#1e1e1e"
                strokeWidth="2"
              >
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                <line x1="7" y1="7" x2="7.01" y2="7"></line>
              </svg>
              <div className="event-tags-container">
                {selectedEvent.extendedProps.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="event-tag"
                    style={{
                      backgroundColor: getTagColor(),
                      borderColor: getTagColor(),
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
      </div>

      {canNudge && (
        <div className="event-details-actions">
          {nudgeSuccess && (
            <div className={`nudge-success-message ${nudgeSuccess.error || (nudgeSuccess.errors?.length > 0 && nudgeSuccess.emails.length === 0) ? 'nudge-error' : nudgeSuccess.errors?.length > 0 ? 'nudge-partial' : ''}`}>
              <div className="nudge-message-content">
                {nudgeSuccess.error ? (
                  <span>Failed to send nudge. Please try again.</span>
                ) : nudgeSuccess.emails.length === nudgeSuccess.total ? (
                  <span>
                    Nudge successfully sent to{' '}
                    <strong>{nudgeSuccess.emails.join(', ')}</strong>
                  </span>
                ) : nudgeSuccess.emails.length > 0 ? (
                  <span>
                    Nudge sent to <strong>{nudgeSuccess.emails.join(', ')}</strong>
                  </span>
                ) : nudgeSuccess.errors?.length > 0 ? (
                  <span className="nudge-error-title">Nudge failed</span>
                ) : null}
                {nudgeSuccess.errors?.length > 0 && (
                  <div className="nudge-error-details">
                    {nudgeSuccess.errors.map((err, i) => (
                      <div key={i} className="nudge-error-item">{err}</div>
                    ))}
                  </div>
                )}
              </div>
              <button 
                type="button" 
                className="nudge-success-dismiss"
                onClick={() => setNudgeSuccess(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
          {!showNudgeForm ? (
            <button
              type="button"
              className="event-action-button"
              onClick={() => {
                setShowNudgeForm(true);
                setNudgeSuccess(null);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              Nudge
            </button>
          ) : (
              <form className="event-nudge-form" onSubmit={handleNudgeSubmit}>
                <div className="event-nudge-autocomplete">
                  <div
                    className="event-nudge-chips-container"
                    onClick={() => inputRef.current?.focus()}
                  >
                    {nudgeRecipients.map((r) => (
                      <span key={r.email} className="event-nudge-chip">
                        <span className="event-nudge-chip-label">
                          {r.displayName === r.email ? r.email : r.displayName}
                        </span>
                        <button
                          type="button"
                          className="event-nudge-chip-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecipient(r.email);
                          }}
                          aria-label={`Remove ${r.displayName}`}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    <input
                      ref={inputRef}
                      type="text"
                      className="event-nudge-chip-input"
                      placeholder={
                        nudgeRecipients.length === 0
                          ? "Search name or enter email"
                          : ""
                      }
                      value={nudgeEmail}
                      onChange={(e) => {
                        setNudgeEmail(e.target.value);
                        searchPeople(e.target.value);
                      }}
                      onKeyDown={handleInputKeyDown}
                      onFocus={() => {
                        if (suggestions.length > 0) setShowSuggestions(true);
                      }}
                      autoComplete="off"
                    />
                  </div>
                  {showSuggestions && suggestions.length > 0 && (
                    <ul
                      className="event-nudge-suggestions"
                      ref={suggestionsRef}
                    >
                      {suggestions.map((s, i) => (
                        <li
                          key={s.email}
                          className={`event-nudge-suggestion-item${i === activeSuggestionIndex ? " active" : ""}`}
                          onMouseDown={(e) => {
                            // Prevent global outside-click handlers from closing the card.
                            e.preventDefault();
                            e.stopPropagation();
                            handleSuggestionClick(s);
                          }}
                          onMouseEnter={() => setActiveSuggestionIndex(i)}
                        >
                          <span className="suggestion-name">
                            {s.displayName}
                          </span>
                          <span className="suggestion-email">{s.email}</span>
                          {s.isPreviouslyNudged && (
                            <span className="previously-nudged-badge">Nudged before</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="event-nudge-actions">
                  <button
                    type="button"
                    className="event-action-button event-action-button-secondary"
                    onClick={() => {
                      setShowNudgeForm(false);
                      setNudgeEmail("");
                      setNudgeRecipients([]);
                    }}
                    disabled={nudgeLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="event-action-button"
                    disabled={
                      nudgeLoading ||
                      (nudgeRecipients.length === 0 &&
                        !nudgeEmail.trim().includes("@"))
                    }
                  >
                    {nudgeLoading ? "Sending..." : "Submit"}
                  </button>
                </div>
              </form>
            )}
          </div>
      )}
    </div>
  );
};

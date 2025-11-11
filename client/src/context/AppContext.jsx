// src/context/AppContext.jsx
import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";

import { api } from "../api/calendarApi";
import { useCategories } from "../hooks/useCategories";
import { useMemoizedCounts } from "../utils/memoizedCounts";

export const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  /* -------------------------------------------------
     1️⃣  GLOBAL STATE (unchanged)
     ------------------------------------------------- */
  const [user, setUser] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [visibleCalendars, setVisibleCalendars] = useState(new Set());
  const [listservCalendarId, setListservCalendarId] = useState(null);
  const [events, setEvents] = useState([]);

  const { availableCats, fetchCategories } = useCategories(); // ← custom hook
  const [selectedCats, setSelectedCats] = useState(new Set());

  const [activeFilters, setActiveFilters] = useState(new Set());

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectionInfo, setSelectionInfo] = useState(null);
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    location: "",
    allDay: false,
  });
  const [selectedEvent, setSelectedEvent] = useState(null);

  const calendarRef = useRef(null); // shared ref (used by handleCreateEvent)

  /* -------------------------------------------------
     2️⃣  DERIVED VALUES
     ------------------------------------------------- */
  const categoriesParam = useMemo(() => {
    if (!selectedCats.size) return "";
    const s = Array.from(selectedCats).join(",");
    return `&categories=${encodeURIComponent(s)}`;
  }, [selectedCats]);

  const categoryCounts = useMemoizedCounts(events, listservCalendarId);

  /* -------------------------------------------------
     3️⃣  AUTH HELPERS
     ------------------------------------------------- */
  const fetchMe = async () => {
    const data = await api.fetchMe();
    setUser(data.user);
  };
  const login = () => (window.location.href = "/auth/google");
  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    setEvents([]);
  };

  /* -------------------------------------------------
     4️⃣  CALENDAR / EVENT FETCHING (unchanged)
     ------------------------------------------------- */
  const fetchCalendars = async () => {
    const data = await api.fetchCalendars();
    const items = data.calendars || [];
    setCalendars(items);

    // Find ListServ calendar id (if present)
    const ls = items.find(
      (c) => c.summary?.toLowerCase() === "listserv events"
    );
    if (ls) setListservCalendarId(ls.id);

    // Default visible calendars: primary + ListServ (fallback to “primary”)
    const defaults = items
      .filter(
        (c) => c.primary || c.summary?.toLowerCase() === "listserv events"
      )
      .map((c) => c.id);
    if (!defaults.length) defaults.push("primary");
    setVisibleCalendars(new Set(defaults));

    // Load events for the defaults
    await fetchEvents(defaults);
  };

  const fetchWorkingCalendar = async () => {
    const data = await api.fetchWorkingCalendar();
    if (data?.id) setListservCalendarId(data.id);
  };

  const fetchEvents = useCallback(
    async (calendarIds) => {
      const ids = calendarIds || Array.from(visibleCalendars);
      const base =
        ids.length > 0
          ? `?calendarIds=${encodeURIComponent(ids.join(","))}`
          : "?";
      const url = `/api/events${base}${categoriesParam}`;
      console.log("🔎 fetchEvents →", url);
      const data = await api.fetchEvents({ calendarIds: ids, categoriesParam });

      const transformed = (data.events || []).map((ev) => ({
        ...ev,
        extendedProps: {
          description: ev.description ?? "",
          location: ev.location ?? "",
          source: ev.source,
          calendarId: ev.calendarId ?? null,
          filter: ev.filter ?? ev.tag ?? null,
          categories: ev.categories ?? [],
        },
      }));
      setEvents(transformed);
    },
    [visibleCalendars, categoriesParam]
  );

  /* -------------------------------------------------
     5️⃣  EVENT‑CREATION / PUBLISH / DELETE HELPERS
     ------------------------------------------------- */
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
      // create draft → publish immediately
      const draftRes = await fetch("/api/drafts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const draftData = await draftRes.json();
      if (draftData.id) {
        await fetch(
          `/api/events/${encodeURIComponent(draftData.id)}/publish`,
          { method: "POST", credentials: "include" }
        );
      } else {
        alert("Failed to create draft");
      }
    } else {
      // just save as draft
      await fetch("/api/drafts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    // UI clean‑up
    setCreateModalOpen(false);
    setSelectionInfo(null);
    setEventForm({ title: "", description: "", location: "", allDay: false });
    if (calendarRef.current?.getApi) {
      calendarRef.current.getApi().unselect();
    }
    await fetchEvents(Array.from(visibleCalendars));
  };

  const handlePublishEvent = async () => {
    const id = selectedEvent?.id;
    if (!id?.startsWith("draft:")) return;
    const res = await fetch(
      `/api/events/${encodeURIComponent(id)}/publish`,
      { method: "POST", credentials: "include" }
    );
    if (!res.ok) alert("Failed to publish event");
    else {
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

  /* -------------------------------------------------
     6️⃣  EFFECTS – orchestrate loading order
     ------------------------------------------------- */

  // 6.1 Load the current user *once* when the app mounts
  useEffect(() => {
    fetchMe(); // sets `user` → triggers the next effect
    // 👉 Do NOT call fetchCategories() here – we don't have a session yet
  }, []); // empty deps → run only on mount

  // 6.2 When `user` becomes truthy, load everything that needs authentication
  useEffect(() => {
    if (user) {
      // a) calendars + working‑calendar info
      fetchCalendars();
      fetchWorkingCalendar();

      // b) category bubbles – `fetchCategories` expects the user (or we could just call it without args if the hook already checks `user` internally)
      fetchCategories(user);
    } else {
      // user logged out → clear all data
      setCalendars([]);
      setVisibleCalendars(new Set());
      setEvents([]);
      setListservCalendarId(null);
      // No need to call fetchCategories(null) – the hook already clears its state when `user` is falsy
    }
  }, [user, fetchCategories]); // `fetchCategories` should be memoised (useCallback) inside the hook

  // 6.3 Refetch events when the selected category filter changes
  useEffect(() => {
    if (user) {
      fetchEvents(Array.from(visibleCalendars));
    }
  }, [categoriesParam, user, visibleCalendars, fetchEvents]);

  /* -------------------------------------------------
     7️⃣  CONTEXT VALUE
     ------------------------------------------------- */
  const contextValue = {
    // auth
    user,
    login,
    logout,

    // calendars
    calendars,
    visibleCalendars,
    toggleCalendar: async (calId) => {
      const newSet = new Set(visibleCalendars);
      newSet.has(calId) ? newSet.delete(calId) : newSet.add(calId);
      setVisibleCalendars(newSet);
      await fetchEvents(Array.from(newSet));
    },
    listservCalendarId,

    // events
    events,
    fetchEvents,
    categoriesParam,

    // category bubbles
    availableCats,
    selectedCats,
    setSelectedCats,
    categoryCounts,

    // old filter UI (if still used)
    activeFilters,
    setActiveFilters,

    // modal / form
    createModalOpen,
    setCreateModalOpen,
    selectionInfo,
    setSelectionInfo,
    eventForm,
    setEventForm,
    selectedEvent,
    setSelectedEvent,

    // shared ref for the calendar (used by handleCreateEvent)
    calendarRef,

    // event‑action helpers
    handleCreateEvent,
    handlePublishEvent,
    handleDeleteEvent,
  };

  return (
    <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
  );
};
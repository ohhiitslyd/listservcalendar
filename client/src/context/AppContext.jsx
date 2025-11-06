// src/context/AppContext.jsx
import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useMemo, // <-- added
} from "react";

import { api } from "../api/calendarApi";
import { useCategories } from "../hooks/useCategories";
import { useMemoizedCounts } from "../utils/memoizedCounts";

/* --------------------------------------------------------------
   Create the context – any component that calls `useContext(AppContext)`
   will receive the object we expose below.
   -------------------------------------------------------------- */
export const AppContext = createContext(null);

/* --------------------------------------------------------------
   Provider component – holds **all** global state and actions.
   -------------------------------------------------------------- */
export const AppProvider = ({ children }) => {
  // ---------- Auth ----------
  const [user, setUser] = useState(null);

  // ---------- Calendars ----------
  const [calendars, setCalendars] = useState([]);
  const [visibleCalendars, setVisibleCalendars = useState(new Set());
  const [listservCalendarId, setListservCalendarId] = useState(null);

  // ---------- Events ----------
  const [events, setEvents] = useState([]);

  // ---------- Category bubbles ----------
  const { availableCats, fetchCategories } = useCategories(); // loads from /api/event-categories
  const [selectedCats, setSelectedCats] = useState(new Set());

  // ---------- Old‑style filters (still used in a few places) ----------
  const [activeFilters, setActiveFilters] = useState(new Set());

  // ---------- Modal & form state ----------
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectionInfo, setSelectionInfo] = useState(null);
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    location: "",
    allDay: false,
  });
  const [selectedEvent, setSelectedEvent] = useState(null);

  // ---------- Helper: query‑string for category filtering ----------
  const categoriesParam = useMemo(() => {
    if (!selectedCats.size) return "";
    const s = Array.from(selectedCats).join(",");
    return `&categories=${encodeURIComponent(s)}`;
  }, [selectedCats]);

  // ---------- Memoised count of events per category (bubble badges) ----------
  const categoryCounts = useMemoizedCounts(events, listservCalendarId);

  // -----------------------------------------------------------------
  // Auth helpers
  // -----------------------------------------------------------------
  const fetchMe = async () => {
    const data = await api.fetchMe();
    setUser(data.user);
  };

  const login = () => {
    window.location.href = "/auth/google";
  };
  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
 setEvents([]);
  };

  // -----------------------------------------------------------------
  // Calendar fetching
  // -----------------------------------------------------------------
  const fetchCalendars = async () => {
    const data = await api.fetchCalendars();
    const items = data.calendars || [];
    setCalendars(items);

    // ---- find ListServ calendar id (if it exists) ----
    const ls =items.find(
      (c) => c.summary?.toLowerCase() === "listserv events"
    );
    if (ls) setListservCalendarId(ls.id);

    // ---- default visible calendars: primary + ListServ (if any) ----
    const defaults = items
      .filter(
        (c) => c.primary || c.summary?.toLowerCase() === "listserv events"
      )
      .map((c) => c.id);

    if (!defaults.length) defaults.push("primary"); // fallback

    setVisibleCalendars(new Set(defaults));

    // ---- fetch events for the default set of calendars ----
    await fetchEvents(defaults);
  };

  // -----------------------------------------------------------------
  // Optional: fetch the working calendar (used only to set ListServ id)
  // -----------------------------------------------------------------
  const fetchWorkingCalendar = async () => {
    const data = await api.fetchWorkingCalendar();
    if (data?.id) setListservCalendarId(data.id);
  };

  // -----------------------------------------------------------------
  // Event fetching (includes optional category filter)
  // -----------------------------------------------------------------
  const fetchEvents = useCallback(
    async (calendarIds) => {
      const ids = calendarIds || Array.from(visibleCalendars);
      const base =
        ids.length > 0
          ? `?calendarIds=${encodeURIComponent(ids.join(","))}`
          : "?"; // keep leading ? for categoriesParam
      const url = `/api/events${base}${categoriesParam}`;
      const data = await api.fetchEvents({ calendarIds: ids, categoriesParam });

      // Transform events for FullCalendar – keep extendedProps intact
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

  // -----------------------------------------------------------------
  // Re‑fetch events when selected categories change
  // -----------------------------------------------------------------
  useEffect(() => {
    if (user) {
      fetchEvents(Array.from(visibleCalendars));
    }
  }, [categoriesParam, user, visibleCalendars, fetchEvents]);

  // -----------------------------------------------------------------
  // Initial load auth + category list
  // -----------------------------------------------------------------
  useEffect(() => {
    fetchMe();
    fetchCategories(); // load bubble categories once
  }, []);

  // -----------------------------------------------------------------
  // Load calendars & ListServ info when a user becomes available
  // -----------------------------------------------------------------
  useEffect(() => {
    if (user) {
      fetchCalendars();
      fetchWorkingCalendar();
    } else {
      // clear everything on logout
      setCalendars([]);
      setVisibleCalendars(new Set());
      setEvents([]);
      setListservCalendarId(null);
    }
  }, [user]);

  // -----------------------------------------------------------------
  // Helper to toggle calendar visibility
  // -----------------------------------------------------------------
  const toggleCalendar = async (calId) => {
    const newSet = new Set(visibleCalendars);
    if (newSet.has(calId)) newSet.delete(calId);
    else newSet.add(calId);

    setVisibleCalendars(newSet);
    await fetchEvents(Array.from(newSet));
  };

  // -----------------------------------------------------------------
  // Build the context value that will be provided to children
  // -----------------------------------------------------------------
  const contextValue = {
    // auth
    user,
    login,
    logout,
    // calendars
    calendars,
    visibleCalendars,
    toggleCalendar,
    listservCalendarId,
    // events
    events,
    fetchEvents,
    // category bubbles
    availableCats,
    selectedCats,
    setSelectedCats,
    categoryCounts,
    // old filter UI
    activeFilters,
    setActiveFilters,
    // modal & form
    createModalOpen,
    setCreateModalOpen,
    selectionInfo,
    setSelectionInfo,
    eventForm,
    setEventForm,
    selectedEvent,
    setSelectedEvent,
    // misc
    // (you can add weeklyCounts, etc., here if you need them elsewhere)
  };

  (
    <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
  );
};
// src/context/AppContext.jsx
import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";

import { api } from "../api/calendarApi";
import { useCategories } from "../hooks/useCategories";
import { useMemoizedCounts } from "../utils/memoizedCounts";

export const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  // ---- Auth ----
  const [user, setUser] = useState(null);

  // ---- Calendars ----
  const [calendars, setCalendars] = useState([]);
  const [visibleCalendars, setVisibleCalendars] = useState(new Set());
  const [listservCalendarId, setListservCalendarId] = useState(null);

  // ---- Events ----
  const [events, setEvents] = useState([]);

  // ---- Category bubbles ----
  const { availableCats, fetchCategories } = useCategories();
  const [selectedCats, setSelectedCats] = useState(new Set());

  // ---- Old‑style filters (still used somewhere) ----
  const [activeFilters, setActiveFilters] = useState(new Set());

  // ---- Modal / form ----
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectionInfo, setSelectionInfo] = useState(null);
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    location: "",
    allDay: false,
  });
  const [selectedEvent, setSelectedEvent] = useState(null);

  // ---- Derived helpers ----------
  const categoriesParam = useMemo(() => {
    if (!selectedCats.size) return "";
    const s = Array.from(selectedCats).join(",");
    return `&categories=${encodeURIComponent(s)}`;
  }, [selectedCats]);

  const categoryCounts = useMemoizedCounts(events, listservCalendarId);

  // ---- Auth helpers ----
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

  // ---- Calendar helpers ----
  const fetchCalendars = async () => {
    const data = await api.fetchCalendars();
    const items = data.calendars || [];
    setCalendars(items);

    // find ListServ id
    const ls = items.find(
      (c) => c.summary?.toLowerCase() === "listserv events"
    );
    if (ls) setListservCalendarId(ls.id);

    // default visible calendars (primary + ListServ)
    const defaults = items
      .filter(
        (c) => c.primary || c.summary?.toLowerCase() === "listserv events"
      )
      .map((c) => c.id);
    if (!defaults.length) defaults.push("primary");
    setVisibleCalendars(new Set(defaults));

    await fetchEvents(defaults);
  };

  const fetchWorkingCalendar = async () => {
    const data = await api.fetchWorkingCalendar();
    if (data?.id) setListservCalendarId(data.id);
  };

  // ---- Event fetching ----
  const fetchEvents = useCallback(
    async (calendarIds) => {
      const ids = calendarIds || Array.from(visibleCalendars);
      const base =
        ids.length > 0
          ? `?calendarIds=${encodeURIComponent(ids.join(","))}`
          : "?";
      const url = `/api/events${base}${categoriesParam}`;
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

  // -----------------------------------------------------------------
  // Effects
  // -----------------------------------------------------------------
  // 1️⃣ Load user & categories on mount
  useEffect(() => {
    fetchMe();
  }, []);

  // 2️⃣ Load categories *after* we know the user (auth cookie present)
  useEffect(() => {
    if (user) {
      fetchCategories(user);
    } else {
      // optional clear when logged out
      fetchCategories(null);
    }
  }, [user, fetchCategories]);

  // 3️⃣ When user becomes known, load calendars & working calendar
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

  // 4️⃣ Refetch events when the category filter changes
  useEffect(() => {
    if (user) fetchEvents(Array.from(visibleCalendars));
  }, [categoriesParam, user, visibleCalendars, fetchEvents]);

  // -----------------------------------------------------------------
  // Helper to toggle calendar visibility
  // -----------------------------------------------------------------
  const toggleCalendar = async (calId) => {
    const newSet = new Set(visibleCalendars);
    newSet.has(calId) ? newSet.delete(calId) : newSet.add(calId);
    setVisibleCalendars(newSet);
    await fetchEvents(Array.from(newSet));
  };

  // -----------------------------------------------------------------
  // Build the context value
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

    // categories (bubbles)
    availableCats,
    selectedCats,
    setSelectedCats,
    categoryCounts,

    // old filters
    activeFilters,
    setActiveFilters,

    // modal / form state
    createModalOpen,
    setCreateModalOpen,
    selectionInfo,
    setSelectionInfo,
    eventForm,
    setEventForm,
    selectedEvent,
    setSelectedEvent,
  };

  return (
    <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
  );
};
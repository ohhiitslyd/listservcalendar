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
  // Holds ALL events for the current visible calendars (NO category filter).
  const [allEventsForCounts, setAllEventsForCounts] = useState([]);

  // NEW: date range for the current calendar view (start/end of the week)
  // We’ll use this to filter which events are counted in the bubbles.
  const [currentViewRange, setCurrentViewRange] = useState(null);

  const { availableCats, fetchCategories } = useCategories(); // ← custom hook
  const [selectedCats, setSelectedCats] = useState(new Set());

  // --- Org categories (type/subtype/org) ---
  const [availableOrgCats, setAvailableOrgCats] = useState([]);
  const [selectedOrgCats, setSelectedOrgCats] = useState(new Set());
  // negative filter mode (exclude selected filters instead of include)
  const [excludeMode, setExcludeMode] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  const [activeFilters, setActiveFilters] = useState(new Set());

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectionInfo, setSelectionInfo] = useState(null);
  const [eventForm, setEventForm] = useState({
    title: "",
    organization: "",
    location: "",
    allDay: false,
    description: "",
    tags: "", // We'll use a comma-separated string for the input
    poster_url: "",
  });
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventDetailsSource, setEventDetailsSource] = useState("calendar");
  const [selectedEventInviters, setSelectedEventInviters] = useState([]);
  const [focusEventRequest, setFocusEventRequest] = useState(null);

  const calendarRef = useRef(null); // shared ref (used by handleCreateEvent)

  /* -------------------------------------------------
     2️⃣  DERIVED VALUES
     ------------------------------------------------- */
  const categoriesParam = useMemo(() => {
    if (!selectedCats.size) return "";
    const s = Array.from(selectedCats).join(",");
    return `&categories=${encodeURIComponent(s)}`;
  }, [selectedCats]);

  const orgCategoriesParam = useMemo(() => {
    if (!selectedOrgCats.size) return "";
    const s = Array.from(selectedOrgCats).join(",");
    return `&orgCategories=${encodeURIComponent(s)}`;
  }, [selectedOrgCats]);

  // if excludeMode is on, tell backend to invert the filter match
  const excludeParam = useMemo(() => {
    return excludeMode ? "&exclude=1" : "";
  }, [excludeMode]);

  // whose start time falls within the current view’s date range
  const weekFilteredEventsForCounts = useMemo(() => {
    // If we don’t yet know the view range, just use all events
    if (!currentViewRange) return allEventsForCounts;

    const { start, end } = currentViewRange;
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();

    return (allEventsForCounts || []).filter((ev) => {
      // `ev.start` is a string like "2025-03-10T10:00:00Z" or "2025-03-10"
      if (!ev.start) return false;
      const evStartMs = new Date(ev.start).getTime();
      return evStartMs >= startMs && evStartMs < endMs;
    });
  }, [allEventsForCounts, currentViewRange]);

  // Use the *week-filtered* events when computing category counts
  const categoryCounts = useMemoizedCounts(
    weekFilteredEventsForCounts,
    listservCalendarId
  );

  // Use the *same* week-filtered events for org counts
  const orgCategoryCounts = useMemo(() => {
    const counts = {};
    const lsId = listservCalendarId;

    (weekFilteredEventsForCounts || []).forEach((ev) => {
      // Count only ListServ events: drafts, email-sourced, or Google Calendar listserv events
      const isListServGoogle = ev.source === "google" && ev.calendarId === lsId;
      const isListServDraft = ev.source === "draft";
      const isListServEmail = ev.source === "email";
      const isListServ = isListServGoogle || isListServDraft || isListServEmail;
      if (!isListServ) return;

      const keys = ev?.extendedProps?.orgCategories || ev.orgCategories || [];
      keys.forEach((k) => {
        counts[k] = (counts[k] || 0) + 1;
      });
    });

    return counts;
  }, [weekFilteredEventsForCounts, listservCalendarId]);

  // Build org hierarchy in context (so we can filter events globally by org emails)
  const orgHierarchy = useMemo(() => {
    const hierarchy = {};
    if (!availableOrgCats || !Array.isArray(availableOrgCats)) return hierarchy;

    // Step 1: types
    availableOrgCats.forEach((cat) => {
      if (!cat?.key) return;
      const parts = cat.key.split(":");
      const level =
        cat.level ||
        (parts.length === 1 ? "type" : parts.length === 2 ? "subcategory" : "organization");

      if (level === "type") {
        hierarchy[cat.key] = {
          key: cat.key,
          label: cat.label,
          level: "type",
          subcategories: {},
          count: orgCategoryCounts[cat.key] || 0,
        };
      }
    });

    // Step 2: subcategories
    availableOrgCats.forEach((cat) => {
      if (!cat?.key) return;
      const parts = cat.key.split(":");
      const level =
        cat.level ||
        (parts.length === 1 ? "type" : parts.length === 2 ? "subcategory" : "organization");

      if (level === "subcategory") {
        const [typeKey] = parts;

        if (!hierarchy[typeKey]) {
          hierarchy[typeKey] = {
            key: typeKey,
            label: typeKey,
            level: "type",
            subcategories: {},
            count: 0,
          };
        }

        const subLabel = cat.label?.includes(" • ") ? cat.label.split(" • ")[1] : cat.label;

        if (!hierarchy[typeKey].subcategories[cat.key]) {
          hierarchy[typeKey].subcategories[cat.key] = {
            key: cat.key,
            label: subLabel || cat.key,
            level: "subcategory",
            organizations: {},
            count: orgCategoryCounts[cat.key] || 0,
          };
        }
      }
    });

    // Step 3: organizations (leaf nodes) + emails
    availableOrgCats.forEach((cat) => {
      if (!cat?.key) return;
      const parts = cat.key.split(":");
      const level =
        cat.level ||
        (parts.length === 1 ? "type" : parts.length === 2 ? "subcategory" : "organization");

      if (level !== "organization") return;
      if (parts.length < 3) return;

      const [typeKey, subKey] = parts;
      const subKeyFull = `${typeKey}:${subKey}`;

      if (!hierarchy[typeKey]) {
        hierarchy[typeKey] = {
          key: typeKey,
          label: typeKey,
          level: "type",
          subcategories: {},
          count: 0,
        };
      }

      if (!hierarchy[typeKey].subcategories[subKeyFull]) {
        hierarchy[typeKey].subcategories[subKeyFull] = {
          key: subKeyFull,
          label: subKey,
          level: "subcategory",
          organizations: {},
          count: 0,
        };
      }

      if (!hierarchy[typeKey].subcategories[subKeyFull].organizations[cat.key]) {
        hierarchy[typeKey].subcategories[subKeyFull].organizations[cat.key] = {
          key: cat.key,
          label: cat.label,
          level: "organization",
          count: orgCategoryCounts[cat.key] || 0,
          emails: Array.isArray(cat.emails) ? cat.emails : [], // ✅ important
        };
      }
    });

    // Aggregate parent counts from leaf nodes
    Object.values(hierarchy).forEach((type) => {
      let typeCount = 0;
      Object.values(type.subcategories).forEach((sub) => {
        let subCount = 0;
        Object.values(sub.organizations).forEach((org) => {
          subCount += org.count || 0;
        });
        sub.count = subCount;
        typeCount += subCount;
      });
      type.count = typeCount;
    });

    return hierarchy;
  }, [availableOrgCats, orgCategoryCounts]);

  // Legend mapping for EVENT TYPE TAG → color (shared with event coloring)
  // These correspond to `ev.tags` values like "Free Food", "Performance", etc.
  const tagColorMap = useMemo(() => {
    return {
      "Free Food": "#d4e9c4",
      "Performance": "#c7d9f5",
      "Lecture/Speaker": "#ddd6fe",
      "Mixer": "#f5d7c7",
      "Workshop": "#fed7aa",
      "Giveaway/Compensation": "#fce7f3",
      "Recurring Meetings": "#cffafe",
      "Philanthropy": "#e9f5c7",
      "Screening": "#e0e7ff",
      "Off-campus": "#fecaca",
      "21+": "#ccfbf1",
      "Sport": "#faccba",
      "Religious/Spiritual": "#e9ddff",
    };
  }, []);

  // UI-level filtering: if org filters are selected, only show listserv events
  // whose organization_email matches the selected org emails
  const filteredEvents = useMemo(() => {
    // Build allowed emails set from selected org leaf nodes
    const allowed = new Set();

    Object.values(orgHierarchy || {}).forEach((type) => {
      Object.values(type.subcategories || {}).forEach((sub) => {
        Object.values(sub.organizations || {}).forEach((org) => {
          if (selectedOrgCats.has(org.key)) {
            (org.emails || []).forEach((e) => {
              const norm = String(e || "").trim().toLowerCase();
              if (norm) allowed.add(norm);
            });
          }
        });
      });
    });

    const orgFilterActive = allowed.size > 0;
    if (!orgFilterActive) return events;

    const lsId = listservCalendarId;

    return (events || []).filter((ev) => {
      const isListServGoogle = ev?.extendedProps?.source === "google" && ev?.extendedProps?.calendarId === lsId;
      const isListServDraft = ev?.extendedProps?.source === "draft";
      const isListServEmail = ev?.extendedProps?.source === "email";
      const isListServ = isListServGoogle || isListServDraft || isListServEmail;

      // Only restrict listserv events; keep other calendars visible
      if (!isListServ) return true;

      const evtEmail = String(ev.organization_email || ev?.extendedProps?.organization_email || "")
        .trim()
        .toLowerCase();

      return evtEmail && allowed.has(evtEmail);
    });
  }, [events, orgHierarchy, selectedOrgCats, listservCalendarId]);

  /* -------------------------------------------------
     3️⃣  AUTH HELPERS
     ------------------------------------------------- */
  const fetchMe = async () => {
    const data = await api.fetchMe();
    setUser(data.user);
  };
  const setUserInviteState = ({ invitedEvents, acceptedNudges } = {}) => {
    setUser((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        invitedEvents: Array.isArray(invitedEvents)
          ? invitedEvents
          : Array.isArray(prev.invitedEvents)
            ? prev.invitedEvents
            : [],
        acceptedNudges: Array.isArray(acceptedNudges)
          ? acceptedNudges
          : Array.isArray(prev.acceptedNudges)
            ? prev.acceptedNudges
            : [],
      };
    });
  };

  const requestFocusEvent = (
    eventId,
    inviterEmails = [],
    detailsSource = "nudge_received"
  ) => {
    setFocusEventRequest({
      eventId,
      inviterEmails: Array.isArray(inviterEmails) ? inviterEmails : [],
      detailsSource,
      requestedAt: Date.now(),
    });
  };

  const clearFocusEventRequest = () => setFocusEventRequest(null);

  // Read ?event= param from URL (for share link deep-linking)
  const [sharedEventId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("event") || sessionStorage.getItem("listserv_pending_event") || null;
  });

  const login = () => {
    // Preserve share link event ID across OAuth redirect
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("event");
    if (eventId) sessionStorage.setItem("listserv_pending_event", eventId);
    window.location.href = "/auth/google";
  };
  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    setEvents([]);
    setSelectedEvent(null); // Clear selected event when logging out
    setEventDetailsSource("calendar");
    setSelectedEventInviters([]);
    setFocusEventRequest(null);
    // Preferences will be cleared in the useEffect when user becomes null
  };

  /* -------------------------------------------------
     4️⃣  CALENDAR / EVENT FETCHING (unchanged)
     ------------------------------------------------- */
  const fetchCalendars = async () => {
    const data = await api.fetchCalendars();
    const items = data.calendars || [];
    console.log("[AppContext] /api/calendars returned:", items);
    setCalendars(items);

    // Find ListServ calendar id (if present)
    const ls = items.find(
      (c) => c.summary?.toLowerCase() === "listserv events"
    );
    if (ls) {
      console.log("[AppContext] Detected ListServ calendar:", ls.id);
      setListservCalendarId(ls.id);
    }

    // Robustly determine the primary calendar:
    // 1) explicit `primary` flag from Google
    // 2) id or summary matching the user's email (common for primary)
    // 3) fall back to the first calendar if nothing else matches
    let primaryCal =
      items.find((c) => c.primary) || null;

    if (!primaryCal && user?.email) {
      primaryCal =
        items.find(
          (c) =>
            c.id === user.email ||
            c.summary === user.email
        ) || null;
    }

    if (!primaryCal && items.length > 0) {
      primaryCal = items[0];
    }

    console.log("[AppContext] Resolved primary calendar:", primaryCal);

    // Default visible calendars: primary (if we have one) + ListServ
    const defaultsSet = new Set();
    if (primaryCal?.id) {
      defaultsSet.add(primaryCal.id);
    }
    if (ls?.id) {
      defaultsSet.add(ls.id);
    }

    // Final safety fallback – make sure we always have at least one id
    if (defaultsSet.size === 0) {
      defaultsSet.add("primary");
    }

    const defaults = Array.from(defaultsSet);
    console.log("[AppContext] Default visible calendars:", defaults);
    setVisibleCalendars(defaultsSet);
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
      const url = `/api/events${base}${categoriesParam}${orgCategoriesParam}${excludeParam}`;
      console.log("🔎 fetchEvents →", url);
      const data = await api.fetchEvents({
        calendarIds: ids,
        categoriesParam,
        orgCategoriesParam,
        excludeParam,
      });

      const transformed = (data.events || []).map((ev) => {
        // Listserv events: drafts, email-sourced, or Google Calendar listserv events
        const isListServ =
          ev.calendarId === listservCalendarId ||
          ev.source === "draft" ||
          ev.source === "email";
        let className = isListServ ? "fc-event-listserv" : "fc-event-other";

        return {
          ...ev,
          className,
          // We handle visual coloring in Calendar.jsx based on tags + tagColorMap
          textColor: "#000000", // Always use black text for better readability
          extendedProps: {
            organization: ev.organization ?? "",
            tags: ev.tags ?? [],
            poster_url: ev.poster_url ?? "",
            description: ev.description ?? "",
            location: ev.location ?? "",
            source: ev.source,
            calendarId: ev.calendarId ?? null,
            filter: ev.filter ?? ev.tag ?? null,
            orgCategories: ev.orgCategories ?? [],
            nudgeDisplayStatus: ev.nudgeDisplayStatus || "none",
            acceptedByEmails: ev.acceptedByEmails ?? [],
            acceptedByNames: ev.acceptedByNames ?? [],
          },
        };
      });
      setEvents(transformed);
    },
    [visibleCalendars, categoriesParam, orgCategoriesParam, excludeParam, listservCalendarId]
  );

  // Refetch events with explicit filter params (used right after Apply filters so we use the selected values, not stale state)
  const refetchEventsWithParams = useCallback(
    async (orgCatsArray, eventTypesArray, exclude) => {
      const ids = Array.from(visibleCalendars);
      const base = ids.length > 0 ? `?calendarIds=${encodeURIComponent(ids.join(","))}` : "?";
      const catParam = Array.isArray(eventTypesArray) && eventTypesArray.length > 0
        ? `&categories=${encodeURIComponent(eventTypesArray.join(","))}`
        : "";
      const orgParam = Array.isArray(orgCatsArray) && orgCatsArray.length > 0
        ? `&orgCategories=${encodeURIComponent(orgCatsArray.join(","))}`
        : "";
      const excParam = exclude ? "&exclude=1" : "";
      const url = `/api/events${base}${catParam}${orgParam}${excParam}`;
      console.log("🔎 refetchEventsWithParams →", url);
      const data = await api.fetchEvents({
        calendarIds: ids,
        categoriesParam: catParam,
        orgCategoriesParam: orgParam,
        excludeParam: excParam,
      });
      const transformed = (data.events || []).map((ev) => ({
        ...ev,
        className: ev.calendarId === listservCalendarId || ev.source === "draft" || ev.source === "email" ? "fc-event-listserv" : "fc-event-other",
        extendedProps: {
          ...ev.extendedProps,
          organization: ev.organization ?? "",
          tags: ev.tags ?? [],
          orgCategories: ev.orgCategories ?? [],
          nudgeDisplayStatus: ev.nudgeDisplayStatus || "none",
          acceptedByEmails: ev.acceptedByEmails ?? [],
          acceptedByNames: ev.acceptedByNames ?? [],
        },
      }));
      setEvents(transformed);
    },
    [visibleCalendars, listservCalendarId]
  );

  // Fetch events for counts ONLY (NO categoriesParam). This keeps a stable, unfiltered snapshot.
  const fetchEventsForCounts = useCallback(
    async (calendarIds) => {
    const ids = calendarIds || Array.from(visibleCalendars);
    const base =
      ids.length > 0
        ? `?calendarIds=${encodeURIComponent(ids.join(","))}`
        : "?";

    const url = `/api/events${base}`;
      console.log("🔎 fetchEventsForCounts →", url);

    const data = await api.fetchEvents({ calendarIds: ids });

    const transformed = (data.events || []).map((ev) => ({
      ...ev,
      extendedProps: {
        description: ev.description ?? "",
        location: ev.location ?? "",
        source: ev.source,
        calendarId: ev.calendarId ?? null,
        filter: ev.filter ?? ev.tag ?? null,
        tags: ev.tags ?? [],
        orgCategories: ev.orgCategories ?? [],
        nudgeDisplayStatus: ev.nudgeDisplayStatus || "none",
        acceptedByEmails: ev.acceptedByEmails ?? [],
        acceptedByNames: ev.acceptedByNames ?? [],
      },
    }));

    setAllEventsForCounts(transformed);
    },
    [visibleCalendars]
  );

  /* -------------------------------------------------
     5️⃣  EVENT‑CREATION / PUBLISH / DELETE HELPERS
     ------------------------------------------------- */
  const handleCreateEvent = async (publishImmediately = false) => {
    const body = {
      title: eventForm.title || "",
      organization: eventForm.organization || "",
      location: eventForm.location || "",
      description: eventForm.description || "",
      tags: eventForm.tags
        ? eventForm.tags.split(",").map((t) => t.trim())
        : [],
      poster_url: eventForm.poster_url || "",
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
        await fetch(`/api/events/${encodeURIComponent(draftData.id)}/publish`, {
            method: "POST",
            credentials: "include",
        });
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
    setEventForm({
      title: "",
      organization: "",
      location: "",
      description: "",
      tags: "",
      poster_url: "",
      allDay: false,
    });
    if (calendarRef.current?.getApi) {
      calendarRef.current.getApi().unselect();
    }
    await fetchEvents(Array.from(visibleCalendars));
  };

  const handlePublishEvent = async () => {
    const id = selectedEvent?.id;
    if (!id?.startsWith("draft:")) return;
    const res = await fetch(`/api/events/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      credentials: "include",
    });
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
  // Preferences are loaded FIRST so that event fetches use the correct filters.
  useEffect(() => {
    if (user) {
      (async () => {
        // a) Load saved user preferences BEFORE fetching events
        try {
          const prefsData = await api.fetchPreferences();
          if (prefsData?.preferences && typeof prefsData.preferences === "object") {
            setExcludeMode(!!prefsData.preferences.excludeMode);
          }
          if (prefsData.organizationPreference && Array.isArray(prefsData.organizationPreference) && prefsData.organizationPreference.length > 0) {
            setSelectedOrgCats(new Set(prefsData.organizationPreference));
          }
          if (prefsData.eventTypePreference && Array.isArray(prefsData.eventTypePreference) && prefsData.eventTypePreference.length > 0) {
            setSelectedCats(new Set(prefsData.eventTypePreference));
          }
        } catch (error) {
          console.error("Failed to load user preferences:", error);
        }
        setPreferencesLoaded(true);

        // b) Now load calendars, categories, and org categories
    fetchCalendars();
    fetchWorkingCalendar();
    fetchCategories(user);

      try {
        const res = await fetch("/api/org-categories", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
            setAvailableOrgCats(data.categories || data.orgCategories || []);
        } else {
          setAvailableOrgCats([]);
        }
      } catch {
        setAvailableOrgCats([]);
      }
    })();
    } else {
      // user logged out → clear all data
      setCalendars([]);
      setVisibleCalendars(new Set());
      setEvents([]);
      setListservCalendarId(null);
      setAllEventsForCounts([]);
      setSelectedEvent(null);
      setEventDetailsSource("calendar");
      setSelectedEventInviters([]);
      setFocusEventRequest(null);
      setSelectedOrgCats(new Set());
      setSelectedCats(new Set());
      setExcludeMode(false);
      setPreferencesLoaded(false);
    }
  }, [user, fetchCategories]);

  // 6.2 B Maintain the unfiltered snapshot for counts (no dependency on categoriesParam).
  useEffect(() => {
    if (user) {
      fetchEventsForCounts(Array.from(visibleCalendars));
    } else {
      setAllEventsForCounts([]);
    }
  }, [user, visibleCalendars, fetchEventsForCounts]);

  // 6.3 Refetch events when the selected category filter changes
  // Wait for preferences to be loaded so the first fetch uses correct filters.
  useEffect(() => {
    if (user && preferencesLoaded) {
      fetchEvents(Array.from(visibleCalendars));
    }
  }, [
    categoriesParam,
    orgCategoriesParam,
    excludeParam,
    user,
    preferencesLoaded,
    visibleCalendars,
    fetchEvents,
  ]);

  // 6.4 Deep-link: open shared event after login + initial data load
  const sharedEventHandledRef = useRef(false);
  useEffect(() => {
    if (!user || !preferencesLoaded || sharedEventHandledRef.current) return;

    // Check URL param first, then sessionStorage
    const params = new URLSearchParams(window.location.search);
    let pendingEventId = params.get("event");
    if (!pendingEventId) {
      pendingEventId = sessionStorage.getItem("listserv_pending_event");
    }
    if (!pendingEventId) return;

    sharedEventHandledRef.current = true;
    sessionStorage.removeItem("listserv_pending_event");

    // Clean the URL without reload
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("event");
    window.history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search);

    // Fetch the event directly from the public API instead of searching
    // FullCalendar's list (the event may not be in the current view/filters)
    (async () => {
      try {
        const resp = await fetch(`/api/events/${encodeURIComponent(pendingEventId)}/info`);
        if (!resp.ok) return;
        const data = await resp.json();
        setSelectedEvent({
          id: data.id,
          title: data.title || "(Event)",
          start: data.start,
          end: data.end,
          allDay: data.allDay,
          extendedProps: {
            organization: data.organization || "",
            location: data.location || "",
            description: data.description || "",
            poster_url: data.posterUrl || "",
            source: "email",
            tags: [],
          },
        });
        setEventDetailsSource("share_link");
      } catch {
        // Silently fail — user can still browse normally
      }
    })();
  }, [user, preferencesLoaded]);

  /* -------------------------------------------------
     7️⃣  CONTEXT VALUE
     ------------------------------------------------- */
  const contextValue = {
    // auth
    user,
    login,
    logout,
    sharedEventId,

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
    // UI-level filtered events (org-filtered listserv events; primary/other cals always included)
    filteredEvents,
    setEvents,
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
    eventDetailsSource,
    setEventDetailsSource,
    selectedEventInviters,
    setSelectedEventInviters,
    focusEventRequest,
    requestFocusEvent,
    clearFocusEventRequest,
    setUserInviteState,

    // shared ref for the calendar (used by handleCreateEvent)
    calendarRef,

    // event‑action helpers
    handleCreateEvent,
    handlePublishEvent,
    handleDeleteEvent,

    // organization
    availableOrgCats,
    selectedOrgCats,
    setSelectedOrgCats,
    orgCategoryCounts,
    orgHierarchy,
    tagColorMap,
    refetchEventsWithParams, 

    currentViewRange,
    setCurrentViewRange,

    // negative filtering toggle
    excludeMode,
    setExcludeMode,

    // preferences loading state
    preferencesLoaded,
  };

  return (
    <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
  );
};

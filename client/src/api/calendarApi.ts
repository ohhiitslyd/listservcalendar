/**
 * ------------------------------------------------------------
 * Centralised API helpers – one place to tweak headers, auth,
 * base‑url, error handling, etc.
 * ------------------------------------------------------------
 */
type Calendar = {
  id: string;
  summary?: string;
  primary?: boolean;
};

type Event = {
  id: string;
  title?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  source?: string;
  calendarId?: string;
  filter?: string;
  tag?: string;
  categories?: string[];
  orgCategories?: string[]; 
  organization?: string;
  tags?: string[];
  poster_url?: string;
  // any other fields you get from the backend
};

type Draft = {
  id: string;
  // whatever the backend returns
};

type MeResponse = {
  user: any; // replace with your real User type
};

type CalendarsResponse = {
  calendars: Calendar[];
};

type EventsResponse = {
  events: Event[];
};

type CategoriesResponse = {
  categories: { key: string; label?: string; description?: string }[];
};

type OrgCategoriesResponse = {
  categories: { key: string; label?: string; level?: string }[];
};

/**
 * All API calls return a **Promise** resolves to the parsed JSON
 * (or the raw `Response` for calls that don’t have a JSON body).
 */
export const api = {
  /* -----------------------------------------------------------------
   * Auth
   * ----------------------------------------------------------------- */
  fetchMe: async (): Promise<MeResponse> =>
    fetch("/api/me", { credentials: "include" }).then(r => r.json()),

  /* -----------------------------------------------------------------
   * Calendars
   * ----------------------------------------------------------------- */
  fetchCalendars: async (): Promise<CalendarsResponse> =>
    fetch("/api/calendars", { credentials: "include" }).then(r => r.json()),

  fetchWorkingCalendar: async (): Promise<{ id?: string }> =>
    fetch("/api/calendar", { credentials: "include" }).then(r => r.json()),

  /* -----------------------------------------------------------------
  * Events – optional `categoriesParam` and `orgCategoriesParam` are
  * pre-built query fragments, e.g. `&categories=Finance&orgCategories=music:a_cappella`
  * ----------------------------------------------------------------- */
  fetchEvents: async ({
    calendarIds = [],
    categoriesParam = "",
    orgCategoriesParam = "",
    excludeParam = "",
  }: {
    calendarIds?: string[];
    categoriesParam?: string;
    orgCategoriesParam?: string; 
    excludeParam?: string;
  } = {}): Promise<EventsResponse> => {
    // Build calendarIds query without over-encoding commas, so the server
    // can safely split on ",". Individual IDs are safe as-is.
    const idsQuery = calendarIds.length
      ? `?calendarIds=${calendarIds.join(",")}`
      : "?";

    // IMPORTANT: append both params if present
    const url = `/api/events${idsQuery}${categoriesParam}${orgCategoriesParam}${excludeParam}`;

    return fetch(url, { credentials: "include" }).then((r) => r.json());
  },

  /* -----------------------------------------------------------------
   * Drafts
   * ----------------------------------------------------------------- */
  createDraft: async (data: Partial<Event>): Promise<Draft> =>
    fetch("/api/drafts", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(r => r.json()),

  publishDraft: async (draftId: string): Promise<Response> =>
    fetch(`/api/events/${encodeURIComponent(draftId)}/publish`, {
      method: "POST",
      credentials: "include",
    }),

  deleteEvent: async (eventId: string): Promise<Response> =>
    fetch(`/api/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      credentials: "include",
    }),

  /* -----------------------------------------------------------------
   * Event categories (the “bubbles” used for filtering)
   * ----------------------------------------------------------------- */
  fetchCategories: async (): Promise<CategoriesResponse> =>
    fetch("/api/event-categories", { credentials: "include" }).then(r =>
      r.json()
    ),
  /* -----------------------------------------------------------------
  * Organization categories (type / subcategory / org)
  * ----------------------------------------------------------------- */
  fetchOrgCategories: async (): Promise<OrgCategoriesResponse> =>
    fetch("/api/org-categories", { credentials: "include" }).then((r) =>
      r.json()
    ),

  /* -----------------------------------------------------------------
   * User Preferences
   * ----------------------------------------------------------------- */
  updatePreferences: async ({
    organizationPreference,
    eventTypePreference,
    excludeMode,
  }: {
    organizationPreference?: string[];
    eventTypePreference?: string[];
    excludeMode?: boolean;
  }): Promise<any> => {
    const body: any = {
      organizationPreference,
      eventTypePreference,
    };
    
    // Always include excludeMode in preferences if provided (even if false)
    if (excludeMode !== undefined) {
      body.preferences = { excludeMode };
    }
    
    const response = await fetch("/api/user/preferences", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Failed to update preferences" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return response.json();
  },

  fetchPreferences: async (): Promise<{
    preferences: any;
    organizationPreference: string[];
    eventTypePreference: string[];
  }> =>
    fetch("/api/user/preferences", { credentials: "include" }).then((r) =>
      r.json()
    ),

  /* -----------------------------------------------------------------
   * Sync Calendar by Preferences
   * Optional `dryRun` flag returns counts only without modifying GCal.
   * ----------------------------------------------------------------- */
  syncCalendarByPreferences: async ({ dryRun = false }: { dryRun?: boolean } = {}): Promise<{
    success: boolean;
    published: number;
    deleted: number;
    totalMatching: number;
    message: string;
    publishResults?: Array<{
      eventId: string;
      action: string;
      googleEventId?: string;
      error?: string;
    }>;
    deleteResults?: Array<{
      googleEventId: string;
      title?: string;
      action: string;
      reason?: string;
      error?: string;
    }>;
  }> =>
    fetch(`/api/user/sync-calendar-by-preferences${dryRun ? "?dryRun=true" : ""}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    }).then((r) => r.json()),
};
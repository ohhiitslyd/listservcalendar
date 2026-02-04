# ListServ Calendar – App & Calendar System Architecture

This document explains how the application and calendar system work end-to-end: entry points, state, components, API, and server.

---

## 1. High-Level Overview

The app is a **React (Vite) frontend** that talks to a **Node/Express backend**. The backend uses **PostgreSQL (Neon)** for events and user preferences, and **Google Calendar API** for the user’s calendars and a personalized “ListServ Events” calendar.

**Main flows:**

- **Auth:** Google OAuth → session → `user` in context → everything else gated on `user`.
- **Events:** Fetched from **PostgreSQL** (drafts + email-sourced events) and **Google Calendar** (primary + ListServ), then merged and filtered by org/event-type and exclude mode.
- **Filters:** Org categories + event types + exclude mode. Selection is stored in context; “Apply filters” saves preferences and syncs the ListServ Google calendar to match.
- **Create/Publish/Delete:** Create draft in DB → optionally publish to ListServ Google calendar; delete from DB and (if published) from Google.

---

## 2. Entry Points & App Structure

### Client

| File | Role |
|------|------|
| `client/index.html` | Single HTML shell; root div for React. |
| `client/src/main.jsx` | Renders `<App />` into the root div. |
| `client/src/App.jsx` | Wraps the app in `<AppProvider>` and renders `InnerApp`. Defines calendar handlers (`onSelect`, `onEventClick`, `onDatesSet`) and passes them to `<Calendar>`. Renders `Header`, `Calendar`, `EventDetails`, `CreateEventModal`. |

**Component tree:**

```
App
└── AppProvider (context)
    └── InnerApp
        ├── Header          (logo, Filters dropdown, My Calendars, user, Refresh, Log out)
        ├── app-content
        │   ├── Calendar    (FullCalendar + DateBar)
        │   └── EventDetails (right panel)
        ├── app-footer
        └── CreateEventModal (create event form)
```

### Server

| File | Role |
|------|------|
| `server/index.js` | Express app: auth routes, API routes, Google OAuth, session, static serve. Loads `db.js` and defines all `/api/*` and `/auth/*` routes. |
| `server/db.js` | PostgreSQL pool, migrations (tables, columns), and helpers like `query`, `queryOne`, `execute`. |

---

## 3. Client State & Context (`AppContext.jsx`)

All global UI and data state lives in **`client/src/context/AppContext.jsx`**.

### 3.1 State (useState)

- **Auth:** `user`
- **Calendars:** `calendars`, `visibleCalendars`, `listservCalendarId`
- **Events:** `events` (what the calendar shows), `allEventsForCounts` (unfiltered, for filter bubble counts)
- **View:** `currentViewRange` (start/end of visible week/day)
- **Categories:** `availableCats` (from `useCategories`), `selectedCats`, `availableOrgCats`, `selectedOrgCats`, `excludeMode`
- **Legacy:** `activeFilters`
- **Modals / selection:** `createModalOpen`, `selectionInfo`, `eventForm`, `selectedEvent`
- **Ref:** `calendarRef` (FullCalendar API)

### 3.2 Derived Values (useMemo)

- **Query params for API:** `categoriesParam`, `orgCategoriesParam`, `excludeParam`
- **Events in view for counts:** `weekFilteredEventsForCounts` (from `allEventsForCounts` + `currentViewRange`)
- **Counts:** `categoryCounts` (event-type tags), `orgCategoryCounts` (org category keys)
- **Org hierarchy:** `orgHierarchy` (for Filters UI: types → subcategories → organizations)

### 3.3 Key Functions (useCallback)

- **Auth:** `login`, `logout`
- **Events:**  
  - `fetchEvents(calendarIds)` – GET `/api/events` with current `categoriesParam`, `orgCategoriesParam`, `excludeParam`; transforms and `setEvents`.  
  - `refetchEventsWithParams(orgCatsArray, eventTypesArray, exclude)` – same but with explicit params (used by Filters for live preview and Apply).  
  - `fetchEventsForCounts(calendarIds)` – GET `/api/events` with no filter params; used only to fill `allEventsForCounts` for bubble counts.
- **Event actions:** `handleCreateEvent(publishImmediately)`, `handlePublishEvent`, `handleDeleteEvent`

### 3.4 Effects (useEffect)

- **On mount:** `fetchMe()` → sets `user`.
- **When `user` is set:** fetch calendars, working calendar, categories, org categories, user preferences; apply preferences to `selectedOrgCats`, `selectedCats`, `excludeMode`. On logout, clear calendars, events, and filter state.
- **When `user` + `visibleCalendars`:** `fetchEventsForCounts` to refresh unfiltered events for counts.
- **When filter params or `visibleCalendars` change:** `fetchEvents` to refresh the calendar.

Everything above is exposed via **`contextValue`** and consumed by components and hooks.

---

## 4. Client Components

### 4.1 Header (`components/Header/Header.jsx`)

- **Not logged in:** Logo + “Sign in with Google” (`login` from context).
- **Logged in:** Logo, **Filters** button (toggles dropdown with `<Filters />`), **My Calendars** dropdown (`toggleCalendar`), user name/avatar, Refresh, Log out.
- Uses local state `filtersDropdownOpen`, `calendarsDropdownOpen` and click-outside refs to close dropdowns.
- Filter badge count = `selectedCats.size + selectedOrgCats.size`.

### 4.2 Filters (`components/Filters/Filters.jsx`)

- **Tabs:** Organizations | Event Types. **Clear All** resets pending selection.
- **Pending state:** `pendingSelectedCats`, `pendingSelectedOrgCats`, `pendingExcludeMode` (local). Synced from context on mount; on **unmount** (dropdown close), pending is committed back to context so reopening keeps the same checkboxes.
- **Live preview:** When pending state changes, `refetchEventsWithParams` is called so the calendar updates immediately.
- **Apply filters:** Commits pending → context, clears events and calls `refetchEventsWithParams`, saves preferences via `api.updatePreferences`, then calls `api.syncCalendarByPreferences` (syncs ListServ Google calendar to current selection). Uses `pendingExcludeMode` when saving.
- **Org hierarchy:** Built from `availableOrgCats` and `orgCategoryCounts`; types → subcategories → organizations with checkboxes and counts.

### 4.3 Calendar (`components/Calendar/Calendar.jsx`)

- **FullCalendar** with `dayGridPlugin`, `timeGridPlugin`, `interactionPlugin`.
- **Props from App:** `onSelect` (date range → open create modal), `onEventClick` (select event for details), `onDatesSet` (store view range in context).
- **Data:** `events` from context (already transformed for FullCalendar with `extendedProps`, `className`, colors).
- **Ref:** `calendarRef` passed to FullCalendar; used by App for create/publish and by DateBar.
- **useEvents:** `applyFiltersToCalendar(api)` runs after render to set event `display` based on `activeFilters` (legacy tag filtering).

### 4.4 DateBar (`components/DateBar/DateBar.jsx`)

- Reads `calendarRef` and `currentViewRange` from context.
- Shows current week/day range (e.g. “Jan 25 – 31, 2026”) and Week/Day view buttons; calls FullCalendar API to change view/dates.

### 4.5 EventDetails (`components/EventDetails/EventDetails.jsx`)

- **No selection:** “Click an event to see its details.”
- **With `selectedEvent`:** Title, org, time, date, location, description; **Publish** (if draft), **Delete**, close.
- **Publish/Delete** call `handlePublishEvent` / `handleDeleteEvent` from context (which call API then `fetchEvents`).

### 4.6 CreateEventModal (`components/CreateEventModal/CreateEventModal.jsx`)

- Form: title, organization, location, description, tags, poster URL, all-day. Uses `eventForm` and `selectionInfo` from context.
- **Save as draft** or **Create & publish** call `handleCreateEvent(false)` or `handleCreateEvent(true)`.
- `handleCreateEvent`: POST `/api/drafts` with form body; if publish, then POST `/api/events/:id/publish`. Then close modal and `fetchEvents`.

---

## 5. API Layer (`api/calendarApi.ts`)

Single `api` object; all requests use `credentials: "include"` (session cookies).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `fetchMe` | GET `/api/me` | Current user |
| `fetchCalendars` | GET `/api/calendars` | User’s Google calendar list |
| `fetchWorkingCalendar` | GET `/api/calendar` | ListServ calendar id (create if needed) |
| `fetchEvents` | GET `/api/events?calendarIds=...&categories=...&orgCategories=...&exclude=1` | Merged + filtered events |
| `createDraft` | POST `/api/drafts` | Create draft event in DB |
| `publishDraft` | POST `/api/events/:id/publish` | Publish draft/email event to ListServ Google calendar |
| `deleteEvent` | DELETE `/api/events/:id` | Delete event (DB + Google if published) |
| `fetchCategories` | GET `/api/event-categories` | Event-type tags for filter tab |
| `fetchOrgCategories` | GET `/api/org-categories` | Org category tree (types, subcategories, orgs) |
| `updatePreferences` | PUT `/api/user/preferences` | Save org/event-type preferences and excludeMode |
| `fetchPreferences` | GET `/api/user/preferences` | Load saved preferences |
| `syncCalendarByPreferences` | POST `/api/user/sync-calendar-by-preferences` | Sync ListServ Google calendar to current preferences |

---

## 6. Hooks

| Hook | File | Purpose |
|------|------|--------|
| `useCategories` | `hooks/useCategories.js` | `availableCats`, `fetchCategories(user)`; calls `api.fetchCategories`. |
| `useCalendars` | `hooks/useCalendars.js` | (If used) calendar list and visibility. |
| `useEvents` | `hooks/useEvents.js` | `events`, `activeFilters`, `toggleFilter`, `clearFilters`, `applyFiltersToCalendar(api)` for legacy tag-based visibility on the calendar. |
| `useAuth` | `hooks/useAuth.js` | (If used) auth helpers. |

AppContext uses `useCategories` and `useMemoizedCounts`; Calendar uses `useEvents` for `applyFiltersToCalendar`.

---

## 7. Utils

| File | Purpose |
|------|--------|
| `utils/helpers.js` | e.g. `isGoogle(ev)`, `isCampus(ev)`, `getTag(ev)` for legacy filter display. |
| `utils/memoizedCounts.js` | `useMemoizedCounts(events, listservCalendarId)` → `{ [eventTypeTag]: count }` for ListServ events only. |

---

## 8. Server Overview

### 8.1 Auth & Session (`server/index.js`)

- **GET `/auth/google`** – Redirect to Google OAuth.
- **GET `/auth/google/callback`** – Exchange code, create/update user in DB, set `req.session.user`, redirect to app.
- **POST `/auth/logout`** – Destroy session.
- **GET `/api/me`** – Return `req.session.user` or 401.
- **Middleware:** `ensureAuthed` on all `/api/*` routes (except static).

### 8.2 Database (`server/db.js`)

- **Pool:** PostgreSQL (Neon) via `DATABASE_URL`.
- **Tables (conceptually):**  
  - **users** – id, email, name, picture_url, preferences (JSONB), organization_preference (TEXT[]), event_type_preference (TEXT[]).  
  - **events** – id, user_id, source (`manual`|`email`), email_id, title, description, location, organization, organization_email, event_tags (JSON text), poster_url, start, end, all_day, status (`draft`|`published`|…), google_event_id, etc.  
  - **scraped_emails** – for email ingestion.  
  - **app_settings**, **admin_tokens** – app/config and scraper OAuth.
- **Migrations:** Add columns (e.g. `organization_email`, `event_tags`) and migrate user preferences from JSONB to TEXT[].

### 8.3 Main API Routes (`server/index.js`)

- **User preferences:** GET/PUT `/api/user/preferences` (read/write organization_preference, event_type_preference, preferences.excludeMode).
- **Sync by preferences:** POST `/api/user/sync-calendar-by-preferences` – load user preferences, load email events from DB, filter by org/event-type/exclude, get/create ListServ calendar, then add/remove Google events so ListServ matches the filtered set.
- **Calendars:** GET `/api/calendars` (Google calendar list), GET `/api/calendar` (ListServ calendar id, create if missing).
- **Events:** GET `/api/events` – query params: `calendarIds`, `categories`, `orgCategories`, `exclude`. Fetches Google events for requested calendars, loads local events from DB (email + user’s drafts), merges, then filters by categories/org/exclude; adds `orgCategories` per event via `getOrgCategoriesFromEmail(organization_email)`. Returns `{ events }`.
- **Event types / org categories:** GET `/api/event-types`, GET `/api/event-categories`, GET `/api/org-categories` – return tags and org tree (from config/JSON files).
- **Drafts:** POST `/api/drafts` – insert event with source `manual`, status `draft`.
- **Publish:** POST `/api/events/:compoundId/publish` – load event from DB, call `publishEventToCalendar` (Google Calendar insert, store google_event_id, set status published).
- **Delete:** DELETE `/api/events/:compoundId` – delete from DB and, if published, from Google Calendar.

Other routes (scrape, email-events, clear calendar, etc.) support admin/ingestion and are not required for the core calendar UX.

### 8.4 Org / Filter Helpers (`server/index.js`)

- **ORG_CATEGORIES**, **ORG_FILTERS** – Loaded from `get_orgs/org_categories.json` and `get_orgs/org_filters.json`.
- **`toKey(s)`** – Normalize label to key (lowercase, spaces → underscores).
- **`buildAllowedOrgEmailSet(orgPrefs)`** – From preference keys like `type:all:orgKey`, resolve to org emails via ORG_FILTERS; returns Set of emails.
- **`getOrgCategoriesFromEmail(organizationEmail)`** – Look up org in ORG_FILTERS by email; return array of keys `typeKey:all:orgKey` for that org (used to attach `orgCategories` to each event in `/api/events`).

---

## 9. Data Flows (Summary)

### 9.1 Page Load (Logged In)

1. `fetchMe()` → `user` set.
2. Effect runs: fetch calendars, ListServ calendar id, categories, org categories, preferences; apply preferences to `selectedCats`, `selectedOrgCats`, `excludeMode`.
3. `fetchEventsForCounts` (no filters) → `allEventsForCounts` → `categoryCounts`, `orgCategoryCounts`.
4. `fetchEvents` (with filter params) → `events` → calendar and Filters show correct data and counts.

### 9.2 Changing Filters (Checkbox)

1. User toggles checkbox in Filters → pending state updates.
2. Effect in Filters runs → `refetchEventsWithParams(pendingOrgCats, pendingCats, pendingExclude)` → new `events` → calendar re-renders.
3. On dropdown close, Filters unmount → cleanup commits pending to context so next open shows same checkboxes.

### 9.3 Apply Filters

1. User clicks “Apply filters” → pending committed to context, `refetchEventsWithParams` with same params, `api.updatePreferences(...)`, `api.syncCalendarByPreferences()`.
2. Backend sync route reads preferences from DB, filters email events, then adds/removes events on the ListServ Google calendar so it matches the selected org/event-type/exclude set.

### 9.4 Create Event

1. User selects range on calendar → `handleSelect` → `setSelectionInfo`, `setEventForm`, `setCreateModalOpen(true)`.
2. User fills form and clicks Save (draft) or Create & publish → `handleCreateEvent(false)` or `(true)`.
3. POST `/api/drafts` → event inserted in DB with status `draft`. If publish, POST `/api/events/draft:xxx/publish` → event published to ListServ calendar, status and google_event_id updated in DB.
4. `fetchEvents` → calendar shows new event.

### 9.5 Publish / Delete from EventDetails

1. User clicks event → `handleEventClick` → `setSelectedEvent(ev)`.
2. EventDetails shows Publish (if draft) or Delete. Publish → `handlePublishEvent` → POST publish → `fetchEvents`. Delete → DELETE `/api/events/:id` (and Google if published) → `fetchEvents`.

---

## 10. File Reference (Quick Map)

| Area | Files |
|------|--------|
| **Entry** | `client/main.jsx`, `client/App.jsx`, `server/index.js`, `server/db.js` |
| **State & orchestration** | `client/src/context/AppContext.jsx` |
| **UI** | `Header`, `Calendar`, `DateBar`, `EventDetails`, `CreateEventModal`, `Filters` |
| **API** | `client/src/api/calendarApi.ts` |
| **Hooks** | `useCategories`, `useEvents`, `useCalendars`, `useAuth` |
| **Utils** | `helpers.js`, `memoizedCounts.js` |
| **Server routes** | All in `server/index.js`; DB schema and helpers in `server/db.js` |
| **Config / data** | `get_orgs/org_filters.json`, `get_orgs/org_categories.json`; server event-type descriptors as needed |

This should give you a single place to see how every part of the app and calendar system fits together.

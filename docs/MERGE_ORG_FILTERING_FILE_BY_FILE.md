# Merge main into org-filtering-from-177: File-by-file guide

Use this when you run `git merge main` (or `git merge origin/main` after fetching) and get conflicts. For each conflicted file, follow the resolution rule below so org-based filtering stays working.

---

## Files that differ on org-filtering-from-177 (vs main)

These are the 7 files your branch touches. When merging, **only some** of them may actually have conflict markers—conflicts happen only when **both** branches changed the **same lines**. The rest may auto-merge. Use this guide for any file that *does* conflict.

1. `server/db.js`
2. `server/index.js`
3. `server/services/calendarPublisher.js`
4. `client/src/api/calendarApi.ts`
5. `client/src/components/Filters/Filters.jsx`
6. `client/src/context/AppContext.jsx`
7. `get_orgs/org_categories.json`

---

## 1. `server/db.js`

**Branch (org-filtering) MUST KEEP:**
- Events table columns: `organization_email TEXT`, `tags TEXT` (not `event_tags` only).
- Migration: `ADD COLUMN IF NOT EXISTS organization_email TEXT`.

**Main might have:**
- Column named `event_tags` instead of (or in addition to) `tags`.
- Different or extra migrations.

**Resolution rule:**  
**Merge manually.** Keep the events table with both `organization_email` and `tags`. If main added `event_tags`, either keep both columns (and use `tags` for org-filtering and event-type tags) or standardize on one name everywhere and update server/index.js to match. Do **not** remove `organization_email` or the `tags` column if the frontend/API expect them.

---

## 2. `server/index.js`

This is the big one. Org-filtering logic is spread across several areas.

**Branch (org-filtering) MUST KEEP – do not delete or replace with main’s version:**

- **Sync-by-preferences / event matching (around ~391):**
  - `buildAllowedOrgEmailSet(orgPrefs)` and filtering events by `organization_email` + `allowedOrgEmails`.
  - Use of `event.organization_email` and `event.tags` (from DB/API).

- **GET /api/events (around ~860–945):**
  - Building `combined` from local events + Google events.
  - Local events: include `organization_email`, `tags` (from `e.organization_email`, `e.tags` – not `e.event_tags`).
  - Google events: include `organization_email`, `tags` from `extendedProperties.shared`.
  - Query params: `orgCatsParam = req.query.orgCategories`, `exclude`, `reqOrgKeys`, `allowedOrgEmails = buildAllowedOrgEmailSet(reqOrgKeys)`.
  - Filter logic: `isListServ(ev)`, `evtEmail` from `ev.organization_email`, `matchesOrg` using `allowedOrgEmails.has(evtEmail)`, and `exclude ? !matches : matches`.
  - Response: `res.json({ events: filtered })`.

- **Org categories block (around ~972–1135):**
  - `ORG_CATEGORIES_PATH`, `ORG_FILTERS_PATH`, loading `ORG_CATEGORIES` and `ORG_FILTERS` from JSON.
  - `toKey()`, `buildAllowedOrgEmailSet(orgPrefs)`.
  - **GET /api/org-categories** implementation that returns `{ categories: [...typeNodes, ...subcategoryNodes, ...orgNodes] }` built from `ORG_CATEGORIES` and `ORG_FILTERS` (type → subcategory “• Organizations” → org nodes with keys like `typeKey:all:orgKey`).

- **Email → events INSERT (around ~1590–1630):**
  - INSERT must include `organization_email` and `tags` columns (and values: e.g. sender email, tags JSON).
  - Call to `publishEventToCalendar` must pass `organizationEmail` (and any other org-related fields you use).

- **Publish single event (around ~1355–1375):**
  - Read `row.organization_email`, `row.tags` (not `row.event_tags` if your schema uses `tags`).
  - Pass `organizationEmail` and `organizationTags` (if you add them) into `publishEventToCalendar`.

**Main might have:**
- Different `/api/events` flow (e.g. fetch from DB first, then Google, different variable names).
- Different filter params or response shape.
- `event_tags` instead of `tags`, or extra columns.
- A different `/api/org-categories` (e.g. different JSON shape or no org_filters/org_categories).

**Resolution rule:**  
**Merge manually.** For every conflict in this file:
- If the block is **only** org-filtering (org_filters, org_categories, buildAllowedOrgEmailSet, /api/org-categories, orgCatsParam, allowedOrgEmails, exclude, organization_email, tags in events): **keep branch**.
- If the block is **only** main’s new feature/fix and doesn’t touch the above: **keep main**.
- If the block **mixes** both: keep main’s structure (e.g. how events are fetched, new routes) but **reinsert** the org-filtering pieces (org param, buildAllowedOrgEmailSet, filtering by organization_email, tags, and /api/org-categories + JSON loading). After resolution, ensure there are no duplicate declarations (e.g. `allEvents` / `combined`) and that `timeMin`/`timeMax` and `isListServ` are defined before use.

---

## 3. `server/services/calendarPublisher.js`

**Branch (org-filtering) MUST KEEP:**
- `publishEventToCalendar` accepts `organizationEmail` and passes it into `extendedProperties.shared.organization_email`.
- Event tags in shared props (e.g. `tags: JSON.stringify(eventTags || [])`).

**Main might have:**
- Different param names or missing `organization_email` in shared props.

**Resolution rule:**  
**Merge manually.** Keep `organization_email` (and tags) in `extendedProperties.shared` so that when events are read back from Google they still have org-related fields for filtering and display.

---

## 4. `client/src/api/calendarApi.ts`

**Branch (org-filtering) MUST KEEP:**
- Event type / API types include `orgCategories?: string[]` and `organization?: string` where needed.
- `fetchEvents` (or equivalent) accepts `orgCategoriesParam` and appends it to the request URL (e.g. `&orgCategories=...`).
- Any `organizationPreference` in user/preferences types and API calls.

**Main might have:**
- Different query param names or no org params.

**Resolution rule:**  
**Merge manually.** Keep the `orgCategoriesParam` (and exclude param if used) and any `organizationPreference` / `orgCategories` types so the Filters and AppContext still work.

---

## 5. `client/src/components/Filters/Filters.jsx`

**Branch (org-filtering) MUST KEEP:**
- Organization filter tab and UI: `activeTab === 'organizations'`, fetching `/api/org-categories`, building hierarchy with `type` → `subcategory` → `organization` (keys like `typeKey:subKey:orgKey` or `typeKey:all:orgKey`).
- Selection state for orgs and passing selected org keys into the apply-filters flow (e.g. `organizationPreference` or whatever the API expects).
- Counts/logic that depend on `extendedProps.orgCategories` or `organization_email` for per-org counts.

**Main might have:**
- No organization tab, or a different structure (e.g. single list, different key format).

**Resolution rule:**  
**Keep branch** for the organization tab and any org-specific state/API calls. If main has unrelated filter UI improvements (e.g. event-type tab), merge those in without removing the org tab or changing the org key format.

---

## 6. `client/src/context/AppContext.jsx`

**Branch (org-filtering) MUST KEEP:**
- `orgCategoriesParam` (useMemo) built from selected org keys and appended to the events API URL.
- `fetchEvents` (or equivalent) called with `orgCategoriesParam` and `excludeParam`.
- Event transformation that sets `orgCategories: ev.orgCategories ?? []` (and `organization_email` if used for counts/display).
- `getCategoryColor(orgCategories)` for list serv events and any logic that uses `ev.orgCategories` or `ev.organization_email`.
- Loading and applying `organizationPreference` from user preferences (e.g. after login) and persisting it when user applies org filters.

**Main might have:**
- No `orgCategoriesParam`, or different event shape (no `orgCategories`).

**Resolution rule:**  
**Merge manually.** Keep `orgCategoriesParam`, `excludeParam`, and the event shape that includes `orgCategories` (and `organization_email`). If main adds other context (e.g. new preferences), add them without removing org-related state and URL params.

---

## 7. `get_orgs/org_categories.json`

**Branch (org-filtering) MUST KEEP:**
- The file and its format expected by the server (e.g. array of top-level category strings, or `{ categories: [...] }`). Server uses this for `ORG_CATEGORIES` and for validating org_filters category names.

**Main might have:**
- No such file, or a different path/format.

**Resolution rule:**  
**Keep branch** version (and path) so `/api/org-categories` and `buildAllowedOrgEmailSet` keep working. If main introduced a different org taxonomy file, only switch if you’re willing to update server and client to use it everywhere; otherwise keep this file.

---

## Checklist after resolving all conflicts

- [ ] Server starts (`npm run dev` in server).
- [ ] `GET /api/org-categories` returns `{ categories: [ ... typeNodes, subcategoryNodes, orgNodes ] }` with keys like `typeKey:all:orgKey`.
- [ ] `GET /api/events?orgCategories=...&exclude=0|1` filters events by organization (and exclude works).
- [ ] Events in the response have `organization_email` and `tags` (and `orgCategories` if you add it).
- [ ] Frontend: Organization filter tab loads, applies selected orgs, and calendar shows only matching (or excluded) events.
- [ ] No duplicate variable declarations or missing `timeMin`/`timeMax`/`isListServ` in `server/index.js`.

Once this is done, push `org-filtering-from-177` and open a PR to `main`.

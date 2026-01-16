# Email Scraping to Calendar Display - Complete Flow Documentation

## Overview
This document explains the complete process of scraping emails, extracting event data, storing it in the database, and displaying events on the calendar. It also details where and how to add additional fields.

---

## 📧 STEP 1: EMAIL SCRAPING

### Files Involved:
- **`server/services/emailScraper.js`** (Lines 1-329)
- **`server/index.js`** (Lines 1115-1140)

### Process:

#### 1.1 Manual Scraping (API Endpoint)
**Location:** `server/index.js` lines 1115-1140
- **Endpoint:** `POST /api/scrape/emails`
- **Function:** Calls `scrapeEmails()` from `emailScraper.js`
- **Parameters:**
  - `maxResults` (default: 50)
  - `query` (default: "to:campus-events@dartmouth.edu")
  - `force` (boolean, to re-fetch existing emails)

#### 1.2 Automated Scraping
**Location:** `server/services/autoScraper.js` (Lines 269-358)
- **Trigger:** Cron job every 12 hours (see `server/index.js` line 1757)
- **Function:** `runAutomatedScrape(db)`
- **Process:**
  1. Gets admin OAuth tokens from `admin_tokens` table
  2. Gets last scrape time from `app_settings` table
  3. Builds Gmail query with `after:` date filter
  4. Calls `scrapeEmails()` to fetch new emails
  5. Processes unprocessed emails (see Step 2)

#### 1.3 Email Scraping Function
**Location:** `server/services/emailScraper.js` lines 227-328

**Function:** `scrapeEmails(oauth2Client, userId, db, options)`

**Process:**
1. **Search emails** (line 237): Calls `searchEmails()` to get message IDs
2. **For each message** (line 260):
   - Checks if email already exists in database (line 263)
   - If exists and `skipExisting=true`, skips (line 265)
   - If `force=true`, updates existing email (line 273)
   - Otherwise, fetches full email content (line 271)

#### 1.4 Fetching Email Content
**Location:** `server/services/emailScraper.js` lines 79-214

**Function:** `fetchEmailContent(oauth2Client, messageId)`

**Extracted Fields:**
- `gmailMessageId` (line 197)
- `threadId` (line 198)
- `fromEmail` (line 199)
- `fromName` (line 200)
- `subject` (line 201)
- `bodyText` (line 202)
- `bodyHtml` (line 203)
- `receivedDate` (line 204)
- `attachments` (line 205) - Array of image attachments with:
  - `contentId`
  - `mimeType`
  - `filename`
  - `data` (base64)

**Database Insert:**
**Location:** `server/services/emailScraper.js` lines 250-305

**Table:** `scraped_emails`
**Columns:** (see `server/index.js` lines 109-123)
- `id` (generated: `email_${randomHex}`)
- `user_id`
- `gmail_message_id`
- `thread_id`
- `from_email`
- `from_name`
- `subject`
- `body_text`
- `body_html`
- `received_date`
- `scraped_at` (auto timestamp)
- `processed` (0 = not processed, 1 = processed)
- `attachments` (JSON string)

---

## 🤖 STEP 2: EMAIL PARSING (LLM Extraction)

### Files Involved:
- **`server/services/llmParser.js`** (Lines 1-677)
- **`server/index.js`** (Lines 1142-1449)

### Process:

#### 2.1 Processing Endpoint
**Location:** `server/index.js` lines 1142-1449
- **Endpoint:** `POST /api/scrape/process`
- **Parameters:**
  - `emailId` (optional, process specific email)
  - `reprocess` (boolean, reprocess already-processed emails)

#### 2.2 LLM Parsing Function
**Location:** `server/services/llmParser.js` lines 64-676

**Function:** `parseEmailForEvents(emailData)`

**Input:** Email object from `scraped_emails` table

**Process:**
1. **Text Extraction** (line 83):
   - Uses `bodyText` or converts `bodyHtml` to text using `htmlToText()`
   - Removes base64 image data and cleans HTML

2. **Organization Extraction** (line 89):
   - Extracts from `from_name` using `extractOrganization()`

3. **Poster URL Generation** (lines 107-127):
   - Finds first image attachment
   - Constructs URL: `/api/scraped-emails/{emailId}/attachments/{contentId}`

4. **LLM API Call** (lines 202-225):
   - Sends email content to OpenAI GPT-4o
   - **Prompt** (lines 133-200): Instructs LLM to extract:
     - `title`
     - `description`
     - `location`
     - `startDate` (YYYY-MM-DD)
     - `startTime` (HH:MM:SS)
     - `endDate` (YYYY-MM-DD)
     - `endTime` (HH:MM:SS)
     - `allDay` (boolean)

5. **Vision API** (lines 264-345):
   - If time not found in text, uses Vision API to extract from image attachments

6. **Post-Processing** (lines 347-656):
   - Extracts dates from relative terms ("TONIGHT", "TOMORROW")
   - Extracts times from text patterns
   - Validates and fixes date/time formats
   - Generates fallback title from subject if missing

**Output:** Array of event objects with:
- `title`
- `description`
- `location`
- `startDate`
- `startTime`
- `endDate`
- `endTime`
- `allDay`
- `posterUrl`
- `organization`
- `confidenceScore` (0.95)

---

## 💾 STEP 3: DATABASE STORAGE (Events Table)

### Files Involved:
- **`server/index.js`** (Lines 132-152, 1235-1353)

### Process:

#### 3.1 Events Table Schema
**Location:** `server/index.js` lines 132-152

**Table:** `events`
**Columns:**
- `id` (PRIMARY KEY)
- `user_id` (NOT NULL)
- `source` (NOT NULL) - "manual", "email"
- `email_id` (FOREIGN KEY to scraped_emails.id)
- `title`
- `description`
- `location`
- `organization`
- `tags` (JSON string) - Array of category keys
- `poster_url`
- `start` (NOT NULL) - ISO datetime string
- `end` - ISO datetime string
- `all_day` (INTEGER, 0 or 1)
- `confidence_score` (REAL)
- `status` (DEFAULT 'draft') - "draft", "published"
- `google_event_id` - ID from Google Calendar if published
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

#### 3.2 Event Insertion
**Location:** `server/index.js` lines 1235-1353

**Process:**
1. **Category Assignment** (lines 1250-1258):
   - Calls `assignCategories()` to get category keys
   - Calls `assignOrgCategories()` to get org category keys
   - Combines into `tags` JSON array

2. **Date/Time Combination** (lines 1260-1302):
   - Uses `combineDateTime()` to merge `startDate` + `startTime` → `start`
   - Validates end date (resets to same day if multi-day detected)
   - Defaults end time to 1 hour after start if missing

3. **Duplicate Detection** (lines 1304-1335):
   - Checks for same email + same title + same start date
   - Checks for same title + same organization + same start date

4. **Database Insert** (lines 1337-1353):
   - Inserts into `events` table with `source='email'`
   - Sets `status='draft'`

5. **Auto-Publish** (lines 1355-1422):
   - Automatically publishes to Google Calendar
   - Updates `status='published'` and stores `google_event_id`

---

## 📅 STEP 4: CALENDAR DISPLAY

### Files Involved:
- **`server/index.js`** (Lines 614-762)
- **`client/src/api/calendarApi.ts`** (Lines 81-100)
- **`client/src/context/AppContext.jsx`** (Lines 170-256)
- **`client/src/components/Calendar/Calendar.jsx`** (Lines 1-167)

### Process:

#### 4.1 API Endpoint (Backend)
**Location:** `server/index.js` lines 614-762

**Endpoint:** `GET /api/events`

**Process:**
1. **Fetch Google Calendar Events** (lines 645-672):
   - Gets events from requested calendars
   - Maps to event format with `source='google'`
   - Extracts custom fields from `extendedProperties.shared`

2. **Fetch Local Events** (lines 674-686):
   - Gets events from `events` table where `status != 'published'`
   - Maps to event format with `source='draft'` or `source='email'`
   - Parses `tags` JSON string to array

3. **Category Assignment** (lines 688-693):
   - Calls `assignCategories()` and `assignOrgCategories()` for each event
   - Adds `categories` and `orgCategories` arrays to events

4. **Filtering** (lines 728-755):
   - Applies category/org-category filters (if provided)
   - Only filters ListServ events (drafts, email-sourced, Google listserv calendar)
   - Non-ListServ events always pass through

**Response:** Array of events with:
- `id` (prefixed: `draft:`, `email:`, or `google:`)
- `source`
- `title`
- `description`
- `location`
- `start` (ISO string)
- `end` (ISO string)
- `allDay` (boolean)
- `organization`
- `tags` (array)
- `poster_url`
- `categories` (array)
- `orgCategories` (array)

#### 4.2 Frontend API Call
**Location:** `client/src/api/calendarApi.ts` lines 81-100

**Function:** `api.fetchEvents({ calendarIds, categoriesParam, orgCategoriesParam, excludeParam })`

**Process:**
- Builds query string with calendar IDs and filter parameters
- Calls `/api/events` endpoint
- Returns parsed JSON

#### 4.3 Context Fetching
**Location:** `client/src/context/AppContext.jsx` lines 170-256

**Function:** `fetchEvents(calendarIds)`

**Process:**
1. Calls `api.fetchEvents()` (line 179)
2. **Transforms events** (lines 220-252):
   - Determines if event is ListServ (draft, email, or Google listserv calendar)
   - Assigns category color based on `orgCategories`
   - Sets CSS class: `fc-event-listserv` or `fc-event-other`
   - Sets `backgroundColor`, `borderColor`, `textColor`
   - Adds `extendedProps` with all event fields

3. **Updates state** (line 253):
   - Sets `events` state (used by calendar component)

#### 4.4 Calendar Component Display
**Location:** `client/src/components/Calendar/Calendar.jsx` lines 1-167

**Component:** `<Calendar />`

**Process:**
1. **Gets events from context** (line 44): `const { events } = useContext(AppContext)`

2. **Renders FullCalendar** (lines 61-162):
   - Passes `events` prop to FullCalendar (line 68)
   - FullCalendar automatically renders events based on `start` and `end` times

3. **Custom Event Rendering** (lines 111-156):
   - `eventContent` function customizes how events appear
   - Shows title and time range
   - Different styling for ListServ vs other events

4. **Filter Application** (lines 52-55):
   - Uses `applyFiltersToCalendar()` to show/hide events based on active filters

---

## 🔧 HOW TO ADD NEW FIELDS

### Example: Adding a "Contact Email" Field

#### Step 1: Update Email Scraping
**File:** `server/services/emailScraper.js`

**Location:** `fetchEmailContent()` function (lines 79-214)

**Add extraction logic:**
```javascript
// Around line 201, after extracting subject
const contactEmail = extractContactEmail(bodyText, bodyHtml); // Your extraction function
```

**Update return object** (around line 196):
```javascript
return {
  gmailMessageId: messageId,
  threadId: message.threadId,
  fromEmail,
  fromName,
  subject: getHeader("Subject"),
  bodyText,
  bodyHtml,
  receivedDate,
  attachments: attachments.length > 0 ? attachments : null,
  contactEmail, // ADD THIS
};
```

**Update database insert** (around line 250):
```javascript
const emailInsert = db.prepare(`INSERT INTO scraped_emails(
  id, user_id, gmail_message_id, thread_id, from_email, from_name, 
  subject, body_text, body_html, received_date, attachments, contact_email
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
```

**Update insert call** (around line 293):
```javascript
emailInsert.run(
  emailId,
  userId,
  emailData.gmailMessageId,
  emailData.threadId,
  emailData.fromEmail,
  emailData.fromName,
  emailData.subject,
  emailData.bodyText,
  emailData.bodyHtml,
  emailData.receivedDate,
  emailData.attachments ? JSON.stringify(emailData.attachments) : null,
  emailData.contactEmail, // ADD THIS
);
```

**Update update statement** (around line 254):
```javascript
const emailUpdate = db.prepare(`UPDATE scraped_emails SET
  thread_id=?, from_email=?, from_name=?, subject=?, body_text=?, 
  body_html=?, received_date=?, attachments=?, contact_email=?
  WHERE gmail_message_id=? AND user_id=?`);
```

**Update update call** (around line 275):
```javascript
emailUpdate.run(
  emailData.threadId,
  emailData.fromEmail,
  emailData.fromName,
  emailData.subject,
  emailData.bodyText,
  emailData.bodyHtml,
  emailData.receivedDate,
  emailData.attachments ? JSON.stringify(emailData.attachments) : null,
  emailData.contactEmail, // ADD THIS
  emailData.gmailMessageId,
  userId
);
```

#### Step 2: Update Database Schema
**File:** `server/index.js`

**Location:** After line 123 (in the table creation section)

**Add column:**
```javascript
try {
  db.exec(`ALTER TABLE scraped_emails ADD COLUMN contact_email TEXT`);
} catch (e) {
  // Column already exists
}
```

#### Step 3: Update LLM Parser
**File:** `server/services/llmParser.js`

**Location:** `parseEmailForEvents()` function (lines 64-676)

**Add to prompt** (around line 148):
```javascript
const prompt = `Extract event information from this email...
{
  "title": "...",
  "description": "...",
  "location": "...",
  "contactEmail": "email@example.com or null", // ADD THIS
  "startDate": "...",
  ...
}`;
```

**Add to parsed object** (around line 248):
```javascript
let parsed = JSON.parse(jsonStr);

// Add null check for contactEmail
if (parsed.contactEmail === "null") parsed.contactEmail = null;
```

**Add to event object** (around line 633):
```javascript
const event = {
  title: parsed.title,
  description: parsed.description || null,
  location: parsed.location || null,
  contactEmail: parsed.contactEmail || null, // ADD THIS
  startDate: extractedStartDate || parsed.startDate,
  ...
};
```

#### Step 4: Update Events Table
**File:** `server/index.js`

**Location:** After line 152 (in events table creation)

**Add column:**
```javascript
try {
  db.exec(`ALTER TABLE events ADD COLUMN contact_email TEXT`);
} catch (e) {
  // Column already exists
}
```

**Update event insert** (around line 325):
```javascript
const eventInsert = db.prepare(
  `INSERT INTO events(id, user_id, source, email_id, title, description, location, organization, tags, poster_url, start, end, all_day, confidence_score, status, contact_email)
   VALUES(@id, @user_id, @source, @email_id, @title, @description, @location, @organization, @tags, @poster_url, @start, @end, @all_day, @confidence_score, @status, @contact_email)`
);
```

**Update event insert call** (around line 1337):
```javascript
eventInsert.run({
  id: eventId,
  user_id: userId,
  source: "email",
  email_id: email.id,
  title: event.title || "",
  description: event.description || "",
  location: event.location || "",
  organization: event.organization || "",
  tags: tagsJson,
  poster_url: event.posterUrl || "",
  start,
  end: end || null,
  all_day: event.allDay ? 1 : 0,
  confidence_score: event.confidenceScore || null,
  status: "draft",
  contact_email: event.contactEmail || null, // ADD THIS
});
```

**Update event update** (around line 329):
```javascript
const eventUpdate = db.prepare(
  `UPDATE events SET title=@title, description=@description, location=@location, organization=@organization, tags=@tags, poster_url=@poster_url, 
   start=@start, end=@end, all_day=@all_day, contact_email=@contact_email, updated_at=CURRENT_TIMESTAMP WHERE id=@id AND user_id=@user_id`
);
```

#### Step 5: Update API Response
**File:** `server/index.js`

**Location:** `GET /api/events` endpoint (lines 614-762)

**Add to local events mapping** (around line 674):
```javascript
const localEvents = eventsByUser.all(req.session.user.id).map((e) => ({
  id: e.source === "manual" ? `draft:${e.id}` : `email:${e.id}`,
  source: e.source === "manual" ? "draft" : "email",
  title: e.title || (e.source === "manual" ? "(Draft)" : "(Event)"),
  description: e.description || "",
  location: e.location || "",
  start: e.start,
  end: e.end,
  allDay: !!e.all_day,
  organization: e.organization || "",
  tags: JSON.parse(e.tags || "[]"),
  poster_url: e.poster_url || "",
  contact_email: e.contact_email || "", // ADD THIS
}));
```

**Add to Google events mapping** (around line 653):
```javascript
const googleEvents = (googleResp.data.items || []).map((ev) => {
  const props = ev.extendedProperties?.shared || {};
  return {
    id: `google:${ev.id}`,
    calendarId: calId,
    source: "google",
    title: ev.summary || "(No title)",
    description: ev.description || "",
    location: ev.location || "",
    start: isAllDay ? ev.start.date : ev.start?.dateTime,
    end: isAllDay ? ev.end.date : ev.end?.dateTime,
    allDay: isAllDay,
    organization: props.organization || "",
    tags: JSON.parse(props.tags || "[]"),
    poster_url: props.poster_url || "",
    contact_email: props.contact_email || "", // ADD THIS
  };
});
```

**Update publish endpoint** (around line 1042):
```javascript
const resource = {
  summary: row.title || "",
  description: row.description || "",
  location: row.location || "",
  extendedProperties: {
    shared: {
      organization: row.organization || "",
      tags: row.tags || "[]",
      poster_url: row.poster_url || "",
      contact_email: row.contact_email || "", // ADD THIS
    },
  },
};
```

#### Step 6: Update Frontend Types
**File:** `client/src/api/calendarApi.ts`

**Location:** Event type definition (around line 13)

**Add field:**
```typescript
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
  contact_email?: string; // ADD THIS
};
```

#### Step 7: Update Frontend Context
**File:** `client/src/context/AppContext.jsx`

**Location:** Event transformation (around line 220)

**Add to extendedProps:**
```javascript
extendedProps: {
  organization: ev.organization ?? "",
  tags: ev.tags ?? "",
  poster_url: ev.poster_url ?? "",
  description: ev.description ?? "",
  location: ev.location ?? "",
  contact_email: ev.contact_email ?? "", // ADD THIS
  source: ev.source,
  calendarId: ev.calendarId ?? null,
  filter: ev.filter ?? ev.tag ?? null,
  categories: ev.categories ?? [],
  orgCategories: ev.orgCategories ?? [],
},
```

#### Step 8: Update Display Components (Optional)
**File:** `client/src/components/EventDetails/EventDetails.jsx`

**Add display of new field in the event details modal.**

---

## 📋 SUMMARY: Key Files and Line Numbers

### Email Scraping:
- `server/services/emailScraper.js`: Lines 79-214 (fetchEmailContent), 227-328 (scrapeEmails)
- `server/index.js`: Lines 1115-1140 (scrape endpoint), 109-123 (scraped_emails table)

### Email Parsing:
- `server/services/llmParser.js`: Lines 64-676 (parseEmailForEvents)
- `server/index.js`: Lines 1142-1449 (process endpoint)

### Database Storage:
- `server/index.js`: Lines 132-152 (events table), 1235-1353 (event insertion)

### Calendar Display:
- `server/index.js`: Lines 614-762 (GET /api/events)
- `client/src/api/calendarApi.ts`: Lines 81-100 (fetchEvents)
- `client/src/context/AppContext.jsx`: Lines 170-256 (fetchEvents)
- `client/src/components/Calendar/Calendar.jsx`: Lines 1-167 (Calendar component)

---

## 🔄 Complete Flow Diagram

```
1. Email Scraping
   └─> Gmail API (emailScraper.js)
       └─> scraped_emails table

2. Email Processing
   └─> LLM Parser (llmParser.js)
       └─> Extracts event fields
           └─> events table (status='draft')

3. Auto-Publish
   └─> Google Calendar API
       └─> events table (status='published', google_event_id set)

4. Calendar Display
   └─> GET /api/events
       └─> Combines Google Calendar + Local DB events
           └─> Frontend (AppContext.jsx)
               └─> Calendar Component (Calendar.jsx)
                   └─> FullCalendar renders events
```

---

## ⚠️ Important Notes

1. **Database Migrations**: Always use `try/catch` when adding columns (columns may already exist)
2. **JSON Fields**: `tags` and `attachments` are stored as JSON strings, parse when reading
3. **Date/Time Format**: Events use ISO 8601 strings (`YYYY-MM-DDTHH:MM:SS` or `YYYY-MM-DD`)
4. **Event IDs**: Prefixed with source (`draft:`, `email:`, `google:`)
5. **Auto-Publish**: Email-sourced events are automatically published to Google Calendar
6. **Filtering**: Only ListServ events are filtered; other calendars always show

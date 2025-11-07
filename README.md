# We Run the School

![Team Photo](images/groupPic.png)

<!--TODO: short project description, some sample screenshots or mockups-->
A public online events calendar focused on organizing Dartmouth Events in a centralized and easy to use website.
![Sprint 4 Screen Shot](images/demoPic.png)

## Tech Stack & Architecture  

### 📦 Tech Stack  

- **Front‑end** – React 18 + Vite, FullCalendar, Tailwind/custom CSS.  
- **State** – React Context + a few custom hooks (`useCategories`, `useEvents`).  
- **Back‑end** – Node ≥ 18, Express, `googleapis` client, SQLite (via `better‑sqlite3`).  
- **Auth** – Google OAuth 2.0 (Authorization Code flow). The server stores an encrypted **refresh token** in SQLite and sends an **HttpOnly SameSite‑Lax** session cookie to the browser.  
- **Deployment** – Docker (multi‑stage) with environment‑variable configuration.

---  

### 🏗️ Architecture Overview  
[Browser (React)] ── fetch /api/* (credentials: include) ──► [Express Server]
                                                               │
                                                   uses stored refresh token
                                                               ▼
                                                [Google Calendar API (OAuth2)]
                                                               │
                                                       caches data in
                                                          SQLite DB

- The UI never talks to Google directly; every request goes through `/api/*`.  
- The server automatically refreshes the access token when needed and adds any internal **category/tag** data before returning the payload.  
- Admin users get the `calendar` scope (write access); regular users have `calendar.readonly`.

### 📡 Core API Endpoints  

| Method | Path | Purpose | Admin? |
|--------|------|---------|--------|
| `GET` | `/api/me` | Return the logged‑in user (session info). | – |
| `GET` | `/api/calendars` | List the user's calendars & detect the ListServ calendar. | – |
| `GET` | `/api/events?calendarIds=&categories=` | Fetch events, apply optional category filter, enrich with tags, cache in SQLite. | – |
| `GET` | `/api/event-categories` | JSON list of event‑category objects (used for filter bubbles). | – |
| `POST`| `/api/drafts` | Create a **draft** (tentative) event on Google. | ✅ |
| `POST`| `/api/events/:id/publish` | Publish a draft (change status to *confirmed*). | ✅ |
| `DELETE`| `/api/events/:id` | Delete an event from Google *and* from SQLite. | ✅ |

All calls include `credentials: "include"` so the session cookie is sent automatically.

---  

## Setup

<!--TODO: how to get the project dev environment up and running, npm install etc-->
After cloning the main "project-we-run-the-school" repository:
1. cd into server and run "npm install" making sure that node.js is not a later verson than 22
2. cd into client and run "npm install" with the same node.js version
3. cd into server and run "npm run dev" making sure the terminal outputs "server is listening on port 3000"
4. with the server running in it's own terminal, create a new terminal window, cd into client and "npm run dev"
5. Command click "Local:   http://localhost:5173/" to open the calender on your browser

```bash
# Clone repo
git clone <repo‑url>
cd calendar-sync

# Copy env template and fill in your Google OAuth keys
cp .env.example .env   # set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET, etc.

# ---------- Or run locally ----------
# Server
cd server && npm install && npm run dev   # http://localhost:5000

# Client
cd client && npm install && npm run dev   # http://localhost:5173

```

## Deployment

TODO: how to deploy the project

## Authors

Bill Zheng, Christian Nyamekye, Lydia Jin, Lorenzo Cuellar, Memo Tangtipongkul, Walker Ball

## Acknowledgments

# Server

Express backend for the campus events calendar app.

## Architecture

### Scraping Flow
```
Cron (every 8 hours) OR test-scraper.js
            │
            ▼
┌───────────────────────────────────────────────┐
│ 1. Admin account (SCRAPER_EMAIL) scrapes      │
│    campus-events emails via Gmail API         │
│    └── Uses OAuth tokens from admin_tokens    │
├───────────────────────────────────────────────┤
│ 2. Emails → scraped_emails table              │
├───────────────────────────────────────────────┤
│ 3. LLM parses → events table                  │
│    └── source='email', status='published'     │
└───────────────────────────────────────────────┘
```

### User Access Flow
```
Any User (Google OAuth)
            │
            ▼
┌───────────────────────────────────────────────┐
│ users table                                   │
│ └── id, email, name, preferences (JSON)       │
├───────────────────────────────────────────────┤
│ GET /api/events                               │
│ └── All email events visible to EVERYONE      │
│ └── Manual drafts visible only to creator     │
├───────────────────────────────────────────────┤
│ POST /api/user/sync-to-calendar (optional)    │
│ └── Sync events to user's Google Calendar     │
└───────────────────────────────────────────────┘
```

## Environment Setup

Create `.env` in the server directory:

```env
# Server
PORT=3000
SESSION_SECRET=replace-with-a-random-long-string

# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Frontend
FRONTEND_URL=http://localhost:5173

# Scraping
SCRAPER_EMAIL=your-scraper-account@domain.com

# LLM (OpenAI)
OPENAI_API_KEY=sk-...
```

## Local Development with Neon Branches

For local testing, create a Neon branch to avoid affecting production data.

### 1. Create a branch
```bash
# Via Neon Console: Project → Branches → Create Branch
# Or via CLI:
neonctl branches create --project-id <project-id> --name dev-yourname
```

### 2. Get the connection string
```bash
# Neon Console: Branch → Connection Details → Copy connection string
# Or via CLI:
neonctl connection-string --project-id <project-id> --branch dev-yourname
```

### 3. Update your `.env`
```env
DATABASE_URL=postgresql://...your-branch-connection-string...
```

### 4. Run the scraper locally
```bash
node test-scraper.js
```

### 5. Delete your branch when done
**Important:** Always delete test branches to avoid unnecessary storage costs.
```bash
# Via Neon Console: Branch → Delete
# Or via CLI:
neonctl branches delete --project-id <project-id> --branch dev-yourname
```

## Production Notes

Before deploying to production:

1. **Environment Variables**: Ensure `NODE_ENV=production` is set. This enables:
   - Secure cookies (HTTPS-only)
   - Production SSL settings for database

2. **Session Storage**: Sessions are stored in-memory by default. For production with multiple instances, use a persistent session store:
   ```bash
   npm install connect-pg-simple
   ```
   Then configure in index.js to use PostgreSQL for session storage.

3. **Rate Limiting**: Add rate limiting middleware to prevent API abuse:
   ```bash
   npm install express-rate-limit
   ```
   Example configuration:
   ```javascript
   import rateLimit from 'express-rate-limit';
   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 100, // limit each IP to 100 requests per windowMs
   });
   app.use('/api/', limiter);
   ```

4. **Error Handling**: Consider wrapping API error responses to avoid exposing internal details:
   ```javascript
   // In production, return generic error messages
   if (process.env.NODE_ENV === 'production') {
     res.status(500).json({ error: 'Internal server error' });
   } else {
     res.status(500).json({ error: err.message });
   }
   ```

5. **HTTPS**: Ensure the app runs behind a reverse proxy (e.g., nginx) with HTTPS enabled for secure cookie transmission.
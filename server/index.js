import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
    PORT = 3000,
    SESSION_SECRET = 'dev-secret',
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    FRONTEND_URL = 'http://localhost:5173 '
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    console.error('Missing Google OAuth env vars. Check .env.');
    process.exit(1);
}

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false // set to true behind HTTPS/proxy in production
    }
}));

// SQLite for draft events
const db = new Database(path.join(__dirname, 'db.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, description TEXT, location TEXT, start TEXT NOT NULL, end TEXT, all_day INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);');
const draftInsert = db.prepare('INSERT INTO drafts(id, user_id, title, description, location, start, end, all_day) VALUES(@id, @user_id, @title, @description, @location, @start, @end, @all_day)');
const draftUpdate = db.prepare('UPDATE drafts SET title = @title, description = @description, location = @location, start = @start, end = @end, all_day = @all_day, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND user_id = @user_id');
const draftDelete = db.prepare('DELETE FROM drafts WHERE id = @id AND user_id = @user_id');
const draftByUser = db.prepare('SELECT * FROM drafts WHERE user_id =?');

function ensureAuthed(req, res, next) {
    if (!req.session.tokens || !req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

function getOAuthClient(req) {
    const oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI
    );
    if (req.session.tokens) {
        oauth2Client.setCredentials(req.session.tokens);
    }
    // Update session if tokens are refreshed
    oauth2Client.on('tokens', (tokens) => {
        req.session.tokens = { ...req.session.tokens, ...tokens };
    });
    return oauth2Client;
}

// Auth routes
app.get('/auth/google', (req, res) => {
    const oauth2Client = getOAuthClient(req);
    const scopes = [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar ' // read/write
    ];
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes
    });
    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    try {
        const oauth2Client = getOAuthClient(req);
        const { code } = req.query;
        const { tokens } = await oauth2Client.getToken(code);
        req.session.tokens = tokens;

        // Fetch user info
        oauth2Client.setCredentials(tokens);
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data: userinfo } = await oauth2.userinfo.get();
        // userinfo.id is stable; fallback to email if needed
        req.session.user = {
            id: userinfo.id || userinfo.email,
            email: userinfo.email,
            name: userinfo.name
        };

        res.redirect(FRONTEND_URL);
    } catch (err) {
        console.error('OAuth callback error:', err);
        res.status(500).send('Authentication failed');
    }
});

app.post('/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ ok: true });
    });
});

app.get('/api/me', (req, res) => {
    if (!req.session.user) return res.json({ user: null });
    res.json({ user: req.session.user });
});

// Get merged events: Google + drafts
app.get('/api/events', ensureAuthed, async (req, res) => {
    try {
        const oauth2Client = getOAuthClient(req);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const now = new Date();
        const defaultTimeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const defaultTimeMax = new Date(now.getFullYear(), now.getMonth() + 3, 0, 23, 59, 59).toISOString();

        const timeMin = req.query.timeMin || defaultTimeMin;
        const timeMax = req.query.timeMax || defaultTimeMax;

        const googleResp = await calendar.events.list({
            calendarId: 'primary',
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: 'startTime'
        });

        const googleEvents = (googleResp.data.items || []).map(ev => {
            const isAllDay = !!ev.start?.date;
            const start = isAllDay ? ev.start.date : ev.start?.dateTime;
            const end = isAllDay ? ev.end?.date : ev.end?.dateTime;
            return {
                id: `google:${ev.id}`,
                source: 'google',
                title: ev.summary || '(No title)',
                description: ev.description || '',
                location: ev.location || '',
                start,
                end,
                allDay: isAllDay
            };
        });

        const drafts = draftByUser.all(req.session.user.id).map(d => ({
            id: `draft:${d.id}`,
            source: 'draft',
            title: d.title || '(Draft)',
            description: d.description || '',
            location: d.location || '',
            start: d.start,
            end: d.end,
            allDay: !!d.all_day
        }));

        res.json({ events: [...drafts, ...googleEvents] });
    } catch (err) {
        console.error('/api/events error', err);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// Create a draft event
app.post('/api/drafts', ensureAuthed, (req, res) => {
    try {
        const { title, description, location, start, end, allDay } = req.body;
        if (!start) return res.status(400).json({ error: 'start required' });

        const id = `draft_${cryptoRandomId()}`;
        draftInsert.run({
            id,
            user_id: req.session.user.id,
            title: title || '',
            description: description || '',
            location: location || '',
            start,
            end: end || null,
            all_day: allDay ? 1 : 0
        });
        res.json({ ok: true, id: `draft:${id}` });
    } catch (err) {
        console.error('Create draft error', err);
        res.status(500).json({ error: 'Failed to create draft' });
    }
});

// Update a draft (optional; used if you add edit UI)
app.put('/api/drafts/:id', ensureAuthed, (req, res) => {
    try {
        const { id } = req.params; // raw draft id without prefix expected
        const { title, description, location, start, end, allDay } = req.body;
        draftUpdate.run({
            id,
            user_id: req.session.user.id,
            title: title || '',
            description: description || '',
            location: location || '',
            start,
            end: end || null,
            all_day: allDay ? 1 : 0
        });
        res.json({ ok: true });
    } catch (err) {
        console.error('Update draft error', err);
        res.status(500).json({ error: 'Failed to update draft' });
    }
});

// Delete: works for both draft and google events by id prefix
app.delete('/api/events/:compoundId', ensureAuthed, async (req, res) => {
    try {
        const { compoundId } = req.params;
        const [source, rawId] = compoundId.split(':');
        if (source === 'draft') {
            draftDelete.run({ id: rawId, user_id: req.session.user.id });
            return res.json({ ok: true });
        }
        if (source === 'google') {
            const oauth2Client = getOAuthClient(req);
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            await calendar.events.delete({ calendarId: 'primary', eventId: rawId });
            return res.json({ ok: true });
        }
        res.status(400).json({ error: 'Unknown event source' });
    } catch (err) {
        console.error('Delete event error', err);
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

// Publish a draft -> create on Google, then delete the draft
app.post('/api/events/:compoundId/publish', ensureAuthed, async (req, res) => {
    try {
        const { compoundId } = req.params;
        const [source, rawId] = compoundId.split(':');
        if (source !== 'draft') return res.status(400).json({ error: 'Only drafts can be published' });

        const row = db.prepare(`SELECT * FROM drafts WHERE id=? AND user_id=?`).get(rawId, req.session.user.id);
        if (!row) return res.status(404).json({ error: 'Draft not found' });

        const oauth2Client = getOAuthClient(req);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const resource = {
            summary: row.title || '',
            description: row.description || '',
            location: row.location || '',
        };

        if (row.all_day) {
            // All-day events use 'date' (end date is exclusive)
            resource.start = { date: row.start }; // expect YYYY-MM-DD
            resource.end = { date: row.end || row.start }; // if end missing, single-day
        } else {
            resource.start = { dateTime: row.start };
            resource.end = { dateTime: row.end || row.start };
        }

        const insertResp = await calendar.events.insert({
            calendarId: 'primary',
            resource
        });

        // Remove local draft after publish
        draftDelete.run({ id: rawId, user_id: req.session.user.id });

        res.json({
            ok: true,
            published: {
                id: `google:${insertResp.data.id}`
            }
        });
    } catch (err) {
        console.error('Publish draft error', err);
        res.status(500).json({ error: 'Failed to publish draft' });
    }
});

// Utility to generate local ids
function cryptoRandomId() {
    return [...crypto.getRandomValues(new Uint8Array(12))]
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

// Serve client build in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
    // Only serve index.html if it exists (in prod after build)
    if (!req.path.startsWith('/api') && !req.path.startsWith('/auth')) {
        try {
            return res.sendFile(path.join(clientDist, 'index.html'));
        } catch {
            // in dev, frontend runs separately
        }
    }
    next();
});

app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
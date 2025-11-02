import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  PORT = 3000,
  SESSION_SECRET = 'dev-secret',
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  FRONTEND_URL = 'http://localhost:5173'
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
  cookie: { httpOnly: true, sameSite: 'lax', secure: false }
}));

// SQLite setup for drafts
const db = new Database(path.join(__dirname, 'db.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS drafts(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  location TEXT,
  start TEXT NOT NULL,
  end TEXT,
  all_day INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);`);

const draftInsert = db.prepare(`INSERT INTO drafts(id, user_id, title, description, location, start, end, all_day)
  VALUES(@id, @user_id, @title, @description, @location, @start, @end, @all_day)`);
const draftUpdate = db.prepare(`UPDATE drafts SET title=@title, description=@description, location=@location, 
  start=@start, end=@end, all_day=@all_day, updated_at=CURRENT_TIMESTAMP WHERE id=@id AND user_id=@user_id`);
const draftDelete = db.prepare('DELETE FROM drafts WHERE id=@id AND user_id=@user_id');
const draftByUser = db.prepare('SELECT * FROM drafts WHERE user_id=?');

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
  if (req.session.tokens) oauth2Client.setCredentials(req.session.tokens);
  oauth2Client.on('tokens', tokens => { req.session.tokens = { ...req.session.tokens, ...tokens }; });
  return oauth2Client;
}

// --- Helper: Ensure ListServ calendar exists ---
async function getOrCreateListServCalendar(req, oauth2Client) {
  if (req.session.listservCalendarId) return { id: req.session.listservCalendarId, created: false };
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const list = await calendar.calendarList.list();
  const existing = (list.data.items || []).find(c => c.summary?.toLowerCase() === 'listserv events');
  if (existing) { req.session.listservCalendarId = existing.id; return { id: existing.id, created: false }; }
  const newCal = await calendar.calendars.insert({
    requestBody: { summary: 'ListServ Events', description: 'Dedicated calendar for ListServ app', timeZone: 'America/Los_Angeles' }
  });
  await calendar.calendarList.insert({ requestBody: { id: newCal.data.id } });
  req.session.listservCalendarId = newCal.data.id;
  return { id: newCal.data.id, created: true };
}

// --- Auth ---
app.get('/auth/google', (req, res) => {
  const oauth2Client = getOAuthClient(req);
  const scopes = ['openid','email','profile','https://www.googleapis.com/auth/calendar'];
  const url = oauth2Client.generateAuthUrl({ access_type:'offline', prompt:'consent', scope:scopes });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    const { tokens } = await oauth2Client.getToken(req.query.code);
    req.session.tokens = tokens;
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version:'v2', auth: oauth2Client });
    const { data: userinfo } = await oauth2.userinfo.get();
    req.session.user = { id: userinfo.id||userinfo.email, email: userinfo.email, name: userinfo.name };
    await getOrCreateListServCalendar(req, oauth2Client);
    res.redirect(FRONTEND_URL);
  } catch(e) { console.error(e); res.status(500).send('Authentication failed'); }
});

app.post('/auth/logout', (req,res)=>{ req.session.destroy(()=>{ res.clearCookie('connect.sid'); res.json({ok:true}); }); });
app.get('/api/me', (req,res)=>{ res.json({user:req.session.user||null}); });

// --- List all user calendars ---
app.get('/api/calendars', ensureAuthed, async (req,res)=>{
  try {
    const oauth2Client = getOAuthClient(req);
    const calendar = google.calendar({ version:'v3', auth: oauth2Client });
    const resp = await calendar.calendarList.list();
    const items = (resp.data.items||[]).map(c=>({ id:c.id, summary:c.summary, accessRole:c.accessRole, primary:c.primary||false, backgroundColor:c.backgroundColor }));
    res.json({ calendars: items });
  } catch(e){ console.error(e); res.status(500).json({error:'Failed to fetch calendar list'}); }
});

// --- Current ListServ calendar info ---
app.get('/api/calendar', ensureAuthed, async (req,res)=>{
  try {
    const oauth2Client = getOAuthClient(req);
    const calendar = google.calendar({ version:'v3', auth: oauth2Client });
    const { id: calendarId, created } = await getOrCreateListServCalendar(req, oauth2Client);
    const { data } = await calendar.calendars.get({ calendarId });
    res.json({ id:data.id, summary:data.summary, timeZone:data.timeZone, accessRole:data.accessRole||'unknown', created });
  } catch(e){ console.error(e); res.status(500).json({error:'Failed to fetch calendar info'}); }
});

// --- Get events (multi-calendar) ---
app.get('/api/events', ensureAuthed, async (req,res)=>{
  try{
    const oauth2Client = getOAuthClient(req);
    const calendar = google.calendar({ version:'v3', auth: oauth2Client });
    const { id: listservCalendarId } = await getOrCreateListServCalendar(req, oauth2Client);

    const now = new Date();
    const timeMin = req.query.timeMin || new Date(now.getFullYear(), now.getMonth()-1,1).toISOString();
    const timeMax = req.query.timeMax || new Date(now.getFullYear(), now.getMonth()+3,0,23,59,59).toISOString();

    const requestedIds = req.query.calendarIds ? req.query.calendarIds.split(',') : ['primary', listservCalendarId];

    const allEvents = [];
    for(const calId of requestedIds){
      const googleResp = await calendar.events.list({ calendarId: calId, timeMin, timeMax, singleEvents:true, orderBy:'startTime' });
      const googleEvents = (googleResp.data.items||[]).map(ev=>{
        const isAllDay = !!ev.start?.date;
        return { id:`google:${ev.id}`, calendarId: calId, source:'google', title:ev.summary||'(No title)', description:ev.description||'', location:ev.location||'', start:isAllDay?ev.start.date:ev.start?.dateTime, end:isAllDay?ev.end.date:ev.end?.dateTime, allDay:isAllDay };
      });
      allEvents.push(...googleEvents);
    }

    const drafts = draftByUser.all(req.session.user.id).map(d=>({
      id:`draft:${d.id}`, source:'draft', title:d.title||'(Draft)', description:d.description||'', location:d.location||'', start:d.start, end:d.end, allDay:!!d.all_day
    }));

    res.json({ events:[...drafts,...allEvents] });
  } catch(e){ console.error(e); res.status(500).json({error:'Failed to fetch events'}); }
});

// --- Drafts ---
app.post('/api/drafts', ensureAuthed, (req,res)=>{
  try{
    const { title, description, location, start, end, allDay } = req.body;
    if(!start) return res.status(400).json({error:'start required'});
    const id = `draft_${crypto.randomBytes(12).toString('hex')}`;
    draftInsert.run({ id, user_id:req.session.user.id, title:title||'', description:description||'', location:location||'', start, end:end||null, all_day:allDay?1:0 });
    res.json({ok:true,id:`draft:${id}`});
  } catch(e){ console.error(e); res.status(500).json({error:'Failed to create draft'}); }
});

// --- Delete / Publish events ---
app.delete('/api/events/:compoundId', ensureAuthed, async (req,res)=>{
  try{
    const [source,rawId] = req.params.compoundId.split(':');
    if(source==='draft'){ draftDelete.run({id:rawId,user_id:req.session.user.id}); return res.json({ok:true}); }
    if(source==='google'){
      const oauth2Client = getOAuthClient(req);
      const calendar = google.calendar({ version:'v3', auth:oauth2Client });
      const { id: listservCalendarId } = await getOrCreateListServCalendar(req,oauth2Client);
      await calendar.events.delete({ calendarId:listservCalendarId, eventId:rawId });
      return res.json({ok:true});
    }
    res.status(400).json({error:'Unknown event source'});
  }catch(e){ console.error(e); res.status(500).json({error:'Failed to delete event'}); }
});

app.post('/api/events/:compoundId/publish', ensureAuthed, async (req,res)=>{
  try{
    const [source,rawId] = req.params.compoundId.split(':');
    if(source!=='draft') return res.status(400).json({error:'Only drafts can be published'});
    const row = db.prepare(`SELECT * FROM drafts WHERE id=? AND user_id=?`).get(rawId, req.session.user.id);
    if(!row) return res.status(404).json({error:'Draft not found'});
    const oauth2Client = getOAuthClient(req);
    const calendar = google.calendar({ version:'v3', auth:oauth2Client });
    const { id: listservCalendarId } = await getOrCreateListServCalendar(req,oauth2Client);
    const resource = { summary:row.title||'', description:row.description||'', location:row.location||'' };
    if(row.all_day){ resource.start={date:row.start}; resource.end={date:row.end||row.start}; }
    else { resource.start={dateTime:row.start}; resource.end={dateTime:row.end||row.start}; }
    const insertResp = await calendar.events.insert({ calendarId:listservCalendarId, requestBody:resource });
    draftDelete.run({ id:rawId, user_id:req.session.user.id });
    res.json({ ok:true, published:{id:`google:${insertResp.data.id}`}});
  } catch(e){ console.error(e); res.status(500).json({error:'Failed to publish draft'}); }
});

// --- Serve frontend ---
const clientDist = path.join(__dirname,'..','client','dist');
app.use(express.static(clientDist));
app.get('*',(req,res,next)=>{
  if(!req.path.startsWith('/api') && !req.path.startsWith('/auth')){
    try{ return res.sendFile(path.join(clientDist,'index.html')); } catch{} 
  }
  next();
});

app.listen(PORT,()=>console.log(`Server listening on http://localhost:${PORT}`));

import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import crypto from 'crypto';
// added
import fs from 'fs'; 

dotenv.config();
// beginning of additions
// Resolve file location relative to this index.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// If the JSON file is next to index.js in server/
const CATEGORY_DESCRIPTOR_PATH = path.join(__dirname, 'event_category_descriptors.json');
/**
 * Shape of the file (structure of tags):
 * {
 *   "categories": {
 *     "Career Development": {
 *       "label": "Career Development",
 *       "must_include_any": [...],
 *       "exclude_if_any": [...],
 *       "description": "..."
 *     },
 *     ...
 *   }
 * }
 */
// Load the JSON once at boot
let CATEGORY_RULES = { categories: {} };
try {
  const raw = fs.readFileSync(CATEGORY_DESCRIPTOR_PATH, 'utf8');
  CATEGORY_RULES = JSON.parse(raw);
  console.log(
    '[categories] loaded',
    Object.keys(CATEGORY_RULES.categories || {}).length,
    'categories from',
    CATEGORY_DESCRIPTOR_PATH
  );
} catch (e) {
  console.warn(
    'Could not read event_category_descriptors.json. Category filtering will be empty.',
    e
  );
}

// Organization based filters (organization_events.json) 
const ORG_DESCRIPTOR_PATH = path.join(__dirname, 'organization_events.json');

let ORGANIZATION_RULES = { categories: {} };
try {
  const rawOrg = fs.readFileSync(ORG_DESCRIPTOR_PATH, 'utf8');
  ORGANIZATION_RULES = JSON.parse(rawOrg);
  console.log(
    '[org-categories] loaded',
    Object.keys(ORGANIZATION_RULES.categories || {}).length,
    'top-level org categories from',
    ORG_DESCRIPTOR_PATH
  );
} catch (e) {
  console.warn(
    'Could not read organization_events.json. Org category filtering will be empty.',
    e
  );
}
// ending of additions 

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

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

// beginning of additions

// ---- Key normalization helpers (add near the top, after JSON loads) ----
const slug = (s = "") =>
  String(s)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_:]/g, ""); // keep letters, digits, underscores, and colons

const lowerArray = (arr = []) => arr.map(x => String(x).toLowerCase());

// --- Filtering helper Functions (event category classification) ---
// normalize and test text
function toTextBlob(ev) {
  //combining fields together
  const { title = '', description = '', location = ''} = ev || {};
  return `${title} ${description} ${location}`.toLowerCase(); 
}

//is a non case sensitive match
function matchesAnyKeyword(blob, keywords = []) {
  const b = String(blob || "").toLowerCase();
  return keywords.some(kw => b.includes(String(kw).toLowerCase()));
}

/**
 * assignCategories(ev) -> array of category keys
 * Uses CATEGORY_RULES.categories[*].must_include_any / exclude_if_any
 * Logic:
 *  - If must_include_any is present: require at least one to appear
 *  - If exclude_if_any contains a hit: skip that category
 */
function assignCategories(ev) {
  const blob = toTextBlob(ev);
  const out = [];

  const cats = CATEGORY_RULES?.categories || {};
  for (const [key, def] of Object.entries(cats)) {
    const must = def.must_include_any || [];
    const exc  = def.exclude_if_any || [];

    // If must_include_any exists and none hit -> skip
    if (must.length > 0 && !matchesAnyKeyword(blob, must)) continue;

    // If any excluded keyword hits -> skip
    if (exc.length > 0 && matchesAnyKeyword(blob, exc)) continue;

    out.push(key); // match!
  }
  return out;
}

// --- Organization-level classification ---
function assignOrgCategories(ev) {
  const blob = toTextBlob(ev);
  const out = [];

  const cats = ORGANIZATION_RULES?.categories || {};
  for (const [typeKeyRaw, typeDef] of Object.entries(cats)) {
    const typeKey = slug(typeKeyRaw);
    const subcats = typeDef?.subcategories || {};
    let sawChild = false;

    // Optional: if type-level must_include_any is used
    const typeHit = Array.isArray(typeDef?.must_include_any) &&
                    matchesAnyKeyword(blob, lowerArray(typeDef.must_include_any));
    if (typeHit) out.push(typeKey);

    for (const [subKeyRaw, subDef] of Object.entries(subcats)) {
      const subKey = slug(subKeyRaw);

      const subHit = Array.isArray(subDef?.must_include_any) &&
                     matchesAnyKeyword(blob, lowerArray(subDef.must_include_any));
      if (subHit) {
        out.push(`${typeKey}:${subKey}`);
        sawChild = true;
      }

      const orgs = subDef?.organizations || {};
      for (const [orgKeyRaw, orgDef] of Object.entries(orgs)) {
        const orgKey = slug(orgKeyRaw);
        const orgHit = Array.isArray(orgDef?.must_include_any) &&
                       matchesAnyKeyword(blob, lowerArray(orgDef.must_include_any));
        if (orgHit) {
          out.push(`${typeKey}:${subKey}:${orgKey}`);
          sawChild = true;
        }
      }
    }

    // If any child matched but we didn’t add the bare type yet, include it
    if (sawChild && !out.includes(typeKey)) out.push(typeKey);
  }

  return out;
}

// ending of additions 

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

    //deleted this 
   /* res.json({ events:[...drafts,...allEvents] });
  } catch(e){ console.error(e); res.status(500).json({error:'Failed to fetch events'}); } */
    
   // --- Combine and normalize tags ---
  const combined = [...drafts, ...allEvents].map(ev => {
    const catKeys = assignCategories(ev).map(slug);      // normalize category keys
    const orgKeys = assignOrgCategories(ev).map(slug);   // normalize org-category keys
    return { ...ev, categories: catKeys, orgCategories: orgKeys };
  });

  // Helper: identify ListServ events so only they get filtered away
  const isListServ = (ev) => {
    const isDraft = ev.source === 'draft';
    const isGoogleListServ = ev.source === 'google' && ev.calendarId === listservCalendarId;
    return isDraft || isGoogleListServ;
  };

  // Apply filters ONLY to ListServ events; non-ListServ always pass through
  //let filtered = combined;

  // --- Normalize query params so case/space differences don't break filtering ---
const reqCatParam = req.query.categories;
const reqOrgParam = req.query.orgCategories;

const reqCats = reqCatParam
  ? reqCatParam.split(',').map(s => slug(s.trim())).filter(Boolean)
  : null;

const reqOrgCats = reqOrgParam
  ? reqOrgParam.split(',').map(s => slug(s.trim())).filter(Boolean)
  : null;

// Apply filters ONLY to ListServ events; non-ListServ always pass through
let filtered = combined;
if (reqCats || reqOrgCats) {
  filtered = combined.filter(ev => {
    if (!isListServ(ev)) return true; // keep non-ListServ always

    if (!reqCats && !reqOrgCats) return true;

    if (reqCats && !(ev.categories?.some(c => reqCats.includes(c)))) {
      return false;
    }

    if (reqOrgCats && !(ev.orgCategories?.some(c => reqOrgCats.includes(c)))) {
      return false;
    }

    return true;
  });
}

res.json({ events: filtered });
  } catch(e) {
    console.error(e);
    res.status(500).json({error:'Failed to reach events'}); 
  }
}); 

//returns category labels from the JSON (left panel) - more additions
app.get('/api/event-categories', ensureAuthed, (req, res) => {
  const cats = CATEGORY_RULES?.categories || {};
  const list = Object.entries(cats).map(([rawKey, def]) => ({
    key: slug(rawKey),                             // <- normalized key
    label: def.label || rawKey,                    // human label stays pretty
    description: def.description || ''
  }));
  res.json({ categories: list });
});

// --- Org categories → flat list for bubbles on the left panel
app.get('/api/org-categories', ensureAuthed, (req, res) => {
  const cats = ORGANIZATION_RULES?.categories || {};
  const list = [];

  for (const [typeKeyRaw, typeDef] of Object.entries(cats)) {
    const typeKey = slug(typeKeyRaw);
    const typeLabel = typeDef.label || typeKeyRaw;
    list.push({ key: typeKey, label: typeLabel, level: "type" });

    const subcats = typeDef.subcategories || {};
    for (const [subKeyRaw, subDef] of Object.entries(subcats)) {
      const subKey = slug(subKeyRaw);
      const subLabel = subDef.label || subKeyRaw;
      const subFlatKey = `${typeKey}:${subKey}`;
      list.push({
        key: subFlatKey,
        label: `${typeLabel} • ${subLabel}`,
        level: "subcategory",
      });

      const orgs = subDef.organizations || {};
      for (const [orgKeyRaw, orgDef] of Object.entries(orgs)) {
        const orgKey = slug(orgKeyRaw);
        const orgLabel = orgDef.label || orgKeyRaw;
        const orgFlatKey = `${typeKey}:${subKey}:${orgKey}`;
        list.push({
          key: orgFlatKey,
          label: orgLabel,
          level: "organization",
        });
      }
    }
  }

  res.json({ categories: list });
});

    //ending of additions 

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

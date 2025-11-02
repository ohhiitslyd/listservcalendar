// App.jsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import FullCalendarReact from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

// Optional: FullCalendar CSS (if not already included globally)
// import '@fullcalendar/common/main.css';
// import '@fullcalendar/daygrid/main.css';
// import '@fullcalendar/timegrid/main.css';

function App() {
    const [user, setUser] = useState(null);
    const [calendars, setCalendars] = useState([]); // list of calendar metadata from /api/calendars
    const [visibleCalendars, setVisibleCalendars] = useState(new Set());
    const [events, setEvents] = useState([]);
    const [listservCalendarId, setListservCalendarId] = useState(null); // id for ListServ Events calendar
    const calendarRef = useRef();

    // Fetch current user
    const fetchMe = async () => {
        const res = await fetch('/api/me', { credentials: 'include' });
        const data = await res.json();
        setUser(data.user);
    };

    // Fetch calendars and set defaults
    const fetchCalendars = async () => {
        const res = await fetch('/api/calendars', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const items = data.calendars || [];
        setCalendars(items);

        // find listserv calendar id if present
        const ls = items.find(c => c.summary && c.summary.toLowerCase() === 'listserv events');
        if (ls) setListservCalendarId(ls.id);

        // Default visible: primary + listserv (if exists)
        const defaults = items
            .filter(c => c.primary || (c.summary && c.summary.toLowerCase() === 'listserv events'))
            .map(c => c.id);

        // If nothing matched (rare), default to 'primary'
        if (defaults.length === 0) defaults.push('primary');

        setVisibleCalendars(new Set(defaults));
        // fetch events for defaults
        await fetchEvents(defaults);
    };

    // Fetch working calendar info (optional)
    const fetchWorkingCalendar = async () => {
        const res = await fetch('/api/calendar', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.id) {
            setListservCalendarId(data.id);
        }
    };

    // Fetch events for the selected calendar IDs
    const fetchEvents = useCallback(async (calendarIds) => {
        const ids = calendarIds || Array.from(visibleCalendars);
        const query = ids && ids.length ? `?calendarIds=${encodeURIComponent(ids.join(','))}` : '';
        const res = await fetch(`/api/events${query}`, { credentials: 'include' });
        if (res.status === 401) {
            setEvents([]);
            return;
        }
        const data = await res.json();
        // FullCalendar accepts { id, title, start, end, allDay } — our backend provides these
        // also includes calendarId for google events (in extended props)
        const transformed = (data.events || []).map(ev => {
            // If google event came from a specific calendar, pass calendarId as extended prop
            const base = {
                id: ev.id,
                title: ev.title,
                start: ev.start,
                end: ev.end,
                allDay: !!ev.allDay,
                extendedProps: {
                    source: ev.source,
                    calendarId: ev.calendarId || null
                }
            };
            return base;
        });
        setEvents(transformed);
    }, [visibleCalendars]);

    useEffect(() => {
        fetchMe();
    }, []);

    // once we have a user, fetch calendars and working calendar info
    useEffect(() => {
        if (user) {
            fetchCalendars();
            fetchWorkingCalendar();
        } else {
            setCalendars([]);
            setVisibleCalendars(new Set());
            setEvents([]);
            setListservCalendarId(null);
        }
    }, [user]);

    // Helper to toggle calendar visibility
    const toggleCalendar = async (calId) => {
        const newSet = new Set(visibleCalendars);
        if (newSet.has(calId)) newSet.delete(calId);
        else newSet.add(calId);
        setVisibleCalendars(newSet);
        await fetchEvents(Array.from(newSet));
    };

    const login = () => {
        window.location.href = '/auth/google';
    };

    const logout = async () => {
        await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
        setUser(null);
        setEvents([]);
    };

    // Create a local draft (same as before)
    const onSelect = async (selectionInfo) => {
        if (!user) return;
        const title = window.prompt('Event title (draft):');
        if (title === null) {
            const api = calendarRef.current?.getApi();
            api?.unselect();
            return;
        }

        const allDay = selectionInfo.allDay;
        const body = {
            title,
            start: selectionInfo.startStr,
            end: selectionInfo.endStr,
            allDay
        };
        const res = await fetch('/api/drafts', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.id) {
            // refetch currently visible calendars
            await fetchEvents(Array.from(visibleCalendars));
        } else {
            alert('Failed to create draft');
        }
    };

    // Event click behavior — restrict edits to ListServ Events calendar
    const onEventClick = async (clickInfo) => {
        const ev = clickInfo.event;
        const id = ev.id; // 'draft:...' or 'google:...'
        const source = ev.extendedProps?.source || (id.startsWith('draft:') ? 'draft' : 'google');

        if (source === 'draft') {
            const choice = window.prompt(`Draft: ${ev.title}\nChoose: Publish / Delete / Cancel`);
            if (!choice) return;
            const lower = choice.toLowerCase();
            if (lower === 'delete') {
                if (!window.confirm('Delete this draft?')) return;
                await fetch(`/api/events/${encodeURIComponent(id)}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                await fetchEvents(Array.from(visibleCalendars));
            } else if (lower === 'publish') {
                const res = await fetch(`/api/events/${encodeURIComponent(id)}/publish`, {
                    method: 'POST',
                    credentials: 'include'
                });
                if (!res.ok) {
                    alert('Failed to publish draft');
                }
                await fetchEvents(Array.from(visibleCalendars));
            }
            return;
        }

        // source === 'google'
        const calendarId = ev.extendedProps?.calendarId;
        const isListServEvent = listservCalendarId && calendarId === listservCalendarId;

        if (!isListServEvent) {
            // Not editable — just show info
            window.alert('This event is not part of the ListServ Events calendar. Edits are only allowed for ListServ Events.');
            return;
        }

        // If it belongs to ListServ Events, allow delete (or other actions)
        const choice = window.prompt(`Event: ${ev.title}\nChoose: Delete / Cancel`);
        if (!choice) return;
        if (choice.toLowerCase() === 'delete') {
            if (!window.confirm('Delete this event from ListServ Events (and Google)?')) return;
            // id is in form google:<rawId>
            await fetch(`/api/events/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            await fetchEvents(Array.from(visibleCalendars));
        }
    };

    // manual refresh
    const refresh = () => fetchEvents(Array.from(visibleCalendars));

    return (
        <div style={{ maxWidth: 1200, margin: '20px auto', padding: 16 }}>
            <h2>Calendar Sync (ListServ)</h2>

            <div style={{ marginBottom: 12 }}>
                {user ? (
                    <div>
                        <span>Signed in as {user.name || user.email}</span>
                        <button style={{ marginLeft: 8 }} onClick={logout}>Logout</button>
                        <button style={{ marginLeft: 8 }} onClick={refresh}>Refresh</button>
                    </div>
                ) : (
                    <button onClick={login}>Sign in with Google</button>
                )}
            </div>

            <div style={{ marginBottom: 12 }}>
                <strong>Calendars</strong>
                <div style={{ marginTop: 8 }}>
                    {calendars.length === 0 && <div style={{ fontStyle: 'italic' }}>No calendars loaded</div>}
                    {calendars.map(c => {
                        const isListServ = c.summary && c.summary.toLowerCase() === 'listserv events';
                        return (
                            <label key={c.id} style={{ marginRight: 12, display: 'inline-flex', alignItems: 'center' }}>
                                <input
                                    type="checkbox"
                                    checked={visibleCalendars.has(c.id)}
                                    onChange={() => toggleCalendar(c.id)}
                                    disabled={isListServ} // <-- disable ListServ checkbox
                                    style={{ marginRight: 6 }}
                                />
                                <span>{c.summary}{c.primary ? ' (primary)' : ''}{isListServ ? ' (ListServ)' : ''}</span>
                            </label>
                        );
                    })}
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: '#444' }}>
                    <div>Notes: Primary calendar and ListServ Events are visible by default. Edits (publish/delete) are only allowed on the ListServ Events calendar.</div>
                </div>
            </div>

            <div>
                <FullCalendarReact
                    ref={calendarRef}
                    plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                    headerToolbar={{
                        left: 'prev,next today',
                        center: 'title',
                        right: 'timeGridWeek,timeGridDay'
                    }}
                    initialView="timeGridWeek"
                    selectable={true}
                    selectMirror={true}
                    select={onSelect}
                    events={events}
                    eventClick={onEventClick}
                    height="auto"
                />
            </div>

            <p style={{ marginTop: 16 }}>
                Notes:
                <br />- Click and drag on the calendar to create a draft event (local).
                <br />- Click a draft to Publish (creates in ListServ Events) or Delete (local).
                <br />- Click a Google event from ListServ Events to Delete it from both app and Google.
                <br />- Google events from other calendars are read-only in this UI.
            </p>
        </div>
    );
}

export default App;

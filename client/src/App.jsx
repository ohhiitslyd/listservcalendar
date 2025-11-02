import React, { useEffect, useState, useCallback, useRef } from 'react';
import FullCalendarReact from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

function App() {
    const [user, setUser] = useState(null);
    const [events, setEvents] = useState([]);
    const calendarRef = useRef();

    const fetchMe = async () => {
        const res = await fetch('/api/me', { credentials: 'include' });
        const data = await res.json();
        setUser(data.user);
    };

    const fetchEvents = useCallback(async () => {
        const res = await fetch('/api/events', { credentials: 'include' });
        if (res.status === 401) return setEvents([]);
        const data = await res.json();
        setEvents(data.events || []);
    }, []);

    useEffect(() => {
        fetchMe();
    }, []);

    useEffect(() => {
        if (user) fetchEvents();
    }, [user, fetchEvents]);

    const login = () => {
        window.location.href = '/auth/google';
    };

    const logout = async () => {
        await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
        setUser(null);
        setEvents([]);
    };

    const onSelect = async (selectionInfo) => {
        if (!user) return;
        // Simple prompt UI for title
        const title = window.prompt('Event title (draft):');
        if (title === null) {
            // cancelled
            const api = calendarRef.current?.getApi();
            api?.unselect();
            return;
        }

        const allDay = selectionInfo.allDay;
        // For all-day, FullCalendar gives startStr EndStr in YYYY-MM-DD format
        // For timed, they are ISO strings.
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
            await fetchEvents();
        } else {
            alert('Failed to create draft');
        }
    };

    const onEventClick = async (clickInfo) => {
        const ev = clickInfo.event;
        const id = ev.id; // in form 'draft:...' or 'google:...'
        const isDraft = id.startsWith('draft:');

        const options = isDraft
            ? ['Publish', 'Delete', 'Cancel']
            : ['Delete', 'Cancel'];

        const choice = window.prompt(`Event: ${ev.title}\nChoose: ${options.join(' / ')}`);
        if (!choice) return;

        if (choice.toLowerCase() === 'delete') {
            if (!window.confirm('Delete this event?')) return;
            await fetch(`/api/events/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            await fetchEvents();
        } else if (isDraft && choice.toLowerCase() === 'publish') {
            const res = await fetch(`/api/events/${encodeURIComponent(id)}/publish`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) {
                alert('Failed to publish draft');
            }
            await fetchEvents();
        }
    };

    return (
        <div style={{ maxWidth: 1200, margin: '20px auto', padding: 16 }}>
            <h2>Calendar Sync</h2>
            <div style={{ marginBottom: 12 }}>
                {user ? (
                    <div>
                        <span>Signed in as {user.name || user.email}</span>
                        <button style={{ marginLeft: 8 }} onClick={logout}>Logout</button>
                        <button style={{ marginLeft: 8 }} onClick={fetchEvents}>Refresh</button>
                    </div>
                ) : (
                    <button onClick={login}>Sign in with Google</button>
                )}
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
                <br />- Click and drag on the calendar to create a draft event (not published).
                <br />- Click a draft to Publish or Delete.
                <br />- Click a Google event to Delete it from both the app and Google Calendar.
            </p>
        </div>
    );
}

export default App;
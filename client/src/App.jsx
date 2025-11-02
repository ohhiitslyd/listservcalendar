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

        const options = isDraft ? ['Publish', 'Delete', 'Cancel'] : ['Delete', 'Cancel'];

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
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                overflow: 'hidden'
            }}
        >
            {/* Fixed Header */}
            <div
                style={{
                    flexShrink: 0,
                    padding: '20px',
                    borderBottom: '1px solid #ddd',
                    backgroundColor: '#fff'
                }}
            >
                <h2 style={{ margin: 0, marginBottom: 12 }}>Calendar Sync</h2>
                <div style={{ marginBottom: 12 }}>
                    {user ? (
                        <div>
                            <span>Signed in as {user.name || user.email}</span>
                            <button style={{ marginLeft: 8 }} onClick={logout}>
                                Logout
                            </button>
                            <button style={{ marginLeft: 8 }} onClick={fetchEvents}>
                                Refresh
                            </button>
                        </div>
                    ) : (
                        <button onClick={login}>Sign in with Google</button>
                    )}
                </div>
            </div>

            {/* Main Content Area with Panels */}
            <div
                style={{
                    flex: 1,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'row'
                }}
            >
                {/* Left Panel - Filtering (Future) */}
                <div
                    style={{
                        flexShrink: 0,
                        width: '250px',
                        borderRight: '1px solid #ddd',
                        backgroundColor: '#f9f9f9',
                        padding: '20px',
                        overflow: 'auto'
                    }}
                >
                    <h3 style={{ marginTop: 0, fontSize: '14px', fontWeight: '600' }}>Filters</h3>
                    <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>Filtering panel placeholder</p>
                </div>

                {/* Calendar Container - Fixed Header, Scrollable Body */}
                <div
                    style={{
                        flex: 1,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '20px'
                    }}
                >
                    <div
                        style={{
                            flex: 1,
                            overflow: 'hidden',
                            minHeight: 0
                        }}
                    >
                        <FullCalendarReact
                            ref={calendarRef}
                            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                            headerToolbar={{
                                left: 'prev,next today',
                                center: 'title',
                                right: 'dayGridMonth,timeGridWeek,timeGridDay'
                            }}
                            initialView="dayGridMonth"
                            selectable={true}
                            selectMirror={true}
                            select={onSelect}
                            events={events}
                            eventClick={onEventClick}
                            height="100%"
                        />
                    </div>
                </div>

                {/* Right Panel - Event Details (Future) */}
                <div
                    style={{
                        flexShrink: 0,
                        width: '300px',
                        borderLeft: '1px solid #ddd',
                        backgroundColor: '#f9f9f9',
                        padding: '20px',
                        overflow: 'auto'
                    }}
                >
                    <h3 style={{ marginTop: 0, fontSize: '14px', fontWeight: '600' }}>Event Details</h3>
                    <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>Event card display placeholder</p>
                </div>
            </div>

            {/* Optional Fixed Footer */}
            <div
                style={{
                    flexShrink: 0,
                    padding: '16px 20px',
                    borderTop: '1px solid #ddd',
                    backgroundColor: '#fff',
                    fontSize: '12px',
                    color: '#666'
                }}
            >
                <p style={{ margin: 0 }}>
                    Notes: Click and drag to create a draft event. Click a draft to Publish or Delete. Click a Google
                    event to Delete it from both the app and Google Calendar.
                </p>
            </div>
        </div>
    );
}

export default App;

import React, { useContext } from "react";
import { AppContext } from "../../context/AppContext";
import "./Header.css";

export const Header = () => {
  const { user, login, logout, calendars, visibleCalendars, toggleCalendar } =
    useContext(AppContext);

  return (
    <div className="app-header">
      <h2>Calendar Sync (ListServ)</h2>

      <div className="app-header-controls">
        {user ? (
          <div>
            <span>Signed in as {user.name || user.email}</span>
            <button className="app-header-button" onClick={logout}>
              Logout
            </button>
            <button className="app-header-button" onClick={() => window.location.reload()}>
              Refresh
            </button>
          </div>
 ) : (
          <button onClick={login}>Sign in with Google</button>
        )}
      </div>

      {/* Calendar selection list – shows only when signed in */}
      {user && calendars.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Calendars</strong>
          <div style={{ marginTop: 8 }}>
            {calendars.map(c => {
              const isListServ = c.summary?.toLowerCase() === "listserv events";
              return (
                <label
                  key={c.id}
                  style={{
                    marginRight: 12,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={visibleCalendars.has(c.id)}
                    onChange={() => toggleCalendar(c.id)}
                    disabled={isListServ}
                    style={{ marginRight: 6 }}
                  />
                  <span>
                    {c.summary}
                    {c.primary ? " (primary)" : ""}
                    {isListServ ? " (ListServ)" : ""}
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#444" }}>
            <div>
              Notes: Primary calendar and ListServ Events are visible by default.
              Edits (publish/delete) are only allowed on the ListServ Events
              calendar.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
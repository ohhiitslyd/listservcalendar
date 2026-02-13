import React, { useContext, useState, useRef, useEffect } from "react";
import { AppContext } from "../../context/AppContext";
import "./Header.css";

export const Header = ({ onPublish, onLogout, onMobileFiltersToggle, mobileFiltersOpen }) => {
  const { 
    user, 
    login, 
    logout, 
    calendars, 
    visibleCalendars, 
    toggleCalendar,
    selectedCats,
    selectedOrgCats,
  } = useContext(AppContext);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [userCalendarsOpen, setUserCalendarsOpen] = useState(false);
  const userMenuRef = useRef(null);
  const calendarsMenuRef = useRef(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
      if (calendarsMenuRef.current && !calendarsMenuRef.current.contains(event.target)) {
        setUserCalendarsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);


  // Get user initials for avatar
  const getUserInitials = () => {
    if (!user) return "";
    const name = user.name || user.email || "";
    const parts = name.split(" ").filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Get user name (just the name, initials are in the avatar)
  const getUserName = () => {
    if (!user) return "";
    return user.name || user.email || "";
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  if (!user) {
    return (
      <div className="app-header">
        <div className="app-header-left">
          <div className="app-header-logo">
            <svg className="calendar-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke="#d4e9c4" strokeWidth="2" fill="none"/>
              <line x1="16" y1="2" x2="16" y2="6" stroke="#d4e9c4" strokeWidth="2" strokeLinecap="round"/>
              <line x1="8" y1="2" x2="8" y2="6" stroke="#d4e9c4" strokeWidth="2" strokeLinecap="round"/>
              <line x1="3" y1="10" x2="21" y2="10" stroke="#d4e9c4" strokeWidth="2"/>
            </svg>
            <h2>CalendarSync</h2>
          </div>
        </div>
        <div className="app-header-right">
          <button className="app-header-button" onClick={login}>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-header">
      <div className="app-header-left">
        {onMobileFiltersToggle && (
          <button
            className="mobile-menu-button"
            onClick={onMobileFiltersToggle}
            aria-label="Toggle filters"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
        )}
        <div className="app-header-logo">
          <svg className="calendar-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke="#d4e9c4" strokeWidth="2" fill="none"/>
            <line x1="16" y1="2" x2="16" y2="6" stroke="#d4e9c4" strokeWidth="2" strokeLinecap="round"/>
            <line x1="8" y1="2" x2="8" y2="6" stroke="#d4e9c4" strokeWidth="2" strokeLinecap="round"/>
            <line x1="3" y1="10" x2="21" y2="10" stroke="#d4e9c4" strokeWidth="2"/>
          </svg>
          <h2 className="app-header-title">ListServCalendar</h2>
        </div>
        
        <button
          className="app-header-button publish-button"
          onClick={onPublish}
        >
          <span className="publish-button-text">Publish to Google Calendar</span>
          <svg className="publish-button-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
        </button>

        <div className="dropdown-container" ref={calendarsMenuRef}>
          <button
            className="app-header-button calendars-button"
            onClick={() => setUserCalendarsOpen(!userCalendarsOpen)}
            type="button"
          >
            My Calendars
            <svg 
              className={`dropdown-arrow ${userCalendarsOpen ? 'open' : ''}`} 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              style={{ marginLeft: '6px' }}
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          {userCalendarsOpen && (
            <div className="dropdown-content calendars-dropdown">
              <div className="calendars-dropdown-header">
                <h4>My Calendars</h4>
              </div>
              <div className="calendars-list">
                {calendars.length > 0 ? (
                  calendars
                    .sort((a, b) => {
                      const aName = a.summary?.toLowerCase() || "";
                      const bName = b.summary?.toLowerCase() || "";
                      const aIsListServ = aName === "listserv events";
                      const bIsListServ = bName === "listserv events";
                      if (aIsListServ && !bIsListServ) return -1;
                      if (!aIsListServ && bIsListServ) return 1;

                      const aIsPrimary = !!a.primary;
                      const bIsPrimary = !!b.primary;
                      if (aIsPrimary && !bIsPrimary) return -1;
                      if (!aIsPrimary && bIsPrimary) return 1;

                      return aName.localeCompare(bName);
                    })
                    .map(c => {
                      const isListServ = c.summary?.toLowerCase() === "listserv events";
                      const isVisible = visibleCalendars.has(c.id);
                      return (
                        <label 
                          key={c.id} 
                          className={`calendar-item ${!isListServ ? 'calendar-item-other' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isVisible}
                            onChange={() => toggleCalendar(c.id)}
                            disabled={isListServ}
                          />
                          <span className="calendar-name">
                            {c.summary}
                            {c.primary && <span className="calendar-badge">primary</span>}
                            {isListServ && <span className="calendar-badge">ListServ</span>}
                          </span>
                        </label>
                      );
                    })
                ) : (
                  <div className="user-menu-empty">No calendars available.</div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      <div className="app-header-right">
        <button className="app-header-button refresh-button" onClick={handleRefresh}>
          <svg className="refresh-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
          <span className="button-text">Refresh</span>
        </button>
        <div className="dropdown-container" ref={userMenuRef}>
          <button
            className="user-account user-account-button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            type="button"
          >
            <div className="user-avatar">{getUserInitials()}</div>
            <span className="user-name">{getUserName()}</span>
          </button>
          {userMenuOpen && (
            <div className="dropdown-content user-menu-dropdown">
              <button className="user-menu-item" onClick={onLogout} type="button">
                <span>Log Out</span>
                <svg className="logout-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
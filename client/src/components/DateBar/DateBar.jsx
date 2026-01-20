// src/components/DateBar/DateBar.jsx
import React, { useContext, useState, useEffect } from "react";
import { AppContext } from "../../context/AppContext";
import "./DateBar.css";

export const DateBar = () => {
  const { calendarRef, currentViewRange } = useContext(AppContext);
  const [currentView, setCurrentView] = useState("timeGridWeek");
  const [dateRange, setDateRange] = useState("");

  // Update date range when view changes
  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (!api) return;

    const updateDateRange = () => {
      const view = api.view;
      const start = view.activeStart;
      const end = view.activeEnd;
      
      if (view.type === "timeGridWeek") {
        // Format as "Nov 9 - 15, 2025" or "Jan 25 - 31, 2026"
        const startMonth = start.toLocaleDateString("en-US", { month: "short" });
        const startDay = start.getDate();
        const year = start.getFullYear();
        
        // Calculate the last day of the week (end is exclusive, so subtract 1 day)
        const endDate = new Date(end);
        endDate.setDate(endDate.getDate() - 1);
        const endDay = endDate.getDate();
        const endMonth = endDate.toLocaleDateString("en-US", { month: "short" });
        
        // If the week spans two months, show both months: "Jan 25 - Feb 1, 2026"
        // Otherwise show single month: "Jan 25 - 31, 2026"
        if (startMonth === endMonth) {
          setDateRange(`${startMonth} ${startDay} - ${endDay}, ${year}`);
        } else {
          const endYear = endDate.getFullYear();
          setDateRange(`${startMonth} ${startDay} - ${endMonth} ${endDay}, ${endYear}`);
        }
      } else if (view.type === "timeGridDay") {
        // Format as "Nov 9, 2025"
        const month = start.toLocaleDateString("en-US", { month: "short" });
        const day = start.getDate();
        const year = start.getFullYear();
        setDateRange(`${month} ${day}, ${year}`);
      }
      
      setCurrentView(view.type);
    };

    updateDateRange();
    
    // Listen for view changes
    api.on("datesSet", updateDateRange);
    api.on("viewChange", updateDateRange);

    return () => {
      api.off("datesSet", updateDateRange);
      api.off("viewChange", updateDateRange);
    };
  }, [calendarRef, currentViewRange]);

  const handlePrev = () => {
    const api = calendarRef.current?.getApi?.();
    if (api) {
      api.prev();
    }
  };

  const handleNext = () => {
    const api = calendarRef.current?.getApi?.();
    if (api) {
      api.next();
    }
  };

  const handleToday = () => {
    const api = calendarRef.current?.getApi?.();
    if (api) {
      api.today();
    }
  };

  const handleWeekView = () => {
    const api = calendarRef.current?.getApi?.();
    if (api) {
      api.changeView("timeGridWeek");
    }
  };

  const handleDayView = () => {
    const api = calendarRef.current?.getApi?.();
    if (api) {
      api.changeView("timeGridDay");
    }
  };

  return (
    <div className="date-bar">
      <div className="date-bar-left">
        <div className="date-bar-navigation">
          <button 
            className="date-bar-arrow-btn" 
            onClick={handlePrev}
            aria-label="Previous"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <button 
            className="date-bar-arrow-btn" 
            onClick={handleNext}
            aria-label="Next"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
        <button className="date-bar-today-btn" onClick={handleToday}>
          Today
        </button>
        <button className="date-bar-date-range" onClick={handleToday}>
          {dateRange}
        </button>
      </div>
      <div className="date-bar-right">
        <button 
          className={`date-bar-view-btn ${currentView === "timeGridWeek" ? "active" : ""}`}
          onClick={handleWeekView}
        >
          Week
        </button>
        <button 
          className={`date-bar-view-btn ${currentView === "timeGridDay" ? "active" : ""}`}
          onClick={handleDayView}
        >
          Day
        </button>
      </div>
    </div>
  );
};


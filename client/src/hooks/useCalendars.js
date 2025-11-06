import { useContext } from "react";
import { AppContext } from "../context/AppContext";

export const useCalendars = () => {
  const {
    calendars,
    visibleCalendars,
    setVisibleCalendars,
    fetchEvents,
  } = useContext(AppContext);

  const toggleCalendar = async calId => {
    const newSet = new Set(visibleCalendars);
    newSet.has(calId) ? newSet.delete(calId) : newSet.add(calId);
    setVisibleCalendars(newSet);
    await fetchEvents(Array.from(newSet));
  };

  return { calendars, visibleCalendars, toggleCalendar };
};
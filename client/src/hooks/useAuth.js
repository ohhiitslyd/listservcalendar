import { useContext, useEffect } from "react";
import { AppContext } from "../context/AppContext";

export const useAuth = () => {
  const {
    user,
    login,
    logout,
    fetchMe,
    fetchCalendars,
    fetchWorkingCalendar,
  } = useContext(AppContext);

  // run once on mount
  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  // When we have a user, load calendars & listserv info
  useEffect(() => {
    if (user) {
      fetchCalendars();
      fetchWorkingCalendar();
    }
  }, [user, fetchCalendars, fetchWorkingCalendar]);

  return { user, login, logout };
};
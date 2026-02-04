import { useContext } from "react";
import { AppContext } from "../context/AppContext";
import { isGoogle, isCampus, getTag } from "../utils/helpers";

export const useEvents = () => {
  const {
    events,
    activeFilters,
    setActiveFilters,
  } = useContext(AppContext);

  // ---------------- Filtering helpers ----------------
  const toggleFilter = name => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const clearFilters = () => setActiveFilters(new Set());

  const applyFiltersToCalendar = api => {
    if (!api) return;
    const noneSelected = activeFilters.size === 0;
    api.batchRendering(() => {
      api.getEvents().forEach(evApi => {
        if (isGoogle(evApi) ||isCampus(evApi)) {
          evApi.setProp("display", "auto");
          return;
        }
        if (noneSelected) {
          evApi.setProp("display", "auto");
        } else {
          const tag = getTag(evApi);
          evApi.setProp("display", activeFilters.has(tag) ? "auto" : "none");
        }
      });
    });
  };

  return {
    events,
    activeFilters,
    toggleFilter,
    clearFilters,
    applyFiltersToCalendar,
  };
};
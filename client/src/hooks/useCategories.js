// src/hooks/useCategories.ts
import { useState, useCallback } from "react";
import { api } from "../api/calendarApi";

export const useCategories = () => {
  const [availableCats, setAvailableCats] = useState([]);

  // `user` is passed in from the caller – we only fetch when it exists
  const fetchCategories = useCallback(
    async (user) => {
      if (!user) {
        // Not logged in – skip the request
        setCats([]);
        return;
      }

      try {
        const data = await api.fetchCategories(); // already has credentials:"include"
        setAvailableCats(data.categories || []);
      } catch (err) {
        console.warn("Failed to load categories (maybe 401)", err);
        setAvailableCats([]);
      }
    },
    []
  );

  return { availableCats, fetchCategories };
};
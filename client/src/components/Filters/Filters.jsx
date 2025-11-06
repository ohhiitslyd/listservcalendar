// src/components/Filters/Filters.jsx
import React, { useContext } from "react";
import { AppContext } from "../../context/AppContext";
import "./Filters.css";

export const Filters = () => {
  const {
    availableCats,
    selectedCats,
    setSelectedCats,
    categoryCounts,
  } = useContext(AppContext);

  const clearAll = () => setSelectedCats(new Set());

  // Debug – you can remove this after it works
  console.log('Filters → availableCats:', availableCats);

  if (!availableCats.length) {
    return (
      <div style={{ color: "#9ca3af", fontSize: 13 }}>
        (No categories available)
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, flex: 1 }}>Filters</h3>
        <button onClick={clearAll} className="clear-filters-btn">
          Clear
        </button>
      </div>

      <div className="filter-bubbles">
        {availableCats.map((cat) => {
          const key   = cat.key;
          const label = cat.label || key;
          const active = selectedCats.has(key);
          const count  = categoryCounts[key] || 0;

          const toggle = () => {
            setSelectedCats((prev) => {
              const next = new Set(prev);
              next.has(key) ? next.delete(key) : next.add(key);
              return next;
            });
          };

          return (
            <button
              key={key}
              type="button"
              className={`filter-chip ${active ? "selected" : ""}`}
              onClick={toggle}
              title={cat.description || label}
            >
              <span className="chip-label">{label}</span>
              <span className="chip-count">{count}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};
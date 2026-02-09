// src/components/Filters/Filters.jsx
import React, { useContext, useState, useMemo, useEffect, useRef } from "react";
import { AppContext } from "../../context/AppContext";
import { api } from "../../api/calendarApi";
import "./Filters.css";

export const Filters = ({
  onClose,
  showHeader = true,
  onPendingKeyChange,
  onPendingCountChange,
  autoFocusOrgSearch = false,
  statusText,
  statusDotClass,
}) => {
  const {
    //tag level cats
    availableCats,
    selectedCats,
    setSelectedCats,
    categoryCounts,

    //org level cats
    availableOrgCats,
    selectedOrgCats,
    setSelectedOrgCats,
    orgCategoryCounts,

    //negative filter mode
    excludeMode,
    setExcludeMode,

    negativeFilterEnabled,
    setNegativeFilterEnabled,

    // events fetching
    fetchEvents,
    visibleCalendars,
    listservCalendarId,
    setEvents,
    refetchEventsWithParams,

    // color mapping
    tagColorMap,
  } = useContext(AppContext);

  const [activeTab, setActiveTab] = useState("event-types");
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const [orgSearch, setOrgSearch] = useState("");
  const orgSearchInputRef = useRef(null);

  // Local/pending state - only committed to context when "Apply Filters" is clicked
  const [pendingSelectedCats, setPendingSelectedCats] = useState(new Set(selectedCats));
  const [pendingSelectedOrgCats, setPendingSelectedOrgCats] = useState(new Set(selectedOrgCats));
  const [pendingExcludeMode, setPendingExcludeMode] = useState(excludeMode);

  // Skip the first effect run so we don't refetch when dropdown just opens
  const skipFirstPreviewRef = useRef(true);

  // When `autoFocusOrgSearch` is true (e.g. user clicked the left‑panel search bar),
  // focus and select the organization search input as soon as the drawer opens.
  useEffect(() => {
    if (autoFocusOrgSearch && orgSearchInputRef.current) {
      orgSearchInputRef.current.focus();
      orgSearchInputRef.current.select();
    }
  }, [autoFocusOrgSearch]);

  // Keep a ref of the latest pending state so we can commit it on unmount (when user closes dropdown)
  const pendingStateRef = useRef({
    pendingSelectedCats,
    pendingSelectedOrgCats,
    pendingExcludeMode,
  });
  useEffect(() => {
    pendingStateRef.current = {
      pendingSelectedCats,
      pendingSelectedOrgCats,
      pendingExcludeMode,
    };
  }, [pendingSelectedCats, pendingSelectedOrgCats, pendingExcludeMode]);

  // When dropdown closes (component unmounts), commit pending state to context so reopen shows same selection
  useEffect(() => {
    return () => {
      const { pendingSelectedCats: pCats, pendingSelectedOrgCats: pOrgCats, pendingExcludeMode: pExclude } = pendingStateRef.current;
      setSelectedCats(pCats);
      setSelectedOrgCats(pOrgCats);
      setExcludeMode(pExclude);
    };
  }, [setSelectedCats, setSelectedOrgCats, setExcludeMode]);

  // Initialize pending state from context when component mounts or context changes externally
  useEffect(() => {
    setPendingSelectedCats(new Set(selectedCats));
    setPendingSelectedOrgCats(new Set(selectedOrgCats));
    setPendingExcludeMode(excludeMode);
  }, [selectedCats, selectedOrgCats, excludeMode]);

  // When user toggles a checkbox, immediately refetch so the calendar reflects the change.
  // "Apply filters" is still used to save preferences and sync to the personalized Google calendar.
  useEffect(() => {
    if (skipFirstPreviewRef.current) {
      skipFirstPreviewRef.current = false;
      return;
    }
    if (!refetchEventsWithParams) return;
    refetchEventsWithParams(
      Array.from(pendingSelectedOrgCats),
      Array.from(pendingSelectedCats),
      pendingExcludeMode
    );
  }, [pendingSelectedOrgCats, pendingSelectedCats, pendingExcludeMode, refetchEventsWithParams]);

  const clearAll = () => {
    setPendingSelectedCats(new Set());
    setPendingSelectedOrgCats(new Set());
    setPendingExcludeMode(false);
  };

  // Calculate total selected count from pending state
  const totalSelected = pendingSelectedCats.size + pendingSelectedOrgCats.size;
  const pendingKey = useMemo(() => {
    const cats = Array.from(pendingSelectedCats).sort();
    const orgs = Array.from(pendingSelectedOrgCats).sort();
    return JSON.stringify({
      cats,
      orgs,
      exclude: !!pendingExcludeMode,
    });
  }, [pendingSelectedCats, pendingSelectedOrgCats, pendingExcludeMode]);

  useEffect(() => {
    if (onPendingKeyChange) {
      onPendingKeyChange(pendingKey);
    }
  }, [pendingKey, onPendingKeyChange]);

  useEffect(() => {
    if (onPendingCountChange) {
      onPendingCountChange(pendingSelectedCats.size + pendingSelectedOrgCats.size);
    }
  }, [pendingSelectedCats, pendingSelectedOrgCats, onPendingCountChange]);




  const toggleCategoryExpansion = (typeKey) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(typeKey)) {
        next.delete(typeKey);
      } else {
        next.add(typeKey);
      }
      return next;
    });
  };

  // Build hierarchical structure from flat org categories list
  const orgHierarchy = useMemo(() => {
    const hierarchy = {};
    
    // Safety check: ensure availableOrgCats is an array
    if (!availableOrgCats || !Array.isArray(availableOrgCats)) {
      return hierarchy;
    }

    // Process in order: types first, then subcategories, then organizations
    // This ensures parent nodes exist and aren't overwritten
    
    // Step 1: Add all types first
    availableOrgCats.forEach(cat => {
      if (!cat || !cat.key) return;
      const parts = cat.key.split(':');
      const level = cat.level || (parts.length === 1 ? 'type' : parts.length === 2 ? 'subcategory' : 'organization');
      
      if (level === 'type') {
        hierarchy[cat.key] = {
          key: cat.key,
          label: cat.label,
          level: 'type',
          subcategories: {},
          count: orgCategoryCounts[cat.key] || 0,
        };
      }
    });
    
    // Step 2: Add all subcategories
    availableOrgCats.forEach(cat => {
      if (!cat || !cat.key) return;
      const parts = cat.key.split(':');
      const level = cat.level || (parts.length === 1 ? 'type' : parts.length === 2 ? 'subcategory' : 'organization');
      
      if (level === 'subcategory') {
        const [typeKey] = parts;
        if (!hierarchy[typeKey]) {
          const typeEntry = availableOrgCats.find(c => {
            const cParts = c.key.split(':');
            const cLevel = c.level || (cParts.length === 1 ? 'type' : cParts.length === 2 ? 'subcategory' : 'organization');
            return c.key === typeKey && cLevel === 'type';
          });
          hierarchy[typeKey] = {
            key: typeKey,
            label: typeEntry?.label || typeKey,
            level: 'type',
            subcategories: {},
            count: 0,
          };
        }
        // Extract subcategory label (remove "Type • " prefix if present)
        const subLabel = cat.label.includes(' • ') 
          ? cat.label.split(' • ')[1] 
          : cat.label;
        // Only create if it doesn't exist to avoid overwriting organizations
        if (!hierarchy[typeKey].subcategories[cat.key]) {
          hierarchy[typeKey].subcategories[cat.key] = {
            key: cat.key,
            label: subLabel,
            level: 'subcategory',
            organizations: {},
            count: orgCategoryCounts[cat.key] || 0,
          };
        }
      }
    });
    
    // Step 3: Add all organizations LAST - this ensures subcategories already exist
    availableOrgCats.forEach(cat => {
      if (!cat || !cat.key) return;
      const parts = cat.key.split(':');
      const level = cat.level || (parts.length === 1 ? 'type' : parts.length === 2 ? 'subcategory' : 'organization');
      
      if (level === 'organization') {
        // For organization, key format is: typeKey:subKey:orgKey
        // parts = [typeKey, subKey, orgKey]
        if (parts.length < 3) {
          console.warn(`Invalid organization key format: ${cat.key} (expected type:subcategory:org)`);
          return;
        }
        const [typeKey, subKey] = parts;
        const orgKey = parts.slice(2).join(':'); // In case there are colons in the org key itself
        
        if (!hierarchy[typeKey]) {
          const typeEntry = availableOrgCats.find(c => {
            const cParts = c.key.split(':');
            const cLevel = c.level || (cParts.length === 1 ? 'type' : cParts.length === 2 ? 'subcategory' : 'organization');
            return c.key === typeKey && cLevel === 'type';
          });
          hierarchy[typeKey] = {
            key: typeKey,
            label: typeEntry?.label || typeKey,
            level: 'type',
            subcategories: {},
            count: 0,
          };
        }
        const subKeyFull = `${typeKey}:${subKey}`;
        if (!hierarchy[typeKey].subcategories[subKeyFull]) {
          const subEntry = availableOrgCats.find(c => {
            const cParts = c.key.split(':');
            const cLevel = c.level || (cParts.length === 1 ? 'type' : cParts.length === 2 ? 'subcategory' : 'organization');
            return c.key === subKeyFull && cLevel === 'subcategory';
          });
          const subLabel = subEntry?.label?.includes(' • ') 
            ? subEntry.label.split(' • ')[1] 
            : subEntry?.label || subKey;
          hierarchy[typeKey].subcategories[subKeyFull] = {
            key: subKeyFull,
            label: subLabel,
            level: 'subcategory',
            organizations: {},
            count: 0,
          };
        }
        // Add organization - this should always happen
        if (!hierarchy[typeKey].subcategories[subKeyFull].organizations[cat.key]) {
          hierarchy[typeKey].subcategories[subKeyFull].organizations[cat.key] = {
            key: cat.key,
            label: cat.label,
            level: "organization",
            count: orgCategoryCounts[cat.key] || 0,
            emails: Array.isArray(cat.emails) ? cat.emails : [],
          };
        }
      }
    });

    // Second pass: calculate parent counts from children (aggregate from leaf nodes only)
    Object.values(hierarchy).forEach((type) => {
      let typeCount = 0;
      Object.values(type.subcategories).forEach((sub) => {
        let subCount = 0;
        Object.values(sub.organizations).forEach((org) => {
          subCount += org.count;
        });
        sub.count = subCount;
        typeCount += subCount;
      });
      type.count = typeCount;
    });

    return hierarchy;
  }, [availableOrgCats, orgCategoryCounts]);

  const filteredOrgHierarchy = useMemo(() => {
    const term = orgSearch.trim().toLowerCase();
    if (!term) return orgHierarchy;

    const result = {};
    Object.values(orgHierarchy).forEach((type) => {
      const typeMatch = (type.label || "").toLowerCase().includes(term);
      const subcategories = {};

      Object.values(type.subcategories).forEach((sub) => {
        const subMatch = (sub.label || "").toLowerCase().includes(term);
        const organizations = {};

        Object.values(sub.organizations).forEach((org) => {
          const orgMatch = (org.label || "").toLowerCase().includes(term);
          if (orgMatch || subMatch || typeMatch) {
            organizations[org.key] = org;
          }
        });

        if (subMatch || typeMatch || Object.keys(organizations).length > 0) {
          subcategories[sub.key] = {
            ...sub,
            organizations,
          };
        }
      });

      if (typeMatch || Object.keys(subcategories).length > 0) {
        result[type.key] = {
          ...type,
          subcategories,
        };
      }
    });

    return result;
  }, [orgHierarchy, orgSearch]);

  // Color mapping for categories
  const getCategoryColor = (typeKey) => {
    const colors = {
      'sports': '#eaa993', // orange/red
      'music': '#93b3ea',  // blue
    };
    return colors[typeKey] || '#d4e9c4'; // default green
  };

  // All organizations under a type (flattened from all subcategories); no "Organizations" subcategory row in UI
  const getTypeOrganizations = (type) => {
    const orgs = [];
    Object.values(type.subcategories || {}).forEach((sub) => {
      Object.values(sub.organizations || {}).forEach((org) => orgs.push(org));
    });
    return orgs;
  };

  // Type is "all selected" when every organization under it is selected
  const areAllTypeChildrenSelected = (type, selectedSet) => {
    const orgs = getTypeOrganizations(type);
    return orgs.length > 0 && orgs.every((org) => selectedSet.has(org.key));
  };

  const hasSelectedInType = (type) => {
    if (pendingSelectedOrgCats.has(type.key)) return true;
    return getTypeOrganizations(type).some((org) => pendingSelectedOrgCats.has(org.key));
  };

  // Clear ALL filters in a given top-level type (its type key, subcategories, and orgs)
  const clearAllForType = (type) => {
    setPendingSelectedOrgCats((prev) => {
      const next = new Set(prev);
      // Remove the type key itself
      next.delete(type.key);
      // Remove all orgs under this type
      getTypeOrganizations(type).forEach((org) => {
        next.delete(org.key);
      });
      // Remove any subcategory keys under this type
      Object.values(type.subcategories || {}).forEach((sub) => {
        next.delete(sub.key);
      });
      return next;
    });
  };

  // Update parent selection: type (and sub keys for backend) based on whether all orgs are selected
  const updateParentSelection = (next, orgHierarchy) => {
    Object.values(orgHierarchy).forEach((type) => {
      const allOrgsSelected = areAllTypeChildrenSelected(type, next);
      if (allOrgsSelected) {
        next.add(type.key);
        Object.values(type.subcategories || {}).forEach((sub) => next.add(sub.key));
      } else {
        next.delete(type.key);
        Object.values(type.subcategories || {}).forEach((sub) => next.delete(sub.key));
      }
    });
  };

  const toggleOrgCategory = (key) => {
    setPendingSelectedOrgCats((prev) => {
      const next = new Set(prev);
      const isCurrentlySelected = next.has(key);
      
      if (isCurrentlySelected) {
        // Deselecting: remove this key and all its children
        next.delete(key);
        
        // Find and remove all children
        Object.values(orgHierarchy).forEach(type => {
          if (type.key === key) {
            // Type deselected - remove all subcategories and organizations
            Object.values(type.subcategories).forEach(sub => {
              next.delete(sub.key);
              Object.values(sub.organizations).forEach(org => {
                next.delete(org.key);
              });
            });
          } else {
            // Check subcategories
            Object.values(type.subcategories).forEach(sub => {
              if (sub.key === key) {
                // Subcategory deselected - remove all organizations
                Object.values(sub.organizations).forEach(org => {
                  next.delete(org.key);
                });
              }
            });
          }
        });
      } else {
        // Selecting: add this key and handle hierarchy
        
        // Determine the level of this key
        const parts = key.split(':');
        const level = parts.length === 1 ? 'type' : parts.length === 2 ? 'subcategory' : 'organization';
        
        if (level === 'type') {
          // Type selected - add type, all subcategories, and all organizations
          next.add(key);
          Object.values(orgHierarchy).forEach(type => {
            if (type.key === key) {
              Object.values(type.subcategories).forEach(sub => {
                next.add(sub.key);
                Object.values(sub.organizations).forEach(org => {
                  next.add(org.key);
                });
              });
            }
          });
        } else if (level === 'subcategory') {
          // Subcategory selected - add subcategory and all organizations (but NOT parent type yet)
          next.add(key);
          
          const [typeKey] = parts;
          Object.values(orgHierarchy).forEach(type => {
            if (type.key === typeKey) {
              Object.values(type.subcategories).forEach(sub => {
                if (sub.key === key) {
                  Object.values(sub.organizations).forEach(org => {
                    next.add(org.key);
                  });
                }
              });
            }
          });
        } else if (level === 'organization') {
          // Organization selected - add only the organization (NOT parent subcategory or type yet)
          next.add(key);
        }
      }
      
      // After making changes, update parent selections based on whether all children are selected
      updateParentSelection(next, orgHierarchy);
      
      return next;
    });
  };

  const toggleEventCategory = (key) => {
    setPendingSelectedCats((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

          return (
    <div className="filters-wrapper">
      {/* Header */}
      {showHeader && (
        <div className="filters-header">
          <div className="filters-header-left">
            <h4 className="filters-title">Filters</h4>
            {statusText && (
              <div className="filters-status">
                <span
                  className={`filters-status-dot ${statusDotClass || ""}`}
                />
                <span className="filters-status-text">
                  {statusText}
                </span>
              </div>
            )}
            {totalSelected > 0 && (
              <span className="filters-selected-count">
                {totalSelected} filters selected
              </span>
            )}
          </div>
        </div>
      )}

      

      {/* Tabs */}
      <div className="filters-tabs">
        <div className="filters-tabs-group">
          <button
            className={`filter-tab ${activeTab === 'event-types' ? 'active' : ''}`}
            onClick={() => setActiveTab('event-types')}
          >
            Event Types
          </button>
          <button
            className={`filter-tab ${activeTab === 'organizations' ? 'active' : ''}`}
            onClick={() => setActiveTab('organizations')}
          >
            Organizations
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="filters-content">
        <div className={`filters-clear-all-row ${activeTab === 'event-types' ? 'filters-clear-all-row-sticky' : ''}`}>
          <button
            onClick={clearAll}
            className="filters-clear-all-tab"
            type="button"
          >
            Clear all filters
          </button>
        </div>
        {activeTab === 'organizations' ? (
          <>
            <div className="org-filters-search">
              <input
                type="text"
                placeholder="Search organizations"
                value={orgSearch}
                onChange={(event) => setOrgSearch(event.target.value)}
                className="org-filters-search-input"
                ref={orgSearchInputRef}
              />
            </div>
            <div className="org-filters-list-wrapper">
            <div className="org-filters-list">
            {filteredOrgHierarchy && Object.values(filteredOrgHierarchy).map((type) => {
              const typeColor = getCategoryColor(type.key);
              const typeSelected = pendingSelectedOrgCats.has(type.key);
              const typePartiallySelected =
                !typeSelected && getTypeOrganizations(type).some((org) => pendingSelectedOrgCats.has(org.key));
              const typeHighlighted = typeSelected || typePartiallySelected;
              const typeFillColor = pendingExcludeMode ? "#f4b4b4" : typeColor;
              const typeBorderColor = pendingExcludeMode ? "#e07a7a" : typeColor;
              const isExpanded = expandedCategories.has(type.key) || !!orgSearch.trim();
              const typeOrgs = getTypeOrganizations(type);
              const typeOrgsSorted = [...typeOrgs].sort((a, b) => {
                const aSelected = pendingSelectedOrgCats.has(a.key);
                const bSelected = pendingSelectedOrgCats.has(b.key);
                if (aSelected !== bSelected) return aSelected ? -1 : 1;
                const aCount = a.count || 0;
                const bCount = b.count || 0;
                if (aCount !== bCount) return bCount - aCount;
                return String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" });
              });
              const hasOrganizations = typeOrgs.length > 0;

              return (
                <div key={type.key} className="org-filter-group">
                  {/* Type level */}
                  <div className="org-filter-item">
                    <label className="org-filter-label">
                      {hasOrganizations && (
                        <button
                          type="button"
                          className="org-filter-expand-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategoryExpansion(type.key);
                          }}
                        >
                          <svg
                            className={`org-filter-expand-icon ${isExpanded ? "expanded" : ""}`}
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="6 9 12 15 18 9"></polyline>
                          </svg>
                        </button>
                      )}
                      <input
                        type="checkbox"
                        checked={typeSelected}
                        onChange={() => {
                          if (typeHighlighted) {
                            // If any filters in this category are active, clicking the type checkbox
                            // should clear ALL filters in this category (type + all orgs).
                            clearAllForType(type);
                          } else {
                            // No filters currently selected in this category → behave as normal toggle (select all)
                            toggleOrgCategory(type.key);
                          }
                        }}
                        className={`org-filter-checkbox ${typePartiallySelected ? "partial" : ""}`}
                        aria-checked={typePartiallySelected ? "mixed" : typeSelected}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="org-filter-name">{type.label}</span>
                    </label>
                    <span
                      className={`org-filter-count ${typeHighlighted ? "selected" : ""}`}
                      style={{
                        backgroundColor: typeHighlighted ? typeFillColor : "transparent",
                        borderColor: typeBorderColor,
                        color: typeHighlighted ? "#000" : "#000",
                      }}
                      title={typeHighlighted ? "Remove all filters in this category" : ""}
                      data-tooltip={typeHighlighted ? "Remove all filters in this category" : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (typeHighlighted) {
                          clearAllForType(type);
                        }
                      }}
                    >
                      {type.count}
                    </span>
                  </div>

                  {/* Organizations directly under type (no "Organizations" subcategory row) */}
                  {isExpanded &&
                    typeOrgsSorted.map((org) => {
                      const orgSelected = pendingSelectedOrgCats.has(org.key);
                      const orgFillColor = pendingExcludeMode ? "#f4b4b4" : typeColor;
                      const orgBorderColor = pendingExcludeMode ? "#e07a7a" : typeColor;
                      return (
                        <div key={org.key} className="org-filter-item org-filter-item-indented">
                          <label className="org-filter-label">
                            <input
                              type="checkbox"
                              checked={orgSelected}
                              onChange={() => toggleOrgCategory(org.key)}
                              className={`org-filter-checkbox ${pendingExcludeMode && orgSelected ? "exclude-selected" : ""}`}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="org-filter-name">{org.label}</span>
                          </label>
                          <span
                            className={`org-filter-count ${orgSelected ? "selected" : ""}`}
                            style={{
                              backgroundColor: orgSelected ? orgFillColor : "transparent",
                              borderColor: orgBorderColor,
                              color: orgSelected ? "#000" : "#000",
                            }}
                          >
                            {org.count}
                          </span>
                        </div>
                      );
                    })}
                </div>
              );
            })}
            </div>
            </div>
          </>
        ) : (
          <div className="event-types-list-wrapper">
            <div className="event-types-list">
            {availableCats.map((cat) => {
              const key = cat.key;
              const label = cat.label || key;
              const active = pendingSelectedCats.has(key);
              const count = categoryCounts[key] || 0;
              const tagColor = tagColorMap?.[key] || '#e5e7eb'; // Default to light grey for untagged
              const eventFillColor = pendingExcludeMode ? "#f4b4b4" : "#d4e9c4";
              const eventBorderColor = pendingExcludeMode ? "#e07a7a" : "#d4e9c4";

              return (
                <div 
                  key={key} 
                  className="org-filter-item event-type-filter-item"
                >
                  <label className="org-filter-label">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleEventCategory(key)}
                      className="org-filter-checkbox event-type-checkbox"
                      style={{
                        borderColor: tagColor,
                        accentColor: tagColor,
                        color: tagColor,
                      }}
                      className={`org-filter-checkbox ${pendingExcludeMode && active ? "exclude-selected" : ""}`}
                    />
                    <span className="org-filter-name">{label}</span>
                  </label>
                  <span 
                    className={`org-filter-count ${active ? 'selected' : ''}`}
                    style={{ 
                      backgroundColor: active ? tagColor : 'transparent',
                      borderColor: tagColor,
                      color: '#000'
                      backgroundColor: active ? eventFillColor : 'transparent',
                      borderColor: eventBorderColor,
                      color: active ? '#000' : '#000'
                    }}
                  >
                    {count}
                  </span>
                </div>
            );
          })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="filters-footer">
        {/* Negative filter toggle - aligned like other filter rows */}
        <div className="org-filter-item" style={{ marginBottom: 0 }}>
          <label className="org-filter-label" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={pendingExcludeMode}
              onChange={(e) => setPendingExcludeMode(e.target.checked)}
              className={`org-filter-checkbox ${pendingExcludeMode ? "exclude-selected" : ""}`}
            />
            <span className="org-filter-name">
              Exclude selected (hide matching events)
            </span>
          </label>
        </div>

        <div />
      </div>
    </div>
  );
};

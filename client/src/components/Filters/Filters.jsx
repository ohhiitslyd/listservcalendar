// src/components/Filters/Filters.jsx
import React, { useContext, useState, useMemo } from "react";
import { AppContext } from "../../context/AppContext";
import { api } from "../../api/calendarApi";
import "./Filters.css";

export const Filters = ({ onClose }) => {
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

  } = useContext(AppContext);

  const [activeTab, setActiveTab] = useState("organizations");
  const [expandedCategories, setExpandedCategories] = useState(new Set());

  const clearAll = () => {
    setSelectedCats(new Set());
    setSelectedOrgCats(new Set());
  };

  // Calculate total selected count
  const totalSelected = selectedCats.size + selectedOrgCats.size;

  // Apply filters - save to user preferences and sync calendar
  const applyFilters = async () => {
    try {
      // Convert Sets to arrays
      const orgPrefsArray = Array.from(selectedOrgCats);
      const eventTypePrefsArray = Array.from(selectedCats);

      // Save preferences
      await api.updatePreferences({
        organizationPreference: orgPrefsArray,
        eventTypePreference: eventTypePrefsArray,
      });

      // Sync calendar based on preferences
      await api.syncCalendarByPreferences();
      
      // Close dropdown immediately
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error("Failed to apply filters:", error);
      // Close dropdown even on error
      if (onClose) {
        onClose();
      }
    }
  };



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
    
    // Debug: log what we're receiving
    console.log('Available org cats:', availableOrgCats);
    const orgCats = availableOrgCats.filter(c => {
      const parts = c.key.split(':');
      const level = c.level || (parts.length === 1 ? 'type' : parts.length === 2 ? 'subcategory' : 'organization');
      return level === 'organization';
    });
    console.log('Organization entries:', orgCats);
    // Check specifically for the missing ones
    const cordsEntry = orgCats.find(c => c.key.includes('dartmouth_cords') || c.label === 'Dartmouth Cords');
    const singsEntry = orgCats.find(c => c.key.includes('dartmouth_sings') || c.label === 'Dartmouth Sings');
    console.log('Dartmouth Cords entry:', cordsEntry);
    console.log('Dartmouth Sings entry:', singsEntry);
    
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
            emails: Array.isArray(cat.emails) ? cat.emails : [], // ✅ ADD THIS
          };
          console.log(`Added organization: ${cat.label} (${cat.key}) to ${typeKey}:${subKey} (subKeyFull: ${subKeyFull})`);
        } else {
          console.warn(`Organization ${cat.label} (${cat.key}) already exists in hierarchy!`);
        }
      }
    });

    // Second pass: calculate parent counts from children (aggregate from leaf nodes only)
    Object.values(hierarchy).forEach(type => {
      let typeCount = 0;
      Object.values(type.subcategories).forEach(sub => {
        // Count only from organizations (leaf nodes), not direct subcategory counts
        let subCount = 0;
        Object.values(sub.organizations).forEach(org => {
          subCount += org.count;
        });
        sub.count = subCount;
        typeCount += subCount;
      });
      type.count = typeCount;
    });

    // Debug: log final hierarchy
    console.log('Final hierarchy:', hierarchy);
    Object.values(hierarchy).forEach(type => {
      Object.values(type.subcategories).forEach(sub => {
        const orgNames = Object.values(sub.organizations).map(o => o.label);
        const orgKeys = Object.keys(sub.organizations);
        console.log(`${type.label} > ${sub.label}: ${orgNames.length} orgs - ${orgNames.join(', ')}`);
        console.log(`  Keys: ${orgKeys.join(', ')}`);
        // Check specifically for missing orgs
        if (sub.label === 'A Cappella' || sub.key.includes('a_cappella')) {
          const expectedOrgs = ['Dartmouth Brovertones', 'Dartmouth Aires', 'Dartmouth Cords', 'Dartmouth Decibelles', 
                                'Dartmouth Rockapellas', 'Dartmouth Dodecaphonics', 'Dartmouth Sings', 'Dartmouth Subtleties'];
          const missing = expectedOrgs.filter(name => !orgNames.includes(name));
          if (missing.length > 0) {
            console.error(`MISSING organizations in A Cappella: ${missing.join(', ')}`);
          }
        }
      });
    });

    return hierarchy;
  }, [availableOrgCats, orgCategoryCounts]);

  // Color mapping for categories
  const getCategoryColor = (typeKey) => {
    const colors = {
      'sports': '#eaa993', // orange/red
      'music': '#93b3ea',  // blue
    };
    return colors[typeKey] || '#d4e9c4'; // default green
  };

  // Helper function to check if all children of a type are selected
  const areAllTypeChildrenSelected = (type, selectedSet) => {
    return Object.values(type.subcategories).every(sub => selectedSet.has(sub.key));
  };

  // Helper function to check if all children of a subcategory are selected
  const areAllSubcategoryChildrenSelected = (sub, selectedSet) => {
    return Object.values(sub.organizations).every(org => selectedSet.has(org.key));
  };

  // Helper function to update parent selection based on children
  const updateParentSelection = (next, orgHierarchy) => {
    // First, check all subcategories - if all organizations are selected, select the subcategory
    Object.values(orgHierarchy).forEach(type => {
      Object.values(type.subcategories).forEach(sub => {
        const allOrgsSelected = areAllSubcategoryChildrenSelected(sub, next);
        if (allOrgsSelected && Object.keys(sub.organizations).length > 0) {
          next.add(sub.key);
        } else {
          // If not all organizations are selected, deselect the subcategory
          next.delete(sub.key);
        }
      });
    });
    
    // Then, check all types - if all subcategories are selected, select the type
    Object.values(orgHierarchy).forEach(type => {
      const allSubsSelected = areAllTypeChildrenSelected(type, next);
      if (allSubsSelected && Object.keys(type.subcategories).length > 0) {
        next.add(type.key);
      } else {
        // If not all subcategories are selected, deselect the type
        next.delete(type.key);
      }
    });
  };

  const toggleOrgCategory = (key) => {
    setSelectedOrgCats((prev) => {
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
            setSelectedCats((prev) => {
              const next = new Set(prev);
              next.has(key) ? next.delete(key) : next.add(key);
              return next;
            });
          };

          return (
    <div className="filters-wrapper">
      {/* Header */}
      <div className="filters-header">
        <h4 className="filters-title">Filters</h4>
        <span className="filters-selected-count">
          {totalSelected > 0 ? `${totalSelected} selected` : ''}
        </span>
      </div>

      

      {/* Tabs */}
      <div className="filters-tabs">
        <div className="filters-tabs-group">
          <button
            className={`filter-tab ${activeTab === 'organizations' ? 'active' : ''}`}
            onClick={() => setActiveTab('organizations')}
          >
            Organizations
          </button>
          <button
            className={`filter-tab ${activeTab === 'event-types' ? 'active' : ''}`}
            onClick={() => setActiveTab('event-types')}
          >
            Event Types
          </button>
        </div>
        <button
          onClick={() => {
            clearAll();
            setExcludeMode(false);
          }}
          className="filters-clear-all-tab"
        >
          Clear All
        </button>
      </div>

      {/* Content */}
      <div className="filters-content">
        {activeTab === 'organizations' ? (
          <div className="org-filters-list">
            {orgHierarchy && Object.values(orgHierarchy).map((type) => {
              const typeColor = getCategoryColor(type.key);
              const typeSelected = selectedOrgCats.has(type.key);
              const isExpanded = expandedCategories.has(type.key);
              const hasSubcategories = Object.keys(type.subcategories).length > 0;
              
              return (
                <div key={type.key} className="org-filter-group">
                  {/* Type level */}
                  <div className="org-filter-item">
                    <label className="org-filter-label">
                      {hasSubcategories && (
                        <button
                          type="button"
                          className="org-filter-expand-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategoryExpansion(type.key);
                          }}
                        >
                          <svg 
                            className={`org-filter-expand-icon ${isExpanded ? 'expanded' : ''}`}
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
                        onChange={() => toggleOrgCategory(type.key)}
                        className="org-filter-checkbox"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="org-filter-name">{type.label}</span>
                    </label>
                    <span 
                      className={`org-filter-count ${typeSelected ? 'selected' : ''}`}
                      style={{ 
                        backgroundColor: typeSelected ? typeColor : 'transparent',
                        borderColor: typeColor,
                        color: typeSelected ? '#000' : '#000'
                      }}
                    >
                      {type.count}
                    </span>
                  </div>

                  {/* Subcategories - only show if expanded */}
                  {isExpanded && Object.values(type.subcategories).map((sub) => {
                    const subSelected = selectedOrgCats.has(sub.key);
                    const hasOrganizations = Object.keys(sub.organizations).length > 0;
                    const isSubExpanded = expandedCategories.has(sub.key);

            return (
                      <div key={sub.key}>
                        <div className="org-filter-item org-filter-item-indented">
                          <label className="org-filter-label">
                            {hasOrganizations && (
              <button
                type="button"
                                className="org-filter-expand-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleCategoryExpansion(sub.key);
                                }}
                              >
                                <svg 
                                  className={`org-filter-expand-icon ${isSubExpanded ? 'expanded' : ''}`}
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
                              checked={subSelected}
                              onChange={() => toggleOrgCategory(sub.key)}
                              className="org-filter-checkbox"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="org-filter-name">{sub.label}</span>
                          </label>
                          <span 
                            className={`org-filter-count ${subSelected ? 'selected' : ''}`}
                            style={{ 
                              backgroundColor: subSelected ? typeColor : 'transparent',
                              borderColor: typeColor,
                              color: subSelected ? '#000' : '#000'
                            }}
                          >
                            {sub.count}
                          </span>
                        </div>
                        {/* Organizations - only show if subcategory is expanded */}
                        {isSubExpanded && (() => {
                          const orgs = Object.values(sub.organizations);
                          console.log(`Rendering ${orgs.length} organizations for ${sub.label}:`, orgs.map(o => o.label));
                          return orgs.map((org) => {
                            const orgSelected = selectedOrgCats.has(org.key);
                            return (
                              <div key={org.key} className="org-filter-item org-filter-item-double-indented">
                                <label className="org-filter-label">
                                  <input
                                    type="checkbox"
                                    checked={orgSelected}
                                    onChange={() => toggleOrgCategory(org.key)}
                                    className="org-filter-checkbox"
                                  />
                                  <span className="org-filter-name">{org.label}</span>
                                </label>
                                <span 
                                  className={`org-filter-count ${orgSelected ? 'selected' : ''}`}
                                  style={{ 
                                    backgroundColor: orgSelected ? typeColor : 'transparent',
                                    borderColor: typeColor,
                                    color: orgSelected ? '#000' : '#000'
                                  }}
                                >
                                  {org.count}
                                </span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="event-types-list">
            {availableCats.map((cat) => {
              const key = cat.key;
              const label = cat.label || key;
              const active = selectedCats.has(key);
              const count = categoryCounts[key] || 0;

              return (
                <div key={key} className="org-filter-item">
                  <label className="org-filter-label">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleEventCategory(key)}
                      className="org-filter-checkbox"
                    />
                    <span className="org-filter-name">{label}</span>
                  </label>
                  <span 
                    className={`org-filter-count ${active ? 'selected' : ''}`}
                    style={{ 
                      backgroundColor: active ? '#d4e9c4' : 'transparent',
                      borderColor: '#d4e9c4',
                      color: active ? '#000' : '#000'
                    }}
                  >
                    {count}
                  </span>
                </div>
            );
          })}
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
              checked={excludeMode}
              onChange={(e) => setExcludeMode(e.target.checked)}
              className="org-filter-checkbox"
            />
            <span className="org-filter-name">
              Exclude selected (hide matching events)
            </span>
          </label>
        </div>

        <button
          onClick={applyFilters}
          className="filters-apply-btn"
        >
          Apply filters
        </button>
      </div>
    </div>
  );
};
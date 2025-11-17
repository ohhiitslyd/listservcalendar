// src/components/Filters/Filters.jsx
import React, { useContext, useState, useMemo } from "react";
import { AppContext } from "../../context/AppContext";
import "./Filters.css";

export const Filters = () => {
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
  } = useContext(AppContext);

  const [activeTab, setActiveTab] = useState("organizations");
  const [expandedCategories, setExpandedCategories] = useState(new Set());

  const clearAll = () => {
    setSelectedCats(new Set());
    setSelectedOrgCats(new Set());
  };

  // Calculate total selected count
  const totalSelected = selectedCats.size + selectedOrgCats.size;

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
    
    // First pass: build the structure
    availableOrgCats.forEach(cat => {
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
      } else if (level === 'subcategory') {
        const [typeKey] = parts;
        if (!hierarchy[typeKey]) {
          // Find the type label from another entry
          const typeEntry = availableOrgCats.find(c => c.key === typeKey && c.level === 'type');
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
        hierarchy[typeKey].subcategories[cat.key] = {
          key: cat.key,
          label: subLabel,
          level: 'subcategory',
          organizations: {},
          count: orgCategoryCounts[cat.key] || 0,
        };
      } else if (level === 'organization') {
        const [typeKey, subKey] = parts;
        if (!hierarchy[typeKey]) {
          const typeEntry = availableOrgCats.find(c => c.key === typeKey && c.level === 'type');
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
          const subEntry = availableOrgCats.find(c => c.key === subKeyFull && c.level === 'subcategory');
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
        hierarchy[typeKey].subcategories[subKeyFull].organizations[cat.key] = {
          key: cat.key,
          label: cat.label,
          level: 'organization',
          count: orgCategoryCounts[cat.key] || 0,
        };
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

  const toggleOrgCategory = (key) => {
    setSelectedOrgCats((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
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

      {/* Content */}
      <div className="filters-content">
        {activeTab === 'organizations' ? (
          <div className="org-filters-list">
            {Object.values(orgHierarchy).map((type) => {
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
                        {isSubExpanded && Object.values(sub.organizations).map((org) => {
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
                        })}
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
        <button onClick={clearAll} className="filters-clear-all">
          Clear All
        </button>
        <button className="filters-apply-btn">
          Apply
        </button>
      </div>
    </div>
  );
};
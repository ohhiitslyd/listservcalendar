// ------------------------------------------------------------
// Pure helper functions – no React, no side effects.
// ------------------------------------------------------------
export const isGoogle = ev => {
  const id = String(ev?.id || ev?._def?.publicId || "");
  return (
    id.startsWith("google:") ||
    ev?.source === "google" ||
    ev?.provider === "google" ||
    ev?.calendarType === "google"
  );
};

export const getTag = ev => {
  const ext = ev?.extendedProps || ev?._def?.extendedProps || {};
  return ext.filter || ext.tag || null;
};

export const isCampus = ev => !!getTag(ev);
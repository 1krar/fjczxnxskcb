export function formatLocation(location, showFullLocation = true) {
  if (!location || showFullLocation) return location || '';
  return location.replace(/\([^()]*\)$/, '') || location;
}

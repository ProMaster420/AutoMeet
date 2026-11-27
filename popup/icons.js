// Small stroke icons (24px grid, drawn at 16px). Static strings only.

const PATHS = {
  sliders:
    '<path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  micOff:
    '<path d="M9 9v2a3 3 0 0 0 5 2.2M15 10V6a3 3 0 0 0-5.9-.8M5 11a7 7 0 0 0 11 5.7M19 11c0 1-.2 2-.7 2.9M12 18v3M3 3l18 18"/>',
  videoOff:
    '<path d="M16 16V8a1 1 0 0 0-1-1H8M4 7a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10M16 10l5-3v10l-5-3M3 3l18 18"/>',
  alert: '<path d="M12 4l9 16H3L12 4zM12 10v4M12 17v.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export function icon(name, size = 16) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
}

export const LOGO = `<svg class="logo" width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor"/><circle cx="16" cy="16" r="8" fill="none" stroke="#0f1320" stroke-width="3"/><path d="M16 11v5.5l3.5 2" fill="none" stroke="#0f1320" stroke-width="2.4" stroke-linecap="round"/></svg>`;

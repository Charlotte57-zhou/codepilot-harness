const ICONS = Object.freeze({
  menu: '<path d="M4 7h16M4 12h16M4 17h16" />',
  plus: '<path d="M12 5v14M5 12h14" />',
  skills: '<circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h8M6 8v8M18 8v8M8 18h8" />',
  mcp: '<rect x="3.5" y="8" width="6" height="8" rx="2" /><rect x="14.5" y="4" width="6" height="6" rx="2" /><rect x="14.5" y="14" width="6" height="6" rx="2" /><path d="M9.5 12H12a3 3 0 0 0 3-3M12 12a3 3 0 0 1 3 3" />',
  folder: '<path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" /><path d="M3.5 10h17" />',
  "folder-open": '<path d="M3.5 7h6l2 2h8.2a2 2 0 0 1 1.9 2.6l-2 6.4a2 2 0 0 1-1.9 1.4H5.6A2 2 0 0 1 3.7 18L2.4 13.6A2 2 0 0 1 4.3 11H20" />',
  terminal: '<rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="m7 9 3 3-3 3M12.5 15h4.5" />',
  "git-branch": '<circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10M8 17c6 0 8-3 8-8" />',
  browser: '<rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 8.5h17M7 6.5h.01M10 6.5h.01" />',
  computer: '<rect x="3.5" y="4" width="17" height="13" rx="2" /><path d="M9 21h6M12 17v4" />',
  agent: '<circle cx="12" cy="8" r="3" /><path d="M6 20v-2a6 6 0 0 1 12 0v2M4 10h2M18 10h2" />',
  package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" />',
  "panel-right": '<rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M15 4v16M17.75 8h.01M17.75 12h.01" />',
  close: '<path d="m7 7 10 10M17 7 7 17" />',
  paperclip: '<path d="m20.2 11.1-8.5 8.5a5 5 0 0 1-7.1-7.1L14 3.1a3.5 3.5 0 0 1 5 5L9.3 17.8a2 2 0 0 1-2.8-2.8l8.1-8.1" />',
  "circle-help": '<circle cx="12" cy="12" r="8.5" /><path d="M9.8 9.4a2.35 2.35 0 1 1 3.2 2.2c-.75.32-1 .75-1 1.4" /><path d="M12 16.6h.01" />',
  "shield-alert": '<path d="M12 3 4.5 6.2v5.3c0 4.4 3 7.9 7.5 9.5 4.5-1.6 7.5-5.1 7.5-9.5V6.2L12 3Z" /><path d="M12 8v4" /><path d="M12 15.5h.01" />',
  trash: '<path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6.5 7 .7 13h9.6l.7-13" /><path d="M10 11v5" /><path d="M14 11v5" />',
  "message-square": '<path d="M5.5 4.5h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-4.5 3v-3h0a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />',
  "shield-check": '<path d="M12 3 4.5 6.2v5.3c0 4.4 3 7.9 7.5 9.5 4.5-1.6 7.5-5.1 7.5-9.5V6.2L12 3Z" /><path d="m9.2 12 1.8 1.8 3.8-4" />',
  settings: '<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.5v-.1A1.7 1.7 0 0 0 8.4 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.2V9.5h.1A1.7 1.7 0 0 0 4 8.4a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.46 3.6l.06.06A1.7 1.7 0 0 0 8.4 4a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.2h4.1v.1A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.4a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4.1h-.1A1.7 1.7 0 0 0 19.4 15Z" />',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.3-5.8L3.5 8.5" /><path d="M3.5 4v4.5H8M12 7.5V12l3 2" />',
  info: '<circle cx="12" cy="12" r="8.5" /><path d="M12 10.8v5M12 7.5h.01" />',
  check: '<path d="m5 12 4 4L19 6" />',
  "chevron-down": '<path d="m7 10 5 5 5-5" />',
  "chevron-right": '<path d="m9 6 6 6-6 6" />',
  "rotate-ccw": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />',
  "arrow-up": '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />',
  square: '<rect x="7" y="7" width="10" height="10" rx="1" />',
  upload: '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" />',
  file: '<path d="M6.5 3.5h7l4 4v12A1.5 1.5 0 0 1 16 21H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5Z" /><path d="M13.5 3.5v4h4" />',
  "file-text": '<path d="M6.5 3.5h7l4 4v12A1.5 1.5 0 0 1 16 21H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5Z" /><path d="M13.5 3.5v4h4M8.5 13h7M8.5 16h5" />',
  sparkles: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" /><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" /><path d="m5 13 .8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z" />',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 8A7 7 0 0 1 18.7 7L20 12M4 12l1.3 5A7 7 0 0 0 17.9 16" />',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 8.4 7.2 6.1 4.9a4 4 0 0 0 5 5L4 17l3 3 7.1-7.1a4 4 0 0 0 5-5l-2.3 2.3-3.6-3.6 1.5-.3Z" />',
  diamond: '<path d="m12 4 8 8-8 8-8-8 8-8Z" />',
  search: '<circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" />',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />'
});

export function icon(name, { className = "ui-icon" } = {}) {
  const content = ICONS[name];
  if (!content) throw new Error(`Unknown icon: ${name}`);
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${content}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((target) => {
    target.innerHTML = icon(target.dataset.icon, {
      className: target.dataset.iconClass || "ui-icon"
    });
  });
}

export const iconNames = Object.freeze(Object.keys(ICONS));
